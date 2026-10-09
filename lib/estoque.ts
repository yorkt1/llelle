import crypto from "node:crypto";
import { v2 as cloudinary } from "cloudinary";
import * as store from "./store";

/**
 * Registro do galpão organizado como a estrutura física real: Rua (letra) > Posição/gaveta
 * (código, ex.: "A5"). Cada posição guarda um HISTÓRICO de contagens — nunca sobrescreve, só
 * acrescenta — pra dar pra ver a evolução ao longo do tempo, não só o valor mais recente.
 *
 * Foto vai pro Cloudinary (storage externo) — só a URL fica guardada no registro. Isso existe
 * porque o servidor roda hoje num plano sem disco persistente (Render Free — ver README): um
 * arquivo salvo localmente desaparecia a cada deploy/"acordar", e pior, `res.sendFile` com o
 * caminho relativo resultante (quando DATA_DIR não está configurado) lançava síncrono e virava
 * 500 em vez de um 404 "não encontrada" normal. Com a foto num storage de verdade, nenhum dos
 * dois problemas existe mais: a URL funciona direto do navegador, sem passar pelo nosso backend.
 *
 * Contagem é 100% manual de propósito (ver server/routes/estoque.ts e src/Estoque.tsx) — sem
 * nenhuma lógica de visão computacional nesta fase.
 *
 * Foto é OBRIGATÓRIA em toda contagem (mesmo recontagem) — o ponto do sistema é um registro
 * visual auditável por evento, não só um número solto.
 */

export interface RegistroContagem {
  id: string;
  quantidade: number;
  responsavel: string;
  /** URL pública do Cloudinary — não um caminho/arquivo local. */
  fotoUrl: string;
  criadoEm: string;
}

type HistoricoPorPosicao = Record<string, RegistroContagem[]>; // chave: "RUA::CODIGO", mais recente primeiro

export const VOLTAGENS = ["110V", "220V", "Bivolt"] as const;
export type Voltagem = (typeof VOLTAGENS)[number];

export interface MetadadosPosicao {
  produto: string;
  voltagem: Voltagem;
}

// chave: "RUA::CODIGO" — produto/voltagem são fixos da posição (definidos na criação, editáveis
// depois), não um dado de cada contagem: não faz sentido perguntar de novo numa recontagem.
type MetadadosPorPosicao = Record<string, MetadadosPosicao>;

export interface PosicaoResumo {
  rua: string;
  codigo: string;
  ultima: RegistroContagem;
  /** null só pra posição criada antes dessa funcionalidade existir — toda posição nova exige os dois. */
  produto: string | null;
  voltagem: Voltagem | null;
}

export interface RuaResumo {
  rua: string;
  posicoes: PosicaoResumo[];
}

const CHAVE_STORE = "estoque";
const CHAVE_METADADOS = "estoque:metadados";
const CHAVE_PRODUTOS = "estoque:produtos";
const PASTA_CLOUDINARY = "llelle-estoque";

function normalizar(texto: string): string {
  return texto.trim().toUpperCase();
}

function chave(rua: string, codigo: string): string {
  return `${normalizar(rua)}::${normalizar(codigo)}`;
}

export async function listarEstoque(): Promise<RuaResumo[]> {
  const tudo = (await store.get<HistoricoPorPosicao>(CHAVE_STORE)) ?? {};
  const metadados = (await store.get<MetadadosPorPosicao>(CHAVE_METADADOS)) ?? {};
  const porRua = new Map<string, PosicaoResumo[]>();

  for (const [chaveComposta, historico] of Object.entries(tudo)) {
    if (historico.length === 0) continue;
    const [rua, codigo] = chaveComposta.split("::");
    const meta = metadados[chaveComposta];
    const lista = porRua.get(rua) ?? [];
    lista.push({ rua, codigo, ultima: historico[0], produto: meta?.produto ?? null, voltagem: meta?.voltagem ?? null });
    porRua.set(rua, lista);
  }

  return [...porRua.entries()]
    .sort(([a], [b]) => a.localeCompare(b, "pt-BR"))
    .map(([rua, posicoes]) => ({
      rua,
      posicoes: posicoes.sort((a, b) => a.codigo.localeCompare(b.codigo, "pt-BR", { numeric: true })),
    }));
}

export async function obterHistorico(rua: string, codigo: string): Promise<RegistroContagem[]> {
  const tudo = (await store.get<HistoricoPorPosicao>(CHAVE_STORE)) ?? {};
  return tudo[chave(rua, codigo)] ?? [];
}

export async function obterMetadados(rua: string, codigo: string): Promise<MetadadosPosicao | null> {
  const tudo = (await store.get<MetadadosPorPosicao>(CHAVE_METADADOS)) ?? {};
  return tudo[chave(rua, codigo)] ?? null;
}

function validarVoltagem(voltagem: string): voltagem is Voltagem {
  return (VOLTAGENS as readonly string[]).includes(voltagem);
}

/** Define/atualiza produto+voltagem de uma posição — tanto na criação quanto numa correção depois. */
export async function definirMetadados(rua: string, codigo: string, produto: string, voltagem: string): Promise<MetadadosPosicao> {
  const produtoLimpo = produto.trim();
  if (!produtoLimpo) throw new Error("Informe o produto dessa posição.");
  if (!validarVoltagem(voltagem)) throw new Error(`Voltagem inválida (use ${VOLTAGENS.join(", ")}).`);

  const catalogo = await listarProdutos();
  if (!catalogo.some((p) => p.toLowerCase() === produtoLimpo.toLowerCase())) {
    throw new Error("Esse produto não está no catálogo — cadastre em \"Configurar produtos\" antes.");
  }

  const metadados: MetadadosPosicao = { produto: produtoLimpo, voltagem };
  const k = chave(rua, codigo);
  await store.update<MetadadosPorPosicao>(CHAVE_METADADOS, (atual) => ({ ...(atual ?? {}), [k]: metadados }));
  return metadados;
}

export async function listarProdutos(): Promise<string[]> {
  return (await store.get<string[]>(CHAVE_PRODUTOS)) ?? [];
}

export async function adicionarProduto(nome: string): Promise<string[]> {
  const limpo = nome.trim();
  if (!limpo) throw new Error("Informe o nome do produto.");
  return store.update<string[]>(CHAVE_PRODUTOS, (atual) => {
    const lista = atual ?? [];
    if (lista.some((p) => p.toLowerCase() === limpo.toLowerCase())) throw new Error("Esse produto já está cadastrado.");
    return [...lista, limpo].sort((a, b) => a.localeCompare(b, "pt-BR"));
  });
}

export async function removerProduto(nome: string): Promise<void> {
  await store.update<string[]>(CHAVE_PRODUTOS, (atual) => (atual ?? []).filter((p) => p !== nome));
}


/** Cadastra vários produtos de uma vez (lista colada ou importada do Tiny). Já existentes são ignorados, sem erro. */
export async function adicionarProdutos(nomes: string[]): Promise<{ produtos: string[]; adicionados: number }> {
  let adicionados = 0;
  const produtos = await store.update<string[]>(CHAVE_PRODUTOS, (atual) => {
    const lista = [...(atual ?? [])];
    const existentes = new Set(lista.map((p) => p.toLowerCase()));
    for (const nome of nomes) {
      const limpo = nome.trim().replace(/\s+/g, " ");
      if (!limpo || existentes.has(limpo.toLowerCase())) continue;
      lista.push(limpo);
      existentes.add(limpo.toLowerCase());
      adicionados++;
    }
    return lista.sort((a, b) => a.localeCompare(b, "pt-BR"));
  });
  return { produtos, adicionados };
}


/** O nome do produto já diz a voltagem? ("... 110V", "... 220V", "... Bivolt"; 127V conta como 110V.) */
export function voltagemNoNome(nome: string): Voltagem | null {
  if (/\bbivolt\b/i.test(nome)) return "Bivolt";
  const ocorrencias = [...nome.matchAll(/\b(110|127|220)\s*v?\b/gi)];
  if (ocorrencias.length === 0) return null;
  return ocorrencias[ocorrencias.length - 1][1] === "220" ? "220V" : "110V";
}

export interface ResultadoDivisao {
  /** Produto original → produtos novos criados a partir dele (um por voltagem). */
  divisoes: { original: string; novos: string[]; gavetas: number }[];
  gavetasAtualizadas: number;
  /** Originais que saíram do catálogo (nenhuma gaveta usa mais o nome sem voltagem). */
  removidosDoCatalogo: string[];
}

/**
 * "Separar por voltagem": produto cadastrado SEM a voltagem no nome (de quando a voltagem era um
 * campo da gaveta) vira um produto por voltagem — "Chaleira Elegance Azul" com gavetas 110V e
 * 220V vira "Chaleira Elegance Azul 110V" e "Chaleira Elegance Azul 220V", e cada gaveta passa
 * pro produto da voltagem dela. Contagens, fotos e histórico das gavetas não mudam.
 *
 * `nomes` vazio = todos os produtos nessa situação. Gaveta sem voltagem continua no produto
 * original (que só sai do catálogo se nenhuma gaveta usar mais ele).
 */
export async function dividirProdutosPorVoltagem(nomes: string[] = []): Promise<ResultadoDivisao> {
  const alvo = new Set(nomes.map((n) => n.trim().toLowerCase()));
  const catalogo = await listarProdutos();
  const nomeNoCatalogo = new Map(catalogo.map((p) => [p.toLowerCase(), p]));
  const divisoes = new Map<string, { original: string; novos: Set<string>; gavetas: number }>();
  let gavetasAtualizadas = 0;

  const metadadosNovos = await store.update<MetadadosPorPosicao>(CHAVE_METADADOS, (atual) => {
    const mapa = { ...(atual ?? {}) };
    for (const [k, meta] of Object.entries(mapa)) {
      if (!meta?.produto || !meta.voltagem) continue;
      if (voltagemNoNome(meta.produto)) continue; // já é um produto por voltagem
      if (alvo.size > 0 && !alvo.has(meta.produto.trim().toLowerCase())) continue;
      const sugerido = `${meta.produto.trim()} ${meta.voltagem}`;
      // Se o catálogo já tem esse produto (com outra caixa de letra), usa o nome de lá.
      const novoNome = nomeNoCatalogo.get(sugerido.toLowerCase()) ?? sugerido;
      mapa[k] = { ...meta, produto: novoNome };
      const d = divisoes.get(meta.produto) ?? { original: meta.produto, novos: new Set<string>(), gavetas: 0 };
      d.novos.add(novoNome);
      d.gavetas++;
      divisoes.set(meta.produto, d);
      gavetasAtualizadas++;
    }
    return mapa;
  });

  if (divisoes.size === 0) return { divisoes: [], gavetasAtualizadas: 0, removidosDoCatalogo: [] };

  const novos = [...divisoes.values()].flatMap((d) => [...d.novos]);
  await adicionarProdutos(novos);

  // O original sai do catálogo se nenhuma gaveta usa mais ele (as sem voltagem seguram).
  const aindaUsados = new Set(Object.values(metadadosNovos).map((m) => m?.produto?.toLowerCase()).filter(Boolean));
  const removidosDoCatalogo = [...divisoes.keys()].filter((original) => !aindaUsados.has(original.toLowerCase()));
  if (removidosDoCatalogo.length > 0) {
    const remover = new Set(removidosDoCatalogo.map((r) => r.toLowerCase()));
    await store.update<string[]>(CHAVE_PRODUTOS, (atual) => (atual ?? []).filter((p) => !remover.has(p.toLowerCase())));
  }

  return {
    divisoes: [...divisoes.values()].map((d) => ({ original: d.original, novos: [...d.novos].sort(), gavetas: d.gavetas })),
    gavetasAtualizadas,
    removidosDoCatalogo,
  };
}
// Exclusão de posição/rua: nunca apaga de vez — o histórico (contagens + fotos) e o produto/voltagem
// vão pra `estoque:excluidos`, com data, pra dar pra recuperar se alguém excluir por engano.
const CHAVE_EXCLUIDOS = "estoque:excluidos";

interface PosicaoExcluida {
  rua: string;
  codigo: string;
  historico: RegistroContagem[];
  metadados: MetadadosPosicao | null;
  excluidoEm: string;
}

async function excluirChaves(chaves: string[]): Promise<number> {
  if (chaves.length === 0) return 0;
  const historicos = (await store.get<HistoricoPorPosicao>(CHAVE_STORE)) ?? {};
  const metadados = (await store.get<MetadadosPorPosicao>(CHAVE_METADADOS)) ?? {};
  const excluidoEm = new Date().toISOString();
  const arquivados: PosicaoExcluida[] = chaves.map((k) => {
    const [rua, codigo] = k.split("::");
    return { rua, codigo, historico: historicos[k] ?? [], metadados: metadados[k] ?? null, excluidoEm };
  });

  // Arquiva PRIMEIRO: se algo falhar depois, no pior caso a posição fica duplicada (ativa + arquivo),
  // nunca perdida.
  await store.update<PosicaoExcluida[]>(CHAVE_EXCLUIDOS, (atual) => [...(atual ?? []), ...arquivados]);
  await store.update<HistoricoPorPosicao>(CHAVE_STORE, (atual) => {
    const copia = { ...(atual ?? {}) };
    for (const k of chaves) delete copia[k];
    return copia;
  });
  await store.update<MetadadosPorPosicao>(CHAVE_METADADOS, (atual) => {
    const copia = { ...(atual ?? {}) };
    for (const k of chaves) delete copia[k];
    return copia;
  });
  return chaves.length;
}

export async function removerPosicao(rua: string, codigo: string): Promise<void> {
  const k = chave(rua, codigo);
  const historicos = (await store.get<HistoricoPorPosicao>(CHAVE_STORE)) ?? {};
  if (!historicos[k]) throw new Error("Essa posição não existe.");
  await excluirChaves([k]);
}

/** Exclui a rua inteira (todas as posições dela). Devolve quantas posições foram arquivadas. */
export async function removerRua(rua: string): Promise<number> {
  const prefixo = `${normalizar(rua)}::`;
  const historicos = (await store.get<HistoricoPorPosicao>(CHAVE_STORE)) ?? {};
  const metadados = (await store.get<MetadadosPorPosicao>(CHAVE_METADADOS)) ?? {};
  const chaves = [...new Set([...Object.keys(historicos), ...Object.keys(metadados)])].filter((k) => k.startsWith(prefixo));
  return excluirChaves(chaves);
}
const FORMATOS_AUTORIZADOS = new Set(["jpeg", "jpg", "png", "webp"]);

export class CloudinaryConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CloudinaryConfigError";
  }
}

function cloudinaryConfigurado(): boolean {
  return Boolean(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET);
}

// Lido a cada chamada (não config() uma vez só no import) pelo mesmo motivo de lib/olist.ts: o
// dotenv carrega o .env.local/.env depois que os imports já rodaram em dev.
function configurarCloudinary(): void {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
}

async function salvarFoto(fotoDataUri: string): Promise<string> {
  const compatibilidade = fotoDataUri.match(/^data:image\/([a-zA-Z]+);base64,(.+)$/);
  if (!compatibilidade) throw new Error("Imagem em formato inválido (esperado data URI base64).");

  const formato = compatibilidade[1].toLowerCase();
  if (!FORMATOS_AUTORIZADOS.has(formato)) throw new Error(`Formato de imagem não aceito: ${formato}`);

  if (!cloudinaryConfigurado()) {
    throw new CloudinaryConfigError(
      "Upload de foto não configurado — faltam CLOUDINARY_CLOUD_NAME/CLOUDINARY_API_KEY/CLOUDINARY_API_SECRET no ambiente.",
    );
  }

  configurarCloudinary();
  const resultado = await cloudinary.uploader.upload(fotoDataUri, {
    folder: PASTA_CLOUDINARY,
    public_id: crypto.randomUUID(),
    resource_type: "image",
  });
  return resultado.secure_url;
}

/**
 * Copia uma imagem de um link externo (ex.: anexo do produto no Tiny) pro Cloudinary — o link de
 * origem pode expirar ou sumir; o do Cloudinary fica. `publicId` fixo + overwrite: buscar a foto
 * do mesmo produto de novo substitui em vez de acumular cópias.
 */
export async function salvarImagemRemota(url: string, pasta: string, publicId: string): Promise<string> {
  // Aceita link externo (foto do Tiny) ou data URI de imagem (foto trocada à mão no sistema).
  if (!/^https?:\/\//i.test(url) && !/^data:image\/(jpeg|jpg|png|webp);base64,/i.test(url)) throw new Error("Imagem inválida.");
  if (!cloudinaryConfigurado()) {
    throw new CloudinaryConfigError(
      "Upload de foto não configurado — faltam CLOUDINARY_CLOUD_NAME/CLOUDINARY_API_KEY/CLOUDINARY_API_SECRET no ambiente.",
    );
  }
  configurarCloudinary();
  const resultado = await cloudinary.uploader.upload(url, { folder: pasta, public_id: publicId, overwrite: true, resource_type: "image" });
  return resultado.secure_url;
}

export interface RegistrarContagemParams {
  rua: string;
  codigo: string;
  quantidade: number;
  responsavel: string;
  /**
   * Data URI base64 (ex.: "data:image/jpeg;base64,..."). OBRIGATÓRIA em toda contagem, mesmo
   * recontagem de uma posição que já tinha foto — o objetivo é um registro visual auditável por
   * EVENTO de contagem, não uma foto genérica reaproveitada de uma vez qualquer no passado.
   */
  fotoDataUri: string;
  /**
   * Só usados enquanto a posição ainda não tem produto (posição nova, ou registrada vazia) — depois
   * ficam fixos, só mudam por uma correção explícita (ver `definirMetadados`), nunca de novo aqui.
   * Opcionais quando quantidade = 0: aí a posição é registrada vazia, sem produto.
   */
  produto?: string;
  voltagem?: string;
}

export async function registrarContagem(params: RegistrarContagemParams): Promise<RegistroContagem> {
  const k = chave(params.rua, params.codigo);
  const metadadosAtuais = await obterMetadados(params.rua, params.codigo);
  if (!metadadosAtuais) {
    // Posição sem produto definido (nova, ou registrada vazia antes): só pode ser contada com 0 un.
    // — é a "posição vazia". Pra ter unidades, precisa produto+voltagem, que ficam fixos daí em diante.
    if (params.produto && params.voltagem) {
      await definirMetadados(params.rua, params.codigo, params.produto, params.voltagem);
    } else if (params.quantidade > 0) {
      throw new Error("Produto e voltagem são obrigatórios pra contar unidades numa posição — sem produto, ela só pode ser registrada vazia (0 un.).");
    }
  }

  const fotoUrl = await salvarFoto(params.fotoDataUri);

  const registro: RegistroContagem = {
    id: crypto.randomUUID(),
    quantidade: params.quantidade,
    responsavel: params.responsavel,
    fotoUrl,
    criadoEm: new Date().toISOString(),
  };

  await store.update<HistoricoPorPosicao>(CHAVE_STORE, (atual) => {
    const tudo = atual ?? {};
    return { ...tudo, [k]: [registro, ...(tudo[k] ?? [])] };
  });

  return registro;
}

import * as store from "./store";
import { CloudinaryConfigError, listarProdutos, salvarImagemRemota } from "./estoque";
import { buscarProdutosTiny, nomeSemVoltagem, type ProdutoTiny } from "./catalogoTiny";
import { tinyGet } from "./tinyClient";
import { OlistConfigError } from "./olist";
import { StoreConfigError } from "./store";
import { nomeProdutoComVoltagemUnica } from "./nomeProduto";

/**
 * Fotos manuais do catálogo do Estoque, guardadas no Cloudinary.
 */

const CHAVE_INFO = "estoque:produtosInfo";
const PASTA_CLOUDINARY = "llelle-produtos";

export type StatusFoto = "pendente" | "ok" | "sem-foto" | "nao-encontrado" | "erro";

export interface InfoProduto {
  nome: string;
  idsTiny: string[];
  codigos: string[];
  fotoUrl?: string;
  fotoStatus: StatusFoto;
  /** Origem da foto já salva — registros antigos podem continuar marcados como Tiny. */
  fotoOrigem?: "tiny" | "manual";
  fotoErro?: string;
  fotoAtualizadaEm?: string;
}

export function chaveProduto(nome: string): string {
  return nome.trim().replace(/\s+/g, " ").toLowerCase();
}

function slug(texto: string): string {
  return (
    texto
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80) || "produto"
  );
}

export async function listarInfoProdutos(): Promise<Record<string, InfoProduto>> {
  return (await store.get<Record<string, InfoProduto>>(CHAVE_INFO)) ?? {};
}

/** Guarda referências do Tiny dos produtos importados, sem iniciar busca de fotos. */
export async function registrarInfoProdutos(itens: { nome: string; idsTiny?: string[]; codigos?: string[] }[]): Promise<void> {
  if (itens.length === 0) return;
  await store.update<Record<string, InfoProduto>>(CHAVE_INFO, (atual) => {
    const mapa = { ...(atual ?? {}) };
    for (const item of itens) {
      const k = chaveProduto(item.nome);
      if (!k) continue;
      const existente = mapa[k];
      const temFoto = existente?.fotoStatus === "ok" && Boolean(existente.fotoUrl);
      mapa[k] = {
        nome: item.nome.trim(),
        idsTiny: [...new Set([...(existente?.idsTiny ?? []), ...(item.idsTiny ?? [])])],
        codigos: [...new Set([...(existente?.codigos ?? []), ...(item.codigos ?? [])])],
        ...(temFoto
          ? { fotoUrl: existente.fotoUrl, fotoStatus: "ok" as const, fotoOrigem: existente.fotoOrigem, fotoAtualizadaEm: existente.fotoAtualizadaEm }
          : { fotoStatus: "sem-foto" as const }),
      };
    }
    return mapa;
  });
}

/** Move fotos e códigos Tiny para nomes normalizados, mantendo a foto válida já cadastrada. */
export async function normalizarInfoProdutos(mapaNomes: Record<string, string>): Promise<void> {
  const grupos = new Map<string, { nome: string; origens: Set<string> }>();
  for (const [origem, nome] of Object.entries(mapaNomes)) {
    const destino = chaveProduto(nome);
    if (!destino) continue;
    const grupo = grupos.get(destino) ?? { nome, origens: new Set<string>() };
    grupo.origens.add(chaveProduto(origem));
    grupos.set(destino, grupo);
  }
  if (grupos.size === 0) return;

  await store.update<Record<string, InfoProduto>>(CHAVE_INFO, (atual) => {
    const mapa = { ...(atual ?? {}) };
    for (const [destino, grupo] of grupos) {
      const origens = [...grupo.origens].filter((origem) => origem !== destino);
      const candidatos = [mapa[destino], ...origens.map((origem) => mapa[origem])].filter((info): info is InfoProduto => Boolean(info));
      if (candidatos.length === 0) continue;

      const escolhido = candidatos.find((info) => info.fotoStatus === "ok" && info.fotoUrl) ?? candidatos[0];
      mapa[destino] = {
        ...escolhido,
        nome: grupo.nome,
        idsTiny: [...new Set(candidatos.flatMap((info) => info.idsTiny))],
        codigos: [...new Set(candidatos.flatMap((info) => info.codigos))],
      };
      for (const origem of origens) delete mapa[origem];
    }
    return mapa;
  });
}

/**
 * "Trocar foto": sobe a imagem escolhida (data URI) para o Cloudinary e marca como manual.
 */
export async function definirFotoManual(nome: string, fotoDataUri: string): Promise<InfoProduto> {
  const k = chaveProduto(nome);
  if (!k) throw new Error("Informe o produto.");
  const fotoUrl = await salvarImagemRemota(fotoDataUri, PASTA_CLOUDINARY, `${slug(nome)}-manual`);
  let resultado!: InfoProduto;
  await store.update<Record<string, InfoProduto>>(CHAVE_INFO, (atual) => {
    const mapa = { ...(atual ?? {}) };
    const existente = mapa[k];
    resultado = {
      nome: existente?.nome ?? nome.trim(),
      idsTiny: existente?.idsTiny ?? [],
      codigos: existente?.codigos ?? [],
      fotoUrl,
      fotoStatus: "ok",
      fotoOrigem: "manual",
      fotoAtualizadaEm: new Date().toISOString(),
    };
    mapa[k] = resultado;
    return mapa;
  });
  return resultado;
}

interface ProdutoDetalheTiny {
  retorno?: {
    status?: string;
    erros?: { erro?: string }[];
    produto?: {
      anexos?: { anexo?: string | { url?: string } }[];
      imagens_externas?: { imagem_externa?: { url?: string } }[];
    };
  };
}

export interface ResultadoImportacaoFoto {
  nome: string;
  status: "importada" | "ja-tinha-foto" | "sem-vinculo" | "sem-imagem" | "erro";
  mensagem?: string;
}

function normalizarNomeParaBusca(nome: string): string {
  const canonico = nomeProdutoComVoltagemUnica(nome)?.nome ?? nome;
  return canonico
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\b(\w+)(?:\s+\1)+\b/g, "$1");
}

function termosBuscaTiny(nome: string): string[] {
  const termos = [nome.trim()];
  const palavras = nomeSemVoltagem(nome)
    .replace(/\bou\b/gi, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (palavras.length < 5) return [...new Set(termos)];

  const inicioFinal = palavras.length - 4;
  const inicioMeio = Math.max(0, Math.floor((palavras.length - 4) / 2));
  for (const inicio of [inicioFinal, inicioMeio, 0]) {
    const termo = palavras.slice(inicio, inicio + 4).join(" ");
    if (termo) termos.push(termo);
  }
  return [...new Set(termos)];
}

async function encontrarProdutosTinyPorNome(nome: string): Promise<ProdutoTiny[]> {
  for (const termo of termosBuscaTiny(nome)) {
    let encontrados: ProdutoTiny[];
    try {
      encontrados = await buscarProdutosTiny(termo, 2);
    } catch (error) {
      if (error instanceof Error && /consulta não retornou registros/i.test(error.message)) continue;
      throw error;
    }
    const correspondencias = encontrados.filter(
      (produto) => normalizarNomeParaBusca(produto.sugestao) === normalizarNomeParaBusca(nome),
    );
    if (correspondencias.length > 0) return correspondencias;
  }
  return [];
}

function urlImagensProduto(produto: NonNullable<ProdutoDetalheTiny["retorno"]>["produto"]): string[] {
  if (!produto) return [];
  const anexos = (produto.anexos ?? []).map(({ anexo }) => typeof anexo === "string" ? anexo : anexo?.url);
  const externas = (produto.imagens_externas ?? []).map(({ imagem_externa }) => imagem_externa?.url);
  return [...new Set([...externas, ...anexos].filter((url): url is string => typeof url === "string" && /^https?:\/\//i.test(url)))];
}

async function gravarResultadoFoto(
  nome: string,
  dados: { idsTiny: string[]; codigos: string[]; fotoStatus: StatusFoto; fotoUrl?: string; fotoErro?: string; fotoOrigem?: "tiny" },
): Promise<void> {
  const chave = chaveProduto(nome);
  await store.update<Record<string, InfoProduto>>(CHAVE_INFO, (atual) => {
    const mapa = { ...(atual ?? {}) };
    const existente = mapa[chave];
    if (existente?.fotoStatus === "ok" && existente.fotoUrl) return mapa;
    mapa[chave] = {
      nome: existente?.nome ?? nome.trim(),
      idsTiny: [...new Set([...(existente?.idsTiny ?? []), ...dados.idsTiny])],
      codigos: [...new Set([...(existente?.codigos ?? []), ...dados.codigos])],
      fotoStatus: dados.fotoStatus,
      ...(dados.fotoUrl ? { fotoUrl: dados.fotoUrl } : {}),
      ...(dados.fotoErro ? { fotoErro: dados.fotoErro } : {}),
      ...(dados.fotoOrigem ? { fotoOrigem: dados.fotoOrigem } : {}),
      ...(dados.fotoUrl ? { fotoAtualizadaEm: new Date().toISOString() } : {}),
    };
    return mapa;
  });
}

/** Importa imagens de um lote pequeno de produtos sem foto; foto manual ou já importada nunca é substituída. */
export async function importarFotosFaltantesTiny(nomes: string[]): Promise<ResultadoImportacaoFoto[]> {
  if (nomes.length === 0 || nomes.length > 5) throw new Error("Envie de 1 a 5 produtos por lote.");
  const catalogo = await listarProdutos();
  const mapa = await listarInfoProdutos();
  const semVinculo = nomes.filter((nomeRecebido) => {
    const nome = catalogo.find((produto) => chaveProduto(produto) === chaveProduto(nomeRecebido));
    const info = nome ? mapa[chaveProduto(nome)] : undefined;
    return Boolean(nome && !info?.fotoUrl && !info?.idsTiny?.length);
  });
  if (semVinculo.length > 1) throw new Error("Para proteger o limite do Tiny, envie apenas um produto sem ID por lote.");
  const resultados: ResultadoImportacaoFoto[] = [];

  for (const nomeRecebido of nomes) {
    const nome = catalogo.find((produto) => chaveProduto(produto) === chaveProduto(nomeRecebido));
    if (!nome) {
      resultados.push({ nome: nomeRecebido, status: "erro", mensagem: "Produto não está no catálogo do Estoque." });
      continue;
    }

    const atual = mapa[chaveProduto(nome)];
    if (atual?.fotoStatus === "ok" && atual.fotoUrl) {
      resultados.push({ nome, status: "ja-tinha-foto" });
      continue;
    }

    let idsTiny = atual?.idsTiny ?? [];
    let codigos = atual?.codigos ?? [];
    try {
      if (idsTiny.length === 0) {
        const correspondencias = await encontrarProdutosTinyPorNome(nome);
        idsTiny = [...new Set(correspondencias.flatMap((produto) => produto.idsTiny))];
        codigos = [...new Set(correspondencias.flatMap((produto) => produto.codigos))];
        if (idsTiny.length === 0) {
          const mensagem = "Não encontrei um produto com nome correspondente no Tiny.";
          await gravarResultadoFoto(nome, { idsTiny, codigos, fotoStatus: "nao-encontrado", fotoErro: mensagem });
          resultados.push({ nome, status: "sem-vinculo", mensagem });
          continue;
        }
      }

      let fotoUrl: string | undefined;
      for (const id of idsTiny) {
        const detalhe = await tinyGet<ProdutoDetalheTiny>("produto.obter.php", { id });
        const produto = detalhe.retorno?.produto;
        if (detalhe.retorno?.status !== "OK" || !produto) {
          const motivo = detalhe.retorno?.erros?.map((item) => item.erro).filter(Boolean).join("; ");
          throw new Error(motivo || "O Tiny não conseguiu abrir os dados deste produto.");
        }
        for (const url of urlImagensProduto(produto)) {
          try {
            fotoUrl = await salvarImagemRemota(url, PASTA_CLOUDINARY, `${slug(nome)}-tiny`);
            break;
          } catch (error) {
            if (error instanceof CloudinaryConfigError) throw error;
            // Um anexo pode ser documento ou estar indisponível; tenta a próxima imagem do produto.
          }
        }
        if (fotoUrl) break;
      }

      if (!fotoUrl) {
        const mensagem = "O Tiny não retornou uma imagem acessível para este produto.";
        await gravarResultadoFoto(nome, { idsTiny, codigos, fotoStatus: "sem-foto", fotoErro: mensagem });
        resultados.push({ nome, status: "sem-imagem", mensagem });
        continue;
      }

      await gravarResultadoFoto(nome, { idsTiny, codigos, fotoStatus: "ok", fotoUrl, fotoOrigem: "tiny" });
      resultados.push({ nome, status: "importada" });
    } catch (error) {
      if (error instanceof OlistConfigError || error instanceof CloudinaryConfigError || error instanceof StoreConfigError) throw error;
      const mensagem = error instanceof Error ? error.message : "Falha ao consultar o Tiny.";
      await gravarResultadoFoto(nome, { idsTiny, codigos, fotoStatus: "erro", fotoErro: mensagem });
      resultados.push({ nome, status: "erro", mensagem });
    }
  }

  return resultados;
}

/**
 * Depois de "Separar por voltagem": os produtos novos herdam a foto do original (é o mesmo produto,
 * só muda a voltagem). Quem já tinha foto própria não muda.
 */
export async function copiarFotoParaProdutos(original: string, novos: string[]): Promise<void> {
  const mapa = await listarInfoProdutos();
  const origem = mapa[chaveProduto(original)];
  if (!origem?.fotoUrl || origem.fotoStatus !== "ok") {
    await registrarInfoProdutos(novos.map((nome) => ({ nome })));
    return;
  }
  await store.update<Record<string, InfoProduto>>(CHAVE_INFO, (atual) => {
    const copia = { ...(atual ?? {}) };
    for (const nome of novos) {
      const k = chaveProduto(nome);
      if (copia[k]?.fotoStatus === "ok" && copia[k]?.fotoUrl) continue;
      copia[k] = {
        nome,
        idsTiny: [],
        codigos: [],
        fotoUrl: origem.fotoUrl,
        fotoStatus: "ok",
        fotoOrigem: origem.fotoOrigem,
        fotoAtualizadaEm: new Date().toISOString(),
      };
    }
    return copia;
  });
}

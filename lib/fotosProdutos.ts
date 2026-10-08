import { tinyGet } from "./tinyClient";
import { isConfigured } from "./olist";
import * as store from "./store";
import { listarProdutos, salvarImagemRemota } from "./estoque";
import { nomeSemVoltagem } from "./catalogoTiny";

/**
 * Foto de cada produto do catálogo do Estoque, puxada do cadastro do Tiny e guardada no Cloudinary
 * (o link do anexo no Tiny pode expirar; o do Cloudinary não).
 *
 * Como acha o produto no Tiny:
 * - Importado pela busca do Tiny → já vem com os IDs (`idsTiny`).
 * - Cadastrado à mão / colado → procura pelo nome (`produtos.pesquisa.php`) e usa o resultado cujo
 *   nome (sem voltagem) bate; se nenhum bater exatamente, usa o primeiro.
 * Depois abre o produto (`produto.obter.php`) e pega a primeira imagem (`anexos` ou
 * `imagens_externas`); variação sem imagem própria cai pra imagem do produto pai.
 *
 * Roda em segundo plano (server/index.ts), poucos produtos por ciclo, pra não disputar o limite de
 * taxa do Tiny com o Painel/Embalagem/Compras. Limite de taxa só pausa o ciclo.
 */

const CHAVE_INFO = "estoque:produtosInfo";
const PASTA_CLOUDINARY = "llelle-produtos";
const PRODUTOS_POR_CICLO = 4;
const INTERVALO_ENTRE_CHAMADAS_MS = 400;
const LIMITE_TAXA_ERROR_CODE = 6;

export type StatusFoto = "pendente" | "ok" | "sem-foto" | "nao-encontrado" | "erro";

export interface InfoProduto {
  nome: string;
  idsTiny: string[];
  codigos: string[];
  fotoUrl?: string;
  fotoStatus: StatusFoto;
  /** "manual" = trocada por alguém no sistema — a busca automática do Tiny nunca sobrescreve. */
  fotoOrigem?: "tiny" | "manual";
  fotoErro?: string;
  fotoAtualizadaEm?: string;
}

export function chaveProduto(nome: string): string {
  return nome.trim().replace(/\s+/g, " ").toLowerCase();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

/** Guarda IDs/códigos do Tiny dos produtos importados e deixa a foto deles pendente. */
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
        // Quem já tem foto (do Tiny ou trocada à mão) mantém exatamente a mesma — inclusive a origem.
        ...(temFoto ? { fotoUrl: existente.fotoUrl, fotoStatus: "ok" as const, fotoOrigem: existente.fotoOrigem, fotoAtualizadaEm: existente.fotoAtualizadaEm } : { fotoStatus: "pendente" as const }),
      };
    }
    return mapa;
  });
}

/**
 * Botão "Buscar fotos no Tiny": marca como pendente todo produto do catálogo que ainda não tem foto
 * (inclusive os que antes deram "não encontrado"/"sem foto"/erro — pode ter mudado no Tiny).
 * Devolve quantos ficaram na fila.
 */
export async function solicitarFotosFaltantes(): Promise<number> {
  const catalogo = await listarProdutos();
  let pendentes = 0;
  await store.update<Record<string, InfoProduto>>(CHAVE_INFO, (atual) => {
    const mapa = { ...(atual ?? {}) };
    for (const nome of catalogo) {
      const k = chaveProduto(nome);
      const info = mapa[k];
      if (info?.fotoStatus === "ok" && info.fotoUrl) continue;
      mapa[k] = { nome, idsTiny: info?.idsTiny ?? [], codigos: info?.codigos ?? [], fotoStatus: "pendente" };
      pendentes++;
    }
    return mapa;
  });
  return pendentes;
}

// ---------- Tiny ----------

interface RetornoBase {
  status: string;
  codigo_erro?: number | string;
  erros?: { erro: string }[];
}

class LimiteTaxa extends Error {}

function checar(retorno: RetornoBase): boolean {
  if (retorno.status === "OK") return true;
  if (Number(retorno.codigo_erro) === LIMITE_TAXA_ERROR_CODE) throw new LimiteTaxa();
  return false;
}

interface PesquisaResponse {
  retorno: RetornoBase & { produtos?: { produto: { id?: string | number; nome?: string } }[] };
}

interface ObterResponse {
  retorno: RetornoBase & {
    produto?: {
      idProdutoPai?: string | number;
      anexos?: { anexo?: string }[];
      imagens_externas?: { imagem_externa?: { url?: string } }[];
    };
  };
}

async function idPorNome(nome: string): Promise<string | null> {
  const { retorno } = await tinyGet<PesquisaResponse>("produtos.pesquisa.php", { pesquisa: nome, situacao: "A" });
  if (!checar(retorno)) return null;
  const produtos = (retorno.produtos ?? []).map((p) => p.produto).filter((p) => p.id);
  // Nome exato primeiro (cada cor+voltagem é um produto); depois sem a voltagem (produto cadastrado à
  // mão sem a voltagem no nome); por último o primeiro resultado.
  const alvo = chaveProduto(nome);
  const exato = produtos.find((p) => chaveProduto(p.nome ?? "") === alvo);
  const semVoltagem = produtos.find((p) => chaveProduto(nomeSemVoltagem(p.nome ?? "")) === chaveProduto(nomeSemVoltagem(nome)));
  const escolhido = exato ?? semVoltagem ?? produtos[0];
  return escolhido ? String(escolhido.id) : null;
}

async function imagemDoProduto(id: string, profundidade = 0): Promise<string | null> {
  const { retorno } = await tinyGet<ObterResponse>("produto.obter.php", { id });
  if (!checar(retorno) || !retorno.produto) return null;
  const anexo = retorno.produto.anexos?.map((a) => a.anexo).find((u) => u && /^https?:\/\//.test(u));
  const externa = retorno.produto.imagens_externas?.map((i) => i.imagem_externa?.url).find((u) => u && /^https?:\/\//.test(u));
  const url = anexo ?? externa ?? null;
  if (url) return url;
  // Variação sem imagem própria → tenta a imagem do produto pai.
  const pai = retorno.produto.idProdutoPai;
  if (pai && String(pai) !== "0" && profundidade === 0) {
    await sleep(INTERVALO_ENTRE_CHAMADAS_MS);
    return imagemDoProduto(String(pai), 1);
  }
  return null;
}

async function resolverFoto(info: InfoProduto): Promise<InfoProduto> {
  const agora = new Date().toISOString();
  let ids = info.idsTiny;
  if (ids.length === 0) {
    const id = await idPorNome(info.nome);
    if (!id) return { ...info, fotoStatus: "nao-encontrado", fotoAtualizadaEm: agora };
    ids = [id];
    await sleep(INTERVALO_ENTRE_CHAMADAS_MS);
  }
  for (const id of ids.slice(0, 3)) {
    const url = await imagemDoProduto(id);
    if (url) {
      const fotoUrl = await salvarImagemRemota(url, PASTA_CLOUDINARY, slug(info.nome));
      return { ...info, idsTiny: ids, fotoUrl, fotoStatus: "ok", fotoOrigem: "tiny", fotoErro: undefined, fotoAtualizadaEm: agora };
    }
    await sleep(INTERVALO_ENTRE_CHAMADAS_MS);
  }
  return { ...info, idsTiny: ids, fotoStatus: "sem-foto", fotoAtualizadaEm: agora };
}

let rodando = false;

/** Um ciclo: resolve a foto de até PRODUTOS_POR_CICLO produtos pendentes. */
export async function tickFotosProdutos(): Promise<void> {
  if (rodando || !isConfigured()) return;
  rodando = true;
  try {
    const mapa = await listarInfoProdutos();
    const pendentes = Object.values(mapa)
      .filter((i) => i.fotoStatus === "pendente")
      .slice(0, PRODUTOS_POR_CICLO);
    for (const info of pendentes) {
      let atualizado: InfoProduto;
      try {
        atualizado = await resolverFoto(info);
      } catch (error) {
        if (error instanceof LimiteTaxa) return; // continua no próximo ciclo
        atualizado = { ...info, fotoStatus: "erro", fotoErro: error instanceof Error ? error.message : String(error), fotoAtualizadaEm: new Date().toISOString() };
      }
      await store.update<Record<string, InfoProduto>>(CHAVE_INFO, (atual) => ({ ...(atual ?? {}), [chaveProduto(info.nome)]: atualizado }));
      await sleep(INTERVALO_ENTRE_CHAMADAS_MS);
    }
  } finally {
    rodando = false;
  }
}

// ---------- Troca manual ----------

/**
 * "Trocar foto": sobe a foto escolhida (data URI) pro Cloudinary e marca como manual — a partir daí
 * a busca automática do Tiny não mexe mais nela (o job só processa "pendente", e "Buscar fotos no
 * Tiny" pula quem já tem foto).
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

/** "Usar foto do Tiny": descarta a foto atual (manual ou não) e coloca o produto na fila de novo. */
export async function refazerFotoDoTiny(nome: string): Promise<void> {
  const k = chaveProduto(nome);
  if (!k) throw new Error("Informe o produto.");
  await store.update<Record<string, InfoProduto>>(CHAVE_INFO, (atual) => {
    const mapa = { ...(atual ?? {}) };
    const existente = mapa[k];
    mapa[k] = { nome: existente?.nome ?? nome.trim(), idsTiny: existente?.idsTiny ?? [], codigos: existente?.codigos ?? [], fotoStatus: "pendente" };
    return mapa;
  });
}

/**
 * Depois de "Separar por voltagem": os produtos novos herdam a foto do original (é o mesmo produto,
 * só muda a voltagem) — assim os cards não ficam sem foto. Quem já tinha foto própria não muda.
 */
export async function copiarFotoParaProdutos(original: string, novos: string[]): Promise<void> {
  const mapa = await listarInfoProdutos();
  const origem = mapa[chaveProduto(original)];
  if (!origem?.fotoUrl || origem.fotoStatus !== "ok") {
    // Original sem foto: os novos entram na fila da busca do Tiny pelo nome deles.
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

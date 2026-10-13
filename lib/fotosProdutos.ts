import * as store from "./store";
import { salvarImagemRemota } from "./estoque";

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

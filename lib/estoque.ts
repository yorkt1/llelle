import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import * as store from "./store";

/**
 * Registro do galpão organizado como a estrutura física real: Rua (letra) > Posição/longarina
 * (código, ex.: "A5"). Cada posição guarda um HISTÓRICO de contagens — nunca sobrescreve, só
 * acrescenta — pra dar pra ver a evolução ao longo do tempo, não só o valor mais recente.
 *
 * Foto fica como arquivo separado em `<DATA_DIR>/estoque-fotos/`, não dentro do JSON do store —
 * mantém o arquivo de metadados pequeno e rápido de ler/escrever a cada contagem. O nome do
 * arquivo é o único vínculo entre os dois.
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
  /** Nome do arquivo em `<DATA_DIR>/estoque-fotos/`. */
  fotoArquivo: string;
  criadoEm: string;
}

type HistoricoPorPosicao = Record<string, RegistroContagem[]>; // chave: "RUA::CODIGO", mais recente primeiro

export interface PosicaoResumo {
  rua: string;
  codigo: string;
  ultima: RegistroContagem;
}

export interface RuaResumo {
  rua: string;
  posicoes: PosicaoResumo[];
}

const CHAVE_STORE = "estoque";
const FOTOS_SUBDIR = "estoque-fotos";

function normalizar(texto: string): string {
  return texto.trim().toUpperCase();
}

function chave(rua: string, codigo: string): string {
  return `${normalizar(rua)}::${normalizar(codigo)}`;
}

function pastaFotos(): string {
  // path.resolve (não path.join) de propósito: store.dataDir() cai em "./data" (relativo) quando
  // DATA_DIR não está configurado, e o res.sendFile da rota de foto EXIGE caminho absoluto — sem
  // isso, ele lança um erro síncrono (não dá 404 "não encontrada", dá 500 de verdade).
  return path.resolve(store.dataDir(), FOTOS_SUBDIR);
}

export function caminhoDaFoto(arquivo: string): string {
  return path.join(pastaFotos(), arquivo);
}

export async function listarEstoque(): Promise<RuaResumo[]> {
  const tudo = (await store.get<HistoricoPorPosicao>(CHAVE_STORE)) ?? {};
  const porRua = new Map<string, PosicaoResumo[]>();

  for (const [chaveComposta, historico] of Object.entries(tudo)) {
    if (historico.length === 0) continue;
    const [rua, codigo] = chaveComposta.split("::");
    const lista = porRua.get(rua) ?? [];
    lista.push({ rua, codigo, ultima: historico[0] });
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

const FORMATOS_AUTORIZADOS = new Set(["jpeg", "jpg", "png", "webp"]);

async function salvarFoto(fotoDataUri: string): Promise<string> {
  const compatibilidade = fotoDataUri.match(/^data:image\/([a-zA-Z]+);base64,(.+)$/);
  if (!compatibilidade) throw new Error("Imagem em formato inválido (esperado data URI base64).");

  const [, formatoBruto, base64] = compatibilidade;
  const formato = formatoBruto.toLowerCase();
  if (!FORMATOS_AUTORIZADOS.has(formato)) throw new Error(`Formato de imagem não aceito: ${formato}`);

  const extensao = formato === "jpeg" ? "jpg" : formato;
  const arquivo = `${crypto.randomUUID()}.${extensao}`;
  await fs.mkdir(pastaFotos(), { recursive: true });
  await fs.writeFile(path.join(pastaFotos(), arquivo), Buffer.from(base64, "base64"));
  return arquivo;
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
}

export async function registrarContagem(params: RegistrarContagemParams): Promise<RegistroContagem> {
  const fotoArquivo = await salvarFoto(params.fotoDataUri);

  const registro: RegistroContagem = {
    id: crypto.randomUUID(),
    quantidade: params.quantidade,
    responsavel: params.responsavel,
    fotoArquivo,
    criadoEm: new Date().toISOString(),
  };

  const k = chave(params.rua, params.codigo);
  await store.update<HistoricoPorPosicao>(CHAVE_STORE, (atual) => {
    const tudo = atual ?? {};
    return { ...tudo, [k]: [registro, ...(tudo[k] ?? [])] };
  });

  return registro;
}

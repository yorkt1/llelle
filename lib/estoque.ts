import crypto from "node:crypto";
import { v2 as cloudinary } from "cloudinary";
import * as store from "./store";

/**
 * Registro do galpão organizado como a estrutura física real: Rua (letra) > Posição/longarina
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
const PASTA_CLOUDINARY = "llelle-estoque";

function normalizar(texto: string): string {
  return texto.trim().toUpperCase();
}

function chave(rua: string, codigo: string): string {
  return `${normalizar(rua)}::${normalizar(codigo)}`;
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
  const fotoUrl = await salvarFoto(params.fotoDataUri);

  const registro: RegistroContagem = {
    id: crypto.randomUUID(),
    quantidade: params.quantidade,
    responsavel: params.responsavel,
    fotoUrl,
    criadoEm: new Date().toISOString(),
  };

  const k = chave(params.rua, params.codigo);
  await store.update<HistoricoPorPosicao>(CHAVE_STORE, (atual) => {
    const tudo = atual ?? {};
    return { ...tudo, [k]: [registro, ...(tudo[k] ?? [])] };
  });

  return registro;
}

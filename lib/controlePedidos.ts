import * as store from "./store";

export const MARKETPLACES = [
  { key: "tiktok", nome: "TikTok Shop" },
  { key: "ml", nome: "Mercado Livre" },
  { key: "shopee", nome: "Shopee" },
] as const;

export const ETAPAS_PEDIDOS = ["recebidos", "separados", "embalados", "expedidos", "cancelados"] as const;
export const TURNOS = [
  { key: "manha", nome: "Turno manhã", horario: "06h – 12h" },
  { key: "tarde", nome: "Turno tarde", horario: "12h – 18h" },
] as const;

type Marketplace = (typeof MARKETPLACES)[number]["key"];
type EtapaPedido = (typeof ETAPAS_PEDIDOS)[number];
type Turno = (typeof TURNOS)[number]["key"];

export interface DadosMarketplace {
  recebidos: number;
  separados: number;
  embalados: number;
  expedidos: number;
  cancelados: number;
}

export interface DadosTurno {
  resp: string;
  obs: string;
  tiktok: DadosMarketplace;
  ml: DadosMarketplace;
  shopee: DadosMarketplace;
}

export interface DiaPedidos {
  data: string;
  atualizado: string;
  manha: DadosTurno;
  tarde: DadosTurno;
}

interface DadosTurnoPersistidos extends DadosTurno {
  /** Marcação interna para filtrar/auditar registros do Tiago sem expô-la na tela. */
  doTiago: boolean;
}

interface DiaPedidosPersistido extends Omit<DiaPedidos, "manha" | "tarde"> {
  manha: DadosTurnoPersistidos;
  tarde: DadosTurnoPersistidos;
}

type DiasPedidos = Record<string, DiaPedidosPersistido>;
const CHAVE_DIAS = "controle-pedidos:dias";

function numeroSeguro(value: unknown): number {
  const numero = Number(value);
  return Number.isFinite(numero) && numero >= 0 ? Math.floor(numero) : 0;
}

function novoMarketplace(value?: Partial<DadosMarketplace>): DadosMarketplace {
  return {
    recebidos: numeroSeguro(value?.recebidos),
    separados: numeroSeguro(value?.separados),
    embalados: numeroSeguro(value?.embalados),
    expedidos: numeroSeguro(value?.expedidos),
    cancelados: numeroSeguro(value?.cancelados),
  };
}

function ehTiago(responsavel: string): boolean {
  const nome = responsavel
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR");
  return /^tiago(?:\s|$)/.test(nome);
}

function normalizarTurno(value?: Partial<DadosTurno>): DadosTurno {
  return {
    resp: typeof value?.resp === "string" ? value.resp.slice(0, 120) : "",
    obs: typeof value?.obs === "string" ? value.obs.slice(0, 4000) : "",
    tiktok: novoMarketplace(value?.tiktok),
    ml: novoMarketplace(value?.ml),
    shopee: novoMarketplace(value?.shopee),
  };
}

function semMarcacaoInterna(turno: DadosTurnoPersistidos): DadosTurno {
  return {
    resp: turno.resp,
    obs: turno.obs,
    tiktok: turno.tiktok,
    ml: turno.ml,
    shopee: turno.shopee,
  };
}

function apresentacao(dia: DiaPedidosPersistido): DiaPedidos {
  return { data: dia.data, atualizado: dia.atualizado, manha: semMarcacaoInterna(dia.manha), tarde: semMarcacaoInterna(dia.tarde) };
}

function validarData(data: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) throw new Error("Data inválida; use o formato AAAA-MM-DD.");
  const dataUtc = new Date(`${data}T00:00:00Z`);
  if (Number.isNaN(dataUtc.getTime()) || dataUtc.toISOString().slice(0, 10) !== data) {
    throw new Error("Data inválida; use o formato AAAA-MM-DD.");
  }
}

export async function obterDiaPedidos(data: string): Promise<DiaPedidos | null> {
  validarData(data);
  const dias = (await store.get<DiasPedidos>(CHAVE_DIAS)) ?? {};
  const dia = dias[data];
  return dia ? apresentacao(dia) : null;
}

export async function salvarDiaPedidos(data: string, entrada: Partial<DiaPedidos>): Promise<DiaPedidos> {
  validarData(data);
  let salvo!: DiaPedidos;
  await store.update<DiasPedidos>(CHAVE_DIAS, (atual) => {
    const manha = normalizarTurno(entrada.manha);
    const tarde = normalizarTurno(entrada.tarde);
    const registro: DiaPedidosPersistido = {
      data,
      atualizado: new Date().toISOString(),
      manha: { ...manha, doTiago: ehTiago(manha.resp) },
      tarde: { ...tarde, doTiago: ehTiago(tarde.resp) },
    };
    const dias = { ...(atual ?? {}), [data]: registro };
    salvo = apresentacao(registro);
    return dias;
  });
  return salvo;
}

export async function listarDiasPedidos(limite = 14): Promise<DiaPedidos[]> {
  const dias = (await store.get<DiasPedidos>(CHAVE_DIAS)) ?? {};
  const quantidade = Math.min(60, Math.max(1, Math.floor(numeroSeguro(limite)) || 14));
  return Object.values(dias)
    .sort((a, b) => b.data.localeCompare(a.data))
    .slice(0, quantidade)
    .map(apresentacao);
}

export function pedidoPendente(dados: DadosMarketplace): number {
  return dados.recebidos - dados.expedidos - dados.cancelados;
}

export type { Marketplace, EtapaPedido, Turno };

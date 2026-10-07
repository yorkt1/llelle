import * as store from "./store";
import { diasDaJanela, estoqueAtual, statusColeta, vendasPorCodigoNoPeriodo, type EstoqueProduto, type StatusColeta, type VendaProduto } from "./vendasSync";

/**
 * Planejamento de compra por produto, a partir das vendas e do estoque coletados do Tiny
 * (lib/vendasSync.ts) + parâmetros definidos pela equipe (prazo de importação, estoque de
 * segurança, quanto tempo cada compra deve cobrir).
 *
 * Conta, por produto:
 *   vendaDia        = média de unidades vendidas por dia (últimos 30 dias coletados; se ainda não
 *                     tem 30, usa o que tiver — o campo `diasBase` diz quantos)
 *   disponivel      = saldo no Tiny − reservado
 *   coberturaDias   = disponivel / vendaDia          (quantos dias o estoque aguenta)
 *   pontoDePedido   = vendaDia × (prazo + segurança) (abaixo disso, já devia ter comprado)
 *   sugestao        = vendaDia × (prazo + cobertura + segurança) − (disponivel + emTransito)
 *
 * É apoio à decisão, não ordem de compra: sazonalidade, promoções e lote mínimo do fornecedor não
 * entram na conta.
 */

const CHAVE_PARAMETROS = "compras:parametros";
const CHAVE_POR_PRODUTO = "compras:porProduto";
const DIAS_MEDIA = 30;

export interface ParametrosCompra {
  /** Dias entre fazer o pedido ao fornecedor e a mercadoria estar disponível pra venda. */
  prazoDias: number;
  /** Dias de venda guardados como margem (atraso de contêiner, pico de venda). */
  segurancaDias: number;
  /** Quantos dias de venda cada compra deve cobrir depois que chega. */
  coberturaDias: number;
}

export const PARAMETROS_PADRAO: ParametrosCompra = { prazoDias: 90, segurancaDias: 30, coberturaDias: 90 };

export interface ConfigProduto {
  emTransito?: number;
  prazoDias?: number;
  ignorar?: boolean;
}

export type StatusCompra = "comprar" | "atencao" | "ok" | "excesso" | "sem-venda";

export interface LinhaPlanejamento {
  chave: string;
  codigo: string;
  produto: string;
  vendaDia: number;
  vendaPeriodo: number;
  disponivel: number | null;
  emTransito: number;
  prazoDias: number;
  coberturaDias: number | null;
  rupturaPrevista: string | null;
  pontoDePedido: number;
  sugestao: number;
  /** Valor estimado da sugestão, pelo preço médio de venda — só ordem de grandeza (não é custo). */
  valorVendaSugestao: number;
  status: StatusCompra;
  ignorado: boolean;
  estoqueAtualizadoEm: string | null;
}

export interface Planejamento {
  parametros: ParametrosCompra;
  coleta: StatusColeta;
  diasBase: number;
  linhas: LinhaPlanejamento[];
}

export async function obterParametros(): Promise<ParametrosCompra> {
  return { ...PARAMETROS_PADRAO, ...((await store.get<Partial<ParametrosCompra>>(CHAVE_PARAMETROS)) ?? {}) };
}

function inteiroValido(valor: unknown, min: number, max: number): number | undefined {
  const n = Number(valor);
  return Number.isFinite(n) && n >= min && n <= max ? Math.round(n) : undefined;
}

export async function salvarParametros(entrada: Partial<ParametrosCompra>): Promise<ParametrosCompra> {
  const atual = await obterParametros();
  const novo: ParametrosCompra = {
    prazoDias: inteiroValido(entrada.prazoDias, 1, 730) ?? atual.prazoDias,
    segurancaDias: inteiroValido(entrada.segurancaDias, 0, 365) ?? atual.segurancaDias,
    coberturaDias: inteiroValido(entrada.coberturaDias, 1, 730) ?? atual.coberturaDias,
  };
  await store.set(CHAVE_PARAMETROS, novo);
  return novo;
}

export async function salvarConfigProduto(chave: string, entrada: ConfigProduto): Promise<ConfigProduto> {
  const limpo: ConfigProduto = {
    emTransito: inteiroValido(entrada.emTransito, 0, 10_000_000),
    prazoDias: inteiroValido(entrada.prazoDias, 1, 730),
    ignorar: entrada.ignorar === true ? true : undefined,
  };
  await store.update<Record<string, ConfigProduto>>(CHAVE_POR_PRODUTO, (atual) => ({ ...(atual ?? {}), [chave]: limpo }));
  return limpo;
}

function somarDias(iso: string, dias: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + Math.floor(dias));
  return d.toISOString().slice(0, 10);
}

/** Cálculo puro (sem I/O) — exportado pros testes. */
export function calcularLinha(
  chave: string,
  venda: VendaProduto,
  diasBase: number,
  estoque: EstoqueProduto | undefined,
  config: ConfigProduto,
  parametros: ParametrosCompra,
  hojeIso: string,
): LinhaPlanejamento {
  const vendaDia = diasBase > 0 ? venda.quantidade / diasBase : 0;
  const disponivel = estoque ? Math.max(0, estoque.saldo - estoque.reservado) : null;
  const emTransito = config.emTransito ?? 0;
  const prazoDias = config.prazoDias ?? parametros.prazoDias;
  const coberturaDias = disponivel !== null && vendaDia > 0 ? disponivel / vendaDia : null;
  const pontoDePedido = Math.ceil(vendaDia * (prazoDias + parametros.segurancaDias));
  const alvo = vendaDia * (prazoDias + parametros.coberturaDias + parametros.segurancaDias);
  const sugestao = disponivel === null ? 0 : Math.max(0, Math.ceil(alvo - disponivel - emTransito));
  const precoMedio = venda.quantidade > 0 ? venda.valor / venda.quantidade : 0;

  let status: StatusCompra;
  if (vendaDia === 0) status = "sem-venda";
  else if (disponivel === null) status = "ok";
  else {
    const posicao = disponivel + emTransito;
    if (posicao <= pontoDePedido) status = "comprar";
    else if (posicao <= pontoDePedido + vendaDia * 30) status = "atencao";
    else if (posicao > alvo * 1.5) status = "excesso";
    else status = "ok";
  }

  return {
    chave,
    codigo: estoque?.codigo || (chave.startsWith("id:") || chave.startsWith("desc:") ? "" : chave),
    produto: estoque?.nome || venda.descricao,
    vendaDia,
    vendaPeriodo: venda.quantidade,
    disponivel,
    emTransito,
    prazoDias,
    coberturaDias,
    rupturaPrevista: coberturaDias !== null ? somarDias(hojeIso, coberturaDias) : null,
    pontoDePedido,
    sugestao,
    valorVendaSugestao: sugestao * precoMedio,
    status,
    ignorado: config.ignorar === true,
    estoqueAtualizadoEm: estoque?.atualizadoEm ?? null,
  };
}

export async function montarPlanejamento(): Promise<Planejamento> {
  const [parametros, coleta, estoque, configs] = await Promise.all([
    obterParametros(),
    statusColeta(),
    estoqueAtual(),
    store.get<Record<string, ConfigProduto>>(CHAVE_POR_PRODUTO).then((c) => c ?? {}),
  ]);

  const janela = diasDaJanela(); // de ontem pra trás
  const ultimos = janela.slice(0, DIAS_MEDIA);
  const vendas = await vendasPorCodigoNoPeriodo(ultimos[ultimos.length - 1], ultimos[0]);
  const hojeIso = janela.length > 0 ? somarDias(janela[0], 1) : new Date().toISOString().slice(0, 10);

  const linhas = Object.entries(vendas.porProduto)
    .map(([chave, venda]) => calcularLinha(chave, venda, vendas.diasComDados, estoque[chave], configs[chave] ?? {}, parametros, hojeIso))
    .sort((a, b) => b.vendaDia - a.vendaDia);

  return { parametros, coleta, diasBase: vendas.diasComDados, linhas };
}

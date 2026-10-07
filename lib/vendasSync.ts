import { tinyGet } from "./tinyClient";
import { daysAgoInSaoPaulo, isConfigured } from "./olist";
import * as store from "./store";

/**
 * Coleta, em segundo plano e devagar, as VENDAS por produto por dia e o ESTOQUE atual de cada
 * produto vendido — base do Planejamento de compra (lib/compras.ts) e da taxa de devolução por
 * produto (aba Histórico de Devoluções).
 *
 * Por que devagar: a API 2.0 do Tiny não tem "vendas por produto". O único caminho é listar os
 * pedidos do dia (`pedidos.pesquisa.php`, ~100 por página) e abrir CADA pedido
 * (`pedido.obter.php`) pra ver os itens — 1 chamada por pedido, ~630 por dia no volume atual. E o
 * limite de taxa do Tiny já é disputado pelos syncs do Painel e da Embalagem (ver server/index.ts).
 * Então cada "tick" (chamado pelo server/index.ts a cada minuto) faz no máximo `maxPorTick`
 * chamadas, com respiro entre elas, e guarda o progresso — um dia de pedidos leva ~15–20 min pra
 * ser coletado, e a janela inteira (90 dias por padrão) ~1 dia na primeira vez. Depois disso, só o
 * dia anterior é coletado a cada dia.
 *
 * Os dias mais RECENTES são coletados primeiro — com poucas horas de coleta o planejamento já tem
 * a última semana pra calcular a venda média, e vai ficando mais preciso conforme a janela enche.
 *
 * Pedidos com situação "cancelado" não entram. O dia de HOJE nunca é coletado (está incompleto):
 * a janela vai de ontem pra trás.
 */

const CHAVE_ESTADO = "vendas:sync";
const PREFIXO_VENDAS = "vendas:dia:"; // + AAAA-MM → { [diaIso]: { [chaveProduto]: VendaProduto } }
const CHAVE_ESTOQUE = "vendas:estoque";

const SEM_REGISTROS_ERROR_CODE = 32;
const LIMITE_TAXA_ERROR_CODE = 6;
const ESTOQUE_VALIDADE_MS = 20 * 60 * 60 * 1000; // re-consulta o saldo de cada produto ~1x por dia
const ESTOQUE_POR_TICK = 8;

function janelaDias(): number {
  return Number(process.env.VENDAS_JANELA_DIAS ?? 90);
}

function maxPorTick(): number {
  return Number(process.env.VENDAS_MAX_POR_TICK ?? 40);
}

function intervaloEntreChamadasMs(): number {
  return Number(process.env.VENDAS_INTERVALO_MS ?? 400);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface VendaProduto {
  quantidade: number;
  descricao: string;
  idProduto?: string;
  /** Soma de quantidade × valor unitário — permite estimar valor parado/necessário. */
  valor: number;
}

type VendasDoDia = Record<string, VendaProduto>;

interface EstadoSync {
  diasConcluidos: string[];
  emAndamento?: { dia: string; idsPendentes: string[]; totalPedidos: number; parcial: VendasDoDia };
  ultimoErro?: string;
  atualizadoEm?: string;
}

export interface EstoqueProduto {
  idProduto: string;
  codigo: string;
  nome: string;
  saldo: number;
  reservado: number;
  atualizadoEm: string;
}

export class LimiteTaxaTinyError extends Error {
  constructor() {
    super("Tiny limitou as chamadas agora — a coleta continua no próximo ciclo.");
    this.name = "LimiteTaxaTinyError";
  }
}

interface RetornoBase {
  status: string;
  codigo_erro?: number | string;
  erros?: { erro: string }[];
}

function verificarRetorno(retorno: RetornoBase): "ok" | "vazio" {
  if (retorno.status === "OK") return "ok";
  const codigo = Number(retorno.codigo_erro);
  if (codigo === SEM_REGISTROS_ERROR_CODE) return "vazio";
  if (codigo === LIMITE_TAXA_ERROR_CODE) throw new LimiteTaxaTinyError();
  throw new Error(retorno.erros?.map((e) => e.erro).join("; ") || "Tiny recusou a consulta.");
}

/** "aaaa-mm-dd" → "dd/mm/aaaa" */
function isoParaBr(iso: string): string {
  const [ano, mes, dia] = iso.split("-");
  return `${dia}/${mes}/${ano}`;
}

/** "dd/mm/aaaa" → "aaaa-mm-dd" */
function brParaIso(br: string): string {
  const [dia, mes, ano] = br.split("/");
  return `${ano}-${mes}-${dia}`;
}

/** Dias da janela, de ontem pra trás (ISO). */
export function diasDaJanela(): string[] {
  const dias: string[] = [];
  for (let n = 1; n <= janelaDias(); n++) dias.push(brParaIso(daysAgoInSaoPaulo(n)));
  return dias;
}

function normaliza(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/** SKU quando o item tem; senão o id do produto; senão a descrição — sempre a mesma chave pro mesmo produto. */
export function chaveProduto(item: { codigo?: string; id_produto?: string | number; descricao?: string }): string {
  const codigo = String(item.codigo ?? "").trim();
  if (codigo) return codigo;
  const id = String(item.id_produto ?? "").trim();
  if (id) return `id:${id}`;
  return `desc:${(item.descricao ?? "").trim().toUpperCase()}`;
}

// ---------- Tiny ----------

interface PedidosPesquisaResponse {
  retorno: RetornoBase & { numero_paginas?: number; pedidos?: { pedido: { id: string | number; situacao?: string } }[] };
}

async function listarIdsPedidosDoDia(diaIso: string): Promise<string[]> {
  const data = isoParaBr(diaIso);
  const ids: string[] = [];
  let pagina = 1;
  let totalPaginas = 1;
  do {
    const { retorno } = await tinyGet<PedidosPesquisaResponse>("pedidos.pesquisa.php", { dataInicial: data, dataFinal: data, pagina: String(pagina) });
    if (verificarRetorno(retorno) === "vazio") break;
    for (const { pedido } of retorno.pedidos ?? []) {
      if (normaliza(pedido.situacao ?? "").includes("cancel")) continue;
      ids.push(String(pedido.id));
    }
    totalPaginas = retorno.numero_paginas ?? 1;
    pagina++;
    if (pagina <= totalPaginas) await sleep(intervaloEntreChamadasMs());
  } while (pagina <= totalPaginas);
  return ids;
}

interface ItemPedidoTiny {
  id_produto?: string | number;
  codigo?: string;
  descricao?: string;
  quantidade?: string | number;
  valor_unitario?: string | number;
}

interface PedidoObterResponse {
  retorno: RetornoBase & { pedido?: { situacao?: string; itens?: { item?: ItemPedidoTiny }[] } };
}

function somarItens(destino: VendasDoDia, itens: { item?: ItemPedidoTiny }[]): void {
  for (const { item } of itens) {
    if (!item) continue;
    const chave = chaveProduto(item);
    const quantidade = Number(item.quantidade) || 0;
    const atual = destino[chave] ?? { quantidade: 0, descricao: item.descricao ?? "", valor: 0 };
    atual.quantidade += quantidade;
    atual.valor += quantidade * (Number(item.valor_unitario) || 0);
    if (!atual.descricao && item.descricao) atual.descricao = item.descricao;
    if (item.id_produto) atual.idProduto = String(item.id_produto);
    destino[chave] = atual;
  }
}

interface EstoqueObterResponse {
  retorno: RetornoBase & {
    produto?: { id?: string | number; nome?: string; codigo?: string; saldo?: string | number; saldoReservado?: string | number };
  };
}

// ---------- Tick ----------

let rodando = false;

/**
 * Um ciclo de coleta: atualiza alguns saldos de estoque vencidos e depois avança na coleta de
 * pedidos, até `maxPorTick` chamadas no total. Nunca roda dois ao mesmo tempo. Limite de taxa do
 * Tiny não é erro: salva o que já tinha e para, o próximo ciclo continua dali.
 */
export async function tickVendas(): Promise<void> {
  if (rodando || !isConfigured()) return;
  rodando = true;
  const estado: EstadoSync = (await store.get<EstadoSync>(CHAVE_ESTADO)) ?? { diasConcluidos: [] };
  let orcamento = maxPorTick();
  try {
    orcamento -= await atualizarEstoques(Math.min(ESTOQUE_POR_TICK, orcamento));
    await coletarPedidos(estado, orcamento);
    estado.ultimoErro = undefined;
  } catch (error) {
    estado.ultimoErro = error instanceof LimiteTaxaTinyError ? undefined : error instanceof Error ? error.message : String(error);
  } finally {
    estado.atualizadoEm = new Date().toISOString();
    await store.set(CHAVE_ESTADO, estado);
    rodando = false;
  }
}

async function coletarPedidos(estado: EstadoSync, orcamento: number): Promise<void> {
  const concluidos = new Set(estado.diasConcluidos);
  while (orcamento > 0) {
    if (!estado.emAndamento) {
      const proximo = diasDaJanela().find((dia) => !concluidos.has(dia));
      if (!proximo) return; // janela completa — nada a fazer até virar o dia
      const ids = await listarIdsPedidosDoDia(proximo);
      orcamento -= Math.max(1, Math.ceil(ids.length / 100));
      estado.emAndamento = { dia: proximo, idsPendentes: ids, totalPedidos: ids.length, parcial: {} };
    }

    const andamento = estado.emAndamento;
    while (orcamento > 0 && andamento.idsPendentes.length > 0) {
      const id = andamento.idsPendentes[0];
      // Erro de rede/HTTP propaga (tickVendas encerra e o próximo ciclo tenta o MESMO pedido de
      // novo); só um "não" explícito do Tiny pra esse pedido faz pular ele — senão um pedido
      // problemático travaria a coleta pra sempre.
      const { retorno } = await tinyGet<PedidoObterResponse>("pedido.obter.php", { id });
      orcamento--;
      let situacaoRetorno: "ok" | "vazio" | "falhou";
      try {
        situacaoRetorno = verificarRetorno(retorno);
      } catch (error) {
        if (error instanceof LimiteTaxaTinyError) throw error;
        situacaoRetorno = "falhou";
      }
      if (situacaoRetorno === "ok" && !normaliza(retorno.pedido?.situacao ?? "").includes("cancel")) {
        somarItens(andamento.parcial, retorno.pedido?.itens ?? []);
      }
      andamento.idsPendentes.shift();
      if (andamento.idsPendentes.length > 0) await sleep(intervaloEntreChamadasMs());
    }

    if (andamento.idsPendentes.length === 0) {
      const mes = andamento.dia.slice(0, 7);
      await store.update<Record<string, VendasDoDia>>(PREFIXO_VENDAS + mes, (atual) => ({ ...(atual ?? {}), [andamento.dia]: andamento.parcial }));
      concluidos.add(andamento.dia);
      estado.diasConcluidos = [...concluidos].sort().reverse().slice(0, 400);
      estado.emAndamento = undefined;
    }
  }
}

/** Atualiza o saldo dos produtos já vistos em vendas cujo saldo está vencido. Devolve quantas chamadas fez. */
async function atualizarEstoques(limite: number): Promise<number> {
  if (limite <= 0) return 0;
  const estoque = (await store.get<Record<string, EstoqueProduto>>(CHAVE_ESTOQUE)) ?? {};
  const produtos = await produtosVendidosNaJanela();
  const agora = Date.now();
  const vencidos = produtos
    .filter((p) => p.idProduto)
    .filter((p) => {
      const atual = estoque[p.chave];
      return !atual || agora - new Date(atual.atualizadoEm).getTime() > ESTOQUE_VALIDADE_MS;
    })
    .slice(0, limite);

  let chamadas = 0;
  const novos: Record<string, EstoqueProduto> = {};
  try {
    for (const produto of vencidos) {
      const { retorno } = await tinyGet<EstoqueObterResponse>("produto.obter.estoque.php", { id: produto.idProduto! });
      chamadas++;
      if (verificarRetorno(retorno) === "ok" && retorno.produto) {
        novos[produto.chave] = {
          idProduto: produto.idProduto!,
          codigo: retorno.produto.codigo ?? "",
          nome: retorno.produto.nome ?? produto.descricao,
          saldo: Number(retorno.produto.saldo) || 0,
          reservado: Number(retorno.produto.saldoReservado) || 0,
          atualizadoEm: new Date().toISOString(),
        };
      }
      await sleep(intervaloEntreChamadasMs());
    }
  } finally {
    if (Object.keys(novos).length > 0) {
      await store.update<Record<string, EstoqueProduto>>(CHAVE_ESTOQUE, (atual) => ({ ...(atual ?? {}), ...novos }));
    }
  }
  return chamadas;
}

// ---------- Leitura ----------

function mesesDosDias(dias: string[]): string[] {
  return [...new Set(dias.map((d) => d.slice(0, 7)))];
}

/** Vendas por dia já coletadas entre `de` e `ate` (ISO, inclusive). Dias não coletados ficam de fora. */
export async function vendasPorDia(deIso: string, ateIso: string): Promise<Record<string, VendasDoDia>> {
  const dias: string[] = [];
  const cursor = new Date(`${deIso}T00:00:00Z`);
  const fim = new Date(`${ateIso}T00:00:00Z`);
  while (cursor <= fim && dias.length < 1000) {
    dias.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  const fatias = await Promise.all(mesesDosDias(dias).map((mes) => store.get<Record<string, VendasDoDia>>(PREFIXO_VENDAS + mes)));
  const resultado: Record<string, VendasDoDia> = {};
  for (const fatia of fatias) {
    for (const [dia, vendas] of Object.entries(fatia ?? {})) {
      if (dia >= deIso && dia <= ateIso) resultado[dia] = vendas;
    }
  }
  return resultado;
}

export interface VendasAgregadas {
  porProduto: Record<string, VendaProduto>;
  diasComDados: number;
  diasNoPeriodo: number;
}

export async function vendasPorCodigoNoPeriodo(deIso: string, ateIso: string): Promise<VendasAgregadas> {
  const porDia = await vendasPorDia(deIso, ateIso);
  const porProduto: Record<string, VendaProduto> = {};
  for (const vendas of Object.values(porDia)) {
    for (const [chave, venda] of Object.entries(vendas)) {
      const atual = porProduto[chave] ?? { quantidade: 0, descricao: venda.descricao, valor: 0, idProduto: venda.idProduto };
      atual.quantidade += venda.quantidade;
      atual.valor += venda.valor;
      porProduto[chave] = atual;
    }
  }
  const diasNoPeriodo = Math.round((new Date(`${ateIso}T00:00:00Z`).getTime() - new Date(`${deIso}T00:00:00Z`).getTime()) / 86_400_000) + 1;
  return { porProduto, diasComDados: Object.keys(porDia).length, diasNoPeriodo };
}

async function produtosVendidosNaJanela(): Promise<{ chave: string; idProduto?: string; descricao: string }[]> {
  const dias = diasDaJanela();
  const { porProduto } = await vendasPorCodigoNoPeriodo(dias[dias.length - 1], dias[0]);
  return Object.entries(porProduto).map(([chave, v]) => ({ chave, idProduto: v.idProduto, descricao: v.descricao }));
}

export async function estoqueAtual(): Promise<Record<string, EstoqueProduto>> {
  return (await store.get<Record<string, EstoqueProduto>>(CHAVE_ESTOQUE)) ?? {};
}

export interface StatusColeta {
  configurado: boolean;
  janelaDias: number;
  diasColetados: number;
  emAndamento?: { dia: string; pedidosFeitos: number; totalPedidos: number };
  ultimoErro?: string;
  atualizadoEm?: string;
}

export async function statusColeta(): Promise<StatusColeta> {
  const estado = (await store.get<EstadoSync>(CHAVE_ESTADO)) ?? { diasConcluidos: [] };
  const janela = new Set(diasDaJanela());
  return {
    configurado: isConfigured(),
    janelaDias: janela.size,
    diasColetados: estado.diasConcluidos.filter((d) => janela.has(d)).length,
    emAndamento: estado.emAndamento
      ? {
          dia: estado.emAndamento.dia,
          pedidosFeitos: estado.emAndamento.totalPedidos - estado.emAndamento.idsPendentes.length,
          totalPedidos: estado.emAndamento.totalPedidos,
        }
      : undefined,
    ultimoErro: estado.ultimoErro,
    atualizadoEm: estado.atualizadoEm,
  };
}

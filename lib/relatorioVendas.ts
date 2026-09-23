import { tinyGet } from "./tinyClient";

/**
 * Relatório de vendas por produto e por dia, usado pela aba Relatórios.
 *
 * O Tiny não tem um endpoint que já devolva "quantidade vendida por dia de um
 * produto": aqui buscamos todos os pedidos do período (pedidos.pesquisa.php,
 * paginado, filtrando por dataInicial/dataFinal) e, pra cada um, os itens
 * (pedido.obter.php), somando as quantidades dos itens cujo nome contém o
 * termo buscado — 1 chamada por pedido do período, não só pelos que têm o
 * produto. Num volume alto de pedidos/dia isso passa fácil de várias milhares
 * de chamadas por mês — visto na prática (~630 pedidos/dia, ~17 mil num
 * período de 27 dias) — por isso roda em background com progresso (ver
 * server/routes/relatorios.ts) e com um intervalo pequeno entre chamadas
 * (RATE_LIMIT_DELAY_MS) pra não estourar o limite de taxa do Tiny; se estourar
 * mesmo assim, tinyGet reage com retry e backoff, não falha na hora — o mesmo
 * comportamento (token recusado por alguns segundos após uma rajada) já visto
 * e documentado em lib/olist.ts. Nesse volume, um relatório de ~1 mês pode
 * levar bem mais de uma hora — é esperado, não travou.
 *
 * Não filtra por situação do pedido (aberto/cancelado/etc.): não deu pra
 * confirmar contra a documentação ao vivo do Tiny qual código representa
 * "cancelado" (tiny.com.br bloqueado no ambiente onde isso foi escrito), então
 * pedidos cancelados podem entrar na contagem. Cheque o total contra o
 * relatório de vendas do próprio Tiny antes de usar os números pra decisão.
 */

const RATE_LIMIT_DELAY_MS = 150;
// Teto alto de propósito (era 3000, estourava com o volume real de pedidos/dia
// do negócio) — existe só pra pegar um termo/período claramente errado antes
// de gastar horas nisso, não pra limitar um relatório mensal de verdade.
const MAX_PEDIDOS_POR_RELATORIO = 50_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isoParaBr(dataIso: string): string {
  const [ano, mes, dia] = dataIso.split("-");
  return `${dia}/${mes}/${ano}`;
}

function brParaIso(dataBr: string): string {
  const [dia, mes, ano] = dataBr.split("/");
  return `${ano}-${mes}-${dia}`;
}

function normaliza(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

interface PedidoResumo {
  id: string;
  data_pedido: string;
}

interface PedidosPesquisaResponse {
  retorno: {
    status: string;
    codigo_erro?: number;
    numero_paginas?: number;
    pedidos?: { pedido: PedidoResumo }[];
    erros?: { erro: string }[];
  };
}

const SEM_REGISTROS_ERROR_CODE = 32;

async function listarPedidosDoPeriodo(dataInicialIso: string, dataFinalIso: string): Promise<PedidoResumo[]> {
  const dataInicial = isoParaBr(dataInicialIso);
  const dataFinal = isoParaBr(dataFinalIso);
  const pedidos: PedidoResumo[] = [];
  let pagina = 1;
  let totalPaginas = 1;

  do {
    const json = await tinyGet<PedidosPesquisaResponse>("pedidos.pesquisa.php", {
      dataInicial,
      dataFinal,
      pagina: String(pagina),
    });
    const { retorno } = json;
    if (retorno.status !== "OK") {
      if (retorno.codigo_erro === SEM_REGISTROS_ERROR_CODE) break;
      throw new Error(`Tiny recusou a busca de pedidos: ${retorno.erros?.map((e) => e.erro).join("; ") ?? "erro desconhecido"}`);
    }
    for (const registro of retorno.pedidos ?? []) pedidos.push(registro.pedido);
    totalPaginas = retorno.numero_paginas ?? 1;
    pagina++;
  } while (pagina <= totalPaginas);

  if (pedidos.length > MAX_PEDIDOS_POR_RELATORIO) {
    throw new Error(
      `O período tem ${pedidos.length} pedidos, acima do teto de ${MAX_PEDIDOS_POR_RELATORIO} por relatório. Reduza o período e tente de novo.`,
    );
  }

  return pedidos;
}

interface ItemPedido {
  descricao?: string;
  quantidade?: string | number;
}

interface PedidoDetalhe {
  itens?: { item?: ItemPedido }[];
}

interface PedidoObterResponse {
  retorno: { status: string; pedido?: PedidoDetalhe };
}

export type LinhaVendaDiaria = { data: string; produto: string; quantidade: number };
export type Progresso = { atual: number; total: number };

export async function gerarRelatorioVendas(
  termoBusca: string,
  dataInicialIso: string,
  dataFinalIso: string,
  onProgresso?: (progresso: Progresso) => void,
): Promise<LinhaVendaDiaria[]> {
  const termo = normaliza(termoBusca.trim());
  if (!termo) throw new Error("Informe o nome (ou parte do nome) do produto.");

  const pedidos = await listarPedidosDoPeriodo(dataInicialIso, dataFinalIso);
  const totais = new Map<string, number>(); // chave: `${dataIso}|${produto}`

  onProgresso?.({ atual: 0, total: pedidos.length });

  for (let i = 0; i < pedidos.length; i++) {
    const resumo = pedidos[i];
    const json = await tinyGet<PedidoObterResponse>("pedido.obter.php", { id: resumo.id });
    if (json.retorno.status === "OK") {
      const dataIso = brParaIso(resumo.data_pedido);
      for (const registro of json.retorno.pedido?.itens ?? []) {
        const item = registro.item;
        const descricao = item?.descricao ?? "";
        if (!item || !normaliza(descricao).includes(termo)) continue;
        const chave = `${dataIso}|${descricao}`;
        totais.set(chave, (totais.get(chave) ?? 0) + (Number(item.quantidade) || 0));
      }
    }
    onProgresso?.({ atual: i + 1, total: pedidos.length });
    if (i < pedidos.length - 1) await sleep(RATE_LIMIT_DELAY_MS);
  }

  return [...totais.entries()].map(([chave, quantidade]) => {
    const [data, produto] = chave.split("|");
    return { data, produto, quantidade };
  });
}

export type RelatorioPivotado = {
  dias: string[];
  produtos: string[];
  quantidadePorDiaEProduto: Record<string, Record<string, number>>;
};

function todasAsDatasIso(inicioIso: string, fimIso: string): string[] {
  const datas: string[] = [];
  const cursor = new Date(`${inicioIso}T00:00:00Z`);
  const fim = new Date(`${fimIso}T00:00:00Z`);
  while (cursor <= fim) {
    datas.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return datas;
}

/** Preenche todo dia do período com 0, mesmo os sem venda — é o ponto do relatório: "cada dia", não só os dias com venda. */
export function pivotarPorDia(linhas: LinhaVendaDiaria[], dataInicialIso: string, dataFinalIso: string): RelatorioPivotado {
  const produtos = [...new Set(linhas.map((linha) => linha.produto))].sort((a, b) => a.localeCompare(b));
  const dias = todasAsDatasIso(dataInicialIso, dataFinalIso);

  const quantidadePorDiaEProduto: Record<string, Record<string, number>> = {};
  for (const dia of dias) {
    quantidadePorDiaEProduto[dia] = {};
    for (const produto of produtos) quantidadePorDiaEProduto[dia][produto] = 0;
  }
  for (const linha of linhas) {
    if (quantidadePorDiaEProduto[linha.data]) {
      quantidadePorDiaEProduto[linha.data][linha.produto] = linha.quantidade;
    }
  }

  return { dias, produtos, quantidadePorDiaEProduto };
}

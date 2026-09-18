/** Modo de contagem de vendas. Decisão de negócio ainda em aberto: os dois coexistem. */
export type CountingMode = "order" | "invoice";

export const COUNTING_MODES: CountingMode[] = ["order", "invoice"];

export const COUNTING_MODE_LABEL: Record<CountingMode, string> = {
  order: "Por Pedido",
  invoice: "Por Nota Fiscal",
};

/** Uma linha da planilha de estoque. A ordem (`rowOrder`) é o que garante colar certo. */
export interface Product {
  id: string;
  sheetName: string;
  rowOrder: number;
  sku: string | null;
  active: boolean;
}

/**
 * Mapeamento persistente: nome que vem do Tiny -> produto da planilha.
 * `productId: null` marca um nome já reconhecido como fora da planilha (produto
 * novo): continua aparecendo em destaque na tela, mas sai da fila de decisão.
 */
export interface ProductAlias {
  id: string;
  reportName: string;
  normalized: string;
  productId: string | null;
  source: "auto" | "manual";
  createdAt: string;
}

/** Saldo de um produto no fechamento de uma coluna da planilha. */
export interface BalanceRecord {
  productId: string;
  periodEnd: string;
  balance: number;
}

/** Papéis de coluna que o parser tenta reconhecer no export do Tiny. */
export type ColumnRole =
  | "productName"
  | "sku"
  | "quantity"
  | "orderNumber"
  | "orderDate"
  | "orderStatus"
  | "invoiceNumber"
  | "invoiceDate"
  | "invoiceStatus"
  | "channel";

export type ColumnMapping = Partial<Record<ColumnRole, number>>;

/** Linha do relatório de vendas já normalizada, independente de CSV/XLSX. */
export interface SalesLine {
  rowIndex: number;
  rawProductName: string;
  sku: string | null;
  quantity: number;
  orderNumber: string | null;
  orderDate: string | null;
  orderStatus: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  invoiceStatus: string | null;
  channel: string | null;
}

export interface ParsedReport {
  headers: string[];
  /** Linhas cruas (já em texto) abaixo do cabeçalho — permitem remapear colunas sem reenviar o arquivo. */
  dataRows: string[][];
  mapping: ColumnMapping;
  lines: SalesLine[];
  totalRows: number;
  warnings: string[];
  detectedFormat: "csv" | "xlsx";
}

/**
 * Período coberto por uma coluna da planilha. Um dia isolado tem start === end;
 * um fim de semana agrupado ("04/09 à 07/09") tem start < end.
 */
export interface Period {
  start: string;
  end: string;
  label: string;
}

/** Quais linhas contam em cada modo. Parametrizável — a regra ainda está em discussão. */
export interface CountingRules {
  excludedOrderStatuses: string[];
  excludedInvoiceStatuses: string[];
  /**
   * Canais que não entram na conta. O full de Amazon/Mercado Livre é conferido
   * por fora no processo manual atual, então precisa dar para separá-lo aqui.
   */
  excludedChannels: string[];
  requireInvoiceNumber: boolean;
  ignoreDatesUseWholeFile: boolean;
}

export const DEFAULT_COUNTING_RULES: CountingRules = {
  excludedOrderStatuses: ["cancelado", "cancelada"],
  excludedInvoiceStatuses: ["cancelada", "cancelado", "denegada", "denegado"],
  excludedChannels: [],
  requireInvoiceNumber: true,
  ignoreDatesUseWholeFile: false,
};

/** Total vendido de um nome cru do relatório, nos dois modos. */
export interface AggregatedSale {
  rawProductName: string;
  sku: string | null;
  byOrder: number;
  byInvoice: number;
  orderLines: number;
  invoiceLines: number;
}

export type PreviewStatus = "ok" | "no-sale" | "negative";

/** Uma linha da coluna nova, na ordem da planilha. */
export interface PreviewRow {
  productId: string;
  sheetName: string;
  rowOrder: number;
  soldQty: number;
  soldByOrder: number;
  soldByInvoice: number;
  previousBalance: number;
  newBalance: number;
  diverges: boolean;
  status: PreviewStatus;
  matchedNames: string[];
}

/** Nome do relatório que não bateu com confiança e precisa de confirmação humana. */
export interface PendingMapping {
  reportName: string;
  sku: string | null;
  byOrder: number;
  byInvoice: number;
  suggestions: { productId: string; sheetName: string; score: number }[];
}

/** Nome do relatório sem linha correspondente na planilha — nunca é descartado em silêncio. */
export interface UnknownProduct {
  reportName: string;
  sku: string | null;
  byOrder: number;
  byInvoice: number;
  acknowledged: boolean;
}

export interface PreviewResult {
  period: Period;
  mode: CountingMode;
  /**
   * Se o relatório carrega informação de nota fiscal (colunas de NF, ou um
   * segundo arquivo exportado por nota). Quando falso, o modo "Por Nota Fiscal"
   * não tem base: comparar os dois modos apontaria divergência em tudo.
   */
  invoiceAvailable: boolean;
  rows: PreviewRow[];
  pending: PendingMapping[];
  unknown: UnknownProduct[];
  divergentCount: number;
  totals: { byOrder: number; byInvoice: number };
  /** Linhas do relatório que nenhum dos dois modos contou (fora do período, canceladas). */
  skippedLines: number;
}

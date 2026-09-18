import type { CountingMode, Period, PreviewResult, PreviewRow, Product } from "./types";
import type { ResolutionResult } from "./matching";

export interface BuildColumnInput {
  products: Product[];
  /** Saldo da última coluna preenchida, por produto. */
  previousBalances: Record<string, number>;
  resolution: ResolutionResult;
  mode: CountingMode;
  period: Period;
  skippedLines: number;
  invoiceAvailable: boolean;
}

/**
 * Monta a coluna nova na ordem exata das linhas da planilha.
 *
 * Produto sem venda no dia mantém o saldo anterior — é o comportamento pedido, e
 * é também o que garante que a coluna colada tenha uma célula por linha.
 */
export function buildColumn(input: BuildColumnInput): PreviewResult {
  const { products, previousBalances, resolution, mode, period, skippedLines, invoiceAvailable } = input;

  const rows: PreviewRow[] = products
    .filter((product) => product.active)
    .slice()
    .sort((a, b) => a.rowOrder - b.rowOrder)
    .map((product) => {
      const sale = resolution.resolved.get(product.id);
      const soldByOrder = sale?.byOrder ?? 0;
      const soldByInvoice = sale?.byInvoice ?? 0;
      const soldQty = mode === "order" ? soldByOrder : soldByInvoice;
      const previousBalance = previousBalances[product.id] ?? 0;
      const newBalance = previousBalance - soldQty;

      return {
        productId: product.id,
        sheetName: product.sheetName,
        rowOrder: product.rowOrder,
        soldQty,
        soldByOrder,
        soldByInvoice,
        previousBalance,
        newBalance,
        diverges: invoiceAvailable && soldByOrder !== soldByInvoice,
        status: newBalance < 0 ? "negative" : soldQty === 0 ? "no-sale" : "ok",
        matchedNames: sale?.matchedNames ?? [],
      } satisfies PreviewRow;
    });

  const totals = rows.reduce(
    (acc, row) => ({ byOrder: acc.byOrder + row.soldByOrder, byInvoice: acc.byInvoice + row.soldByInvoice }),
    { byOrder: 0, byInvoice: 0 },
  );

  return {
    period,
    mode,
    invoiceAvailable,
    rows,
    pending: resolution.pending,
    unknown: resolution.unknown,
    divergentCount: rows.filter((row) => row.diverges).length,
    totals,
    skippedLines: skippedLines,
  };
}

/**
 * Tudo que o sistema não resolveu sozinho e a pessoa ainda não decidiu.
 * Fechar a coluna com pendências aqui significaria não descontar a venda de um
 * produto — por isso o fechamento exige confirmação explícita.
 */
export function unresolvedCount(result: PreviewResult): number {
  return result.pending.length + result.unknown.filter((item) => !item.acknowledged).length;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
}

/** Coluna pronta para colar: um valor por linha, na ordem da planilha. */
export function toClipboardColumn(rows: PreviewRow[], includeHeader = false, header = ""): string {
  const body = rows.map((row) => formatNumber(row.newBalance));
  return includeHeader ? [header, ...body].join("\n") : body.join("\n");
}

/** Conferência: nome + vendido + saldo anterior + novo saldo, colável em duas dimensões. */
export function toClipboardTable(rows: PreviewRow[]): string {
  const header = ["Produto", "Vendido", "Saldo anterior", "Novo saldo"].join("\t");
  const body = rows.map((row) =>
    [row.sheetName, formatNumber(row.soldQty), formatNumber(row.previousBalance), formatNumber(row.newBalance)].join("\t"),
  );
  return [header, ...body].join("\n");
}

export { formatNumber };

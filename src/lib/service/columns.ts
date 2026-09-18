import type { ColumnMapping, CountingMode, CountingRules, ParsedReport, PreviewResult } from "../domain/types";
import { DEFAULT_COUNTING_RULES } from "../domain/types";
import { aggregateSales, collectStatuses } from "../domain/aggregate";
import { buildColumn, unresolvedCount } from "../domain/column";
import { mergeResolutions, resolveSales, type MappingDecision } from "../domain/matching";
import { remapReport } from "../domain/parser";
import { buildPeriod, previousDay } from "../domain/period";
import { BusinessError } from "../errors";
import { getRepository } from "../storage";
import type { Snapshot } from "../storage/types";

export interface ComputeRequest {
  uploadId: string;
  /**
   * Segundo relatório, exportado por nota fiscal. Só é necessário quando o
   * arquivo principal não traz colunas de NF — caso do export agregado do Tiny.
   */
  invoiceUploadId?: string | null;
  start: string;
  end?: string | null;
  mode: CountingMode;
  rules?: Partial<CountingRules>;
  decisions?: Record<string, MappingDecision>;
  columnOverrides?: ColumnMapping;
}

export interface ComputeOutput {
  preview: PreviewResult;
  previousSnapshot: Snapshot | null;
  report: {
    headers: string[];
    mapping: ColumnMapping;
    warnings: string[];
    lineCount: number;
    statuses: { order: string[]; invoice: string[]; channels: string[] };
    filename: string;
    invoiceFilename: string | null;
  };
  learned: { reportName: string; productId: string | null; source: "auto" | "manual" }[];
  rules: CountingRules;
}

/**
 * Nucleo do sistema: relatorio + saldo anterior -> coluna nova, nos dois modos.
 * Usado tanto pela previa quanto pelo fechamento, para que o que o usuario ve na
 * tela seja literalmente o que fica gravado.
 */
export async function computeColumn(request: ComputeRequest): Promise<ComputeOutput> {
  const repo = getRepository();
  const upload = await repo.getUpload(request.uploadId);
  if (!upload) throw new BusinessError("Relatorio nao encontrado. Envie o arquivo novamente.");

  const overrides = request.columnOverrides ?? {};
  const report: ParsedReport =
    Object.keys(overrides).length > 0 ? remapReport(upload.report, overrides) : upload.report;

  const period = buildPeriod(request.start, request.end);
  const rules: CountingRules = { ...DEFAULT_COUNTING_RULES, ...(request.rules ?? {}) };

  const [products, aliases, previous] = await Promise.all([
    repo.listProducts(),
    repo.listAliases(),
    repo.latestBalances(previousDay(period.start)),
  ]);

  // O export agregado do Tiny nao traz nota fiscal; nesse caso o segundo arquivo
  // e a unica forma de o modo "Por Nota Fiscal" ter base.
  let invoiceAvailable =
    report.mapping.invoiceNumber !== undefined || report.mapping.invoiceDate !== undefined;

  const aggregation = aggregateSales(report, period, rules);
  let resolution = resolveSales(aggregation.sales, products, aliases, request.decisions ?? {});
  let skippedLines = aggregation.skippedLines;
  let invoiceReportFilename: string | null = null;

  if (request.invoiceUploadId && request.invoiceUploadId !== request.uploadId) {
    const invoiceUpload = await repo.getUpload(request.invoiceUploadId);
    if (!invoiceUpload) {
      throw new BusinessError("Relatorio por nota fiscal nao encontrado. Envie o arquivo novamente.");
    }

    // No arquivo de notas, o que vale e o total emitido: a coluna de quantidade
    // ja e o resultado do filtro feito no Tiny, entao contamos a linha inteira.
    const invoiceAggregation = aggregateSales(invoiceUpload.report, period, {
      ...rules,
      requireInvoiceNumber: false,
    });
    const invoiceOnly = invoiceAggregation.sales.map((sale) => ({ ...sale, byInvoice: sale.byOrder }));
    const invoiceResolution = resolveSales(invoiceOnly, products, aliases, request.decisions ?? {});

    resolution = mergeResolutions(resolution, invoiceResolution);
    skippedLines += invoiceAggregation.skippedLines;
    invoiceReportFilename = invoiceUpload.filename;
    invoiceAvailable = true;
  }

  const preview = buildColumn({
    products,
    previousBalances: previous.balances,
    resolution,
    mode: request.mode,
    period,
    skippedLines,
    invoiceAvailable,
  });

  return {
    preview,
    previousSnapshot: previous.snapshot,
    report: {
      headers: report.headers,
      mapping: report.mapping,
      warnings: report.warnings,
      lineCount: report.lines.length,
      statuses: collectStatuses(report),
      filename: upload.filename,
      invoiceFilename: invoiceReportFilename,
    },
    learned: resolution.learned,
    rules,
  };
}

/** Confirmacoes manuais valem imediatamente: o usuario nao deve responder duas vezes. */
export async function persistManualDecisions(learned: ComputeOutput["learned"]): Promise<void> {
  const manual = learned.filter((entry) => entry.source === "manual");
  if (manual.length > 0) await getRepository().saveAliases(manual);
}

export interface CommitRequest extends ComputeRequest {
  note?: string | null;
  /** Fechar com produtos sem destino definido exige confirmacao explicita. */
  acknowledgePending?: boolean;
}

export type CommitResult =
  | { ok: true; snapshot: Snapshot; rows: number }
  | { ok: false; unresolved: number; output: ComputeOutput };

/**
 * Fecha a coluna: recalcula com os mesmos parametros da previa, memoriza os
 * mapeamentos usados e grava o saldo do dia — que passa a ser o "anterior" do
 * proximo, dispensando reler a planilha.
 *
 * Recusa por padrao se sobrou produto sem destino: fechar assim deixaria uma
 * venda sem baixa, em silencio.
 */
export async function commitColumn(request: CommitRequest): Promise<CommitResult> {
  const output = await computeColumn(request);

  // Fechar por nota sem dado de nota zeraria a venda do dia inteiro.
  if (request.mode === "invoice" && !output.preview.invoiceAvailable) {
    throw new BusinessError(
      "Este relatorio nao traz informacao de nota fiscal. Envie o export por nota fiscal " +
        "no segundo campo, ou feche a coluna no modo Por Pedido.",
    );
  }

  const unresolved = unresolvedCount(output.preview);
  if (unresolved > 0 && !request.acknowledgePending) {
    return { ok: false, unresolved, output };
  }

  const repo = getRepository();
  if (output.learned.length > 0) await repo.saveAliases(output.learned);

  const snapshot = await repo.saveSnapshot(
    {
      periodStart: output.preview.period.start,
      periodEnd: output.preview.period.end,
      label: output.preview.period.label,
      mode: output.preview.mode,
      note: request.note ?? null,
    },
    output.preview.rows.map((row) => ({
      productId: row.productId,
      soldQty: row.soldQty,
      soldByOrder: row.soldByOrder,
      soldByInvoice: row.soldByInvoice,
      previousBalance: row.previousBalance,
      newBalance: row.newBalance,
    })),
  );

  return { ok: true, snapshot, rows: output.preview.rows.length };
}

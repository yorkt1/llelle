import type { AggregatedSale, CountingRules, ParsedReport, Period, SalesLine } from "./types";
import { normalizeName, normalizeStatus } from "./normalize";
import { isWithinPeriod } from "./period";

function statusAllowed(status: string | null, excluded: string[]): boolean {
  if (!status) return true;
  const normalized = normalizeStatus(status);
  return !excluded.some((item) => normalizeStatus(item) === normalized);
}

function channelAllowed(channel: string | null, excluded: string[]): boolean {
  if (!channel || excluded.length === 0) return true;
  const normalized = normalizeStatus(channel);
  return !excluded.some((item) => normalizeStatus(item) === normalized);
}

/**
 * Uma venda conta "Por Pedido" se o pedido é do período e sua situação não está
 * excluída. A data do pedido manda; se o relatório não trouxer essa coluna,
 * caímos na data da nota e, em último caso, contamos o arquivo inteiro (o
 * relatório já vem filtrado por dia no Tiny).
 */
export function countsByOrder(line: SalesLine, period: Period, rules: CountingRules, hasAnyDate: boolean): boolean {
  if (!channelAllowed(line.channel, rules.excludedChannels)) return false;
  if (!statusAllowed(line.orderStatus, rules.excludedOrderStatuses)) return false;
  if (rules.ignoreDatesUseWholeFile || !hasAnyDate) return true;
  const reference = line.orderDate ?? line.invoiceDate;
  return reference === null ? true : isWithinPeriod(reference, period);
}

/**
 * Uma venda conta "Por Nota Fiscal" se existe nota emitida no período e ela não
 * foi cancelada/denegada. Um pedido fechado sem nota emitida some daqui — é
 * exatamente essa a divergência que a equipe quer enxergar.
 */
export function countsByInvoice(line: SalesLine, period: Period, rules: CountingRules, hasAnyDate: boolean): boolean {
  if (!channelAllowed(line.channel, rules.excludedChannels)) return false;
  if (rules.requireInvoiceNumber && !line.invoiceNumber) return false;
  if (!statusAllowed(line.invoiceStatus, rules.excludedInvoiceStatuses)) return false;
  if (rules.ignoreDatesUseWholeFile || !hasAnyDate) return true;
  const reference = line.invoiceDate ?? line.orderDate;
  return reference === null ? true : isWithinPeriod(reference, period);
}

export interface AggregationResult {
  sales: AggregatedSale[];
  skippedLines: number;
}

/** Soma as quantidades por nome de produto do relatório, nos dois modos ao mesmo tempo. */
export function aggregateSales(
  report: ParsedReport,
  period: Period,
  rules: CountingRules,
): AggregationResult {
  const hasAnyDate = report.mapping.orderDate !== undefined || report.mapping.invoiceDate !== undefined;
  const byKey = new Map<string, AggregatedSale>();
  let skippedLines = 0;

  for (const line of report.lines) {
    const key = normalizeName(line.rawProductName);
    if (!key) continue;

    const inOrder = countsByOrder(line, period, rules, hasAnyDate);
    const inInvoice = countsByInvoice(line, period, rules, hasAnyDate);
    if (!inOrder && !inInvoice) {
      skippedLines += 1;
      continue;
    }

    let entry = byKey.get(key);
    if (!entry) {
      entry = {
        rawProductName: line.rawProductName,
        sku: line.sku,
        byOrder: 0,
        byInvoice: 0,
        orderLines: 0,
        invoiceLines: 0,
      };
      byKey.set(key, entry);
    }
    if (!entry.sku && line.sku) entry.sku = line.sku;
    if (inOrder) {
      entry.byOrder += line.quantity;
      entry.orderLines += 1;
    }
    if (inInvoice) {
      entry.byInvoice += line.quantity;
      entry.invoiceLines += 1;
    }
  }

  return { sales: [...byKey.values()], skippedLines };
}

/** Situações e canais distintos do arquivo — alimentam os filtros parametrizáveis da tela. */
export function collectStatuses(report: ParsedReport): {
  order: string[];
  invoice: string[];
  channels: string[];
} {
  const order = new Set<string>();
  const invoice = new Set<string>();
  const channels = new Set<string>();
  for (const line of report.lines) {
    if (line.orderStatus) order.add(line.orderStatus.trim());
    if (line.invoiceStatus) invoice.add(line.invoiceStatus.trim());
    if (line.channel) channels.add(line.channel.trim());
  }
  return { order: [...order].sort(), invoice: [...invoice].sort(), channels: [...channels].sort() };
}

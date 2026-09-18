import type { ColumnMapping, ParsedReport, SalesLine } from "../types";
import { normalizeSku, parseDateLoose, parseQuantity } from "../normalize";
import { decodeTextBuffer } from "./decode";
import { parseCsv, sniffDelimiter } from "./csv";
import { detectColumns, findHeaderRow } from "./columns";
import { readXlsx, type CellValue } from "./xlsx";

export { detectColumns, findHeaderRow } from "./columns";

/**
 * Decide pelo conteudo, nao pela extensao: XLSX e um zip (assinatura "PK"), e
 * arquivo CSV renomeado para .xlsx (ou o contrario) aparece na pratica.
 */
function isXlsx(buffer: Buffer): boolean {
  return buffer.length >= 2 && buffer[0] === 0x50 && buffer[1] === 0x4b;
}

function cellText(cell: CellValue): string {
  if (cell === null || cell === undefined) return "";
  if (cell instanceof Date) return cell.toISOString();
  return String(cell).trim();
}

/**
 * O Postgres nao aceita U+0000 dentro de jsonb. Alguns CSVs exportados por
 * ERPs incluem esse caractere invisivel como preenchimento, entao ele precisa
 * sair antes de o relatorio ser salvo no Supabase.
 */
function removeNullCharacters(cell: CellValue): CellValue {
  // eslint-disable-next-line no-control-regex -- remocao intencional do U+0000
  return typeof cell === "string" ? cell.replace(/\u0000/g, "") : cell;
}

/**
 * Converte as linhas cruas em linhas de venda usando um mapeamento de colunas.
 * Fica separado do parse para que uma correcao de coluna na tela recalcule tudo
 * sem exigir novo upload do arquivo.
 */
export function buildLines(dataRows: string[][], mapping: ColumnMapping): SalesLine[] {
  const pick = (row: string[], role: keyof ColumnMapping): string => {
    const index = mapping[role];
    return index === undefined ? "" : (row[index] ?? "");
  };

  const lines: SalesLine[] = [];
  // O relatorio vem agrupado por canal: o nome do canal aparece so na linha de
  // faixa ("Shopee"), e as linhas de produto abaixo herdam ele ate a proxima.
  let currentChannel = "";

  dataRows.forEach((row, index) => {
    const channelCell = pick(row, "channel");
    if (channelCell) currentChannel = channelCell;

    const rawProductName = pick(row, "productName");
    const quantity = parseQuantity(pick(row, "quantity"));
    // Linha de faixa de canal e rodape de total nao tem produto; quantidade
    // zero nao move estoque.
    if (!rawProductName || quantity === 0) return;

    lines.push({
      rowIndex: index + 1,
      rawProductName,
      sku: normalizeSku(pick(row, "sku")),
      quantity,
      orderNumber: pick(row, "orderNumber") || null,
      orderDate: parseDateLoose(pick(row, "orderDate")),
      orderStatus: pick(row, "orderStatus") || null,
      invoiceNumber: pick(row, "invoiceNumber") || null,
      invoiceDate: parseDateLoose(pick(row, "invoiceDate")),
      invoiceStatus: pick(row, "invoiceStatus") || null,
      channel: currentChannel || null,
    });
  });
  return lines;
}

function mappingWarnings(mapping: ColumnMapping): string[] {
  const warnings: string[] = [];
  if (mapping.productName === undefined) {
    warnings.push("Nao identifiquei a coluna de nome do produto. Selecione manualmente.");
  }
  if (mapping.quantity === undefined) {
    warnings.push("Nao identifiquei a coluna de quantidade. Selecione manualmente.");
  }
  if (mapping.invoiceNumber === undefined && mapping.invoiceDate === undefined) {
    warnings.push('Nenhuma coluna de nota fiscal encontrada: o modo "Por Nota Fiscal" ficara zerado.');
  }
  if (mapping.orderDate === undefined && mapping.invoiceDate === undefined) {
    warnings.push("Nenhuma coluna de data encontrada: o arquivo inteiro sera contado no periodo escolhido.");
  }
  return warnings;
}

/** Recalcula as linhas de um relatorio ja armazenado com um novo mapeamento de colunas. */
export function remapReport(report: ParsedReport, overrides: ColumnMapping): ParsedReport {
  const mapping: ColumnMapping = { ...report.mapping, ...overrides };
  return { ...report, mapping, lines: buildLines(report.dataRows, mapping), warnings: mappingWarnings(mapping) };
}

/** Le o relatorio do Tiny em CSV ou XLSX e devolve linhas normalizadas. */
export async function parseSalesReport(buffer: Buffer): Promise<ParsedReport> {
  const warnings: string[] = [];
  let rows: CellValue[][];
  let detectedFormat: "csv" | "xlsx";

  if (isXlsx(buffer)) {
    rows = await readXlsx(buffer);
    detectedFormat = "xlsx";
  } else {
    const { text, encoding } = decodeTextBuffer(buffer);
    rows = parseCsv(text, sniffDelimiter(text));
    detectedFormat = "csv";
    if (!encoding.startsWith("utf-8")) {
      warnings.push("Arquivo lido como " + encoding + " (acentuacao convertida automaticamente).");
    }
  }

  // Limpa antes de localizar o cabecalho: o caractere tambem pode vir nele.
  rows = rows.map((row) => row.map(removeNullCharacters));

  if (rows.length === 0) {
    return {
      headers: [],
      dataRows: [],
      mapping: {},
      lines: [],
      totalRows: 0,
      warnings: ["Arquivo vazio."],
      detectedFormat,
    };
  }

  const headerRowIndex = findHeaderRow(rows);
  const headers = rows[headerRowIndex].map(cellText);
  const width = headers.length;
  const dataRows = rows.slice(headerRowIndex + 1).map((row) => {
    const out = row.map(cellText);
    while (out.length < width) out.push("");
    return out;
  });

  const mapping = detectColumns(headers);
  const lines = buildLines(dataRows, mapping);
  warnings.push(...mappingWarnings(mapping));
  if (lines.length === 0) warnings.push("Nenhuma linha de venda encontrada no arquivo.");

  return { headers, dataRows, mapping, lines, totalRows: dataRows.length, warnings, detectedFormat };
}

/** Data mais frequente no relatorio: usada para pre-preencher o seletor de data. */
export function suggestReportDate(report: ParsedReport): string | null {
  const counts = new Map<string, number>();
  for (const line of report.lines) {
    const date = line.orderDate ?? line.invoiceDate;
    if (date) counts.set(date, (counts.get(date) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [date, count] of counts) {
    if (count > bestCount) {
      best = date;
      bestCount = count;
    }
  }
  return best;
}

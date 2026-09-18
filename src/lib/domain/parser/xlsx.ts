import ExcelJS from "exceljs";

export type CellValue = string | number | Date | null;

/** Achata os formatos de célula do exceljs (rich text, fórmula, hyperlink) num escalar. */
function toCell(value: unknown): CellValue {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  if (typeof value === "number" || typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "1" : "0";

  const obj = value as Record<string, unknown>;
  if (Array.isArray(obj.richText)) {
    return (obj.richText as { text?: string }[]).map((part) => part.text ?? "").join("");
  }
  if ("result" in obj) return toCell(obj.result);
  if ("text" in obj) return toCell(obj.text);
  if ("error" in obj) return null;
  return String(value);
}

/** Lê a aba com mais linhas preenchidas — exports do Tiny às vezes trazem abas auxiliares. */
export async function readXlsx(buffer: Buffer): Promise<CellValue[][]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);

  let best: ExcelJS.Worksheet | null = null;
  for (const sheet of workbook.worksheets) {
    if (!best || sheet.actualRowCount > best.actualRowCount) best = sheet;
  }
  if (!best) return [];

  const rows: CellValue[][] = [];
  best.eachRow({ includeEmpty: false }, (row) => {
    const values = row.values as unknown[];
    const cells: CellValue[] = [];
    // exceljs devolve o array 1-indexado, com a posição 0 vazia.
    for (let i = 1; i < values.length; i += 1) cells.push(toCell(values[i]));
    rows.push(cells);
  });

  return rows;
}

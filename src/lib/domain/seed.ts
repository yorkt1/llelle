import { isNumericCell, parseBalance } from "./normalize";

export interface ProductSeedInput {
  sheetName: string;
  sku: string | null;
  balance: number;
}

const HEADER_HINTS = ["PRODUTO", "DESCRICAO", "NOME", "ITEM", "SALDO", "ESTOQUE", "SKU", "CODIGO"];

function splitRow(line: string): string[] {
  if (line.includes("\t")) return line.split("\t");
  if (line.includes(";")) return line.split(";");
  return [line];
}

function looksLikeHeader(cells: string[]): boolean {
  const joined = cells.join(" ").toUpperCase();
  const hits = HEADER_HINTS.filter((hint) => joined.includes(hint)).length;
  return hits >= 1 && cells.every((cell) => !isNumericCell(cell));
}

/**
 * Le o bloco colado direto da planilha (Ctrl+C das colunas de produto e saldo).
 *
 * Formatos aceitos, nessa ordem de preferencia:
 *   NOME
 *   NOME <tab> SALDO
 *   NOME <tab> SKU <tab> SALDO
 *
 * A ordem das linhas coladas E a ordem das linhas da planilha — e ela que faz a
 * coluna gerada colar de volta alinhada.
 */
export function parseProductPaste(text: string): { seeds: ProductSeedInput[]; warnings: string[] } {
  const warnings: string[] = [];
  const rows = text
    .split(/\r?\n/)
    .map((line) => splitRow(line).map((cell) => cell.trim()))
    .filter((cells) => cells.some((cell) => cell !== ""));

  if (rows.length === 0) return { seeds: [], warnings: ["Nada foi colado."] };
  if (looksLikeHeader(rows[0])) rows.shift();

  const width = Math.max(...rows.map((r) => r.length));
  const seeds: ProductSeedInput[] = [];
  let missingBalance = 0;

  for (const cells of rows) {
    const sheetName = (cells[0] ?? "").trim();
    if (!sheetName) continue;

    let sku: string | null = null;
    let balance: number | null = null;

    if (width >= 2) {
      // O saldo e a ultima celula puramente numerica; o texto que sobra e SKU.
      for (let i = cells.length - 1; i >= 1; i -= 1) {
        if (isNumericCell(cells[i])) {
          balance = parseBalance(cells[i]);
          break;
        }
      }
      sku = cells.slice(1).find((cell) => cell !== "" && !isNumericCell(cell)) ?? null;
    }

    if (balance === null) missingBalance += 1;
    seeds.push({ sheetName, sku, balance: balance ?? 0 });
  }

  if (missingBalance > 0) {
    warnings.push(missingBalance + " linha(s) sem saldo numerico foram importadas com saldo 0.");
  }

  const seen = new Map<string, number>();
  for (const seed of seeds) {
    const key = seed.sheetName.toUpperCase();
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  const duplicates = [...seen.entries()].filter(([, count]) => count > 1).map(([name]) => name);
  if (duplicates.length > 0) {
    warnings.push("Nomes repetidos na planilha: " + duplicates.slice(0, 5).join(", ") + ".");
  }

  return { seeds, warnings };
}

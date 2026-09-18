/** Remove acentuação mantendo as letras base (AQUECEDOR ÁGUA -> AQUECEDOR AGUA). */
export function stripAccents(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/**
 * Chave canônica de comparação de nomes: sem acento, sem pontuação, caixa alta,
 * espaços colapsados. É o que permite casar "Aquecedor 110v." com "AQUECEDOR 110V".
 */
export function normalizeName(value: string): string {
  return stripAccents(String(value ?? ""))
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Ruído comum em títulos de anúncio de marketplace, que atrapalha o fuzzy match. */
const NOISE_TOKENS = new Set([
  "A", "O", "AS", "OS", "DE", "DA", "DO", "DAS", "DOS", "E", "COM", "PARA", "EM",
  "UN", "UND", "UNID", "UNIDADE", "KIT", "NOVO", "NOVA", "ORIGINAL", "PROMOCAO",
  "FRETE", "GRATIS", "ENVIO", "RAPIDO", "PRONTA", "ENTREGA", "QUALIDADE",
]);

export function tokenize(value: string, dropNoise = true): string[] {
  const parts = normalizeName(value).split(" ").filter(Boolean);
  if (!dropNoise) return parts;
  const kept = parts.filter((t) => !NOISE_TOKENS.has(t));
  return kept.length > 0 ? kept : parts;
}

/** Situações do Tiny chegam com caixa/acento variados; comparamos sempre normalizado. */
export function normalizeStatus(value: string | null | undefined): string {
  return normalizeName(value ?? "").toLowerCase();
}

/** SKU some quando vem com espaços ou zeros à esquerda inconsistentes. */
export function normalizeSku(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const cleaned = raw.toUpperCase().replace(/\s+/g, "");
  return cleaned.length > 0 ? cleaned : null;
}

/**
 * Quantidades do Tiny podem vir como "1", "1,00", "1.234,50", 2 ou "2.0".
 * Regra: se tem vírgula, a vírgula é o decimal e o ponto é separador de milhar.
 */
export function parseQuantity(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const raw = String(value ?? "").trim();
  if (!raw) return 0;

  let cleaned = raw.replace(/[^\d,.-]/g, "");
  if (cleaned.includes(",")) {
    cleaned = cleaned.replace(/\./g, "").replace(",", ".");
  } else {
    // "1.234" sem decimais é milhar; "1.5" é decimal.
    const dots = cleaned.split(".").length - 1;
    const tail = cleaned.split(".").pop() ?? "";
    if (dots > 1 || (dots === 1 && tail.length === 3)) {
      cleaned = cleaned.replace(/\./g, "");
    }
  }

  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function toIsoDate(date: Date): string {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/** Serial de data do Excel (base 1899-12-30), como vem de XLSX sem formatação. */
function fromExcelSerial(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > 2958465) return null;
  const ms = Math.round(serial * 86400000);
  return toIsoDate(new Date(Date.UTC(1899, 11, 30) + ms));
}

/**
 * Aceita o que o Tiny e o Excel produzem: Date, serial numérico, "dd/mm/aaaa",
 * "dd/mm/aa", "aaaa-mm-dd", com ou sem hora junto. Retorna ISO ou null.
 */
export function parseDateLoose(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : toIsoDate(value);
  }
  if (typeof value === "number") return fromExcelSerial(value);

  const raw = String(value).trim();
  if (!raw) return null;

  const br = raw.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/);
  if (br) {
    const day = Number(br[1]);
    const month = Number(br[2]);
    let year = Number(br[3]);
    if (year < 100) year += year < 70 ? 2000 : 1900;
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return `${year}-${pad(month)}-${pad(day)}`;
  }

  const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) {
    const month = Number(iso[2]);
    const day = Number(iso[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return `${iso[1]}-${pad(month)}-${pad(day)}`;
  }

  if (/^\d+([.,]\d+)?$/.test(raw)) return fromExcelSerial(Number(raw.replace(",", ".")));
  return null;
}

/**
 * Verdadeiro só quando a célula inteira é um número. Serve para *classificar*
 * colunas coladas: "SKU-1" contém um dígito, mas não é um saldo — sem esse
 * teste, o SKU seria lido como quantidade.
 */
export function isNumericCell(value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value);
  const raw = String(value ?? "").trim();
  if (!raw) return false;
  return /^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(raw) || /^-?\d+([.,]\d+)?$/.test(raw);
}

/** Saldos colados da planilha seguem a mesma bagunça decimal das quantidades. */
export function parseBalance(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  if (!/\d/.test(raw)) return null;
  return parseQuantity(raw);
}

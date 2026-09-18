import type { Period } from "./types";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function toDdMm(iso: string): string {
  const [, month, day] = iso.split("-");
  return `${day}/${month}`;
}

/**
 * Rótulo no formato que a planilha já usa: "08/09" para um dia, "04/09 à 07/09"
 * para uma coluna que cobre fim de semana ou feriado.
 */
export function periodLabel(start: string, end: string): string {
  return start === end ? toDdMm(start) : `${toDdMm(start)} à ${toDdMm(end)}`;
}

export function buildPeriod(start: string, end?: string | null): Period {
  const finalEnd = end && end.trim() !== "" ? end : start;
  if (!isIsoDate(start) || !isIsoDate(finalEnd)) {
    throw new Error("Datas do período inválidas (esperado AAAA-MM-DD).");
  }
  if (finalEnd < start) throw new Error("A data final do período é anterior à inicial.");
  return { start, end: finalEnd, label: periodLabel(start, finalEnd) };
}

export function isWithinPeriod(date: string | null, period: Period): boolean {
  if (!date) return false;
  return date >= period.start && date <= period.end;
}

/** Dias corridos cobertos pela coluna — usado para exibir o alcance ao usuário. */
export function daysInPeriod(period: Period): number {
  const start = Date.parse(`${period.start}T00:00:00Z`);
  const end = Date.parse(`${period.end}T00:00:00Z`);
  return Math.round((end - start) / 86400000) + 1;
}

/** Dia anterior em ISO — o saldo de partida vem sempre da coluna fechada antes desta. */
export function previousDay(iso: string): string {
  const date = new Date(Date.parse(iso + "T00:00:00Z") - 86400000);
  return date.toISOString().slice(0, 10);
}

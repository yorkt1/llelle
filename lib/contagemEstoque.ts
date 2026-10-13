export function calcularQuantidadeContada(caixas: number, unidadesAvulsas: number, unidadesPorCaixa: number): number | null {
  if (![caixas, unidadesAvulsas].every((valor) => Number.isSafeInteger(valor) && valor >= 0)) return null;
  if (!Number.isSafeInteger(unidadesPorCaixa) || unidadesPorCaixa < 1) return null;
  const total = caixas * unidadesPorCaixa + unidadesAvulsas;
  return Number.isSafeInteger(total) ? total : null;
}

export type VoltagemProduto = "110V" | "220V";

/** Reescreve nomes que repetem a faixa bivolt e a voltagem da variação usando só a última voltagem. */
export function nomeProdutoComVoltagemUnica(nome: string): { nome: string; voltagem: VoltagemProduto } | null {
  const padrao = /\b(110|127|220)\s*v?\b/gi;
  const ocorrencias = [...nome.matchAll(padrao)];
  if (ocorrencias.length < 2) return null;

  const ultima = ocorrencias[ocorrencias.length - 1][1];
  const voltagem: VoltagemProduto = ultima === "220" ? "220V" : "110V";
  const base = nome
    .replace(padrao, " ")
    .replace(/\bou\b/gi, " ")
    .replace(/\s*[-–—]+\s*/g, " - ")
    .replace(/(?:\s-\s){2,}/g, " - ")
    .replace(/\s+/g, " ")
    .replace(/^(?:\s-\s)+|(?:\s-\s)+$/g, "")
    .trim();

  return { nome: `${base} ${voltagem}`.trim(), voltagem };
}

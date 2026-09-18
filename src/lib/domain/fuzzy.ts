import { normalizeName, tokenize } from "./normalize";

/** Acima disso mapeia sozinho. */
export const AUTO_ACCEPT_SCORE = 0.88;
/**
 * Piso para *sugerir* um candidato na tela. É baixo de propósito: sugerir um
 * produto parecido custa um clique, enquanto não sugerir nada obriga o usuário a
 * procurar na lista inteira. Quem decide continua sendo a pessoa.
 */
export const REVIEW_MIN_SCORE = 0.15;

function trigrams(value: string): Set<string> {
  const padded = `  ${value} `;
  const out = new Set<string>();
  for (let i = 0; i < padded.length - 2; i += 1) out.add(padded.slice(i, i + 3));
  return out;
}

function dice(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const item of a) if (b.has(item)) shared += 1;
  return (2 * shared) / (a.size + b.size);
}

/** Tokens com dígito carregam a especificação do produto: 110V, 220V, 5L, 30CM. */
function specTokens(tokens: string[]): string[] {
  return tokens.filter((t) => /\d/.test(t));
}

/**
 * Similaridade entre o nome que veio do Tiny e o nome curto da planilha.
 *
 * O caso dominante é "nome curto contido em título longo de anúncio", então a
 * cobertura do lado menor pesa mais que a sobreposição simétrica. Divergência de
 * especificação numérica (110V vs 220V) derruba o score de propósito: errar isso
 * baixa estoque do produto errado.
 */
export function similarity(a: string, b: string): number {
  const normA = normalizeName(a);
  const normB = normalizeName(b);
  if (!normA || !normB) return 0;
  if (normA === normB) return 1;

  const tokensA = tokenize(a);
  const tokensB = tokenize(b);
  const setA = new Set(tokensA);
  const setB = new Set(tokensB);

  let shared = 0;
  for (const token of setA) if (setB.has(token)) shared += 1;

  const tokenDice = (2 * shared) / (setA.size + setB.size);
  const containment = shared / Math.max(1, Math.min(setA.size, setB.size));
  const charDice = dice(trigrams(normA), trigrams(normB));

  // Cobertura do nome curto domina o score; semelhanca global so desempata.
  // Um unico token em comum nao basta para confianca total ("AQUECEDOR" sozinho
  // casaria com qualquer aquecedor), entao a evidencia cresce ate dois tokens.
  const evidence = Math.min(1, shared / 2);
  const support = 0.5 * tokenDice + 0.5 * charDice;
  let score = 0.85 * containment * (0.6 + 0.4 * evidence) + 0.15 * support;

  const shorter = tokensA.length <= tokensB.length ? tokensA : tokensB;
  const longerSet = tokensA.length <= tokensB.length ? setB : setA;
  for (const spec of specTokens(shorter)) {
    if (!longerSet.has(spec)) score *= 0.5;
  }

  return Math.min(1, score);
}

export interface ScoredCandidate<T> {
  item: T;
  score: number;
}

export function rankCandidates<T>(
  query: string,
  candidates: T[],
  toText: (item: T) => string,
  limit = 5,
): ScoredCandidate<T>[] {
  return candidates
    .map((item) => ({ item, score: similarity(query, toText(item)) }))
    .filter((c) => c.score >= REVIEW_MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

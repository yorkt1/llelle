import * as store from "./store";

/**
 * API 2.0 do Tiny/Olist: autenticação por token fixo (gerado em ERP Olist >
 * Configurações > Token API), sem OAuth. Bem mais simples que o fluxo v3 —
 * o token não expira sozinho, só se for revogado/trocado manualmente no ERP.
 *
 * Confirmado em https://tiny.com.br/api-docs/api2-separacao-pesquisar (e
 * testado direto contra a API real): GET /separacao.pesquisa.php devolve
 *   { retorno: { status, pagina, numero_paginas, separacoes: [...] } }
 * — 100 registros por página, sem campo de total pronto.
 *
 * As 3 etapas usam critérios de "hoje" diferentes — testados contra a tela de
 * separação do próprio Olist ERP até os números baterem:
 *
 * - Aguardando/Em separação (situacao=1/4): dataInicial=dataFinal=hoje batem
 *   direto com o parâmetro nativo da API (que filtra por dataCriacao).
 * - Separadas (situacao=2): a tela do Olist conta por dataSeparacao=hoje, não
 *   por dataCriacao — a API não tem esse filtro pronto, então busca sem filtro
 *   de data (fila pequena, não acumula) e conta client-side pelo campo certo.
 * - Embaladas (situacao=3): aproximação conhecida e aceita — a tela do Olist
 *   usa um "prazo máximo de despacho" que não existe nessa API, então conta
 *   por dataCheckout=hoje. Diferente de Separadas, essa fila NUNCA esvazia
 *   (acumula pra sempre), então não dá pra buscar sem filtro de data como lá —
 *   filtra por dataCriacao numa janela de dias (OLIST_EMBALADAS_WINDOW_DAYS)
 *   pra pegar os itens recentes que podem ter sido "embalados" hoje, com um
 *   teto de páginas pra nunca arriscar o limite não documentado da API
 *   (codigo_erro 35 visto ~50+ páginas nos testes). Se estourar o teto, essa
 *   etapa falha isolada e mantém o último valor em cache — não derruba as
 *   outras 3 contagens.
 *
 *   Como o fluxo é sempre o mesmo caminho (Separadas -> Embaladas, sem outra
 *   saída), esse número não precisa ser tão "ao vivo" quanto os outros —
 *   sincroniza numa frequência bem mais baixa (OLIST_EMBALADAS_SYNC_INTERVAL_MS,
 *   ver server/index.ts), o que sobra de "orçamento" de requisições pra usar
 *   numa janela maior sem martelar o rate limit do Tiny (visto na prática:
 *   uma rajada de ~20 páginas já é suficiente pra API começar a recusar com
 *   "Token inválido" por alguns segundos — não é o token, é limite de taxa).
 */
// Lidos a cada chamada, não capturados num const no import: o dotenv só
// carrega o .env.local depois que os imports de server/index.ts já rodaram
// (import é hoisted), então um const de topo aqui sempre veria "" antes disso.
// Exportadas porque lib/devolucoes.ts reaproveita o mesmo token/base da API 2.0
// pra consultar pedido/nota fiscal — mesma conta Tiny, outro conjunto de endpoints.
export function apiBaseUrl(): string {
  return process.env.OLIST_API_BASE_URL ?? "https://api.tiny.com.br/api2";
}
export function apiFormat(): string {
  return process.env.OLIST_API_FORMAT ?? "json";
}
export function apiToken(): string {
  return process.env.OLIST_API_TOKEN ?? "";
}
function embaladasWindowDays(): number {
  return Number(process.env.OLIST_EMBALADAS_WINDOW_DAYS ?? 6);
}

// Cada página tem 100 registros; 40 páginas = 4000 registros. O teto real da
// API não é documentado (só sabemos que ~44 páginas passa e ~50+ já vimos
// falhar com codigo_erro 35), então fica com margem de segurança embaixo disso.
const MAX_SAFE_PAGES = 40;

const COUNTS_KEY = "olist:counts";

// codigo_erro documentado pelo Tiny pra "a consulta não retornou registros" —
// não é uma falha de verdade, é como a API sinaliza uma busca vazia.
const NO_RECORDS_ERROR_CODE = 32;

/** Ordem e rótulos das etapas — situacao=N confirmado na documentação da API 2.0. */
export const SITUACAO = {
  aguardandoSeparacao: 1,
  separadas: 2,
  embaladas: 3,
  emSeparacao: 4,
} as const;

export type SeparacaoCounts = {
  aguardandoSeparacao: number;
  emSeparacao: number;
  separadas: number;
  /** null quando a última tentativa falhou (ex: teto de páginas) e não há cache anterior. Aproximado — ver comentário no topo do arquivo. */
  embaladas: number | null;
};

export type CachedSnapshot = {
  counts: SeparacaoCounts;
  syncedAt: string;
};

export class OlistConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OlistConfigError";
  }
}

export function isConfigured(): boolean {
  return apiToken().trim() !== "";
}

/** dd/mm/yyyy no fuso do Brasil — o formato que a API espera em dataInicial/dataFinal. */
function todayInSaoPaulo(): string {
  return dateInSaoPaulo(new Date());
}

function dateInSaoPaulo(date: Date): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

/** N dias atrás, no mesmo formato dd/mm/yyyy — início da janela de busca do Embaladas. */
function daysAgoInSaoPaulo(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return dateInSaoPaulo(date);
}

interface SeparacaoItem {
  dataCriacao?: string;
  dataSeparacao?: string | null;
  dataCheckout?: string | null;
}

interface SeparacaoPage {
  numero_paginas: number;
  separacoes: SeparacaoItem[];
}

interface DateRange {
  dataInicial: string;
  dataFinal: string;
}

async function fetchPage(situacao: number, pagina: number, range?: DateRange): Promise<SeparacaoPage> {
  if (!isConfigured()) {
    throw new OlistConfigError("OLIST_API_TOKEN precisa estar configurado.");
  }

  const url = new URL(`${apiBaseUrl()}/separacao.pesquisa.php`);
  url.searchParams.set("token", apiToken());
  url.searchParams.set("formato", apiFormat());
  url.searchParams.set("situacao", String(situacao));
  url.searchParams.set("pagina", String(pagina));
  if (range) {
    url.searchParams.set("dataInicial", range.dataInicial);
    url.searchParams.set("dataFinal", range.dataFinal);
  }

  const response = await fetch(url);
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`separacao.pesquisa.php falhou (${response.status}): ${detail}`);
  }

  const json = (await response.json()) as {
    retorno: {
      status: string;
      codigo_erro?: number;
      numero_paginas?: number;
      separacoes?: SeparacaoItem[];
      erros?: { erro: string }[];
    };
  };

  const { retorno } = json;
  if (retorno.status !== "OK") {
    if (retorno.codigo_erro === NO_RECORDS_ERROR_CODE) {
      return { numero_paginas: 0, separacoes: [] };
    }
    const detail = retorno.erros?.map((e) => e.erro).join("; ") ?? "erro desconhecido";
    throw new Error(`Olist recusou a consulta de separações: ${detail}`);
  }

  return {
    numero_paginas: retorno.numero_paginas ?? 1,
    separacoes: retorno.separacoes ?? [],
  };
}

/** Conta pelo filtro nativo da API (dataCriacao) — página 1 + última cabe o total em no máximo 2 chamadas. */
async function countByCreatedOn(situacao: number, dia: string): Promise<number> {
  const range = { dataInicial: dia, dataFinal: dia };
  const first = await fetchPage(situacao, 1, range);
  if (first.numero_paginas <= 1) return first.separacoes.length;
  const last = await fetchPage(situacao, first.numero_paginas, range);
  return (first.numero_paginas - 1) * 100 + last.separacoes.length;
}

/** Separadas: a API não filtra por dataSeparacao, então busca tudo (fila pequena) e conta no código. */
async function countSeparadasHoje(dia: string): Promise<number> {
  const first = await fetchPage(SITUACAO.separadas, 1);
  const items = [...first.separacoes];
  for (let pagina = 2; pagina <= first.numero_paginas; pagina++) {
    items.push(...(await fetchPage(SITUACAO.separadas, pagina)).separacoes);
  }
  return items.filter((item) => item.dataSeparacao === dia).length;
}

/**
 * Embaladas: fila que nunca esvazia, então (diferente de Separadas) não dá pra
 * buscar sem filtro de data. Filtra por dataCriacao numa janela de dias e conta
 * client-side por dataCheckout=hoje — aproximação aceita (~0,5% de diferença
 * testada contra a tela do Olist). Lança se a janela cair fora do teto seguro
 * de páginas, pra quem chama decidir o que fazer (aqui: manter o cache antigo).
 */
async function countEmbaladasHoje(dia: string): Promise<number> {
  const range = { dataInicial: daysAgoInSaoPaulo(embaladasWindowDays()), dataFinal: dia };
  const first = await fetchPage(SITUACAO.embaladas, 1, range);
  if (first.numero_paginas > MAX_SAFE_PAGES) {
    throw new Error(
      `Embaladas: janela de ${embaladasWindowDays()} dia(s) tem ${first.numero_paginas} páginas, acima do teto seguro (${MAX_SAFE_PAGES}). Reduza OLIST_EMBALADAS_WINDOW_DAYS.`,
    );
  }
  const items = [...first.separacoes];
  for (let pagina = 2; pagina <= first.numero_paginas; pagina++) {
    items.push(...(await fetchPage(SITUACAO.embaladas, pagina, range)).separacoes);
  }
  return items.filter((item) => item.dataCheckout === dia).length;
}

async function syncCore(): Promise<Omit<SeparacaoCounts, "embaladas">> {
  const hoje = todayInSaoPaulo();
  const [aguardandoSeparacao, emSeparacao, separadas] = await Promise.all([
    countByCreatedOn(SITUACAO.aguardandoSeparacao, hoje),
    countByCreatedOn(SITUACAO.emSeparacao, hoje),
    countSeparadasHoje(hoje),
  ]);
  return { aguardandoSeparacao, emSeparacao, separadas };
}

async function syncEmbaladas(previous: CachedSnapshot | null): Promise<number | null> {
  try {
    return await countEmbaladasHoje(todayInSaoPaulo());
  } catch (error) {
    console.error("[olist] falha ao contar embaladas, mantendo cache antigo:", error);
    return previous?.counts.embaladas ?? null;
  }
}

/**
 * Sincroniza só Aguardando/Em separação/Separadas — as 3 contagens exatas,
 * baratas em requisições. Preserva o Embaladas que já estava em cache
 * (sincronizado por `fetchEmbaladasCountLive`, numa frequência mais baixa).
 */
export async function fetchCoreCountsLive(): Promise<CachedSnapshot> {
  const previous = await getCachedCounts();
  const core = await syncCore();
  const snapshot: CachedSnapshot = {
    counts: { ...core, embaladas: previous?.counts.embaladas ?? null },
    syncedAt: new Date().toISOString(),
  };
  await store.set(COUNTS_KEY, snapshot);
  return snapshot;
}

/**
 * Sincroniza só Embaladas — a etapa cara em requisições (páginas
 * proporcionais à janela de dias). Preserva as outras 3 que já estavam em
 * cache (sincronizadas por `fetchCoreCountsLive`, com muito mais frequência).
 */
export async function fetchEmbaladasCountLive(): Promise<CachedSnapshot> {
  const previous = await getCachedCounts();
  const embaladas = await syncEmbaladas(previous);
  const snapshot: CachedSnapshot = {
    counts: {
      aguardandoSeparacao: previous?.counts.aguardandoSeparacao ?? 0,
      emSeparacao: previous?.counts.emSeparacao ?? 0,
      separadas: previous?.counts.separadas ?? 0,
      embaladas,
    },
    syncedAt: new Date().toISOString(),
  };
  await store.set(COUNTS_KEY, snapshot);
  return snapshot;
}

/** Sincroniza tudo de uma vez — usada só pelo botão manual "Atualizar números" (POST /api/separacao/sync). */
export async function fetchSeparacaoCountsLive(): Promise<CachedSnapshot> {
  const previous = await getCachedCounts();
  const [core, embaladas] = await Promise.all([syncCore(), syncEmbaladas(previous)]);
  const snapshot: CachedSnapshot = {
    counts: { ...core, embaladas },
    syncedAt: new Date().toISOString(),
  };
  await store.set(COUNTS_KEY, snapshot);
  return snapshot;
}

/** Serve o último snapshot já calculado — rápido, sem chamar o Olist. Usada pelo polling do frontend. */
export async function getCachedCounts(): Promise<CachedSnapshot | null> {
  return store.get<CachedSnapshot>(COUNTS_KEY);
}

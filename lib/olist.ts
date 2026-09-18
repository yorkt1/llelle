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
 *
 * (Um 4o contador, "Embaladas hoje" via situacao=3, foi removido: a tela do
 * Olist usa um "prazo máximo de despacho" que não existe nessa API, então só
 * dava pra aproximar por dataCheckout — ficava com ~0,5% de diferença e exigia
 * uma janela de dias arriscando o teto de paginação da API. Não valeu a pena.)
 */
// Lidos a cada chamada, não capturados num const no import: o dotenv só
// carrega o .env.local depois que os imports de server/index.ts já rodaram
// (import é hoisted), então um const de topo aqui sempre veria "" antes disso.
function apiBaseUrl(): string {
  return process.env.OLIST_API_BASE_URL ?? "https://api.tiny.com.br/api2";
}
function apiFormat(): string {
  return process.env.OLIST_API_FORMAT ?? "json";
}
function apiToken(): string {
  return process.env.OLIST_API_TOKEN ?? "";
}

const COUNTS_KEY = "olist:counts";

// codigo_erro documentado pelo Tiny pra "a consulta não retornou registros" —
// não é uma falha de verdade, é como a API sinaliza uma busca vazia.
const NO_RECORDS_ERROR_CODE = 32;

/** Ordem e rótulos das etapas — situacao=N confirmado na documentação da API 2.0. */
export const SITUACAO = {
  aguardandoSeparacao: 1,
  separadas: 2,
  emSeparacao: 4,
} as const;

export type SeparacaoCounts = {
  aguardandoSeparacao: number;
  emSeparacao: number;
  separadas: number;
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
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date());
}

interface SeparacaoItem {
  dataCriacao?: string;
  dataSeparacao?: string | null;
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

/** Bate na API de verdade, atualiza o cache e devolve o snapshot novo. Chamada só pelo sync periódico. */
export async function fetchSeparacaoCountsLive(): Promise<CachedSnapshot> {
  const hoje = todayInSaoPaulo();

  const [aguardandoSeparacao, emSeparacao, separadas] = await Promise.all([
    countByCreatedOn(SITUACAO.aguardandoSeparacao, hoje),
    countByCreatedOn(SITUACAO.emSeparacao, hoje),
    countSeparadasHoje(hoje),
  ]);

  const snapshot: CachedSnapshot = {
    counts: { aguardandoSeparacao, emSeparacao, separadas },
    syncedAt: new Date().toISOString(),
  };
  await store.set(COUNTS_KEY, snapshot);
  return snapshot;
}

/** Serve o último snapshot já calculado — rápido, sem chamar o Olist. Usada pelo polling do frontend. */
export async function getCachedCounts(): Promise<CachedSnapshot | null> {
  return store.get<CachedSnapshot>(COUNTS_KEY);
}

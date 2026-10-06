import { tinyGet } from "./tinyClient";
import { embaladasWindowDays, SITUACAO, todayInSaoPaulo } from "./olist";
import * as store from "./store";

/**
 * Desempenho de embalagem por colaborador — conta quantos pedidos cada pessoa embalou num dia,
 * cruzando o Tiny (API 2.0, mesmo token de OLIST_API_TOKEN) com uma tabela própria de
 * ID-do-usuário-no-Tiny → nome do colaborador (configurável por aqui, não no Tiny).
 *
 * Fluxo:
 * 1. `separacao.pesquisa.php?situacao=3&dataInicial=X&dataFinal=Y&pagina=N` lista os RESUMOS de
 *    separações "Embalada" — mesmo endpoint+parâmetro já confirmados em produção por
 *    lib/olist.ts (`fetchEmbaladasCountLive`). Não existe filtro de `dataCheckout` na busca, só
 *    `dataCriacao` — por isso usa a mesma janela de dias (`embaladasWindowDays`) e filtra por
 *    `dataCheckout === dia` no próprio código, igual `countEmbaladasHoje` em lib/olist.ts.
 * 2. Pra cada resumo com `dataCheckout === dia`, `separacao.obter.php?idSeparacao=X` traz o
 *    DETALHE — com o campo `idUsuarioEmbalador`, que identifica quem embalou.
 *
 * `separacao.obter.php`/`idUsuarioEmbalador` foi confirmado contra dados reais de produção (IDs
 * distintos por bancada, contagens batendo com o relatório do Tiny). Se o campo vier ausente/vazio
 * pra uma separação, ela cai no balde "não identificado" em vez de quebrar o resto do relatório —
 * nunca assume um valor.
 *
 * O resultado de `separacao.obter.php` é cacheado por `idSeparacao` pra sempre (depois de
 * embalada, quem embalou não muda) — uma nova chamada só resolve as separações NOVAS desde a
 * última vez, mesma ideia de "nunca reprocessar o que já foi resolvido" de
 * lib/shopeeImportacao.ts. Isso existe porque `separacao.obter.php` custa 1 chamada por
 * separação — sem cache, cada atualização da tela re-consultaria o dia inteiro de novo.
 *
 * IMPORTANTE — quem chama o Tiny: só `sincronizarEmbalagemHoje`, acionada por um job de fundo em
 * server/index.ts (mesmo padrão de `fetchCoreCountsLive`/`fetchEmbaladasCountLive` em
 * lib/olist.ts). `obterDesempenho` pro dia de HOJE nunca chama o Tiny direto — só lê o que esse
 * job já deixou em cache (`CHAVE_RESUMOS_HOJE` + `CHAVE_RESOLUCOES`) e monta o relatório. Isso
 * existe porque, antes, cada requisição HTTP (um clique no botão "Atualizar", por exemplo)
 * disparava a busca+resolução ao vivo — na prática, isso fazia o próprio clique da pessoa somar
 * chamadas em cima do que o job de fundo já estava fazendo, e foi uma causa real de bloqueios de
 * limite de taxa. Um dia PASSADO específico (`dia` explícito, diferente de hoje) ainda busca ao
 * vivo em `obterDesempenho` — é uma consulta rara/manual, não fica num loop de polling, e a
 * resolução por separação já costuma estar quente no cache de quando esse dia era "hoje".
 */

// Maior que o valor "padrão" (150ms) usado em lib/relatorioVendas.ts/lib/olist.ts: essa tela faz
// séries mais longas de chamadas (1 por separação a resolver), então um respiro maior entre elas
// reduz a chance de, por conta própria, acumular volume suficiente pra estourar o limite de taxa.
const RATE_LIMIT_DELAY_MS = 400;
// Teto de segurança por chamada: nunca resolve mais que isso de separações NOVAS numa única
// requisição (evita travar a tela de propósito num dia com volume alto) — o que sobrar fica pra
// próxima chamada (ver `completo` no retorno), que já acha o resto em cache. Baixado de 200: numa
// cache fria (zerada por deploy, sem disco persistente — ver README), resolver 200 de uma vez já é
// ~1min de chamadas em sequência só por essa tela, suficiente pra estourar o limite de taxa por
// conta própria. Com menos por vez, a cache esquenta em várias chamadas pequenas em vez de uma só
// rajada grande.
const MAX_RESOLUCOES_POR_CHAMADA = 40;
const SEM_REGISTROS_ERROR_CODE = 32;
// Mesmo código de lib/devolucao.ts — o Tiny devolve isso com STATUS HTTP 200 (não é um erro de
// rede, então o retry do tinyGet não entra em ação sozinho) quando bloqueia por limite de taxa.
// A mensagem que vem no corpo ("Token inválido") é enganosa — não é o token, é volume de chamadas
// — por isso nunca repassamos esse texto direto pro usuário, e tentamos de novo antes de desistir.
const LIMITE_TAXA_ERROR_CODE = 6;
const TENTATIVAS_LIMITE_TAXA = 4;

const CHAVE_RESOLUCOES = "embalagem:resolucoesPorSeparacao";
const CHAVE_COLABORADORES = "embalagem:colaboradores";
// Snapshot da última busca de resumos "hoje" — o que o job de fundo encontrou da última vez que
// consultou o Tiny. `obterDesempenho` pro dia de hoje monta o relatório só a partir disso, nunca
// busca ao vivo (ver aviso no topo do arquivo).
const CHAVE_RESUMOS_HOJE = "embalagem:resumosHoje";

/** Pedidos/hora assumido quando não configurado — mesmo valor do protótipo original em HTML. */
function pedidosPorHoraPadrao(): number {
  return Number(process.env.EMBALAGEM_PEDIDOS_POR_HORA ?? 50);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * N dias antes de `diaBr` (dd/mm/yyyy) — calendário puro, sem fuso horário envolvido (já
 * recebemos um dia, não um instante, então não há conversão de timezone a fazer). Deliberadamente
 * diferente de `daysAgoInSaoPaulo` em lib/olist.ts, que conta a partir de AGORA — serve bem lá
 * porque só é usada pra "hoje", mas aqui `dia` pode ser qualquer dia no passado.
 */
function diaBrMenosDias(diaBr: string, dias: number): string {
  const [d, m, y] = diaBr.split("/").map(Number);
  const data = new Date(y, m - 1, d);
  data.setDate(data.getDate() - dias);
  const dd = String(data.getDate()).padStart(2, "0");
  const mm = String(data.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${data.getFullYear()}`;
}

interface RetornoComErro {
  status: string;
  codigo_erro?: number;
  erros?: { erro: string }[];
}

// O Tiny nem sempre manda codigo_erro:6 junto com essa mensagem — já vimos o mesmo texto chegar
// sem esse código (ou com outro). O texto em si é o sinal mais confiável de que é limite de taxa,
// não o código, então checa os dois: codigo_erro:6 OU a mensagem "Token inválido" bate.
function ehLimiteDeTaxa(retorno: RetornoComErro): boolean {
  if (retorno.codigo_erro === LIMITE_TAXA_ERROR_CODE) return true;
  return retorno.erros?.some((e) => /token inv[aá]lido/i.test(e.erro)) ?? false;
}

function falhaLimiteTaxa(): Error {
  return new Error("O Tiny bloqueou temporariamente as requisições (limite de taxa excedido). Aguarde alguns segundos e tente de novo.");
}

function falhaTiny(prefixo: string, retorno: RetornoComErro): Error {
  if (ehLimiteDeTaxa(retorno)) return falhaLimiteTaxa();
  const detalhe = retorno.erros?.map((e) => e.erro).join("; ") ?? "erro desconhecido";
  return new Error(`${prefixo}: ${detalhe}`);
}

/**
 * Mesma chamada de `tinyGet`, mas tenta de novo com espera crescente quando o limite de taxa
 * persiste, nas duas formas que o Tiny usa pra sinalizar isso:
 * 1. `codigo_erro: 6` dentro de uma resposta HTTP 200 normal — o `tinyGet` não enxerga isso como
 *    falha (não é erro de rede/HTTP), então sem tratar aqui uma única chamada "engasgada" entrava
 *    direto no relatório como se fosse definitivo.
 * 2. HTTP 429 de verdade — o `tinyGet` já tenta de novo sozinho (3x, ~2s de espera total), mas numa
 *    rajada mais longa isso não é suficiente; aqui tenta mais um tanto antes de desistir mesmo.
 */
async function tinyGetComRetryDeLimiteTaxa<T extends { retorno: RetornoComErro }>(
  endpoint: string,
  params: Record<string, string>,
): Promise<T> {
  let resposta: T | undefined;
  let erroHttp: Error | undefined;

  for (let tentativa = 1; tentativa <= TENTATIVAS_LIMITE_TAXA; tentativa++) {
    try {
      resposta = await tinyGet<T>(endpoint, params);
      erroHttp = undefined;
      if (!ehLimiteDeTaxa(resposta.retorno)) return resposta;
    } catch (error) {
      if (!(error instanceof Error) || !/\(429\)/.test(error.message)) throw error;
      erroHttp = error;
    }
    if (tentativa < TENTATIVAS_LIMITE_TAXA) await sleep(800 * tentativa);
  }

  if (erroHttp) throw falhaLimiteTaxa();
  return resposta!;
}

interface SeparacaoResumo {
  id: string;
  dataCheckout?: string | null;
}

interface SeparacaoPesquisaResponse {
  retorno: RetornoComErro & { numero_paginas?: number; separacoes?: SeparacaoResumo[] };
}

interface SeparacaoDetalhe {
  idUsuarioEmbalador?: string | null;
}

interface SeparacaoObterResponse {
  retorno: RetornoComErro & { separacao?: SeparacaoDetalhe };
}

/** Resumos "Embalada" (situacao=3) cujo dataCheckout bate com `dia` — mesma janela+filtro de lib/olist.ts. */
async function buscarResumosEmbaladosNoDia(dia: string): Promise<SeparacaoResumo[]> {
  const dataInicial = diaBrMenosDias(dia, embaladasWindowDays());
  const encontrados: SeparacaoResumo[] = [];
  let pagina = 1;
  let totalPaginas = 1;

  do {
    const json = await tinyGetComRetryDeLimiteTaxa<SeparacaoPesquisaResponse>("separacao.pesquisa.php", {
      situacao: String(SITUACAO.embaladas),
      dataInicial,
      dataFinal: dia,
      pagina: String(pagina),
    });
    const { retorno } = json;
    if (retorno.status !== "OK") {
      if (retorno.codigo_erro === SEM_REGISTROS_ERROR_CODE) break;
      throw falhaTiny("Tiny recusou a busca de separações embaladas", retorno);
    }

    for (const resumo of retorno.separacoes ?? []) {
      if (resumo.dataCheckout === dia) encontrados.push(resumo);
    }

    totalPaginas = retorno.numero_paginas ?? 1;
    pagina++;
    if (pagina <= totalPaginas) await sleep(RATE_LIMIT_DELAY_MS);
  } while (pagina <= totalPaginas);

  return encontrados;
}

type ResolucoesPorSeparacao = Record<string, { idUsuarioEmbalador: string | null; dataCheckout: string }>;

async function resolverEmbaladores(
  resumos: SeparacaoResumo[],
): Promise<{ resolucoes: ResolucoesPorSeparacao; completo: boolean }> {
  const cache = (await store.get<ResolucoesPorSeparacao>(CHAVE_RESOLUCOES)) ?? {};
  const pendentes = resumos.filter((resumo) => !(resumo.id in cache));

  const aResolverAgora = pendentes.slice(0, MAX_RESOLUCOES_POR_CHAMADA);
  const novasResolucoes: ResolucoesPorSeparacao = {};

  for (const resumo of aResolverAgora) {
    const json = await tinyGetComRetryDeLimiteTaxa<SeparacaoObterResponse>("separacao.obter.php", { idSeparacao: resumo.id });
    const { retorno } = json;
    // Só grava no cache quando o Tiny respondeu "OK" de verdade — mesmo sem idUsuarioEmbalador
    // (cai em "não identificado" legitimamente). Qualquer outro status (limite de taxa persistente
    // mesmo após as tentativas, separação removida, etc.) NÃO entra no cache: fica pendente pra
    // tentar de novo na próxima sincronização, em vez de ficar "não identificado" pra sempre por
    // causa de um erro passageiro.
    if (retorno.status === "OK") {
      novasResolucoes[resumo.id] = { idUsuarioEmbalador: retorno.separacao?.idUsuarioEmbalador ?? null, dataCheckout: resumo.dataCheckout ?? "" };
    }
    await sleep(RATE_LIMIT_DELAY_MS);
  }

  if (Object.keys(novasResolucoes).length > 0) {
    await store.update<ResolucoesPorSeparacao>(CHAVE_RESOLUCOES, (atual) => ({ ...(atual ?? {}), ...novasResolucoes }));
  }

  const resolucoesFinais = { ...cache, ...novasResolucoes };
  // Completo de verdade: toda separação pedida já tem uma resolução gravada — cobre tanto o teto
  // de segurança (sobrou pendente por volume) quanto uma falha pontual numa das que tentamos agora
  // (ficou de fora do cache de propósito, ver comentário acima).
  const completo = resumos.every((resumo) => resumo.id in resolucoesFinais);

  return { resolucoes: resolucoesFinais, completo };
}

// Formato antigo era só `Record<id, nome>` (string direto) — mantém aceitando os dois formatos na
// leitura, pra não quebrar cadastros antigos que ainda estejam no cache quando isso for lido.
type RegistroColaborador = { nome: string; bancada?: string };
type RegistroColaboradorOuAntigo = string | RegistroColaborador;

function normalizarRegistro(registro: RegistroColaboradorOuAntigo): RegistroColaborador {
  return typeof registro === "string" ? { nome: registro } : registro;
}

export type ColaboradorEmbalagem = { idUsuarioEmbalador: string; nome: string; bancada?: string };

export async function listarColaboradores(): Promise<ColaboradorEmbalagem[]> {
  const mapa = (await store.get<Record<string, RegistroColaboradorOuAntigo>>(CHAVE_COLABORADORES)) ?? {};
  return Object.entries(mapa)
    .map(([idUsuarioEmbalador, registro]) => ({ idUsuarioEmbalador, ...normalizarRegistro(registro) }))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

export async function salvarColaborador(idUsuarioEmbalador: string, nome: string, bancada?: string): Promise<ColaboradorEmbalagem> {
  const id = idUsuarioEmbalador.trim();
  const nomeLimpo = nome.trim();
  const bancadaLimpa = bancada?.trim();
  if (!id) throw new Error("Informe o ID do usuário no Tiny.");
  if (!nomeLimpo) throw new Error("Informe o nome do colaborador.");

  const registro: RegistroColaborador = bancadaLimpa ? { nome: nomeLimpo, bancada: bancadaLimpa } : { nome: nomeLimpo };
  await store.update<Record<string, RegistroColaboradorOuAntigo>>(CHAVE_COLABORADORES, (atual) => ({ ...(atual ?? {}), [id]: registro }));
  return { idUsuarioEmbalador: id, ...registro };
}

export async function removerColaborador(idUsuarioEmbalador: string): Promise<void> {
  await store.update<Record<string, RegistroColaboradorOuAntigo>>(CHAVE_COLABORADORES, (atual) => {
    const copia = { ...(atual ?? {}) };
    delete copia[idUsuarioEmbalador];
    return copia;
  });
}

/** dd/mm/yyyy → "1h 44min". */
function formatarTempo(horas: number): string {
  const totalMinutos = Math.round(horas * 60);
  const h = Math.floor(totalMinutos / 60);
  const m = totalMinutos % 60;
  return `${h}h ${String(m).padStart(2, "0")}min`;
}

export type DesempenhoColaborador = {
  idUsuarioEmbalador: string;
  /** Nome cadastrado, ou "ID 12345 (sem nome cadastrado)" quando esse ID ainda não foi mapeado. */
  nome: string;
  pedidos: number;
  pedidosPorHora: number;
  horas: number;
  tempoFormatado: string;
};

export type DesempenhoEmbalagem = {
  dia: string;
  colaboradores: DesempenhoColaborador[];
  totalPedidos: number;
  totalHoras: number;
  totalTempoFormatado: string;
  /** Pedidos embalados sem `idUsuarioEmbalador` (campo ausente na resposta do Tiny) — nunca contados em cima de nenhum colaborador. */
  naoIdentificados: number;
  /**
   * false quando ainda restam separações novas a resolver além do teto de segurança desta
   * chamada — o front deve continuar atualizando: a próxima chamada resolve mais, incrementalmente.
   */
  completo: boolean;
  atualizadoEm: string;
};

/** Monta o relatório a partir de resumos+resoluções já em mãos — puro, sem chamar o Tiny. */
function montarRelatorio(
  dia: string,
  resumos: SeparacaoResumo[],
  resolucoes: ResolucoesPorSeparacao,
  completo: boolean,
  colaboradoresCadastrados: ColaboradorEmbalagem[],
): DesempenhoEmbalagem {
  const pedidosPorHora = pedidosPorHoraPadrao();
  const nomePorId = new Map(colaboradoresCadastrados.map((c) => [c.idUsuarioEmbalador, c.nome]));

  const pedidosPorColaborador = new Map<string, number>();
  let naoIdentificados = 0;

  for (const resumo of resumos) {
    // Sem resolução gravada ainda (teto de segurança, ou falha/limite de taxa persistente ao
    // tentar resolver agora) — fica de fora por completo, sem contar como "não identificado"
    // (esse balde é só pra resposta "OK" sem o campo, ver resolverEmbaladores).
    if (!(resumo.id in resolucoes)) continue;
    const idUsuarioEmbalador = resolucoes[resumo.id]?.idUsuarioEmbalador;
    if (!idUsuarioEmbalador) {
      naoIdentificados++;
      continue;
    }
    pedidosPorColaborador.set(idUsuarioEmbalador, (pedidosPorColaborador.get(idUsuarioEmbalador) ?? 0) + 1);
  }

  const colaboradores: DesempenhoColaborador[] = [...pedidosPorColaborador.entries()]
    .map(([idUsuarioEmbalador, pedidos]) => {
      const horas = pedidos / pedidosPorHora;
      return {
        idUsuarioEmbalador,
        nome: nomePorId.get(idUsuarioEmbalador) ?? `ID ${idUsuarioEmbalador} (sem nome cadastrado)`,
        pedidos,
        pedidosPorHora,
        horas,
        tempoFormatado: formatarTempo(horas),
      };
    })
    .sort((a, b) => b.pedidos - a.pedidos);

  const totalPedidos = colaboradores.reduce((soma, c) => soma + c.pedidos, 0);
  const totalHoras = totalPedidos / pedidosPorHora;

  return {
    dia,
    colaboradores,
    totalPedidos,
    totalHoras,
    totalTempoFormatado: formatarTempo(totalHoras),
    naoIdentificados,
    completo,
    atualizadoEm: new Date().toISOString(),
  };
}

type SnapshotResumosHoje = { dia: string; resumos: SeparacaoResumo[] };

/**
 * Único ponto que chama o Tiny pro dia de hoje — acionada pelo job de fundo em server/index.ts,
 * nunca por uma requisição HTTP (ver aviso no topo do arquivo). Busca os resumos do dia e resolve
 * o que puder (dentro do teto de segurança), deixando os dois caches prontos pra
 * `obterDesempenho` só ler, sem nenhuma chamada de rede.
 */
export async function sincronizarEmbalagemHoje(): Promise<void> {
  const dia = todayInSaoPaulo();
  const resumos = await buscarResumosEmbaladosNoDia(dia);
  await store.set(CHAVE_RESUMOS_HOJE, { dia, resumos } satisfies SnapshotResumosHoje);
  await resolverEmbaladores(resumos);
}

export async function obterDesempenho(diaBr?: string): Promise<DesempenhoEmbalagem> {
  const diaPedido = diaBr?.trim();
  const hoje = todayInSaoPaulo();
  const colaboradoresCadastrados = await listarColaboradores();

  if (!diaPedido || diaPedido === hoje) {
    // Hoje: só lê o que o job de fundo (sincronizarEmbalagemHoje) já deixou em cache — nunca
    // chama o Tiny aqui. Sem sincronização ainda (boot recém-ligado) vira relatório vazio com
    // completo:false, igual o "esqueleto" do painel de separação enquanto a primeira sync não
    // roda.
    const snapshot = await store.get<SnapshotResumosHoje>(CHAVE_RESUMOS_HOJE);
    const sincronizado = snapshot?.dia === hoje;
    const resumos = sincronizado ? snapshot!.resumos : [];
    const resolucoes = (await store.get<ResolucoesPorSeparacao>(CHAVE_RESOLUCOES)) ?? {};
    const completo = sincronizado && resumos.every((resumo) => resumo.id in resolucoes);
    return montarRelatorio(hoje, resumos, resolucoes, completo, colaboradoresCadastrados);
  }

  // Dia passado específico — consulta rara/manual, ainda busca ao vivo (ver aviso no topo do
  // arquivo); a resolução por separação normalmente já está quente no cache de quando esse dia
  // era "hoje", então isso raramente gera chamada nova de verdade.
  const resumos = await buscarResumosEmbaladosNoDia(diaPedido);
  const { resolucoes, completo } = await resolverEmbaladores(resumos);
  return montarRelatorio(diaPedido, resumos, resolucoes, completo, colaboradoresCadastrados);
}

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
 * ATENÇÃO — igual ao aviso já registrado em lib/relatorioVendas.ts e lib/devolucao.ts: não deu
 * pra confirmar `separacao.obter.php`/`idUsuarioEmbalador` contra a documentação ao vivo do Tiny
 * (tiny.com.br bloqueado no ambiente onde isso foi escrito) — veio de uma pesquisa feita fora
 * deste ambiente, colada pelo usuário, não de um teste real contra a API. **Teste com um dia real
 * antes de confiar nos números.** Se o campo vier ausente/vazio pra uma separação, ela cai no
 * balde "não identificado" em vez de quebrar o resto do relatório — nunca assume um valor.
 *
 * O resultado de `separacao.obter.php` é cacheado por `idSeparacao` pra sempre (depois de
 * embalada, quem embalou não muda) — uma nova chamada só resolve as separações NOVAS desde a
 * última vez, mesma ideia de "nunca reprocessar o que já foi resolvido" de
 * lib/shopeeImportacao.ts. Isso existe porque `separacao.obter.php` custa 1 chamada por
 * separação — sem cache, cada atualização da tela re-consultaria o dia inteiro de novo.
 */

const RATE_LIMIT_DELAY_MS = 150; // mesmo valor usado em lib/relatorioVendas.ts
// Teto de segurança por chamada: nunca resolve mais que isso de separações NOVAS numa única
// requisição (evita travar a tela de propósito num dia com volume alto) — o que sobrar fica pra
// próxima chamada (ver `completo` no retorno), que já acha o resto em cache.
const MAX_RESOLUCOES_POR_CHAMADA = 200;
const SEM_REGISTROS_ERROR_CODE = 32;

const CHAVE_RESOLUCOES = "embalagem:resolucoesPorSeparacao";
const CHAVE_COLABORADORES = "embalagem:colaboradores";

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

function falhaTiny(prefixo: string, retorno: RetornoComErro): Error {
  const detalhe = retorno.erros?.map((e) => e.erro).join("; ") ?? "erro desconhecido";
  return new Error(`${prefixo}: ${detalhe}`);
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
    const json = await tinyGet<SeparacaoPesquisaResponse>("separacao.pesquisa.php", {
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
    const json = await tinyGet<SeparacaoObterResponse>("separacao.obter.php", { idSeparacao: resumo.id });
    const { retorno } = json;
    // Falha isolada (ex.: separação removida entre a pesquisa e o obter) não derruba o resto —
    // essa separação some do relatório em vez de quebrar a sincronização inteira.
    const idUsuarioEmbalador = retorno.status === "OK" ? retorno.separacao?.idUsuarioEmbalador ?? null : null;
    novasResolucoes[resumo.id] = { idUsuarioEmbalador, dataCheckout: resumo.dataCheckout ?? "" };
    await sleep(RATE_LIMIT_DELAY_MS);
  }

  if (Object.keys(novasResolucoes).length > 0) {
    await store.update<ResolucoesPorSeparacao>(CHAVE_RESOLUCOES, (atual) => ({ ...(atual ?? {}), ...novasResolucoes }));
  }

  return { resolucoes: { ...cache, ...novasResolucoes }, completo: pendentes.length <= MAX_RESOLUCOES_POR_CHAMADA };
}

export type ColaboradorEmbalagem = { idUsuarioEmbalador: string; nome: string };

export async function listarColaboradores(): Promise<ColaboradorEmbalagem[]> {
  const mapa = (await store.get<Record<string, string>>(CHAVE_COLABORADORES)) ?? {};
  return Object.entries(mapa)
    .map(([idUsuarioEmbalador, nome]) => ({ idUsuarioEmbalador, nome }))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

export async function salvarColaborador(idUsuarioEmbalador: string, nome: string): Promise<ColaboradorEmbalagem> {
  const id = idUsuarioEmbalador.trim();
  const nomeLimpo = nome.trim();
  if (!id) throw new Error("Informe o ID do usuário no Tiny.");
  if (!nomeLimpo) throw new Error("Informe o nome do colaborador.");

  await store.update<Record<string, string>>(CHAVE_COLABORADORES, (atual) => ({ ...(atual ?? {}), [id]: nomeLimpo }));
  return { idUsuarioEmbalador: id, nome: nomeLimpo };
}

export async function removerColaborador(idUsuarioEmbalador: string): Promise<void> {
  await store.update<Record<string, string>>(CHAVE_COLABORADORES, (atual) => {
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

export async function obterDesempenho(diaBr?: string): Promise<DesempenhoEmbalagem> {
  const dia = diaBr?.trim() || todayInSaoPaulo();
  const pedidosPorHora = pedidosPorHoraPadrao();

  const resumos = await buscarResumosEmbaladosNoDia(dia);
  const { resolucoes, completo } = await resolverEmbaladores(resumos);
  const colaboradoresCadastrados = await listarColaboradores();
  const nomePorId = new Map(colaboradoresCadastrados.map((c) => [c.idUsuarioEmbalador, c.nome]));

  const pedidosPorColaborador = new Map<string, number>();
  let naoIdentificados = 0;

  for (const resumo of resumos) {
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

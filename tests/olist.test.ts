import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function retornoOk(separacoes: unknown[], numero_paginas = 1) {
  return { retorno: { status: "OK", pagina: 1, numero_paginas, separacoes } };
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200 });
}

async function freshOlist() {
  vi.resetModules();
  process.env.OLIST_API_TOKEN = "token-de-teste";
  delete process.env.OLIST_API_BASE_URL;
  delete process.env.OLIST_API_FORMAT;
  return import("../lib/olist");
}

describe("fetchSeparacaoCountsLive", () => {
  let dataDir: string;

  beforeEach(async () => {
    // Sem isso, fetchSeparacaoCountsLive() grava o snapshot no ./data de
    // verdade do projeto (lib/store.ts cai no default quando DATA_DIR não
    // está setado) — já aconteceu e poluiu o cache real com números de teste.
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "olist-test-"));
    process.env.DATA_DIR = dataDir;
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it("aguardando/em separacao: filtram por dataCriacao=hoje (parametro nativo da API)", async () => {
    const fetchMock = vi.mocked(fetch);
    const dateParamsBySituacao = new Map<string, { dataInicial: string | null; dataFinal: string | null }>();
    fetchMock.mockImplementation(async (input) => {
      const url = new URL(String(input));
      const situacao = url.searchParams.get("situacao")!;
      dateParamsBySituacao.set(situacao, {
        dataInicial: url.searchParams.get("dataInicial"),
        dataFinal: url.searchParams.get("dataFinal"),
      });
      return jsonResponse(retornoOk([{}]));
    });

    const { fetchSeparacaoCountsLive, SITUACAO } = await freshOlist();
    await fetchSeparacaoCountsLive();

    for (const situacao of [SITUACAO.aguardandoSeparacao, SITUACAO.emSeparacao]) {
      const params = dateParamsBySituacao.get(String(situacao));
      expect(params?.dataInicial).toBeTruthy();
      expect(params?.dataInicial).toBe(params?.dataFinal);
    }
  });

  it("separadas: busca sem filtro de data e conta client-side por dataSeparacao=hoje", async () => {
    const fetchMock = vi.mocked(fetch);
    let sawDateParamForSeparadas = false;
    const hoje = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo" }).format(new Date());

    fetchMock.mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.searchParams.get("situacao") !== "2") return jsonResponse(retornoOk([]));
      if (url.searchParams.get("dataInicial")) sawDateParamForSeparadas = true;
      return jsonResponse(
        retornoOk([{ dataSeparacao: hoje }, { dataSeparacao: hoje }, { dataSeparacao: "01/01/2020" }]),
      );
    });

    const { fetchSeparacaoCountsLive } = await freshOlist();
    const snapshot = await fetchSeparacaoCountsLive();

    expect(sawDateParamForSeparadas).toBe(false);
    expect(snapshot.counts.separadas).toBe(2);
  });

  it("pagina por todas as paginas ao contar separadas por dataSeparacao", async () => {
    const fetchMock = vi.mocked(fetch);
    const hoje = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo" }).format(new Date());

    fetchMock.mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.searchParams.get("situacao") !== "2") return jsonResponse(retornoOk([]));
      const pagina = Number(url.searchParams.get("pagina"));
      if (pagina === 1) {
        return jsonResponse(retornoOk(new Array(100).fill({ dataSeparacao: hoje }), 2));
      }
      return jsonResponse(retornoOk([{ dataSeparacao: hoje }, { dataSeparacao: "01/01/2020" }], 2));
    });

    const { fetchSeparacaoCountsLive } = await freshOlist();
    const snapshot = await fetchSeparacaoCountsLive();

    expect(snapshot.counts.separadas).toBe(101);
  });

  it("embaladas: filtra por dataCriacao numa janela de dias e conta client-side por dataCheckout=hoje", async () => {
    const fetchMock = vi.mocked(fetch);
    const hoje = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo" }).format(new Date());
    let sawDateRangeForEmbaladas = false;

    fetchMock.mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.searchParams.get("situacao") !== "3") return jsonResponse(retornoOk([]));
      if (url.searchParams.get("dataInicial") && url.searchParams.get("dataFinal")) {
        sawDateRangeForEmbaladas = true;
      }
      return jsonResponse(
        retornoOk([{ dataCheckout: hoje }, { dataCheckout: hoje }, { dataCheckout: "01/01/2020" }, { dataCheckout: null }]),
      );
    });

    const { fetchSeparacaoCountsLive } = await freshOlist();
    const snapshot = await fetchSeparacaoCountsLive();

    expect(sawDateRangeForEmbaladas).toBe(true);
    expect(snapshot.counts.embaladas).toBe(2);
  });

  it("embaladas: quando a janela estoura o teto de paginas, mantem o valor anterior em cache sem falhar as outras contagens", async () => {
    const fetchMock = vi.mocked(fetch);

    fetchMock.mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.searchParams.get("situacao") === "3") {
        return jsonResponse(retornoOk([{}], 41));
      }
      return jsonResponse(retornoOk([]));
    });

    const { fetchSeparacaoCountsLive } = await freshOlist();
    const snapshot = await fetchSeparacaoCountsLive();

    expect(snapshot.counts.embaladas).toBeNull();
    expect(snapshot.counts.aguardandoSeparacao).toBe(0);
  });

  it("fetchCoreCountsLive: atualiza as 3 etapas exatas e preserva o embaladas que já estava em cache", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async () => jsonResponse(retornoOk([{}])));

    const olist = await freshOlist();
    const embaladasSnapshot = await olist.fetchEmbaladasCountLive(); // popula o cache com embaladas != null
    const snapshot = await olist.fetchCoreCountsLive();

    expect(snapshot.counts.aguardandoSeparacao).toBe(1);
    expect(snapshot.counts.embaladas).toBe(embaladasSnapshot.counts.embaladas);
    expect(snapshot.counts.embaladas).not.toBeNull();
  });

  it("fetchEmbaladasCountLive: atualiza so o embaladas e preserva as outras 3 que ja estavam em cache", async () => {
    const fetchMock = vi.mocked(fetch);
    let situacaoEmbaladasCalls = 0;
    fetchMock.mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.searchParams.get("situacao") === "3") situacaoEmbaladasCalls++;
      return jsonResponse(retornoOk([{}]));
    });

    const olist = await freshOlist();
    await olist.fetchCoreCountsLive(); // popula o cache com aguardando/em separacao/separadas != 0
    const before = await olist.getCachedCounts();
    const snapshot = await olist.fetchEmbaladasCountLive();

    expect(snapshot.counts.aguardandoSeparacao).toBe(before?.counts.aguardandoSeparacao);
    expect(snapshot.counts.emSeparacao).toBe(before?.counts.emSeparacao);
    expect(snapshot.counts.separadas).toBe(before?.counts.separadas);
    expect(situacaoEmbaladasCalls).toBeGreaterThan(0);
  });

  it("rejeita quando o Olist devolve status de erro", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(
      async () => jsonResponse({ retorno: { status: "Erro", erros: [{ erro: "Token inválido" }] } }),
    );

    const { fetchSeparacaoCountsLive } = await freshOlist();
    await expect(fetchSeparacaoCountsLive()).rejects.toThrow("Token inválido");
  });

  it("trata codigo_erro 32 (consulta sem registros) como contagem zero, nao como falha", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async () => jsonResponse({ retorno: { status: "Erro", codigo_erro: 32 } }));

    const { fetchSeparacaoCountsLive } = await freshOlist();
    const snapshot = await fetchSeparacaoCountsLive();

    expect(snapshot.counts).toEqual({
      aguardandoSeparacao: 0,
      emSeparacao: 0,
      separadas: 0,
      embaladas: 0,
    });
  });
});

describe("isConfigured", () => {
  it("false sem OLIST_API_TOKEN, true com", async () => {
    vi.resetModules();
    delete process.env.OLIST_API_TOKEN;
    const semToken = await import("../lib/olist");
    expect(semToken.isConfigured()).toBe(false);

    vi.resetModules();
    process.env.OLIST_API_TOKEN = "abc";
    const comToken = await import("../lib/olist");
    expect(comToken.isConfigured()).toBe(true);
  });
});

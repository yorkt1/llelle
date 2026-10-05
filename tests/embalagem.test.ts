import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200 });
}

function endpointDe(input: unknown): string {
  return new URL(String(input)).pathname.split("/").pop()!;
}

async function freshEmbalagem() {
  vi.resetModules();
  process.env.OLIST_API_TOKEN = "token-de-teste";
  delete process.env.OLIST_API_BASE_URL;
  delete process.env.OLIST_API_FORMAT;
  delete process.env.OLIST_EMBALADAS_WINDOW_DAYS;
  delete process.env.EMBALAGEM_PEDIDOS_POR_HORA;
  return import("../lib/embalagem");
}

describe("embalagem", () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "embalagem-test-"));
    process.env.DATA_DIR = dataDir;
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(async () => {
    delete process.env.DATA_DIR;
    vi.unstubAllGlobals();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  describe("obterDesempenho", () => {
    it("agrupa por idUsuarioEmbalador, usa o nome cadastrado quando existe, e calcula pedidos/hora", async () => {
      const fetchMock = vi.mocked(fetch);
      fetchMock.mockImplementation(async (input) => {
        const url = new URL(String(input));
        switch (endpointDe(input)) {
          case "separacao.pesquisa.php":
            expect(url.searchParams.get("situacao")).toBe("3");
            expect(url.searchParams.get("dataFinal")).toBe("05/10/2026");
            return jsonResponse({
              retorno: {
                status: "OK",
                numero_paginas: 1,
                separacoes: [
                  { id: "1", dataCheckout: "05/10/2026" },
                  { id: "2", dataCheckout: "05/10/2026" },
                  { id: "3", dataCheckout: "05/10/2026" },
                  { id: "4", dataCheckout: "04/10/2026" }, // dia diferente — não deve entrar
                ],
              },
            });
          case "separacao.obter.php": {
            const idSeparacao = url.searchParams.get("idSeparacao");
            if (idSeparacao === "1") return jsonResponse({ retorno: { status: "OK", separacao: { idUsuarioEmbalador: "111" } } });
            if (idSeparacao === "2") return jsonResponse({ retorno: { status: "OK", separacao: { idUsuarioEmbalador: "111" } } });
            if (idSeparacao === "3") return jsonResponse({ retorno: { status: "OK", separacao: { idUsuarioEmbalador: "222" } } });
            throw new Error(`idSeparacao inesperado: ${idSeparacao}`);
          }
          default:
            throw new Error(`endpoint inesperado: ${String(input)}`);
        }
      });

      const { obterDesempenho, salvarColaborador } = await freshEmbalagem();
      await salvarColaborador("111", "Geovane");

      const resultado = await obterDesempenho("05/10/2026");

      expect(resultado.dia).toBe("05/10/2026");
      expect(resultado.totalPedidos).toBe(3);
      expect(resultado.naoIdentificados).toBe(0);
      expect(resultado.completo).toBe(true);
      expect(resultado.colaboradores).toEqual([
        { idUsuarioEmbalador: "111", nome: "Geovane", pedidos: 2, pedidosPorHora: 50, horas: 2 / 50, tempoFormatado: "0h 02min" },
        {
          idUsuarioEmbalador: "222",
          nome: "ID 222 (sem nome cadastrado)",
          pedidos: 1,
          pedidosPorHora: 50,
          horas: 1 / 50,
          tempoFormatado: "0h 01min",
        },
      ]);
    });

    it("pedido sem idUsuarioEmbalador (campo ausente na resposta) conta como não identificado, sem quebrar o resto", async () => {
      const fetchMock = vi.mocked(fetch);
      fetchMock.mockImplementation(async (input) => {
        switch (endpointDe(input)) {
          case "separacao.pesquisa.php":
            return jsonResponse({
              retorno: { status: "OK", numero_paginas: 1, separacoes: [{ id: "1", dataCheckout: "05/10/2026" }] },
            });
          case "separacao.obter.php":
            return jsonResponse({ retorno: { status: "OK", separacao: {} } }); // sem idUsuarioEmbalador
          default:
            throw new Error(`endpoint inesperado: ${String(input)}`);
        }
      });

      const { obterDesempenho } = await freshEmbalagem();
      const resultado = await obterDesempenho("05/10/2026");

      expect(resultado.naoIdentificados).toBe(1);
      expect(resultado.totalPedidos).toBe(0);
      expect(resultado.colaboradores).toEqual([]);
    });

    it("nenhuma separação embalada no dia (codigo_erro 32) devolve relatório vazio, não lança erro", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ retorno: { status: "Erro", codigo_erro: 32 } }));

      const { obterDesempenho } = await freshEmbalagem();
      const resultado = await obterDesempenho("05/10/2026");

      expect(resultado).toMatchObject({ totalPedidos: 0, naoIdentificados: 0, colaboradores: [] });
    });

    it("cacheia a resolução por separação — uma segunda chamada no mesmo dia não re-consulta separacao.obter.php pras mesmas separações", async () => {
      let chamadasObter = 0;
      const fetchMock = vi.mocked(fetch);
      fetchMock.mockImplementation(async (input) => {
        switch (endpointDe(input)) {
          case "separacao.pesquisa.php":
            return jsonResponse({
              retorno: { status: "OK", numero_paginas: 1, separacoes: [{ id: "1", dataCheckout: "05/10/2026" }] },
            });
          case "separacao.obter.php":
            chamadasObter++;
            return jsonResponse({ retorno: { status: "OK", separacao: { idUsuarioEmbalador: "111" } } });
          default:
            throw new Error(`endpoint inesperado: ${String(input)}`);
        }
      });

      const { obterDesempenho } = await freshEmbalagem();
      await obterDesempenho("05/10/2026");
      await obterDesempenho("05/10/2026");

      expect(chamadasObter).toBe(1);
    });

    it("usa EMBALAGEM_PEDIDOS_POR_HORA quando configurado, em vez do padrão de 50", async () => {
      const fetchMock = vi.mocked(fetch);
      fetchMock.mockImplementation(async (input) => {
        switch (endpointDe(input)) {
          case "separacao.pesquisa.php":
            return jsonResponse({
              retorno: { status: "OK", numero_paginas: 1, separacoes: [{ id: "1", dataCheckout: "05/10/2026" }] },
            });
          case "separacao.obter.php":
            return jsonResponse({ retorno: { status: "OK", separacao: { idUsuarioEmbalador: "111" } } });
          default:
            throw new Error(`endpoint inesperado: ${String(input)}`);
        }
      });

      const { obterDesempenho } = await freshEmbalagem();
      process.env.EMBALAGEM_PEDIDOS_POR_HORA = "40";
      const resultado = await obterDesempenho("05/10/2026");

      expect(resultado.colaboradores[0].pedidosPorHora).toBe(40);
    });
  });

  describe("colaboradores", () => {
    it("salva, lista em ordem alfabética e remove", async () => {
      const { salvarColaborador, listarColaboradores, removerColaborador } = await freshEmbalagem();

      await salvarColaborador("222", "Werisvan");
      await salvarColaborador("111", "Alex");

      expect(await listarColaboradores()).toEqual([
        { idUsuarioEmbalador: "111", nome: "Alex" },
        { idUsuarioEmbalador: "222", nome: "Werisvan" },
      ]);

      await removerColaborador("111");
      expect(await listarColaboradores()).toEqual([{ idUsuarioEmbalador: "222", nome: "Werisvan" }]);
    });

    it("rejeita ID ou nome vazio sem salvar nada", async () => {
      const { salvarColaborador } = await freshEmbalagem();
      await expect(salvarColaborador("", "Geovane")).rejects.toThrow(/ID/i);
      await expect(salvarColaborador("111", "  ")).rejects.toThrow(/nome/i);
      expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    });
  });
});

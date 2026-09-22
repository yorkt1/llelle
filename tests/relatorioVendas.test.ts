import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

async function freshRelatorio() {
  vi.resetModules();
  process.env.OLIST_API_TOKEN = "token-de-teste";
  delete process.env.OLIST_API_BASE_URL;
  delete process.env.OLIST_API_FORMAT;
  return import("../lib/relatorioVendas");
}

function endpointDe(input: unknown): string {
  return new URL(String(input)).pathname.split("/").pop()!;
}

describe("gerarRelatorioVendas", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("soma quantidades por dia/produto, só dos itens que casam com o termo buscado", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (endpointDe(input) === "pedidos.pesquisa.php") {
        expect(url.searchParams.get("dataInicial")).toBe("30/07/2026");
        expect(url.searchParams.get("dataFinal")).toBe("25/08/2026");
        return jsonResponse({
          retorno: {
            status: "OK",
            numero_paginas: 1,
            pedidos: [
              { pedido: { id: "1", data_pedido: "30/07/2026" } },
              { pedido: { id: "2", data_pedido: "30/07/2026" } },
              { pedido: { id: "3", data_pedido: "31/07/2026" } },
            ],
          },
        });
      }
      if (endpointDe(input) === "pedido.obter.php") {
        const respostas: Record<string, unknown> = {
          "1": {
            retorno: {
              status: "OK",
              pedido: { itens: [{ item: { descricao: "Sanduicheira Elétrica 110V", quantidade: "2" } }] },
            },
          },
          "2": {
            retorno: {
              status: "OK",
              pedido: {
                itens: [
                  { item: { descricao: "Sanduicheira Elétrica 220V", quantidade: "1" } },
                  { item: { descricao: "Cafeteira 1.5L", quantidade: "5" } },
                ],
              },
            },
          },
          "3": {
            retorno: {
              status: "OK",
              pedido: { itens: [{ item: { descricao: "SANDUICHEIRA elétrica 110v", quantidade: "3" } }] },
            },
          },
        };
        return jsonResponse(respostas[url.searchParams.get("id")!]);
      }
      throw new Error(`endpoint inesperado: ${String(input)}`);
    });

    const { gerarRelatorioVendas } = await freshRelatorio();
    const linhas = await gerarRelatorioVendas("sanduicheira", "2026-07-30", "2026-08-25");

    expect(linhas).toEqual(
      expect.arrayContaining([
        { data: "2026-07-30", produto: "Sanduicheira Elétrica 110V", quantidade: 2 },
        { data: "2026-07-30", produto: "Sanduicheira Elétrica 220V", quantidade: 1 },
        { data: "2026-07-31", produto: "SANDUICHEIRA elétrica 110v", quantidade: 3 },
      ]),
    );
    expect(linhas).toHaveLength(3); // "Cafeteira" não casa com o termo buscado
  });

  it("pagina pelos pedidos.pesquisa.php até acabar as páginas", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (input) => {
      if (endpointDe(input) === "pedidos.pesquisa.php") {
        const url = new URL(String(input));
        const pagina = Number(url.searchParams.get("pagina"));
        if (pagina === 1) {
          return jsonResponse({ retorno: { status: "OK", numero_paginas: 2, pedidos: [{ pedido: { id: "1", data_pedido: "30/07/2026" } }] } });
        }
        return jsonResponse({ retorno: { status: "OK", numero_paginas: 2, pedidos: [{ pedido: { id: "2", data_pedido: "31/07/2026" } }] } });
      }
      return jsonResponse({ retorno: { status: "OK", pedido: { itens: [] } } });
    });

    const { gerarRelatorioVendas } = await freshRelatorio();
    const progresso: number[] = [];
    await gerarRelatorioVendas("sanduicheira", "2026-07-30", "2026-08-25", (p) => progresso.push(p.total));

    expect(progresso[0]).toBe(2); // 2 pedidos no total, vindos das 2 páginas
  });

  it("trata codigo_erro 32 (sem pedidos no período) como lista vazia, nao como falha", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async () => jsonResponse({ retorno: { status: "Erro", codigo_erro: 32 } }));

    const { gerarRelatorioVendas } = await freshRelatorio();
    const linhas = await gerarRelatorioVendas("sanduicheira", "2026-07-30", "2026-08-25");

    expect(linhas).toEqual([]);
  });

  it("lanca erro claro quando o Tiny recusa a busca de pedidos", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async () => jsonResponse({ retorno: { status: "Erro", erros: [{ erro: "Token inválido" }] } }));

    const { gerarRelatorioVendas } = await freshRelatorio();
    await expect(gerarRelatorioVendas("sanduicheira", "2026-07-30", "2026-08-25")).rejects.toThrow("Token inválido");
  });
});

describe("pivotarPorDia", () => {
  it("preenche todo dia do periodo com 0, mesmo os sem venda, e ordena produtos alfabeticamente", async () => {
    const { pivotarPorDia } = await freshRelatorio();

    const pivot = pivotarPorDia(
      [
        { data: "2026-07-30", produto: "Sanduicheira 220V", quantidade: 4 },
        { data: "2026-08-01", produto: "Sanduicheira 110V", quantidade: 2 },
      ],
      "2026-07-30",
      "2026-08-01",
    );

    expect(pivot.dias).toEqual(["2026-07-30", "2026-07-31", "2026-08-01"]);
    expect(pivot.produtos).toEqual(["Sanduicheira 110V", "Sanduicheira 220V"]);
    expect(pivot.quantidadePorDiaEProduto["2026-07-30"]).toEqual({ "Sanduicheira 110V": 0, "Sanduicheira 220V": 4 });
    expect(pivot.quantidadePorDiaEProduto["2026-07-31"]).toEqual({ "Sanduicheira 110V": 0, "Sanduicheira 220V": 0 });
    expect(pivot.quantidadePorDiaEProduto["2026-08-01"]).toEqual({ "Sanduicheira 110V": 2, "Sanduicheira 220V": 0 });
  });
});

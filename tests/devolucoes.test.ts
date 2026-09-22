import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200 });
}

async function freshDevolucoes() {
  vi.resetModules();
  process.env.OLIST_API_TOKEN = "token-de-teste";
  delete process.env.OLIST_API_BASE_URL;
  delete process.env.OLIST_API_FORMAT;
  return import("../lib/devolucoes");
}

function endpointDe(input: unknown): string {
  return new URL(String(input)).pathname.split("/").pop()!;
}

describe("buscarPedidoPorCodigo", () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "devolucoes-test-"));
    process.env.DATA_DIR = dataDir;
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it("acha por numero, traz cliente/produtos do pedido.obter e a nota fiscal do notas.fiscais.pesquisa", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (input) => {
      const url = new URL(String(input));
      switch (endpointDe(input)) {
        case "pedidos.pesquisa.php":
          expect(url.searchParams.get("numero")).toBe("10452");
          return jsonResponse({ retorno: { status: "OK", pedidos: [{ pedido: { id: "999", numero: "10452" } }] } });
        case "pedido.obter.php":
          expect(url.searchParams.get("id")).toBe("999");
          return jsonResponse({
            retorno: {
              status: "OK",
              pedido: {
                numero: "10452",
                data_pedido: "20/01/2024",
                cliente: { nome: "Fulano de Tal", cpf_cnpj: "12345678900", tipo_pessoa: "F" },
                itens: [{ item: { codigo: "SKU1", descricao: "Produto X", quantidade: "2" } }],
              },
            },
          });
        case "notas.fiscais.pesquisa.php":
          expect(url.searchParams.get("numeroPedido")).toBe("10452");
          return jsonResponse({ retorno: { status: "OK", notas_fiscais: [{ nota_fiscal: { numero: "555" } }] } });
        default:
          throw new Error(`endpoint inesperado: ${String(input)}`);
      }
    });

    const { buscarPedidoPorCodigo } = await freshDevolucoes();
    const pedido = await buscarPedidoPorCodigo("10452");

    expect(pedido).toEqual({
      numeroPedido: "10452",
      numeroNotaFiscal: "555",
      dataPedido: "20/01/2024",
      cliente: { nome: "Fulano de Tal", documento: "12345678900", tipoPessoa: "F" },
      produtos: [{ codigo: "SKU1", descricao: "Produto X", quantidade: 2 }],
    });
  });

  it("cai para numeroEcommerce quando a busca por numero nao acha nada (codigo_erro 32)", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (endpointDe(input) === "pedidos.pesquisa.php") {
        if (url.searchParams.get("numero")) {
          return jsonResponse({ retorno: { status: "Erro", codigo_erro: 32 } });
        }
        expect(url.searchParams.get("numeroEcommerce")).toBe("ABC-1");
        return jsonResponse({ retorno: { status: "OK", pedidos: [{ pedido: { id: "1", numero: "10453" } }] } });
      }
      if (endpointDe(input) === "pedido.obter.php") {
        return jsonResponse({ retorno: { status: "OK", pedido: { numero: "10453", cliente: {}, itens: [] } } });
      }
      return jsonResponse({ retorno: { status: "Erro", codigo_erro: 32 } });
    });

    const { buscarPedidoPorCodigo } = await freshDevolucoes();
    const pedido = await buscarPedidoPorCodigo("ABC-1");

    expect(pedido.numeroPedido).toBe("10453");
  });

  it("lanca erro claro quando nao acha por nenhum dos dois campos", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async () => jsonResponse({ retorno: { status: "Erro", codigo_erro: 32 } }));

    const { buscarPedidoPorCodigo } = await freshDevolucoes();
    await expect(buscarPedidoPorCodigo("nao-existe")).rejects.toThrow(/Nenhum pedido encontrado/);
  });

  it("nota fiscal nao encontrada nao derruba a busca do pedido", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (input) => {
      if (endpointDe(input) === "pedidos.pesquisa.php") {
        return jsonResponse({ retorno: { status: "OK", pedidos: [{ pedido: { id: "1", numero: "10452" } }] } });
      }
      if (endpointDe(input) === "pedido.obter.php") {
        return jsonResponse({ retorno: { status: "OK", pedido: { numero: "10452", cliente: {}, itens: [] } } });
      }
      // notas.fiscais.pesquisa.php falhando de verdade (erro de rede/formato)
      throw new Error("timeout");
    });

    const { buscarPedidoPorCodigo } = await freshDevolucoes();
    const pedido = await buscarPedidoPorCodigo("10452");

    expect(pedido.numeroNotaFiscal).toBeNull();
  });
});

describe("salvarDevolucao / listarDevolucoes", () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "devolucoes-store-test-"));
    process.env.DATA_DIR = dataDir;
  });

  afterEach(async () => {
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it("grava e lista ordenado do mais recente pro mais antigo", async () => {
    vi.resetModules();
    const { salvarDevolucao, listarDevolucoes } = await import("../lib/devolucoes");

    const base = {
      codigo: "10452",
      numeroPedido: "10452",
      numeroNotaFiscal: null,
      clienteNome: "Fulano de Tal",
      clienteDocumento: "12345678900",
      produtoCodigo: "SKU1",
      produtoDescricao: "Produto X",
      defeito: "Veio com o vidro trincado",
    };

    const primeiro = await salvarDevolucao(base);
    await new Promise((resolve) => setTimeout(resolve, 2));
    const segundo = await salvarDevolucao({ ...base, produtoCodigo: "SKU2" });

    const registros = await listarDevolucoes();
    expect(registros.map((r) => r.id)).toEqual([segundo.id, primeiro.id]);
    expect(registros[0].produtoCodigo).toBe("SKU2");
  });
});

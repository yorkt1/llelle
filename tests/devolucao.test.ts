import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200 });
}

async function freshDevolucao() {
  vi.resetModules();
  process.env.OLIST_API_TOKEN = "token-de-teste";
  delete process.env.OLIST_API_BASE_URL;
  delete process.env.OLIST_API_FORMAT;
  return import("../lib/devolucao");
}

function endpointDe(input: unknown): string {
  return new URL(String(input)).pathname.split("/").pop()!;
}

describe("buscarDevolucaoPorNf", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("monta a prévia com cliente em título, cpf formatado, marketplace normalizado e produtoPlanilha por item", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (input) => {
      const url = new URL(String(input));
      switch (endpointDe(input)) {
        case "notas.fiscais.pesquisa.php":
          expect(url.searchParams.get("numero")).toBe("338894");
          expect(url.searchParams.get("tipoNota")).toBe("S");
          return jsonResponse({
            retorno: { status: "OK", notas_fiscais: [{ nota_fiscal: { id: "1", numero: "338894", data_emissao: "07/09/2026" } }] },
          });
        case "nota.fiscal.obter.php":
          expect(url.searchParams.get("id")).toBe("1");
          return jsonResponse({
            retorno: {
              status: "OK",
              nota_fiscal: {
                numero: "338894",
                data_emissao: "07/09/2026",
                numero_ecommerce: "260908EG81DAQJ",
                id_venda: "999",
                cliente: { nome: "JOSE NILTO DE OLIVEIRA", cpf_cnpj: "12345678900" },
                intermediador: { nome: "algum fallback" },
                itens: [{ item: { codigo: "LLECP-110", descricao: "Chaleira Modern Preta 127V", quantidade: "1" } }],
              },
            },
          });
        case "pedido.obter.php":
          expect(url.searchParams.get("id")).toBe("999");
          return jsonResponse({ retorno: { status: "OK", pedido: { ecommerce: { nomeEcommerce: "Shopee" } } } });
        default:
          throw new Error(`endpoint inesperado: ${String(input)}`);
      }
    });

    const { buscarDevolucaoPorNf } = await freshDevolucao();
    const preview = await buscarDevolucaoPorNf("338894");

    expect(preview).toEqual({
      nf: "338894",
      dataEmissao: "07/09/2026",
      cliente: "Jose Nilto De Oliveira",
      cpf: "123.456.789-00",
      idPedido: "260908EG81DAQJ",
      marketplace: "SHOPEE",
      itens: [{ codigo: "LLECP-110", descricao: "Chaleira Modern Preta 127V", quantidade: 1, produtoPlanilha: "CHALEIRA MODERN PRETA 127V" }],
      outras: undefined,
    });
  });

  it("com mais de uma nota, escolhe a de emissao mais recente e devolve o resto em outras", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (input) => {
      if (endpointDe(input) === "notas.fiscais.pesquisa.php") {
        return jsonResponse({
          retorno: {
            status: "OK",
            notas_fiscais: [
              { nota_fiscal: { id: "1", numero: "338894", serie: "1", data_emissao: "01/01/2026" } },
              { nota_fiscal: { id: "2", numero: "338894", serie: "2", data_emissao: "07/09/2026" } },
            ],
          },
        });
      }
      if (endpointDe(input) === "nota.fiscal.obter.php") {
        const url = new URL(String(input));
        expect(url.searchParams.get("id")).toBe("2"); // a mais recente
        return jsonResponse({ retorno: { status: "OK", nota_fiscal: { numero: "338894", cliente: {}, itens: [] } } });
      }
      return jsonResponse({ retorno: { status: "OK" } });
    });

    const { buscarDevolucaoPorNf } = await freshDevolucao();
    const preview = await buscarDevolucaoPorNf("338894");

    expect(preview.outras).toEqual([{ numero: "338894", serie: "1", dataEmissao: "01/01/2026" }]);
  });

  it("nenhuma nota encontrada (codigo_erro 32) lanca NfNaoEncontradaError", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async () => jsonResponse({ retorno: { status: "Erro", codigo_erro: 32 } }));

    const { buscarDevolucaoPorNf, NfNaoEncontradaError } = await freshDevolucao();
    await expect(buscarDevolucaoPorNf("000000")).rejects.toBeInstanceOf(NfNaoEncontradaError);
  });

  it("limite de taxa (codigo_erro 6) lanca TinyLimiteTaxaError", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async () => jsonResponse({ retorno: { status: "Erro", codigo_erro: 6 } }));

    const { buscarDevolucaoPorNf, TinyLimiteTaxaError } = await freshDevolucao();
    await expect(buscarDevolucaoPorNf("338894")).rejects.toBeInstanceOf(TinyLimiteTaxaError);
  });

  it("sem id_venda, usa o intermediador da nota como marketplace", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (input) => {
      if (endpointDe(input) === "notas.fiscais.pesquisa.php") {
        return jsonResponse({ retorno: { status: "OK", notas_fiscais: [{ nota_fiscal: { id: "1", numero: "1", data_emissao: "01/01/2026" } }] } });
      }
      if (endpointDe(input) === "nota.fiscal.obter.php") {
        return jsonResponse({
          retorno: { status: "OK", nota_fiscal: { numero: "1", cliente: {}, intermediador: { nome: "Mercado Livre Full" }, itens: [] } },
        });
      }
      throw new Error(`nao deveria chamar ${String(input)}`);
    });

    const { buscarDevolucaoPorNf } = await freshDevolucao();
    const preview = await buscarDevolucaoPorNf("1");

    expect(preview.marketplace).toBe("MERCADO FULL");
  });

  it("marketplace desconhecido cai pro nome em maiusculas", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (input) => {
      if (endpointDe(input) === "notas.fiscais.pesquisa.php") {
        return jsonResponse({ retorno: { status: "OK", notas_fiscais: [{ nota_fiscal: { id: "1", numero: "1", data_emissao: "01/01/2026" } }] } });
      }
      if (endpointDe(input) === "nota.fiscal.obter.php") {
        return jsonResponse({
          retorno: { status: "OK", nota_fiscal: { numero: "1", cliente: {}, intermediador: { nome: "Loja Própria" }, itens: [] } },
        });
      }
      throw new Error(`nao deveria chamar ${String(input)}`);
    });

    const { buscarDevolucaoPorNf } = await freshDevolucao();
    const preview = await buscarDevolucaoPorNf("1");

    expect(preview.marketplace).toBe("LOJA PRÓPRIA");
  });

  it("formata cnpj (14 digitos) com mascara de pessoa juridica", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (input) => {
      if (endpointDe(input) === "notas.fiscais.pesquisa.php") {
        return jsonResponse({ retorno: { status: "OK", notas_fiscais: [{ nota_fiscal: { id: "1", numero: "1", data_emissao: "01/01/2026" } }] } });
      }
      if (endpointDe(input) === "nota.fiscal.obter.php") {
        return jsonResponse({ retorno: { status: "OK", nota_fiscal: { numero: "1", cliente: { cpf_cnpj: "12345678000199" }, itens: [] } } });
      }
      throw new Error(`nao deveria chamar ${String(input)}`);
    });

    const { buscarDevolucaoPorNf } = await freshDevolucao();
    const preview = await buscarDevolucaoPorNf("1");

    expect(preview.cpf).toBe("12.345.678/0001-99");
  });

  it("anexa dados do Shopee já importados (casados pelo idPedido/numero_ecommerce) e sugere a ocorrência", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (input) => {
      if (endpointDe(input) === "notas.fiscais.pesquisa.php") {
        return jsonResponse({ retorno: { status: "OK", notas_fiscais: [{ nota_fiscal: { id: "1", numero: "1", data_emissao: "01/01/2026" } }] } });
      }
      if (endpointDe(input) === "nota.fiscal.obter.php") {
        return jsonResponse({
          retorno: { status: "OK", nota_fiscal: { numero: "1", numero_ecommerce: "260909HHAER7FN", cliente: {}, itens: [] } },
        });
      }
      throw new Error(`nao deveria chamar ${String(input)}`);
    });

    const { buscarDevolucaoPorNf } = await freshDevolucao();
    const { salvarImportacaoShopee } = await import("../lib/shopeeImportacao");
    salvarImportacaoShopee({
      idPedido: "260909HHAER7FN",
      idDevolucaoShopee: "2609100M3X5919T",
      dataSolicitacao: "2026-09-10",
      motivoDevolucao: "Mudei de ideia",
      descricaoCliente: "Não gostei mais do produto",
    });

    const preview = await buscarDevolucaoPorNf("1");

    expect(preview.shopee).toEqual({
      idDevolucaoShopee: "2609100M3X5919T",
      dataSolicitacao: "2026-09-10",
      motivoDevolucao: "Mudei de ideia",
      ocorrenciaSugerida: "ARREPENDIMENTO",
      descricaoCliente: "Não gostei mais do produto",
      valorReembolso: undefined,
      valorCompensacao: undefined,
    });
  });

  it("sem importação do Shopee pra esse idPedido, preview.shopee fica undefined", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (input) => {
      if (endpointDe(input) === "notas.fiscais.pesquisa.php") {
        return jsonResponse({ retorno: { status: "OK", notas_fiscais: [{ nota_fiscal: { id: "1", numero: "1", data_emissao: "01/01/2026" } }] } });
      }
      if (endpointDe(input) === "nota.fiscal.obter.php") {
        return jsonResponse({
          retorno: { status: "OK", nota_fiscal: { numero: "1", numero_ecommerce: "PEDIDO-SEM-IMPORTACAO", cliente: {}, itens: [] } },
        });
      }
      throw new Error(`nao deveria chamar ${String(input)}`);
    });

    const { buscarDevolucaoPorNf } = await freshDevolucao();
    const preview = await buscarDevolucaoPorNf("1");

    expect(preview.shopee).toBeUndefined();
  });
});

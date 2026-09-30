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

  it("quando o código não é NF, tenta como Nº do pedido (numeroEcommerce) e acha a nota via id_nota_fiscal", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (input) => {
      const url = new URL(String(input));
      switch (endpointDe(input)) {
        case "notas.fiscais.pesquisa.php":
          expect(url.searchParams.get("numero")).toBe("260913UJGQT69B");
          return jsonResponse({ retorno: { status: "Erro", codigo_erro: 32 } }); // não é NF
        case "pedidos.pesquisa.php":
          expect(url.searchParams.get("numeroEcommerce")).toBe("260913UJGQT69B");
          return jsonResponse({ retorno: { status: "OK", pedidos: [{ pedido: { id: "700" } }] } });
        case "pedido.obter.php":
          if (url.searchParams.get("id") === "700") {
            return jsonResponse({ retorno: { status: "OK", pedido: { id_nota_fiscal: "940457856" } } });
          }
          return jsonResponse({ retorno: { status: "OK", pedido: { ecommerce: { nomeEcommerce: "Shopee" } } } });
        case "nota.fiscal.obter.php":
          expect(url.searchParams.get("id")).toBe("940457856");
          return jsonResponse({
            retorno: { status: "OK", nota_fiscal: { numero: "339999", data_emissao: "08/09/2026", cliente: {}, itens: [] } },
          });
        default:
          throw new Error(`endpoint inesperado: ${String(input)}`);
      }
    });

    const { buscarDevolucaoPorNf } = await freshDevolucao();
    const preview = await buscarDevolucaoPorNf("260913UJGQT69B");

    expect(preview.nf).toBe("339999");
  });

  it("quando não acha nem como NF nem como pedido, lanca NfNaoEncontradaError", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (input) => {
      if (endpointDe(input) === "notas.fiscais.pesquisa.php") {
        return jsonResponse({ retorno: { status: "Erro", codigo_erro: 32 } });
      }
      if (endpointDe(input) === "pedidos.pesquisa.php") {
        return jsonResponse({ retorno: { status: "Erro", codigo_erro: 32 } });
      }
      throw new Error(`nao deveria chamar ${String(input)}`);
    });

    const { buscarDevolucaoPorNf, NfNaoEncontradaError } = await freshDevolucao();
    await expect(buscarDevolucaoPorNf("NAO-EXISTE-EM-LUGAR-NENHUM")).rejects.toBeInstanceOf(NfNaoEncontradaError);
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

describe("buscarCandidatosPorNomeCliente", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("busca com o parâmetro cliente + janela de data (dd/mm/yyyy), devolve candidatos com nome/NF/data/produtos, mais recente primeiro", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (input) => {
      const url = new URL(String(input));
      switch (endpointDe(input)) {
        case "notas.fiscais.pesquisa.php": {
          expect(url.searchParams.get("cliente")).toBe("Maria");
          expect(url.searchParams.get("tipoNota")).toBe("S");
          const formatoBr = /^\d{2}\/\d{2}\/\d{4}$/;
          const dataInicial = url.searchParams.get("dataInicial")!;
          const dataFinal = url.searchParams.get("dataFinal")!;
          expect(dataInicial).toMatch(formatoBr);
          expect(dataFinal).toMatch(formatoBr);
          // dataInicial é ~180 dias antes de dataFinal, não o próprio dia.
          expect(dataInicial).not.toBe(dataFinal);
          return jsonResponse({
            retorno: {
              status: "OK",
              notas_fiscais: [
                { nota_fiscal: { id: "1", numero: "100", data_emissao: "01/01/2026" } },
                { nota_fiscal: { id: "2", numero: "200", data_emissao: "15/09/2026" } },
              ],
            },
          });
        }
        case "nota.fiscal.obter.php": {
          const id = url.searchParams.get("id");
          if (id === "1") {
            return jsonResponse({
              retorno: {
                status: "OK",
                nota_fiscal: {
                  numero: "100",
                  data_emissao: "01/01/2026",
                  cliente: { nome: "MARIA DA SILVA" },
                  itens: [{ item: { codigo: "LLECP-110", descricao: "Chaleira Modern Preta 127V", quantidade: "1" } }],
                },
              },
            });
          }
          return jsonResponse({
            retorno: {
              status: "OK",
              nota_fiscal: { numero: "200", data_emissao: "15/09/2026", cliente: { nome: "MARIA OLIVEIRA" }, itens: [] },
            },
          });
        }
        default:
          throw new Error(`endpoint inesperado: ${String(input)}`);
      }
    });

    const { buscarCandidatosPorNomeCliente } = await freshDevolucao();
    const resultado = await buscarCandidatosPorNomeCliente("Maria");

    expect(resultado.podeTerMais).toBe(false);
    expect(resultado.candidatos).toHaveLength(2);
    // Mais recente (15/09/2026) primeiro, mesmo tendo vindo em segundo na resposta da pesquisa.
    expect(resultado.candidatos[0]).toMatchObject({ nf: "200", cliente: "Maria Oliveira", dataEmissao: "15/09/2026" });
    expect(resultado.candidatos[1]).toMatchObject({
      nf: "100",
      cliente: "Maria Da Silva",
      produtos: ["CHALEIRA MODERN PRETA 127V"],
    });
  });

  it("nenhum resultado (codigo_erro 32) devolve lista vazia, não lança erro", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ retorno: { status: "Erro", codigo_erro: 32 } }));

    const { buscarCandidatosPorNomeCliente } = await freshDevolucao();
    const resultado = await buscarCandidatosPorNomeCliente("NomeQueNaoExiste");

    expect(resultado).toEqual({ candidatos: [], podeTerMais: false });
  });

  it("mais de 5 encontrados: devolve só os 5 mais recentes e avisa que pode ter mais", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (input) => {
      if (endpointDe(input) === "notas.fiscais.pesquisa.php") {
        const notas = Array.from({ length: 7 }, (_, i) => ({
          nota_fiscal: { id: String(i + 1), numero: String(100 + i), data_emissao: `0${(i % 9) + 1}/01/2026` },
        }));
        return jsonResponse({ retorno: { status: "OK", notas_fiscais: notas } });
      }
      const id = new URL(String(input)).searchParams.get("id");
      return jsonResponse({
        retorno: { status: "OK", nota_fiscal: { numero: id, data_emissao: "01/01/2026", cliente: { nome: "Fulano" }, itens: [] } },
      });
    });

    const { buscarCandidatosPorNomeCliente } = await freshDevolucao();
    const resultado = await buscarCandidatosPorNomeCliente("Fulano");

    expect(resultado.candidatos).toHaveLength(5);
    expect(resultado.podeTerMais).toBe(true);
  });

  it("nome vazio lança erro sem chamar o Tiny", async () => {
    const fetchMock = vi.mocked(fetch);
    const { buscarCandidatosPorNomeCliente } = await freshDevolucao();

    await expect(buscarCandidatosPorNomeCliente("   ")).rejects.toThrow(/informe o nome/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { calcularLinha, PARAMETROS_PADRAO } from "../lib/compras";

const tinyGetMock = vi.fn();
vi.mock("../lib/tinyClient", () => ({ tinyGet: (...args: unknown[]) => tinyGetMock(...args) }));

const PARAMS = { prazoDias: 90, segurancaDias: 30, coberturaDias: 90 };
const estoque = (saldo: number, reservado = 0) => ({ idProduto: "1", codigo: "AF", nome: "Air Fryer", saldo, reservado, atualizadoEm: "2026-10-07T00:00:00Z" });

describe("calcularLinha (planejamento de compra)", () => {
  it("abaixo do ponto de pedido → comprar, com sugestão cobrindo prazo+cobertura+segurança", () => {
    // 300 vendidos em 30 dias = 10/dia. Ponto de pedido = 10 × (90+30) = 1200.
    const linha = calcularLinha("AF", { quantidade: 300, descricao: "Air Fryer", valor: 60_000 }, 30, estoque(1000, 100), {}, PARAMS, "2026-10-07");
    expect(linha.vendaDia).toBe(10);
    expect(linha.disponivel).toBe(900);
    expect(linha.coberturaDias).toBe(90);
    expect(linha.rupturaPrevista).toBe("2027-01-05");
    expect(linha.pontoDePedido).toBe(1200);
    expect(linha.status).toBe("comprar");
    // alvo = 10 × (90+90+30) = 2100 → 2100 − 900 = 1200
    expect(linha.sugestao).toBe(1200);
    expect(linha.valorVendaSugestao).toBe(1200 * 200);
  });

  it("em trânsito conta na posição e reduz a sugestão", () => {
    const linha = calcularLinha("AF", { quantidade: 300, descricao: "", valor: 0 }, 30, estoque(900), { emTransito: 1000 }, PARAMS, "2026-10-07");
    // posição = 900 + 1000 = 1900: acima do ponto (1200) e da faixa de atenção (1200 + 10×30), abaixo do excesso.
    expect(linha.status).toBe("ok");
    expect(linha.sugestao).toBe(200); // 2100 − 900 − 1000
  });

  it("estoque muito acima do alvo → excesso; sem venda → sem-venda; sem estoque coletado → sem sugestão", () => {
    expect(calcularLinha("AF", { quantidade: 30, descricao: "", valor: 0 }, 30, estoque(10_000), {}, PARAMS, "2026-10-07").status).toBe("excesso");
    expect(calcularLinha("AF", { quantidade: 0, descricao: "", valor: 0 }, 30, estoque(5), {}, PARAMS, "2026-10-07").status).toBe("sem-venda");
    const semEstoque = calcularLinha("AF", { quantidade: 30, descricao: "", valor: 0 }, 30, undefined, {}, PARAMS, "2026-10-07");
    expect(semEstoque).toMatchObject({ disponivel: null, sugestao: 0, coberturaDias: null });
  });

  it("prazo por produto sobrescreve o padrão", () => {
    const linha = calcularLinha("AF", { quantidade: 30, descricao: "", valor: 0 }, 30, estoque(0), { prazoDias: 30 }, PARAMETROS_PADRAO, "2026-10-07");
    expect(linha.prazoDias).toBe(30);
    expect(linha.pontoDePedido).toBe(60);
  });
});

describe("coleta de vendas (Tiny simulado)", () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "vendas-sync-"));
    process.env.DATA_DIR = dataDir;
    process.env.OLIST_API_TOKEN = "teste";
    process.env.VENDAS_JANELA_DIAS = "2";
    process.env.VENDAS_INTERVALO_MS = "0";
    tinyGetMock.mockReset();
  });

  afterEach(async () => {
    for (const v of ["DATA_DIR", "OLIST_API_TOKEN", "VENDAS_JANELA_DIAS", "VENDAS_INTERVALO_MS", "VENDAS_MAX_POR_TICK"]) delete process.env[v];
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it("coleta os dias da janela, ignora cancelados, soma por SKU e busca o estoque", async () => {
    tinyGetMock.mockImplementation(async (endpoint: string, params: Record<string, string>) => {
      if (endpoint === "pedidos.pesquisa.php") {
        return {
          retorno: {
            status: "OK",
            numero_paginas: 1,
            pedidos: [{ pedido: { id: `${params.dataInicial}-a`, situacao: "Aprovado" } }, { pedido: { id: "x", situacao: "Cancelado" } }],
          },
        };
      }
      if (endpoint === "pedido.obter.php") {
        return {
          retorno: { status: "OK", pedido: { itens: [{ item: { id_produto: "77", codigo: "AF", descricao: "Air Fryer", quantidade: "3", valor_unitario: "200" } }] } },
        };
      }
      if (endpoint === "produto.obter.estoque.php") {
        return { retorno: { status: "OK", produto: { id: "77", codigo: "AF", nome: "Air Fryer", saldo: "50", saldoReservado: "5" } } };
      }
      throw new Error(`endpoint inesperado ${endpoint}`);
    });

    vi.resetModules();
    const { tickVendas, statusColeta, estoqueAtual } = await import("../lib/vendasSync");
    await tickVendas(); // coleta os 2 dias
    await tickVendas(); // agora já conhece o produto → busca o estoque

    expect((await statusColeta()).diasColetados).toBe(2);
    expect(tinyGetMock.mock.calls.filter(([e]) => e === "pedido.obter.php").every(([, p]) => p.id !== "x")).toBe(true);
    expect((await estoqueAtual()).AF).toMatchObject({ saldo: 50, reservado: 5 });

    const { montarPlanejamento } = await import("../lib/compras");
    const plano = await montarPlanejamento();
    expect(plano.diasBase).toBe(2);
    expect(plano.linhas[0]).toMatchObject({ chave: "AF", vendaPeriodo: 6, vendaDia: 3, disponivel: 45 });
  });

  it("limite de taxa do Tiny não é erro: para o ciclo e continua do mesmo ponto depois", async () => {
    process.env.VENDAS_MAX_POR_TICK = "40";
    let limitado = true;
    tinyGetMock.mockImplementation(async (endpoint: string) => {
      if (endpoint === "pedidos.pesquisa.php") return { retorno: { status: "OK", numero_paginas: 1, pedidos: [{ pedido: { id: "1" } }, { pedido: { id: "2" } }] } };
      if (endpoint === "pedido.obter.php") {
        if (limitado) {
          limitado = false;
          return { retorno: { status: "Erro", codigo_erro: 6 } };
        }
        return { retorno: { status: "OK", pedido: { itens: [{ item: { codigo: "AF", quantidade: 1 } }] } } };
      }
      return { retorno: { status: "Erro", codigo_erro: 32 } };
    });

    vi.resetModules();
    const { tickVendas, statusColeta } = await import("../lib/vendasSync");
    await tickVendas();
    const depoisDoLimite = await statusColeta();
    expect(depoisDoLimite.ultimoErro).toBeUndefined();
    expect(depoisDoLimite.emAndamento).toMatchObject({ pedidosFeitos: 0, totalPedidos: 2 });

    await tickVendas();
    expect((await statusColeta()).diasColetados).toBe(2);
  });
});

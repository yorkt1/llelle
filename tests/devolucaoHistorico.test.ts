import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EntradaDevolucao } from "../lib/devolucaoHistorico";

async function fresh() {
  vi.resetModules();
  return import("../lib/devolucaoHistorico");
}

function entrada(parcial: Partial<EntradaDevolucao> = {}): EntradaDevolucao {
  return {
    data: "2026-10-05",
    nf: "338894",
    idPedido: "260913UJGQT69B",
    cliente: "Maria",
    marketplace: "SHOPEE",
    ocorrencia: "DEFEITO",
    observacoes: "",
    quantidade: 1,
    produto: "AIR FRYER 110V",
    codigoProduto: "AF-110",
    dataRecebimento: "",
    defeito: "",
    codigoFabricante: "",
    status: "",
    reembolso: "",
    origem: "tela",
    ...parcial,
  };
}

describe("histórico de devoluções", () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "devol-hist-"));
    process.env.DATA_DIR = dataDir;
  });

  afterEach(async () => {
    delete process.env.DATA_DIR;
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it("registra e lista pelo período da data SAC", async () => {
    const { registrarDevolucoes, listarDevolucoes } = await fresh();
    expect(await registrarDevolucoes([entrada(), entrada({ nf: "1", data: "2026-08-01" })])).toEqual({ novos: 2, atualizados: 0 });

    const outubro = await listarDevolucoes("2026-10-01", "2026-10-31");
    expect(outubro).toHaveLength(1);
    expect(outubro[0]).toMatchObject({ nf: "338894", ocorrencia: "DEFEITO", origem: "tela" });
  });

  it("copiar de novo a mesma NF+produto atualiza em vez de duplicar", async () => {
    const { registrarDevolucoes, listarDevolucoes } = await fresh();
    await registrarDevolucoes([entrada()]);
    expect(await registrarDevolucoes([entrada({ ocorrencia: "DANIFICADO" })])).toEqual({ novos: 0, atualizados: 1 });

    const lista = await listarDevolucoes("2026-10-01", "2026-10-31");
    expect(lista).toHaveLength(1);
    expect(lista[0].ocorrencia).toBe("DANIFICADO");
  });

  it("atualiza registro feito no mês anterior (recópia na virada do mês)", async () => {
    const { registrarDevolucoes, listarDevolucoes } = await fresh();
    await registrarDevolucoes([entrada()], new Date("2026-09-30T12:00:00Z"));
    expect(await registrarDevolucoes([entrada({ status: "ESTOQUE" })], new Date("2026-10-01T12:00:00Z"))).toEqual({ novos: 0, atualizados: 1 });
    const lista = await listarDevolucoes("2026-10-01", "2026-10-31");
    expect(lista).toHaveLength(1);
    expect(lista[0].status).toBe("ESTOQUE");
  });

  it("remove um registro", async () => {
    const { registrarDevolucoes, listarDevolucoes, removerDevolucao } = await fresh();
    await registrarDevolucoes([entrada()]);
    const [registro] = await listarDevolucoes("2026-10-01", "2026-10-31");
    await removerDevolucao(registro.id, registro.registradoEm);
    expect(await listarDevolucoes("2026-10-01", "2026-10-31")).toEqual([]);
  });

  it("parseia linhas coladas da planilha (mesma ordem do Copiar) e ignora as inválidas", async () => {
    const { parsearLinhasPlanilha } = await fresh();
    const linha = ["05/10/2026", "Maria", "123.456.789-00", "PED1", "338894", "SHOPEE", "defeito", "obs", "2", "AIR FRYER", "", "", "", "ESTOQUE", ""].join("\t");
    const { entradas, ignoradas } = parsearLinhasPlanilha(`${linha}\nData pedido SAC\tCliente\n\n`);
    expect(ignoradas).toBe(1);
    expect(entradas).toEqual([
      expect.objectContaining({ data: "2026-10-05", nf: "338894", ocorrencia: "DEFEITO", quantidade: 2, produto: "AIR FRYER", status: "ESTOQUE", origem: "planilha" }),
    ]);
    // CPF (coluna C) nunca é guardado no histórico.
    expect(JSON.stringify(entradas)).not.toContain("123.456.789-00");
  });
});

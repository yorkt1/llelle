import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tinyGetMock = vi.fn();
vi.mock("../lib/tinyClient", () => ({ tinyGet: (...args: unknown[]) => tinyGetMock(...args) }));
vi.mock("../lib/olist", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/olist")>()),
  todayInSaoPaulo: () => "07/10/2026",
}));

async function fresh() {
  vi.resetModules();
  const store = await import("../lib/store");
  const embalagem = await import("../lib/embalagem");
  return { store, ...embalagem };
}

describe("relatório mensal de embalagem", () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "embalagem-rel-"));
    process.env.DATA_DIR = dataDir;
    process.env.OLIST_API_TOKEN = "teste";
    tinyGetMock.mockReset();
  });

  afterEach(async () => {
    delete process.env.DATA_DIR;
    delete process.env.OLIST_API_TOKEN;
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it("monta a matriz colaborador × dia a partir do cache, sem chamar o Tiny", async () => {
    const { store, relatorioMensal, salvarColaborador } = await fresh();
    await salvarColaborador("111", "Geovane", "04");
    await salvarColaborador("222", "Wilson");
    await store.set("embalagem:resolucoesPorSeparacao", {
      a: { idUsuarioEmbalador: "111", dataCheckout: "01/10/2026" },
      b: { idUsuarioEmbalador: "111", dataCheckout: "01/10/2026" },
      c: { idUsuarioEmbalador: "111", dataCheckout: "06/10/2026" },
      d: { idUsuarioEmbalador: "999", dataCheckout: "06/10/2026" },
      e: { idUsuarioEmbalador: null, dataCheckout: "06/10/2026" },
      f: { idUsuarioEmbalador: "111", dataCheckout: "30/09/2026" }, // outro mês
    });

    const rel = await relatorioMensal("2026-10");
    expect(tinyGetMock).not.toHaveBeenCalled();
    expect(rel.dias).toHaveLength(31);
    expect(rel.dias[0]).toMatchObject({ dia: 1, semana: "QUI", futuro: false, completo: false });
    expect(rel.dias[7]).toMatchObject({ dia: 8, futuro: true });
    expect(rel.total).toBe(4);
    expect(rel.naoIdentificadosPorDia[5]).toBe(1);

    const [geovane, ...resto] = rel.colaboradores;
    expect(geovane).toMatchObject({ nome: "Geovane", bancada: "04", total: 3, diasTrabalhados: 2 });
    expect(geovane.porDia.slice(0, 6)).toEqual([2, 0, 0, 0, 0, 1]);
    // ID sem cadastro aparece; cadastrado sem embalar nada aparece com 0.
    expect(resto.map((c) => c.nome)).toEqual(["ID 999 (sem nome cadastrado)", "Wilson"]);
    expect(rel.totalPorDia[5]).toBe(2);
  });

  it("exporta o Excel no layout da planilha (colaborador × dia, dia da semana, total)", async () => {
    const { store, salvarColaborador } = await fresh();
    await salvarColaborador("111", "Geovane");
    await store.set("embalagem:resolucoesPorSeparacao", {
      a: { idUsuarioEmbalador: "111", dataCheckout: "01/10/2026" },
      b: { idUsuarioEmbalador: "111", dataCheckout: "02/10/2026" },
    });

    const express = (await import("express")).default;
    const { embalagemRouter } = await import("../server/routes/embalagem");
    const app = express().use("/api/embalagem", embalagemRouter);
    const servidor = app.listen(0);
    try {
      const porta = (servidor.address() as { port: number }).port;
      const resposta = await fetch(`http://127.0.0.1:${porta}/api/embalagem/relatorio.xlsx?mes=2026-10`);
      expect(resposta.headers.get("content-type")).toContain("spreadsheetml");

      const ExcelJS = (await import("exceljs")).default;
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(await resposta.arrayBuffer());
      const planilha = workbook.worksheets[0];
      expect(String(planilha.getRow(1).getCell(1).value)).toContain("RELATÓRIO DE DESEMPENHO MENSAL");
      expect(planilha.getRow(2).getCell(1).value).toBe("FUNCIONÁRIO");
      expect(planilha.getRow(2).getCell(2).value).toBe(1);
      expect(planilha.getRow(3).getCell(2).value).toBe("QUI*"); // dia 1 ainda não verificado → "*"
      const geovane = planilha.getRow(4);
      expect(geovane.getCell(1).value).toBe("Geovane");
      expect([geovane.getCell(2).value, geovane.getCell(3).value]).toEqual([1, 1]);
      expect(geovane.getCell(33).value).toBe(2); // TOTAL vem logo depois dos 31 dias
    } finally {
      servidor.close();
    }
  }, 30_000);

  it("meta mensal: salva, limpa e rejeita valor inválido", async () => {
    const { salvarMetaMensal, relatorioMensal } = await fresh();
    expect(await salvarMetaMensal(7500)).toBe(7500);
    expect((await relatorioMensal("2026-10")).metaMensal).toBe(7500);
    expect(await salvarMetaMensal(-3)).toBeNull();
    expect(await salvarMetaMensal(null)).toBeNull();
  });

  it("verificação de dia passado: lista o dia uma vez, resolve o que falta e marca o dia como completo", async () => {
    process.env.OLIST_EMBALADAS_WINDOW_DAYS = "0";
    tinyGetMock.mockImplementation(async (endpoint: string, params: Record<string, string>) => {
      if (endpoint === "separacao.pesquisa.php") {
        return {
          retorno: {
            status: "OK",
            numero_paginas: 1,
            separacoes: [
              { id: "s1", dataCheckout: params.dataFinal },
              { id: "s2", dataCheckout: params.dataFinal },
            ],
          },
        };
      }
      return { retorno: { status: "OK", separacao: { idUsuarioEmbalador: params.idSeparacao === "s1" ? "111" : "222" } } };
    });

    const { verificarDiaPassado, relatorioMensal } = await fresh();
    await verificarDiaPassado(); // dia 06/10 (o mais recente já fechado)

    const rel = await relatorioMensal("2026-10");
    expect(rel.dias[5]).toMatchObject({ data: "06/10/2026", completo: true });
    expect(rel.totalPorDia[5]).toBe(2);
    expect(rel.dias[4].completo).toBe(false); // o 05 ainda não foi verificado
    delete process.env.OLIST_EMBALADAS_WINDOW_DAYS;
  });
});

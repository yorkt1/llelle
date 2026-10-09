import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

async function freshPedidos() {
  vi.resetModules();
  return import("../lib/controlePedidos");
}

describe("controle de pedidos", () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "controle-pedidos-"));
    process.env.DATA_DIR = dataDir;
  });

  afterEach(async () => {
    delete process.env.DATA_DIR;
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it("salva os dados e marca Tiago apenas no banco, sem expor a marcação na tela", async () => {
    const { listarDiasPedidos, obterDiaPedidos, salvarDiaPedidos } = await freshPedidos();
    const entrada = {
      manha: {
        resp: "Tiago",
        obs: "",
        tiktok: { recebidos: 12, separados: 5, embalados: 2, expedidos: 1, cancelados: 0 },
        ml: { recebidos: 0, separados: 0, embalados: 0, expedidos: 0, cancelados: 0 },
        shopee: { recebidos: 0, separados: 0, embalados: 0, expedidos: 0, cancelados: 0 },
      },
      tarde: {
        resp: "Ana",
        obs: "",
        tiktok: { recebidos: 0, separados: 0, embalados: 0, expedidos: 0, cancelados: 0 },
        ml: { recebidos: 0, separados: 0, embalados: 0, expedidos: 0, cancelados: 0 },
        shopee: { recebidos: 0, separados: 0, embalados: 0, expedidos: 0, cancelados: 0 },
      },
    };

    await salvarDiaPedidos("2026-10-09", entrada);
    const dia = await obterDiaPedidos("2026-10-09");
    expect(dia?.manha.tiktok.recebidos).toBe(12);
    expect(dia?.manha).not.toHaveProperty("doTiago");
    expect(await listarDiasPedidos()).toHaveLength(1);

    const arquivo = JSON.parse(await fs.readFile(path.join(dataDir, "store.json"), "utf8")) as {
      "controle-pedidos:dias": Record<string, { manha: { doTiago: boolean }; tarde: { doTiago: boolean } }>;
    };
    expect(arquivo["controle-pedidos:dias"]["2026-10-09"].manha.doTiago).toBe(true);
    expect(arquivo["controle-pedidos:dias"]["2026-10-09"].tarde.doTiago).toBe(false);
  });

  it("rejeita data inválida, ordena histórico e permite excluir o dia salvo", async () => {
    const { excluirDiaPedidos, listarDiasPedidos, obterDiaPedidos, salvarDiaPedidos } = await freshPedidos();
    await expect(obterDiaPedidos("09/10/2026")).rejects.toThrow(/data inválida/i);
    await salvarDiaPedidos("2026-10-08", {});
    await salvarDiaPedidos("2026-10-09", {});
    expect((await listarDiasPedidos()).map((dia) => dia.data)).toEqual(["2026-10-09", "2026-10-08"]);
    expect(await excluirDiaPedidos("2026-10-09")).toBe(true);
    expect(await obterDiaPedidos("2026-10-09")).toBeNull();
    expect(await excluirDiaPedidos("2026-10-09")).toBe(false);
  });
});

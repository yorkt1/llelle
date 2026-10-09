import express from "express";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("rotas do Controle de Pedidos", () => {
  let dataDir: string;
  let servidor: Server;
  let baseUrl: string;

  beforeEach(async () => {
    vi.resetModules();
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "controle-pedidos-routes-"));
    process.env.DATA_DIR = dataDir;
    const { pedidosRouter } = await import("../server/routes/pedidos");
    const app = express();
    app.use(express.json());
    app.use("/api/pedidos", pedidosRouter);
    servidor = app.listen(0);
    await new Promise<void>((resolve) => servidor.once("listening", resolve));
    const address = servidor.address();
    if (!address || typeof address === "string") throw new Error("Servidor de teste não iniciou.");
    baseUrl = `http://127.0.0.1:${address.port}/api/pedidos`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => servidor.close((error) => (error ? reject(error) : resolve())));
    delete process.env.DATA_DIR;
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it("baixa uma planilha Excel com resumo e detalhes de todos os turnos", async () => {
    const salvar = await fetch(`${baseUrl}/2026-10-09`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        manha: { resp: "Tiago", tiktok: { recebidos: 8, expedidos: 3 } },
        tarde: { resp: "Ana", shopee: { recebidos: 4, cancelados: 1 } },
      }),
    });
    expect(salvar.status).toBe(200);

    const resposta = await fetch(`${baseUrl}/planilha.xlsx`);
    expect(resposta.status).toBe(200);
    expect(resposta.headers.get("content-type")).toContain("spreadsheetml");

    const ExcelJS = (await import("exceljs")).default;
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await resposta.arrayBuffer());
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(["Resumo diário", "Detalhes por turno"]);
    expect(workbook.worksheets[0].getRow(2).getCell(2).value).toBe(12);
    expect(workbook.worksheets[1].getRow(2).getCell(4).value).toBe("Tiago");
    expect(workbook.worksheets[1].getRow(2).values).not.toContain(true);
  });

  it("exclui um dia salvo e devolve 404 se não houver registro", async () => {
    await fetch(`${baseUrl}/2026-10-09`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: "{}" });
    expect((await fetch(`${baseUrl}/2026-10-09`, { method: "DELETE" })).status).toBe(204);
    expect((await fetch(`${baseUrl}/2026-10-09`, { method: "DELETE" })).status).toBe(404);
  });
});

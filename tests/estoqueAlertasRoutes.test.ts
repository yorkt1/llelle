import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

async function iniciarApiEstoque(): Promise<{ url: string; fechar: () => Promise<void> }> {
  vi.resetModules();
  const express = (await import("express")).default;
  const { estoqueRouter } = await import("../server/routes/estoque");
  const servidor = express().use(express.json()).use("/api/estoque", estoqueRouter).listen(0);
  const endereco = servidor.address();
  if (!endereco || typeof endereco === "string") throw new Error("Não consegui iniciar a API de estoque.");
  return {
    url: `http://127.0.0.1:${endereco.port}/api/estoque`,
    fechar: () => {
      servidor.closeAllConnections();
      return new Promise((resolve, reject) => servidor.close((error) => (error ? reject(error) : resolve())));
    },
  };
}

describe("configuração do alerta de estoque baixo", () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "estoque-alerta-"));
    process.env.DATA_DIR = dataDir;
  });

  afterEach(async () => {
    delete process.env.DATA_DIR;
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it("usa o padrão 5, persiste a alteração global e rejeita limites inválidos", async () => {
    const api = await iniciarApiEstoque();
    try {
      const inicial = await fetch(`${api.url}/configuracao-alerta`);
      expect(await inicial.json()).toEqual({ limiteEstoqueBaixo: 5 });

      const salvo = await fetch(`${api.url}/configuracao-alerta`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limiteEstoqueBaixo: 3 }),
      });
      expect(salvo.status).toBe(200);
      expect(await salvo.json()).toEqual({ limiteEstoqueBaixo: 3 });

      const relido = await fetch(`${api.url}/configuracao-alerta`);
      expect(await relido.json()).toEqual({ limiteEstoqueBaixo: 3 });

      const invalido = await fetch(`${api.url}/configuracao-alerta`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limiteEstoqueBaixo: -1 }),
      });
      expect(invalido.status).toBe(400);
    } finally {
      await api.fechar();
    }
  }, 15_000);
});

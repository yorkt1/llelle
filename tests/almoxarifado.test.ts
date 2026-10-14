// @vitest-environment node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

async function iniciarApi(): Promise<{ url: string; fechar: () => Promise<void> }> {
  vi.resetModules();
  const express = (await import("express")).default;
  const { almoxarifadoRouter } = await import("../server/routes/almoxarifado");
  const servidor = express().use(express.json()).use("/api/almoxarifado", almoxarifadoRouter).listen(0);
  const endereco = servidor.address();
  if (!endereco || typeof endereco === "string") throw new Error("Não consegui iniciar a API do almoxarifado.");
  return {
    url: `http://127.0.0.1:${endereco.port}/api/almoxarifado`,
    fechar: () => {
      servidor.closeAllConnections();
      return new Promise((resolve, reject) => servidor.close((error) => (error ? reject(error) : resolve())));
    },
  };
}

describe("almoxarifado", () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "almoxarifado-test-"));
    process.env.DATA_DIR = dataDir;
  });

  afterEach(async () => {
    delete process.env.DATA_DIR;
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it("persiste saídas, entradas e histórico entre leituras da API", async () => {
    const api = await iniciarApi();
    try {
      const primeiraLeitura = await fetch(api.url);
      const { estado: inicial } = await primeiraLeitura.json();
      const item = inicial.categorias[0].itens[0];
      expect(item.saldo).toBe(500);

      const saida = await fetch(`${api.url}/movimentacoes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId: item.id, tipo: "saida", quantidade: 12, observacao: "Separação" }),
      });
      expect(saida.status).toBe(200);

      const leituraPersistida = await fetch(api.url);
      const { estado } = await leituraPersistida.json();
      expect(estado.categorias[0].itens[0].saldo).toBe(488);
      expect(estado.historico).toHaveLength(1);
      expect(estado.historico[0]).toMatchObject({ tipo: "saida", quantidade: 12, saldo: 488, observacao: "Separação" });

      const entrada = await fetch(`${api.url}/movimentacoes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId: item.id, tipo: "entrada", quantidade: 20 }),
      });
      expect(entrada.status).toBe(200);

      const final = await fetch(api.url);
      const { estado: atualizado } = await final.json();
      expect(atualizado.categorias[0].itens[0].saldo).toBe(508);
      expect(atualizado.historico).toHaveLength(2);
    } finally {
      await api.fechar();
    }
  }, 15_000);

  it("rejeita movimentação inválida sem alterar saldo ou histórico", async () => {
    const api = await iniciarApi();
    try {
      const resposta = await fetch(`${api.url}/movimentacoes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId: "emb-30x40", tipo: "saida", quantidade: -3 }),
      });
      expect(resposta.status).toBe(400);
      expect(await resposta.json()).toMatchObject({ error: expect.stringContaining("maior que zero") });
      const { estado } = await (await fetch(api.url)).json();
      expect(estado.categorias[0].itens[0].saldo).toBe(500);
      expect(estado.historico).toEqual([]);
    } finally {
      await api.fechar();
    }
  }, 15_000);

  it("não confirma gravação em produção quando falta a conexão persistente do Supabase", async () => {
    const api = await iniciarApi();
    const nodeEnvAnterior = process.env.NODE_ENV;
    const supabaseUrlAnterior = process.env.SUPABASE_URL;
    const supabaseKeyAnterior = process.env.SUPABASE_SERVICE_ROLE_KEY;
    process.env.NODE_ENV = "production";
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    try {
      const resposta = await fetch(`${api.url}/movimentacoes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId: "emb-30x40", tipo: "saida", quantidade: 1 }),
      });
      expect(resposta.status).toBe(503);
      expect(await resposta.json()).toMatchObject({ error: expect.stringContaining("Supabase não está configurado em produção") });
    } finally {
      if (nodeEnvAnterior === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = nodeEnvAnterior;
      if (supabaseUrlAnterior === undefined) delete process.env.SUPABASE_URL;
      else process.env.SUPABASE_URL = supabaseUrlAnterior;
      if (supabaseKeyAnterior === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      else process.env.SUPABASE_SERVICE_ROLE_KEY = supabaseKeyAnterior;
      await api.fechar();
    }
  }, 15_000);
});
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

  it("rejeita quantidade fracionária no cadastro de contagem", async () => {
    const api = await iniciarApiEstoque();
    try {
      const resposta = await fetch(`${api.url}/A/A1`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quantidade: 4.5, responsavel: "Ana", fotoDataUri: "data:image/jpeg;base64,AA==", expectedUltimaId: null }),
      });
      expect(resposta.status).toBe(400);
      expect(await resposta.json()).toEqual({ error: "Quantidade precisa ser um número inteiro maior ou igual a zero." });
    } finally {
      await api.fechar();
    }
  }, 15_000);

  it("exige vínculo com SKU do Tiny para cadastrar produtos no catálogo", async () => {
    const api = await iniciarApiEstoque();
    try {
      const textoLivre = await fetch(`${api.url}/produtos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome: "Produto inventado" }),
      });
      expect(textoLivre.status).toBe(400);
      expect(await textoLivre.json()).toEqual({
        error: "Cadastre novos produtos pela busca do Tiny, vinculando o SKU.",
      });

      const semSku = await fetch(`${api.url}/produtos/lote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nomes: ["Produto sem SKU"] }),
      });
      expect(semSku.status).toBe(400);
      expect(await semSku.json()).toEqual({
        error: "Cada produto precisa ser selecionado no Tiny e ter SKU vinculado.",
      });

      const doTiny = await fetch(`${api.url}/produtos/lote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nomes: ["Produto cadastrado no Tiny"],
          itens: [{ nome: "Produto cadastrado no Tiny", idsTiny: ["tiny-123"], codigos: ["SKU-123"] }],
        }),
      });
      expect(doTiny.status).toBe(201);
      expect((await doTiny.json()).produtos).toContain("Produto cadastrado no Tiny");

      const store = await import("../lib/store");
      expect(await store.get("estoque:produtosInfo")).toMatchObject({
        "produto cadastrado no tiny": { idsTiny: ["tiny-123"], codigos: ["SKU-123"] },
      });
    } finally {
      await api.fechar();
    }
  }, 15_000);

  it("mescla produtos sem alterar o histórico e combina os vínculos do Tiny", async () => {
    const api = await iniciarApiEstoque();
    try {
      const store = await import("../lib/store");
      await store.set("estoque:produtos", ["Nome antigo", "Produto correto"]);
      await store.set("estoque:metadados", {
        "A::A1": { produto: "Nome antigo", voltagem: "110V" },
        "A::A2": { produto: "Produto correto", voltagem: "220V" },
      });
      await store.set("estoque", {
        "A::A1": [{ id: "contagem-antiga", quantidade: 4, responsavel: "Ana", fotoUrl: "foto-antiga", criadoEm: "2026-10-13T12:00:00.000Z" }],
      });
      await store.set("estoque:produtosInfo", {
        "nome antigo": { nome: "Nome antigo", idsTiny: ["tiny-a"], codigos: ["SKU-A"], fotoStatus: "sem-foto" },
        "produto correto": {
          nome: "Produto correto",
          idsTiny: ["tiny-b"],
          codigos: ["SKU-B"],
          fotoUrl: "https://example.com/foto.jpg",
          fotoStatus: "ok",
        },
      });

      const resposta = await fetch(`${api.url}/produtos/mesclar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ origem: "Nome antigo", destino: "Produto correto" }),
      });
      expect(resposta.status).toBe(200);
      expect(await resposta.json()).toMatchObject({
        produtos: ["Produto correto"],
        posicoesAtualizadas: 1,
      });
      expect(await store.get("estoque:metadados")).toMatchObject({
        "A::A1": { produto: "Produto correto", voltagem: "110V" },
        "A::A2": { produto: "Produto correto", voltagem: "220V" },
      });
      expect(await store.get("estoque")).toMatchObject({
        "A::A1": [{ id: "contagem-antiga", quantidade: 4, fotoUrl: "foto-antiga" }],
      });
      expect(await store.get("estoque:produtosInfo")).toMatchObject({
        "produto correto": {
          idsTiny: ["tiny-b", "tiny-a"],
          codigos: ["SKU-B", "SKU-A"],
          fotoUrl: "https://example.com/foto.jpg",
        },
      });
      expect(await store.get("estoque:produtosInfo")).not.toHaveProperty("nome antigo");
    } finally {
      await api.fechar();
    }
  }, 15_000);

  it("bloqueia excluir uma longarina ocupada pela API", async () => {
    const api = await iniciarApiEstoque();
    try {
      const store = await import("../lib/store");
      await store.set("estoque:longarinas", ["A"]);
      await store.set("estoque", {
        "A::A1": [{ id: "contagem-1", quantidade: 2, responsavel: "Ana", fotoUrl: "foto", criadoEm: "2026-10-15T12:00:00.000Z" }],
      });
      await store.set("estoque:metadados", { "A::A1": { produto: "Liquidificador", voltagem: "220V" } });

      const resposta = await fetch(`${api.url}/longarinas/A`, { method: "DELETE" });
      expect(resposta.status).toBe(409);
      expect(await resposta.json()).toEqual({
        error: "Não é possível excluir uma longarina que ainda tenha gavetas. Remova ou mova as gavetas antes.",
      });
      expect(await store.get("estoque:longarinas")).toEqual(["A"]);
      expect(await store.get("estoque")).toHaveProperty("A::A1");
    } finally {
      await api.fechar();
    }
  }, 15_000);

  it("aplica movimentação pela API e exige motivo", async () => {
    const api = await iniciarApiEstoque();
    try {
      const store = await import("../lib/store");
      await store.set("embalagem:colaboradores", { "123": { nome: "Ana" } });
      await store.set("estoque:produtos", ["Liquidificador"]);
      await store.set("estoque:metadados", { "A::A1": { produto: "Liquidificador", voltagem: "220V" } });
      await store.set("estoque", {
        "A::A1": [{ id: "contagem-1", quantidade: 5, responsavel: "Ana", fotoUrl: "https://example.com/foto.jpg", criadoEm: "2026-10-15T12:00:00.000Z" }],
      });

      const invalida = await fetch(`${api.url}/A/A1/movimentos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tipo: "entrada", quantidade: 2, responsavel: "Ana", expectedUltimaId: "contagem-1" }),
      });
      expect(invalida.status).toBe(400);

      const pessoaLivre = await fetch(`${api.url}/A/A1/movimentos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tipo: "entrada",
          quantidade: 2,
          motivo: "Reposição",
          responsavel: "Pessoa não cadastrada",
          expectedUltimaId: "contagem-1",
        }),
      });
      expect(pessoaLivre.status).toBe(400);
      expect(await pessoaLivre.json()).toEqual({
        error: "Selecione uma pessoa cadastrada no módulo Embalagem.",
      });

      const salva = await fetch(`${api.url}/A/A1/movimentos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tipo: "entrada",
          quantidade: 2,
          motivo: "Reposição",
          responsavel: "Ana",
          expectedUltimaId: "contagem-1",
        }),
      });
      expect(salva.status).toBe(201);
      expect(await salva.json()).toMatchObject({ eventos: [expect.objectContaining({ tipo: "entrada", quantidade: 7, motivo: "Reposição" })] });

      const estoque = await fetch(`${api.url}`);
      expect(await estoque.json()).toMatchObject({ ruas: [{ posicoes: [expect.objectContaining({ ultima: expect.objectContaining({ quantidade: 7 }) })] }] });
    } finally {
      await api.fechar();
    }
  }, 15_000);

  it("bloqueia contagem com responsável que não está cadastrado", async () => {
    const api = await iniciarApiEstoque();
    try {
      const store = await import("../lib/store");
      await store.set("embalagem:colaboradores", { "123": { nome: "Ana" } });
      const resposta = await fetch(`${api.url}/A/A1`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quantidade: 3,
          responsavel: "Pessoa não cadastrada",
          fotoDataUri: "data:image/jpeg;base64,AA==",
          expectedUltimaId: null,
        }),
      });
      expect(resposta.status).toBe(400);
      expect(await resposta.json()).toEqual({
        error: "Selecione uma pessoa cadastrada no módulo Embalagem.",
      });
    } finally {
      await api.fechar();
    }
  }, 15_000);

  it("salva quantidade por caixa por produto e permite remover a configuração", async () => {
    const api = await iniciarApiEstoque();
    try {
      const salva = await fetch(`${api.url}/produtos/embalagens`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ produto: "Liquidificador", unidadesPorCaixa: 12 }),
      });
      expect(salva.status).toBe(200);
      expect(await salva.json()).toEqual({ unidadesPorCaixa: { liquidificador: 12 } });

      const produtos = await fetch(`${api.url}/produtos`);
      expect(await produtos.json()).toMatchObject({ unidadesPorCaixa: { liquidificador: 12 } });

      const invalida = await fetch(`${api.url}/produtos/embalagens`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ produto: "Liquidificador", unidadesPorCaixa: 0 }),
      });
      expect(invalida.status).toBe(400);

      const remove = await fetch(`${api.url}/produtos/embalagens`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ produto: "Liquidificador", unidadesPorCaixa: null }),
      });
      expect(await remove.json()).toEqual({ unidadesPorCaixa: {} });
    } finally {
      await api.fechar();
    }
  }, 15_000);

  it("calcula total de caixas e avulsas sem permitir valores não inteiros", async () => {
    const { calcularQuantidadeContada } = await import("../lib/contagemEstoque");
    expect(calcularQuantidadeContada(2, 3, 12)).toBe(27);
    expect(calcularQuantidadeContada(-1, 0, 12)).toBeNull();
    expect(calcularQuantidadeContada(1, 0, 0)).toBeNull();
    expect(calcularQuantidadeContada(Number.MAX_SAFE_INTEGER, 1, 2)).toBeNull();
  });

  it("impede excluir do catálogo produto vinculado a uma gaveta", async () => {
    const api = await iniciarApiEstoque();
    try {
      const store = await import("../lib/store");
      await store.set("estoque:produtos", ["Liquidificador"]);
      await store.set("estoque:longarinas", ["A"]);
      await store.set("estoque", {
        "A::A1": [{ id: "contagem-1", quantidade: 0, responsavel: "Ana", fotoUrl: "", criadoEm: "2026-10-13T12:00:00.000Z" }],
      });
      await store.set("estoque:metadados", { "A::A1": { produto: "Liquidificador", voltagem: "110V" } });

      const resposta = await fetch(`${api.url}/produtos/${encodeURIComponent("Liquidificador")}`, { method: "DELETE" });
      expect(resposta.status).toBe(409);
      expect(await resposta.json()).toEqual({
        error: "Não é possível excluir este produto enquanto houver gavetas vinculadas a ele.",
      });

      const produtos = await store.get<string[]>("estoque:produtos");
      expect(produtos).toEqual(["Liquidificador"]);
    } finally {
      await api.fechar();
    }
  }, 15_000);
});

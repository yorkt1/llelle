import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let dir: string;

async function freshStore() {
  vi.resetModules();
  process.env.DATA_DIR = dir;
  return import("../lib/store");
}

describe("store (arquivo local — sem Supabase configurado)", () => {
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "olist-store-"));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("devolve null pra chave inexistente", async () => {
    const store = await freshStore();
    expect(await store.get("nao-existe")).toBeNull();
  });

  it("grava e le de volta o mesmo valor, sobrevivendo a um novo processo", async () => {
    const store = await freshStore();
    await store.set("tokens", { accessToken: "abc" });

    const reloaded = await freshStore();
    expect(await reloaded.get("tokens")).toEqual({ accessToken: "abc" });
  });

  it("del remove a chave sem afetar as outras", async () => {
    const store = await freshStore();
    await store.set("a", 1);
    await store.set("b", 2);
    await store.del("a");

    expect(await store.get("a")).toBeNull();
    expect(await store.get("b")).toBe(2);
  });

  it("escritas concorrentes nao se perdem", async () => {
    const store = await freshStore();
    await Promise.all([store.set("x", 1), store.set("y", 2), store.set("z", 3)]);

    expect(await store.get("x")).toBe(1);
    expect(await store.get("y")).toBe(2);
    expect(await store.get("z")).toBe(3);
  });

  it("update le o valor atual, aplica o updater e grava o resultado", async () => {
    const store = await freshStore();
    await store.set("contador", 1);
    const novo = await store.update<number>("contador", (atual) => (atual ?? 0) + 1);

    expect(novo).toBe(2);
    expect(await store.get("contador")).toBe(2);
  });
});

// Simula a tabela "kv_store" do Supabase como um Map em memória — definido FORA do factory do
// vi.mock (que pode re-executar entre resets de módulo) pra representar "o banco persistiu",
// igual ao arquivo em disco representa isso pro backend de arquivo local acima.
let tabelaFake: Map<string, unknown>;

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        eq: (_coluna: string, valor: string) => ({
          maybeSingle: async () => ({
            data: tabelaFake.has(valor) ? { value: tabelaFake.get(valor) } : null,
            error: null,
          }),
        }),
      }),
      upsert: async (linha: { key: string; value: unknown }) => {
        tabelaFake.set(linha.key, linha.value);
        return { error: null };
      },
      delete: () => ({
        eq: async (_coluna: string, valor: string) => {
          tabelaFake.delete(valor);
          return { error: null };
        },
      }),
    }),
  }),
}));

async function freshStoreSupabase() {
  vi.resetModules();
  process.env.SUPABASE_URL = "https://exemplo.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "chave-de-teste";
  return import("../lib/store");
}

describe("store (Supabase configurado)", () => {
  beforeEach(() => {
    tabelaFake = new Map();
  });

  afterEach(() => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  it("devolve null pra chave inexistente", async () => {
    const store = await freshStoreSupabase();
    expect(await store.get("nao-existe")).toBeNull();
  });

  it("grava e le de volta o mesmo valor — sobrevive mesmo re-importando o módulo (não é estado local do processo)", async () => {
    const store = await freshStoreSupabase();
    await store.set("colaboradores", { "123": { nome: "Ana" } });

    // Dado NÃO fica em DATA_DIR nenhum: continua lá mesmo se esse "processo" reiniciar — é
    // exatamente isso que corrige colaboradores/produtos desaparecendo com o Render sem disco.
    const reimportado = await freshStoreSupabase();
    expect(await reimportado.get("colaboradores")).toEqual({ "123": { nome: "Ana" } });
  });

  it("del remove a chave sem afetar as outras", async () => {
    const store = await freshStoreSupabase();
    await store.set("a", 1);
    await store.set("b", 2);
    await store.del("a");

    expect(await store.get("a")).toBeNull();
    expect(await store.get("b")).toBe(2);
  });

  it("escritas concorrentes nao se perdem", async () => {
    const store = await freshStoreSupabase();
    await Promise.all([store.set("x", 1), store.set("y", 2), store.set("z", 3)]);

    expect(await store.get("x")).toBe(1);
    expect(await store.get("y")).toBe(2);
    expect(await store.get("z")).toBe(3);
  });

  it("update le o valor atual, aplica o updater e grava o resultado", async () => {
    const store = await freshStoreSupabase();
    await store.set("contador", 1);
    const novo = await store.update<number>("contador", (atual) => (atual ?? 0) + 1);

    expect(novo).toBe(2);
    expect(await store.get("contador")).toBe(2);
  });

  it("erro do Supabase em get() propaga com mensagem clara, não falha silenciosamente", async () => {
    vi.doMock("@supabase/supabase-js", () => ({
      createClient: () => ({
        from: () => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: { message: "tabela kv_store não existe" } }),
            }),
          }),
        }),
      }),
    }));
    vi.resetModules();
    process.env.SUPABASE_URL = "https://exemplo.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "chave-de-teste";
    const storeComErro = await import("../lib/store");

    await expect(storeComErro.get("qualquer")).rejects.toThrow(/tabela kv_store não existe/i);
  });
});

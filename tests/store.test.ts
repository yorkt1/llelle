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

describe("store", () => {
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
});

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agruparProdutosTiny, nomeSemVoltagem } from "../lib/catalogoTiny";

const FOTO_1X1 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

vi.mock("cloudinary", () => ({
  v2: {
    config: vi.fn(),
    uploader: { upload: vi.fn(async (_d: string, o: { public_id: string }) => ({ secure_url: `https://res.cloudinary.com/t/${o.public_id}.png` })) },
  },
}));

async function fresh() {
  vi.resetModules();
  return { ...(await import("../lib/estoque")), store: await import("../lib/store") };
}

describe("catálogo e exclusão no estoque", () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "estoque-cat-"));
    process.env.DATA_DIR = dataDir;
    process.env.CLOUDINARY_CLOUD_NAME = "t";
    process.env.CLOUDINARY_API_KEY = "t";
    process.env.CLOUDINARY_API_SECRET = "t";
  });

  afterEach(async () => {
    for (const v of ["DATA_DIR", "CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"]) delete process.env[v];
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it("cadastra produtos em lote ignorando repetidos e os já existentes", async () => {
    const { adicionarProduto, adicionarProdutos } = await fresh();
    await adicionarProduto("Air Fryer Koti 4L");
    const { produtos, adicionados } = await adicionarProdutos(["air fryer koti 4l", "Chaleira Koti  Modern Preta", "Chaleira Koti Modern Preta", " ", "Cafeteira Koti"]);
    expect(adicionados).toBe(2);
    expect(produtos).toEqual(["Air Fryer Koti 4L", "Cafeteira Koti", "Chaleira Koti Modern Preta"]);
  });

  it("exclui a rua inteira, mas guarda tudo no arquivo de excluídos", async () => {
    const { registrarContagem, removerRua, listarEstoque, store } = await fresh();
    for (const codigo of ["D1", "D2"]) await registrarContagem({ rua: "D", codigo, quantidade: 0, responsavel: "Ana", fotoDataUri: FOTO_1X1 });
    await registrarContagem({ rua: "E", codigo: "E1", quantidade: 0, responsavel: "Ana", fotoDataUri: FOTO_1X1 });

    expect(await removerRua("d")).toBe(2);
    expect((await listarEstoque()).map((r) => r.rua)).toEqual(["E"]);

    const excluidos = await store.get<{ rua: string; codigo: string; historico: unknown[] }[]>("estoque:excluidos");
    expect(excluidos?.map((e) => `${e.rua}${e.codigo.slice(1)}`)).toEqual(["D1", "D2"]);
    expect(excluidos?.[0].historico).toHaveLength(1);
  });

  it("exclui uma posição só; posição inexistente dá erro", async () => {
    const { registrarContagem, removerPosicao, listarEstoque } = await fresh();
    await registrarContagem({ rua: "D", codigo: "D1", quantidade: 0, responsavel: "Ana", fotoDataUri: FOTO_1X1 });
    await registrarContagem({ rua: "D", codigo: "D2", quantidade: 0, responsavel: "Ana", fotoDataUri: FOTO_1X1 });
    await removerPosicao("D", "D1");
    expect((await listarEstoque())[0].posicoes.map((p) => p.codigo)).toEqual(["D2"]);
    await expect(removerPosicao("D", "D9")).rejects.toThrow(/não existe/);
  });
});

describe("nomeSemVoltagem (sugestão de nome do Tiny pro catálogo)", () => {
  it.each([
    ["Chaleira Elétrica Koti Modern Preta 1,7L - 110V", "Chaleira Elétrica Koti Modern Preta 1,7L"],
    ["Air Fryer Koti 4L 220V", "Air Fryer Koti 4L"],
    ["Sanduicheira Koti Bivolt", "Sanduicheira Koti"],
    ["Cafeteira Koti (127V)", "Cafeteira Koti"],
    ["Tapete Koti Azul", "Tapete Koti Azul"],
    ["Chaleira Koti Elegance - Azul - 220V", "Chaleira Koti Elegance Azul"],
    ["Chaleira Koti Elegance Cor: Vermelha, Voltagem: 110V", "Chaleira Koti Elegance Vermelha"],
    ["Chaleira Koti Elegance Vermelha 1,7L / 127V", "Chaleira Koti Elegance Vermelha 1,7L"],
  ])("%s → %s", (entrada, esperado) => {
    expect(nomeSemVoltagem(entrada)).toBe(esperado);
  });
});

describe("agruparProdutosTiny (cores viram cards separados)", () => {
  it("Elegance azul e vermelha: um item por cor, voltagens juntas; o produto pai sem cor fica de fora", () => {
    const grupos = agruparProdutosTiny([
      { id: "1", nome: "Chaleira Koti Elegance", tipoVariacao: "P" },
      { id: "2", nome: "Chaleira Koti Elegance - Azul - 110V", codigo: "EL-AZ-110", tipoVariacao: "V" },
      { id: "3", nome: "Chaleira Koti Elegance - Azul - 220V", codigo: "EL-AZ-220", tipoVariacao: "V" },
      { id: "4", nome: "Chaleira Koti Elegance - Vermelha - 110V", codigo: "EL-VM-110", tipoVariacao: "V" },
      { id: "5", nome: "Air Fryer Koti 4L", tipoVariacao: "N" },
    ]);
    expect(grupos.map((g) => g.sugestao)).toEqual(["Air Fryer Koti 4L", "Chaleira Koti Elegance Azul", "Chaleira Koti Elegance Vermelha"]);
    expect(grupos[1]).toMatchObject({ idsTiny: ["2", "3"], codigos: ["EL-AZ-110", "EL-AZ-220"] });
  });

  it("produto pai sem as variações na lista continua aparecendo", () => {
    expect(agruparProdutosTiny([{ id: "1", nome: "Chaleira Koti Elegance", tipoVariacao: "P" }]).map((g) => g.sugestao)).toEqual(["Chaleira Koti Elegance"]);
  });
});

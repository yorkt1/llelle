import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// PNG 1x1 real (não precisa ser uma foto de verdade, só um data URI válido).
const FOTO_1X1 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

// Cloudinary nunca é chamado de verdade nos testes — devolve uma URL "fake" sempre diferente
// (usa o public_id que a gente manda, que já é um crypto.randomUUID() por chamada).
const cloudinaryUploadMock = vi.fn(async (_dataUri: string, opcoes: { public_id: string }) => ({
  secure_url: `https://res.cloudinary.com/teste/image/upload/${opcoes.public_id}.png`,
}));

vi.mock("cloudinary", () => ({
  v2: {
    config: vi.fn(),
    uploader: { upload: cloudinaryUploadMock },
  },
}));

async function freshEstoque() {
  vi.resetModules();
  cloudinaryUploadMock.mockClear();
  return import("../lib/estoque");
}

describe("estoque", () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "estoque-test-"));
    process.env.DATA_DIR = dataDir;
    process.env.CLOUDINARY_CLOUD_NAME = "teste";
    process.env.CLOUDINARY_API_KEY = "teste";
    process.env.CLOUDINARY_API_SECRET = "teste";
  });

  afterEach(async () => {
    delete process.env.DATA_DIR;
    delete process.env.CLOUDINARY_CLOUD_NAME;
    delete process.env.CLOUDINARY_API_KEY;
    delete process.env.CLOUDINARY_API_SECRET;
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it("lista vazio quando nunca teve nenhuma contagem", async () => {
    const { listarEstoque } = await freshEstoque();
    expect(await listarEstoque()).toEqual([]);
  });

  it("registra uma contagem (produto+voltagem obrigatórios na posição nova) e aparece em listarEstoque", async () => {
    const { registrarContagem, listarEstoque, adicionarProduto } = await freshEstoque();
    await adicionarProduto("Liquidificador");
    await registrarContagem({
      rua: "B",
      codigo: "A5",
      quantidade: 12,
      responsavel: "Ana",
      fotoDataUri: FOTO_1X1,
      produto: "Liquidificador",
      voltagem: "220V",
    });

    const ruas = await listarEstoque();
    expect(ruas).toEqual([
      {
        rua: "B",
        posicoes: [
          {
            rua: "B",
            codigo: "A5",
            produto: "Liquidificador",
            voltagem: "220V",
            ultima: expect.objectContaining({ quantidade: 12, responsavel: "Ana" }),
          },
        ],
      },
    ]);
  });

  it("sobe a foto pro Cloudinary e guarda a URL retornada — toda contagem tem foto, é obrigatória", async () => {
    const { registrarContagem, adicionarProduto } = await freshEstoque();
    await adicionarProduto("Liquidificador");
    const registro = await registrarContagem({
      rua: "B",
      codigo: "A5",
      quantidade: 5,
      responsavel: "Ana",
      fotoDataUri: FOTO_1X1,
      produto: "Liquidificador",
      voltagem: "220V",
    });

    expect(registro.fotoUrl).toMatch(/^https:\/\/res\.cloudinary\.com\//);
    expect(cloudinaryUploadMock).toHaveBeenCalledTimes(1);
    expect(cloudinaryUploadMock).toHaveBeenCalledWith(FOTO_1X1, expect.objectContaining({ folder: "llelle-estoque" }));
  });

  it("posição nova sem produto/voltagem é rejeitada antes de chamar o Cloudinary", async () => {
    const { registrarContagem } = await freshEstoque();
    await expect(
      registrarContagem({ rua: "B", codigo: "A5", quantidade: 1, responsavel: "Ana", fotoDataUri: FOTO_1X1 }),
    ).rejects.toThrow(/produto e voltagem são obrigatórios/i);
    expect(cloudinaryUploadMock).not.toHaveBeenCalled();
  });

  it("produto que não está no catálogo é rejeitado", async () => {
    const { registrarContagem } = await freshEstoque();
    await expect(
      registrarContagem({
        rua: "B",
        codigo: "A5",
        quantidade: 1,
        responsavel: "Ana",
        fotoDataUri: FOTO_1X1,
        produto: "Produto que não existe",
        voltagem: "220V",
      }),
    ).rejects.toThrow(/não está no catálogo/i);
    expect(cloudinaryUploadMock).not.toHaveBeenCalled();
  });

  it("recontagem de posição existente não exige produto/voltagem de novo, e mantém os mesmos", async () => {
    const { registrarContagem, listarEstoque, adicionarProduto } = await freshEstoque();
    await adicionarProduto("Liquidificador");
    await registrarContagem({
      rua: "B",
      codigo: "A5",
      quantidade: 10,
      responsavel: "Ana",
      fotoDataUri: FOTO_1X1,
      produto: "Liquidificador",
      voltagem: "220V",
    });
    // Recontagem sem produto/voltagem — não é posição nova, não precisa.
    await registrarContagem({ rua: "B", codigo: "A5", quantidade: 8, responsavel: "Bruno", fotoDataUri: FOTO_1X1 });

    const ruas = await listarEstoque();
    expect(ruas[0].posicoes[0]).toMatchObject({ produto: "Liquidificador", voltagem: "220V" });
    expect(ruas[0].posicoes[0].ultima).toMatchObject({ quantidade: 8, responsavel: "Bruno" });
  });

  it("definirMetadados corrige produto/voltagem de uma posição existente", async () => {
    const { registrarContagem, definirMetadados, listarEstoque, adicionarProduto } = await freshEstoque();
    await adicionarProduto("Liquidificador");
    await adicionarProduto("Ventilador");
    await registrarContagem({
      rua: "B",
      codigo: "A5",
      quantidade: 10,
      responsavel: "Ana",
      fotoDataUri: FOTO_1X1,
      produto: "Liquidificador",
      voltagem: "220V",
    });

    await definirMetadados("B", "A5", "Ventilador", "Bivolt");

    const ruas = await listarEstoque();
    expect(ruas[0].posicoes[0]).toMatchObject({ produto: "Ventilador", voltagem: "Bivolt" });
  });

  it("definirMetadados rejeita voltagem inválida", async () => {
    const { definirMetadados, adicionarProduto } = await freshEstoque();
    await adicionarProduto("Liquidificador");
    await expect(definirMetadados("B", "A5", "Liquidificador", "127V")).rejects.toThrow(/voltagem inválida/i);
  });

  it("rejeita data URI em formato inválido — nem chega a chamar o Cloudinary", async () => {
    const { registrarContagem, adicionarProduto } = await freshEstoque();
    await adicionarProduto("Liquidificador");
    await registrarContagem({
      rua: "B",
      codigo: "A5",
      quantidade: 1,
      responsavel: "Ana",
      fotoDataUri: FOTO_1X1,
      produto: "Liquidificador",
      voltagem: "220V",
    });
    cloudinaryUploadMock.mockClear();

    await expect(
      registrarContagem({ rua: "B", codigo: "A5", quantidade: 1, responsavel: "Ana", fotoDataUri: "nao-e-um-data-uri" }),
    ).rejects.toThrow(/formato inválido/i);
    expect(cloudinaryUploadMock).not.toHaveBeenCalled();
  });

  it("sem CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET configurados, lança erro claro (CloudinaryConfigError) em vez de uma falha genérica do SDK", async () => {
    const { registrarContagem, CloudinaryConfigError, adicionarProduto } = await freshEstoque();
    await adicionarProduto("Liquidificador");
    await registrarContagem({
      rua: "B",
      codigo: "A5",
      quantidade: 1,
      responsavel: "Ana",
      fotoDataUri: FOTO_1X1,
      produto: "Liquidificador",
      voltagem: "220V",
    });
    cloudinaryUploadMock.mockClear();

    delete process.env.CLOUDINARY_CLOUD_NAME;
    await expect(
      registrarContagem({ rua: "B", codigo: "A5", quantidade: 1, responsavel: "Ana", fotoDataUri: FOTO_1X1 }),
    ).rejects.toThrow(CloudinaryConfigError);
    expect(cloudinaryUploadMock).not.toHaveBeenCalled();
  });

  it("mantém histórico completo — contagem nova não apaga as antigas, e cada uma com sua própria foto", async () => {
    const { registrarContagem, obterHistorico, adicionarProduto } = await freshEstoque();
    await adicionarProduto("Liquidificador");
    await registrarContagem({
      rua: "B",
      codigo: "A5",
      quantidade: 10,
      responsavel: "Ana",
      fotoDataUri: FOTO_1X1,
      produto: "Liquidificador",
      voltagem: "220V",
    });
    await registrarContagem({ rua: "B", codigo: "A5", quantidade: 8, responsavel: "Bruno", fotoDataUri: FOTO_1X1 });

    const historico = await obterHistorico("B", "A5");
    expect(historico).toHaveLength(2);
    // Mais recente primeiro.
    expect(historico[0]).toMatchObject({ quantidade: 8, responsavel: "Bruno" });
    expect(historico[1]).toMatchObject({ quantidade: 10, responsavel: "Ana" });
    // Cada registro tem seu próprio upload (não reaproveita a URL da contagem anterior).
    expect(historico[0].fotoUrl).not.toBe(historico[1].fotoUrl);
  });

  it("listarEstoque mostra só a contagem mais recente de cada posição", async () => {
    const { registrarContagem, listarEstoque, adicionarProduto } = await freshEstoque();
    await adicionarProduto("Liquidificador");
    await registrarContagem({
      rua: "B",
      codigo: "A5",
      quantidade: 10,
      responsavel: "Ana",
      fotoDataUri: FOTO_1X1,
      produto: "Liquidificador",
      voltagem: "220V",
    });
    await registrarContagem({ rua: "B", codigo: "A5", quantidade: 8, responsavel: "Bruno", fotoDataUri: FOTO_1X1 });

    const ruas = await listarEstoque();
    expect(ruas[0].posicoes[0].ultima).toMatchObject({ quantidade: 8, responsavel: "Bruno" });
  });

  it("obterHistorico devolve lista vazia pra posição nunca contada", async () => {
    const { obterHistorico } = await freshEstoque();
    expect(await obterHistorico("Z", "NUNCA-EXISTIU")).toEqual([]);
  });

  it("agrupa por rua e ordena posições numericamente (A5 antes de A12)", async () => {
    const { registrarContagem, listarEstoque, adicionarProduto } = await freshEstoque();
    await adicionarProduto("Liquidificador");
    const params = { produto: "Liquidificador", voltagem: "220V" as const };
    await registrarContagem({ rua: "b", codigo: "a12", quantidade: 1, responsavel: "Ana", fotoDataUri: FOTO_1X1, ...params });
    await registrarContagem({ rua: "B", codigo: "A5", quantidade: 2, responsavel: "Ana", fotoDataUri: FOTO_1X1, ...params });
    await registrarContagem({ rua: "C", codigo: "X1", quantidade: 3, responsavel: "Ana", fotoDataUri: FOTO_1X1, ...params });

    const ruas = await listarEstoque();
    expect(ruas.map((r) => r.rua)).toEqual(["B", "C"]);
    // rua/código normalizados pra maiúsculo, mesma posição de "b"/"a12" e "B"/"A5" não se colidem.
    expect(ruas[0].posicoes.map((p) => p.codigo)).toEqual(["A5", "A12"]);
  });

  it("não perde nenhuma contagem quando duas posições diferentes são registradas ao mesmo tempo", async () => {
    const { registrarContagem, listarEstoque, adicionarProduto } = await freshEstoque();
    await adicionarProduto("Liquidificador");
    const params = { produto: "Liquidificador", voltagem: "220V" as const };

    await Promise.all([
      registrarContagem({ rua: "B", codigo: "A1", quantidade: 1, responsavel: "Ana", fotoDataUri: FOTO_1X1, ...params }),
      registrarContagem({ rua: "B", codigo: "A2", quantidade: 2, responsavel: "Bruno", fotoDataUri: FOTO_1X1, ...params }),
      registrarContagem({ rua: "B", codigo: "A3", quantidade: 3, responsavel: "Carla", fotoDataUri: FOTO_1X1, ...params }),
      registrarContagem({ rua: "C", codigo: "A1", quantidade: 4, responsavel: "Diego", fotoDataUri: FOTO_1X1, ...params }),
    ]);

    const ruas = await listarEstoque();
    const totalPosicoes = ruas.reduce((soma, rua) => soma + rua.posicoes.length, 0);
    expect(totalPosicoes).toBe(4);
  });

  describe("catálogo de produtos", () => {
    it("lista vazio quando nenhum produto foi cadastrado", async () => {
      const { listarProdutos } = await freshEstoque();
      expect(await listarProdutos()).toEqual([]);
    });

    it("adiciona e lista produtos em ordem alfabética", async () => {
      const { adicionarProduto, listarProdutos } = await freshEstoque();
      await adicionarProduto("Ventilador");
      await adicionarProduto("Liquidificador");
      expect(await listarProdutos()).toEqual(["Liquidificador", "Ventilador"]);
    });

    it("rejeita produto duplicado (sem diferenciar maiúsculas/minúsculas)", async () => {
      const { adicionarProduto } = await freshEstoque();
      await adicionarProduto("Liquidificador");
      await expect(adicionarProduto("liquidificador")).rejects.toThrow(/já está cadastrado/i);
    });

    it("rejeita nome vazio", async () => {
      const { adicionarProduto } = await freshEstoque();
      await expect(adicionarProduto("   ")).rejects.toThrow(/informe o nome/i);
    });

    it("remove produto do catálogo", async () => {
      const { adicionarProduto, removerProduto, listarProdutos } = await freshEstoque();
      await adicionarProduto("Liquidificador");
      await removerProduto("Liquidificador");
      expect(await listarProdutos()).toEqual([]);
    });
  });
});

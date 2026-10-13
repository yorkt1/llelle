import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const uploadMock = vi.fn(async (_url: string, options: { folder: string; public_id: string }) => ({
  secure_url: `https://res.cloudinary.com/t/${options.folder}/${options.public_id}.jpg`,
}));
vi.mock("cloudinary", () => ({ v2: { config: vi.fn(), uploader: { upload: uploadMock } } }));

async function fresh() {
  vi.resetModules();
  return { ...(await import("../lib/fotosProdutos")), ...(await import("../lib/estoque")) };
}

describe("fotos manuais dos produtos", () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "fotos-prod-"));
    process.env.DATA_DIR = dataDir;
    process.env.CLOUDINARY_CLOUD_NAME = "t";
    process.env.CLOUDINARY_API_KEY = "t";
    process.env.CLOUDINARY_API_SECRET = "t";
    uploadMock.mockClear();
  });

  afterEach(async () => {
    for (const variable of ["DATA_DIR", "CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"]) {
      delete process.env[variable];
    }
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it("importar produto e referências do Tiny não inicia busca de foto", async () => {
    const { adicionarProdutos, registrarInfoProdutos, listarInfoProdutos } = await fresh();
    await adicionarProdutos(["Air Fryer Koti 4L"]);
    await registrarInfoProdutos([{ nome: "Air Fryer Koti 4L", idsTiny: ["77"] }]);

    expect((await listarInfoProdutos())["air fryer koti 4l"]).toMatchObject({
      idsTiny: ["77"],
      fotoStatus: "sem-foto",
    });
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it("move IDs e códigos Tiny para o nome normalizado e elimina a chave antiga", async () => {
    const { listarInfoProdutos, normalizarInfoProdutos, registrarInfoProdutos } = await fresh();
    const antigo = "Chaleira Koti - 110v ou 220v - 220V - Preta";
    const canonico = "Chaleira Koti - Preta 220V";
    await registrarInfoProdutos([
      { nome: antigo, idsTiny: ["1"], codigos: ["CHALEIRA-220"] },
      { nome: canonico, idsTiny: ["2"], codigos: ["CHALEIRA-PRETA"] },
    ]);

    await normalizarInfoProdutos({ [antigo]: canonico });

    const info = await listarInfoProdutos();
    expect(info["chaleira koti - preta 220v"]).toMatchObject({
      nome: canonico,
      idsTiny: ["2", "1"],
      codigos: ["CHALEIRA-PRETA", "CHALEIRA-220"],
    });
    expect(info["chaleira koti - 110v ou 220v - 220v - preta"]).toBeUndefined();
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it("trocar foto manualmente envia a imagem para o Cloudinary", async () => {
    const foto = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
    const { adicionarProdutos, definirFotoManual, listarInfoProdutos } = await fresh();
    await adicionarProdutos(["Air Fryer Koti 4L"]);

    const info = await definirFotoManual("Air Fryer Koti 4L", foto);

    expect(info).toMatchObject({
      fotoStatus: "ok",
      fotoOrigem: "manual",
      fotoUrl: "https://res.cloudinary.com/t/llelle-produtos/air-fryer-koti-4l-manual.jpg",
    });
    expect((await listarInfoProdutos())["air fryer koti 4l"]).toMatchObject({ fotoOrigem: "manual" });
    expect(uploadMock).toHaveBeenCalledOnce();
  });
});

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tinyGetMock = vi.fn();
vi.mock("../lib/tinyClient", () => ({ tinyGet: (...args: unknown[]) => tinyGetMock(...args) }));

const uploadMock = vi.fn(async (_url: string, o: { folder: string; public_id: string }) => ({ secure_url: `https://res.cloudinary.com/t/${o.folder}/${o.public_id}.jpg` }));
vi.mock("cloudinary", () => ({ v2: { config: vi.fn(), uploader: { upload: uploadMock } } }));

async function fresh() {
  vi.resetModules();
  return { ...(await import("../lib/fotosProdutos")), ...(await import("../lib/estoque")) };
}

describe("fotos dos produtos (Tiny → Cloudinary)", () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "fotos-prod-"));
    process.env.DATA_DIR = dataDir;
    process.env.OLIST_API_TOKEN = "t";
    process.env.CLOUDINARY_CLOUD_NAME = "t";
    process.env.CLOUDINARY_API_KEY = "t";
    process.env.CLOUDINARY_API_SECRET = "t";
    tinyGetMock.mockReset();
    uploadMock.mockClear();
  });

  afterEach(async () => {
    for (const v of ["DATA_DIR", "OLIST_API_TOKEN", "CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"]) delete process.env[v];
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it("importado do Tiny (com ID): abre o produto, sobe o anexo pro Cloudinary e guarda o link", async () => {
    tinyGetMock.mockImplementation(async (endpoint: string, params: Record<string, string>) => {
      expect(endpoint).toBe("produto.obter.php");
      expect(params.id).toBe("77");
      return { retorno: { status: "OK", produto: { anexos: [{ anexo: "https://tiny.s3/foto-af.jpg" }] } } };
    });
    const { adicionarProdutos, registrarInfoProdutos, tickFotosProdutos, listarInfoProdutos } = await fresh();
    await adicionarProdutos(["Air Fryer Koti 4L"]);
    await registrarInfoProdutos([{ nome: "Air Fryer Koti 4L", idsTiny: ["77"] }]);
    await tickFotosProdutos();

    expect(uploadMock).toHaveBeenCalledWith("https://tiny.s3/foto-af.jpg", expect.objectContaining({ folder: "llelle-produtos", public_id: "air-fryer-koti-4l", overwrite: true }));
    expect((await listarInfoProdutos())["air fryer koti 4l"]).toMatchObject({ fotoStatus: "ok", fotoUrl: "https://res.cloudinary.com/t/llelle-produtos/air-fryer-koti-4l.jpg" });
  });

  it("cadastrado à mão: botão acha pelo nome no Tiny; variação sem imagem usa a do produto pai", async () => {
    tinyGetMock.mockImplementation(async (endpoint: string, params: Record<string, string>) => {
      if (endpoint === "produtos.pesquisa.php") {
        return { retorno: { status: "OK", produtos: [{ produto: { id: 1, nome: "Outra coisa" } }, { produto: { id: 2, nome: "Chaleira Koti - 110V" } }] } };
      }
      if (params.id === "2") return { retorno: { status: "OK", produto: { idProdutoPai: 9, anexos: [] } } };
      if (params.id === "9") return { retorno: { status: "OK", produto: { imagens_externas: [{ imagem_externa: { url: "https://img/pai.png" } }] } } };
      throw new Error("inesperado");
    });
    const { adicionarProdutos, solicitarFotosFaltantes, tickFotosProdutos, listarInfoProdutos } = await fresh();
    await adicionarProdutos(["Chaleira Koti", "Sem Foto Nenhuma"]);
    expect(await solicitarFotosFaltantes()).toBe(2);

    tinyGetMock.mockImplementationOnce(async () => ({ retorno: { status: "OK", produtos: [{ produto: { id: 1, nome: "Outra coisa" } }, { produto: { id: 2, nome: "Chaleira Koti - 110V" } }] } }));
    await tickFotosProdutos();

    const info = await listarInfoProdutos();
    expect(info["chaleira koti"]).toMatchObject({ fotoStatus: "ok", idsTiny: ["2"] });
    expect(uploadMock).toHaveBeenCalledWith("https://img/pai.png", expect.anything());
  });

  it("foto trocada à mão: vai pro Cloudinary, nunca é sobrescrita pela busca do Tiny; 'Usar foto do Tiny' volta pra fila", async () => {
    const FOTO = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
    tinyGetMock.mockResolvedValue({ retorno: { status: "OK", produto: { anexos: [{ anexo: "https://tiny/foto.jpg" }] } } });
    const { adicionarProdutos, registrarInfoProdutos, definirFotoManual, solicitarFotosFaltantes, tickFotosProdutos, refazerFotoDoTiny, listarInfoProdutos } =
      await fresh();
    await adicionarProdutos(["Air Fryer Koti 4L"]);

    const info = await definirFotoManual("Air Fryer Koti 4L", FOTO);
    expect(info).toMatchObject({ fotoStatus: "ok", fotoOrigem: "manual", fotoUrl: "https://res.cloudinary.com/t/llelle-produtos/air-fryer-koti-4l-manual.jpg" });

    // Nada disso pode trocar a foto manual:
    await registrarInfoProdutos([{ nome: "Air Fryer Koti 4L", idsTiny: ["77"] }]);
    expect(await solicitarFotosFaltantes()).toBe(0);
    await tickFotosProdutos();
    expect(tinyGetMock).not.toHaveBeenCalled();
    expect((await listarInfoProdutos())["air fryer koti 4l"]).toMatchObject({ fotoOrigem: "manual" });

    await refazerFotoDoTiny("Air Fryer Koti 4L");
    expect((await listarInfoProdutos())["air fryer koti 4l"].fotoStatus).toBe("pendente");
    await tickFotosProdutos();
    expect((await listarInfoProdutos())["air fryer koti 4l"]).toMatchObject({ fotoStatus: "ok", fotoOrigem: "tiny" });
  });

  it("produto que o Tiny não acha fica 'não encontrado'; limite de taxa só pausa (continua pendente)", async () => {
    tinyGetMock.mockResolvedValueOnce({ retorno: { status: "Erro", codigo_erro: 6 } });
    const { adicionarProdutos, solicitarFotosFaltantes, tickFotosProdutos, listarInfoProdutos } = await fresh();
    await adicionarProdutos(["Produto Fantasma"]);
    await solicitarFotosFaltantes();

    await tickFotosProdutos();
    expect((await listarInfoProdutos())["produto fantasma"].fotoStatus).toBe("pendente");

    tinyGetMock.mockResolvedValueOnce({ retorno: { status: "Erro", codigo_erro: 20 } });
    await tickFotosProdutos();
    expect((await listarInfoProdutos())["produto fantasma"].fotoStatus).toBe("nao-encontrado");
  });
});

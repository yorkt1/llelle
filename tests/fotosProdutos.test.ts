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
    process.env.OLIST_API_TOKEN = "token-teste";
    uploadMock.mockClear();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    for (const variable of ["DATA_DIR", "CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET", "OLIST_API_TOKEN"]) {
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

  it("puxa anexo do Tiny por ID, salva no Cloudinary e preserva o vínculo", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      retorno: {
        status: "OK",
        produto: { anexos: [{ anexo: "https://tiny.test/produto.jpg" }] },
      },
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { adicionarProduto, registrarInfoProdutos, importarFotosFaltantesTiny, listarInfoProdutos } = await fresh();
    await adicionarProduto("Air Fryer Koti 4L");
    await registrarInfoProdutos([{ nome: "Air Fryer Koti 4L", idsTiny: ["77"], codigos: ["AF-4L"] }]);

    const resultados = await importarFotosFaltantesTiny(["Air Fryer Koti 4L"]);
    const info = (await listarInfoProdutos())["air fryer koti 4l"];

    expect(resultados).toEqual([{ nome: "Air Fryer Koti 4L", status: "importada" }]);
    expect(info).toMatchObject({
      idsTiny: ["77"],
      codigos: ["AF-4L"],
      fotoStatus: "ok",
      fotoOrigem: "tiny",
      fotoUrl: "https://res.cloudinary.com/t/llelle-produtos/air-fryer-koti-4l-tiny.jpg",
    });
    expect(uploadMock).toHaveBeenCalledWith("https://tiny.test/produto.jpg", expect.objectContaining({ folder: "llelle-produtos" }));
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("localiza o ID exato pelo nome para produto manual e usa imagem externa", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/produtos.pesquisa.php")) {
        return new Response(JSON.stringify({
          retorno: {
            status: "OK",
            numero_paginas: 1,
            produtos: [{ produto: { id: 99, nome: "Air Fryer Koti 4L", codigo: "AF-4L", tipoVariacao: "N" } }],
          },
        }), { status: 200 });
      }
      return new Response(JSON.stringify({
        retorno: {
          status: "OK",
          produto: { imagens_externas: [{ imagem_externa: { url: "https://tiny.test/externa.png" } }] },
        },
      }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { adicionarProduto, importarFotosFaltantesTiny, listarInfoProdutos } = await fresh();
    await adicionarProduto("Air Fryer Koti 4L");

    const resultados = await importarFotosFaltantesTiny(["Air Fryer Koti 4L"]);
    const info = (await listarInfoProdutos())["air fryer koti 4l"];

    expect(resultados).toEqual([{ nome: "Air Fryer Koti 4L", status: "importada" }]);
    expect(info).toMatchObject({ idsTiny: ["99"], codigos: ["AF-4L"], fotoStatus: "ok", fotoOrigem: "tiny" });
    expect(uploadMock).toHaveBeenCalledWith("https://tiny.test/externa.png", expect.objectContaining({ folder: "llelle-produtos" }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("tenta um fragmento do nome quando a pesquisa longa do Tiny não retorna registros", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/produtos.pesquisa.php")) {
        if (url.searchParams.get("pesquisa") === "Aquecedor Elétrico Thermo Confort Koti 110V") {
          return new Response(JSON.stringify({
            retorno: { status: "Erro", codigo_erro: "20", erros: [{ erro: "A consulta não retornou registros" }] },
          }), { status: 200 });
        }
        return new Response(JSON.stringify({
          retorno: {
            status: "OK",
            numero_paginas: 1,
            produtos: [{ produto: { id: 77, nome: "Aquecedor Elétrico Thermo Confort Koti 110V", codigo: "AQ-110", tipoVariacao: "N" } }],
          },
        }), { status: 200 });
      }
      return new Response(JSON.stringify({
        retorno: {
          status: "OK",
          produto: { anexos: [{ anexo: "https://tiny.test/aquecedor.jpg" }] },
        },
      }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { adicionarProduto, importarFotosFaltantesTiny, listarInfoProdutos } = await fresh();
    const nome = "Aquecedor Elétrico Thermo Confort Koti 110V";
    await adicionarProduto(nome);

    const resultados = await importarFotosFaltantesTiny([nome]);
    const info = (await listarInfoProdutos())["aquecedor elétrico thermo confort koti 110v"];

    expect(resultados).toEqual([{ nome, status: "importada" }]);
    expect(info).toMatchObject({ idsTiny: ["77"], codigos: ["AQ-110"], fotoStatus: "ok", fotoOrigem: "tiny" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("não vincula a foto de outra voltagem ao produto", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/produtos.pesquisa.php")) {
        return new Response(JSON.stringify({
          retorno: {
            status: "OK",
            numero_paginas: 1,
            produtos: [{ produto: { id: 77, nome: "Aquecedor Elétrico Thermo Confort Koti 220V", codigo: "AQ-220", tipoVariacao: "N" } }],
          },
        }), { status: 200 });
      }
      throw new Error("Não deveria abrir ou salvar o produto de outra voltagem.");
    });
    vi.stubGlobal("fetch", fetchMock);
    const { adicionarProduto, importarFotosFaltantesTiny, listarInfoProdutos } = await fresh();
    const nome = "Aquecedor Elétrico Thermo Confort Koti 110V";
    await adicionarProduto(nome);

    const resultados = await importarFotosFaltantesTiny([nome]);
    const info = (await listarInfoProdutos())["aquecedor elétrico thermo confort koti 110v"];

    expect(resultados).toEqual([{ nome, status: "sem-vinculo", mensagem: "Não encontrei um produto com nome correspondente no Tiny." }]);
    expect(info).toMatchObject({ idsTiny: [], fotoStatus: "nao-encontrado" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it("não sobrescreve uma foto manual ao buscar imagens faltantes", async () => {
    const fotoManual = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { adicionarProduto, definirFotoManual, importarFotosFaltantesTiny, listarInfoProdutos } = await fresh();
    await adicionarProduto("Air Fryer Koti 4L");
    await definirFotoManual("Air Fryer Koti 4L", fotoManual);

    const resultados = await importarFotosFaltantesTiny(["Air Fryer Koti 4L"]);
    const info = (await listarInfoProdutos())["air fryer koti 4l"];

    expect(resultados).toEqual([{ nome: "Air Fryer Koti 4L", status: "ja-tinha-foto" }]);
    expect(info.fotoOrigem).toBe("manual");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(uploadMock).toHaveBeenCalledOnce();
  });

  it("não pesquisa vários produtos sem ID juntos para respeitar o limite do Tiny", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { adicionarProdutos, importarFotosFaltantesTiny } = await fresh();
    await adicionarProdutos(["Produto Manual A", "Produto Manual B"]);

    await expect(importarFotosFaltantesTiny(["Produto Manual A", "Produto Manual B"])).rejects.toThrow(/apenas um produto sem ID/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// PNG 1x1 real (não precisa ser uma foto de verdade, só um data URI válido).
const FOTO_1X1 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

async function freshEstoque() {
  vi.resetModules();
  return import("../lib/estoque");
}

describe("estoque", () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "estoque-test-"));
    process.env.DATA_DIR = dataDir;
  });

  afterEach(async () => {
    delete process.env.DATA_DIR;
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it("lista vazio quando nunca teve nenhuma contagem", async () => {
    const { listarEstoque } = await freshEstoque();
    expect(await listarEstoque()).toEqual([]);
  });

  it("registra uma contagem e aparece em listarEstoque", async () => {
    const { registrarContagem, listarEstoque } = await freshEstoque();
    await registrarContagem({ rua: "B", codigo: "A5", quantidade: 12, responsavel: "Ana", fotoDataUri: FOTO_1X1 });

    const ruas = await listarEstoque();
    expect(ruas).toEqual([
      {
        rua: "B",
        posicoes: [{ rua: "B", codigo: "A5", ultima: expect.objectContaining({ quantidade: 12, responsavel: "Ana" }) }],
      },
    ]);
  });

  it("salva a foto em arquivo separado e referencia pelo nome — toda contagem tem foto, é obrigatória", async () => {
    const { registrarContagem, caminhoDaFoto } = await freshEstoque();
    const registro = await registrarContagem({ rua: "B", codigo: "A5", quantidade: 5, responsavel: "Ana", fotoDataUri: FOTO_1X1 });

    expect(registro.fotoArquivo).toMatch(/\.png$/);
    const conteudo = await fs.readFile(caminhoDaFoto(registro.fotoArquivo));
    expect(conteudo.length).toBeGreaterThan(0);
  });

  it("rejeita data URI em formato inválido", async () => {
    const { registrarContagem } = await freshEstoque();
    await expect(
      registrarContagem({ rua: "B", codigo: "A5", quantidade: 1, responsavel: "Ana", fotoDataUri: "nao-e-um-data-uri" }),
    ).rejects.toThrow(/formato inválido/i);
  });

  it("mantém histórico completo — contagem nova não apaga as antigas, e cada uma com sua própria foto", async () => {
    const { registrarContagem, obterHistorico } = await freshEstoque();
    await registrarContagem({ rua: "B", codigo: "A5", quantidade: 10, responsavel: "Ana", fotoDataUri: FOTO_1X1 });
    await registrarContagem({ rua: "B", codigo: "A5", quantidade: 8, responsavel: "Bruno", fotoDataUri: FOTO_1X1 });

    const historico = await obterHistorico("B", "A5");
    expect(historico).toHaveLength(2);
    // Mais recente primeiro.
    expect(historico[0]).toMatchObject({ quantidade: 8, responsavel: "Bruno" });
    expect(historico[1]).toMatchObject({ quantidade: 10, responsavel: "Ana" });
    // Cada registro tem seu próprio arquivo de foto (não reaproveita o da contagem anterior).
    expect(historico[0].fotoArquivo).not.toBe(historico[1].fotoArquivo);
  });

  it("listarEstoque mostra só a contagem mais recente de cada posição", async () => {
    const { registrarContagem, listarEstoque } = await freshEstoque();
    await registrarContagem({ rua: "B", codigo: "A5", quantidade: 10, responsavel: "Ana", fotoDataUri: FOTO_1X1 });
    await registrarContagem({ rua: "B", codigo: "A5", quantidade: 8, responsavel: "Bruno", fotoDataUri: FOTO_1X1 });

    const ruas = await listarEstoque();
    expect(ruas[0].posicoes[0].ultima).toMatchObject({ quantidade: 8, responsavel: "Bruno" });
  });

  it("obterHistorico devolve lista vazia pra posição nunca contada", async () => {
    const { obterHistorico } = await freshEstoque();
    expect(await obterHistorico("Z", "NUNCA-EXISTIU")).toEqual([]);
  });

  it("agrupa por rua e ordena posições numericamente (A5 antes de A12)", async () => {
    const { registrarContagem, listarEstoque } = await freshEstoque();
    await registrarContagem({ rua: "b", codigo: "a12", quantidade: 1, responsavel: "Ana", fotoDataUri: FOTO_1X1 });
    await registrarContagem({ rua: "B", codigo: "A5", quantidade: 2, responsavel: "Ana", fotoDataUri: FOTO_1X1 });
    await registrarContagem({ rua: "C", codigo: "X1", quantidade: 3, responsavel: "Ana", fotoDataUri: FOTO_1X1 });

    const ruas = await listarEstoque();
    expect(ruas.map((r) => r.rua)).toEqual(["B", "C"]);
    // rua/código normalizados pra maiúsculo, mesma posição de "b"/"a12" e "B"/"A5" não se colidem.
    expect(ruas[0].posicoes.map((p) => p.codigo)).toEqual(["A5", "A12"]);
  });

  it("caminhoDaFoto devolve caminho ABSOLUTO mesmo sem DATA_DIR configurado — res.sendFile exige isso, senão lança síncrono (500 em vez de 404)", async () => {
    delete process.env.DATA_DIR; // produção não tem essa variável — store.dataDir() cai no padrão relativo "./data"
    const { caminhoDaFoto } = await freshEstoque();
    expect(path.isAbsolute(caminhoDaFoto("qualquer.jpg"))).toBe(true);
  });

  it("não perde nenhuma contagem quando duas posições diferentes são registradas ao mesmo tempo", async () => {
    const { registrarContagem, listarEstoque } = await freshEstoque();

    await Promise.all([
      registrarContagem({ rua: "B", codigo: "A1", quantidade: 1, responsavel: "Ana", fotoDataUri: FOTO_1X1 }),
      registrarContagem({ rua: "B", codigo: "A2", quantidade: 2, responsavel: "Bruno", fotoDataUri: FOTO_1X1 }),
      registrarContagem({ rua: "B", codigo: "A3", quantidade: 3, responsavel: "Carla", fotoDataUri: FOTO_1X1 }),
      registrarContagem({ rua: "C", codigo: "A1", quantidade: 4, responsavel: "Diego", fotoDataUri: FOTO_1X1 }),
    ]);

    const ruas = await listarEstoque();
    const totalPosicoes = ruas.reduce((soma, rua) => soma + rua.posicoes.length, 0);
    expect(totalPosicoes).toBe(4);
  });
});

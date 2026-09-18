import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseSalesReport } from "@/lib/domain/parser";
import { parseProductPaste } from "@/lib/domain/seed";
import type { Repository } from "@/lib/storage/types";
import type { computeColumn as ComputeColumn } from "@/lib/service/columns";

const HEADER = "E-commerce;Produto;Código (SKU);Quantidade;Valor;Frete;Total";

// Exportado com base em pedidos: inclui o que ainda nao virou nota.
const POR_PEDIDO = [
  HEADER,
  "Shopee;;;;;;",
  ";Aquecedor Elétrico Ambiente 110V;LLEAQ-110;10;800;0;800",
  ";Abajur Mesa Azul Bivolt;LLEAB-4;4;197;0;197",
].join("\n");

// Exportado com base em notas emitidas: o aquecedor tem duas notas pendentes.
const POR_NOTA = [
  HEADER,
  "Shopee;;;;;;",
  ";Aquecedor Ambiente 110V - Anúncio novo;LLEAQ-110;8;640;0;640",
  ";Abajur Mesa Azul Bivolt;LLEAB-4;4;197;0;197",
].join("\n");

let dir: string;
let repo: Repository;
let computeColumn: typeof ComputeColumn;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "vitae-dois-"));
  process.env.DATA_DIR = dir;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;

  const storage = await import("@/lib/storage");
  repo = storage.getRepository();
  computeColumn = (await import("@/lib/service/columns")).computeColumn;

  const { seeds } = parseProductPaste("AQUECEDOR 110V\tLLEAQ-110\t50\nABAJUR AZUL\tLLEAB-4\t20");
  await repo.importProducts(seeds, "2026-09-07", true);
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("comparação entre dois relatórios exportados do Tiny", () => {
  it("mostra a divergência mesmo quando cada modo vem de um arquivo", async () => {
    const pedidos = await repo.saveUpload({
      filename: "por-pedido.csv",
      report: await parseSalesReport(Buffer.from(POR_PEDIDO, "utf8")),
    });
    const notas = await repo.saveUpload({
      filename: "por-nota.csv",
      report: await parseSalesReport(Buffer.from(POR_NOTA, "utf8")),
    });

    const resultado = await computeColumn({
      uploadId: pedidos.id,
      invoiceUploadId: notas.id,
      start: "2026-09-08",
      mode: "order",
    });

    const aquecedor = resultado.preview.rows.find((r) => r.sheetName === "AQUECEDOR 110V");
    const abajur = resultado.preview.rows.find((r) => r.sheetName === "ABAJUR AZUL");

    // O nome do anuncio muda entre os dois arquivos, mas o SKU leva os dois para
    // a mesma linha da planilha.
    expect(aquecedor).toMatchObject({ soldByOrder: 10, soldByInvoice: 8, diverges: true, newBalance: 40 });
    expect(abajur).toMatchObject({ soldByOrder: 4, soldByInvoice: 4, diverges: false, newBalance: 16 });
    expect(resultado.preview.divergentCount).toBe(1);
    expect(resultado.report.invoiceFilename).toBe("por-nota.csv");
  });

  it("trocar o modo troca o saldo gravado na coluna", async () => {
    const pedidos = await repo.saveUpload({
      filename: "por-pedido.csv",
      report: await parseSalesReport(Buffer.from(POR_PEDIDO, "utf8")),
    });
    const notas = await repo.saveUpload({
      filename: "por-nota.csv",
      report: await parseSalesReport(Buffer.from(POR_NOTA, "utf8")),
    });
    const base = { uploadId: pedidos.id, invoiceUploadId: notas.id, start: "2026-09-08" } as const;

    const porPedido = await computeColumn({ ...base, mode: "order" });
    const porNota = await computeColumn({ ...base, mode: "invoice" });

    expect(porPedido.preview.rows.map((r) => r.newBalance)).toEqual([40, 16]);
    expect(porNota.preview.rows.map((r) => r.newBalance)).toEqual([42, 16]);
  });
});

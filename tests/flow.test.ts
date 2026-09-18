import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { toClipboardColumn, unresolvedCount } from "@/lib/domain/column";
import { OUT_OF_SHEET } from "@/lib/domain/matching";
import { parseSalesReport } from "@/lib/domain/parser";
import { parseProductPaste } from "@/lib/domain/seed";
import type { Repository } from "@/lib/storage/types";
import type { commitColumn as CommitColumn, computeColumn as ComputeColumn } from "@/lib/service/columns";

// Duas colunas coladas da planilha: nome curto + saldo da ultima coluna preenchida.
const PLANILHA = ["Produto\tSaldo", "AQUECEDOR 110V\t30", "AQUECEDOR 220V\t12", "VENTILADOR 40CM\t4"].join("\n");

const RELATORIO_DIA_8 = [
  "Número;Data;Situação;Código;Descrição;Quantidade;Nota Fiscal;Data da nota;Situação da nota",
  "1001;08/09/2026;Aprovado;;Aquecedor de Ambiente Elétrico 110V Portátil;2;5001;08/09/2026;Emitida",
  "1002;08/09/2026;Aprovado;;Ventilador Industrial 40cm Preto;1;5002;08/09/2026;Emitida",
  "1003;08/09/2026;Cancelado;;Aquecedor de Ambiente Elétrico 110V Portátil;5;;;",
  "1004;08/09/2026;Aprovado;;Aquecedor de Ambiente Elétrico 110V Portátil;3;;;",
].join("\n");

let dir: string;
let repo: Repository;
let computeColumn: typeof ComputeColumn;
let commitColumn: typeof CommitColumn;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "vitae-"));
  process.env.DATA_DIR = dir;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;

  const storage = await import("@/lib/storage");
  const service = await import("@/lib/service/columns");
  repo = storage.getRepository();
  computeColumn = service.computeColumn;
  commitColumn = service.commitColumn;
  expect(storage.storageDriver()).toBe("local");
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("fluxo completo: planilha -> relatorio -> coluna nova", () => {
  it("importa o saldo de partida colado da planilha", async () => {
    const { seeds } = parseProductPaste(PLANILHA);
    expect(seeds).toHaveLength(3);
    const produtos = await repo.importProducts(seeds, "2026-09-07", true);
    expect(produtos.map((p) => p.sheetName)).toEqual(["AQUECEDOR 110V", "AQUECEDOR 220V", "VENTILADOR 40CM"]);

    const { balances } = await repo.latestBalances();
    expect(Object.values(balances).sort((a, b) => a - b)).toEqual([4, 12, 30]);
  });

  it("gera a coluna do dia nos dois modos a partir do relatorio do Tiny", async () => {
    const report = await parseSalesReport(Buffer.from(RELATORIO_DIA_8, "utf8"));
    const upload = await repo.saveUpload({ filename: "vendas-08-09.csv", report });

    const porPedido = await computeColumn({ uploadId: upload.id, start: "2026-09-08", mode: "order" });
    expect(unresolvedCount(porPedido.preview)).toBe(0);
    expect(porPedido.preview.rows.map((r) => r.newBalance)).toEqual([25, 12, 3]);
    expect(toClipboardColumn(porPedido.preview.rows)).toBe("25\n12\n3");

    const porNota = await computeColumn({ uploadId: upload.id, start: "2026-09-08", mode: "invoice" });
    expect(porNota.preview.rows.map((r) => r.newBalance)).toEqual([28, 12, 3]);

    // O aquecedor diverge (5 por pedido, 2 por nota); o ventilador nao.
    expect(porPedido.preview.divergentCount).toBe(1);
    expect(porPedido.preview.rows[0]).toMatchObject({ soldByOrder: 5, soldByInvoice: 2, diverges: true });
    expect(porPedido.preview.rows[2].diverges).toBe(false);
  });

  it("fecha a coluna e o saldo gravado vira o anterior do dia seguinte", async () => {
    const report = await parseSalesReport(Buffer.from(RELATORIO_DIA_8, "utf8"));
    const upload = await repo.saveUpload({ filename: "vendas-08-09.csv", report });

    const commit = await commitColumn({ uploadId: upload.id, start: "2026-09-08", mode: "order" });
    expect(commit.ok).toBe(true);
    if (commit.ok) expect(commit.snapshot.label).toBe("08/09");

    const dia9 = await computeColumn({ uploadId: upload.id, start: "2026-09-09", mode: "order" });
    // Nenhuma venda do dia 09 no arquivo: os saldos do dia 08 sao mantidos.
    expect(dia9.preview.rows.map((r) => r.previousBalance)).toEqual([25, 12, 3]);
    expect(dia9.preview.rows.map((r) => r.newBalance)).toEqual([25, 12, 3]);
    expect(dia9.preview.skippedLines).toBe(4);
  });

  it("recusa fechar a coluna com produto do relatorio sem destino na planilha", async () => {
    const csv = [
      "Número;Data;Situação;Descrição;Quantidade",
      "2001;10/09/2026;Aprovado;Cadeira Gamer XPTO;7",
    ].join("\n");
    const report = await parseSalesReport(Buffer.from(csv, "utf8"));
    const upload = await repo.saveUpload({ filename: "novo-produto.csv", report });

    const recusado = await commitColumn({ uploadId: upload.id, start: "2026-09-10", mode: "order" });
    expect(recusado.ok).toBe(false);
    if (!recusado.ok) {
      expect(recusado.unresolved).toBe(1);
      expect(recusado.output.preview.unknown[0].reportName).toBe("Cadeira Gamer XPTO");
    }

    // Depois que a pessoa confirma que o produto esta fora da planilha, fecha.
    const aceito = await commitColumn({
      uploadId: upload.id,
      start: "2026-09-10",
      mode: "order",
      decisions: { "Cadeira Gamer XPTO": OUT_OF_SHEET },
    });
    expect(aceito.ok).toBe(true);
  });

  it("memoriza o mapeamento aprendido para nao perguntar de novo", async () => {
    const aliases = await repo.listAliases();
    const anuncio = aliases.find((a) => a.reportName === "Aquecedor de Ambiente Elétrico 110V Portátil");
    expect(anuncio?.productId).toBeTruthy();

    // O que a pessoa marcou como fora da planilha tambem fica memorizado, com
    // destino nulo: continua visivel na tela, mas nao volta a travar o fechamento.
    const foraDaPlanilha = aliases.find((a) => a.reportName === "Cadeira Gamer XPTO");
    expect(foraDaPlanilha).toMatchObject({ productId: null, source: "manual" });
  });
});

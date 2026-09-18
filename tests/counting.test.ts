import { describe, expect, it } from "vitest";
import { aggregateSales, collectStatuses } from "@/lib/domain/aggregate";
import { parseSalesReport } from "@/lib/domain/parser";
import { buildPeriod } from "@/lib/domain/period";
import { DEFAULT_COUNTING_RULES, type ParsedReport } from "@/lib/domain/types";

const CSV = [
  "Número;Data;Situação;Código;Descrição;Quantidade;Nota Fiscal;Data da nota;Situação da nota",
  "1001;08/09/2026;Aprovado;SKU-1;Aquecedor 110V;2;5001;08/09/2026;Emitida",
  "1002;08/09/2026;Aprovado;SKU-2;Ventilador 40cm;1;5002;08/09/2026;Emitida",
  "1003;08/09/2026;Cancelado;SKU-1;Aquecedor 110V;5;;;",
  "1004;08/09/2026;Aprovado;SKU-1;Aquecedor 110V;3;;;",
  "1005;07/09/2026;Aprovado;SKU-2;Ventilador 40cm;9;5003;07/09/2026;Emitida",
  "1006;08/09/2026;Aprovado;SKU-2;Ventilador 40cm;4;5004;08/09/2026;Cancelada",
].join("\n");

async function fixture(): Promise<ParsedReport> {
  return parseSalesReport(Buffer.from(CSV, "utf8"));
}

const dia8 = buildPeriod("2026-09-08");

describe("aggregateSales", () => {
  it("conta por pedido excluindo cancelados", async () => {
    const { sales } = aggregateSales(await fixture(), dia8, DEFAULT_COUNTING_RULES);
    const aquecedor = sales.find((s) => s.rawProductName === "Aquecedor 110V");
    // 2 (com NF) + 3 (sem NF); o pedido cancelado de 5 nao entra.
    expect(aquecedor?.byOrder).toBe(5);
  });

  it("conta por nota fiscal apenas o que virou NF valida", async () => {
    const { sales } = aggregateSales(await fixture(), dia8, DEFAULT_COUNTING_RULES);
    const aquecedor = sales.find((s) => s.rawProductName === "Aquecedor 110V");
    const ventilador = sales.find((s) => s.rawProductName === "Ventilador 40cm");
    expect(aquecedor?.byInvoice).toBe(2);
    // A NF cancelada (4) e a do dia 07 (9) ficam de fora.
    expect(ventilador?.byOrder).toBe(5);
    expect(ventilador?.byInvoice).toBe(1);
  });

  it("expoe a divergencia entre os dois modos", async () => {
    const { sales } = aggregateSales(await fixture(), dia8, DEFAULT_COUNTING_RULES);
    const divergentes = sales.filter((s) => s.byOrder !== s.byInvoice).map((s) => s.rawProductName);
    expect(divergentes).toEqual(["Aquecedor 110V", "Ventilador 40cm"]);
  });

  it("nao descarta linha em silencio: o que nao conta vira contagem visivel", async () => {
    const { skippedLines } = aggregateSales(await fixture(), dia8, DEFAULT_COUNTING_RULES);
    // O pedido do dia 07 (fora do periodo) e o cancelado sem NF, que nao
    // entram nem por pedido nem por nota.
    expect(skippedLines).toBe(2);
  });

  it("aceita regras parametrizaveis: incluir cancelados muda o resultado", async () => {
    const { sales } = aggregateSales(await fixture(), dia8, {
      ...DEFAULT_COUNTING_RULES,
      excludedOrderStatuses: [],
    });
    expect(sales.find((s) => s.rawProductName === "Aquecedor 110V")?.byOrder).toBe(10);
  });

  it("soma dias corridos quando a coluna agrupa um fim de semana", async () => {
    const fds = buildPeriod("2026-09-07", "2026-09-08");
    const { sales, skippedLines } = aggregateSales(await fixture(), fds, DEFAULT_COUNTING_RULES);
    expect(sales.find((s) => s.rawProductName === "Ventilador 40cm")?.byOrder).toBe(14);
    // Com os dois dias no periodo, so sobra o pedido cancelado sem nota.
    expect(skippedLines).toBe(1);
    expect(fds.label).toBe("07/09 à 08/09");
  });

  it("lista as situacoes do arquivo para alimentar os filtros da tela", async () => {
    const statuses = collectStatuses(await fixture());
    expect(statuses.order).toEqual(["Aprovado", "Cancelado"]);
    expect(statuses.invoice).toEqual(["Cancelada", "Emitida"]);
  });
});

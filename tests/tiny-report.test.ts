import { describe, expect, it } from "vitest";
import { aggregateSales, collectStatuses } from "@/lib/domain/aggregate";
import { parseSalesReport } from "@/lib/domain/parser";
import { buildPeriod } from "@/lib/domain/period";
import { DEFAULT_COUNTING_RULES } from "@/lib/domain/types";

/**
 * Formato observado do export do Tiny: agregado por produto e agrupado por canal.
 * O nome do canal aparece sozinho na linha de faixa; as linhas de produto abaixo
 * pertencem a ele. Nao ha coluna de data nem de nota fiscal.
 */
const RELATORIO = [
  "E-commerce;Produto;Código (SKU);Quantidade;Valor;Frete;Total",
  "Amazon;;;;;;",
  ";Mixer de Ninho Portátil;LLEMX-2;1;66;15;81",
  "Amazon FBA Classic;;;;;;",
  ";Chaleira Elétrica Cerâmica 1,7L;LLECC;14;545,86;0;545,86",
  "Mercado Livre;;;;;;",
  ";Abajur Mesa Azul Bivolt;LLEAB-4;4;197,96;0;197,96",
  ";Aquecedor Elétrico Ambiente 110V;LLEAQ-110;2;167,99;0;167,99",
  "Mercado Livre Fulfillment;;;;;;",
  ";Aquecedor Elétrico Ambiente 110V;LLEAQ-110;8;635,99;45,97;681,96",
  "Shopee;;;;;;",
  ";Abajur Mesa Azul Bivolt;LLEAB-4;5;239,54;0;239,54",
  ";Aquecedor Elétrico Ambiente 110V;LLEAQ-110;16;1249,12;12,04;1261,16",
].join("\n");

const periodo = buildPeriod("2026-09-08");

describe("relatório agregado do Tiny, agrupado por canal", () => {
  it("identifica as colunas sem confundir Quantidade com Valor/Frete/Total", async () => {
    const report = await parseSalesReport(Buffer.from(RELATORIO, "utf8"));
    expect(report.mapping).toMatchObject({ channel: 0, productName: 1, sku: 2, quantity: 3 });
  });

  it("herda o canal da linha de faixa e descarta a própria faixa", async () => {
    const report = await parseSalesReport(Buffer.from(RELATORIO, "utf8"));
    expect(report.lines).toHaveLength(7);
    expect(report.lines[0]).toMatchObject({
      rawProductName: "Mixer de Ninho Portátil",
      sku: "LLEMX-2",
      quantity: 1,
      channel: "Amazon",
    });
    expect(report.lines[report.lines.length - 1].channel).toBe("Shopee");
    expect(collectStatuses(report).channels).toEqual([
      "Amazon",
      "Amazon FBA Classic",
      "Mercado Livre",
      "Mercado Livre Fulfillment",
      "Shopee",
    ]);
  });

  it("avisa que este relatório não distingue pedido de nota fiscal", async () => {
    const report = await parseSalesReport(Buffer.from(RELATORIO, "utf8"));
    expect(report.warnings.join(" ")).toMatch(/Nota Fiscal/i);
    expect(report.warnings.join(" ")).toMatch(/data/i);
  });

  it("sem coluna de data, conta o arquivo inteiro no período escolhido", async () => {
    const report = await parseSalesReport(Buffer.from(RELATORIO, "utf8"));
    const { sales, skippedLines } = aggregateSales(report, periodo, DEFAULT_COUNTING_RULES);
    const aquecedor = sales.find((s) => s.sku === "LLEAQ-110");
    // 2 (ML) + 8 (ML Full) + 16 (Shopee): o mesmo SKU somado entre canais.
    expect(aquecedor?.byOrder).toBe(26);
    expect(skippedLines).toBe(0);
  });

  it("permite separar o full, que hoje é conferido por fora", async () => {
    const report = await parseSalesReport(Buffer.from(RELATORIO, "utf8"));
    const { sales } = aggregateSales(report, periodo, {
      ...DEFAULT_COUNTING_RULES,
      excludedChannels: ["Mercado Livre Fulfillment", "Amazon FBA Classic"],
    });
    expect(sales.find((s) => s.sku === "LLEAQ-110")?.byOrder).toBe(18);
    expect(sales.find((s) => s.sku === "LLECC")).toBeUndefined();
  });
});

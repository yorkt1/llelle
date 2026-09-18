import { describe, expect, it } from "vitest";
import { OUT_OF_SHEET, resolveSales } from "@/lib/domain/matching";
import { buildColumn, toClipboardColumn } from "@/lib/domain/column";
import { buildPeriod } from "@/lib/domain/period";
import type { AggregatedSale, Product, ProductAlias } from "@/lib/domain/types";

const produtos: Product[] = [
  { id: "p1", sheetName: "AQUECEDOR 110V", rowOrder: 1, sku: "SKU-1", active: true },
  { id: "p2", sheetName: "AQUECEDOR 220V", rowOrder: 2, sku: "SKU-2", active: true },
  { id: "p3", sheetName: "VENTILADOR 40CM", rowOrder: 3, sku: null, active: true },
];

function venda(nome: string, byOrder = 1, byInvoice = byOrder, sku: string | null = null): AggregatedSale {
  return { rawProductName: nome, sku, byOrder, byInvoice, orderLines: 1, invoiceLines: 1 };
}

describe("resolveSales", () => {
  it("usa o mapeamento ja salvo antes de qualquer palpite", () => {
    const aliases: ProductAlias[] = [
      {
        id: "a1",
        reportName: "Aquecedor Turbo Cinza",
        normalized: "AQUECEDOR TURBO CINZA",
        productId: "p2",
        source: "manual",
        createdAt: "2026-09-01T00:00:00Z",
      },
    ];
    const result = resolveSales([venda("Aquecedor Turbo Cinza", 4)], produtos, aliases);
    expect(result.resolved.get("p2")?.byOrder).toBe(4);
    expect(result.pending).toHaveLength(0);
  });

  it("casa por SKU exato mesmo com o nome do anuncio diferente", () => {
    const result = resolveSales([venda("Nome completamente diferente", 2, 2, "SKU-2")], produtos, []);
    expect(result.resolved.get("p2")?.byOrder).toBe(2);
    expect(result.learned).toContainEqual({
      reportName: "Nome completamente diferente",
      productId: "p2",
      source: "auto",
    });
  });

  it("mapeia sozinho o titulo longo de anuncio", () => {
    const result = resolveSales([venda("Aquecedor de Ambiente Elétrico 110V Portátil", 3)], produtos, []);
    expect(result.resolved.get("p1")?.byOrder).toBe(3);
  });

  it("nao arrisca palpite ambiguo: manda para decisao humana com sugestoes", () => {
    const result = resolveSales([venda("Aquecedor Eletrico Bivolt", 1)], produtos, []);
    expect(result.resolved.size).toBe(0);
    expect(result.pending).toHaveLength(1);
    // Bivolt poderia ser 110V ou 220V; as duas linhas aparecem como opcao.
    expect(result.pending[0].suggestions.map((s) => s.sheetName)).toEqual(
      expect.arrayContaining(["AQUECEDOR 110V", "AQUECEDOR 220V"]),
    );
  });

  it("sinaliza produto novo em vez de descartar", () => {
    const result = resolveSales([venda("Cadeira Gamer XPTO", 7)], produtos, []);
    expect(result.unknown).toHaveLength(1);
    expect(result.unknown[0]).toMatchObject({ reportName: "Cadeira Gamer XPTO", byOrder: 7, acknowledged: false });
  });

  it("aplica a decisao do usuario e a memoriza como manual", () => {
    const result = resolveSales([venda("Aquecedor Eletrico Bivolt", 6)], produtos, [], {
      "Aquecedor Eletrico Bivolt": "p2",
    });
    expect(result.resolved.get("p2")?.byOrder).toBe(6);
    expect(result.learned[0].source).toBe("manual");
  });

  it("deixa marcar de vez que um nome esta fora da planilha", () => {
    const result = resolveSales([venda("Brinde Promocional", 3)], produtos, [], {
      "Brinde Promocional": OUT_OF_SHEET,
    });
    expect(result.unknown[0].acknowledged).toBe(true);
    expect(result.learned[0]).toMatchObject({ productId: null, source: "manual" });
  });

  it("soma no mesmo produto quando dois anuncios apontam para a mesma linha", () => {
    const result = resolveSales(
      [venda("Aquecedor de Ambiente 110V", 2), venda("Aquecedor Portatil 110V Cinza", 3)],
      produtos,
      [],
    );
    expect(result.resolved.get("p1")?.byOrder).toBe(5);
    expect(result.resolved.get("p1")?.matchedNames).toHaveLength(2);
  });
});

describe("buildColumn", () => {
  const periodo = buildPeriod("2026-09-08");

  function montar(mode: "order" | "invoice") {
    const resolution = resolveSales(
      [venda("AQUECEDOR 110V", 5, 2), venda("VENTILADOR 40CM", 1, 1)],
      produtos,
      [],
    );
    return buildColumn({
      products: produtos,
      previousBalances: { p1: 30, p2: 12, p3: 4 },
      resolution,
      mode,
      period: periodo,
      skippedLines: 0,
      invoiceAvailable: true,
    });
  }

  it("mantem a ordem das linhas da planilha", () => {
    expect(montar("order").rows.map((r) => r.sheetName)).toEqual([
      "AQUECEDOR 110V",
      "AQUECEDOR 220V",
      "VENTILADOR 40CM",
    ]);
  });

  it("subtrai conforme o modo escolhido", () => {
    expect(montar("order").rows[0].newBalance).toBe(25);
    expect(montar("invoice").rows[0].newBalance).toBe(28);
  });

  it("produto sem venda mantem o saldo do dia anterior", () => {
    const linha = montar("order").rows[1];
    expect(linha).toMatchObject({ soldQty: 0, previousBalance: 12, newBalance: 12, status: "no-sale" });
  });

  it("marca as linhas em que os dois modos divergem", () => {
    const resultado = montar("order");
    expect(resultado.divergentCount).toBe(1);
    expect(resultado.rows.filter((r) => r.diverges).map((r) => r.sheetName)).toEqual(["AQUECEDOR 110V"]);
  });

  it("avisa quando o saldo fica negativo em vez de zerar calado", () => {
    const resolution = resolveSales([venda("AQUECEDOR 110V", 99, 99)], produtos, []);
    const resultado = buildColumn({
      products: produtos,
      previousBalances: { p1: 3 },
      resolution,
      mode: "order",
      period: periodo,
      skippedLines: 0,
      invoiceAvailable: true,
    });
    expect(resultado.rows[0]).toMatchObject({ newBalance: -96, status: "negative" });
  });

  it("exporta uma celula por linha, na ordem, pronta para colar", () => {
    expect(toClipboardColumn(montar("order").rows)).toBe("25\n12\n3");
  });
});

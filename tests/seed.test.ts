import { describe, expect, it } from "vitest";
import { parseProductPaste } from "@/lib/domain/seed";

describe("parseProductPaste", () => {
  it("le o colar de duas colunas do Excel e preserva a ordem das linhas", () => {
    const { seeds } = parseProductPaste("AQUECEDOR 110V\t30\nAQUECEDOR 220V\t12\nVENTILADOR 40CM\t4");
    expect(seeds).toEqual([
      { sheetName: "AQUECEDOR 110V", sku: null, balance: 30 },
      { sheetName: "AQUECEDOR 220V", sku: null, balance: 12 },
      { sheetName: "VENTILADOR 40CM", sku: null, balance: 4 },
    ]);
  });

  it("descarta a linha de cabecalho quando ela vem junto", () => {
    const { seeds } = parseProductPaste("Produto\tSaldo\nAQUECEDOR 110V\t30");
    expect(seeds).toHaveLength(1);
    expect(seeds[0].sheetName).toBe("AQUECEDOR 110V");
  });

  it("aceita a coluna de SKU no meio", () => {
    const { seeds } = parseProductPaste("AQUECEDOR 110V\tSKU-1\t30");
    expect(seeds[0]).toEqual({ sheetName: "AQUECEDOR 110V", sku: "SKU-1", balance: 30 });
  });

  it("aceita so a lista de nomes, com saldo zero", () => {
    const { seeds } = parseProductPaste("AQUECEDOR 110V\nVENTILADOR 40CM");
    expect(seeds.map((s) => s.balance)).toEqual([0, 0]);
  });

  it("entende saldo em formato brasileiro e negativo", () => {
    const { seeds } = parseProductPaste("A\t1.234\nB\t12,5\nC\t-3");
    expect(seeds.map((s) => s.balance)).toEqual([1234, 12.5, -3]);
  });

  it("avisa sobre saldo faltando e nome repetido em vez de assumir calado", () => {
    const { seeds, warnings } = parseProductPaste("AQUECEDOR 110V\tsem numero\nAQUECEDOR 110V\t5");
    expect(seeds[0].balance).toBe(0);
    expect(warnings.join(" ")).toMatch(/saldo 0/);
    expect(warnings.join(" ")).toMatch(/repetidos/);
  });

  it("ignora linhas em branco no meio do bloco colado", () => {
    const { seeds } = parseProductPaste("A\t1\n\n\nB\t2\n");
    expect(seeds).toHaveLength(2);
  });
});

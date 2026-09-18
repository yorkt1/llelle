import { describe, expect, it } from "vitest";
import {
  normalizeName,
  normalizeSku,
  parseBalance,
  parseDateLoose,
  parseQuantity,
} from "@/lib/domain/normalize";

describe("normalizeName", () => {
  it("ignora acento, caixa e pontuacao", () => {
    expect(normalizeName("Aquecedor 110v.")).toBe("AQUECEDOR 110V");
    expect(normalizeName("AQUECEDOR  110V")).toBe("AQUECEDOR 110V");
    expect(normalizeName("Ventilação Água - Óleo")).toBe("VENTILACAO AGUA OLEO");
  });
});

describe("parseQuantity", () => {
  it("le os formatos numericos que o Tiny e o Excel produzem", () => {
    expect(parseQuantity(3)).toBe(3);
    expect(parseQuantity("2")).toBe(2);
    expect(parseQuantity("1,00")).toBe(1);
    expect(parseQuantity("1.234,50")).toBe(1234.5);
    expect(parseQuantity("1.234")).toBe(1234);
    expect(parseQuantity("1.5")).toBe(1.5);
    expect(parseQuantity("")).toBe(0);
    expect(parseQuantity("abc")).toBe(0);
  });
});

describe("parseDateLoose", () => {
  it("aceita dd/mm/aaaa, ISO, Date e serial do Excel", () => {
    expect(parseDateLoose("08/09/2026")).toBe("2026-09-08");
    expect(parseDateLoose("8/9/26")).toBe("2026-09-08");
    expect(parseDateLoose("08/09/2026 14:32:10")).toBe("2026-09-08");
    expect(parseDateLoose("2026-09-08")).toBe("2026-09-08");
    expect(parseDateLoose(new Date(Date.UTC(2026, 8, 8)))).toBe("2026-09-08");
    expect(parseDateLoose(46273)).toBe("2026-09-08");
  });

  it("rejeita lixo em vez de inventar data", () => {
    expect(parseDateLoose("")).toBeNull();
    expect(parseDateLoose("sem data")).toBeNull();
    expect(parseDateLoose("32/13/2026")).toBeNull();
  });
});

describe("normalizeSku e parseBalance", () => {
  it("normaliza sku e distingue vazio de zero", () => {
    expect(normalizeSku(" ab-12 ")).toBe("AB-12");
    expect(normalizeSku("")).toBeNull();
    expect(parseBalance("0")).toBe(0);
    expect(parseBalance("")).toBeNull();
    expect(parseBalance("-4")).toBe(-4);
    expect(parseBalance("texto")).toBeNull();
  });
});

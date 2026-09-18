import { describe, expect, it } from "vitest";
import { AUTO_ACCEPT_SCORE, rankCandidates, similarity } from "@/lib/domain/fuzzy";

describe("similarity", () => {
  it("casa o nome curto da planilha dentro do titulo longo do anuncio", () => {
    const score = similarity(
      "Aquecedor de Ambiente Eletrico 110V Portatil Cinza - Envio Rapido",
      "AQUECEDOR 110V",
    );
    expect(score).toBeGreaterThanOrEqual(AUTO_ACCEPT_SCORE);
  });

  it("separa voltagens diferentes, que sao produtos diferentes", () => {
    const certo = similarity("Aquecedor de Ambiente Eletrico 110V Portatil", "AQUECEDOR 110V");
    const errado = similarity("Aquecedor de Ambiente Eletrico 110V Portatil", "AQUECEDOR 220V");
    expect(errado).toBeLessThan(AUTO_ACCEPT_SCORE);
    expect(certo).toBeGreaterThan(errado + 0.2);
  });

  it("ignora acento e caixa", () => {
    expect(similarity("Ventilador Ind. Água", "VENTILADOR IND AGUA")).toBe(1);
  });

  it("nao inventa parentesco entre produtos distintos", () => {
    expect(similarity("Cafeteira Expresso 220V", "AQUECEDOR 110V")).toBeLessThan(0.5);
  });
});

describe("rankCandidates", () => {
  const produtos = [
    { id: "1", sheetName: "AQUECEDOR 110V" },
    { id: "2", sheetName: "AQUECEDOR 220V" },
    { id: "3", sheetName: "VENTILADOR 40CM" },
  ];

  it("ordena a voltagem certa na frente", () => {
    const ranked = rankCandidates("Aquecedor Eletrico 220V Cinza", produtos, (p) => p.sheetName);
    expect(ranked[0].item.id).toBe("2");
    expect(ranked[0].score).toBeGreaterThan(ranked[1]?.score ?? 0);
  });

  it("devolve vazio quando nada se parece", () => {
    expect(rankCandidates("Cadeira Gamer", produtos, (p) => p.sheetName)).toHaveLength(0);
  });
});

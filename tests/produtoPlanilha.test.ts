import { describe, expect, it } from "vitest";
import { nomeProdutoPlanilha } from "../lib/produtoPlanilha";

describe("nomeProdutoPlanilha", () => {
  it("monta TIPO + LINHA + COR + VOLTAGEM a partir da descrição", () => {
    expect(nomeProdutoPlanilha("", "Chaleira Basic Prateada 220V")).toBe("CHALEIRA BASIC PRATEADA 220V");
    expect(nomeProdutoPlanilha("", "Chaleira Modern Preta 127V")).toBe("CHALEIRA MODERN PRETA 127V");
    expect(nomeProdutoPlanilha("", "Chaleira Elegance Vermelha 110V")).toBe("CHALEIRA ELEGANCE VERMELHA 127V");
    expect(nomeProdutoPlanilha("", "Sanduicheira Elétrica 127V")).toBe("SANDUICHEIRA 127V");
    expect(nomeProdutoPlanilha("", "Grill Elétrico 220V")).toBe("GRILL ELETRICO 220V");
    expect(nomeProdutoPlanilha("", "Mini Processador 127V")).toBe("MINI PROCESSADOR 127V");
    expect(nomeProdutoPlanilha("", "Cafeteira Family 127V")).toBe("CAFETEIRA FAMILY 127V");
  });

  it("airfryer inclui a litragem entre o tipo e a voltagem", () => {
    expect(nomeProdutoPlanilha("", "Airfryer 6,5L 220V")).toBe("AIRFRYER 6,5L 220V");
  });

  it("110 e 127 caem no mesmo rotulo 127V; 220 fica 220V", () => {
    expect(nomeProdutoPlanilha("", "Chaleira Preta 110V")).toBe("CHALEIRA PRETA 127V");
    expect(nomeProdutoPlanilha("", "Chaleira Preta 127V")).toBe("CHALEIRA PRETA 127V");
    expect(nomeProdutoPlanilha("", "Chaleira Preta 220V")).toBe("CHALEIRA PRETA 220V");
  });

  it("descricao que comeca com Base prefixa BASE ao tipo detectado", () => {
    expect(nomeProdutoPlanilha("", "Base Chaleira Preta 110V")).toBe("BASE CHALEIRA PRETA 127V");
  });

  it("reconhecimento ignora acento e caixa", () => {
    expect(nomeProdutoPlanilha("", "CHALEIRA MÓDERN prateada 220v")).toBe("CHALEIRA MODERN PRATEADA 220V");
  });

  it("cai pra descricao em maiusculas quando nao reconhece nenhum tipo", () => {
    expect(nomeProdutoPlanilha("", "Produto Genérico XPTO")).toBe("PRODUTO GENÉRICO XPTO");
  });

  it("usa o mapa fixo (codigo Tiny) quando existe, sem rodar a heuristica", () => {
    // Sem entradas reais no mapa (data/produtos.json vazio de propósito) — só confirma que um
    // código desconhecido cai pra heurística em vez de travar.
    expect(nomeProdutoPlanilha("SKU-INEXISTENTE", "Chaleira Basic Preta 127V")).toBe("CHALEIRA BASIC PRETA 127V");
  });

  it("quando a descrição menciona as duas voltagens, usa a última (a variante real vendida), não a primeira", () => {
    // Caso real visto no Tiny: a descrição cita as duas genericamente e só no fim diz qual foi vendida.
    expect(nomeProdutoPlanilha("", "Sanduicheira Grill Quality Koti Preta 750w - 110v ou 220v - 110V")).toBe(
      "SANDUICHEIRA PRETA 127V",
    );
    expect(nomeProdutoPlanilha("", "Chaleira Modern Preta - 110v ou 220v - 220V")).toBe("CHALEIRA MODERN PRETA 220V");
  });
});

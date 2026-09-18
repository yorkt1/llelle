import { describe, expect, it } from "vitest";
import { parseCsv, sniffDelimiter } from "@/lib/domain/parser/csv";
import { decodeTextBuffer } from "@/lib/domain/parser/decode";
import { detectColumns, findHeaderRow } from "@/lib/domain/parser/columns";
import { parseSalesReport, remapReport, suggestReportDate } from "@/lib/domain/parser";

const TINY_HEADER =
  "Número;Data;Situação;Cliente;Código;Descrição;Quantidade;Nota Fiscal;Data da nota;Situação da nota";

const TINY_CSV = [
  "Relatório de vendas por produto",
  "Período: 08/09/2026 a 08/09/2026",
  TINY_HEADER,
  '1001;08/09/2026;Aprovado;João;SKU-1;"Aquecedor de Ambiente Elétrico 110V";2;5001;08/09/2026;Emitida',
  '1002;08/09/2026;Aprovado;Maria;SKU-2;"Ventilador Industrial 40cm";1;5002;08/09/2026;Emitida',
  '1003;08/09/2026;Cancelado;Ana;SKU-1;"Aquecedor de Ambiente Elétrico 110V";5;;;',
  '1004;08/09/2026;Aprovado;Rui;SKU-1;"Aquecedor de Ambiente Elétrico 110V";3;;;',
  "Total;;;;;;11;;;",
].join("\r\n");

describe("sniffDelimiter / parseCsv", () => {
  it("descobre o ponto-e-virgula usado por ERP brasileiro", () => {
    expect(sniffDelimiter(TINY_CSV)).toBe(";");
  });

  it("respeita aspas, aspas escapadas e quebra de linha dentro do campo", () => {
    const rows = parseCsv('a;"b;c";"linha1\nlinha2";"aspas ""dentro"""', ";");
    expect(rows).toEqual([["a", "b;c", "linha1\nlinha2", 'aspas "dentro"']]);
  });

  it("ignora linhas totalmente vazias", () => {
    expect(parseCsv("a;b\n\n\nc;d\n", ";")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("remove caracteres nulos que o Postgres nao aceita em jsonb", async () => {
    const csv = "Numero;Descricao;Quantidade\n1001;Produto\u0000 teste;2";
    const report = await parseSalesReport(Buffer.from(csv, "utf8"));

    expect(JSON.stringify(report)).not.toContain("\\u0000");
    expect(report.dataRows[0][1]).toBe("Produto teste");
  });
});

describe("decodeTextBuffer", () => {
  it("recupera acento de arquivo Windows-1252 sem BOM", () => {
    const { text, encoding } = decodeTextBuffer(Buffer.from("Situação;Número", "latin1"));
    expect(text).toBe("Situação;Número");
    expect(encoding).toBe("windows-1252");
  });

  it("le UTF-8 com BOM sem deixar o BOM no primeiro cabecalho", () => {
    const buffer = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("Número;Data", "utf8")]);
    expect(decodeTextBuffer(buffer).text).toBe("Número;Data");
  });
});

describe("detectColumns", () => {
  it("separa dados de pedido dos dados de nota fiscal", () => {
    const mapping = detectColumns(TINY_HEADER.split(";"));
    expect(mapping).toMatchObject({
      orderNumber: 0,
      orderDate: 1,
      orderStatus: 2,
      sku: 4,
      productName: 5,
      quantity: 6,
      invoiceNumber: 7,
      invoiceDate: 8,
      invoiceStatus: 9,
    });
  });

  it("acha o cabecalho abaixo das linhas de titulo do relatorio", () => {
    const rows = TINY_CSV.split("\r\n").map((line) => line.split(";"));
    expect(findHeaderRow(rows)).toBe(2);
  });
});

describe("parseSalesReport", () => {
  it("le o CSV do Tiny em latin1 e descarta o rodape de total", async () => {
    const report = await parseSalesReport(Buffer.from(TINY_CSV, "latin1"));

    expect(report.detectedFormat).toBe("csv");
    expect(report.lines).toHaveLength(4);
    expect(report.lines[0]).toMatchObject({
      rawProductName: "Aquecedor de Ambiente Elétrico 110V",
      quantity: 2,
      orderStatus: "Aprovado",
      orderDate: "2026-09-08",
      invoiceNumber: "5001",
      invoiceStatus: "Emitida",
    });
    // "Total" nao tem produto reconhecivel na coluna de descricao.
    expect(report.lines.some((line) => line.rawProductName === "")).toBe(false);
    expect(suggestReportDate(report)).toBe("2026-09-08");
  });

  it("permite corrigir a coluna na tela sem reenviar o arquivo", async () => {
    const report = await parseSalesReport(Buffer.from(TINY_CSV, "latin1"));
    const remapped = remapReport(report, { productName: 3 });
    expect(remapped.lines[0].rawProductName).toBe("João");
    expect(remapped.lines).toHaveLength(4);
  });
});

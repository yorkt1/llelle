import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

async function freshShopeeImportacao() {
  vi.resetModules();
  return import("../lib/shopeeImportacao");
}

describe("mapearMotivoParaOcorrencia", () => {
  it("reconhece as frases reais confirmadas do Shopee", async () => {
    const { mapearMotivoParaOcorrencia } = await freshShopeeImportacao();
    expect(mapearMotivoParaOcorrencia("Demais tipos de dano (quebrado, amassado, riscado, etc.)")).toBe("DANIFICADO");
    expect(mapearMotivoParaOcorrencia("Mudei de ideia")).toBe("ARREPENDIMENTO");
    expect(mapearMotivoParaOcorrencia("Mudou de Ideia")).toBe("ARREPENDIMENTO");
    expect(mapearMotivoParaOcorrencia("Recebi um produto com defeito funcional (não liga ou com mau funcionamento)")).toBe(
      "DEFEITO",
    );
  });

  it("ignora acento/caixa no reconhecimento", async () => {
    const { mapearMotivoParaOcorrencia } = await freshShopeeImportacao();
    expect(mapearMotivoParaOcorrencia("DEMAIS TIPOS DE DANO (quebrado, amassado)")).toBe("DANIFICADO");
  });

  it("devolve null pra motivo desconhecido ou vazio, nunca adivinha", async () => {
    const { mapearMotivoParaOcorrencia } = await freshShopeeImportacao();
    expect(mapearMotivoParaOcorrencia("Algum motivo nunca visto antes")).toBeNull();
    expect(mapearMotivoParaOcorrencia(undefined)).toBeNull();
    expect(mapearMotivoParaOcorrencia("")).toBeNull();
  });
});

describe("salvarImportacaoShopee / buscarImportacaoShopee", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("guarda e busca pelo idPedido, ignorando maiusculas/minusculas e espaços", async () => {
    const { salvarImportacaoShopee, buscarImportacaoShopee } = await freshShopeeImportacao();
    salvarImportacaoShopee({ idPedido: " 260909hhaer7fn ", motivoDevolucao: "Mudei de ideia" });

    const encontrado = buscarImportacaoShopee("260909HHAER7FN");
    expect(encontrado?.motivoDevolucao).toBe("Mudei de ideia");
    expect(encontrado?.idPedido).toBe("260909HHAER7FN");
  });

  it("devolve null pra pedido nunca importado", async () => {
    const { buscarImportacaoShopee } = await freshShopeeImportacao();
    expect(buscarImportacaoShopee("NAO-EXISTE")).toBeNull();
  });

  it("faz merge com o que já existia — uma raspagem nao apaga o que a outra ja tinha achado", async () => {
    const { salvarImportacaoShopee, buscarImportacaoShopee } = await freshShopeeImportacao();

    // Raspagem da lista: só motivo e valores.
    salvarImportacaoShopee({ idPedido: "260909HHAER7FN", motivoDevolucao: "Mudei de ideia", valorReembolso: 39.98 });
    // Raspagem do detalhe, depois: só data e descrição — não deveria apagar o motivo/valor já guardados.
    salvarImportacaoShopee({
      idPedido: "260909HHAER7FN",
      idDevolucaoShopee: "2609100M3X5919T",
      dataSolicitacao: "2026-09-10",
      descricaoCliente: "Não gostei mais do produto",
    });

    const encontrado = buscarImportacaoShopee("260909HHAER7FN");
    expect(encontrado).toMatchObject({
      idPedido: "260909HHAER7FN",
      motivoDevolucao: "Mudei de ideia",
      valorReembolso: 39.98,
      idDevolucaoShopee: "2609100M3X5919T",
      dataSolicitacao: "2026-09-10",
      descricaoCliente: "Não gostei mais do produto",
    });
  });

  it("expira depois do TTL", async () => {
    const { salvarImportacaoShopee, buscarImportacaoShopee } = await freshShopeeImportacao();
    salvarImportacaoShopee({ idPedido: "PEDIDO-X", motivoDevolucao: "Mudei de ideia" });

    expect(buscarImportacaoShopee("PEDIDO-X")).not.toBeNull();
    vi.advanceTimersByTime(8 * 24 * 60 * 60 * 1000); // 8 dias — passa do TTL de 7 dias
    expect(buscarImportacaoShopee("PEDIDO-X")).toBeNull();
  });
});

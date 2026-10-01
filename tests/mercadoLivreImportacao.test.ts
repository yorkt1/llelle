import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

async function freshMercadoLivreImportacao() {
  vi.resetModules();
  return import("../lib/mercadoLivreImportacao");
}

describe("mapearMotivoParaOcorrenciaML", () => {
  it("reconhece a frase real confirmada do Mercado Livre", async () => {
    const { mapearMotivoParaOcorrenciaML } = await freshMercadoLivreImportacao();
    expect(mapearMotivoParaOcorrenciaML("O comprador disse que não é da cor, tamanho ou modelo escolhido")).toBe("ERRO OPERACIONAL");
  });

  it("ignora acento/caixa no reconhecimento", async () => {
    const { mapearMotivoParaOcorrenciaML } = await freshMercadoLivreImportacao();
    expect(mapearMotivoParaOcorrenciaML("O COMPRADOR DISSE QUE NAO E DA COR, TAMANHO OU MODELO ESCOLHIDO")).toBe("ERRO OPERACIONAL");
  });

  it("devolve null pra motivo desconhecido ou vazio, nunca adivinha", async () => {
    const { mapearMotivoParaOcorrenciaML } = await freshMercadoLivreImportacao();
    expect(mapearMotivoParaOcorrenciaML("Algum motivo nunca visto antes")).toBeNull();
    expect(mapearMotivoParaOcorrenciaML(undefined)).toBeNull();
    expect(mapearMotivoParaOcorrenciaML("")).toBeNull();
  });
});

describe("salvarImportacaoMercadoLivre / buscarImportacaoMercadoLivre", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("guarda e busca pelo idPedido, ignorando maiusculas/minusculas e espaços", async () => {
    const { salvarImportacaoMercadoLivre, buscarImportacaoMercadoLivre } = await freshMercadoLivreImportacao();
    salvarImportacaoMercadoLivre({ idPedido: " 2000018413435016 ", motivoDevolucao: "Motivo qualquer" });

    const encontrado = buscarImportacaoMercadoLivre("2000018413435016");
    expect(encontrado?.motivoDevolucao).toBe("Motivo qualquer");
    expect(encontrado?.idPedido).toBe("2000018413435016");
  });

  it("devolve null pra pedido nunca importado", async () => {
    const { buscarImportacaoMercadoLivre } = await freshMercadoLivreImportacao();
    expect(buscarImportacaoMercadoLivre("NAO-EXISTE")).toBeNull();
  });

  it("faz merge com o que já existia — uma raspagem nao apaga o que a outra ja tinha achado", async () => {
    const { salvarImportacaoMercadoLivre, buscarImportacaoMercadoLivre } = await freshMercadoLivreImportacao();

    salvarImportacaoMercadoLivre({ idPedido: "2000018413435016", motivoDevolucao: "Motivo A" });
    salvarImportacaoMercadoLivre({ idPedido: "2000018413435016", cliente: "Patricia Kelley De Freitas", cpf: "36129007817" });

    const encontrado = buscarImportacaoMercadoLivre("2000018413435016");
    expect(encontrado).toMatchObject({
      idPedido: "2000018413435016",
      motivoDevolucao: "Motivo A",
      cliente: "Patricia Kelley De Freitas",
      cpf: "36129007817",
    });
  });

  it("expira depois do TTL", async () => {
    const { salvarImportacaoMercadoLivre, buscarImportacaoMercadoLivre } = await freshMercadoLivreImportacao();
    salvarImportacaoMercadoLivre({ idPedido: "PEDIDO-X", motivoDevolucao: "Motivo qualquer" });

    expect(buscarImportacaoMercadoLivre("PEDIDO-X")).not.toBeNull();
    vi.advanceTimersByTime(8 * 24 * 60 * 60 * 1000); // 8 dias — passa do TTL de 7 dias
    expect(buscarImportacaoMercadoLivre("PEDIDO-X")).toBeNull();
  });
});

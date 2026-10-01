import type { Ocorrencia } from "./shopeeImportacao";

/**
 * Guarda o que o Tampermonkey raspa da tela de detalhe de venda do Mercado Livre
 * (ver tampermonkey/devolucao-mercadolivre.user.js), casado pelo `idPedido` — o
 * número que aparece em "Venda #2000018413435016" na própria tela, que por
 * analogia ao Shopee deve ser o mesmo `numero_ecommerce` que o Tiny guarda pro
 * pedido (ainda não confirmado contra uma nota real do ML — se o cruzamento por
 * NF/pedido não achar nada pra uma venda do ML, é sinal de que esse número não
 * é o mesmo campo, e o fallback existente por "Nº do pedido" já cobre esse caso
 * sem precisar de nada específico aqui).
 *
 * Mesmo padrão de lib/shopeeImportacao.ts: em memória, expira em 7 dias, faz
 * merge em vez de sobrescrever.
 */

export type MercadoLivreImportacao = {
  idPedido: string;
  /** Texto exato de "Problema da venda" — motivo dado pelo comprador/ML pra devolução. */
  motivoDevolucao?: string;
  /** Nome do comprador, como aparece na tela (cruzamento informativo — o nome de verdade vem do Tiny). */
  cliente?: string;
  /** CPF do comprador, só dígitos (linha "USUARIO | CPF 00000000000" da tela). */
  cpf?: string;
  /** "Cor: X" da tela — informativo, pra conferir contra o PRODUTO do Tiny. */
  corML?: string;
  /** "SKU: X" da tela — informativo. */
  skuML?: string;
  /** ISO (yyyy-mm-dd) — data do evento "Entregamos o pacote" da linha do tempo (quando o produto devolvido chegou de volta). Ano inferido da data em que o script raspou a tela, já que a tela só mostra dia/mês. */
  dataRecebimento?: string;
  recebidoEm: string;
};

export type MercadoLivreImportacaoEntrada = Omit<MercadoLivreImportacao, "recebidoEm">;

const TTL_MS = 7 * 24 * 60 * 60 * 1000;

const importacoes = new Map<string, MercadoLivreImportacao>();

function normalizarChave(idPedido: string): string {
  return idPedido.trim().toUpperCase();
}

function semCamposVazios<T extends object>(objeto: T): Partial<T> {
  return Object.fromEntries(Object.entries(objeto).filter(([, valor]) => valor !== undefined && valor !== "")) as Partial<T>;
}

export function salvarImportacaoMercadoLivre(dados: MercadoLivreImportacaoEntrada): MercadoLivreImportacao {
  const chave = normalizarChave(dados.idPedido);
  const anterior = importacoes.get(chave);
  const registro: MercadoLivreImportacao = {
    ...anterior,
    ...semCamposVazios(dados),
    idPedido: chave,
    recebidoEm: new Date().toISOString(),
  };

  importacoes.set(chave, registro);
  setTimeout(() => {
    if (importacoes.get(chave) === registro) importacoes.delete(chave);
  }, TTL_MS);

  return registro;
}

export function buscarImportacaoMercadoLivre(idPedido: string): MercadoLivreImportacao | null {
  if (!idPedido) return null;
  return importacoes.get(normalizarChave(idPedido)) ?? null;
}

function normaliza(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Mapeia o "Problema da venda" do Mercado Livre pra uma das 6 ocorrências fixas
 * da planilha. Só reconhece frases REALMENTE vistas numa tela do ML (mesma
 * regra do mapeamento do Shopee em lib/shopeeImportacao.ts — nunca adivinha
 * sem evidência real):
 *
 * - "O comprador disse que não é da cor, tamanho ou modelo escolhido" → ERRO
 *   OPERACIONAL (equivalente ao "Recebi um produto errado" do Shopee).
 *
 * Qualquer outra frase devolve null — o atendente escolhe a ocorrência na mão.
 */
export function mapearMotivoParaOcorrenciaML(motivoBruto: string | undefined): Ocorrencia | null {
  if (!motivoBruto) return null;
  const motivo = normaliza(motivoBruto);
  if (!motivo) return null;

  if (motivo.includes("nao e da cor") || motivo.includes("tamanho ou modelo escolhido")) return "ERRO OPERACIONAL";
  return null;
}

/**
 * Guarda o que o Tampermonkey raspa da tela do Shopee (ver tampermonkey/devolucao-shopee.user.js),
 * casado pelo `idPedido` (numero_ecommerce — o mesmo "ID do Pedido" que aparece no Shopee e que o
 * Tiny devolve em pedido.obter.php / nota_fiscal.numero_ecommerce).
 *
 * Duas raspagens diferentes podem preencher pedaços diferentes do mesmo pedido, em momentos
 * diferentes: a lista de solicitações (rápida, muitos pedidos de uma vez, mas sem a data exata do
 * pedido nem a descrição do cliente) e a tela de detalhe de uma solicitação (mais completa, mas
 * teria que abrir uma por uma). `salvarImportacaoShopee` faz merge em vez de sobrescrever, pra uma
 * raspagem não apagar o que a outra já tinha achado.
 *
 * Em memória de propósito (não sobrevive a um redeploy) — é só uma ponte temporária até o
 * atendente abrir a devolução no sistema e a Tiny+Shopee se juntarem numa prévia só.
 */

export type ShopeeImportacao = {
  idPedido: string;
  /** "ID da Solicitação" do Shopee — identifica o caso de devolução em si, não o pedido de venda. */
  idDevolucaoShopee?: string;
  /** Data em que o comprador solicitou a devolução, formato ISO (yyyy-mm-dd). */
  dataSolicitacao?: string;
  /** Texto exato do "Motivo de Devolução"/"Motivo da devolução" mostrado pelo Shopee. */
  motivoDevolucao?: string;
  /** Texto livre que o comprador escreveu descrevendo o problema (campo "Descrição" do Shopee). */
  descricaoCliente?: string;
  /** "Reembolso ao comprador" — dinheiro que sai pro cliente. */
  valorReembolso?: number;
  /** "Compensação ao vendedor" — dinheiro que entra pra você (Programa de Devolução Fácil etc.). Ainda não mapeado pra nenhuma coluna da planilha, só informativo. */
  valorCompensacao?: number;
  recebidoEm: string;
};

export type ShopeeImportacaoEntrada = Omit<ShopeeImportacao, "recebidoEm">;

// 7 dias: a raspagem da lista pode acontecer bem antes do SAC efetivamente abrir aquele caso no sistema.
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

const importacoes = new Map<string, ShopeeImportacao>();

function normalizarChave(idPedido: string): string {
  return idPedido.trim().toUpperCase();
}

function semCamposVazios<T extends object>(objeto: T): Partial<T> {
  return Object.fromEntries(Object.entries(objeto).filter(([, valor]) => valor !== undefined && valor !== "")) as Partial<T>;
}

export function salvarImportacaoShopee(dados: ShopeeImportacaoEntrada): ShopeeImportacao {
  const chave = normalizarChave(dados.idPedido);
  const anterior = importacoes.get(chave);
  const registro: ShopeeImportacao = {
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

export function buscarImportacaoShopee(idPedido: string): ShopeeImportacao | null {
  if (!idPedido) return null;
  return importacoes.get(normalizarChave(idPedido)) ?? null;
}

export const OCORRENCIAS = ["DANIFICADO", "ARREPENDIMENTO", "ERRO OPERACIONAL", "CANCELAMENTO", "DEFEITO"] as const;
export type Ocorrencia = (typeof OCORRENCIAS)[number];

function normaliza(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Mapeia o "Motivo de Devolução" do Shopee pra uma das 5 ocorrências fixas da planilha.
 * Baseado em frases REAIS vistas na tela do Shopee (não é uma lista oficial completa deles):
 *
 * - "Demais tipos de dano (quebrado, amassado, riscado, etc.)" → DANIFICADO (frase idêntica à
 *   observação já cadastrada pra essa ocorrência)
 * - "Mudei de ideia" → ARREPENDIMENTO
 * - "Recebi um produto com defeito funcional (...)" → DEFEITO
 *
 * ERRO OPERACIONAL e CANCELAMENTO ainda não têm frase confirmada do Shopee — por enquanto sempre
 * devolvem null (deixa o atendente escolher na mão) até aparecer um exemplo real. Nunca adivinha
 * sem evidência — mesma lição do bug de voltagem em lib/produtoPlanilha.ts.
 */
export function mapearMotivoParaOcorrencia(motivoBruto: string | undefined): Ocorrencia | null {
  if (!motivoBruto) return null;
  const motivo = normaliza(motivoBruto);
  if (!motivo) return null;

  if (motivo.startsWith("demais tipos de dano")) return "DANIFICADO";
  if (motivo.startsWith("mudei de ideia") || motivo.startsWith("mudou de ideia")) return "ARREPENDIMENTO";
  if (motivo.startsWith("recebi um produto com defeito funcional")) return "DEFEITO";
  return null;
}

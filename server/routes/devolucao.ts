import { Router } from "express";
import { OlistConfigError } from "../../lib/olist";
import { buscarDevolucaoPorNf, NfNaoEncontradaError, TinyLimiteTaxaError } from "../../lib/devolucao";
import { salvarImportacaoShopee, type ShopeeImportacaoEntrada } from "../../lib/shopeeImportacao";

export const devolucaoRouter = Router();

// Responde com { erro } (não { error }, diferente do resto da API) por pedido explícito
// de quem vai consumir isso — mantido consistente dentro desta rota inteira.
devolucaoRouter.get("/nf/:numero", async (req, res) => {
  try {
    const preview = await buscarDevolucaoPorNf(String(req.params.numero));
    res.status(200).json(preview);
  } catch (error) {
    if (error instanceof NfNaoEncontradaError) {
      res.status(404).json({ erro: "NF não encontrada" });
      return;
    }
    if (error instanceof TinyLimiteTaxaError) {
      res.status(429).json({ erro: error.message });
      return;
    }
    if (error instanceof OlistConfigError) {
      res.status(503).json({ erro: error.message });
      return;
    }
    const mensagem = error instanceof Error ? error.message : "Erro inesperado ao buscar a nota fiscal.";
    res.status(500).json({ erro: mensagem });
  }
});

function paraTexto(valor: unknown): string | undefined {
  return typeof valor === "string" && valor.trim() !== "" ? valor.trim() : undefined;
}

function paraNumero(valor: unknown): number | undefined {
  const numero = typeof valor === "number" ? valor : typeof valor === "string" ? Number(valor.replace(",", ".")) : NaN;
  return Number.isFinite(numero) ? numero : undefined;
}

/** null quando o registro não tem nem `idPedido` — não dá pra guardar nada sem saber a que pedido pertence. */
function paraEntradaShopee(bruto: unknown): ShopeeImportacaoEntrada | null {
  if (!bruto || typeof bruto !== "object") return null;
  const body = bruto as Record<string, unknown>;
  const idPedido = paraTexto(body.idPedido);
  if (!idPedido) return null;

  return {
    idPedido,
    idDevolucaoShopee: paraTexto(body.idDevolucaoShopee),
    dataSolicitacao: paraTexto(body.dataSolicitacao),
    motivoDevolucao: paraTexto(body.motivoDevolucao),
    descricaoCliente: paraTexto(body.descricaoCliente),
    valorReembolso: paraNumero(body.valorReembolso),
    valorCompensacao: paraNumero(body.valorCompensacao),
  };
}

/**
 * Recebe o que o Tampermonkey raspa da tela do Shopee (ver tampermonkey/devolucao-shopee.user.js)
 * — um registro só (tela de detalhe de uma devolução) ou uma lista (tela de lista de solicitações).
 * Protegida por um token separado do OLIST_API_TOKEN (SHOPEE_IMPORT_TOKEN), porque essa rota não
 * fala com o Tiny — é só uma porta de entrada pra dado de fora, e sem isso qualquer um que
 * descobrisse a URL poderia mandar dado falso pro sistema.
 */
devolucaoRouter.post("/shopee", (req, res) => {
  const tokenConfigurado = process.env.SHOPEE_IMPORT_TOKEN;
  if (!tokenConfigurado) {
    res.status(503).json({ erro: "SHOPEE_IMPORT_TOKEN não configurado no servidor." });
    return;
  }
  if (req.get("x-import-token") !== tokenConfigurado) {
    res.status(401).json({ erro: "Token inválido." });
    return;
  }

  const bruto = Array.isArray(req.body) ? req.body : [req.body];
  const entradas = bruto.map(paraEntradaShopee);
  const validas = entradas.filter((entrada): entrada is ShopeeImportacaoEntrada => entrada != null);

  if (validas.length === 0) {
    res.status(400).json({ erro: "Nenhum registro válido — cada um precisa de pelo menos idPedido." });
    return;
  }

  const salvos = validas.map((entrada) => salvarImportacaoShopee(entrada).idPedido);
  res.status(201).json({ ok: true, salvos: salvos.length, ignorados: entradas.length - validas.length, idPedidos: salvos });
});

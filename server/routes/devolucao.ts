import { Router } from "express";
import { OlistConfigError } from "../../lib/olist";
import { buscarDevolucaoPorNf, NfNaoEncontradaError, TinyLimiteTaxaError } from "../../lib/devolucao";

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

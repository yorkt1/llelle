import { Router } from "express";
import { listarDiasPedidos, obterDiaPedidos, salvarDiaPedidos, type DiaPedidos } from "../../lib/controlePedidos";
import { StoreConfigError } from "../../lib/store";

export const pedidosRouter = Router();

pedidosRouter.get("/historico", async (req, res) => {
  const limite = Number(req.query.limite ?? 14);
  if (!Number.isInteger(limite) || limite < 1 || limite > 60) {
    res.status(400).json({ error: "O limite do histórico deve ser de 1 a 60 dias." });
    return;
  }
  try {
    res.status(200).json({ dias: await listarDiasPedidos(limite) });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Não consegui carregar o histórico de pedidos." });
  }
});

pedidosRouter.get("/:data", async (req, res) => {
  try {
    const dia = await obterDiaPedidos(String(req.params.data));
    res.status(200).json({ dia });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Não consegui carregar os pedidos desse dia." });
  }
});

pedidosRouter.put("/:data", async (req, res) => {
  try {
    const dia = await salvarDiaPedidos(String(req.params.data), req.body as Partial<DiaPedidos>);
    res.status(200).json({ dia });
  } catch (error) {
    if (error instanceof StoreConfigError) {
      res.status(503).json({ error: error.message });
      return;
    }
    res.status(400).json({ error: error instanceof Error ? error.message : "Não consegui salvar os pedidos." });
  }
});

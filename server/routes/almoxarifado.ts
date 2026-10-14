import { Router } from "express";
import {
  atualizarItemAlmox,
  criarItemAlmox,
  obterAlmoxarifado,
  registrarMovimentacaoAlmox,
  removerItemAlmox,
  restaurarAlmoxarifado,
} from "../../lib/almoxarifado";
import { StoreConfigError } from "../../lib/store";

export const almoxarifadoRouter = Router();

function responderErro(res: import("express").Response, error: unknown): void {
  const status = error instanceof StoreConfigError ? 503 : 400;
  res.status(status).json({ error: error instanceof Error ? error.message : "Erro inesperado no almoxarifado." });
}

almoxarifadoRouter.get("/", async (_req, res) => {
  try {
    res.status(200).json({ estado: await obterAlmoxarifado() });
  } catch (error) {
    responderErro(res, error);
  }
});

almoxarifadoRouter.post("/itens", async (req, res) => {
  try {
    const estado = await criarItemAlmox({
      categoriaId: String(req.body?.categoriaId ?? ""),
      nome: String(req.body?.nome ?? ""),
      saldo: req.body?.saldo,
      minimo: req.body?.minimo,
      unidade: typeof req.body?.unidade === "string" ? req.body.unidade : undefined,
      passo: req.body?.passo,
    });
    res.status(201).json({ estado });
  } catch (error) {
    responderErro(res, error);
  }
});

almoxarifadoRouter.put("/itens/:id", async (req, res) => {
  try {
    const estado = await atualizarItemAlmox(String(req.params.id), req.body ?? {});
    res.status(200).json({ estado });
  } catch (error) {
    responderErro(res, error);
  }
});

almoxarifadoRouter.delete("/itens/:id", async (req, res) => {
  try {
    const estado = await removerItemAlmox(String(req.params.id));
    res.status(200).json({ estado });
  } catch (error) {
    responderErro(res, error);
  }
});

almoxarifadoRouter.post("/movimentacoes", async (req, res) => {
  try {
    const estado = await registrarMovimentacaoAlmox({
      itemId: String(req.body?.itemId ?? ""),
      tipo: req.body?.tipo,
      quantidade: req.body?.quantidade,
      observacao: typeof req.body?.observacao === "string" ? req.body.observacao : "",
    });
    res.status(200).json({ estado });
  } catch (error) {
    responderErro(res, error);
  }
});

almoxarifadoRouter.post("/restaurar", async (_req, res) => {
  try {
    res.status(200).json({ estado: await restaurarAlmoxarifado() });
  } catch (error) {
    responderErro(res, error);
  }
});
import { Router } from "express";
import { OlistConfigError } from "../../lib/olist";
import { listarColaboradores, obterDesempenho, removerColaborador, salvarColaborador } from "../../lib/embalagem";

export const embalagemRouter = Router();

// ?dia=dd/mm/yyyy — sem isso, usa hoje (fuso de São Paulo, ver lib/olist.ts).
embalagemRouter.get("/", async (req, res) => {
  try {
    const dia = typeof req.query.dia === "string" ? req.query.dia : undefined;
    const desempenho = await obterDesempenho(dia);
    res.status(200).json(desempenho);
  } catch (error) {
    if (error instanceof OlistConfigError) {
      res.status(503).json({ erro: error.message });
      return;
    }
    const mensagem = error instanceof Error ? error.message : "Erro inesperado ao calcular o desempenho de embalagem.";
    res.status(500).json({ erro: mensagem });
  }
});

embalagemRouter.get("/colaboradores", async (_req, res) => {
  try {
    const colaboradores = await listarColaboradores();
    res.status(200).json({ colaboradores });
  } catch (error) {
    res.status(500).json({ erro: error instanceof Error ? error.message : "Erro inesperado ao listar colaboradores." });
  }
});

embalagemRouter.post("/colaboradores", async (req, res) => {
  const idUsuarioEmbalador = String(req.body?.idUsuarioEmbalador ?? "");
  const nome = String(req.body?.nome ?? "");
  const bancada = req.body?.bancada ? String(req.body.bancada) : undefined;
  try {
    const colaborador = await salvarColaborador(idUsuarioEmbalador, nome, bancada);
    res.status(201).json({ colaborador });
  } catch (error) {
    res.status(400).json({ erro: error instanceof Error ? error.message : "Erro inesperado ao salvar o colaborador." });
  }
});

embalagemRouter.delete("/colaboradores/:idUsuarioEmbalador", async (req, res) => {
  try {
    await removerColaborador(String(req.params.idUsuarioEmbalador));
    res.status(204).end();
  } catch (error) {
    res.status(500).json({ erro: error instanceof Error ? error.message : "Erro inesperado ao remover o colaborador." });
  }
});

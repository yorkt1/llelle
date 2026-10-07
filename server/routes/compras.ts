import { Router } from "express";
import { handle, fail, ok } from "../http";
import { montarPlanejamento, salvarConfigProduto, salvarParametros } from "../../lib/compras";

export const comprasRouter = Router();

// Só lê o que a coleta de fundo (tickVendas, agendada em server/index.ts) já guardou — nunca chama
// o Tiny dentro da requisição, mesma regra da Embalagem (ver aviso em lib/embalagem.ts).
comprasRouter.get(
  "/planejamento",
  handle(async (_req, res) => {
    ok(res, await montarPlanejamento());
  }),
);

comprasRouter.put(
  "/parametros",
  handle(async (req, res) => {
    ok(res, { parametros: await salvarParametros(req.body ?? {}) });
  }),
);

comprasRouter.put(
  "/produto",
  handle(async (req, res) => {
    const chave = typeof req.body?.chave === "string" ? req.body.chave : "";
    if (!chave) {
      fail(res, "Informe o produto.", 400);
      return;
    }
    ok(res, { config: await salvarConfigProduto(chave, req.body ?? {}) });
  }),
);

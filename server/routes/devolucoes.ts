import { Router } from "express";
import { handle, fail, ok } from "../http";
import { buscarPedidoPorCodigo, listarDevolucoes, salvarDevolucao } from "../../lib/devolucoes";

export const devolucoesRouter = Router();

/** Busca ao vivo no Tiny — não salva nada, só traz os dados pro atendente conferir antes de registrar. */
devolucoesRouter.get(
  "/buscar",
  handle(async (req, res) => {
    const codigo = String(req.query.codigo ?? "").trim();
    if (!codigo) {
      fail(res, "Informe o código do pedido ou da nota.", 400);
      return;
    }
    ok(res, await buscarPedidoPorCodigo(codigo));
  }),
);

devolucoesRouter.get(
  "/",
  handle(async (_req, res) => {
    ok(res, await listarDevolucoes());
  }),
);

const CAMPOS_OBRIGATORIOS = [
  "codigo",
  "numeroPedido",
  "clienteNome",
  "clienteDocumento",
  "produtoCodigo",
  "produtoDescricao",
  "defeito",
] as const;

devolucoesRouter.post(
  "/",
  handle(async (req, res) => {
    const body = req.body as Record<string, unknown>;
    for (const campo of CAMPOS_OBRIGATORIOS) {
      if (typeof body[campo] !== "string" || (body[campo] as string).trim() === "") {
        fail(res, `Campo obrigatório ausente: ${campo}.`, 400);
        return;
      }
    }

    const registro = await salvarDevolucao({
      codigo: (body.codigo as string).trim(),
      numeroPedido: (body.numeroPedido as string).trim(),
      numeroNotaFiscal: typeof body.numeroNotaFiscal === "string" && body.numeroNotaFiscal.trim() !== "" ? body.numeroNotaFiscal.trim() : null,
      clienteNome: (body.clienteNome as string).trim(),
      clienteDocumento: (body.clienteDocumento as string).trim(),
      produtoCodigo: (body.produtoCodigo as string).trim(),
      produtoDescricao: (body.produtoDescricao as string).trim(),
      defeito: (body.defeito as string).trim(),
    });
    ok(res, registro, 201);
  }),
);

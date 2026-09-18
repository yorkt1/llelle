import { Router } from "express";
import { z } from "zod";
import { handle, fail, ok } from "../http";
import { computeSchema } from "../../src/lib/schemas";
import { commitColumn } from "../../src/lib/service/columns";
import { getRepository } from "../../src/lib/storage";

export const snapshotsRouter = Router();

const commitSchema = computeSchema.extend({
  note: z.string().max(500).nullish(),
  acknowledgePending: z.boolean().optional(),
});

snapshotsRouter.get(
  "/",
  handle(async (_req, res) => {
    ok(res, { snapshots: await getRepository().listSnapshots(60) });
  }),
);

/** Fecha a coluna do dia e grava o saldo resultante. */
snapshotsRouter.post(
  "/",
  handle(async (req, res) => {
    const result = await commitColumn(commitSchema.parse(req.body));
    if (!result.ok) {
      fail(
        res,
        "Ha " + result.unresolved + " produto(s) do relatorio sem destino definido na planilha.",
        409,
        {
          pending: result.output.preview.pending,
          unknown: result.output.preview.unknown.filter((item) => !item.acknowledged),
        },
      );
      return;
    }
    ok(res, { snapshot: result.snapshot, rows: result.rows });
  }),
);

/** Desfaz uma coluna fechada por engano: o saldo anterior volta a ser o da coluna prévia. */
snapshotsRouter.delete(
  "/:id",
  handle(async (req, res) => {
    const id = String(req.params.id);
    await getRepository().deleteSnapshot(id);
    ok(res, { deleted: id });
  }),
);

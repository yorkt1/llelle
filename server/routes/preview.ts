import { Router } from "express";
import { handle, ok } from "../http";
import { computeSchema } from "../../src/lib/schemas";
import { computeColumn, persistManualDecisions } from "../../src/lib/service/columns";

export const previewRouter = Router();

/** Recalcula a coluna a cada troca de modo, data ou mapeamento — sem reenviar o arquivo. */
previewRouter.post(
  "/",
  handle(async (req, res) => {
    const input = computeSchema.parse(req.body);
    const output = await computeColumn(input);
    await persistManualDecisions(output.learned);
    ok(res, output);
  }),
);

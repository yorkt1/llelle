import { Router } from "express";
import { z } from "zod";
import { handle, ok } from "../http";
import { OUT_OF_SHEET } from "../../src/lib/domain/matching";
import { getRepository } from "../../src/lib/storage";

export const mappingsRouter = Router();

const saveSchema = z.object({
  entries: z
    .array(
      z.object({
        reportName: z.string().min(1),
        /** id do produto, ou OUT_OF_SHEET para marcar como fora da planilha. */
        productId: z.string().min(1),
      }),
    )
    .min(1),
});

const deleteSchema = z.object({ id: z.string().min(1) });

/** Tabela de mapeamento nome do relatorio -> linha da planilha, com o produto resolvido. */
mappingsRouter.get(
  "/",
  handle(async (_req, res) => {
    const repo = getRepository();
    const [aliases, products] = await Promise.all([repo.listAliases(), repo.listProducts()]);
    const byId = new Map(products.map((p) => [p.id, p]));
    ok(res, {
      mappings: aliases
        .map((alias) => ({
          ...alias,
          sheetName: alias.productId ? (byId.get(alias.productId)?.sheetName ?? null) : null,
          outOfSheet: alias.productId === null,
        }))
        .sort((a, b) => a.reportName.localeCompare(b.reportName)),
      products,
    });
  }),
);

mappingsRouter.post(
  "/",
  handle(async (req, res) => {
    const { entries } = saveSchema.parse(req.body);
    await getRepository().saveAliases(
      entries.map((entry) => ({
        reportName: entry.reportName,
        productId: entry.productId === OUT_OF_SHEET ? null : entry.productId,
        source: "manual" as const,
      })),
    );
    ok(res, { saved: entries.length });
  }),
);

mappingsRouter.delete(
  "/",
  handle(async (req, res) => {
    const { id } = deleteSchema.parse(req.body);
    await getRepository().deleteAlias(id);
    ok(res, { deleted: id });
  }),
);

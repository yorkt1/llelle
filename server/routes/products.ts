import { Router } from "express";
import { z } from "zod";
import { handle, fail, ok } from "../http";
import { isoDate } from "../../src/lib/schemas";
import { parseProductPaste } from "../../src/lib/domain/seed";
import { getRepository } from "../../src/lib/storage";

export const productsRouter = Router();

const importSchema = z.object({
  paste: z.string().min(1, "cole ao menos uma linha"),
  seedDate: isoDate,
  /** true = esta lista passa a ser a planilha; produtos ausentes ficam inativos. */
  replace: z.boolean().default(true),
});

const patchSchema = z.object({
  id: z.string().min(1),
  sheetName: z.string().min(1).optional(),
  sku: z.string().nullish(),
  active: z.boolean().optional(),
  rowOrder: z.number().int().min(1).optional(),
});

productsRouter.get(
  "/",
  handle(async (_req, res) => {
    const repo = getRepository();
    const [products, latest] = await Promise.all([repo.listProducts(), repo.latestBalances()]);
    ok(res, {
      products: products.map((product) => ({ ...product, balance: latest.balances[product.id] ?? 0 })),
      snapshot: latest.snapshot,
    });
  }),
);

/** Carga inicial: nomes e saldos colados da ultima coluna preenchida da planilha. */
productsRouter.post(
  "/",
  handle(async (req, res) => {
    const input = importSchema.parse(req.body);
    const { seeds, warnings } = parseProductPaste(input.paste);
    if (seeds.length === 0) return fail(res, "Nao encontrei nenhum produto no texto colado.");

    const products = await getRepository().importProducts(seeds, input.seedDate, input.replace);
    ok(res, { imported: products.length, warnings, products });
  }),
);

productsRouter.patch(
  "/",
  handle(async (req, res) => {
    const { id, ...patch } = patchSchema.parse(req.body);
    await getRepository().updateProduct(id, patch);
    ok(res, { updated: id });
  }),
);

import { Router } from "express";
import { handle, ok } from "../http";
import { getRepository, storageDriver } from "../../src/lib/storage";

export const statusRouter = Router();

/** Diagnostico da tela inicial: onde os dados estao e se ja existe saldo de partida. */
statusRouter.get(
  "/",
  handle(async (_req, res) => {
    const repo = getRepository();
    const [products, aliases, snapshots] = await Promise.all([
      repo.listProducts(),
      repo.listAliases(),
      repo.listSnapshots(1),
    ]);
    ok(res, {
      driver: storageDriver(),
      productCount: products.filter((product) => product.active).length,
      aliasCount: aliases.length,
      lastSnapshot: snapshots[0] ?? null,
    });
  }),
);

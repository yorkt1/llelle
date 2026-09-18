import { Router } from "express";
import { handle, ok } from "../http";
import { fetchSeparacaoCountsLive, getCachedCounts, isConfigured } from "../../lib/olist";

export const separacaoRouter = Router();

/** Serve o último snapshot cacheado — nunca chama o Olist direto, então responde na hora. */
separacaoRouter.get(
  "/",
  handle(async (_req, res) => {
    const snapshot = await getCachedCounts();
    ok(res, {
      connected: isConfigured(),
      counts: snapshot?.counts ?? null,
      syncedAt: snapshot?.syncedAt ?? null,
    });
  }),
);

/** Botão "Atualizar números" do frontend: força uma sincronização fora do ciclo de 5min. */
separacaoRouter.post(
  "/sync",
  handle(async (_req, res) => {
    const snapshot = await fetchSeparacaoCountsLive();
    ok(res, { connected: true, counts: snapshot.counts, syncedAt: snapshot.syncedAt });
  }),
);

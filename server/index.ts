import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import cors from "cors";
import express from "express";
import { separacaoRouter } from "./routes/separacao";
import { fetchSeparacaoCountsLive, isConfigured, OlistConfigError } from "../lib/olist";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

config({ path: path.resolve(__dirname, "../.env.local") });
config({ path: path.resolve(__dirname, "../.env") });

const app = express();
app.use(express.json());

// Só precisa disso quando o front roda num domínio separado do backend (ex:
// front na Vercel, API no Render) — mesma origem (front servido pelo próprio
// Express) não usa nem precisa. CORS_ORIGIN aceita uma URL ou várias separadas
// por vírgula (ex: preview + produção da Vercel).
const corsOrigin = process.env.CORS_ORIGIN;
if (corsOrigin) {
  app.use(cors({ origin: corsOrigin.split(",").map((origin) => origin.trim()) }));
}

app.use("/api/separacao", separacaoRouter);

// Quando existe um build do Vite (dist/), o backend tambem serve o front — assim "npm start" sobe tudo.
const staticDir = path.resolve(__dirname, "../dist");
if (fs.existsSync(staticDir)) {
  app.use(express.static(staticDir));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(staticDir, "index.html")));
}

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => {
  console.log(`API rodando em http://localhost:${port}`);
});

// Substitui o Vercel Cron: como este processo fica sempre no ar (Render, PC do
// escritório etc.), ele mesmo agenda a sincronização — não precisa de nada externo.
// Padrão de 30s (igual ao polling do frontend) pra ficar o mais "ao vivo"
// possível sem depender de botão manual — CUIDADO ao baixar mais que isso: a
// API do Tiny tem limite de taxa.
const SYNC_INTERVAL_MS = Number(process.env.OLIST_SYNC_INTERVAL_MS ?? 30_000);

let syncing = false;

async function syncOnce(): Promise<void> {
  if (!isConfigured() || syncing) return;
  syncing = true;
  try {
    const snapshot = await fetchSeparacaoCountsLive();
    console.log(`[olist] sincronizado às ${snapshot.syncedAt}`, snapshot.counts);
  } catch (error) {
    if (error instanceof OlistConfigError) {
      console.error(`[olist] ${error.message}`);
      return;
    }
    console.error("[olist] falha na sincronização:", error);
  } finally {
    syncing = false;
  }
}

void syncOnce();
setInterval(() => void syncOnce(), SYNC_INTERVAL_MS);

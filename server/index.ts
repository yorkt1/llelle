import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import cors from "cors";
import express from "express";
import { separacaoRouter } from "./routes/separacao";
import { devolucoesRouter } from "./routes/devolucoes";
import { fetchCoreCountsLive, fetchEmbaladasCountLive, isConfigured, OlistConfigError } from "../lib/olist";

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
app.use("/api/devolucoes", devolucoesRouter);

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
//
// Embaladas sincroniza numa frequência própria, bem mais baixa: diferente das
// outras 3 etapas, o fluxo depois de "Separadas" só tem um caminho (vira
// "Embaladas"), então não precisa ser tão ao vivo — e cada sync dela custa
// várias páginas (proporcional à janela de dias). Rodar as duas juntas a cada
// 30s foi o que estourou o rate limit do Tiny na prática (ver comentário em
// lib/olist.ts). Padrão de 10min pra Embaladas, 30s pro resto.
const CORE_SYNC_INTERVAL_MS = Number(process.env.OLIST_SYNC_INTERVAL_MS ?? 30_000);
const EMBALADAS_SYNC_INTERVAL_MS = Number(process.env.OLIST_EMBALADAS_SYNC_INTERVAL_MS ?? 10 * 60_000);

let syncingCore = false;

async function syncCoreOnce(): Promise<void> {
  if (!isConfigured() || syncingCore) return;
  syncingCore = true;
  try {
    const snapshot = await fetchCoreCountsLive();
    console.log(`[olist] core sincronizado às ${snapshot.syncedAt}`, {
      aguardandoSeparacao: snapshot.counts.aguardandoSeparacao,
      emSeparacao: snapshot.counts.emSeparacao,
      separadas: snapshot.counts.separadas,
    });
  } catch (error) {
    if (error instanceof OlistConfigError) {
      console.error(`[olist] ${error.message}`);
      return;
    }
    console.error("[olist] falha na sincronização core:", error);
  } finally {
    syncingCore = false;
  }
}

let syncingEmbaladas = false;

async function syncEmbaladasOnce(): Promise<void> {
  if (!isConfigured() || syncingEmbaladas) return;
  syncingEmbaladas = true;
  try {
    const snapshot = await fetchEmbaladasCountLive();
    console.log(`[olist] embaladas sincronizado às ${snapshot.syncedAt}`, { embaladas: snapshot.counts.embaladas });
  } catch (error) {
    if (error instanceof OlistConfigError) {
      console.error(`[olist] ${error.message}`);
      return;
    }
    console.error("[olist] falha na sincronização de embaladas:", error);
  } finally {
    syncingEmbaladas = false;
  }
}

void syncCoreOnce();
void syncEmbaladasOnce();
setInterval(() => void syncCoreOnce(), CORE_SYNC_INTERVAL_MS);
setInterval(() => void syncEmbaladasOnce(), EMBALADAS_SYNC_INTERVAL_MS);

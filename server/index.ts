import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import cors from "cors";
import express from "express";
import { separacaoRouter } from "./routes/separacao";
import { relatoriosRouter } from "./routes/relatorios";
import { devolucaoRouter } from "./routes/devolucao";
import { estoqueRouter } from "./routes/estoque";
import { embalagemRouter } from "./routes/embalagem";
import { comprasRouter } from "./routes/compras";
import { tickVendas } from "../lib/vendasSync";
import { tickFotosProdutos } from "../lib/fotosProdutos";
import { fetchCoreCountsLive, fetchEmbaladasCountLive, isConfigured, OlistConfigError } from "../lib/olist";
import { sincronizarEmbalagemHoje, verificarDiaPassado } from "../lib/embalagem";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

config({ path: path.resolve(__dirname, "../.env.local") });
config({ path: path.resolve(__dirname, "../.env") });

const app = express();
// Padrão do express.json() é 100kb — pequeno demais pra uma foto em base64 (rota de OCR de
// devolução, POST /api/devolucao/ler-numero-serie, e pras fotos de contagem de estoque).
app.use(express.json({ limit: "10mb" }));

// Só precisa disso quando o front roda num domínio separado do backend (ex:
// front na Vercel, API no Render) — mesma origem (front servido pelo próprio
// Express) não usa nem precisa. CORS_ORIGIN aceita uma URL ou várias separadas
// por vírgula (ex: produção da Vercel).
//
// Além disso libera automaticamente qualquer deploy de PREVIEW da Vercel deste
// projeto (ex.: llelle-ceaakvkta-guilhermes-projects-9aabc385.vercel.app) — a
// Vercel gera uma URL nova a cada deploy de preview, então colocar isso fixo
// em CORS_ORIGIN significaria atualizar a variável de ambiente no Render toda
// vez (já aconteceu: um teste numa URL de preview deu erro de CORS bloqueado).
const origensFixas = (process.env.CORS_ORIGIN ?? "")
  .split(",")
  .map((origem) => origem.trim())
  .filter(Boolean);
const PADRAO_PREVIEW_VERCEL = /^https:\/\/llelle-[a-z0-9-]+\.vercel\.app$/i;

app.use(
  cors({
    origin(origin, callback) {
      // Sem Origin = não é uma chamada de navegador (curl, chamada server-to-server) — CORS não
      // se aplica, sempre libera.
      if (!origin) return callback(null, true);
      callback(null, origensFixas.includes(origin) || PADRAO_PREVIEW_VERCEL.test(origin));
    },
  }),
);

app.use("/api/separacao", separacaoRouter);
app.use("/api/relatorios", relatoriosRouter);
app.use("/api/devolucao", devolucaoRouter);
app.use("/api/estoque", estoqueRouter);
app.use("/api/embalagem", embalagemRouter);
app.use("/api/compras", comprasRouter);

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
// Mesma ideia de Embaladas: fica fora do ciclo de 30s de propósito, e cada tick já se limita a um
// teto pequeno de separações novas (ver MAX_RESOLUCOES_POR_CHAMADA em lib/embalagem.ts) — então
// não precisa ser tão frequente quanto o core.
const EMBALAGEM_SYNC_INTERVAL_MS = Number(process.env.EMBALAGEM_SYNC_INTERVAL_MS ?? 60_000);

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

let syncingEmbalagem = false;

/**
 * Único lugar que chama `sincronizarEmbalagemHoje` — a tela de Embalagem (GET /api/embalagem)
 * nunca chama o Tiny direto, só lê o que este job já deixou em cache (ver aviso no topo de
 * lib/embalagem.ts). Isso existe porque, antes, cada clique em "Atualizar" disparava a
 * busca+resolução ao vivo dentro do próprio request — e isso, somado ao que os outros dois syncs
 * já fazem, foi uma causa real de bloqueio de limite de taxa.
 */
async function syncEmbalagemOnce(): Promise<void> {
  if (!isConfigured() || syncingEmbalagem) return;
  syncingEmbalagem = true;
  try {
    await sincronizarEmbalagemHoje();
    console.log(`[embalagem] sincronizado às ${new Date().toISOString()}`);
  } catch (error) {
    if (error instanceof OlistConfigError) {
      console.error(`[embalagem] ${error.message}`);
      return;
    }
    console.error("[embalagem] falha na sincronização:", error);
  } finally {
    syncingEmbalagem = false;
  }
}

// Atrasos no boot: sem isso, os três syncs disparavam juntos bem na subida (cada deploy reinicia
// o processo), formando uma rajada logo de cara contra o limite de taxa do Tiny.
void syncCoreOnce();
setTimeout(() => void syncEmbaladasOnce(), 15_000);
setTimeout(() => void syncEmbalagemOnce(), 30_000);
setInterval(() => void syncCoreOnce(), CORE_SYNC_INTERVAL_MS);
setInterval(() => void syncEmbaladasOnce(), EMBALADAS_SYNC_INTERVAL_MS);
setInterval(() => void syncEmbalagemOnce(), EMBALAGEM_SYNC_INTERVAL_MS);

// Coleta de vendas+estoque pro Planejamento de compra e pra taxa de devolução (lib/vendasSync.ts).
// Cada ciclo faz no máximo VENDAS_MAX_POR_TICK chamadas (padrão 40) — mesma ordem de grandeza do
// sync da Embalagem — e a primeira só sai depois dos outros três, pra não somar na rajada do boot.
// VENDAS_SYNC_INTERVAL_MS=0 desliga a coleta (ex.: se o limite de taxa do Tiny apertar).
const VENDAS_SYNC_INTERVAL_MS = Number(process.env.VENDAS_SYNC_INTERVAL_MS ?? 60_000);
if (VENDAS_SYNC_INTERVAL_MS > 0) {
  const syncVendasOnce = () =>
    tickVendas().catch((error: unknown) => console.error("[vendas] falha na coleta:", error));
  setTimeout(() => void syncVendasOnce(), 45_000);
  setInterval(() => void syncVendasOnce(), VENDAS_SYNC_INTERVAL_MS);
}

// Confere os dias já fechados do mês atual e do anterior (relatório de embalagem / bonificação):
// completa no cache o que ficou faltando enquanto o servidor estava dormindo. Um passo pequeno a
// cada ciclo (lista as separações do dia uma vez, depois resolve até 40 por passo) — mais espaçado
// que os outros syncs pra não disputar o limite de taxa do Tiny. 0 desliga.
const EMBALAGEM_VERIFICACAO_INTERVAL_MS = Number(process.env.EMBALAGEM_VERIFICACAO_INTERVAL_MS ?? 3 * 60_000);
if (EMBALAGEM_VERIFICACAO_INTERVAL_MS > 0) {
  let verificandoEmbalagem = false;
  const verificarEmbalagemOnce = async () => {
    if (!isConfigured() || verificandoEmbalagem) return;
    verificandoEmbalagem = true;
    try {
      await verificarDiaPassado();
    } catch (error) {
      console.error("[embalagem] falha ao verificar dia passado:", error);
    } finally {
      verificandoEmbalagem = false;
    }
  };
  setTimeout(() => void verificarEmbalagemOnce(), 90_000);
  setInterval(() => void verificarEmbalagemOnce(), EMBALAGEM_VERIFICACAO_INTERVAL_MS);
}

// Fotos dos produtos do catálogo do Estoque: puxa do Tiny e guarda no Cloudinary (lib/fotosProdutos.ts).
// Só trabalha quando há produto pendente (importado do Tiny ou botão "Buscar fotos no Tiny"); poucos
// produtos por ciclo. 0 desliga.
const FOTOS_PRODUTOS_INTERVAL_MS = Number(process.env.FOTOS_PRODUTOS_INTERVAL_MS ?? 60_000);
if (FOTOS_PRODUTOS_INTERVAL_MS > 0) {
  const fotosOnce = () => tickFotosProdutos().catch((error: unknown) => console.error("[fotos] falha ao buscar fotos:", error));
  setTimeout(() => void fotosOnce(), 60_000);
  setInterval(() => void fotosOnce(), FOTOS_PRODUTOS_INTERVAL_MS);
}

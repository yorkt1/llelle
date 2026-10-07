import fs from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

/**
 * KV simples — "cadastro" (colaboradores, catálogo de produtos, produto/voltagem de cada posição
 * do Estoque) e os snapshots sincronizados do Tiny/Olist, tudo pela mesma interface get/set/update/del.
 *
 * Dois backends, escolhidos automaticamente pela presença das variáveis do Supabase:
 *
 * - **Configurado** (`SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`): grava numa tabela do Supabase
 *   (Postgres gerenciado, tem plano grátis) — sobrevive a redeploy/restart do servidor. É o modo
 *   usado em produção. Precisa existir uma tabela `kv_store (key text primary key, value jsonb not
 *   null)` no projeto Supabase — ver README para o SQL de criação.
 * - **Sem as variáveis**: cai pro arquivo JSON local de sempre (`DATA_DIR/store.json`) — é o que
 *   roda em dev sem precisar configurar nada. Em produção SEM essas variáveis, o Render não tem
 *   disco persistente no plano Free, então esse arquivo zera a cada vez que o serviço "acorda" de
 *   inatividade ou é redeployado — é exatamente esse caso que fazia colaboradores/produtos
 *   cadastrados desaparecerem (dado digitado à mão, sem nenhuma fonte pra recriar sozinho —
 *   diferente dos snapshots do Tiny, que só esperam a próxima sincronização).
 *
 * Lido a cada chamada, não capturado num const no import: dotenv só carrega o .env.local depois
 * que os imports de server/index.ts já rodaram (import é hoisted), então um const de topo aqui
 * sempre veria o valor padrão antes disso.
 *
 * **Em produção (`NODE_ENV=production`, padrão do Render), sem Supabase configurado, gravar
 * (`set`/`update`/`del`) lança `StoreConfigError` em vez de cair quieto pro arquivo local** — é
 * essa queda silenciosa que fazia parecer que um cadastro salvou quando, na verdade, ia desaparecer
 * no próximo restart. `get` continua com o fallback (ler é inofensivo). Fora de produção (dev local,
 * testes — `NODE_ENV` não é "production" nesses casos), o arquivo local continua funcionando sem
 * precisar configurar nada, como sempre.
 */
export class StoreConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StoreConfigError";
  }
}
export function dataDir(): string {
  return process.env.DATA_DIR ?? "./data";
}
function storeFile(): string {
  return path.join(dataDir(), "store.json");
}

const TABELA = "kv_store";

function supabaseConfigurado(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function exigirPersistenciaDeVerdadeAoGravar(): void {
  if (supabaseConfigurado() || process.env.NODE_ENV !== "production") return;
  throw new StoreConfigError(
    "Supabase não está configurado em produção (faltam SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY) — " +
      "não vou gravar isso só no disco local, porque esse disco não é persistente no Render e a " +
      "informação se perderia no próximo restart/\"acordar\" do serviço.",
  );
}

function supabaseClient() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

async function getSupabase<T>(key: string): Promise<T | null> {
  const { data, error } = await supabaseClient().from(TABELA).select("value").eq("key", key).maybeSingle();
  if (error) throw new Error(`Supabase (get "${key}"): ${error.message}`);
  return (data?.value as T | undefined) ?? null;
}

async function setSupabase(key: string, value: unknown): Promise<void> {
  const { error } = await supabaseClient().from(TABELA).upsert({ key, value }, { onConflict: "key" });
  if (error) throw new Error(`Supabase (set "${key}"): ${error.message}`);
}

async function delSupabase(key: string): Promise<void> {
  const { error } = await supabaseClient().from(TABELA).delete().eq("key", key);
  if (error) throw new Error(`Supabase (del "${key}"): ${error.message}`);
}

type StoreData = Record<string, unknown>;

let queue: Promise<unknown> = Promise.resolve();

async function readAllArquivo(): Promise<StoreData> {
  try {
    const raw = await fs.readFile(storeFile(), "utf8");
    return JSON.parse(raw) as StoreData;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

async function writeAllArquivo(data: StoreData): Promise<void> {
  await fs.mkdir(dataDir(), { recursive: true });
  const file = storeFile();
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
  await fs.rename(tmp, file);
}

// Serializa leitura+escrita: duas chamadas concorrentes de set()/update() não podem se atropelar
// (uma sobrescrevendo o efeito da outra por lerem o mesmo estado antigo). Vale pros dois backends —
// o Supabase não precisa de transação própria porque só este processo escreve na tabela.
function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const result = queue.then(fn, fn);
  queue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export async function get<T>(key: string): Promise<T | null> {
  if (supabaseConfigurado()) return getSupabase<T>(key);
  const data = await readAllArquivo();
  return (data[key] as T | undefined) ?? null;
}

export async function set(key: string, value: unknown): Promise<void> {
  await enqueue(async () => {
    if (supabaseConfigurado()) {
      await setSupabase(key, value);
      return;
    }
    exigirPersistenciaDeVerdadeAoGravar();
    const data = await readAllArquivo();
    data[key] = value;
    await writeAllArquivo(data);
  });
}

/**
 * Leitura+modificação+escrita atômica (dentro da mesma fila do `enqueue`) — diferente de fazer
 * `get` seguido de `set` na mão, que tem uma janela onde duas chamadas concorrentes podem ler o
 * mesmo estado antigo e uma sobrescrever o resultado da outra. Necessário pra estoque.ts, onde
 * duas contagens em posições diferentes podem chegar quase juntas.
 */
export async function update<T>(key: string, updater: (atual: T | null) => T): Promise<T> {
  return enqueue(async () => {
    if (supabaseConfigurado()) {
      const atual = await getSupabase<T>(key);
      const novo = updater(atual);
      await setSupabase(key, novo);
      return novo;
    }
    exigirPersistenciaDeVerdadeAoGravar();
    const data = await readAllArquivo();
    const novo = updater((data[key] as T | undefined) ?? null);
    data[key] = novo;
    await writeAllArquivo(data);
    return novo;
  });
}

export async function del(key: string): Promise<void> {
  await enqueue(async () => {
    if (supabaseConfigurado()) {
      await delSupabase(key);
      return;
    }
    exigirPersistenciaDeVerdadeAoGravar();
    const data = await readAllArquivo();
    delete data[key];
    await writeAllArquivo(data);
  });
}

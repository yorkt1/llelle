import fs from "node:fs/promises";
import path from "node:path";

/**
 * KV simples em arquivo JSON. Guarda o último snapshot sincronizado — o único
 * dado que este app precisa persistir.
 *
 * Aponte DATA_DIR para um disco persistente (ex: Render Persistent Disk) em
 * produção: sem isso, o cache zera a cada redeploy (nada grave — só espera a
 * próxima sincronização de 5 em 5 min).
 *
 * Lido a cada chamada, não capturado num const no import: dotenv só carrega o
 * .env.local depois que os imports de server/index.ts já rodaram (import é
 * hoisted), então um const de topo aqui sempre veria o valor padrão antes disso.
 */
function dataDir(): string {
  return process.env.DATA_DIR ?? "./data";
}
function storeFile(): string {
  return path.join(dataDir(), "store.json");
}

type StoreData = Record<string, unknown>;

let queue: Promise<unknown> = Promise.resolve();

async function readAll(): Promise<StoreData> {
  try {
    const raw = await fs.readFile(storeFile(), "utf8");
    return JSON.parse(raw) as StoreData;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

async function writeAll(data: StoreData): Promise<void> {
  await fs.mkdir(dataDir(), { recursive: true });
  const file = storeFile();
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
  await fs.rename(tmp, file);
}

// Serializa leitura+escrita: duas chamadas concorrentes de set() não podem se
// atropelar (uma sobrescrevendo o efeito da outra por lerem o mesmo estado antigo).
function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const result = queue.then(fn, fn);
  queue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export async function get<T>(key: string): Promise<T | null> {
  const data = await readAll();
  return (data[key] as T | undefined) ?? null;
}

export async function set(key: string, value: unknown): Promise<void> {
  await enqueue(async () => {
    const data = await readAll();
    data[key] = value;
    await writeAll(data);
  });
}

export async function del(key: string): Promise<void> {
  await enqueue(async () => {
    const data = await readAll();
    delete data[key];
    await writeAll(data);
  });
}

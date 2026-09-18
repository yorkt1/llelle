import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Product, ProductAlias } from "../domain/types";
import { normalizeName, normalizeSku } from "../domain/normalize";
import type {
  AliasInput,
  ProductPatch,
  ProductSeed,
  Repository,
  Snapshot,
  SnapshotItem,
  StoredUpload,
} from "./types";

interface Db {
  products: Product[];
  aliases: ProductAlias[];
  snapshots: Snapshot[];
  snapshotItems: Record<string, SnapshotItem[]>;
  uploads: StoredUpload[];
}

const EMPTY: Db = { products: [], aliases: [], snapshots: [], snapshotItems: {}, uploads: [] };
const MAX_UPLOADS = 20;

/**
 * Driver de arquivo JSON. Serve para rodar sem configurar nada e como plano B se
 * o Supabase estiver fora — o volume aqui (cerca de 200 produtos) nao pede mais.
 */
export class LocalRepository implements Repository {
  private readonly file: string;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(dataDir = process.env.DATA_DIR ?? path.join(process.cwd(), "data")) {
    this.file = path.join(dataDir, "vitae-db.json");
  }

  private async read(): Promise<Db> {
    try {
      const raw = await readFile(this.file, "utf8");
      return { ...EMPTY, ...(JSON.parse(raw) as Db) };
    } catch {
      return structuredClone(EMPTY);
    }
  }

  private async write(db: Db): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true });
    const tmp = this.file + "." + randomUUID() + ".tmp";
    await writeFile(tmp, JSON.stringify(db, null, 2), "utf8");
    await rename(tmp, this.file);
  }

  /** Serializa leitura-modificacao-escrita para nao perder gravacoes concorrentes. */
  private transact<T>(fn: (db: Db) => Promise<T> | T): Promise<T> {
    const next = this.queue.then(async () => {
      const db = await this.read();
      const result = await fn(db);
      await this.write(db);
      return result;
    });
    this.queue = next.catch(() => undefined);
    return next;
  }

  async listProducts(): Promise<Product[]> {
    const db = await this.read();
    return db.products.slice().sort((a, b) => a.rowOrder - b.rowOrder);
  }

  async importProducts(seeds: ProductSeed[], seedDate: string, replace: boolean): Promise<Product[]> {
    return this.transact((db) => {
      const existingByName = new Map(db.products.map((p) => [normalizeName(p.sheetName), p]));
      const products: Product[] = [];
      const items: SnapshotItem[] = [];

      seeds.forEach((seed, index) => {
        const previous = existingByName.get(normalizeName(seed.sheetName));
        const product: Product = {
          id: previous?.id ?? randomUUID(),
          sheetName: seed.sheetName.trim(),
          rowOrder: index + 1,
          sku: normalizeSku(seed.sku),
          active: true,
        };
        products.push(product);
        items.push({
          productId: product.id,
          soldQty: 0,
          soldByOrder: 0,
          soldByInvoice: 0,
          previousBalance: seed.balance,
          newBalance: seed.balance,
        });
      });

      // Produtos que sairam da planilha viram inativos em vez de sumir: o
      // historico de saldo deles continua valido para consultas passadas.
      const incoming = new Set(products.map((p) => p.id));
      const kept = db.products
        .filter((p) => !incoming.has(p.id))
        .map((p, i) => ({ ...p, active: replace ? false : p.active, rowOrder: products.length + i + 1 }));
      db.products = products.concat(kept);

      const snapshot: Snapshot = {
        id: randomUUID(),
        periodStart: seedDate,
        periodEnd: seedDate,
        label: "saldo inicial",
        mode: "seed",
        createdAt: new Date().toISOString(),
        note: "Saldo importado da planilha",
      };
      db.snapshots.push(snapshot);
      db.snapshotItems[snapshot.id] = items;
      return products;
    });
  }

  async updateProduct(id: string, patch: ProductPatch): Promise<void> {
    await this.transact((db) => {
      const product = db.products.find((p) => p.id === id);
      if (product) Object.assign(product, patch, { id: product.id });
    });
  }

  async listAliases(): Promise<ProductAlias[]> {
    const db = await this.read();
    return db.aliases;
  }

  async saveAliases(entries: AliasInput[]): Promise<void> {
    if (entries.length === 0) return;
    await this.transact((db) => {
      for (const entry of entries) {
        const normalized = normalizeName(entry.reportName);
        if (!normalized) continue;
        const existing = db.aliases.find((a) => a.normalized === normalized);
        if (!existing) {
          db.aliases.push({
            id: randomUUID(),
            reportName: entry.reportName,
            normalized,
            productId: entry.productId,
            source: entry.source,
            createdAt: new Date().toISOString(),
          });
          continue;
        }
        // Uma correcao manual nunca e sobrescrita por um palpite automatico.
        if (existing.source === "manual" && entry.source === "auto") continue;
        existing.productId = entry.productId;
        existing.source = entry.source;
        existing.reportName = entry.reportName;
      }
    });
  }

  async deleteAlias(id: string): Promise<void> {
    await this.transact((db) => {
      db.aliases = db.aliases.filter((a) => a.id !== id);
    });
  }

  async latestBalances(onOrBefore?: string) {
    const db = await this.read();
    const candidates = db.snapshots
      .filter((s) => (onOrBefore ? s.periodEnd <= onOrBefore : true))
      .sort((a, b) => b.periodEnd.localeCompare(a.periodEnd) || b.createdAt.localeCompare(a.createdAt));

    const snapshot = candidates[0] ?? null;
    const balances: Record<string, number> = {};
    if (snapshot) {
      for (const item of db.snapshotItems[snapshot.id] ?? []) balances[item.productId] = item.newBalance;
    }
    return { balances, snapshot };
  }

  async listSnapshots(limit = 50): Promise<Snapshot[]> {
    const db = await this.read();
    return db.snapshots
      .slice()
      .sort((a, b) => b.periodEnd.localeCompare(a.periodEnd) || b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  async saveSnapshot(snapshot: Omit<Snapshot, "id" | "createdAt">, items: SnapshotItem[]): Promise<Snapshot> {
    return this.transact((db) => {
      const created: Snapshot = { ...snapshot, id: randomUUID(), createdAt: new Date().toISOString() };
      db.snapshots.push(created);
      db.snapshotItems[created.id] = items;
      return created;
    });
  }

  async deleteSnapshot(id: string): Promise<void> {
    await this.transact((db) => {
      db.snapshots = db.snapshots.filter((s) => s.id !== id);
      delete db.snapshotItems[id];
    });
  }

  async saveUpload(upload: Omit<StoredUpload, "id" | "createdAt">): Promise<StoredUpload> {
    return this.transact((db) => {
      const created: StoredUpload = { ...upload, id: randomUUID(), createdAt: new Date().toISOString() };
      db.uploads = [created, ...db.uploads].slice(0, MAX_UPLOADS);
      return created;
    });
  }

  async getUpload(id: string): Promise<StoredUpload | null> {
    const db = await this.read();
    return db.uploads.find((u) => u.id === id) ?? null;
  }
}

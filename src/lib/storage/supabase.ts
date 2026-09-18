import { createClient, type SupabaseClient } from "@supabase/supabase-js";
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

const MAX_UPLOADS = 20;

type ProductRow = { id: string; sheet_name: string; row_order: number; sku: string | null; active: boolean };
type AliasRow = {
  id: string;
  report_name: string;
  normalized: string;
  product_id: string | null;
  source: "auto" | "manual";
  created_at: string;
};
type SnapshotRow = {
  id: string;
  period_start: string;
  period_end: string;
  label: string;
  mode: Snapshot["mode"];
  note: string | null;
  created_at: string;
};
type UploadRow = { id: string; filename: string; created_at: string; report: StoredUpload["report"] };

function toProduct(row: ProductRow): Product {
  return { id: row.id, sheetName: row.sheet_name, rowOrder: row.row_order, sku: row.sku, active: row.active };
}

function toAlias(row: AliasRow): ProductAlias {
  return {
    id: row.id,
    reportName: row.report_name,
    normalized: row.normalized,
    productId: row.product_id,
    source: row.source,
    createdAt: row.created_at,
  };
}

function toSnapshot(row: SnapshotRow): Snapshot {
  return {
    id: row.id,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    label: row.label,
    mode: row.mode,
    note: row.note,
    createdAt: row.created_at,
  };
}

/** Tabela ausente: o schema ainda nao foi aplicado no projeto. */
function isMissingTable(message: string): boolean {
  return /schema cache|does not exist|relation .* does not exist/i.test(message);
}

function unwrap<T>(result: { data: T | null; error: { message: string } | null }, context: string): T {
  if (result.error) {
    if (isMissingTable(result.error.message)) {
      throw new Error(
        "As tabelas ainda nao existem no Supabase. Rode o conteudo de " +
          "src/lib/supabase/schema.sql no SQL Editor do projeto (leva um minuto), " +
          "ou apague SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY do .env.local para " +
          "usar o arquivo local.",
      );
    }
    throw new Error("Supabase (" + context + "): " + result.error.message);
  }
  return result.data as T;
}

/** Driver Postgres via Supabase. Usa service role key: roda apenas no servidor. */
export class SupabaseRepository implements Repository {
  private readonly db: SupabaseClient;

  constructor(url: string, serviceKey: string) {
    this.db = createClient(url, serviceKey, { auth: { persistSession: false } });
  }

  async listProducts(): Promise<Product[]> {
    const rows = unwrap(
      await this.db.from("products").select("*").order("row_order", { ascending: true }),
      "listProducts",
    ) as ProductRow[];
    return rows.map(toProduct);
  }

  async importProducts(seeds: ProductSeed[], seedDate: string, replace: boolean): Promise<Product[]> {
    const existing = await this.listProducts();
    const existingByName = new Map(existing.map((p) => [normalizeName(p.sheetName), p]));

    const payload = seeds.map((seed, index) => {
      const previous = existingByName.get(normalizeName(seed.sheetName));
      return {
        ...(previous ? { id: previous.id } : {}),
        sheet_name: seed.sheetName.trim(),
        row_order: index + 1,
        sku: normalizeSku(seed.sku),
        active: true,
      };
    });

    const inserted = unwrap(
      await this.db.from("products").upsert(payload, { onConflict: "id" }).select("*"),
      "importProducts",
    ) as ProductRow[];
    const products = inserted.map(toProduct).sort((a, b) => a.rowOrder - b.rowOrder);

    // Produtos que sairam da planilha viram inativos, preservando o historico.
    const incoming = new Set(products.map((p) => p.id));
    const dropped = existing.filter((p) => !incoming.has(p.id));
    if (replace && dropped.length > 0) {
      unwrap(
        await this.db.from("products").update({ active: false }).in("id", dropped.map((p) => p.id)).select("id"),
        "deactivateProducts",
      );
    }

    const balanceByName = new Map(seeds.map((seed) => [normalizeName(seed.sheetName), seed.balance]));
    await this.saveSnapshot(
      {
        periodStart: seedDate,
        periodEnd: seedDate,
        label: "saldo inicial",
        mode: "seed",
        note: "Saldo importado da planilha",
      },
      products.map((product) => {
        const balance = balanceByName.get(normalizeName(product.sheetName)) ?? 0;
        return {
          productId: product.id,
          soldQty: 0,
          soldByOrder: 0,
          soldByInvoice: 0,
          previousBalance: balance,
          newBalance: balance,
        };
      }),
    );

    return products;
  }

  async updateProduct(id: string, patch: ProductPatch): Promise<void> {
    const row: Record<string, unknown> = {};
    if (patch.sheetName !== undefined) row.sheet_name = patch.sheetName;
    if (patch.rowOrder !== undefined) row.row_order = patch.rowOrder;
    if (patch.sku !== undefined) row.sku = normalizeSku(patch.sku);
    if (patch.active !== undefined) row.active = patch.active;
    if (Object.keys(row).length === 0) return;
    unwrap(await this.db.from("products").update(row).eq("id", id).select("id"), "updateProduct");
  }

  async listAliases(): Promise<ProductAlias[]> {
    const rows = unwrap(await this.db.from("product_aliases").select("*"), "listAliases") as AliasRow[];
    return rows.map(toAlias);
  }

  async saveAliases(entries: AliasInput[]): Promise<void> {
    if (entries.length === 0) return;
    const current = await this.listAliases();
    const sourceByKey = new Map(current.map((a) => [a.normalized, a.source]));

    const byNormalized = new Map<string, AliasInput & { normalized: string }>();
    for (const entry of entries) {
      const normalized = normalizeName(entry.reportName);
      if (!normalized) continue;
      // Uma correcao manual nunca e sobrescrita por um palpite automatico.
      if (sourceByKey.get(normalized) === "manual" && entry.source === "auto") continue;
      byNormalized.set(normalized, { ...entry, normalized });
    }
    if (byNormalized.size === 0) return;

    const payload = [...byNormalized.values()].map((entry) => ({
      report_name: entry.reportName,
      normalized: entry.normalized,
      product_id: entry.productId,
      source: entry.source,
    }));
    unwrap(
      await this.db.from("product_aliases").upsert(payload, { onConflict: "normalized" }).select("id"),
      "saveAliases",
    );
  }

  async deleteAlias(id: string): Promise<void> {
    unwrap(await this.db.from("product_aliases").delete().eq("id", id).select("id"), "deleteAlias");
  }

  async latestBalances(onOrBefore?: string) {
    let query = this.db
      .from("snapshots")
      .select("*")
      .order("period_end", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1);
    if (onOrBefore) query = query.lte("period_end", onOrBefore);

    const rows = unwrap(await query, "latestBalances") as SnapshotRow[];
    const snapshot = rows[0] ? toSnapshot(rows[0]) : null;
    const balances: Record<string, number> = {};
    if (!snapshot) return { balances, snapshot };

    const items = unwrap(
      await this.db.from("snapshot_items").select("product_id, new_balance").eq("snapshot_id", snapshot.id),
      "latestBalanceItems",
    ) as { product_id: string; new_balance: number }[];
    for (const item of items) balances[item.product_id] = Number(item.new_balance);
    return { balances, snapshot };
  }

  async listSnapshots(limit = 50): Promise<Snapshot[]> {
    const rows = unwrap(
      await this.db
        .from("snapshots")
        .select("*")
        .order("period_end", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(limit),
      "listSnapshots",
    ) as SnapshotRow[];
    return rows.map(toSnapshot);
  }

  async saveSnapshot(snapshot: Omit<Snapshot, "id" | "createdAt">, items: SnapshotItem[]): Promise<Snapshot> {
    const rows = unwrap(
      await this.db
        .from("snapshots")
        .insert({
          period_start: snapshot.periodStart,
          period_end: snapshot.periodEnd,
          label: snapshot.label,
          mode: snapshot.mode,
          note: snapshot.note,
        })
        .select("*"),
      "saveSnapshot",
    ) as SnapshotRow[];

    const created = toSnapshot(rows[0]);
    if (items.length > 0) {
      const payload = items.map((item) => ({
        snapshot_id: created.id,
        product_id: item.productId,
        sold_qty: item.soldQty,
        sold_by_order: item.soldByOrder,
        sold_by_invoice: item.soldByInvoice,
        previous_balance: item.previousBalance,
        new_balance: item.newBalance,
      }));
      unwrap(await this.db.from("snapshot_items").insert(payload).select("product_id"), "saveSnapshotItems");
    }
    return created;
  }

  async deleteSnapshot(id: string): Promise<void> {
    unwrap(await this.db.from("snapshots").delete().eq("id", id).select("id"), "deleteSnapshot");
  }

  async saveUpload(upload: Omit<StoredUpload, "id" | "createdAt">): Promise<StoredUpload> {
    const rows = unwrap(
      await this.db
        .from("report_uploads")
        .insert({ filename: upload.filename, report: upload.report })
        .select("*"),
      "saveUpload",
    ) as UploadRow[];

    await this.pruneUploads();
    const row = rows[0];
    return { id: row.id, filename: row.filename, createdAt: row.created_at, report: row.report };
  }

  /** Mantem apenas os uploads recentes: o arquivo cru perde o valor depois da coluna fechada. */
  private async pruneUploads(): Promise<void> {
    const rows = unwrap(
      await this.db.from("report_uploads").select("id").order("created_at", { ascending: false }),
      "pruneUploads",
    ) as { id: string }[];
    const stale = rows.slice(MAX_UPLOADS).map((r) => r.id);
    if (stale.length > 0) {
      unwrap(await this.db.from("report_uploads").delete().in("id", stale).select("id"), "pruneUploadsDelete");
    }
  }

  async getUpload(id: string): Promise<StoredUpload | null> {
    const rows = unwrap(
      await this.db.from("report_uploads").select("*").eq("id", id).limit(1),
      "getUpload",
    ) as UploadRow[];
    const row = rows[0];
    return row ? { id: row.id, filename: row.filename, createdAt: row.created_at, report: row.report } : null;
  }
}

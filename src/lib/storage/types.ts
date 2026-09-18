import type { CountingMode, ParsedReport, Product, ProductAlias } from "../domain/types";

/** Uma coluna já gerada e confirmada. O saldo anterior sai sempre da mais recente. */
export interface Snapshot {
  id: string;
  periodStart: string;
  periodEnd: string;
  label: string;
  mode: CountingMode | "seed";
  createdAt: string;
  note: string | null;
}

export interface SnapshotItem {
  productId: string;
  soldQty: number;
  soldByOrder: number;
  soldByInvoice: number;
  previousBalance: number;
  newBalance: number;
}

export interface StoredUpload {
  id: string;
  filename: string;
  createdAt: string;
  report: ParsedReport;
}

export interface ProductSeed {
  sheetName: string;
  sku: string | null;
  balance: number;
}

export type AliasInput = { reportName: string; productId: string | null; source: "auto" | "manual" };

export type ProductPatch = Partial<Pick<Product, "sheetName" | "sku" | "active" | "rowOrder">>;

export interface Repository {
  listProducts(): Promise<Product[]>;
  /** Substitui a lista de produtos e grava o saldo inicial como snapshot semente. */
  importProducts(seeds: ProductSeed[], seedDate: string, replace: boolean): Promise<Product[]>;
  updateProduct(id: string, patch: ProductPatch): Promise<void>;

  listAliases(): Promise<ProductAlias[]>;
  saveAliases(entries: AliasInput[]): Promise<void>;
  deleteAlias(id: string): Promise<void>;

  /** Saldos da última coluna fechada em ou antes de onOrBefore. */
  latestBalances(onOrBefore?: string): Promise<{ balances: Record<string, number>; snapshot: Snapshot | null }>;

  listSnapshots(limit?: number): Promise<Snapshot[]>;
  saveSnapshot(snapshot: Omit<Snapshot, "id" | "createdAt">, items: SnapshotItem[]): Promise<Snapshot>;
  deleteSnapshot(id: string): Promise<void>;

  saveUpload(upload: Omit<StoredUpload, "id" | "createdAt">): Promise<StoredUpload>;
  getUpload(id: string): Promise<StoredUpload | null>;
}

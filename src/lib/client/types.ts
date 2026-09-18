import type {
  ColumnMapping,
  CountingMode,
  CountingRules,
  PendingMapping,
  PreviewRow,
  Product,
  UnknownProduct,
} from "@/lib/domain/types";
import type { Snapshot } from "@/lib/storage/types";

export type { ColumnMapping, CountingMode, CountingRules, PendingMapping, PreviewRow, Product, UnknownProduct };
export type { Snapshot };

export interface UploadResponse {
  uploadId: string;
  filename: string;
  detectedFormat: "csv" | "xlsx";
  headers: string[];
  mapping: ColumnMapping;
  warnings: string[];
  totalRows: number;
  lineCount: number;
  statuses: { order: string[]; invoice: string[]; channels: string[] };
  suggestedDate: string | null;
}

export interface PreviewResponse {
  preview: {
    period: { start: string; end: string; label: string };
    mode: CountingMode;
    invoiceAvailable: boolean;
    rows: PreviewRow[];
    pending: PendingMapping[];
    unknown: UnknownProduct[];
    divergentCount: number;
    totals: { byOrder: number; byInvoice: number };
    skippedLines: number;
  };
  previousSnapshot: Snapshot | null;
  report: {
    headers: string[];
    mapping: ColumnMapping;
    warnings: string[];
    lineCount: number;
    statuses: { order: string[]; invoice: string[]; channels: string[] };
    filename: string;
    invoiceFilename: string | null;
  };
  rules: CountingRules;
}

export interface StatusResponse {
  driver: "supabase" | "local";
  productCount: number;
  aliasCount: number;
  lastSnapshot: Snapshot | null;
}

export interface ProductsResponse {
  products: (Product & { balance: number })[];
  snapshot: Snapshot | null;
}

export interface MappingsResponse {
  mappings: {
    id: string;
    reportName: string;
    normalized: string;
    productId: string | null;
    source: "auto" | "manual";
    createdAt: string;
    sheetName: string | null;
    outOfSheet: boolean;
  }[];
  products: Product[];
}

export const COLUMN_ROLE_LABEL: Record<keyof ColumnMapping, string> = {
  productName: "Nome do produto",
  sku: "Código (SKU)",
  quantity: "Quantidade",
  orderNumber: "Número do pedido",
  orderDate: "Data do pedido",
  orderStatus: "Situação do pedido",
  invoiceNumber: "Número da nota",
  invoiceDate: "Data da nota",
  invoiceStatus: "Situação da nota",
  channel: "Canal de venda",
};

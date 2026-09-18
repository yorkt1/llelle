import type { AggregatedSale, PendingMapping, Product, ProductAlias, UnknownProduct } from "./types";
import { normalizeName, normalizeSku } from "./normalize";
import { AUTO_ACCEPT_SCORE, rankCandidates } from "./fuzzy";

/** Escolha feita pelo usuário na tela: id do produto, ou "fora da planilha". */
export const OUT_OF_SHEET = "__out_of_sheet__";
export type MappingDecision = string | typeof OUT_OF_SHEET;

export interface ResolvedProductSale {
  productId: string;
  byOrder: number;
  byInvoice: number;
  matchedNames: string[];
}

export interface ResolutionResult {
  resolved: Map<string, ResolvedProductSale>;
  pending: PendingMapping[];
  unknown: UnknownProduct[];
  /** Mapeamentos deduzidos nesta rodada que devem ser gravados para não perguntar de novo. */
  learned: { reportName: string; productId: string | null; source: "auto" | "manual" }[];
}

/**
 * Liga cada nome do relatório a uma linha da planilha, nesta ordem:
 * decisão manual desta rodada > mapeamento já salvo > SKU exato > nome exato >
 * fuzzy acima do limiar. O que sobra vai para confirmação humana.
 */
export function resolveSales(
  sales: AggregatedSale[],
  products: Product[],
  aliases: ProductAlias[],
  decisions: Record<string, MappingDecision> = {},
): ResolutionResult {
  const aliasByName = new Map<string, ProductAlias>();
  for (const alias of aliases) aliasByName.set(alias.normalized, alias);

  const activeProducts = products.filter((p) => p.active);
  const productById = new Map(activeProducts.map((p) => [p.id, p]));
  const productBySku = new Map<string, Product>();
  const productByName = new Map<string, Product>();
  for (const product of activeProducts) {
    const sku = normalizeSku(product.sku);
    if (sku && !productBySku.has(sku)) productBySku.set(sku, product);
    const name = normalizeName(product.sheetName);
    if (name && !productByName.has(name)) productByName.set(name, product);
  }

  const resolved = new Map<string, ResolvedProductSale>();
  const pending: PendingMapping[] = [];
  const unknown: UnknownProduct[] = [];
  const learned: ResolutionResult["learned"] = [];

  const attach = (productId: string, sale: AggregatedSale) => {
    let entry = resolved.get(productId);
    if (!entry) {
      entry = { productId, byOrder: 0, byInvoice: 0, matchedNames: [] };
      resolved.set(productId, entry);
    }
    entry.byOrder += sale.byOrder;
    entry.byInvoice += sale.byInvoice;
    entry.matchedNames.push(sale.rawProductName);
  };

  for (const sale of sales) {
    const key = normalizeName(sale.rawProductName);

    const decision = decisions[sale.rawProductName] ?? decisions[key];
    if (decision !== undefined) {
      if (decision === OUT_OF_SHEET) {
        unknown.push({ ...toUnknown(sale), acknowledged: true });
        learned.push({ reportName: sale.rawProductName, productId: null, source: "manual" });
      } else if (productById.has(decision)) {
        attach(decision, sale);
        learned.push({ reportName: sale.rawProductName, productId: decision, source: "manual" });
      } else {
        pending.push(toPending(sale, activeProducts));
      }
      continue;
    }

    const alias = aliasByName.get(key);
    if (alias) {
      if (alias.productId === null) {
        unknown.push({ ...toUnknown(sale), acknowledged: true });
      } else if (productById.has(alias.productId)) {
        attach(alias.productId, sale);
      } else {
        // O produto mapeado saiu da planilha: volta para confirmação.
        pending.push(toPending(sale, activeProducts));
      }
      continue;
    }

    const skuMatch = sale.sku ? productBySku.get(sale.sku) : undefined;
    if (skuMatch) {
      attach(skuMatch.id, sale);
      learned.push({ reportName: sale.rawProductName, productId: skuMatch.id, source: "auto" });
      continue;
    }

    const exactMatch = productByName.get(key);
    if (exactMatch) {
      attach(exactMatch.id, sale);
      learned.push({ reportName: sale.rawProductName, productId: exactMatch.id, source: "auto" });
      continue;
    }

    const ranked = rankCandidates(sale.rawProductName, activeProducts, (p) => p.sheetName);
    const best = ranked[0];
    const runnerUp = ranked[1];
    const confident = best && best.score >= AUTO_ACCEPT_SCORE && (!runnerUp || best.score - runnerUp.score >= 0.06);

    if (confident) {
      attach(best.item.id, sale);
      learned.push({ reportName: sale.rawProductName, productId: best.item.id, source: "auto" });
    } else if (ranked.length > 0) {
      pending.push(toPending(sale, activeProducts, ranked));
    } else {
      unknown.push({ ...toUnknown(sale), acknowledged: false });
    }
  }

  return { resolved, pending, unknown, learned };
}

function toUnknown(sale: AggregatedSale): Omit<UnknownProduct, "acknowledged"> {
  return {
    reportName: sale.rawProductName,
    sku: sale.sku,
    byOrder: sale.byOrder,
    byInvoice: sale.byInvoice,
  };
}

function toPending(
  sale: AggregatedSale,
  products: Product[],
  ranked = rankCandidates(sale.rawProductName, products, (p) => p.sheetName),
): PendingMapping {
  return {
    reportName: sale.rawProductName,
    sku: sale.sku,
    byOrder: sale.byOrder,
    byInvoice: sale.byInvoice,
    suggestions: ranked.map((c) => ({
      productId: c.item.id,
      sheetName: c.item.sheetName,
      score: Number(c.score.toFixed(3)),
    })),
  };
}

/**
 * Combina a resolução de dois relatórios distintos: um exportado por pedido e
 * outro por nota fiscal.
 *
 * O export agregado do Tiny não traz dados de nota, então quando a equipe quer
 * comparar os dois modos precisa exportar dois arquivos. A junção acontece por
 * produto da planilha, não por nome — os dois relatórios podem escrever o mesmo
 * item de formas diferentes e ainda assim cair na mesma linha.
 */
export function mergeResolutions(order: ResolutionResult, invoice: ResolutionResult): ResolutionResult {
  const resolved = new Map<string, ResolvedProductSale>();

  for (const [productId, sale] of order.resolved) {
    resolved.set(productId, { ...sale, byInvoice: 0, matchedNames: [...sale.matchedNames] });
  }
  for (const [productId, sale] of invoice.resolved) {
    const existing = resolved.get(productId);
    if (existing) {
      existing.byInvoice = sale.byInvoice;
      for (const name of sale.matchedNames) {
        if (!existing.matchedNames.includes(name)) existing.matchedNames.push(name);
      }
    } else {
      resolved.set(productId, { ...sale, byOrder: 0, matchedNames: [...sale.matchedNames] });
    }
  }

  const dedupe = <T extends { reportName: string }>(a: T[], b: T[]): T[] => {
    const byName = new Map<string, T>();
    for (const item of [...a, ...b]) if (!byName.has(item.reportName)) byName.set(item.reportName, item);
    return [...byName.values()];
  };

  const learned = new Map<string, ResolutionResult["learned"][number]>();
  for (const entry of [...order.learned, ...invoice.learned]) learned.set(entry.reportName, entry);

  return {
    resolved,
    pending: dedupe(order.pending, invoice.pending),
    unknown: dedupe(order.unknown, invoice.unknown),
    learned: [...learned.values()],
  };
}

import type { ColumnMapping, ColumnRole } from "../types";
import { normalizeName } from "../normalize";
import { similarity } from "../fuzzy";
import type { CellValue } from "./xlsx";

interface RoleSpec {
  role: ColumnRole;
  aliases: string[];
  /** Tokens que, se presentes, indicam que o cabeçalho é de OUTRO papel. */
  excludes?: string[];
  /** Papéis mais específicos são resolvidos antes dos genéricos. */
  priority: number;
}

/**
 * Nomes de cabeçalho observados/prováveis nos exports do Tiny. As listas de
 * `excludes` existem porque "Data" e "Data da nota fiscal" (ou "Número" e
 * "Número da nota") só se distinguem pela presença de "NOTA"/"NF".
 */
const ROLE_SPECS: RoleSpec[] = [
  {
    role: "invoiceNumber",
    priority: 10,
    aliases: [
      "NUMERO DA NOTA FISCAL", "NUMERO DA NOTA", "NUMERO NOTA FISCAL", "NUMERO NF",
      "NOTA FISCAL", "N NF", "NF", "NFE", "NUM NF", "NRO NOTA", "NUMERO DA NFE",
    ],
    excludes: ["SITUACAO", "STATUS", "DATA", "SERIE", "CHAVE", "VALOR", "LINK", "URL"],
  },
  {
    role: "invoiceDate",
    priority: 10,
    aliases: [
      "DATA DA NOTA FISCAL", "DATA DA NOTA", "DATA NF", "DATA DA NF", "DATA EMISSAO NF",
      "DATA DE EMISSAO DA NOTA", "DATA DE EMISSAO DA NOTA FISCAL", "EMISSAO NF", "DATA NFE",
    ],
  },
  {
    role: "invoiceStatus",
    priority: 10,
    aliases: [
      "SITUACAO DA NOTA FISCAL", "SITUACAO DA NOTA", "SITUACAO NF", "STATUS DA NOTA",
      "STATUS NF", "SITUACAO DA NFE",
    ],
  },
  {
    role: "orderStatus",
    priority: 8,
    aliases: ["SITUACAO DO PEDIDO", "SITUACAO", "STATUS DO PEDIDO", "STATUS", "SITUACAO VENDA"],
    excludes: ["NOTA", "NF", "NFE"],
  },
  {
    role: "orderNumber",
    priority: 8,
    aliases: [
      "NUMERO DO PEDIDO", "NUMERO PEDIDO", "N PEDIDO", "ID DO PEDIDO", "PEDIDO",
      "NUMERO", "NUMERO DA VENDA", "CODIGO DO PEDIDO", "NUMERO DA ORDEM",
    ],
    excludes: ["NOTA", "NF", "NFE", "ITEM", "SERIE", "PRODUTO", "CLIENTE"],
  },
  {
    role: "orderDate",
    priority: 8,
    aliases: [
      "DATA DO PEDIDO", "DATA PEDIDO", "DATA DA VENDA", "DATA DE EMISSAO", "DATA EMISSAO",
      "DATA", "DATA DA COMPRA", "DATA VENDA",
    ],
    excludes: ["NOTA", "NF", "NFE", "PREVISTA", "ENTREGA", "ENVIO", "PAGAMENTO", "VENCIMENTO"],
  },
  {
    role: "quantity",
    priority: 9,
    aliases: [
      "QUANTIDADE", "QTDE", "QTD", "QUANT", "QUANTIDADE VENDIDA", "QTD VENDIDA",
      "QUANTIDADE DO ITEM", "QTDE VENDIDA",
    ],
    excludes: ["ESTOQUE", "SALDO", "DISPONIVEL", "RESERVADA"],
  },
  {
    role: "sku",
    priority: 9,
    aliases: [
      "SKU", "CODIGO", "COD", "CODIGO DO PRODUTO", "COD PRODUTO", "CODIGO SKU",
      "REFERENCIA", "COD REF", "CODIGO INTERNO",
    ],
    excludes: ["PEDIDO", "CLIENTE", "BARRAS", "EAN", "NOTA"],
  },
  {
    role: "productName",
    priority: 9,
    aliases: [
      "DESCRICAO DO PRODUTO", "NOME DO PRODUTO", "DESCRICAO", "PRODUTO", "ITEM",
      "NOME", "DESCRICAO DO ITEM", "PRODUTO SERVICO", "ANUNCIO", "TITULO",
    ],
    excludes: ["CODIGO", "SKU", "CLIENTE", "VALOR", "UNIDADE", "CATEGORIA", "MARCA"],
  },
  {
    role: "channel",
    priority: 7,
    aliases: [
      "E COMMERCE", "ECOMMERCE", "CANAL", "CANAL DE VENDA", "MARKETPLACE", "LOJA",
      "ORIGEM", "INTERMEDIADOR", "CANAL DE ORIGEM",
    ],
  },
];

function scoreHeader(header: string, spec: RoleSpec): number {
  const normalized = normalizeName(header);
  if (!normalized) return 0;

  for (const exclude of spec.excludes ?? []) {
    if (normalized.split(" ").includes(exclude)) return 0;
  }

  let best = 0;
  for (const alias of spec.aliases) {
    if (normalized === alias) return 1;
    if (normalized.startsWith(`${alias} `) || normalized.endsWith(` ${alias}`)) {
      best = Math.max(best, 0.9);
    } else if (normalized.includes(alias)) {
      best = Math.max(best, 0.82);
    } else {
      const fuzzy = similarity(normalized, alias);
      if (fuzzy >= 0.8) best = Math.max(best, fuzzy * 0.75);
    }
  }
  return best;
}

/** Atribuição gulosa: cada cabeçalho serve a um papel, cada papel a um cabeçalho. */
export function detectColumns(headers: string[]): ColumnMapping {
  const scored: { role: ColumnRole; index: number; score: number; priority: number }[] = [];

  for (const spec of ROLE_SPECS) {
    headers.forEach((header, index) => {
      const score = scoreHeader(header, spec);
      if (score >= 0.6) scored.push({ role: spec.role, index, score, priority: spec.priority });
    });
  }

  scored.sort((a, b) => b.score - a.score || b.priority - a.priority);

  const mapping: ColumnMapping = {};
  const usedColumns = new Set<number>();
  for (const entry of scored) {
    if (mapping[entry.role] !== undefined || usedColumns.has(entry.index)) continue;
    mapping[entry.role] = entry.index;
    usedColumns.add(entry.index);
  }
  return mapping;
}

/**
 * Exports costumam ter linhas de título/filtro antes do cabeçalho real, então
 * escolhemos a linha inicial que reconhece mais papéis (com desempate por
 * quantidade de células preenchidas).
 */
export function findHeaderRow(rows: CellValue[][], searchDepth = 25): number {
  let bestRow = 0;
  let bestScore = -1;

  const limit = Math.min(searchDepth, rows.length);
  for (let i = 0; i < limit; i += 1) {
    const headers = rows[i].map((cell) => String(cell ?? ""));
    const filled = headers.filter((h) => h.trim() !== "").length;
    if (filled < 2) continue;

    const mapping = detectColumns(headers);
    const roles = Object.keys(mapping).length;
    const hasEssentials = mapping.productName !== undefined && mapping.quantity !== undefined;
    const score = roles * 10 + (hasEssentials ? 50 : 0) + Math.min(filled, 10);

    if (score > bestScore) {
      bestScore = score;
      bestRow = i;
    }
  }
  return bestRow;
}

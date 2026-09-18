import type { PendingMapping, Product, UnknownProduct } from "@/lib/client/types";
import { OUT_OF_SHEET } from "@/lib/domain/matching";
import { Badge, Button, Callout, inputClass } from "./ui";

interface Props {
  pending: PendingMapping[];
  unknown: UnknownProduct[];
  products: Product[];
  onDecide: (reportName: string, decision: string) => void;
}

function ProductPicker({
  products,
  onPick,
  placeholder,
}: {
  products: Product[];
  onPick: (productId: string) => void;
  placeholder: string;
}) {
  return (
    <select
      value=""
      onChange={(event) => event.target.value && onPick(event.target.value)}
      className={`${inputClass} max-w-64 py-1.5 text-xs`}
    >
      <option value="">{placeholder}</option>
      {products.map((product) => (
        <option key={product.id} value={product.id}>
          {product.sheetName}
        </option>
      ))}
    </select>
  );
}

function Quantities({ byOrder, byInvoice }: { byOrder: number; byInvoice: number }) {
  return (
    <span className="tabular text-xs text-muted">
      {byOrder} por pedido · {byInvoice} por nota
    </span>
  );
}

/**
 * Fila de decisões humanas. Nada daqui é resolvido no chute: enquanto sobrar
 * item, o fechamento da coluna fica travado, porque um produto sem destino
 * significa uma venda que não seria descontada da planilha.
 */
export function DecisionsPanel({ pending, unknown, products, onDecide }: Props) {
  const novos = unknown.filter((item) => !item.acknowledged);
  const conhecidos = unknown.filter((item) => item.acknowledged);

  if (pending.length === 0 && novos.length === 0 && conhecidos.length === 0) {
    return <Callout tone="positive">Todos os produtos do relatório já têm destino na planilha.</Callout>;
  }

  return (
    <div className="space-y-4">
      {pending.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium">
            Confirme o produto ({pending.length} pendente{pending.length === 1 ? "" : "s"})
          </p>
          {pending.map((item) => (
            <div key={item.reportName} className="rounded-lg border border-border bg-surface-muted p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-sm font-medium">{item.reportName}</span>
                <Quantities byOrder={item.byOrder} byInvoice={item.byInvoice} />
              </div>
              {item.sku && <p className="mt-0.5 text-[11px] text-muted">SKU {item.sku}</p>}

              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {item.suggestions.map((suggestion) => (
                  <Button
                    key={suggestion.productId}
                    className="px-2.5 py-1 text-xs"
                    onClick={() => onDecide(item.reportName, suggestion.productId)}
                  >
                    {suggestion.sheetName}
                    <span className="ml-1 text-[10px] text-muted">
                      {Math.round(suggestion.score * 100)}%
                    </span>
                  </Button>
                ))}
                <ProductPicker
                  products={products}
                  placeholder="Outro produto..."
                  onPick={(productId) => onDecide(item.reportName, productId)}
                />
                <Button
                  variant="ghost"
                  className="px-2.5 py-1 text-xs"
                  onClick={() => onDecide(item.reportName, OUT_OF_SHEET)}
                >
                  Não está na planilha
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {novos.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-warning">
            Vendeu mas não existe na planilha ({novos.length})
          </p>
          {novos.map((item) => (
            <div key={item.reportName} className="rounded-lg border border-warning/40 bg-warning-soft p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-sm font-medium">{item.reportName}</span>
                <Quantities byOrder={item.byOrder} byInvoice={item.byInvoice} />
              </div>
              {item.sku && <p className="mt-0.5 text-[11px] text-muted">SKU {item.sku}</p>}
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <ProductPicker
                  products={products}
                  placeholder="Apontar para uma linha existente..."
                  onPick={(productId) => onDecide(item.reportName, productId)}
                />
                <Button
                  variant="ghost"
                  className="px-2.5 py-1 text-xs"
                  onClick={() => onDecide(item.reportName, OUT_OF_SHEET)}
                >
                  É produto novo, seguir sem descontar
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {conhecidos.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted">
            Fora da planilha, já confirmados ({conhecidos.length})
          </p>
          <div className="flex flex-wrap gap-1.5">
            {conhecidos.map((item) => (
              <Badge key={item.reportName}>
                {item.reportName} · {item.byOrder}
              </Badge>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

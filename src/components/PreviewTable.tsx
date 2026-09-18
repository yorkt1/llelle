import { useMemo, useState } from "react";
import type { CountingMode, PreviewRow } from "@/lib/client/types";
import { Badge, inputClass } from "./ui";

type Filter = "all" | "sold" | "divergent" | "negative";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "Todos" },
  { value: "sold", label: "Com venda" },
  { value: "divergent", label: "Divergentes" },
  { value: "negative", label: "Saldo negativo" },
];

function format(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(".", ",");
}

export function PreviewTable({
  rows,
  mode,
  invoiceAvailable,
}: {
  rows: PreviewRow[];
  mode: CountingMode;
  invoiceAvailable: boolean;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");

  const counts = useMemo(
    () => ({
      all: rows.length,
      sold: rows.filter((r) => r.soldQty !== 0).length,
      divergent: rows.filter((r) => r.diverges).length,
      negative: rows.filter((r) => r.status === "negative").length,
    }),
    [rows],
  );

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (filter === "sold" && row.soldQty === 0) return false;
      if (filter === "divergent" && !row.diverges) return false;
      if (filter === "negative" && row.status !== "negative") return false;
      if (term && !row.sheetName.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [rows, filter, search]);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1">
          {FILTERS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setFilter(option.value)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                filter === option.value ? "bg-accent-soft text-accent" : "text-muted hover:bg-surface-muted"
              }`}
            >
              {option.label}
              <span className="tabular ml-1.5 opacity-60">{counts[option.value]}</span>
            </button>
          ))}
        </div>
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Filtrar por nome..."
          className={`${inputClass} ml-auto max-w-56 py-1.5 text-xs`}
        />
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-muted text-left text-xs text-muted">
              <th className="px-3 py-2 font-medium">#</th>
              <th className="px-3 py-2 font-medium">Produto</th>
              <th className={`px-3 py-2 text-right font-medium ${mode === "order" ? "text-accent" : ""}`}>
                Por pedido
              </th>
              <th className={`px-3 py-2 text-right font-medium ${mode === "invoice" ? "text-accent" : ""}`}>
                Por nota
              </th>
              <th className="px-3 py-2 text-right font-medium">Saldo anterior</th>
              <th className="px-3 py-2 text-right font-medium">Novo saldo</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr
                key={row.productId}
                className={`border-b border-border last:border-0 ${
                  row.diverges ? "bg-warning-soft/40" : row.soldQty !== 0 ? "" : "text-muted"
                }`}
              >
                <td className="tabular px-3 py-1.5 text-xs text-muted">{row.rowOrder}</td>
                <td className="px-3 py-1.5">
                  <span className="font-medium text-foreground">{row.sheetName}</span>
                  {row.matchedNames.length > 0 && (
                    <span className="ml-2 text-[11px] text-muted" title={row.matchedNames.join(" · ")}>
                      {row.matchedNames.length === 1
                        ? row.matchedNames[0]
                        : `${row.matchedNames.length} anúncios`}
                    </span>
                  )}
                </td>
                <td
                  className={`tabular px-3 py-1.5 text-right ${
                    mode === "order" ? "font-semibold" : "text-muted"
                  }`}
                >
                  {row.soldByOrder === 0 ? "—" : format(row.soldByOrder)}
                </td>
                <td
                  className={`tabular px-3 py-1.5 text-right ${
                    mode === "invoice" ? "font-semibold" : "text-muted"
                  }`}
                >
                  {!invoiceAvailable || row.soldByInvoice === 0 ? "—" : format(row.soldByInvoice)}
                </td>
                <td className="tabular px-3 py-1.5 text-right text-muted">{format(row.previousBalance)}</td>
                <td className="tabular px-3 py-1.5 text-right font-semibold">
                  {format(row.newBalance)}
                  {row.status === "negative" && (
                    <span className="ml-2">
                      <Badge tone="danger">negativo</Badge>
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-sm text-muted">
                  Nenhum produto neste filtro.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

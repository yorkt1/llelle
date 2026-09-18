import type { ColumnMapping, CountingRules, UploadResponse } from "@/lib/client/types";
import { COLUMN_ROLE_LABEL } from "@/lib/client/types";
import { inputClass } from "./ui";

interface Props {
  upload: UploadResponse;
  mapping: ColumnMapping;
  rules: CountingRules;
  onMappingChange: (role: keyof ColumnMapping, index: number | undefined) => void;
  onRulesChange: (patch: Partial<CountingRules>) => void;
}

const ROLES = Object.keys(COLUMN_ROLE_LABEL) as (keyof ColumnMapping)[];

function Chips({
  values,
  excluded,
  onToggle,
  empty,
}: {
  values: string[];
  excluded: string[];
  onToggle: (value: string) => void;
  empty: string;
}) {
  if (values.length === 0) return <p className="text-[11px] text-muted">{empty}</p>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {values.map((value) => {
        const off = excluded.some((item) => item.toLowerCase() === value.toLowerCase());
        return (
          <button
            key={value}
            type="button"
            onClick={() => onToggle(value)}
            className={`rounded-md border px-2 py-1 text-[11px] transition-colors ${
              off
                ? "border-border bg-surface-muted text-muted line-through"
                : "border-accent/40 bg-accent-soft text-accent"
            }`}
          >
            {value}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Ajustes finos que a equipe pode precisar mudar sem tocar em código: quais
 * colunas o arquivo usa e o que entra na conta. Fica recolhido porque o caminho
 * normal do dia a dia não passa por aqui.
 */
export function AdvancedPanel({ upload, mapping, rules, onMappingChange, onRulesChange }: Props) {
  const toggle = (list: string[], value: string): string[] =>
    list.some((item) => item.toLowerCase() === value.toLowerCase())
      ? list.filter((item) => item.toLowerCase() !== value.toLowerCase())
      : [...list, value];

  return (
    <details className="rounded-xl border border-border bg-surface">
      <summary className="cursor-pointer px-5 py-3 text-sm font-semibold">
        Ajustes do relatório
        <span className="ml-2 text-xs font-normal text-muted">colunas, canais e situações</span>
      </summary>

      <div className="space-y-5 border-t border-border px-5 py-4">
        <div>
          <p className="mb-2 text-xs font-medium">Colunas do arquivo</p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {ROLES.map((role) => (
              <label key={role} className="flex flex-col gap-1">
                <span className="text-[11px] text-muted">{COLUMN_ROLE_LABEL[role]}</span>
                <select
                  value={mapping[role] ?? ""}
                  onChange={(event) =>
                    onMappingChange(role, event.target.value === "" ? undefined : Number(event.target.value))
                  }
                  className={`${inputClass} py-1.5 text-xs`}
                >
                  <option value="">— não usar —</option>
                  {upload.headers.map((header, index) => (
                    <option key={`${header}-${index}`} value={index}>
                      {header || `coluna ${index + 1}`}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-2 text-xs font-medium">
            Canais que entram na conta
            <span className="ml-1.5 font-normal text-muted">clique para tirar da conta</span>
          </p>
          <Chips
            values={upload.statuses.channels}
            excluded={rules.excludedChannels}
            onToggle={(value) => onRulesChange({ excludedChannels: toggle(rules.excludedChannels, value) })}
            empty="Este relatório não separa canais."
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="mb-2 text-xs font-medium">Situações de pedido</p>
            <Chips
              values={upload.statuses.order}
              excluded={rules.excludedOrderStatuses}
              onToggle={(value) =>
                onRulesChange({ excludedOrderStatuses: toggle(rules.excludedOrderStatuses, value) })
              }
              empty="Este relatório não traz situação de pedido."
            />
          </div>
          <div>
            <p className="mb-2 text-xs font-medium">Situações de nota</p>
            <Chips
              values={upload.statuses.invoice}
              excluded={rules.excludedInvoiceStatuses}
              onToggle={(value) =>
                onRulesChange({ excludedInvoiceStatuses: toggle(rules.excludedInvoiceStatuses, value) })
              }
              empty="Este relatório não traz situação de nota."
            />
          </div>
        </div>

        <label className="flex items-start gap-2 text-xs">
          <input
            type="checkbox"
            checked={rules.requireInvoiceNumber}
            onChange={(event) => onRulesChange({ requireInvoiceNumber: event.target.checked })}
            className="mt-0.5 size-3.5 accent-[var(--accent)]"
          />
          <span>
            No modo Por Nota Fiscal, só contar linhas com número de nota
            <span className="block text-[11px] text-muted">
              Desmarque se o relatório de notas não traz o número em cada linha.
            </span>
          </span>
        </label>

        <label className="flex items-start gap-2 text-xs">
          <input
            type="checkbox"
            checked={rules.ignoreDatesUseWholeFile}
            onChange={(event) => onRulesChange({ ignoreDatesUseWholeFile: event.target.checked })}
            className="mt-0.5 size-3.5 accent-[var(--accent)]"
          />
          <span>
            Contar o arquivo inteiro, ignorando as datas das linhas
            <span className="block text-[11px] text-muted">
              Use quando o relatório já foi filtrado por data no próprio Tiny.
            </span>
          </span>
        </label>
      </div>
    </details>
  );
}

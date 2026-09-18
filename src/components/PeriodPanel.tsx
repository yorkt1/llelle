import { Field, inputClass } from "./ui";

/**
 * A planilha tem colunas de um dia e colunas que agrupam dias corridos
 * ("04/09 à 07/09", quando cai fim de semana ou feriado). O período aqui é o que
 * define qual dos dois formatos a coluna gerada representa.
 */
export function PeriodPanel({
  start,
  end,
  grouped,
  onStartChange,
  onEndChange,
  onGroupedChange,
  label,
}: {
  start: string;
  end: string;
  grouped: boolean;
  onStartChange: (value: string) => void;
  onEndChange: (value: string) => void;
  onGroupedChange: (value: boolean) => void;
  label: string | null;
}) {
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={grouped ? "Primeiro dia" : "Dia do relatório"}>
          <input
            type="date"
            value={start}
            onChange={(event) => onStartChange(event.target.value)}
            className={inputClass}
          />
        </Field>
        {grouped && (
          <Field label="Último dia">
            <input
              type="date"
              value={end}
              min={start}
              onChange={(event) => onEndChange(event.target.value)}
              className={inputClass}
            />
          </Field>
        )}
      </div>

      <label className="flex items-center gap-2 text-xs text-muted">
        <input
          type="checkbox"
          checked={grouped}
          onChange={(event) => onGroupedChange(event.target.checked)}
          className="size-3.5 accent-[var(--accent)]"
        />
        Esta coluna agrupa vários dias (fim de semana, feriado)
      </label>

      {label && (
        <p className="text-xs text-muted">
          Cabeçalho da coluna: <span className="font-medium text-foreground">{label}</span>
        </p>
      )}
    </div>
  );
}

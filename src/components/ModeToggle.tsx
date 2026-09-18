import type { CountingMode } from "@/lib/client/types";

const OPTIONS: { value: CountingMode; label: string; hint: string }[] = [
  { value: "order", label: "Por Pedido", hint: "conta os pedidos registrados" },
  { value: "invoice", label: "Por Nota Fiscal", hint: "conta as notas emitidas" },
];

interface Props {
  value: CountingMode;
  onChange: (mode: CountingMode) => void;
  divergentCount: number | null;
  /** null enquanto não há relatório carregado. */
  invoiceAvailable: boolean | null;
}

/**
 * A escolha entre os dois modos ainda está em aberto no negócio, então ela fica
 * sempre visível e sempre reversível — nunca embutida numa tela de configuração.
 */
export function ModeToggle({ value, onChange, divergentCount, invoiceAvailable }: Props) {
  const semNota = invoiceAvailable === false;

  return (
    <div>
      <div className="inline-flex w-full rounded-lg border border-border bg-surface-muted p-1">
        {OPTIONS.map((option) => {
          const active = option.value === value;
          const bloqueado = option.value === "invoice" && semNota;
          return (
            <button
              key={option.value}
              type="button"
              disabled={bloqueado}
              onClick={() => onChange(option.value)}
              aria-pressed={active}
              className={`flex-1 rounded-md px-3 py-2 text-center transition-colors ${
                active ? "bg-surface shadow-sm" : "text-muted hover:text-foreground"
              } ${bloqueado ? "cursor-not-allowed opacity-40 hover:text-muted" : ""}`}
            >
              <span className="block text-sm font-medium">{option.label}</span>
              <span className="block text-[11px] text-muted">
                {bloqueado ? "sem dados neste arquivo" : option.hint}
              </span>
            </button>
          );
        })}
      </div>

      {semNota ? (
        <p className="mt-2 text-xs text-muted">
          Este relatório não separa pedido de nota fiscal. Para comparar os dois modos, exporte também o
          relatório por nota fiscal e envie no segundo campo acima.
        </p>
      ) : (
        divergentCount !== null && (
          <p className="mt-2 text-xs text-muted">
            {divergentCount === 0
              ? "Os dois modos dão o mesmo número em todos os produtos."
              : `${divergentCount} produto${divergentCount === 1 ? "" : "s"} ${
                  divergentCount === 1 ? "muda" : "mudam"
                } de saldo conforme o modo. Estão destacados na tabela.`}
          </p>
        )
      )}
    </div>
  );
}

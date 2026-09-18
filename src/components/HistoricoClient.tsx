import { useState } from "react";
import { Badge, Button, Callout, Card, SectionTitle } from "@/components/ui";
import { getJson, sendJson } from "@/lib/client/api";
import type { Snapshot } from "@/lib/client/types";

const MODE_LABEL: Record<Snapshot["mode"], string> = {
  order: "Por Pedido",
  invoice: "Por Nota Fiscal",
  seed: "Saldo inicial",
};

export function HistoricoClient({ initial }: { initial: Snapshot[] }) {
  const [snapshots, setSnapshots] = useState<Snapshot[]>(initial);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const data = await getJson<{ snapshots: Snapshot[] }>("/api/snapshots");
      setSnapshots(data.snapshots);
    } catch {
      setError("Não consegui carregar o histórico.");
    }
  }

  async function apagar(snapshot: Snapshot) {
    const confirmado = window.confirm(
      `Apagar a coluna ${snapshot.label}? O saldo anterior volta a ser o da coluna anterior a ela.`,
    );
    if (!confirmado) return;
    await sendJson(`/api/snapshots/${snapshot.id}`, {}, "DELETE");
    await load();
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Histórico de colunas</h1>
        <p className="mt-1 text-sm text-muted">
          Cada coluna fechada vira o saldo de partida da seguinte. Apagar uma desfaz o fechamento daquele dia.
        </p>
      </div>

      {error && <Callout tone="danger">{error}</Callout>}

      <Card>
        <SectionTitle title={`${snapshots.length} colunas`} />
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[620px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-muted text-left text-xs text-muted">
                <th className="px-3 py-2 font-medium">Coluna</th>
                <th className="px-3 py-2 font-medium">Período</th>
                <th className="px-3 py-2 font-medium">Modo</th>
                <th className="px-3 py-2 font-medium">Fechada em</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {snapshots.map((snapshot) => (
                <tr key={snapshot.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2 font-medium">{snapshot.label}</td>
                  <td className="tabular px-3 py-2 text-xs text-muted">
                    {snapshot.periodStart === snapshot.periodEnd
                      ? snapshot.periodStart
                      : `${snapshot.periodStart} → ${snapshot.periodEnd}`}
                  </td>
                  <td className="px-3 py-2">
                    <Badge tone={snapshot.mode === "seed" ? "neutral" : "accent"}>
                      {MODE_LABEL[snapshot.mode]}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-xs text-muted">
                    {new Date(snapshot.createdAt).toLocaleString("pt-BR")}
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => void apagar(snapshot)}>
                      Apagar
                    </Button>
                  </td>
                </tr>
              ))}
              {snapshots.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-10 text-center text-sm text-muted">
                    Nenhuma coluna fechada ainda.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

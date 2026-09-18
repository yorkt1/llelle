import { useState } from "react";
import { copyText } from "@/lib/client/api";
import type { PreviewResponse } from "@/lib/client/types";
import { toClipboardColumn, toClipboardTable } from "@/lib/domain/column";
import { Button, Callout } from "./ui";

interface Props {
  result: PreviewResponse;
  unresolved: number;
  committing: boolean;
  onCommit: () => void;
}

export function ExportPanel({ result, unresolved, committing, onCommit }: Props) {
  const [copied, setCopied] = useState<string | null>(null);
  const { rows, period } = result.preview;

  async function copy(kind: "column" | "table") {
    const text = kind === "column" ? toClipboardColumn(rows) : toClipboardTable(rows);
    const done = await copyText(text);
    setCopied(done ? kind : null);
    if (done) setTimeout(() => setCopied(null), 2500);
  }

  function downloadCsv() {
    const content = toClipboardColumn(rows, true, period.label);
    // BOM para o Excel abrir em UTF-8 sem estragar acento.
    const blob = new Blob(["\uFEFF" + content], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `coluna-${period.start}${period.start === period.end ? "" : `-a-${period.end}`}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => void copy("column")}>
          {copied === "column" ? "Copiado" : `Copiar coluna (${rows.length} linhas)`}
        </Button>
        <Button onClick={() => void copy("table")}>
          {copied === "table" ? "Copiado" : "Copiar tabela de conferência"}
        </Button>
        <Button onClick={downloadCsv}>Baixar .csv</Button>
      </div>

      <p className="text-xs text-muted">
        A coluna sai com um valor por linha, na mesma ordem da planilha. Cole na célula do topo da coluna{" "}
        <span className="font-medium text-foreground">{period.label}</span>.
      </p>

      <div className="border-t border-border pt-3">
        {unresolved > 0 ? (
          <Callout tone="warning">
            {unresolved} produto{unresolved === 1 ? "" : "s"} do relatório ainda sem destino. Resolva acima
            antes de fechar o dia — senão essa venda não sai do estoque.
          </Callout>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" onClick={onCommit} disabled={committing}>
              {committing ? "Fechando..." : "Fechar o dia e salvar o saldo"}
            </Button>
            <p className="text-xs text-muted">
              Grava este saldo como ponto de partida do próximo dia.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

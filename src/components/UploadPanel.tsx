import { useRef, useState } from "react";
import { uploadFile } from "@/lib/client/api";
import type { UploadResponse } from "@/lib/client/types";
import { Badge, Button, Callout } from "./ui";

interface Props {
  label: string;
  hint: string;
  value: UploadResponse | null;
  optional?: boolean;
  onLoaded: (upload: UploadResponse) => void;
  onCleared: () => void;
}

export function UploadPanel({ label, hint, value, optional, onLoaded, onCleared }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  async function send(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      onLoaded(await uploadFile<UploadResponse>("/api/uploads", file));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao ler o arquivo.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <span className="text-xs font-medium">{label}</span>
        {optional && <Badge>opcional</Badge>}
      </div>

      {value ? (
        <div className="rounded-lg border border-border bg-surface-muted px-3 py-2.5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{value.filename}</p>
              <p className="tabular mt-0.5 text-xs text-muted">
                {value.lineCount} linha{value.lineCount === 1 ? "" : "s"} de venda · {value.detectedFormat.toUpperCase()}
              </p>
            </div>
            <Button variant="ghost" className="shrink-0 px-2 py-1 text-xs" onClick={onCleared}>
              Trocar
            </Button>
          </div>
        </div>
      ) : (
        <div
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            void send(event.dataTransfer.files[0]);
          }}
          className={`rounded-lg border border-dashed px-3 py-5 text-center transition-colors ${
            dragging ? "border-accent bg-accent-soft" : "border-border bg-surface-muted"
          }`}
        >
          <p className="text-xs text-muted">{hint}</p>
          <Button
            variant="secondary"
            className="mt-2.5 px-2.5 py-1.5 text-xs"
            disabled={busy}
            onClick={() => input.current?.click()}
          >
            {busy ? "Lendo..." : "Escolher arquivo"}
          </Button>
          <input
            ref={input}
            type="file"
            accept=".csv,.xlsx,.xls,.txt,text/csv"
            className="hidden"
            onChange={(event) => void send(event.target.files?.[0])}
          />
        </div>
      )}

      {error && (
        <div className="mt-2">
          <Callout tone="danger">{error}</Callout>
        </div>
      )}

      {value && value.warnings.length > 0 && (
        <ul className="mt-2 space-y-1">
          {value.warnings.map((warning) => (
            <li key={warning}>
              <Callout tone="warning">{warning}</Callout>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

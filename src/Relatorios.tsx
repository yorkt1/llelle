import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

type Status = "idle" | "processando" | "concluido" | "erro";

interface StatusResponse {
  status: "processando" | "concluido" | "erro";
  progresso: { atual: number; total: number };
  erro?: string;
}

// Vazio quando front e API rodam juntos — mesma convenção do painel de separação e da devolução.
const API_URL = import.meta.env.VITE_API_URL ?? "";
const POLL_MS = 1500;

function extrairErro(json: unknown, fallback: string): string {
  if (json && typeof json === "object" && "error" in json && typeof (json as { error: unknown }).error === "string") {
    return (json as { error: string }).error;
  }
  return fallback;
}

function hojeIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function Relatorios() {
  const [termo, setTermo] = useState("");
  const [dataInicial, setDataInicial] = useState(hojeIso());
  const [dataFinal, setDataFinal] = useState(hojeIso());
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [progresso, setProgresso] = useState({ atual: 0, total: 0 });
  const [erro, setErro] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);

  const pararPolling = useCallback(() => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => pararPolling, [pararPolling]);

  const iniciar = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      if (!termo.trim() || !dataInicial || !dataFinal) return;

      pararPolling();
      setErro(null);
      setJobId(null);
      setStatus("processando");
      setProgresso({ atual: 0, total: 0 });

      try {
        const response = await fetch(`${API_URL}/api/relatorios/vendas`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ termo: termo.trim(), dataInicial, dataFinal }),
        });
        const json = await response.json();
        if (!response.ok) throw new Error(extrairErro(json, "Não consegui iniciar o relatório."));

        const id = json.jobId as string;
        setJobId(id);

        pollRef.current = window.setInterval(async () => {
          try {
            const statusResponse = await fetch(`${API_URL}/api/relatorios/vendas/${id}`, { cache: "no-store" });
            const statusJson = (await statusResponse.json()) as StatusResponse;
            if (!statusResponse.ok) throw new Error(extrairErro(statusJson, "Não consegui acompanhar o relatório."));

            setProgresso(statusJson.progresso);
            setStatus(statusJson.status);
            if (statusJson.status !== "processando") {
              pararPolling();
              if (statusJson.status === "erro") setErro(statusJson.erro ?? "Não consegui gerar o relatório.");
            }
          } catch (error) {
            pararPolling();
            setStatus("erro");
            setErro(error instanceof Error ? error.message : "Não consegui acompanhar o relatório.");
          }
        }, POLL_MS);
      } catch (error) {
        setStatus("erro");
        setErro(error instanceof Error ? error.message : "Não consegui iniciar o relatório.");
      }
    },
    [termo, dataInicial, dataFinal, pararPolling],
  );

  return (
    <div className="page devolucao-page">
      <header className="header">
        <h1 className="title">Relatórios</h1>
      </header>

      <form className="devolucao-form" onSubmit={iniciar}>
        <label className="field">
          <span className="field-label">Produto (nome ou parte do nome)</span>
          <input
            className="field-input"
            value={termo}
            onChange={(event) => setTermo(event.target.value)}
            placeholder="Ex: Sanduicheira"
            autoFocus
          />
        </label>

        <div className="devolucao-info">
          <label className="field">
            <span className="field-label">Data inicial</span>
            <input className="field-input" type="date" value={dataInicial} onChange={(event) => setDataInicial(event.target.value)} />
          </label>
          <label className="field">
            <span className="field-label">Data final</span>
            <input className="field-input" type="date" value={dataFinal} onChange={(event) => setDataFinal(event.target.value)} />
          </label>
        </div>

        <button className="refresh-btn" type="submit" disabled={status === "processando" || !termo.trim()}>
          {status === "processando" ? "Gerando..." : "Gerar relatório"}
        </button>
      </form>

      {status === "processando" && (
        <p className="field-value">
          Consultando pedidos no Tiny: {progresso.atual}
          {progresso.total ? ` de ${progresso.total}` : ""}...
        </p>
      )}

      {erro && <p className="error-banner">{erro}</p>}

      {status === "concluido" && jobId && (
        <a className="refresh-btn" href={`${API_URL}/api/relatorios/vendas/${jobId}/download`} download>
          Baixar Excel (.xlsx)
        </a>
      )}
    </div>
  );
}

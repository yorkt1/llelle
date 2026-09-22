import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

type Status = "idle" | "processando" | "concluido" | "erro";

interface StatusResponse {
  status: "processando" | "concluido" | "erro";
  progresso: { atual: number; total: number };
  erro?: string;
}

interface JobSalvo {
  jobId: string;
  termo: string;
  dataInicial: string;
  dataFinal: string;
}

// Vazio quando front e API rodam juntos — mesma convenção do painel de separação.
const API_URL = import.meta.env.VITE_API_URL ?? "";
const POLL_MS = 1500;

// Um relatório grande pode levar mais de 1h rodando no servidor, independente da aba aberta —
// guardar o jobId permite retomar o acompanhamento depois de um F5, fechar a aba ou uma queda de rede.
const JOB_STORAGE_KEY = "relatorios:jobAtivo";

function lerJobSalvo(): JobSalvo | null {
  try {
    const raw = localStorage.getItem(JOB_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as JobSalvo) : null;
  } catch {
    return null;
  }
}

function salvarJob(job: JobSalvo | null): void {
  try {
    if (job) localStorage.setItem(JOB_STORAGE_KEY, JSON.stringify(job));
    else localStorage.removeItem(JOB_STORAGE_KEY);
  } catch {
    // localStorage bloqueado (aba anônima etc.) — só perde a retomada automática, não trava o resto.
  }
}

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
  const [jobSalvoNaAbertura] = useState(() => lerJobSalvo());

  const [termo, setTermo] = useState(jobSalvoNaAbertura?.termo ?? "");
  const [dataInicial, setDataInicial] = useState(jobSalvoNaAbertura?.dataInicial ?? hojeIso());
  const [dataFinal, setDataFinal] = useState(jobSalvoNaAbertura?.dataFinal ?? hojeIso());
  const [jobId, setJobId] = useState<string | null>(jobSalvoNaAbertura?.jobId ?? null);
  const [status, setStatus] = useState<Status>(jobSalvoNaAbertura ? "processando" : "idle");
  const [progresso, setProgresso] = useState({ atual: 0, total: 0 });
  const [erro, setErro] = useState<string | null>(null);
  const [conexaoInstavel, setConexaoInstavel] = useState(false);
  const pollRef = useRef<number | null>(null);

  const pararPolling = useCallback(() => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => pararPolling, [pararPolling]);

  // Só configura o intervalo/checagem — não reseta jobId/status, porque quem chama já os deixou
  // certos (o estado inicial, na retomada após F5, ou o próprio `iniciar` antes de chamar isto).
  const iniciarPolling = useCallback(
    (id: string) => {
      pararPolling();

      const verificar = async () => {
        try {
          const statusResponse = await fetch(`${API_URL}/api/relatorios/vendas/${id}`, { cache: "no-store" });
          if (statusResponse.status === 404) {
            pararPolling();
            salvarJob(null);
            setStatus("erro");
            setErro("Relatório não encontrado — pode ter expirado (fica disponível por 2h depois de pronto). Gere de novo.");
            return;
          }
          const statusJson = (await statusResponse.json()) as StatusResponse;
          if (!statusResponse.ok) throw new Error(extrairErro(statusJson, "Não consegui acompanhar o relatório."));

          setConexaoInstavel(false);
          setProgresso(statusJson.progresso);
          setStatus(statusJson.status);
          if (statusJson.status !== "processando") {
            pararPolling();
            salvarJob(null);
            if (statusJson.status === "erro") setErro(statusJson.erro ?? "Não consegui gerar o relatório.");
          }
        } catch {
          // Rede instável (wifi caiu, DNS soluçou) — o relatório continua rodando no servidor,
          // independente da conexão do navegador. Só avisa, não desiste: a próxima rodada tenta de novo.
          setConexaoInstavel(true);
        }
      };

      void verificar();
      pollRef.current = window.setInterval(verificar, POLL_MS);
    },
    [pararPolling],
  );

  // Se a aba foi recarregada (ou reaberta) com um relatório ainda em andamento, retoma o acompanhamento
  // em vez de mostrar a tela em branco — o job em si nunca dependeu desta aba estar aberta. O estado
  // inicial (termo/jobId/status) já vem certo dos useState acima; só falta ligar o polling.
  useEffect(() => {
    if (jobSalvoNaAbertura) iniciarPolling(jobSalvoNaAbertura.jobId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const iniciar = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      if (!termo.trim() || !dataInicial || !dataFinal) return;

      pararPolling();
      setErro(null);
      setJobId(null);
      setStatus("processando");
      setProgresso({ atual: 0, total: 0 });
      setConexaoInstavel(false);

      try {
        const response = await fetch(`${API_URL}/api/relatorios/vendas`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ termo: termo.trim(), dataInicial, dataFinal }),
        });
        const json = await response.json();
        if (!response.ok) throw new Error(extrairErro(json, "Não consegui iniciar o relatório."));

        const id = json.jobId as string;
        salvarJob({ jobId: id, termo: termo.trim(), dataInicial, dataFinal });
        setJobId(id);
        iniciarPolling(id);
      } catch (error) {
        setStatus("erro");
        setErro(error instanceof Error ? error.message : "Não consegui iniciar o relatório.");
      }
    },
    [termo, dataInicial, dataFinal, pararPolling, iniciarPolling],
  );

  return (
    <div className="page relatorio-page">
      <header className="header">
        <h1 className="title">Relatórios</h1>
      </header>

      <form className="relatorio-form" onSubmit={iniciar}>
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

        <div className="relatorio-grade">
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

      {status === "processando" && conexaoInstavel && (
        <p className="field-value field-value--muted">
          Conexão instável agora — o relatório continua rodando no servidor, só não consigo atualizar o
          progresso neste instante. Tentando de novo...
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

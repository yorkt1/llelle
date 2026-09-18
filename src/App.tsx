import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";

interface SeparacaoCounts {
  aguardandoSeparacao: number;
  emSeparacao: number;
  separadas: number;
}

interface SeparacaoResponse {
  connected: boolean;
  counts: SeparacaoCounts | null;
  syncedAt: string | null;
}

const STAGES: { key: keyof SeparacaoCounts; label: string; color: string }[] = [
  { key: "aguardandoSeparacao", label: "Aguardando separação", color: "var(--stage-1)" },
  { key: "emSeparacao", label: "Em separação", color: "var(--stage-2)" },
  { key: "separadas", label: "Separadas", color: "var(--stage-3)" },
];

const POLL_MS = 30_000;

// Vazio quando front e API rodam juntos (dev, ou os dois no mesmo Express).
// Preenchido (build-time) só quando o front é hospedado separado da API,
// ex: front na Vercel apontando pra API no Render.
const API_URL = import.meta.env.VITE_API_URL ?? "";

function useClock(): string {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

/** Anima de um valor pro outro em vez de trocar o número seco — mesmo efeito de "subindo" do contador do YouTube. */
function useAnimatedNumber(value: number, duration = 600): number {
  const [display, setDisplay] = useState(value);
  const displayRef = useRef(value);

  useEffect(() => {
    displayRef.current = display;
  }, [display]);

  useEffect(() => {
    const from = displayRef.current;
    if (from === value) return;
    const start = performance.now();
    let raf = 0;

    const tick = (now: number) => {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(from + (value - from) * eased));
      if (progress < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);

  return display;
}

/** true por 500ms toda vez que o valor muda — dispara o "pop" visual junto com a contagem. */
function useChangePulse(value: number): boolean {
  const [pulsing, setPulsing] = useState(false);
  const prevRef = useRef(value);

  useEffect(() => {
    if (prevRef.current === value) return;
    prevRef.current = value;
    setPulsing(true);
    const id = setTimeout(() => setPulsing(false), 500);
    return () => clearTimeout(id);
  }, [value]);

  return pulsing;
}

function StageValue({ value }: { value: number }) {
  const display = useAnimatedNumber(value);
  const pulsing = useChangePulse(value);
  return (
    <span className={`stage-value tabular${pulsing ? " stage-value--pulse" : ""}`}>{display}</span>
  );
}

function GhostGrid() {
  return (
    <div className="grid" aria-hidden="true">
      {STAGES.map((stage) => (
        <div key={stage.key} className="stage" style={{ "--stage-color": stage.color } as CSSProperties}>
          <span className="skeleton skeleton-label" />
          <span className="skeleton skeleton-value" />
        </div>
      ))}
    </div>
  );
}

export function App() {
  const clock = useClock();

  const [data, setData] = useState<SeparacaoResponse | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`${API_URL}/api/separacao`, { cache: "no-store" });
      if (!response.ok) throw new Error(`API respondeu ${response.status}.`);
      const json = (await response.json()) as SeparacaoResponse;
      setData(json);
      setBootError(null);
      setSyncError(null);
    } catch {
      // Se já tínhamos dados na tela, um soluço passageiro vira aviso discreto;
      // se nunca carregou nada, é bloqueante — não dá pra mostrar números que não existem.
      setData((current) => {
        if (current) setSyncError("Não consegui atualizar os números agora.");
        else setBootError("Não consegui falar com o servidor do painel.");
        return current;
      });
    }
  }, []);

  useEffect(() => {
    const kickoff = setTimeout(() => void load(), 0);
    const id = setInterval(() => void load(), POLL_MS);
    return () => {
      clearTimeout(kickoff);
      clearInterval(id);
    };
  }, [load, attempt]);

  // Nunca conseguimos falar com o backend: não tem dashboard nem CTA de conexão
  // pra mostrar, só um retry — mostrar "—" nesse caso seria fingir que sabemos o estado.
  if (bootError) {
    return (
      <div className="page">
        <div className="connect">
          <h1 className="title">Painel de Separação</h1>
          <p className="error-banner">{bootError}</p>
          <button className="refresh-btn" onClick={() => setAttempt((n) => n + 1)}>
            Tentar de novo
          </button>
        </div>
      </div>
    );
  }

  // Backend respondeu, mas o servidor ainda não tem OLIST_API_TOKEN configurado.
  if (data && !data.connected) {
    return (
      <div className="page">
        <div className="connect">
          <h1 className="title">Painel de Separação</h1>
          <p className="error-banner">
            O servidor ainda não tem o token do Olist configurado (OLIST_API_TOKEN). Preencha o
            .env.local (ou as variáveis de ambiente, em produção) e reinicie o servidor.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <header className="header">
        <h1 className="title">Painel de Separação</h1>
        <span className="clock tabular">{clock}</span>
      </header>

      {data?.counts ? (
        <div className="grid">
          {STAGES.map((stage) => (
            <div key={stage.key} className="stage" style={{ "--stage-color": stage.color } as CSSProperties}>
              <span className="stage-label">{stage.label}</span>
              <StageValue value={data.counts![stage.key]} />
            </div>
          ))}
        </div>
      ) : (
        <GhostGrid />
      )}

      {syncError && <p className="error-banner">{syncError}</p>}
    </div>
  );
}

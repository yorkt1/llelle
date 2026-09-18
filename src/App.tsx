import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";

interface SeparacaoCounts {
  aguardandoSeparacao: number;
  emSeparacao: number;
  separadas: number;
  /** null quando a última sincronização falhou (ex: teto de páginas) e não há valor em cache. */
  embaladas: number | null;
}

interface SeparacaoResponse {
  connected: boolean;
  counts: SeparacaoCounts | null;
  syncedAt: string | null;
}

type StageKey = keyof SeparacaoCounts;

const STAGES: { key: StageKey; label: string; color: string }[] = [
  { key: "aguardandoSeparacao", label: "Aguardando separação", color: "var(--stage-1)" },
  { key: "emSeparacao", label: "Em separação", color: "var(--stage-2)" },
  { key: "separadas", label: "Separadas", color: "var(--stage-3)" },
  { key: "embaladas", label: "Embaladas", color: "var(--stage-4)" },
];

// Pessoa que nunca abriu a configuração vê exatamente as 3 etapas exatas —
// "Embaladas" é aproximado (ver lib/olist.ts) e fica opt-in.
const DEFAULT_VISIBLE_STAGES: StageKey[] = ["aguardandoSeparacao", "emSeparacao", "separadas"];
const VISIBLE_STAGES_STORAGE_KEY = "painel:visibleStages";

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

function StageValue({ value }: { value: number | null }) {
  const display = useAnimatedNumber(value ?? 0);
  const pulsing = useChangePulse(value ?? 0);
  if (value === null) {
    return <span className="stage-value tabular stage-value--muted">—</span>;
  }
  return (
    <span className={`stage-value tabular${pulsing ? " stage-value--pulse" : ""}`}>{display}</span>
  );
}

/** Persiste no navegador, não no servidor — cada tela/TV escolhe suas próprias etapas, sem depender de login. */
function readVisibleStages(): Set<StageKey> {
  try {
    const raw = localStorage.getItem(VISIBLE_STAGES_STORAGE_KEY);
    if (!raw) return new Set(DEFAULT_VISIBLE_STAGES);
    const parsed = JSON.parse(raw) as unknown;
    const valid = Array.isArray(parsed)
      ? parsed.filter((key): key is StageKey => STAGES.some((stage) => stage.key === key))
      : [];
    return valid.length > 0 ? new Set(valid) : new Set(DEFAULT_VISIBLE_STAGES);
  } catch {
    return new Set(DEFAULT_VISIBLE_STAGES);
  }
}

function useVisibleStages(): [Set<StageKey>, (key: StageKey) => void] {
  const [visible, setVisible] = useState<Set<StageKey>>(readVisibleStages);

  const toggleStage = useCallback((key: StageKey) => {
    setVisible((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        if (next.size === 1) return current; // nunca deixa a tela sem nenhum contador
        next.delete(key);
      } else {
        next.add(key);
      }
      try {
        localStorage.setItem(VISIBLE_STAGES_STORAGE_KEY, JSON.stringify([...next]));
      } catch {
        // localStorage bloqueado (aba anônima etc.) — a escolha só não sobrevive a um reload.
      }
      return next;
    });
  }, []);

  return [visible, toggleStage];
}

function useFullscreen(): [boolean, () => void] {
  const [isFullscreen, setIsFullscreen] = useState(() => document.fullscreenElement != null);

  useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement != null);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen();
  }, []);

  return [isFullscreen, toggleFullscreen];
}

function SettingsButton({ onClick }: { onClick: () => void }) {
  return (
    <button className="settings-trigger" onClick={onClick} aria-label="Configurar painel">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1z" />
      </svg>
    </button>
  );
}

function SettingsPanel({
  visible,
  onToggleStage,
  isFullscreen,
  onToggleFullscreen,
  onClose,
}: {
  visible: Set<StageKey>;
  onToggleStage: (key: StageKey) => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  onClose: () => void;
}) {
  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-panel" onClick={(event) => event.stopPropagation()}>
        <button className="settings-close" onClick={onClose} aria-label="Fechar configurações">
          ×
        </button>
        <h2 className="settings-title">Configurar este painel</h2>
        <p className="settings-hint">
          A escolha fica só neste aparelho — outras telas não são afetadas.
        </p>
        <div className="settings-options">
          {STAGES.map((stage) => (
            <label key={stage.key} className="settings-option">
              <input type="checkbox" checked={visible.has(stage.key)} onChange={() => onToggleStage(stage.key)} />
              {stage.label}
            </label>
          ))}
        </div>
        <button className="refresh-btn" onClick={onToggleFullscreen}>
          {isFullscreen ? "Sair da tela cheia" : "Tela cheia"}
        </button>
      </div>
    </div>
  );
}

function GhostGrid({ stages }: { stages: typeof STAGES }) {
  return (
    <div className="grid" style={{ "--stage-count": stages.length } as CSSProperties} aria-hidden="true">
      {stages.map((stage) => (
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
  const [visibleStages, toggleStage] = useVisibleStages();
  const [isFullscreen, toggleFullscreen] = useFullscreen();
  const [settingsOpen, setSettingsOpen] = useState(false);

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

  const stages = STAGES.filter((stage) => visibleStages.has(stage.key));

  return (
    <div className="page">
      <header className="header">
        <h1 className="title">Painel de Separação</h1>
        <span className="clock tabular">{clock}</span>
      </header>

      {data?.counts ? (
        <div className="grid" style={{ "--stage-count": stages.length } as CSSProperties}>
          {stages.map((stage) => (
            <div key={stage.key} className="stage" style={{ "--stage-color": stage.color } as CSSProperties}>
              <span className="stage-label">{stage.label}</span>
              <StageValue value={data.counts![stage.key]} />
            </div>
          ))}
        </div>
      ) : (
        <GhostGrid stages={stages} />
      )}

      {syncError && <p className="error-banner">{syncError}</p>}

      <SettingsButton onClick={() => setSettingsOpen(true)} />
      {settingsOpen && (
        <SettingsPanel
          visible={visibleStages}
          onToggleStage={toggleStage}
          isFullscreen={isFullscreen}
          onToggleFullscreen={toggleFullscreen}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
}

import { useCallback, useEffect, useRef, useState } from "react";

interface RegistroContagem {
  id: string;
  quantidade: number;
  responsavel: string;
  fotoArquivo: string | null;
  criadoEm: string;
}

interface PosicaoResumo {
  rua: string;
  codigo: string;
  ultima: RegistroContagem;
}

interface RuaResumo {
  rua: string;
  posicoes: PosicaoResumo[];
}

type Modal = { modo: "existente"; rua: string; codigo: string; ultima: RegistroContagem } | { modo: "nova"; rua: string } | null;

const API_URL = import.meta.env.VITE_API_URL ?? "";
const POLL_MS = 30_000;
const RESPONSAVEL_STORAGE_KEY = "estoque:ultimoResponsavel";
const LADO_MAXIMO_FOTO = 1600; // px — reduz fotos de celular (3-8MB) pra algo leve de enviar/guardar.

function fotoUrl(fotoArquivo: string | null): string | null {
  return fotoArquivo ? `${API_URL}/api/estoque/foto/${fotoArquivo}` : null;
}

function formatarDataHora(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/** Ícone de prateleira/galpão (estante com caixas) — usado quando a posição ainda não tem foto, no lugar de um texto seco. */
function IconeGondola({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M8 6v36M40 6v36" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M8 16h32M8 32h32" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <rect x="12" y="19" width="9" height="9" rx="1.5" fill="currentColor" opacity="0.55" />
      <rect x="23" y="19" width="9" height="9" rx="1.5" fill="currentColor" opacity="0.35" />
      <rect x="12" y="35" width="9" height="7" rx="1.5" fill="currentColor" opacity="0.35" />
      <rect x="23" y="35" width="9" height="7" rx="1.5" fill="currentColor" opacity="0.55" />
    </svg>
  );
}

function lerUltimoResponsavel(): string {
  try {
    return localStorage.getItem(RESPONSAVEL_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

function salvarUltimoResponsavel(nome: string): void {
  try {
    localStorage.setItem(RESPONSAVEL_STORAGE_KEY, nome);
  } catch {
    // localStorage bloqueado — só perde a conveniência de lembrar o nome, nada mais.
  }
}

/** Reduz a foto (celular tira em 3-8MB) pra um JPEG leve antes de mandar — cabe fácil no limite de 10mb do backend e sobe rápido em rede de galpão. */
async function comprimirFoto(arquivo: File): Promise<string> {
  const bitmap = await createImageBitmap(arquivo);
  const escala = Math.min(1, LADO_MAXIMO_FOTO / Math.max(bitmap.width, bitmap.height));
  const largura = Math.round(bitmap.width * escala);
  const altura = Math.round(bitmap.height * escala);

  const canvas = document.createElement("canvas");
  canvas.width = largura;
  canvas.height = altura;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Não consegui processar essa imagem neste navegador.");
  ctx.drawImage(bitmap, 0, 0, largura, altura);

  return canvas.toDataURL("image/jpeg", 0.82);
}

function FormularioContagem({ modal, onFechar, onSalvo }: { modal: Exclude<Modal, null>; onFechar: () => void; onSalvo: () => void }) {
  const [codigo, setCodigo] = useState("");
  const [quantidade, setQuantidade] = useState(modal.modo === "existente" ? String(modal.ultima.quantidade) : "");
  const [responsavel, setResponsavel] = useState(() => (modal.modo === "existente" ? modal.ultima.responsavel : lerUltimoResponsavel()));
  const [fotoPreview, setFotoPreview] = useState<string | null>(null);
  const [mostrarHistorico, setMostrarHistorico] = useState(false);
  const [historico, setHistorico] = useState<RegistroContagem[] | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const inputFotoRef = useRef<HTMLInputElement>(null);

  const aoEscolherFoto = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const arquivo = event.target.files?.[0];
    if (!arquivo) return;
    try {
      setFotoPreview(await comprimirFoto(arquivo));
    } catch {
      setErro("Não consegui processar essa foto — tenta tirar de novo.");
    }
  }, []);

  const carregarHistorico = useCallback(async () => {
    if (modal.modo !== "existente") return;
    setMostrarHistorico((atual) => !atual);
    if (historico) return;
    try {
      const resposta = await fetch(`${API_URL}/api/estoque/${encodeURIComponent(modal.rua)}/${encodeURIComponent(modal.codigo)}/historico`);
      const json = await resposta.json();
      setHistorico(json.historico ?? []);
    } catch {
      setHistorico([]);
    }
  }, [historico, modal]);

  const salvar = useCallback(async () => {
    const codigoFinal = modal.modo === "existente" ? modal.codigo : codigo.trim();
    if (!codigoFinal) {
      setErro("Informe o código da posição (ex.: A5).");
      return;
    }
    const quantidadeNumero = Number(quantidade);
    if (!quantidade.trim() || !Number.isFinite(quantidadeNumero) || quantidadeNumero < 0) {
      setErro("Informe a quantidade contada (0 ou mais).");
      return;
    }
    if (!responsavel.trim()) {
      setErro("Informe quem fez a contagem.");
      return;
    }
    if (!fotoPreview) {
      setErro("Tire ou escolha uma foto — toda contagem precisa de uma foto própria, mesmo recontagem.");
      return;
    }

    setSalvando(true);
    setErro(null);
    try {
      const resposta = await fetch(`${API_URL}/api/estoque/${encodeURIComponent(modal.rua)}/${encodeURIComponent(codigoFinal)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quantidade: quantidadeNumero, responsavel: responsavel.trim(), fotoDataUri: fotoPreview }),
      });
      const json = await resposta.json();
      if (!resposta.ok) throw new Error(json.error ?? "Não consegui salvar a contagem.");

      salvarUltimoResponsavel(responsavel.trim());
      onSalvo();
    } catch (error) {
      setErro(error instanceof Error ? error.message : "Não consegui salvar a contagem.");
    } finally {
      setSalvando(false);
    }
  }, [codigo, fotoPreview, modal, onSalvo, quantidade, responsavel]);

  // A foto anterior só aparece como referência (pra comparar contra o que tem na posição agora) —
  // nunca é reaproveitada ao salvar: toda contagem exige tirar uma foto nova (ver `salvar`).
  const fotoAnteriorUrl = modal.modo === "existente" ? fotoUrl(modal.ultima.fotoArquivo) : null;

  return (
    <div className="settings-overlay" onClick={onFechar}>
      <div className="settings-panel" onClick={(event) => event.stopPropagation()}>
        <button className="settings-close" onClick={onFechar} aria-label="Fechar">
          ×
        </button>
        <h2 className="settings-title">
          Rua {modal.rua}
          {modal.modo === "existente" ? ` · ${modal.codigo}` : " · nova posição"}
        </h2>

        {modal.modo === "nova" && (
          <label className="field">
            <span className="field-label">Código da posição</span>
            <input className="field-input" value={codigo} onChange={(event) => setCodigo(event.target.value)} placeholder="Ex.: A5" autoFocus />
          </label>
        )}

        <div className="field">
          <span className="field-label">Foto desta contagem</span>
          {fotoPreview ? (
            <img className="estoque-foto-preview" src={fotoPreview} alt="Foto tirada agora" />
          ) : fotoAnteriorUrl ? (
            <>
              <img className="estoque-foto-preview" src={fotoAnteriorUrl} alt="Foto da última contagem" />
              <span className="field-value--muted">Essa é a foto da última contagem — ainda falta tirar uma nova.</span>
            </>
          ) : (
            <div className="estoque-foto-placeholder">Sem foto ainda</div>
          )}
          <input ref={inputFotoRef} type="file" accept="image/*" capture="environment" onChange={aoEscolherFoto} hidden />
          <button type="button" className="refresh-btn" onClick={() => inputFotoRef.current?.click()}>
            {fotoPreview ? "Trocar foto" : "Tirar / escolher foto"}
          </button>
        </div>

        <label className="field">
          <span className="field-label">Quantidade contada</span>
          <input
            className="field-input"
            type="number"
            min={0}
            inputMode="numeric"
            value={quantidade}
            onChange={(event) => setQuantidade(event.target.value)}
            placeholder="0"
          />
        </label>

        <label className="field">
          <span className="field-label">Quem contou</span>
          <input className="field-input" value={responsavel} onChange={(event) => setResponsavel(event.target.value)} placeholder="Seu nome" />
        </label>

        <p className="estoque-em-breve">🔜 Em breve: a IA vai sugerir a contagem pela foto — sempre com você confirmando antes de salvar.</p>

        {erro && <p className="error-banner">{erro}</p>}

        <button className="btn-primario" onClick={() => void salvar()} disabled={salvando}>
          {salvando ? "Salvando..." : "Salvar"}
        </button>

        {modal.modo === "existente" && (
          <>
            <button type="button" className="buscas-recentes-item" onClick={() => void carregarHistorico()}>
              {mostrarHistorico ? "Ocultar histórico" : "Ver histórico"}
            </button>
            {mostrarHistorico && historico && (
              <ul className="estoque-historico">
                {historico.map((item) => (
                  <li key={item.id}>
                    <strong>{item.quantidade}</strong> — {item.responsavel} · {formatarDataHora(item.criadoEm)}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export function Estoque() {
  const [ruas, setRuas] = useState<RuaResumo[]>([]);
  const [ruasExtras, setRuasExtras] = useState<string[]>([]); // ruas criadas na hora, ainda sem nenhuma posição salva
  const [ruaAtiva, setRuaAtiva] = useState<string | null>(null);
  const [adicionandoRua, setAdicionandoRua] = useState(false);
  const [nomeNovaRua, setNomeNovaRua] = useState("");
  const [modal, setModal] = useState<Modal>(null);
  const [erroCarregamento, setErroCarregamento] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      const resposta = await fetch(`${API_URL}/api/estoque`, { cache: "no-store" });
      const json = await resposta.json();
      if (!resposta.ok) throw new Error(json.error ?? "Não consegui carregar o estoque.");
      setRuas(json.ruas ?? []);
      setErroCarregamento(null);
      setRuaAtiva((atual) => atual ?? json.ruas?.[0]?.rua ?? null);
    } catch (error) {
      setErroCarregamento(error instanceof Error ? error.message : "Não consegui carregar o estoque.");
    }
  }, []);

  useEffect(() => {
    const kickoff = setTimeout(() => void carregar(), 0);
    const id = setInterval(() => void carregar(), POLL_MS);
    return () => {
      clearTimeout(kickoff);
      clearInterval(id);
    };
  }, [carregar]);

  const todasAsRuas = [...ruas.map((r) => r.rua), ...ruasExtras.filter((rua) => !ruas.some((r) => r.rua === rua))];
  const posicoesDaRuaAtiva = ruas.find((r) => r.rua === ruaAtiva)?.posicoes ?? [];

  const confirmarNovaRua = useCallback(() => {
    const nome = nomeNovaRua.trim().toUpperCase();
    if (!nome) return;
    setRuasExtras((atuais) => (atuais.includes(nome) ? atuais : [...atuais, nome]));
    setRuaAtiva(nome);
    setNomeNovaRua("");
    setAdicionandoRua(false);
  }, [nomeNovaRua]);

  return (
    <div className="page pagina-formulario pagina-formulario--larga">
      <header className="header">
        <h1 className="title">Estoque</h1>
      </header>

      {erroCarregamento && <p className="error-banner">{erroCarregamento}</p>}

      <div className="estoque-ruas">
        {todasAsRuas.map((rua) => (
          <button
            key={rua}
            className={`nav-corner-item${rua === ruaAtiva ? " nav-corner-item--active" : ""}`}
            onClick={() => setRuaAtiva(rua)}
          >
            Rua {rua}
          </button>
        ))}
        {adicionandoRua ? (
          <span className="estoque-nova-rua">
            <input
              className="field-input"
              autoFocus
              value={nomeNovaRua}
              onChange={(event) => setNomeNovaRua(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && confirmarNovaRua()}
              placeholder="Ex.: D"
            />
            <button className="refresh-btn" onClick={confirmarNovaRua}>
              Ok
            </button>
          </span>
        ) : (
          <button className="nav-corner-item" onClick={() => setAdicionandoRua(true)}>
            + Nova rua
          </button>
        )}
      </div>

      {!ruaAtiva && (
        <div className="estoque-vazio">
          <p className="estoque-vazio-titulo">Nenhuma rua cadastrada ainda</p>
          <p className="field-value--muted">
            Clique em <strong>"+ Nova rua"</strong> acima pra criar a primeira e começar a registrar as posições do
            galpão — rua e posição são criadas na hora, direto daqui, sem precisar configurar nada antes.
          </p>
        </div>
      )}

      {ruaAtiva && (
        <div className="estoque-grid">
          {posicoesDaRuaAtiva.map((posicao) => {
            const url = fotoUrl(posicao.ultima.fotoArquivo);
            return (
              <button
                key={posicao.codigo}
                className="estoque-card"
                onClick={() => setModal({ modo: "existente", rua: posicao.rua, codigo: posicao.codigo, ultima: posicao.ultima })}
              >
                {url ? (
                  <img className="estoque-card-foto" src={url} alt={`Posição ${posicao.codigo}`} />
                ) : (
                  <div className="estoque-card-foto estoque-card-foto--vazia">
                    <IconeGondola className="estoque-card-icone" />
                    <span>Sem foto</span>
                  </div>
                )}
                <span className="estoque-card-codigo">{posicao.codigo}</span>
                <span className="estoque-card-qtd">{posicao.ultima.quantidade} un.</span>
                <span className="estoque-card-meta">
                  {posicao.ultima.responsavel} · {formatarDataHora(posicao.ultima.criadoEm)}
                </span>
              </button>
            );
          })}
          <button className="estoque-card estoque-card--nova" onClick={() => setModal({ modo: "nova", rua: ruaAtiva })}>
            + Nova posição
          </button>
        </div>
      )}

      {modal && (
        <FormularioContagem
          modal={modal}
          onFechar={() => setModal(null)}
          onSalvo={() => {
            setModal(null);
            void carregar();
          }}
        />
      )}
    </div>
  );
}

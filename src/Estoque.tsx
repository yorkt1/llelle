import { useCallback, useEffect, useRef, useState } from "react";

interface RegistroContagem {
  id: string;
  quantidade: number;
  responsavel: string;
  /** URL pública do Cloudinary — nunca um caminho/arquivo local (ver lib/estoque.ts). */
  fotoUrl: string;
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

type Modal =
  | { modo: "existente"; rua: string; codigo: string; ultima: RegistroContagem }
  | { modo: "nova"; rua: string; codigosExistentes: string[] }
  | null;

const API_URL = import.meta.env.VITE_API_URL ?? "";
const POLL_MS = 30_000;
const RESPONSAVEL_STORAGE_KEY = "estoque:ultimoResponsavel";
const LADO_MAXIMO_FOTO = 1600; // px — reduz fotos de celular (3-8MB) pra algo leve de enviar/guardar.
const TOAST_MS = 3_000;

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

const PADRAO_CODIGO = /^[A-Z]+\d+$/;

function validarCodigo(codigo: string): string | null {
  const limpo = codigo.trim();
  if (!limpo) return "Informe o código da posição.";
  if (!PADRAO_CODIGO.test(limpo)) return "Use a letra da rua + número (ex.: H2).";
  return null;
}

function validarQuantidade(quantidade: string): string | null {
  if (!quantidade.trim()) return "Informe a quantidade contada.";
  const numero = Number(quantidade);
  if (!Number.isFinite(numero) || numero < 0) return "Quantidade precisa ser um número maior ou igual a zero.";
  return null;
}

function validarResponsavel(responsavel: string): string | null {
  return responsavel.trim() ? null : "Informe quem fez a contagem.";
}

function validarFoto(fotoPreview: string | null): string | null {
  return fotoPreview ? null : "Tire ou escolha uma foto — toda contagem precisa de uma foto própria.";
}

/** "H" + [H2, H3, H7] → "H8". Sem nenhuma posição ainda na rua, sugere "H1". */
function proximoCodigoSugerido(rua: string, codigosExistentes: string[]): string {
  const numeros = codigosExistentes
    .map((codigo) => codigo.match(/^([A-Z]+)(\d+)$/))
    .filter((m): m is RegExpMatchArray => m !== null && m[1] === rua)
    .map((m) => Number(m[2]));
  const proximo = numeros.length > 0 ? Math.max(...numeros) + 1 : 1;
  return `${rua}${proximo}`;
}

function FormularioContagem({
  modal,
  onFechar,
  onSalvo,
}: {
  modal: Exclude<Modal, null>;
  onFechar: () => void;
  onSalvo: (rua: string, codigo: string) => void;
}) {
  const [codigo, setCodigo] = useState(modal.modo === "nova" ? proximoCodigoSugerido(modal.rua, modal.codigosExistentes) : "");
  const [quantidade, setQuantidade] = useState(modal.modo === "existente" ? String(modal.ultima.quantidade) : "");
  const [responsavel, setResponsavel] = useState(() => (modal.modo === "existente" ? modal.ultima.responsavel : lerUltimoResponsavel()));
  const [fotoPreview, setFotoPreview] = useState<string | null>(null);
  const [mostrarHistorico, setMostrarHistorico] = useState(false);
  const [historico, setHistorico] = useState<RegistroContagem[] | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [tocados, setTocados] = useState<Set<string>>(new Set());
  const [tentouSalvar, setTentouSalvar] = useState(false);
  const inputFotoRef = useRef<HTMLInputElement>(null);
  const codigoRef = useRef<HTMLInputElement>(null);
  const quantidadeRef = useRef<HTMLInputElement>(null);
  const responsavelRef = useRef<HTMLInputElement>(null);
  const fotoBotaoRef = useRef<HTMLButtonElement>(null);

  const tocar = useCallback((campo: string) => {
    setTocados((atual) => {
      if (atual.has(campo)) return atual;
      const copia = new Set(atual);
      copia.add(campo);
      return copia;
    });
  }, []);

  /** Só mostra o erro depois que a pessoa passou por esse campo (ou tentou salvar) — formulário
   * em branco não começa gritando "obrigatório" em tudo de uma vez. */
  const mostrar = useCallback((campo: string, erroCampo: string | null) => (tentouSalvar || tocados.has(campo) ? erroCampo : null), [tentouSalvar, tocados]);

  const erroCodigoFormato = modal.modo === "nova" ? validarCodigo(codigo) : null;
  const erroCodigoDuplicado =
    modal.modo === "nova" && !erroCodigoFormato && modal.codigosExistentes.includes(codigo.trim()) ? "Essa posição já existe nessa rua." : null;
  const erroCodigo = erroCodigoFormato ?? erroCodigoDuplicado;
  const erroQuantidade = validarQuantidade(quantidade);
  const erroResponsavel = validarResponsavel(responsavel);
  const erroFoto = validarFoto(fotoPreview);
  const formularioInvalido = Boolean(erroCodigo || erroQuantidade || erroResponsavel || erroFoto);

  const ajustarQuantidade = useCallback((delta: number) => {
    setQuantidade((atual) => String(Math.max(0, (Number(atual) || 0) + delta)));
  }, []);

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

  const focarPrimeiroErro = useCallback(() => {
    const refAlvo =
      modal.modo === "nova" && erroCodigo
        ? codigoRef.current
        : erroFoto
          ? fotoBotaoRef.current
          : erroQuantidade
            ? quantidadeRef.current
            : erroResponsavel
              ? responsavelRef.current
              : null;
    refAlvo?.scrollIntoView({ behavior: "smooth", block: "center" });
    refAlvo?.focus();
  }, [modal, erroCodigo, erroFoto, erroQuantidade, erroResponsavel]);

  const salvar = useCallback(async () => {
    setTentouSalvar(true);
    if (formularioInvalido) {
      focarPrimeiroErro();
      return;
    }
    const codigoFinal = modal.modo === "existente" ? modal.codigo : codigo.trim();

    setSalvando(true);
    setErro(null);
    try {
      const resposta = await fetch(`${API_URL}/api/estoque/${encodeURIComponent(modal.rua)}/${encodeURIComponent(codigoFinal)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quantidade: Number(quantidade), responsavel: responsavel.trim(), fotoDataUri: fotoPreview }),
      });
      const json = await resposta.json();
      if (!resposta.ok) throw new Error(json.error ?? "Não consegui salvar a contagem.");

      salvarUltimoResponsavel(responsavel.trim());
      onSalvo(modal.rua, codigoFinal);
    } catch (error) {
      setErro(error instanceof Error ? error.message : "Não consegui salvar a contagem.");
    } finally {
      setSalvando(false);
    }
  }, [codigo, fotoPreview, formularioInvalido, focarPrimeiroErro, modal, onSalvo, quantidade, responsavel]);

  // A foto anterior só aparece como referência (pra comparar contra o que tem na posição agora) —
  // nunca é reaproveitada ao salvar: toda contagem exige tirar uma foto nova (ver `salvar`).
  const fotoAnteriorUrl = modal.modo === "existente" ? modal.ultima.fotoUrl : null;

  return (
    <div className="settings-overlay" onClick={onFechar}>
      <div className="settings-panel" onClick={(event) => event.stopPropagation()}>
        <div className="settings-panel-header">
          <button className="settings-close" onClick={onFechar} aria-label="Fechar">
            ×
          </button>
          <h2 className="settings-title">
            Rua {modal.rua}
            {modal.modo === "existente" ? ` · ${modal.codigo}` : " · nova posição"}
          </h2>
        </div>

        <div className="settings-panel-body">
          {modal.modo === "nova" && (
            <label className="field">
              <span className="field-label">
                Código da posição <span className="field-obrigatorio">*</span>
              </span>
              <input
                ref={codigoRef}
                className={`field-input${mostrar("codigo", erroCodigo) ? " field-input--erro" : ""}`}
                value={codigo}
                onChange={(event) => setCodigo(event.target.value.toUpperCase().replace(/\s+/g, ""))}
                onBlur={() => tocar("codigo")}
                placeholder="Ex.: H2"
                autoFocus
              />
              {mostrar("codigo", erroCodigo) && <span className="field-erro">{mostrar("codigo", erroCodigo)}</span>}
            </label>
          )}

          <div className="field">
            <span className="field-label">
              Foto desta contagem <span className="field-obrigatorio">*</span>
            </span>
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
            <button
              ref={fotoBotaoRef}
              type="button"
              className="refresh-btn"
              onClick={() => {
                tocar("foto");
                inputFotoRef.current?.click();
              }}
            >
              {fotoPreview ? "Trocar foto" : "Tirar / escolher foto"}
            </button>
            <p className="estoque-em-breve">🔜 Em breve a IA vai sugerir a contagem a partir dessa foto.</p>
            {mostrar("foto", erroFoto) && <span className="field-erro">{mostrar("foto", erroFoto)}</span>}
          </div>

          <label className="field">
            <span className="field-label">
              Quantidade contada <span className="field-obrigatorio">*</span>
            </span>
            <div className="estoque-qtd-controle">
              <button type="button" className="estoque-qtd-btn" onClick={() => ajustarQuantidade(-1)} aria-label="Diminuir quantidade">
                −
              </button>
              <input
                ref={quantidadeRef}
                className={`field-input${mostrar("quantidade", erroQuantidade) ? " field-input--erro" : ""}`}
                type="number"
                min={0}
                inputMode="numeric"
                value={quantidade}
                onChange={(event) => setQuantidade(event.target.value)}
                onBlur={() => tocar("quantidade")}
                placeholder="Ex.: 48"
              />
              <button type="button" className="estoque-qtd-btn" onClick={() => ajustarQuantidade(1)} aria-label="Aumentar quantidade">
                +
              </button>
              <span className="estoque-qtd-unidade">un.</span>
            </div>
            {mostrar("quantidade", erroQuantidade) && <span className="field-erro">{mostrar("quantidade", erroQuantidade)}</span>}
          </label>

          <label className="field">
            <span className="field-label">
              Quem contou <span className="field-obrigatorio">*</span>
            </span>
            <input
              ref={responsavelRef}
              className={`field-input${mostrar("responsavel", erroResponsavel) ? " field-input--erro" : ""}`}
              value={responsavel}
              onChange={(event) => setResponsavel(event.target.value)}
              onBlur={() => tocar("responsavel")}
              placeholder="Seu nome"
            />
            {mostrar("responsavel", erroResponsavel) && <span className="field-erro">{mostrar("responsavel", erroResponsavel)}</span>}
          </label>

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

        <div className="settings-panel-footer">
          {erro && <p className="error-banner">{erro}</p>}
          <button className="btn-primario" onClick={() => void salvar()} disabled={salvando || (tentouSalvar && formularioInvalido)}>
            {salvando ? "Salvando..." : "Salvar"}
          </button>
        </div>
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
  const [toast, setToast] = useState<string | null>(null);
  const [cardDestacado, setCardDestacado] = useState<string | null>(null);

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

  const aoSalvar = useCallback((rua: string, codigo: string) => {
    setModal(null);
    void carregar();
    setToast(`Posição ${codigo} salva`);
    setCardDestacado(`${rua}::${codigo}`);
    setTimeout(() => setToast(null), TOAST_MS);
    setTimeout(() => setCardDestacado(null), TOAST_MS);
  }, [carregar]);

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
            const url = posicao.ultima.fotoUrl;
            const destacado = cardDestacado === `${posicao.rua}::${posicao.codigo}`;
            return (
              <button
                key={posicao.codigo}
                className={`estoque-card${destacado ? " estoque-card--destacado" : ""}`}
                onClick={() => setModal({ modo: "existente", rua: posicao.rua, codigo: posicao.codigo, ultima: posicao.ultima })}
              >
                {url ? (
                  <img
                    className="estoque-card-foto"
                    src={url}
                    alt={`Posição ${posicao.codigo}`}
                    onError={(event) => {
                      event.currentTarget.style.display = "none";
                      event.currentTarget.nextElementSibling?.classList.remove("estoque-card-foto--oculta");
                    }}
                  />
                ) : null}
                <div className={`estoque-card-foto estoque-card-foto--vazia${url ? " estoque-card-foto--oculta" : ""}`}>
                  <IconeGondola className="estoque-card-icone" />
                  <span>{url ? "Foto indisponível" : "Sem foto"}</span>
                </div>
                <span className="estoque-card-codigo">{posicao.codigo}</span>
                <span className="estoque-card-qtd">{posicao.ultima.quantidade} un.</span>
                <span className="estoque-card-meta">
                  {posicao.ultima.responsavel} · {formatarDataHora(posicao.ultima.criadoEm)}
                </span>
              </button>
            );
          })}
          <button
            className="estoque-card estoque-card--nova"
            onClick={() => setModal({ modo: "nova", rua: ruaAtiva, codigosExistentes: posicoesDaRuaAtiva.map((p) => p.codigo) })}
          >
            + Nova posição
          </button>
        </div>
      )}

      {modal && <FormularioContagem modal={modal} onFechar={() => setModal(null)} onSalvo={aoSalvar} />}

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}

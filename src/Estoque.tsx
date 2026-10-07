import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { PageHeader } from "@/PageHeader";

interface RegistroContagem {
  id: string;
  quantidade: number;
  responsavel: string;
  /** URL pública do Cloudinary — nunca um caminho/arquivo local (ver lib/estoque.ts). */
  fotoUrl: string;
  criadoEm: string;
}

const VOLTAGENS = ["110V", "220V", "Bivolt"] as const;
type Voltagem = (typeof VOLTAGENS)[number];

interface PosicaoResumo {
  rua: string;
  codigo: string;
  ultima: RegistroContagem;
  /** null só pra posição criada antes dessa funcionalidade existir. */
  produto: string | null;
  voltagem: Voltagem | null;
}

interface RuaResumo {
  rua: string;
  posicoes: PosicaoResumo[];
}

type Modal =
  | { modo: "existente"; rua: string; codigo: string; ultima: RegistroContagem; produto: string | null; voltagem: Voltagem | null }
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

function validarProduto(produto: string): string | null {
  return produto.trim() ? null : "Selecione o produto dessa posição.";
}

function validarVoltagem(voltagem: string): string | null {
  return (VOLTAGENS as readonly string[]).includes(voltagem) ? null : "Selecione a voltagem dessa posição.";
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
  produtos,
  onFechar,
  onSalvo,
  onMetadadosSalvos,
}: {
  modal: Exclude<Modal, null>;
  produtos: string[];
  onFechar: () => void;
  onSalvo: (rua: string, codigo: string) => void;
  onMetadadosSalvos: (rua: string, codigo: string, produto: string, voltagem: Voltagem) => void;
}) {
  const [codigo, setCodigo] = useState(modal.modo === "nova" ? proximoCodigoSugerido(modal.rua, modal.codigosExistentes) : "");
  const [quantidade, setQuantidade] = useState(modal.modo === "existente" ? String(modal.ultima.quantidade) : "");
  const [responsavel, setResponsavel] = useState(() => (modal.modo === "existente" ? modal.ultima.responsavel : lerUltimoResponsavel()));
  const [produto, setProduto] = useState("");
  const [voltagem, setVoltagem] = useState("");
  const [fotoPreview, setFotoPreview] = useState<string | null>(null);
  const [mostrarHistorico, setMostrarHistorico] = useState(false);
  const [historico, setHistorico] = useState<RegistroContagem[] | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [tocados, setTocados] = useState<Set<string>>(new Set());
  const [tentouSalvar, setTentouSalvar] = useState(false);

  // Edição de produto/voltagem de uma posição já existente — fica fechado por padrão (os dois
  // normalmente não mudam numa recontagem), só abre se a pessoa pedir pra corrigir.
  const [editandoMetadados, setEditandoMetadados] = useState(false);
  const [produtoEdit, setProdutoEdit] = useState(modal.modo === "existente" ? modal.produto ?? "" : "");
  const [voltagemEdit, setVoltagemEdit] = useState(modal.modo === "existente" ? modal.voltagem ?? "" : "");
  const [salvandoMetadados, setSalvandoMetadados] = useState(false);
  const [erroMetadados, setErroMetadados] = useState<string | null>(null);

  const inputFotoRef = useRef<HTMLInputElement>(null);
  const codigoRef = useRef<HTMLInputElement>(null);
  const produtoRef = useRef<HTMLSelectElement>(null);
  const voltagemRef = useRef<HTMLSelectElement>(null);
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
  const erroProduto = modal.modo === "nova" ? validarProduto(produto) : null;
  const erroVoltagem = modal.modo === "nova" ? validarVoltagem(voltagem) : null;
  const erroQuantidade = validarQuantidade(quantidade);
  const erroResponsavel = validarResponsavel(responsavel);
  const erroFoto = validarFoto(fotoPreview);
  const formularioInvalido = Boolean(erroCodigo || erroProduto || erroVoltagem || erroQuantidade || erroResponsavel || erroFoto);

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
        : modal.modo === "nova" && erroProduto
          ? produtoRef.current
          : modal.modo === "nova" && erroVoltagem
            ? voltagemRef.current
            : erroFoto
              ? fotoBotaoRef.current
              : erroQuantidade
                ? quantidadeRef.current
                : erroResponsavel
                  ? responsavelRef.current
                  : null;
    refAlvo?.scrollIntoView({ behavior: "smooth", block: "center" });
    refAlvo?.focus();
  }, [modal, erroCodigo, erroProduto, erroVoltagem, erroFoto, erroQuantidade, erroResponsavel]);

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
        body: JSON.stringify({
          quantidade: Number(quantidade),
          responsavel: responsavel.trim(),
          fotoDataUri: fotoPreview,
          ...(modal.modo === "nova" ? { produto: produto.trim(), voltagem } : {}),
        }),
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
  }, [codigo, fotoPreview, formularioInvalido, focarPrimeiroErro, modal, onSalvo, produto, quantidade, responsavel, voltagem]);

  const salvarMetadados = useCallback(async () => {
    if (modal.modo !== "existente") return;
    if (!produtoEdit.trim() || !voltagemEdit) {
      setErroMetadados("Selecione produto e voltagem.");
      return;
    }
    setSalvandoMetadados(true);
    setErroMetadados(null);
    try {
      const resposta = await fetch(`${API_URL}/api/estoque/${encodeURIComponent(modal.rua)}/${encodeURIComponent(modal.codigo)}/metadados`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ produto: produtoEdit.trim(), voltagem: voltagemEdit }),
      });
      const json = await resposta.json();
      if (!resposta.ok) throw new Error(json.error ?? "Não consegui salvar produto/voltagem.");

      onMetadadosSalvos(modal.rua, modal.codigo, produtoEdit.trim(), voltagemEdit as Voltagem);
      setEditandoMetadados(false);
    } catch (error) {
      setErroMetadados(error instanceof Error ? error.message : "Não consegui salvar produto/voltagem.");
    } finally {
      setSalvandoMetadados(false);
    }
  }, [modal, produtoEdit, voltagemEdit, onMetadadosSalvos]);

  // A foto anterior só aparece como referência (pra comparar contra o que tem na posição agora) —
  // nunca é reaproveitada ao salvar: toda contagem exige tirar uma foto nova (ver `salvar`).
  const fotoAnteriorUrl = modal.modo === "existente" ? modal.ultima.fotoUrl : null;

  // "Anteriores" exclui a contagem atual (modal.ultima, sempre historico[0]) — já está nos campos
  // do formulário logo acima, repetir ela na lista só confunde quem tá vendo.
  const historicoAnterior = modal.modo === "existente" && historico ? historico.filter((item) => item.id !== modal.ultima.id) : [];

  // Código em destaque pra bater com a etiqueta física da prateleira — só o código da posição
  // (mesmo texto que já aparece no card e, em tese, na etiqueta colada na prateleira), sem juntar
  // com a letra da rua, que já aparece em separado no título do modal. Na posição existente é
  // fixo, numa posição nova acompanha o que a pessoa for digitando.
  const codigoEmDestaque = modal.modo === "existente" ? modal.codigo : codigo.trim() || "?";

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

          {modal.modo === "nova" ? (
            <div className="estoque-produto-voltagem">
              <label className="field">
                <span className="field-label">
                  Produto <span className="field-obrigatorio">*</span>
                </span>
                <select
                  ref={produtoRef}
                  className={`field-input${mostrar("produto", erroProduto) ? " field-input--erro" : ""}`}
                  value={produto}
                  onChange={(event) => setProduto(event.target.value)}
                  onBlur={() => tocar("produto")}
                >
                  <option value="">Selecione…</option>
                  {produtos.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
                {produtos.length === 0 && (
                  <span className="field-value--muted">Nenhum produto cadastrado ainda — use "Configurar produtos" na tela principal.</span>
                )}
                {mostrar("produto", erroProduto) && <span className="field-erro">{mostrar("produto", erroProduto)}</span>}
              </label>
              <label className="field">
                <span className="field-label">
                  Voltagem <span className="field-obrigatorio">*</span>
                </span>
                <select
                  ref={voltagemRef}
                  className={`field-input${mostrar("voltagem", erroVoltagem) ? " field-input--erro" : ""}`}
                  value={voltagem}
                  onChange={(event) => setVoltagem(event.target.value)}
                  onBlur={() => tocar("voltagem")}
                >
                  <option value="">Selecione…</option>
                  {VOLTAGENS.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
                {mostrar("voltagem", erroVoltagem) && <span className="field-erro">{mostrar("voltagem", erroVoltagem)}</span>}
              </label>
            </div>
          ) : (
            <div className="estoque-produto-voltagem-atual">
              {editandoMetadados ? (
                <>
                  <label className="field">
                    <span className="field-label">Produto</span>
                    <select className="field-input" value={produtoEdit} onChange={(event) => setProdutoEdit(event.target.value)}>
                      <option value="">Selecione…</option>
                      {produtos.map((item) => (
                        <option key={item} value={item}>
                          {item}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span className="field-label">Voltagem</span>
                    <select className="field-input" value={voltagemEdit} onChange={(event) => setVoltagemEdit(event.target.value)}>
                      <option value="">Selecione…</option>
                      {VOLTAGENS.map((item) => (
                        <option key={item} value={item}>
                          {item}
                        </option>
                      ))}
                    </select>
                  </label>
                  {erroMetadados && <p className="error-banner">{erroMetadados}</p>}
                  <div className="estoque-produto-voltagem-acoes">
                    <button type="button" className="btn-primario" onClick={() => void salvarMetadados()} disabled={salvandoMetadados}>
                      {salvandoMetadados ? "Salvando..." : "Salvar produto/voltagem"}
                    </button>
                    <button type="button" className="refresh-btn" onClick={() => setEditandoMetadados(false)}>
                      Cancelar
                    </button>
                  </div>
                </>
              ) : (
                <p className="field-value--muted">
                  Produto: <strong>{modal.produto ?? "não definido"}</strong> · Voltagem: <strong>{modal.voltagem ?? "não definida"}</strong>{" "}
                  <button type="button" className="estoque-editar-metadados" onClick={() => setEditandoMetadados(true)}>
                    Editar
                  </button>
                </p>
              )}
            </div>
          )}

          <div className="field">
            <span className="field-label">
              Foto desta contagem <span className="field-obrigatorio">*</span>
            </span>
            <span className="estoque-codigo-destaque">Posição {codigoEmDestaque}</span>
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
                historicoAnterior.length === 0 ? (
                  <p className="field-value--muted">Nenhuma contagem anterior.</p>
                ) : (
                  <ul className="estoque-historico">
                    {historicoAnterior.map((item) => (
                      <li key={item.id} className="estoque-historico-item">
                        <img className="estoque-historico-miniatura" src={item.fotoUrl} alt={`Foto da contagem de ${formatarDataHora(item.criadoEm)}`} />
                        <span>
                          <strong>{item.quantidade}</strong> un. — {item.responsavel} · {formatarDataHora(item.criadoEm)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )
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

  const [produtos, setProdutos] = useState<string[]>([]);
  const [mostrarConfigProdutos, setMostrarConfigProdutos] = useState(false);
  const [novoProduto, setNovoProduto] = useState("");
  const [erroProdutos, setErroProdutos] = useState<string | null>(null);
  const [salvandoProduto, setSalvandoProduto] = useState(false);

  // Filtro/relatório: quando qualquer um dos dois está ativo, a grade deixa de mostrar só a rua
  // selecionada e passa a mostrar as posições de TODAS as ruas que combinam com o filtro.
  const [filtroProduto, setFiltroProduto] = useState("");
  const [filtroVoltagem, setFiltroVoltagem] = useState("");

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

  const carregarProdutos = useCallback(async () => {
    try {
      const resposta = await fetch(`${API_URL}/api/estoque/produtos`, { cache: "no-store" });
      const json = await resposta.json();
      if (resposta.ok) setProdutos(json.produtos ?? []);
    } catch {
      // Catálogo é só pra tela de configuração/criação de posição — uma falha aqui não trava o resto.
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

  useEffect(() => {
    const kickoff = setTimeout(() => void carregarProdutos(), 0);
    return () => clearTimeout(kickoff);
  }, [carregarProdutos]);

  const todasAsRuas = [...ruas.map((r) => r.rua), ...ruasExtras.filter((rua) => !ruas.some((r) => r.rua === rua))];
  const posicoesDaRuaAtiva = ruas.find((r) => r.rua === ruaAtiva)?.posicoes ?? [];

  const filtroAtivo = filtroProduto !== "" || filtroVoltagem !== "";
  const todasAsPosicoes = ruas.flatMap((r) => r.posicoes);
  const posicoesFiltradas = todasAsPosicoes.filter(
    (p) => (!filtroProduto || p.produto === filtroProduto) && (!filtroVoltagem || p.voltagem === filtroVoltagem),
  );
  const posicoesExibidas = filtroAtivo ? posicoesFiltradas : posicoesDaRuaAtiva;
  const totalUnidadesFiltro = posicoesFiltradas.reduce((soma, p) => soma + p.ultima.quantidade, 0);

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

  const aoSalvarMetadados = useCallback(() => {
    setModal(null);
    void carregar();
  }, [carregar]);

  const adicionarProdutoCatalogo = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      const nome = novoProduto.trim();
      if (!nome) return;
      setSalvandoProduto(true);
      setErroProdutos(null);
      try {
        const resposta = await fetch(`${API_URL}/api/estoque/produtos`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nome }),
        });
        const json = await resposta.json();
        if (!resposta.ok) throw new Error(json.error ?? "Não consegui cadastrar o produto.");
        setProdutos(json.produtos ?? []);
        setNovoProduto("");
      } catch (error) {
        setErroProdutos(error instanceof Error ? error.message : "Não consegui cadastrar o produto.");
      } finally {
        setSalvandoProduto(false);
      }
    },
    [novoProduto],
  );

  const removerProdutoCatalogo = useCallback(async (nome: string) => {
    if (!window.confirm(`Remover "${nome}" do catálogo de produtos?`)) return;
    setErroProdutos(null);
    try {
      const resposta = await fetch(`${API_URL}/api/estoque/produtos/${encodeURIComponent(nome)}`, { method: "DELETE" });
      if (!resposta.ok) throw new Error("Não consegui remover esse produto agora.");
      setProdutos((atuais) => atuais.filter((p) => p !== nome));
    } catch (error) {
      setErroProdutos(error instanceof Error ? error.message : "Não consegui remover esse produto agora.");
    }
  }, []);

  return (
    <div className="page pagina-formulario">
      <PageHeader titulo="Estoque">
        <button type="button" className="refresh-btn" onClick={() => setMostrarConfigProdutos((atual) => !atual)}>
          {mostrarConfigProdutos ? "Esconder produtos" : "Configurar produtos"}
        </button>
      </PageHeader>

      {erroCarregamento && <p className="error-banner">{erroCarregamento}</p>}

      {mostrarConfigProdutos && (
        <div className="colab-painel-info estoque-config-produtos">
          <p className="estoque-vazio-titulo">Catálogo de produtos</p>
          <p className="field-value--muted">
            Produtos disponíveis pra escolher ao criar uma posição nova. Remover um produto daqui não afeta posições que já usam ele.
          </p>
          <ul className="estoque-lista-produtos">
            {produtos.length === 0 ? (
              <li className="field-value--muted">Nenhum produto cadastrado ainda.</li>
            ) : (
              produtos.map((nome) => (
                <li key={nome}>
                  <span>{nome}</span>
                  <button type="button" className="refresh-btn refresh-btn--icone" onClick={() => void removerProdutoCatalogo(nome)}>
                    Excluir
                  </button>
                </li>
              ))
            )}
          </ul>
          <form className="estoque-form-produto" onSubmit={adicionarProdutoCatalogo}>
            <label className="field">
              <span className="field-label">Novo produto</span>
              <input
                className="field-input"
                value={novoProduto}
                onChange={(event) => setNovoProduto(event.target.value)}
                placeholder="Ex.: Liquidificador 110V"
              />
            </label>
            <button className="btn-primario" type="submit" disabled={salvandoProduto}>
              {salvandoProduto ? "Salvando..." : "Adicionar"}
            </button>
          </form>
          {erroProdutos && <p className="error-banner">{erroProdutos}</p>}
        </div>
      )}

      <div className="estoque-filtro">
        <label className="field">
          <span className="field-label">Filtrar por produto</span>
          <select className="field-input" value={filtroProduto} onChange={(event) => setFiltroProduto(event.target.value)}>
            <option value="">Todos</option>
            {produtos.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Filtrar por voltagem</span>
          <select className="field-input" value={filtroVoltagem} onChange={(event) => setFiltroVoltagem(event.target.value)}>
            <option value="">Todas</option>
            {VOLTAGENS.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        {filtroAtivo && (
          <button
            type="button"
            className="refresh-btn"
            onClick={() => {
              setFiltroProduto("");
              setFiltroVoltagem("");
            }}
          >
            Limpar filtro
          </button>
        )}
      </div>

      {filtroAtivo && (
        <p className="nota-info">
          {posicoesFiltradas.length} posiç{posicoesFiltradas.length === 1 ? "ão" : "ões"} · {totalUnidadesFiltro} un. no total (todas as ruas)
        </p>
      )}

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
              aria-label="Nova rua"
              value={nomeNovaRua}
              onChange={(event) => setNomeNovaRua(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && confirmarNovaRua()}
              placeholder="Nova rua (ex.: D)"
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
          {posicoesExibidas.map((posicao) => {
            const url = posicao.ultima.fotoUrl;
            const destacado = cardDestacado === `${posicao.rua}::${posicao.codigo}`;
            return (
              <button
                key={`${posicao.rua}::${posicao.codigo}`}
                className={`estoque-card${destacado ? " estoque-card--destacado" : ""}`}
                onClick={() =>
                  setModal({ modo: "existente", rua: posicao.rua, codigo: posicao.codigo, ultima: posicao.ultima, produto: posicao.produto, voltagem: posicao.voltagem })
                }
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
                <span className="estoque-card-codigo">{filtroAtivo ? `${posicao.rua} · ${posicao.codigo}` : posicao.codigo}</span>
                {posicao.produto && (
                  <span className="estoque-card-produto">
                    {posicao.produto} · {posicao.voltagem}
                  </span>
                )}
                <span className="estoque-card-qtd">{posicao.ultima.quantidade} un.</span>
                <span className="estoque-card-meta">
                  {posicao.ultima.responsavel} · {formatarDataHora(posicao.ultima.criadoEm)}
                </span>
              </button>
            );
          })}
          {!filtroAtivo && (
            <button
              className="estoque-card estoque-card--nova"
              onClick={() => setModal({ modo: "nova", rua: ruaAtiva, codigosExistentes: posicoesDaRuaAtiva.map((p) => p.codigo) })}
            >
              + Nova posição
            </button>
          )}
        </div>
      )}

      {modal && (
        <FormularioContagem modal={modal} produtos={produtos} onFechar={() => setModal(null)} onSalvo={aoSalvar} onMetadadosSalvos={aoSalvarMetadados} />
      )}

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}

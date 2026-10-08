import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
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

/** Item da busca no cadastro do Tiny (ver lib/catalogoTiny.ts). */
interface ProdutoTiny {
  sugestao: string;
  nomesTiny: string[];
  codigos: string[];
  idsTiny: string[];
}

interface RuaResumo {
  rua: string;
  posicoes: PosicaoResumo[];
}

type Modal =
  | { modo: "existente"; rua: string; codigo: string; ultima: RegistroContagem; produto: string | null; voltagem: Voltagem | null }
  // Longarina nova: a rua é escolhida no próprio formulário (a tela é por produto, não por rua).
  | { modo: "nova"; ruasExistentes: string[]; codigosPorRua: Record<string, string[]>; produtoInicial?: string }
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
  if (!limpo) return "Informe o código da longarina.";
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
  return produto.trim() ? null : "Selecione o produto dessa longarina.";
}

function validarVoltagem(voltagem: string): string | null {
  return (VOLTAGENS as readonly string[]).includes(voltagem) ? null : "Selecione a voltagem dessa longarina.";
}

/** Valor da opção "Posição vazia" no select de produto — não é um produto do catálogo, nunca vai pro backend. */
const PRODUTO_VAZIA = "__vazia__";

/** "H" +[H2, H3, H7] → "H8". Sem nenhuma posição ainda na rua, sugere "H1". */
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
  onExcluida,
}: {
  modal: Exclude<Modal, null>;
  produtos: string[];
  onFechar: () => void;
  onSalvo: (rua: string, codigo: string) => void;
  onMetadadosSalvos: (rua: string, codigo: string, produto: string, voltagem: Voltagem) => void;
  onExcluida: (rua: string, codigo: string) => void;
}) {
  // Rua: fixa numa longarina existente; numa nova, escolhida aqui (uma das existentes ou uma letra nova).
  const [ruaNova, setRuaNova] = useState(() => (modal.modo === "nova" && modal.ruasExistentes.length === 1 ? modal.ruasExistentes[0] : ""));
  const ruaAtual = modal.modo === "existente" ? modal.rua : ruaNova.trim().toUpperCase();
  const codigosExistentes = modal.modo === "nova" ? modal.codigosPorRua[ruaAtual] ?? [] : [];
  const [codigo, setCodigo] = useState(() => (modal.modo === "nova" && ruaAtual ? proximoCodigoSugerido(ruaAtual, codigosExistentes) : ""));
  const [quantidade, setQuantidade] = useState(modal.modo === "existente" ? String(modal.ultima.quantidade) : "");
  const [responsavel, setResponsavel] = useState(() => (modal.modo === "existente" ? modal.ultima.responsavel : lerUltimoResponsavel()));
  // Posição nova, ou existente que foi registrada vazia (sem produto): escolhe o produto aqui — ou
  // "Posição vazia", que registra 0 un. sem produto nem voltagem.
  const definirProduto = modal.modo === "nova" || !modal.produto;
  const [produto, setProduto] = useState(modal.modo === "existente" ? (modal.produto ? "" : PRODUTO_VAZIA) : (modal.produtoInicial ?? ""));
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

  const erroRua = modal.modo === "nova" ? (!ruaAtual ? "Informe a rua (letra)." : !/^[A-Z]+$/.test(ruaAtual) ? "Rua é só a letra (ex.: F)." : null) : null;
  const erroCodigoFormato = modal.modo === "nova" ? validarCodigo(codigo) : null;
  const erroCodigoDuplicado =
    modal.modo === "nova" && !erroCodigoFormato && codigosExistentes.includes(codigo.trim()) ? "Essa longarina já existe nessa rua." : null;
  const erroCodigo = erroRua ?? erroCodigoFormato ?? erroCodigoDuplicado;
  const vazia = definirProduto && produto === PRODUTO_VAZIA;
  const erroProduto = definirProduto ? validarProduto(produto) : null;
  const erroVoltagem = definirProduto && !vazia ? validarVoltagem(voltagem) : null;
  const erroQuantidade =
    validarQuantidade(quantidade) ??
    (vazia && Number(quantidade) > 0 ? "Longarina vazia fica com 0 un. — pra contar unidades, escolha o produto." : null);
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
        : definirProduto && erroProduto
          ? produtoRef.current
          : definirProduto && erroVoltagem
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
  }, [modal, definirProduto, erroCodigo, erroProduto, erroVoltagem, erroFoto, erroQuantidade, erroResponsavel]);

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
      const resposta = await fetch(`${API_URL}/api/estoque/${encodeURIComponent(ruaAtual)}/${encodeURIComponent(codigoFinal)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quantidade: Number(quantidade),
          responsavel: responsavel.trim(),
          fotoDataUri: fotoPreview,
          ...(definirProduto && !vazia ? { produto: produto.trim(), voltagem } : {}),
        }),
      });
      const json = await resposta.json();
      if (!resposta.ok) throw new Error(json.error ?? "Não consegui salvar a contagem.");

      salvarUltimoResponsavel(responsavel.trim());
      onSalvo(ruaAtual, codigoFinal);
    } catch (error) {
      setErro(error instanceof Error ? error.message : "Não consegui salvar a contagem.");
    } finally {
      setSalvando(false);
    }
  }, [codigo, ruaAtual, definirProduto, fotoPreview, formularioInvalido, focarPrimeiroErro, modal, onSalvo, produto, quantidade, responsavel, vazia, voltagem]);

  const excluirPosicao = useCallback(async () => {
    if (modal.modo !== "existente") return;
    if (!window.confirm(`Excluir a longarina ${modal.codigo} da Rua ${modal.rua}? Ela some da tela (o histórico fica guardado no arquivo de excluídos).`)) return;
    setErro(null);
    try {
      const resposta = await fetch(`${API_URL}/api/estoque/posicao/${encodeURIComponent(modal.rua)}/${encodeURIComponent(modal.codigo)}`, { method: "DELETE" });
      if (!resposta.ok) throw new Error((await resposta.json().catch(() => ({}))).error ?? "Não consegui excluir a longarina.");
      onExcluida(modal.rua, modal.codigo);
    } catch (error) {
      setErro(error instanceof Error ? error.message : "Não consegui excluir a longarina.");
    }
  }, [modal, onExcluida]);

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
            Rua {ruaAtual || "?"}
            {modal.modo === "existente" ? ` · ${modal.codigo}` : " · nova longarina"}
          </h2>
        </div>

        <div className="settings-panel-body">
          {modal.modo === "nova" && (
            <div className="estoque-rua-longarina">
              <label className="field">
                <span className="field-label">
                  Rua <span className="field-obrigatorio">*</span>
                </span>
                <input
                  className={`field-input${mostrar("codigo", erroRua) ? " field-input--erro" : ""}`}
                  list="estoque-ruas-existentes"
                  value={ruaNova}
                  onChange={(event) => {
                    const rua = event.target.value.toUpperCase().replace(/[^A-Z]/g, "");
                    setRuaNova(rua);
                    // Enquanto a pessoa não mexeu no código, ele acompanha a rua (F → próxima longarina livre da F).
                    if (!tocados.has("codigo") && rua) setCodigo(proximoCodigoSugerido(rua, modal.codigosPorRua[rua] ?? []));
                  }}
                  placeholder="Ex.: F"
                  autoFocus
                />
                <datalist id="estoque-ruas-existentes">
                  {modal.ruasExistentes.map((r) => (
                    <option key={r} value={r} />
                  ))}
                </datalist>
              </label>
              <label className="field">
                <span className="field-label">
                  Longarina (etiqueta na viga) <span className="field-obrigatorio">*</span>
                </span>
                <input
                  ref={codigoRef}
                  className={`field-input${mostrar("codigo", erroCodigo) ? " field-input--erro" : ""}`}
                  value={codigo}
                  onChange={(event) => setCodigo(event.target.value.toUpperCase().replace(/\s+/g, ""))}
                  onBlur={() => tocar("codigo")}
                  placeholder="Ex.: F3"
                />
              </label>
              {mostrar("codigo", erroCodigo) && <span className="field-erro estoque-rua-longarina-erro">{mostrar("codigo", erroCodigo)}</span>}
            </div>
          )}

          {definirProduto ? (
            <div className="estoque-produto-voltagem">
              <label className="field">
                <span className="field-label">
                  Produto <span className="field-obrigatorio">*</span>
                </span>
                <select
                  ref={produtoRef}
                  className={`field-input${mostrar("produto", erroProduto) ? " field-input--erro" : ""}`}
                  value={produto}
                  onChange={(event) => {
                    setProduto(event.target.value);
                    if (event.target.value === PRODUTO_VAZIA) {
                      setVoltagem("");
                      setQuantidade("0");
                    }
                  }}
                  onBlur={() => tocar("produto")}
                >
                  <option value="">Selecione…</option>
                  <option value={PRODUTO_VAZIA}>Longarina vazia (sem produto)</option>
                  {produtos.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
                {produtos.length === 0 && !vazia && (
                  <span className="field-value--muted">Nenhum produto cadastrado ainda — use "+ Produto" no topo da tela de Estoque.</span>
                )}
                {mostrar("produto", erroProduto) && <span className="field-erro">{mostrar("produto", erroProduto)}</span>}
              </label>
              {vazia ? (
                <p className="field-value--muted estoque-vazia-nota">
                  Registra a longarina com 0 un., sem produto nem voltagem. Quando chegar mercadoria, é só recontar escolhendo o produto.
                </p>
              ) : (
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
              )}
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
            <span className="estoque-codigo-destaque">Longarina {codigoEmDestaque}</span>
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
              <button type="button" className="estoque-qtd-btn" onClick={() => ajustarQuantidade(-1)} disabled={vazia} aria-label="Diminuir quantidade">
                −
              </button>
              <input
                ref={quantidadeRef}
                className={`field-input${mostrar("quantidade", erroQuantidade) ? " field-input--erro" : ""}`}
                type="number"
                min={0}
                inputMode="numeric"
                disabled={vazia}
                value={quantidade}
                onChange={(event) => setQuantidade(event.target.value)}
                onBlur={() => tocar("quantidade")}
                placeholder="Ex.: 48"
              />
              <button type="button" className="estoque-qtd-btn" onClick={() => ajustarQuantidade(1)} disabled={vazia} aria-label="Aumentar quantidade">
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
          {modal.modo === "existente" && (
            <button type="button" className="btn-perigo-texto" onClick={() => void excluirPosicao()} disabled={salvando}>
              Excluir longarina {modal.codigo}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Catálogo de produtos — antes um painel no topo da tela, agora um modal aberto pelo "+ Produto" do cabeçalho. */
function ModalProdutos({
  produtos,
  info,
  onFechar,
  onAlterado,
}: {
  produtos: string[];
  info: Record<string, InfoProduto>;
  onFechar: () => void;
  onAlterado: (produtos: string[]) => void;
}) {
  const [novoProduto, setNovoProduto] = useState("");
  const [erroProdutos, setErroProdutos] = useState<string | null>(null);
  const [salvandoProduto, setSalvandoProduto] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Cadastro em lote: "tiny" busca no cadastro de produtos do Tiny; "colar" aceita uma lista, um por linha.
  const [modo, setModo] = useState<"lista" | "tiny" | "colar">("lista");
  const [termoTiny, setTermoTiny] = useState("koti");
  const [resultadosTiny, setResultadosTiny] = useState<ProdutoTiny[] | null>(null);
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [buscandoTiny, setBuscandoTiny] = useState(false);
  const [textoColado, setTextoColado] = useState("");
  const [avisoLote, setAvisoLote] = useState<string | null>(null);
  const noCatalogo = useMemo(() => new Set(produtos.map((p) => p.toLowerCase())), [produtos]);

  const buscarNoTiny = useCallback(async () => {
    setBuscandoTiny(true);
    setErroProdutos(null);
    try {
      const resposta = await fetch(`${API_URL}/api/estoque/produtos/tiny?termo=${encodeURIComponent(termoTiny.trim())}`);
      const json = await resposta.json();
      if (!resposta.ok) throw new Error(json.error ?? "Não consegui buscar no Tiny.");
      const lista: ProdutoTiny[] = json.produtos ?? [];
      setResultadosTiny(lista);
      setSelecionados(new Set(lista.map((p) => p.sugestao).filter((nome) => !noCatalogo.has(nome.toLowerCase()))));
    } catch (error) {
      setErroProdutos(error instanceof Error ? error.message : "Não consegui buscar no Tiny.");
    } finally {
      setBuscandoTiny(false);
    }
  }, [termoTiny, noCatalogo]);

  const adicionarEmLote = useCallback(
    async (nomes: string[], itens?: { nome: string; idsTiny: string[]; codigos: string[] }[]) => {
      if (nomes.length === 0) return;
      setSalvandoProduto(true);
      setErroProdutos(null);
      try {
        const resposta = await fetch(`${API_URL}/api/estoque/produtos/lote`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nomes, itens }),
        });
        const json = await resposta.json();
        if (!resposta.ok) throw new Error(json.error ?? "Não consegui cadastrar os produtos.");
        onAlterado(json.produtos ?? []);
        setAvisoLote(`${json.adicionados} produto(s) adicionado(s)${json.adicionados < nomes.length ? ` — ${nomes.length - json.adicionados} já estavam no catálogo` : ""}.`);
        setModo("lista");
        setResultadosTiny(null);
        setTextoColado("");
      } catch (error) {
        setErroProdutos(error instanceof Error ? error.message : "Não consegui cadastrar os produtos.");
      } finally {
        setSalvandoProduto(false);
      }
    },
    [onAlterado],
  );

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
        onAlterado(json.produtos ?? []);
        setNovoProduto("");
      } catch (error) {
        setErroProdutos(error instanceof Error ? error.message : "Não consegui cadastrar o produto.");
      } finally {
        setSalvandoProduto(false);
      }
    },
    [novoProduto, onAlterado],
  );

  const removerProdutoCatalogo = useCallback(
    async (nome: string) => {
      if (!window.confirm(`Remover "${nome}" do catálogo de produtos?`)) return;
      setErroProdutos(null);
      try {
        const resposta = await fetch(`${API_URL}/api/estoque/produtos/${encodeURIComponent(nome)}`, { method: "DELETE" });
        if (!resposta.ok) throw new Error("Não consegui remover esse produto agora.");
        onAlterado(produtos.filter((p) => p !== nome));
      } catch (error) {
        setErroProdutos(error instanceof Error ? error.message : "Não consegui remover esse produto agora.");
      }
    },
    [onAlterado, produtos],
  );

  return (
    <div className="settings-overlay" onClick={onFechar}>
      <div className={`settings-panel${modo === "lista" ? "" : " settings-panel--largo"}`} onClick={(event) => event.stopPropagation()}>
        <div className="settings-panel-header">
          <button className="settings-close" onClick={onFechar} aria-label="Fechar">
            ×
          </button>
          <h2 className="settings-title">Produtos</h2>
          <p className="settings-hint">
            Produtos disponíveis pra escolher ao criar uma posição nova. Remover um produto daqui não afeta posições que já usam ele.
          </p>
        </div>

        <div className="settings-panel-body">
          <div className="abas" role="tablist" aria-label="Como cadastrar">
            {(
              [
                ["lista", "Um por um"],
                ["tiny", "Buscar no Tiny"],
                ["colar", "Colar uma lista"],
              ] as const
            ).map(([valor, rotulo]) => (
              <button
                key={valor}
                type="button"
                role="tab"
                aria-selected={modo === valor}
                className={`aba${modo === valor ? " aba--ativa" : ""}`}
                onClick={() => {
                  setModo(valor);
                  setAvisoLote(null);
                  setErroProdutos(null);
                }}
              >
                {rotulo}
              </button>
            ))}
          </div>

          {avisoLote && <p className="aviso-sucesso">{avisoLote}</p>}

          {modo === "tiny" && (
            <>
              <p className="field-value--muted">
                Busca no cadastro de produtos do Tiny (só ativos) e sugere o nome sem a voltagem — a voltagem é escolhida em cada posição. Variações
                110V/220V do mesmo produto viram um item só.
              </p>
              <form
                className="estoque-form-produto"
                onSubmit={(event) => {
                  event.preventDefault();
                  void buscarNoTiny();
                }}
              >
                <label className="field">
                  <span className="field-label">Palavra pra buscar no Tiny</span>
                  <input className="field-input" value={termoTiny} onChange={(event) => setTermoTiny(event.target.value)} placeholder="Ex.: koti, chaleira, air fryer" />
                </label>
                <button className="btn-primario" type="submit" disabled={buscandoTiny || !termoTiny.trim()}>
                  {buscandoTiny ? "Buscando..." : "Buscar"}
                </button>
              </form>
              {erroProdutos && <p className="error-banner">{erroProdutos}</p>}
              {resultadosTiny &&
                (resultadosTiny.length === 0 ? (
                  <p className="field-value--muted">Nenhum produto ativo no Tiny com "{termoTiny}".</p>
                ) : (
                  <>
                    <div className="lote-acoes">
                      <span className="field-value--muted">
                        {resultadosTiny.length} encontrado(s) · {selecionados.size} selecionado(s)
                      </span>
                      <button
                        type="button"
                        className="refresh-btn"
                        onClick={() =>
                          setSelecionados(
                            selecionados.size > 0 ? new Set() : new Set(resultadosTiny.map((p) => p.sugestao).filter((n) => !noCatalogo.has(n.toLowerCase()))),
                          )
                        }
                      >
                        {selecionados.size > 0 ? "Desmarcar todos" : "Marcar todos"}
                      </button>
                    </div>
                    <ul className="lote-lista">
                      {resultadosTiny.map((p) => {
                        const jaTem = noCatalogo.has(p.sugestao.toLowerCase());
                        return (
                          <li key={p.sugestao}>
                            <label className={`lote-item${jaTem ? " lote-item--desabilitado" : ""}`}>
                              <input
                                type="checkbox"
                                disabled={jaTem}
                                checked={jaTem || selecionados.has(p.sugestao)}
                                onChange={(event) => {
                                  const novo = new Set(selecionados);
                                  if (event.target.checked) novo.add(p.sugestao);
                                  else novo.delete(p.sugestao);
                                  setSelecionados(novo);
                                }}
                              />
                              <span>
                                {p.sugestao}
                                <span className="field-value--muted">
                                  {jaTem ? " · já no catálogo" : p.nomesTiny.length > 1 ? ` · ${p.nomesTiny.length} variações no Tiny` : ""}
                                  {p.codigos.length > 0 ? ` · ${p.codigos.slice(0, 3).join(", ")}${p.codigos.length > 3 ? "…" : ""}` : ""}
                                </span>
                              </span>
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                    <button className="btn-primario" type="button" disabled={salvandoProduto || selecionados.size === 0} onClick={() =>
                        void adicionarEmLote(
                          [...selecionados],
                          resultadosTiny.filter((p) => selecionados.has(p.sugestao)).map((p) => ({ nome: p.sugestao, idsTiny: p.idsTiny, codigos: p.codigos })),
                        )
                      }>
                      {salvandoProduto ? "Salvando..." : `Adicionar ${selecionados.size} ao catálogo`}
                    </button>
                  </>
                ))}
            </>
          )}

          {modo === "colar" && (
            <>
              <label className="field">
                <span className="field-label">Um produto por linha</span>
                <textarea
                  className="field-input importar-textarea"
                  value={textoColado}
                  onChange={(event) => setTextoColado(event.target.value)}
                  placeholder={"Chaleira Koti Modern Preta\nAir Fryer Koti 4L\nSanduicheira Koti"}
                  autoFocus
                />
              </label>
              {erroProdutos && <p className="error-banner">{erroProdutos}</p>}
              <button
                className="btn-primario"
                type="button"
                disabled={salvandoProduto || !textoColado.trim()}
                onClick={() => void adicionarEmLote(textoColado.split(/\r?\n/).map((l) => l.trim()).filter(Boolean))}
              >
                {salvandoProduto ? "Salvando..." : "Adicionar ao catálogo"}
              </button>
            </>
          )}

          {modo === "lista" && (
          <>
          <form className="estoque-form-produto" onSubmit={adicionarProdutoCatalogo}>
            <label className="field">
              <span className="field-label">Novo produto</span>
              <input
                ref={inputRef}
                className="field-input"
                value={novoProduto}
                onChange={(event) => setNovoProduto(event.target.value)}
                placeholder="Ex.: Liquidificador 110V"
                autoFocus
              />
            </label>
            <button className="btn-primario" type="submit" disabled={salvandoProduto || !novoProduto.trim()}>
              {salvandoProduto ? "Salvando..." : "Adicionar"}
            </button>
          </form>
          {erroProdutos && <p className="error-banner">{erroProdutos}</p>}

          {produtos.length === 0 ? (
            <div className="estado-vazio estado-vazio--compacto">
              <p className="estado-vazio-titulo">Nenhum produto cadastrado.</p>
              <button type="button" className="btn-primario" onClick={() => inputRef.current?.focus()}>
                + Adicionar produto
              </button>
            </div>
          ) : (
            <ul className="estoque-lista-produtos">
              {produtos.map((nome) => (
                <li key={nome}>
                  <span className="catalogo-item">
                    {info[chaveDoProduto(nome)]?.fotoUrl ? (
                      <img className="catalogo-miniatura" src={info[chaveDoProduto(nome)]?.fotoUrl} alt="" loading="lazy" />
                    ) : (
                      <span className="catalogo-miniatura catalogo-miniatura--vazia" aria-hidden="true" />
                    )}
                    {nome}
                  </span>
                  <button type="button" className="refresh-btn" onClick={() => void removerProdutoCatalogo(nome)}>
                    Excluir
                  </button>
                </li>
              ))}
            </ul>
          )}
          </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Ainda não existe regra de negócio pra "estoque baixo" — com null o aviso fica desligado. Pra
 * ativar, troque por um número de unidades (ex.: 10): produto com 1..N un. no total ganha o selo
 * "Estoque baixo" no card.
 */
const LIMITE_ESTOQUE_BAIXO = null as number | null;

interface InfoProduto {
  fotoUrl?: string;
  fotoStatus?: "pendente" | "ok" | "sem-foto" | "nao-encontrado" | "erro";
}

/** Um produto e todas as longarinas onde ele está. */
interface GrupoProduto {
  chave: string;
  nome: string;
  noCatalogo: boolean;
  info?: InfoProduto;
  total: number;
  longarinas: PosicaoResumo[];
  porVoltagem: { voltagem: string; quantidade: number }[];
  ultimaContagem: string | null;
}

type Ordem = "nome" | "unidades";

function chaveDoProduto(nome: string): string {
  return nome.trim().replace(/\s+/g, " ").toLowerCase();
}

function normalizar(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function ordenarLongarinas(a: PosicaoResumo, b: PosicaoResumo): number {
  return a.rua.localeCompare(b.rua, "pt-BR") || a.codigo.localeCompare(b.codigo, "pt-BR", { numeric: true });
}

function IconeBusca({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

function CardResumo({ rotulo, valor, detalhe, tom }: { rotulo: string; valor: string | number; detalhe: string; tom: string }) {
  return (
    <div className={`resumo-card resumo-card--${tom}`}>
      <span className="resumo-card-rotulo">{rotulo}</span>
      <span className="resumo-card-valor tabular">{valor}</span>
      <span className="resumo-card-detalhe">{detalhe}</span>
    </div>
  );
}

/** Foto do produto (Cloudinary). Sem foto, ou se o link falhar, mostra o ícone da estante. */
function FotoProduto({ info, nome, className }: { info?: InfoProduto; nome: string; className: string }) {
  const [falhou, setFalhou] = useState(false);
  if (info?.fotoUrl && !falhou) {
    return <img className={className} src={info.fotoUrl} alt={nome} loading="lazy" onError={() => setFalhou(true)} />;
  }
  return (
    <div className={`${className} produto-foto--vazia`}>
      <IconeGondola className="estoque-card-icone" />
      <span>{info?.fotoStatus === "pendente" ? "Buscando foto…" : "Sem foto"}</span>
    </div>
  );
}

function ModalProduto({
  grupo,
  onFechar,
  onAbrirLongarina,
  onNovaLongarina,
}: {
  grupo: GrupoProduto;
  onFechar: () => void;
  onAbrirLongarina: (posicao: PosicaoResumo) => void;
  onNovaLongarina: (produto: string) => void;
}) {
  return (
    <div className="settings-overlay" onClick={onFechar}>
      <div className="settings-panel settings-panel--largo" onClick={(event) => event.stopPropagation()}>
        <div className="settings-panel-header produto-detalhe-cabecalho">
          <button className="settings-close" onClick={onFechar} aria-label="Fechar">
            ×
          </button>
          <FotoProduto info={grupo.info} nome={grupo.nome} className="produto-detalhe-foto" />
          <div className="produto-detalhe-texto">
            <h2 className="settings-title">{grupo.nome}</h2>
            <p className="produto-detalhe-total tabular">{grupo.total} un.</p>
            <p className="settings-hint">
              {grupo.longarinas.length === 0
                ? "Não está em nenhuma longarina."
                : `Em ${grupo.longarinas.length} longarina(s)${grupo.porVoltagem.length > 0 ? " · " + grupo.porVoltagem.map((v) => `${v.voltagem}: ${v.quantidade}`).join(" · ") : ""}`}
            </p>
          </div>
        </div>
        <div className="settings-panel-body">
          {grupo.longarinas.length > 0 && (
            <div className="tabela-wrap tabela-wrap--plana">
              <table className="tabela tabela--clicavel">
                <thead>
                  <tr>
                    <th>Rua</th>
                    <th>Longarina</th>
                    <th>Voltagem</th>
                    <th className="tabela-num">Qtd</th>
                    <th>Contado por</th>
                    <th>Atualizado</th>
                  </tr>
                </thead>
                <tbody>
                  {grupo.longarinas.map((l) => (
                    <tr
                      key={`${l.rua}::${l.codigo}`}
                      tabIndex={0}
                      onClick={() => onAbrirLongarina(l)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          onAbrirLongarina(l);
                        }
                      }}
                      aria-label={`Contar a longarina ${l.codigo}`}
                    >
                      <td>{l.rua}</td>
                      <td>
                        <strong>{l.codigo}</strong>
                      </td>
                      <td>{l.voltagem ?? "—"}</td>
                      <td className="tabela-num tabular">{l.ultima.quantidade}</td>
                      <td>{l.ultima.responsavel}</td>
                      <td className="tabular">{formatarDataHora(l.ultima.criadoEm)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="field-value--muted">Clique numa longarina pra fazer uma nova contagem (com foto) ou corrigir produto/voltagem.</p>
        </div>
        <div className="settings-panel-footer">
          <button type="button" className="btn-primario" onClick={() => onNovaLongarina(grupo.nome)}>
            + Colocar em outra longarina
          </button>
        </div>
      </div>
    </div>
  );
}

function ModalRuas({ ruas, onFechar, onExcluir }: { ruas: RuaResumo[]; onFechar: () => void; onExcluir: (rua: string) => void }) {
  return (
    <div className="settings-overlay" onClick={onFechar}>
      <div className="settings-panel" onClick={(event) => event.stopPropagation()}>
        <div className="settings-panel-header">
          <button className="settings-close" onClick={onFechar} aria-label="Fechar">
            ×
          </button>
          <h2 className="settings-title">Ruas</h2>
          <p className="settings-hint">Uma rua aparece aqui assim que tem pelo menos uma longarina registrada. Pra criar uma rua nova, é só usar "+ Longarina" com a letra nova.</p>
        </div>
        <div className="settings-panel-body">
          {ruas.length === 0 ? (
            <p className="field-value--muted">Nenhuma rua ainda.</p>
          ) : (
            <ul className="estoque-lista-produtos">
              {ruas.map((r) => (
                <li key={r.rua}>
                  <span>
                    <strong>Rua {r.rua}</strong>
                    <span className="field-value--muted">
                      {" "}
                      · {r.posicoes.length} longarina(s) · {r.posicoes.reduce((s, p) => s + p.ultima.quantidade, 0)} un.
                    </span>
                  </span>
                  <button type="button" className="btn-perigo-texto" onClick={() => onExcluir(r.rua)}>
                    Excluir
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

export function Estoque() {
  const [ruas, setRuas] = useState<RuaResumo[]>([]);
  const [produtos, setProdutos] = useState<string[]>([]);
  const [info, setInfo] = useState<Record<string, InfoProduto>>({});
  const [modal, setModal] = useState<Modal>(null);
  const [carregou, setCarregou] = useState(false);
  const [erroCarregamento, setErroCarregamento] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const [mostrarModalProdutos, setMostrarModalProdutos] = useState(false);
  const [mostrarRuas, setMostrarRuas] = useState(false);
  const [produtoAberto, setProdutoAberto] = useState<string | null>(null);

  const [busca, setBusca] = useState("");
  const [filtroVoltagem, setFiltroVoltagem] = useState("");
  const [ordem, setOrdem] = useState<Ordem>("nome");
  const [soComEstoque, setSoComEstoque] = useState(false);

  // Excluir rua: confirmação digitando o nome da rua (apaga todas as longarinas dela de uma vez).
  const [excluindoRua, setExcluindoRua] = useState<string | null>(null);
  const [confirmacaoRua, setConfirmacaoRua] = useState("");
  const [erroExcluirRua, setErroExcluirRua] = useState<string | null>(null);
  const [excluindo, setExcluindo] = useState(false);

  const mostrarToast = useCallback((texto: string) => {
    setToast(texto);
    setTimeout(() => setToast(null), TOAST_MS);
  }, []);

  const carregar = useCallback(async () => {
    try {
      const resposta = await fetch(`${API_URL}/api/estoque`, { cache: "no-store" });
      const json = await resposta.json();
      if (!resposta.ok) throw new Error(json.error ?? "Não consegui carregar o estoque.");
      setRuas(json.ruas ?? []);
      setErroCarregamento(null);
    } catch (error) {
      setErroCarregamento(error instanceof Error ? error.message : "Não consegui carregar o estoque.");
    } finally {
      setCarregou(true);
    }
  }, []);

  const carregarProdutos = useCallback(async () => {
    try {
      const resposta = await fetch(`${API_URL}/api/estoque/produtos`, { cache: "no-store" });
      const json = await resposta.json();
      if (resposta.ok) {
        setProdutos(json.produtos ?? []);
        setInfo(json.info ?? {});
      }
    } catch {
      // Catálogo/fotos não travam a tela — os cards aparecem a partir das longarinas mesmo assim.
    }
  }, []);

  useEffect(() => {
    const kickoff = setTimeout(() => {
      void carregar();
      void carregarProdutos();
    }, 0);
    const id = setInterval(() => {
      void carregar();
      void carregarProdutos(); // as fotos chegam aos poucos, em segundo plano
    }, POLL_MS);
    return () => {
      clearTimeout(kickoff);
      clearInterval(id);
    };
  }, [carregar, carregarProdutos]);

  const todasAsLongarinas = useMemo(() => ruas.flatMap((r) => r.posicoes), [ruas]);
  const longarinasVazias = todasAsLongarinas.filter((p) => !p.produto).sort(ordenarLongarinas);

  const grupos = useMemo<GrupoProduto[]>(() => {
    const mapa = new Map<string, GrupoProduto>();
    const garantir = (nome: string, noCatalogo: boolean) => {
      const chave = chaveDoProduto(nome);
      const existente = mapa.get(chave);
      if (existente) {
        if (noCatalogo) existente.noCatalogo = true;
        return existente;
      }
      const novo: GrupoProduto = { chave, nome, noCatalogo, info: info[chave], total: 0, longarinas: [], porVoltagem: [], ultimaContagem: null };
      mapa.set(chave, novo);
      return novo;
    };
    for (const nome of produtos) garantir(nome, true);
    for (const p of todasAsLongarinas) {
      if (!p.produto) continue;
      const grupo = garantir(p.produto, false);
      grupo.longarinas.push(p);
      grupo.total += p.ultima.quantidade;
      if (!grupo.ultimaContagem || p.ultima.criadoEm > grupo.ultimaContagem) grupo.ultimaContagem = p.ultima.criadoEm;
    }
    for (const grupo of mapa.values()) {
      grupo.longarinas.sort(ordenarLongarinas);
      const porVoltagem = new Map<string, number>();
      for (const l of grupo.longarinas) if (l.voltagem) porVoltagem.set(l.voltagem, (porVoltagem.get(l.voltagem) ?? 0) + l.ultima.quantidade);
      grupo.porVoltagem = [...porVoltagem.entries()].map(([voltagem, quantidade]) => ({ voltagem, quantidade }));
    }
    return [...mapa.values()];
  }, [produtos, todasAsLongarinas, info]);

  const termo = normalizar(busca.trim());
  const gruposExibidos = grupos
    .filter((g) => !soComEstoque || g.total > 0)
    .filter((g) => !filtroVoltagem || g.longarinas.some((l) => l.voltagem === filtroVoltagem))
    .filter(
      (g) =>
        !termo ||
        normalizar(g.nome).includes(termo) ||
        g.longarinas.some((l) => normalizar(`${l.codigo} rua ${l.rua} ${l.rua}${l.codigo}`).includes(termo)),
    )
    .sort((a, b) => (ordem === "unidades" ? b.total - a.total : 0) || a.nome.localeCompare(b.nome, "pt-BR"));

  const totalUnidades = todasAsLongarinas.reduce((s, p) => s + p.ultima.quantidade, 0);
  const ocupadas = todasAsLongarinas.filter((p) => p.ultima.quantidade > 0).length;
  const semFoto = grupos.filter((g) => g.noCatalogo && !g.info?.fotoUrl).length;
  const buscandoFotos = grupos.some((g) => g.info?.fotoStatus === "pendente");
  const grupoAberto = produtoAberto ? grupos.find((g) => g.chave === produtoAberto) ?? null : null;

  const codigosPorRua = useMemo(() => Object.fromEntries(ruas.map((r) => [r.rua, r.posicoes.map((p) => p.codigo)])), [ruas]);

  const abrirNovaLongarina = useCallback(
    (produtoInicial?: string) => {
      setProdutoAberto(null);
      setModal({ modo: "nova", ruasExistentes: ruas.map((r) => r.rua), codigosPorRua, produtoInicial });
    },
    [ruas, codigosPorRua],
  );

  const abrirLongarina = useCallback((p: PosicaoResumo) => {
    setProdutoAberto(null);
    setModal({ modo: "existente", rua: p.rua, codigo: p.codigo, ultima: p.ultima, produto: p.produto, voltagem: p.voltagem });
  }, []);

  const aoSalvar = useCallback(
    (_rua: string, codigo: string) => {
      setModal(null);
      void carregar();
      mostrarToast(`Longarina ${codigo} salva`);
    },
    [carregar, mostrarToast],
  );

  const aoSalvarMetadados = useCallback(() => {
    setModal(null);
    void carregar();
  }, [carregar]);

  const aoExcluirLongarina = useCallback(
    (_rua: string, codigo: string) => {
      setModal(null);
      void carregar();
      mostrarToast(`Longarina ${codigo} excluída`);
    },
    [carregar, mostrarToast],
  );

  const buscarFotos = useCallback(async () => {
    try {
      const resposta = await fetch(`${API_URL}/api/estoque/produtos/fotos/buscar`, { method: "POST" });
      const json = await resposta.json();
      if (!resposta.ok) throw new Error(json.error ?? "falhou");
      mostrarToast(json.pendentes > 0 ? `Buscando ${json.pendentes} foto(s) no Tiny — aparecem aos poucos` : "Todos os produtos já têm foto");
      void carregarProdutos();
    } catch {
      mostrarToast("Não consegui pedir as fotos agora");
    }
  }, [carregarProdutos, mostrarToast]);

  const confirmarExclusaoRua = useCallback(async () => {
    if (!excluindoRua) return;
    setExcluindo(true);
    setErroExcluirRua(null);
    try {
      const resposta = await fetch(`${API_URL}/api/estoque/rua/${encodeURIComponent(excluindoRua)}`, { method: "DELETE" });
      const json = await resposta.json();
      if (!resposta.ok) throw new Error(json.error ?? "Não consegui excluir a rua.");
      mostrarToast(`Rua ${excluindoRua} excluída (${json.posicoesExcluidas ?? 0} longarina(s))`);
      setExcluindoRua(null);
      setConfirmacaoRua("");
      void carregar();
    } catch (error) {
      setErroExcluirRua(error instanceof Error ? error.message : "Não consegui excluir a rua.");
    } finally {
      setExcluindo(false);
    }
  }, [carregar, excluindoRua, mostrarToast]);

  const filtroAtivo = termo !== "" || filtroVoltagem !== "" || soComEstoque;

  return (
    <div className="page pagina-formulario">
      <PageHeader titulo="Estoque" subtitulo="Onde está cada produto no galpão — rua e longarina">
        <button type="button" className="refresh-btn" onClick={() => setMostrarModalProdutos(true)}>
          + Produto
        </button>
        <button type="button" className="refresh-btn" onClick={() => setMostrarRuas(true)}>
          Ruas
        </button>
        <button type="button" className="btn-primario" onClick={() => abrirNovaLongarina()}>
          + Longarina
        </button>
      </PageHeader>

      {erroCarregamento && <p className="error-banner">{erroCarregamento}</p>}

      <section className="resumo-grid" aria-label="Resumo do estoque">
        <CardResumo rotulo="Produtos" valor={grupos.length} detalhe={`${grupos.filter((g) => g.total > 0).length} com estoque`} tom="marca" />
        <CardResumo rotulo="Unidades no galpão" valor={totalUnidades} detalhe="soma da última contagem de cada longarina" tom="ocupada" />
        <CardResumo rotulo="Longarinas ocupadas" valor={ocupadas} detalhe={`de ${todasAsLongarinas.length} registradas em ${ruas.length} rua(s)`} tom="vazia" />
        <CardResumo rotulo="Longarinas vazias" valor={longarinasVazias.length} detalhe="sem produto" tom="baixo" />
      </section>

      <div className="filtro-barra" role="search">
        <label className="filtro-busca">
          <IconeBusca className="filtro-busca-icone" />
          <input
            className="field-input"
            type="search"
            aria-label="Buscar produto ou longarina"
            value={busca}
            onChange={(event) => setBusca(event.target.value)}
            placeholder="Buscar produto, rua ou longarina (ex.: F3)"
          />
        </label>
        <select className="field-input" aria-label="Filtrar por voltagem" value={filtroVoltagem} onChange={(event) => setFiltroVoltagem(event.target.value)}>
          <option value="">Todas as voltagens</option>
          {VOLTAGENS.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        <select className="field-input" aria-label="Ordenar" value={ordem} onChange={(event) => setOrdem(event.target.value as Ordem)}>
          <option value="nome">Ordem: nome</option>
          <option value="unidades">Ordem: mais unidades</option>
        </select>
        <label className="filtro-check">
          <input type="checkbox" checked={soComEstoque} onChange={(event) => setSoComEstoque(event.target.checked)} />
          Só com estoque
        </label>
        {semFoto > 0 && (
          <button type="button" className="refresh-btn filtro-acao" onClick={() => void buscarFotos()} disabled={buscandoFotos}>
            {buscandoFotos ? "Buscando fotos…" : `Buscar fotos no Tiny (${semFoto})`}
          </button>
        )}
      </div>

      {!carregou ? (
        <p className="nota-info">Carregando estoque…</p>
      ) : grupos.length === 0 ? (
        <div className="estado-vazio">
          <IconeGondola className="estado-vazio-icone" />
          <p className="estado-vazio-titulo">Nenhum produto cadastrado ainda.</p>
          <p className="field-value--muted">Comece trazendo os produtos do Tiny (já com foto) — depois é só dizer em que longarina cada um está.</p>
          <button type="button" className="btn-primario" onClick={() => setMostrarModalProdutos(true)}>
            + Adicionar produtos
          </button>
        </div>
      ) : gruposExibidos.length === 0 ? (
        <div className="estado-vazio estado-vazio--compacto">
          <p className="estado-vazio-titulo">Nenhum produto com esses filtros.</p>
          {filtroAtivo && (
            <button
              type="button"
              className="refresh-btn"
              onClick={() => {
                setBusca("");
                setFiltroVoltagem("");
                setSoComEstoque(false);
              }}
            >
              Limpar filtros
            </button>
          )}
        </div>
      ) : (
        <div className="produtos-grid">
          {gruposExibidos.map((g) => {
            const baixo = LIMITE_ESTOQUE_BAIXO !== null && g.total > 0 && g.total <= LIMITE_ESTOQUE_BAIXO;
            return (
              <button key={g.chave} type="button" className={`produto-card${g.total === 0 ? " produto-card--sem-estoque" : ""}`} onClick={() => setProdutoAberto(g.chave)}>
                <FotoProduto info={g.info} nome={g.nome} className="produto-card-foto" />
                <span className="produto-card-corpo">
                  <span className="produto-card-nome">{g.nome}</span>
                  <span className="produto-card-linha">
                    <span className="produto-card-total tabular">{g.total} un.</span>
                    {g.total === 0 ? (
                      <span className="estado-chip estado-chip--vazia">Sem estoque</span>
                    ) : baixo ? (
                      <span className="estado-chip estado-chip--baixo">Estoque baixo</span>
                    ) : null}
                  </span>
                  {g.porVoltagem.length > 0 && (
                    <span className="produto-card-meta">{g.porVoltagem.map((v) => `${v.voltagem}: ${v.quantidade}`).join(" · ")}</span>
                  )}
                  {g.longarinas.length === 0 ? (
                    <span className="produto-card-meta">Não está em nenhuma longarina</span>
                  ) : (
                    <span className="produto-card-locais" aria-label="Onde está">
                      {g.longarinas.slice(0, 4).map((l) => (
                        <span key={`${l.rua}::${l.codigo}`} className="local-chip" title={`Rua ${l.rua} · longarina ${l.codigo} · ${l.ultima.quantidade} un.`}>
                          {l.codigo}
                          <span className="local-chip-qtd tabular">{l.ultima.quantidade}</span>
                        </span>
                      ))}
                      {g.longarinas.length > 4 && <span className="local-chip local-chip--mais">+{g.longarinas.length - 4}</span>}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {longarinasVazias.length > 0 && (
        <section className="painel-card">
          <h2 className="painel-card-titulo">Longarinas vazias ({longarinasVazias.length})</h2>
          <div className="produto-card-locais">
            {longarinasVazias.map((l) => (
              <button key={`${l.rua}::${l.codigo}`} type="button" className="local-chip local-chip--botao" onClick={() => abrirLongarina(l)} title={`Rua ${l.rua} · contar / colocar produto`}>
                {l.codigo}
              </button>
            ))}
          </div>
        </section>
      )}

      {grupoAberto && (
        <ModalProduto grupo={grupoAberto} onFechar={() => setProdutoAberto(null)} onAbrirLongarina={abrirLongarina} onNovaLongarina={abrirNovaLongarina} />
      )}

      {mostrarRuas && (
        <ModalRuas
          ruas={ruas}
          onFechar={() => setMostrarRuas(false)}
          onExcluir={(rua) => {
            setMostrarRuas(false);
            setExcluindoRua(rua);
            setConfirmacaoRua("");
            setErroExcluirRua(null);
          }}
        />
      )}

      {excluindoRua && (
        <div className="settings-overlay" onClick={() => setExcluindoRua(null)}>
          <div className="settings-panel" onClick={(event) => event.stopPropagation()}>
            <div className="settings-panel-header">
              <button className="settings-close" onClick={() => setExcluindoRua(null)} aria-label="Fechar">
                ×
              </button>
              <h2 className="settings-title">Excluir Rua {excluindoRua}?</h2>
            </div>
            <div className="settings-panel-body">
              <p className="field-value">
                As <strong>{ruas.find((r) => r.rua === excluindoRua)?.posicoes.length ?? 0} longarina(s)</strong> dessa rua somem da tela, com o histórico de
                contagens. Nada é apagado de vez: fica guardado num arquivo de excluídos e dá pra recuperar se precisar.
              </p>
              <label className="field">
                <span className="field-label">
                  Pra confirmar, digite <strong>{excluindoRua}</strong>
                </span>
                <input className="field-input" value={confirmacaoRua} onChange={(event) => setConfirmacaoRua(event.target.value)} autoFocus />
              </label>
            </div>
            <div className="settings-panel-footer">
              {erroExcluirRua && <p className="error-banner">{erroExcluirRua}</p>}
              <button
                type="button"
                className="btn-perigo"
                disabled={excluindo || confirmacaoRua.trim().toUpperCase() !== excluindoRua.toUpperCase()}
                onClick={() => void confirmarExclusaoRua()}
              >
                {excluindo ? "Excluindo..." : `Excluir Rua ${excluindoRua}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {mostrarModalProdutos && (
        <ModalProdutos
          produtos={produtos}
          info={info}
          onFechar={() => setMostrarModalProdutos(false)}
          onAlterado={(lista) => {
            setProdutos(lista);
            void carregarProdutos();
          }}
        />
      )}

      {modal && (
        <FormularioContagem
          modal={modal}
          produtos={produtos}
          onFechar={() => setModal(null)}
          onSalvo={aoSalvar}
          onMetadadosSalvos={aoSalvarMetadados}
          onExcluida={aoExcluirLongarina}
        />
      )}

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}

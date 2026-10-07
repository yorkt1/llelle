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
                  <span className="field-value--muted">Nenhum produto cadastrado ainda — use "+ Produto" no topo da tela de Estoque.</span>
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

type EstadoPosicao = "vazia" | "baixo" | "ocupada";

/**
 * Ainda não existe regra de negócio pra "estoque baixo" (nem por produto, nem global) — com null o
 * estado fica desligado e o card de resumo mostra "—". Pra ativar, troque por um número de unidades
 * (ex.: 10): posições com 1..N un. passam a aparecer em amarelo e contam no resumo.
 */
const LIMITE_ESTOQUE_BAIXO = null as number | null;

const ESTADO_LABEL: Record<EstadoPosicao, string> = {
  vazia: "Vazia",
  baixo: "Estoque baixo",
  ocupada: "Ocupada",
};

function estadoDaPosicao(posicao: PosicaoResumo): EstadoPosicao {
  const quantidade = posicao.ultima.quantidade;
  if (quantidade <= 0) return "vazia";
  if (LIMITE_ESTOQUE_BAIXO !== null && quantidade <= LIMITE_ESTOQUE_BAIXO) return "baixo";
  return "ocupada";
}

function normalizar(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Aba especial "Todas" — mostra as posições de todas as ruas (é pra onde a tela vai quando um filtro é aplicado). */
const TODAS = "*";
const VISAO_STORAGE_KEY = "estoque:visao";

type Visao = "grade" | "tabela";
type ColunaTabela = "rua" | "codigo" | "produto" | "voltagem" | "quantidade" | "estado" | "responsavel" | "criadoEm";

const COLUNAS_TABELA: { coluna: ColunaTabela; label: string; numerica?: boolean }[] = [
  { coluna: "rua", label: "Rua" },
  { coluna: "codigo", label: "Posição" },
  { coluna: "produto", label: "Produto" },
  { coluna: "voltagem", label: "Voltagem" },
  { coluna: "quantidade", label: "Quantidade", numerica: true },
  { coluna: "estado", label: "Estado" },
  { coluna: "responsavel", label: "Contado por" },
  { coluna: "criadoEm", label: "Atualizado em" },
];

function valorColuna(posicao: PosicaoResumo, coluna: ColunaTabela): string | number {
  switch (coluna) {
    case "rua":
      return posicao.rua;
    case "codigo":
      return posicao.codigo;
    case "produto":
      return posicao.produto ?? "";
    case "voltagem":
      return posicao.voltagem ?? "";
    case "quantidade":
      return posicao.ultima.quantidade;
    case "estado":
      return ESTADO_LABEL[estadoDaPosicao(posicao)];
    case "responsavel":
      return posicao.ultima.responsavel;
    case "criadoEm":
      return posicao.ultima.criadoEm;
  }
}

function compararPosicoes(a: PosicaoResumo, b: PosicaoResumo, coluna: ColunaTabela): number {
  const va = valorColuna(a, coluna);
  const vb = valorColuna(b, coluna);
  if (typeof va === "number" && typeof vb === "number") return va - vb;
  // numeric: true → "H2" antes de "H10", como na prateleira.
  return String(va).localeCompare(String(vb), "pt-BR", { numeric: true, sensitivity: "base" });
}

function lerVisao(): Visao {
  try {
    return localStorage.getItem(VISAO_STORAGE_KEY) === "tabela" ? "tabela" : "grade";
  } catch {
    return "grade";
  }
}

function IconeGrade({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
    </svg>
  );
}

function IconeTabela({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <path d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

function IconeBusca({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

function CardResumo({ rotulo, valor, detalhe, tom }: { rotulo: string; valor: string | number; detalhe: string; tom?: EstadoPosicao | "marca" }) {
  return (
    <div className={`resumo-card${tom ? ` resumo-card--${tom}` : ""}`}>
      <span className="resumo-card-rotulo">{rotulo}</span>
      <span className="resumo-card-valor tabular">{valor}</span>
      <span className="resumo-card-detalhe">{detalhe}</span>
    </div>
  );
}

/** Catálogo de produtos — antes um painel no topo da tela, agora um modal aberto pelo "+ Produto" do cabeçalho. */
function ModalProdutos({
  produtos,
  onFechar,
  onAlterado,
}: {
  produtos: string[];
  onFechar: () => void;
  onAlterado: (produtos: string[]) => void;
}) {
  const [novoProduto, setNovoProduto] = useState("");
  const [erroProdutos, setErroProdutos] = useState<string | null>(null);
  const [salvandoProduto, setSalvandoProduto] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

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
      <div className="settings-panel" onClick={(event) => event.stopPropagation()}>
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
                  <span>{nome}</span>
                  <button type="button" className="refresh-btn" onClick={() => void removerProdutoCatalogo(nome)}>
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
  const [ruasExtras, setRuasExtras] = useState<string[]>([]); // ruas criadas na hora, ainda sem nenhuma posição salva
  const [ruaAtiva, setRuaAtiva] = useState<string | null>(null);
  const [adicionandoRua, setAdicionandoRua] = useState(false);
  const [nomeNovaRua, setNomeNovaRua] = useState("");
  const [modal, setModal] = useState<Modal>(null);
  const [carregou, setCarregou] = useState(false);
  const [erroCarregamento, setErroCarregamento] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [cardDestacado, setCardDestacado] = useState<string | null>(null);

  const [produtos, setProdutos] = useState<string[]>([]);
  const [mostrarModalProdutos, setMostrarModalProdutos] = useState(false);

  // Filtro/relatório: aplicar qualquer filtro leva a tela pra aba "Todas" (posições de TODAS as
  // ruas que combinam), como sempre foi; daí dá pra clicar numa rua pra restringir.
  const [busca, setBusca] = useState("");
  const [filtroProduto, setFiltroProduto] = useState("");
  const [filtroVoltagem, setFiltroVoltagem] = useState("");

  const [visao, setVisao] = useState<Visao>(lerVisao);
  const [ordenacao, setOrdenacao] = useState<{ coluna: ColunaTabela; crescente: boolean }>({ coluna: "codigo", crescente: true });

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
    } finally {
      setCarregou(true);
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
  const todasAsPosicoes = ruas.flatMap((r) => r.posicoes);
  const posicoesDaRuaAtiva = ruas.find((r) => r.rua === ruaAtiva)?.posicoes ?? [];

  const termoBusca = normalizar(busca.trim());
  const filtroAtivo = termoBusca !== "" || filtroProduto !== "" || filtroVoltagem !== "";
  const combinaComFiltro = (p: PosicaoResumo) =>
    (!filtroProduto || p.produto === filtroProduto) &&
    (!filtroVoltagem || p.voltagem === filtroVoltagem) &&
    (!termoBusca ||
      [p.codigo, `${p.rua}${p.codigo}`, p.produto ?? "", p.voltagem ?? "", p.ultima.responsavel].some((campo) => normalizar(campo).includes(termoBusca)));
  const posicoesFiltradas = todasAsPosicoes.filter(combinaComFiltro);

  const emTodas = ruaAtiva === TODAS;
  const posicoesExibidas = (emTodas ? posicoesFiltradas : posicoesDaRuaAtiva.filter(combinaComFiltro))
    .slice()
    .sort((a, b) => {
      if (visao === "tabela") {
        const r = compararPosicoes(a, b, ordenacao.coluna);
        return ordenacao.crescente ? r : -r;
      }
      return compararPosicoes(a, b, "rua") || compararPosicoes(a, b, "codigo");
    });
  const totalUnidadesExibidas = posicoesExibidas.reduce((soma, p) => soma + p.ultima.quantidade, 0);

  const contagemPorEstado = todasAsPosicoes.reduce<Record<EstadoPosicao, number>>(
    (acc, p) => {
      acc[estadoDaPosicao(p)] += 1;
      return acc;
    },
    { vazia: 0, baixo: 0, ocupada: 0 },
  );
  const totalUnidades = todasAsPosicoes.reduce((soma, p) => soma + p.ultima.quantidade, 0);

  /** Sair de "sem filtro" pra "com filtro" leva pra aba "Todas" — o filtro é um relatório do galpão
   * inteiro. Depois disso, quem clicar numa rua continua nela enquanto refina o filtro. */
  const aoFiltrar = (aplicar: () => void, novoValor: string) => {
    aplicar();
    if (novoValor && !filtroAtivo) setRuaAtiva(TODAS);
  };

  const limparFiltros = useCallback(() => {
    setBusca("");
    setFiltroProduto("");
    setFiltroVoltagem("");
  }, []);

  const trocarVisao = useCallback((nova: Visao) => {
    setVisao(nova);
    try {
      localStorage.setItem(VISAO_STORAGE_KEY, nova);
    } catch {
      // localStorage bloqueado — só não lembra a preferência.
    }
  }, []);

  const ordenarPor = useCallback((coluna: ColunaTabela) => {
    setOrdenacao((atual) => (atual.coluna === coluna ? { coluna, crescente: !atual.crescente } : { coluna, crescente: true }));
  }, []);

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

  const abrirPosicao = (posicao: PosicaoResumo) =>
    setModal({ modo: "existente", rua: posicao.rua, codigo: posicao.codigo, ultima: posicao.ultima, produto: posicao.produto, voltagem: posicao.voltagem });

  const ruaParaNovaPosicao = ruaAtiva && !emTodas ? ruaAtiva : null;
  const abrirNovaPosicao = () => {
    if (!ruaParaNovaPosicao) return;
    setModal({ modo: "nova", rua: ruaParaNovaPosicao, codigosExistentes: posicoesDaRuaAtiva.map((p) => p.codigo) });
  };

  const contadorDaRua = (rua: string) => {
    const posicoes = ruas.find((r) => r.rua === rua)?.posicoes ?? [];
    return filtroAtivo ? posicoes.filter(combinaComFiltro).length : posicoes.length;
  };

  const semRuas = carregou && todasAsRuas.length === 0;

  return (
    <div className="page pagina-formulario">
      <PageHeader titulo="Estoque" subtitulo="Contagem por rua e posição do galpão">
        <button type="button" className="refresh-btn" onClick={() => setMostrarModalProdutos(true)}>
          + Produto
        </button>
        <button type="button" className="refresh-btn" onClick={() => setAdicionandoRua(true)}>
          + Nova rua
        </button>
        {ruaParaNovaPosicao && (
          <button type="button" className="btn-primario" onClick={abrirNovaPosicao}>
            + Nova posição
          </button>
        )}
      </PageHeader>

      {erroCarregamento && <p className="error-banner">{erroCarregamento}</p>}

      <section className="resumo-grid" aria-label="Resumo do estoque">
        <CardResumo rotulo="Produtos" valor={produtos.length} detalhe="no catálogo" tom="marca" />
        <CardResumo
          rotulo="Posições ocupadas"
          valor={contagemPorEstado.ocupada + contagemPorEstado.baixo}
          detalhe={`${totalUnidades} un. em ${todasAsRuas.length} rua${todasAsRuas.length === 1 ? "" : "s"}`}
          tom="ocupada"
        />
        <CardResumo rotulo="Posições livres" valor={contagemPorEstado.vazia} detalhe="contadas com 0 un." tom="vazia" />
        <CardResumo
          rotulo="Estoque baixo"
          valor={LIMITE_ESTOQUE_BAIXO === null ? "—" : contagemPorEstado.baixo}
          detalhe={LIMITE_ESTOQUE_BAIXO === null ? "limite ainda não definido" : `até ${LIMITE_ESTOQUE_BAIXO} un. por posição`}
          tom="baixo"
        />
      </section>

      <div className="filtro-barra" role="search">
        <label className="filtro-busca">
          <IconeBusca className="filtro-busca-icone" />
          <input
            className="field-input"
            type="search"
            aria-label="Buscar posição"
            value={busca}
            onChange={(event) => aoFiltrar(() => setBusca(event.target.value), event.target.value.trim())}
            placeholder="Buscar por posição, produto ou responsável"
          />
        </label>
        <select
          className="field-input"
          aria-label="Filtrar por produto"
          value={filtroProduto}
          onChange={(event) => aoFiltrar(() => setFiltroProduto(event.target.value), event.target.value)}
        >
          <option value="">Todos os produtos</option>
          {produtos.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        <select
          className="field-input"
          aria-label="Filtrar por voltagem"
          value={filtroVoltagem}
          onChange={(event) => aoFiltrar(() => setFiltroVoltagem(event.target.value), event.target.value)}
        >
          <option value="">Todas as voltagens</option>
          {VOLTAGENS.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        {filtroAtivo && (
          <button type="button" className="refresh-btn" onClick={limparFiltros}>
            Limpar filtros
          </button>
        )}
        <div className="alternar-visao" role="group" aria-label="Modo de exibição">
          <button
            type="button"
            className={`alternar-visao-btn${visao === "grade" ? " alternar-visao-btn--ativo" : ""}`}
            aria-pressed={visao === "grade"}
            onClick={() => trocarVisao("grade")}
            title="Visão em grade"
          >
            <IconeGrade className="btn-icone" />
            <span>Grade</span>
          </button>
          <button
            type="button"
            className={`alternar-visao-btn${visao === "tabela" ? " alternar-visao-btn--ativo" : ""}`}
            aria-pressed={visao === "tabela"}
            onClick={() => trocarVisao("tabela")}
            title="Visão em tabela"
          >
            <IconeTabela className="btn-icone" />
            <span>Tabela</span>
          </button>
        </div>
      </div>

      {(todasAsRuas.length > 0 || adicionandoRua) && (
        <div className="ruas-barra">
          <div className="ruas-abas" role="tablist" aria-label="Ruas">
            {todasAsRuas.length > 1 || filtroAtivo || emTodas ? (
              <button
                type="button"
                role="tab"
                aria-selected={emTodas}
                className={`ruas-aba${emTodas ? " ruas-aba--ativa" : ""}`}
                onClick={() => setRuaAtiva(TODAS)}
              >
                Todas
                <span className="ruas-aba-contador tabular">{filtroAtivo ? posicoesFiltradas.length : todasAsPosicoes.length}</span>
              </button>
            ) : null}
            {todasAsRuas.map((rua) => (
              <button
                key={rua}
                type="button"
                role="tab"
                aria-selected={rua === ruaAtiva}
                className={`ruas-aba${rua === ruaAtiva ? " ruas-aba--ativa" : ""}`}
                onClick={() => setRuaAtiva(rua)}
              >
                Rua {rua}
                <span className="ruas-aba-contador tabular">{contadorDaRua(rua)}</span>
              </button>
            ))}
          </div>
          {adicionandoRua && (
            <span className="estoque-nova-rua">
              <input
                className="field-input"
                autoFocus
                aria-label="Nova rua"
                value={nomeNovaRua}
                onChange={(event) => setNomeNovaRua(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") confirmarNovaRua();
                  if (event.key === "Escape") setAdicionandoRua(false);
                }}
                placeholder="Nova rua (ex.: D)"
              />
              <button type="button" className="btn-primario" onClick={confirmarNovaRua} disabled={!nomeNovaRua.trim()}>
                Criar
              </button>
              <button type="button" className="refresh-btn" onClick={() => setAdicionandoRua(false)}>
                Cancelar
              </button>
            </span>
          )}
        </div>
      )}

      {!carregou && <p className="nota-info">Carregando estoque…</p>}

      {semRuas && !adicionandoRua && (
        <div className="estado-vazio">
          <IconeGondola className="estado-vazio-icone" />
          <p className="estado-vazio-titulo">Nenhuma rua cadastrada ainda.</p>
          <p className="field-value--muted">Crie a primeira rua pra começar a registrar as posições do galpão — rua e posição são criadas na hora, direto daqui.</p>
          <button type="button" className="btn-primario" onClick={() => setAdicionandoRua(true)}>
            + Nova rua
          </button>
        </div>
      )}

      {ruaAtiva && (
        <>
          <div className="estoque-legenda">
            <span className="nota-info">
              {posicoesExibidas.length} posiç{posicoesExibidas.length === 1 ? "ão" : "ões"} · {totalUnidadesExibidas} un.
              {emTodas ? " · todas as ruas" : ` · Rua ${ruaAtiva}`}
            </span>
            <span className="estoque-legenda-itens" aria-label="Legenda de cores">
              <span className="estoque-legenda-item estoque-legenda-item--ocupada">Ocupada</span>
              <span className="estoque-legenda-item estoque-legenda-item--vazia">Vazia</span>
              {LIMITE_ESTOQUE_BAIXO !== null && <span className="estoque-legenda-item estoque-legenda-item--baixo">Estoque baixo</span>}
            </span>
          </div>

          {posicoesExibidas.length === 0 && (filtroAtivo || visao === "tabela" || emTodas) ? (
            <div className="estado-vazio">
              {filtroAtivo ? (
                <>
                  <p className="estado-vazio-titulo">Nenhuma posição encontrada com esses filtros.</p>
                  <button type="button" className="refresh-btn" onClick={limparFiltros}>
                    Limpar filtros
                  </button>
                </>
              ) : (
                <>
                  <p className="estado-vazio-titulo">Nenhuma posição cadastrada {emTodas ? "ainda" : `na Rua ${ruaAtiva}`}.</p>
                  {ruaParaNovaPosicao && (
                    <button type="button" className="btn-primario" onClick={abrirNovaPosicao}>
                      + Nova posição
                    </button>
                  )}
                </>
              )}
            </div>
          ) : visao === "grade" ? (
            <div className="estoque-grid">
              {posicoesExibidas.map((posicao) => {
                const url = posicao.ultima.fotoUrl;
                const destacado = cardDestacado === `${posicao.rua}::${posicao.codigo}`;
                const estado = estadoDaPosicao(posicao);
                return (
                  <button
                    key={`${posicao.rua}::${posicao.codigo}`}
                    className={`estoque-card estoque-card--${estado}${destacado ? " estoque-card--destacado" : ""}`}
                    onClick={() => abrirPosicao(posicao)}
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
                    <span className="estoque-card-linha">
                      <span className="estoque-card-codigo">{emTodas ? `${posicao.rua} · ${posicao.codigo}` : posicao.codigo}</span>
                      <span className={`estado-chip estado-chip--${estado}`}>{ESTADO_LABEL[estado]}</span>
                    </span>
                    {posicao.produto && (
                      <span className="estoque-card-produto">
                        {posicao.produto} · {posicao.voltagem}
                      </span>
                    )}
                    <span className="estoque-card-qtd tabular">{posicao.ultima.quantidade} un.</span>
                    <span className="estoque-card-meta">
                      {posicao.ultima.responsavel} · {formatarDataHora(posicao.ultima.criadoEm)}
                    </span>
                  </button>
                );
              })}
              {ruaParaNovaPosicao && !filtroAtivo && (
                <button className="estoque-card estoque-card--nova" onClick={abrirNovaPosicao}>
                  + Nova posição
                </button>
              )}
            </div>
          ) : (
            <div className="tabela-wrap">
              <table className="tabela tabela--clicavel">
                <thead>
                  <tr>
                    {COLUNAS_TABELA.map(({ coluna, label, numerica }) => {
                      const ativa = ordenacao.coluna === coluna;
                      return (
                        <th
                          key={coluna}
                          className={numerica ? "tabela-num" : undefined}
                          aria-sort={ativa ? (ordenacao.crescente ? "ascending" : "descending") : "none"}
                        >
                          <button type="button" className={`tabela-ordenar${ativa ? " tabela-ordenar--ativa" : ""}`} onClick={() => ordenarPor(coluna)}>
                            {label}
                            <span className="tabela-ordenar-seta" aria-hidden="true">
                              {ativa ? (ordenacao.crescente ? "▲" : "▼") : "↕"}
                            </span>
                          </button>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {posicoesExibidas.map((posicao) => {
                    const estado = estadoDaPosicao(posicao);
                    const destacado = cardDestacado === `${posicao.rua}::${posicao.codigo}`;
                    return (
                      <tr
                        key={`${posicao.rua}::${posicao.codigo}`}
                        className={destacado ? "tabela-linha--editando" : undefined}
                        tabIndex={0}
                        onClick={() => abrirPosicao(posicao)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            abrirPosicao(posicao);
                          }
                        }}
                        aria-label={`Abrir posição ${posicao.rua} ${posicao.codigo}`}
                      >
                        <td>{posicao.rua}</td>
                        <td>
                          <strong>{posicao.codigo}</strong>
                        </td>
                        <td>{posicao.produto ?? <span className="field-value--muted">—</span>}</td>
                        <td>{posicao.voltagem ?? <span className="field-value--muted">—</span>}</td>
                        <td className="tabela-num tabular">{posicao.ultima.quantidade}</td>
                        <td>
                          <span className={`estado-chip estado-chip--${estado}`}>{ESTADO_LABEL[estado]}</span>
                        </td>
                        <td>{posicao.ultima.responsavel}</td>
                        <td className="tabular">{formatarDataHora(posicao.ultima.criadoEm)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {mostrarModalProdutos && <ModalProdutos produtos={produtos} onFechar={() => setMostrarModalProdutos(false)} onAlterado={setProdutos} />}

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

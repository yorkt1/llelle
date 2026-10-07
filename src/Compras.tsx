import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/PageHeader";

const API_URL = import.meta.env.VITE_API_URL ?? "";
const POLL_MS = 60_000;

type StatusCompra = "comprar" | "atencao" | "ok" | "excesso" | "sem-venda";

interface ParametrosCompra {
  prazoDias: number;
  segurancaDias: number;
  coberturaDias: number;
}

interface LinhaPlanejamento {
  chave: string;
  codigo: string;
  produto: string;
  vendaDia: number;
  vendaPeriodo: number;
  disponivel: number | null;
  emTransito: number;
  prazoDias: number;
  coberturaDias: number | null;
  rupturaPrevista: string | null;
  pontoDePedido: number;
  sugestao: number;
  valorVendaSugestao: number;
  status: StatusCompra;
  ignorado: boolean;
  estoqueAtualizadoEm: string | null;
}

interface StatusColeta {
  configurado: boolean;
  janelaDias: number;
  diasColetados: number;
  emAndamento?: { dia: string; pedidosFeitos: number; totalPedidos: number };
  ultimoErro?: string;
  atualizadoEm?: string;
}

interface Planejamento {
  parametros: ParametrosCompra;
  coleta: StatusColeta;
  diasBase: number;
  linhas: LinhaPlanejamento[];
}

const STATUS_LABEL: Record<StatusCompra, string> = {
  comprar: "Comprar agora",
  atencao: "Atenção",
  ok: "OK",
  excesso: "Excesso",
  "sem-venda": "Sem venda",
};

// Ordem de urgência — usada pra ordenar por status.
const STATUS_ORDEM: Record<StatusCompra, number> = { comprar: 0, atencao: 1, ok: 2, excesso: 3, "sem-venda": 4 };

type Coluna = "produto" | "vendaDia" | "disponivel" | "emTransito" | "coberturaDias" | "rupturaPrevista" | "sugestao" | "status";

const COLUNAS: { coluna: Coluna; label: string; numerica?: boolean }[] = [
  { coluna: "produto", label: "Produto" },
  { coluna: "vendaDia", label: "Venda/dia", numerica: true },
  { coluna: "disponivel", label: "Estoque disp.", numerica: true },
  { coluna: "emTransito", label: "Em trânsito", numerica: true },
  { coluna: "coberturaDias", label: "Cobertura", numerica: true },
  { coluna: "rupturaPrevista", label: "Acaba em" },
  { coluna: "sugestao", label: "Sugestão de compra", numerica: true },
  { coluna: "status", label: "Status" },
];

function valor(linha: LinhaPlanejamento, coluna: Coluna): string | number {
  if (coluna === "status") return STATUS_ORDEM[linha.status];
  const v = linha[coluna];
  if (v === null) return coluna === "rupturaPrevista" ? "9999" : Number.POSITIVE_INFINITY;
  return v;
}

function numero(n: number, casas = 0): string {
  return n.toLocaleString("pt-BR", { maximumFractionDigits: casas, minimumFractionDigits: casas });
}

function isoParaBr(iso: string): string {
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
}

function normalizar(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Campo numérico que salva ao sair (blur) ou Enter — pra editar em trânsito/prazo direto na tabela. */
function CampoNumero({ valor: inicial, onSalvar, rotulo }: { valor: number; onSalvar: (n: number) => void; rotulo: string }) {
  const [texto, setTexto] = useState(String(inicial));
  const salvar = () => {
    const n = Number(texto);
    if (Number.isFinite(n) && n >= 0 && n !== inicial) onSalvar(Math.round(n));
    else setTexto(String(inicial));
  };
  return (
    <input
      className="tabela-input-num"
      type="number"
      min={0}
      inputMode="numeric"
      aria-label={rotulo}
      value={texto}
      onClick={(event) => event.stopPropagation()}
      onChange={(event) => setTexto(event.target.value)}
      onBlur={salvar}
      onKeyDown={(event) => event.key === "Enter" && (event.currentTarget as HTMLInputElement).blur()}
    />
  );
}

export function Compras() {
  const [plano, setPlano] = useState<Planejamento | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [filtroStatus, setFiltroStatus] = useState<StatusCompra | "">("");
  const [mostrarIgnorados, setMostrarIgnorados] = useState(false);
  const [ordenacao, setOrdenacao] = useState<{ coluna: Coluna; crescente: boolean }>({ coluna: "status", crescente: true });
  const [parametrosEdit, setParametrosEdit] = useState<ParametrosCompra | null>(null);
  const [salvandoParametros, setSalvandoParametros] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const resposta = await fetch(`${API_URL}/api/compras/planejamento`, { cache: "no-store" });
      const json = await resposta.json();
      if (!resposta.ok) throw new Error(json.error ?? "Não consegui carregar o planejamento.");
      setPlano(json);
      setErro(null);
    } catch (error) {
      setErro(error instanceof Error ? error.message : "Não consegui carregar o planejamento.");
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

  const salvarProduto = useCallback(
    async (linha: LinhaPlanejamento, mudanca: { emTransito?: number; prazoDias?: number; ignorar?: boolean }) => {
      const corpo = {
        chave: linha.chave,
        emTransito: linha.emTransito,
        prazoDias: linha.prazoDias !== plano?.parametros.prazoDias ? linha.prazoDias : undefined,
        ignorar: linha.ignorado,
        ...mudanca,
      };
      const resposta = await fetch(`${API_URL}/api/compras/produto`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corpo),
      });
      if (!resposta.ok) setErro("Não consegui salvar esse produto agora.");
      void carregar();
    },
    [carregar, plano],
  );

  const salvarParametros = useCallback(async () => {
    if (!parametrosEdit) return;
    setSalvandoParametros(true);
    try {
      const resposta = await fetch(`${API_URL}/api/compras/parametros`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parametrosEdit),
      });
      if (!resposta.ok) throw new Error("Não consegui salvar os parâmetros.");
      setParametrosEdit(null);
      void carregar();
    } catch (error) {
      setErro(error instanceof Error ? error.message : "Não consegui salvar os parâmetros.");
    } finally {
      setSalvandoParametros(false);
    }
  }, [carregar, parametrosEdit]);

  const linhas = useMemo(() => {
    if (!plano) return [];
    const termo = normalizar(busca.trim());
    return plano.linhas
      .filter((l) => (mostrarIgnorados ? true : !l.ignorado))
      .filter((l) => !filtroStatus || l.status === filtroStatus)
      .filter((l) => !termo || normalizar(`${l.produto} ${l.codigo}`).includes(termo))
      .slice()
      .sort((a, b) => {
        const va = valor(a, ordenacao.coluna);
        const vb = valor(b, ordenacao.coluna);
        const r = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb), "pt-BR", { numeric: true });
        return (ordenacao.crescente ? r : -r) || b.vendaDia - a.vendaDia;
      });
  }, [plano, busca, filtroStatus, mostrarIgnorados, ordenacao]);

  const ativos = plano?.linhas.filter((l) => !l.ignorado) ?? [];
  const contar = (s: StatusCompra) => ativos.filter((l) => l.status === s).length;
  const valorSugerido = ativos.filter((l) => l.status === "comprar").reduce((s, l) => s + l.valorVendaSugestao, 0);
  const coleta = plano?.coleta;
  const coletaCompleta = coleta ? coleta.diasColetados >= coleta.janelaDias : false;

  return (
    <div className="page pagina-formulario">
      <PageHeader titulo="Compras" subtitulo="Planejamento de compra a partir das vendas e do estoque do Tiny">
        <button type="button" className="refresh-btn" onClick={() => setParametrosEdit(plano?.parametros ?? null)} disabled={!plano}>
          Parâmetros
        </button>
      </PageHeader>

      {erro && <p className="error-banner">{erro}</p>}

      {coleta && (
        <div className={`coleta-status${coletaCompleta ? "" : " coleta-status--andamento"}`} role="status">
          <div className="coleta-status-texto">
            <strong>
              {!coleta.configurado
                ? "Tiny não configurado no servidor — sem coleta."
                : coletaCompleta
                  ? "Histórico de vendas completo"
                  : `Coletando histórico de vendas: ${coleta.diasColetados} de ${coleta.janelaDias} dias`}
            </strong>
            <span className="field-value--muted">
              {coleta.emAndamento
                ? ` · agora: ${isoParaBr(coleta.emAndamento.dia)} (${coleta.emAndamento.pedidosFeitos}/${coleta.emAndamento.totalPedidos} pedidos)`
                : ""}
              {plano && ` · média calculada sobre ${plano.diasBase} dia(s)`}
              {coleta.atualizadoEm && ` · última coleta ${new Date(coleta.atualizadoEm).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`}
            </span>
            {coleta.ultimoErro && <span className="error-banner"> Último erro: {coleta.ultimoErro}</span>}
          </div>
          {!coletaCompleta && coleta.configurado && (
            <span className="coleta-barra" aria-hidden="true">
              <span style={{ width: `${(coleta.diasColetados / Math.max(1, coleta.janelaDias)) * 100}%` }} />
            </span>
          )}
        </div>
      )}

      <section className="resumo-grid" aria-label="Resumo do planejamento">
        <div className="resumo-card resumo-card--perigo">
          <span className="resumo-card-rotulo">Comprar agora</span>
          <span className="resumo-card-valor tabular">{plano ? contar("comprar") : "—"}</span>
          <span className="resumo-card-detalhe">abaixo do ponto de pedido</span>
        </div>
        <div className="resumo-card resumo-card--baixo">
          <span className="resumo-card-rotulo">Atenção</span>
          <span className="resumo-card-valor tabular">{plano ? contar("atencao") : "—"}</span>
          <span className="resumo-card-detalhe">chegam no ponto em até 30 dias</span>
        </div>
        <div className="resumo-card resumo-card--vazia">
          <span className="resumo-card-rotulo">Excesso</span>
          <span className="resumo-card-valor tabular">{plano ? contar("excesso") : "—"}</span>
          <span className="resumo-card-detalhe">estoque bem acima do necessário</span>
        </div>
        <div className="resumo-card resumo-card--marca">
          <span className="resumo-card-rotulo">Sugestão (comprar agora)</span>
          <span className="resumo-card-valor tabular">
            {plano ? valorSugerido.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }) : "—"}
          </span>
          <span className="resumo-card-detalhe">pelo preço de venda — só ordem de grandeza</span>
        </div>
      </section>

      <div className="filtro-barra" role="search">
        <label className="filtro-busca">
          <input className="field-input" type="search" aria-label="Buscar produto" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar produto ou SKU" />
        </label>
        <select className="field-input" aria-label="Filtrar por status" value={filtroStatus} onChange={(e) => setFiltroStatus(e.target.value as StatusCompra | "")}>
          <option value="">Todos os status</option>
          {(Object.keys(STATUS_LABEL) as StatusCompra[]).map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <label className="filtro-check">
          <input type="checkbox" checked={mostrarIgnorados} onChange={(e) => setMostrarIgnorados(e.target.checked)} />
          Mostrar ignorados
        </label>
      </div>

      {!plano ? (
        <p className="nota-info">Carregando planejamento…</p>
      ) : plano.linhas.length === 0 ? (
        <div className="estado-vazio">
          <p className="estado-vazio-titulo">Ainda não há vendas coletadas.</p>
          <p className="field-value--muted">
            A coleta roda sozinha em segundo plano no servidor, devagar pra não estourar o limite do Tiny — os dias mais recentes chegam primeiro. Volte em
            algumas horas.
          </p>
          <button type="button" className="refresh-btn" onClick={() => void carregar()}>
            Atualizar agora
          </button>
        </div>
      ) : linhas.length === 0 ? (
        <div className="estado-vazio estado-vazio--compacto">
          <p className="estado-vazio-titulo">Nenhum produto com esses filtros.</p>
          <button
            type="button"
            className="refresh-btn"
            onClick={() => {
              setBusca("");
              setFiltroStatus("");
            }}
          >
            Limpar filtros
          </button>
        </div>
      ) : (
        <div className="tabela-wrap">
          <table className="tabela">
            <thead>
              <tr>
                {COLUNAS.map(({ coluna, label, numerica }) => {
                  const ativa = ordenacao.coluna === coluna;
                  return (
                    <th key={coluna} className={numerica ? "tabela-num" : undefined} aria-sort={ativa ? (ordenacao.crescente ? "ascending" : "descending") : "none"}>
                      <button
                        type="button"
                        className={`tabela-ordenar${ativa ? " tabela-ordenar--ativa" : ""}`}
                        onClick={() => setOrdenacao((o) => (o.coluna === coluna ? { coluna, crescente: !o.crescente } : { coluna, crescente: true }))}
                      >
                        {label}
                        <span className="tabela-ordenar-seta" aria-hidden="true">
                          {ativa ? (ordenacao.crescente ? "▲" : "▼") : "↕"}
                        </span>
                      </button>
                    </th>
                  );
                })}
                <th className="tabela-num">Prazo (dias)</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => (
                <tr key={l.chave} className={l.ignorado ? "tabela-linha--apagada" : undefined}>
                  <td className="compras-produto">
                    <span>{l.produto}</span>
                    {l.codigo && <span className="field-value--muted"> · {l.codigo}</span>}
                  </td>
                  <td className="tabela-num tabular">{numero(l.vendaDia, 1)}</td>
                  <td className="tabela-num tabular">{l.disponivel === null ? <span className="field-value--muted" title="Saldo ainda não coletado">…</span> : numero(l.disponivel)}</td>
                  <td className="tabela-num">
                    <CampoNumero key={`t-${l.emTransito}`} valor={l.emTransito} rotulo={`Em trânsito de ${l.produto}`} onSalvar={(n) => void salvarProduto(l, { emTransito: n })} />
                  </td>
                  <td className="tabela-num tabular">{l.coberturaDias === null ? "—" : `${numero(l.coberturaDias)} d`}</td>
                  <td className="tabular">{l.rupturaPrevista ? isoParaBr(l.rupturaPrevista) : "—"}</td>
                  <td className="tabela-num tabular">
                    <strong>{l.sugestao > 0 ? numero(l.sugestao) : "—"}</strong>
                  </td>
                  <td>
                    <span className={`estado-chip estado-chip--compra-${l.status}`}>{STATUS_LABEL[l.status]}</span>
                  </td>
                  <td className="tabela-num">
                    <CampoNumero key={`p-${l.prazoDias}`} valor={l.prazoDias} rotulo={`Prazo de importação de ${l.produto}`} onSalvar={(n) => void salvarProduto(l, { prazoDias: n })} />
                  </td>
                  <td>
                    <button type="button" className="refresh-btn" onClick={() => void salvarProduto(l, { ignorar: !l.ignorado })}>
                      {l.ignorado ? "Reativar" : "Ignorar"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="nota-info">
        Sugestão = venda/dia × (prazo + cobertura + segurança) − (estoque disponível + em trânsito). É apoio à decisão: sazonalidade, promoções e lote
        mínimo do fornecedor não entram na conta.
      </p>

      {parametrosEdit && (
        <div className="settings-overlay" onClick={() => setParametrosEdit(null)}>
          <div className="settings-panel" onClick={(event) => event.stopPropagation()}>
            <div className="settings-panel-header">
              <button className="settings-close" onClick={() => setParametrosEdit(null)} aria-label="Fechar">
                ×
              </button>
              <h2 className="settings-title">Parâmetros de compra</h2>
              <p className="settings-hint">Valem pra todos os produtos; o prazo pode ser ajustado por produto direto na tabela.</p>
            </div>
            <div className="settings-panel-body">
              {(
                [
                  ["prazoDias", "Prazo de importação (dias)", "Do pedido ao fornecedor até a mercadoria estar disponível pra venda."],
                  ["segurancaDias", "Estoque de segurança (dias de venda)", "Margem pra atraso de contêiner ou pico de venda."],
                  ["coberturaDias", "Cada compra cobre (dias de venda)", "Quanto tempo de venda cada pedido deve garantir depois que chega."],
                ] as const
              ).map(([campo, rotulo, ajuda]) => (
                <label key={campo} className="field">
                  <span className="field-label">{rotulo}</span>
                  <input
                    className="field-input"
                    type="number"
                    min={0}
                    value={parametrosEdit[campo]}
                    onChange={(event) => setParametrosEdit({ ...parametrosEdit, [campo]: Number(event.target.value) })}
                  />
                  <span className="field-value--muted">{ajuda}</span>
                </label>
              ))}
            </div>
            <div className="settings-panel-footer">
              <button className="btn-primario" onClick={() => void salvarParametros()} disabled={salvandoParametros}>
                {salvandoParametros ? "Salvando..." : "Salvar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

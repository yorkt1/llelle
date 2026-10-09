import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PageHeader } from "@/PageHeader";

const API_URL = import.meta.env.VITE_API_URL ?? "";
const MARKETPLACES = [
  { key: "tiktok", nome: "TikTok Shop", cor: "var(--pedido-tiktok)" },
  { key: "ml", nome: "Mercado Livre", cor: "var(--pedido-ml)" },
  { key: "shopee", nome: "Shopee", cor: "var(--pedido-shopee)" },
] as const;
const ETAPAS = [
  { key: "recebidos", nome: "Recebidos" },
  { key: "separados", nome: "Separados" },
  { key: "embalados", nome: "Embalados" },
  { key: "expedidos", nome: "Expedidos" },
  { key: "cancelados", nome: "Cancelados" },
] as const;
const TURNOS = [
  { key: "manha", nome: "Turno manhã", horario: "06h – 12h" },
  { key: "tarde", nome: "Turno tarde", horario: "12h – 18h" },
] as const;
type MarketplaceKey = (typeof MARKETPLACES)[number]["key"];
type EtapaKey = (typeof ETAPAS)[number]["key"];
type TurnoKey = (typeof TURNOS)[number]["key"];
type DadosMarketplace = Record<EtapaKey, number>;
interface DadosTurno {
  resp: string;
  obs: string;
  tiktok: DadosMarketplace;
  ml: DadosMarketplace;
  shopee: DadosMarketplace;
}
interface DiaPedidos {
  data: string;
  atualizado: string;
  manha: DadosTurno;
  tarde: DadosTurno;
}
type EstadoDia = Omit<DiaPedidos, "data" | "atualizado">;

function hojeLocal(): string {
  const data = new Date();
  return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, "0")}-${String(data.getDate()).padStart(2, "0")}`;
}

function formatarData(data: string): string {
  const [ano, mes, dia] = data.split("-");
  return `${dia}/${mes}/${ano}`;
}

function semana(data: string): string {
  return new Date(`${data}T12:00:00`).toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "");
}

function blankMarketplace(): DadosMarketplace {
  return { recebidos: 0, separados: 0, embalados: 0, expedidos: 0, cancelados: 0 };
}

function blankTurno(): DadosTurno {
  return { resp: "", obs: "", tiktok: blankMarketplace(), ml: blankMarketplace(), shopee: blankMarketplace() };
}

function blankDia(): EstadoDia {
  return { manha: blankTurno(), tarde: blankTurno() };
}

function normalizarDia(value: Partial<DiaPedidos> | null): EstadoDia {
  const vazio = blankDia();
  if (!value) return vazio;
  for (const turno of TURNOS) {
    const origem = value[turno.key];
    if (!origem) continue;
    vazio[turno.key].resp = typeof origem.resp === "string" ? origem.resp : "";
    vazio[turno.key].obs = typeof origem.obs === "string" ? origem.obs : "";
    for (const marketplace of MARKETPLACES) {
      for (const etapa of ETAPAS) {
        const numero = Number(origem[marketplace.key]?.[etapa.key]);
        vazio[turno.key][marketplace.key][etapa.key] = Number.isFinite(numero) && numero > 0 ? Math.floor(numero) : 0;
      }
    }
  }
  return vazio;
}

function pendentes(dados: DadosMarketplace): number {
  return dados.recebidos - dados.expedidos - dados.cancelados;
}

function somar(etapa: EtapaKey, state: EstadoDia): number {
  return TURNOS.reduce(
    (totalTurno, turno) =>
      totalTurno + MARKETPLACES.reduce((totalMp, marketplace) => totalMp + state[turno.key][marketplace.key][etapa], 0),
    0,
  );
}

function formatarErro(erro: unknown, padrao: string): string {
  return erro instanceof Error ? erro.message : padrao;
}

export function ControlePedidos() {
  const [data, setData] = useState(hojeLocal);
  const [state, setState] = useState<EstadoDia>(blankDia);
  const [historico, setHistorico] = useState<DiaPedidos[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [registroExiste, setRegistroExiste] = useState(false);
  const [sujo, setSujo] = useState(false);
  const [status, setStatus] = useState("Carregando…");
  const [erro, setErro] = useState<string | null>(null);
  const [revisao, setRevisao] = useState(0);
  const dataAtualRef = useRef(data);
  const revisaoAtualRef = useRef(0);
  const recebidos = useMemo(() => somar("recebidos", state), [state]);
  const expedidos = useMemo(() => somar("expedidos", state), [state]);
  const cancelados = useMemo(() => somar("cancelados", state), [state]);
  const totalPendentes = recebidos - expedidos - cancelados;
  const basePercentual = recebidos - cancelados;
  const percentualExpedido = basePercentual > 0 ? Math.min(100, Math.round((expedidos / basePercentual) * 100)) : 0;

  const buscarHistorico = useCallback(async () => {
    const resposta = await fetch(`${API_URL}/api/pedidos/historico?limite=14`, { cache: "no-store" });
    const json = await resposta.json();
    if (!resposta.ok) throw new Error(json.error ?? "Não consegui carregar o histórico.");
    return (Array.isArray(json.dias) ? json.dias : []) as DiaPedidos[];
  }, []);

  const carregarHistorico = useCallback(async () => {
    setHistorico(await buscarHistorico());
  }, [buscarHistorico]);

  useEffect(() => {
    let ativo = true;
    void Promise.all([
      fetch(`${API_URL}/api/pedidos/${data}`, { cache: "no-store" }).then(async (resposta) => {
        const json = await resposta.json();
        if (!resposta.ok) throw new Error(json.error ?? "Não consegui carregar este dia.");
        return json.dia as DiaPedidos | null;
      }),
      buscarHistorico(),
    ])
      .then(([dia, dias]) => {
        if (!ativo) return;
        setState(normalizarDia(dia));
        setRegistroExiste(Boolean(dia));
        setHistorico(dias);
        setStatus("Dados salvos no banco");
      })
      .catch((error: unknown) => {
        if (!ativo) return;
        setErro(formatarErro(error, "Não consegui carregar os pedidos."));
        setStatus("Falha ao carregar");
      })
      .finally(() => {
        if (ativo) setCarregando(false);
      });
    return () => {
      ativo = false;
    };
  }, [data, buscarHistorico]);

  const salvar = useCallback(
    async (dia: string, dados: EstadoDia, versao: number, atualizarStatus = true) => {
      if (atualizarStatus && dataAtualRef.current === dia && revisaoAtualRef.current === versao) {
        setStatus("Salvando…");
        setErro(null);
      }
      try {
        const resposta = await fetch(`${API_URL}/api/pedidos/${dia}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(dados),
        });
        const json = await resposta.json();
        if (!resposta.ok) throw new Error(json.error ?? "Não consegui salvar os pedidos.");
        if (atualizarStatus && dataAtualRef.current === dia && revisaoAtualRef.current === versao) {
          setRegistroExiste(true);
          setSujo(false);
          setStatus("Salvo · compartilhado com a equipe");
        }
        void carregarHistorico().catch((error: unknown) => setErro(formatarErro(error, "Não consegui atualizar o histórico.")));
      } catch (error) {
        if (atualizarStatus && dataAtualRef.current === dia && revisaoAtualRef.current === versao) {
          setErro(formatarErro(error, "Não consegui salvar os pedidos."));
          setStatus("Falha ao salvar");
        }
      }
    },
    [carregarHistorico],
  );

  useEffect(() => {
    if (!sujo || carregando) return;
    const dadosSalvos = state;
    const diaSalvo = data;
    const versao = revisao;
    const timer = window.setTimeout(() => void salvar(diaSalvo, dadosSalvos, versao), 700);
    return () => window.clearTimeout(timer);
  }, [carregando, data, revisao, salvar, state, sujo]);

  const editarTexto = (turno: TurnoKey, campo: "resp" | "obs", valor: string) => {
    setState((atual) => ({ ...atual, [turno]: { ...atual[turno], [campo]: valor } }));
    revisaoAtualRef.current++;
    setRevisao(revisaoAtualRef.current);
    setSujo(true);
    setStatus("Alterações pendentes…");
  };

  const editarNumero = (turno: TurnoKey, marketplace: MarketplaceKey, etapa: EtapaKey, valor: string) => {
    const numero = Number.parseInt(valor, 10);
    const quantidade = Number.isFinite(numero) && numero >= 0 ? numero : 0;
    setState((atual) => ({
      ...atual,
      [turno]: {
        ...atual[turno],
        [marketplace]: { ...atual[turno][marketplace], [etapa]: quantidade },
      },
    }));
    revisaoAtualRef.current++;
    setRevisao(revisaoAtualRef.current);
    setSujo(true);
    setStatus("Alterações pendentes…");
  };

  const navegar = (proximo: string) => {
    if (sujo) void salvar(data, state, revisao, false);
    dataAtualRef.current = proximo;
    setCarregando(true);
    setSujo(false);
    setErro(null);
    setState(blankDia());
    setData(proximo);
  };

  const deslocarDia = (delta: number) => {
    const novo = new Date(`${data}T12:00:00`);
    novo.setDate(novo.getDate() + delta);
    navegar(`${novo.getFullYear()}-${String(novo.getMonth() + 1).padStart(2, "0")}-${String(novo.getDate()).padStart(2, "0")}`);
  };

  const excluirDia = async () => {
    if (!registroExiste || !window.confirm(`Excluir os dados do dia ${formatarData(data)}? Essa ação não pode ser desfeita.`)) return;
    setStatus("Excluindo…");
    setErro(null);
    try {
      const resposta = await fetch(`${API_URL}/api/pedidos/${data}`, { method: "DELETE" });
      const json = resposta.status === 204 ? null : await resposta.json();
      if (!resposta.ok) throw new Error(json?.error ?? "Não consegui excluir esse dia.");
      setState(blankDia());
      setRegistroExiste(false);
      setSujo(false);
      setHistorico((atual) => atual.filter((dia) => dia.data !== data));
      setStatus("Dia excluído");
    } catch (error) {
      setErro(formatarErro(error, "Não consegui excluir esse dia."));
      setStatus("Falha ao excluir");
    }
  };

  const porMarketplace = MARKETPLACES.map((marketplace) => {
    const total = TURNOS.reduce((soma, turno) => soma + state[turno.key][marketplace.key].recebidos, 0);
    return <span key={marketplace.key}><i className="pedido-dot" style={{ background: marketplace.cor }} />{marketplace.nome}: {total}</span>;
  });

  return (
    <div className="page controle-pedidos">
      <PageHeader titulo="Controle diário de pedidos" subtitulo="LLE & LLE · Expedição e-commerce">
        <div className="controle-pedidos-data">
          <button type="button" className="refresh-btn" aria-label="Dia anterior" onClick={() => deslocarDia(-1)}>‹</button>
          <input className="field-input" type="date" aria-label="Data" value={data} onChange={(event) => event.target.value && navegar(event.target.value)} />
          <button type="button" className="refresh-btn" aria-label="Próximo dia" onClick={() => deslocarDia(1)}>›</button>
          <button type="button" className="refresh-btn" onClick={() => navegar(hojeLocal())}>Hoje</button>
          <button type="button" className="btn-perigo-texto" disabled={!registroExiste || carregando || sujo} onClick={() => void excluirDia()}>
            Excluir dia
          </button>
        </div>
        <span className={`controle-pedidos-status${erro ? " controle-pedidos-status--erro" : ""}`} role="status">{status}</span>
      </PageHeader>

      {erro && <p className="error-banner">{erro}</p>}

      <section className="controle-pedidos-resumo" aria-label="Resumo do dia">
        <article className="controle-pedidos-kpi">
          <span className="field-label">Recebidos no dia</span>
          <strong>{recebidos}</strong>
          <div className="controle-pedidos-marketplaces">{porMarketplace}</div>
        </article>
        <article className="controle-pedidos-kpi controle-pedidos-kpi--sucesso">
          <span className="field-label">Expedidos</span>
          <strong>{expedidos}</strong>
          <div className="controle-pedidos-barra"><i style={{ width: `${percentualExpedido}%` }} /></div>
          <span className="field-value--muted">{percentualExpedido}% dos pedidos válidos</span>
        </article>
        <article className="controle-pedidos-kpi controle-pedidos-kpi--aviso">
          <span className="field-label">Pendentes</span>
          <strong>{totalPendentes}</strong>
          <span className="field-value--muted">recebidos − expedidos − cancelados</span>
        </article>
        <article className="controle-pedidos-kpi">
          <span className="field-label">Cancelados</span>
          <strong>{cancelados}</strong>
          <span className="field-value--muted">{formatarData(data)} · {semana(data)}</span>
        </article>
      </section>

      <div className="controle-pedidos-turnos">
        {TURNOS.map((turno) => {
          const totalTurno = Object.fromEntries(ETAPAS.map((etapa) => [
            etapa.key,
            MARKETPLACES.reduce((total, marketplace) => total + state[turno.key][marketplace.key][etapa.key], 0),
          ])) as Record<EtapaKey, number>;
          return (
            <section className="controle-pedidos-turno" key={turno.key}>
              <div className="controle-pedidos-turno-cabecalho">
                <div><h2>{turno.nome}</h2><span className="field-value--muted">{turno.horario}</span></div>
                <label className="controle-pedidos-responsavel">
                  <span className="field-label">Responsável</span>
                  <input className="field-input" value={state[turno.key].resp} onChange={(event) => editarTexto(turno.key, "resp", event.target.value)} placeholder="Nome" />
                </label>
              </div>
              <div className="controle-pedidos-tabela-scroll">
                <table className="controle-pedidos-tabela">
                  <thead><tr><th>Marketplace</th>{ETAPAS.map((etapa) => <th key={etapa.key}>{etapa.nome}</th>)}<th>Pendentes</th></tr></thead>
                  <tbody>
                    {MARKETPLACES.map((marketplace) => {
                      const linha = state[turno.key][marketplace.key];
                      const pendente = pendentes(linha);
                      return (
                        <tr key={marketplace.key}>
                          <td className="controle-pedidos-marketplace"><i className="pedido-dot" style={{ background: marketplace.cor }} />{marketplace.nome}</td>
                          {ETAPAS.map((etapa) => (
                            <td key={etapa.key}>
                              <input
                                type="number"
                                min={0}
                                inputMode="numeric"
                                aria-label={`${marketplace.nome} ${etapa.nome} ${turno.nome}`}
                                value={linha[etapa.key] || ""}
                                onChange={(event) => editarNumero(turno.key, marketplace.key, etapa.key, event.target.value)}
                              />
                            </td>
                          ))}
                          <td><span className={`controle-pedidos-pill${pendente < 0 ? " controle-pedidos-pill--negativo" : pendente === 0 ? " controle-pedidos-pill--zero" : ""}`}>{pendente}</span></td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot><tr><td>Total do turno</td>{ETAPAS.map((etapa) => <td key={etapa.key}>{totalTurno[etapa.key]}</td>)}<td>{pendentes(totalTurno as DadosMarketplace)}</td></tr></tfoot>
                </table>
              </div>
              <label className="controle-pedidos-observacao">
                <span className="field-label">Observações do turno</span>
                <textarea className="field-input" value={state[turno.key].obs} onChange={(event) => editarTexto(turno.key, "obs", event.target.value)} placeholder="Ocorrências, coleta atrasada, falta de estoque, etiqueta com erro…" />
              </label>
            </section>
          );
        })}
      </div>

      <section className="controle-pedidos-historico">
        <div className="controle-pedidos-turno-cabecalho"><h2>Últimos dias</h2><span className="field-value--muted">Toque em um dia para abrir</span></div>
        {historico.length === 0 ? (
          <p className="field-value--muted">Os dias preenchidos aparecem aqui.</p>
        ) : (
          <div className="controle-pedidos-tabela-scroll">
            <table className="controle-pedidos-tabela">
              <thead><tr><th>Data</th>{MARKETPLACES.map((marketplace) => <th key={marketplace.key}>{marketplace.nome}</th>)}<th>Recebidos</th><th>Expedidos</th><th>Pendentes</th></tr></thead>
              <tbody>
                {historico.map((dia) => {
                  const dados = normalizarDia(dia);
                  const totalRecebidos = somar("recebidos", dados);
                  const totalExpedidos = somar("expedidos", dados);
                  const totalCancelados = somar("cancelados", dados);
                  return (
                    <tr key={dia.data} className={dia.data === data ? "controle-pedidos-dia-atual" : ""} onClick={() => navegar(dia.data)}>
                      <td>{formatarData(dia.data)} <span className="field-value--muted">{semana(dia.data)}</span></td>
                      {MARKETPLACES.map((marketplace) => (
                        <td key={marketplace.key}>{TURNOS.reduce((soma, turno) => soma + dados[turno.key][marketplace.key].recebidos, 0)}</td>
                      ))}
                      <td>{totalRecebidos}</td><td>{totalExpedidos}</td><td>{totalRecebidos - totalExpedidos - totalCancelados}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

import { useCallback, useEffect, useMemo, useState } from "react";
import { BarrasHorizontais } from "@/Barras";

const API_URL = import.meta.env.VITE_API_URL ?? "";
const POLL_MS = 60_000;

interface DiaRelatorio {
  dia: number;
  data: string;
  semana: string;
  completo: boolean;
  futuro: boolean;
}

interface ColaboradorRelatorio {
  idUsuarioEmbalador: string;
  nome: string;
  bancada?: string;
  porDia: number[];
  total: number;
  diasTrabalhados: number;
}

interface RelatorioMensal {
  mes: string;
  hoje: string;
  pedidosPorHora: number;
  metaMensal: number | null;
  dias: DiaRelatorio[];
  colaboradores: ColaboradorRelatorio[];
  naoIdentificadosPorDia: number[];
  totalPorDia: number[];
  total: number;
}

function mesAtual(): string {
  return new Date().toLocaleDateString("sv-SE").slice(0, 7);
}

function nomeDoMes(mes: string): string {
  const [ano, m] = mes.split("-").map(Number);
  const nome = new Date(ano, m - 1, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  return nome.charAt(0).toUpperCase() + nome.slice(1);
}

function formatarTempo(horas: number): string {
  const total = Math.round(horas * 60);
  return `${Math.floor(total / 60)}h ${String(total % 60).padStart(2, "0")}min`;
}

function numero(n: number, casas = 0): string {
  return n.toLocaleString("pt-BR", { maximumFractionDigits: casas });
}

function pct(n: number): string {
  return `${(n * 100).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}%`;
}

function CardResumo({ rotulo, valor, detalhe, tom }: { rotulo: string; valor: string; detalhe: string; tom: string }) {
  return (
    <div className={`resumo-card resumo-card--${tom}`}>
      <span className="resumo-card-rotulo">{rotulo}</span>
      <span className="resumo-card-valor tabular">{valor}</span>
      <span className="resumo-card-detalhe">{detalhe}</span>
    </div>
  );
}

function AvisoParcial({ dias }: { dias: DiaRelatorio[] }) {
  const parciais = dias.filter((d) => !d.completo && !d.futuro);
  if (parciais.length === 0) return null;
  return (
    <p className="nota-info">
      * {parciais.length === 1 ? `O dia ${parciais[0].dia} ainda está` : `${parciais.length} dias ainda estão`} com dados parciais — o sistema confere os
      dias com o Tiny em segundo plano (um por vez). Antes de fechar a bonificação, confira se não sobrou nenhum dia marcado com *.
    </p>
  );
}

function VisaoDia({ relatorio, diaIdx, setDiaIdx }: { relatorio: RelatorioMensal; diaIdx: number; setDiaIdx: (i: number) => void }) {
  const dia = relatorio.dias[diaIdx];
  const linhas = relatorio.colaboradores
    .map((c) => {
      const media = c.diasTrabalhados > 0 ? c.total / c.diasTrabalhados : 0;
      return { ...c, hoje: c.porDia[diaIdx], media };
    })
    .filter((c) => c.hoje > 0)
    .sort((a, b) => b.hoje - a.hoje);
  const total = relatorio.totalPorDia[diaIdx];
  const naoIdentificados = relatorio.naoIdentificadosPorDia[diaIdx];
  const diasValidos = relatorio.dias.filter((d) => !d.futuro).length;

  return (
    <>
      <div className="dia-navegacao">
        <button type="button" className="refresh-btn" onClick={() => setDiaIdx(diaIdx - 1)} disabled={diaIdx === 0} aria-label="Dia anterior">
          ←
        </button>
        <select className="field-input" value={diaIdx} onChange={(e) => setDiaIdx(Number(e.target.value))} aria-label="Dia">
          {relatorio.dias
            .filter((d) => !d.futuro)
            .map((d) => (
              <option key={d.dia} value={d.dia - 1}>
                {d.data} · {d.semana}
                {d.completo ? "" : " *"}
              </option>
            ))}
        </select>
        <button type="button" className="refresh-btn" onClick={() => setDiaIdx(diaIdx + 1)} disabled={diaIdx >= diasValidos - 1} aria-label="Próximo dia">
          →
        </button>
        {!dia.completo && <span className="nota-info">* dados parciais{dia.data === relatorio.hoje ? " (dia em andamento)" : ""}</span>}
      </div>

      <section className="resumo-grid" aria-label="Resumo do dia">
        <CardResumo rotulo="Pedidos embalados" valor={numero(total)} detalhe={`≈ ${formatarTempo(total / relatorio.pedidosPorHora)} de embalagem`} tom="marca" />
        <CardResumo rotulo="Colaboradores ativos" valor={String(linhas.length)} detalhe="embalaram pelo menos 1 pedido" tom="ocupada" />
        <CardResumo rotulo="Média por colaborador" valor={linhas.length ? numero(total / linhas.length) : "—"} detalhe="pedidos no dia" tom="vazia" />
        <CardResumo rotulo="Destaque do dia" valor={linhas[0] ? linhas[0].nome.split(" ")[0] : "—"} detalhe={linhas[0] ? `${linhas[0].hoje} pedidos` : "ninguém embalou ainda"} tom="baixo" />
      </section>

      {linhas.length === 0 ? (
        <div className="estado-vazio estado-vazio--compacto">
          <p className="estado-vazio-titulo">Nenhum pedido embalado registrado nesse dia.</p>
        </div>
      ) : (
        <div className="painel-duplo">
          <BarrasHorizontais titulo="Ranking do dia (pedidos)" itens={linhas.map((l) => ({ rotulo: l.nome, valor: l.hoje }))} total={total} />
          <section className="painel-card">
            <h2 className="painel-card-titulo">Detalhe</h2>
            <div className="tabela-wrap tabela-wrap--plana">
              <table className="tabela">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Colaborador</th>
                    <th className="tabela-num">Pedidos</th>
                    <th className="tabela-num">Tempo est.</th>
                    <th className="tabela-num" title="Comparado com a média dele nos dias trabalhados do mês">
                      vs. mês
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {linhas.map((l, i) => {
                    const variacao = l.media > 0 ? l.hoje / l.media - 1 : 0;
                    return (
                      <tr key={l.idUsuarioEmbalador}>
                        <td className="tabular">{i + 1}º</td>
                        <td>
                          {l.nome}
                          {l.bancada && <span className="field-value--muted"> · {l.bancada}</span>}
                        </td>
                        <td className="tabela-num tabular">
                          <strong>{l.hoje}</strong>
                        </td>
                        <td className="tabela-num tabular">{formatarTempo(l.hoje / relatorio.pedidosPorHora)}</td>
                        <td className={`tabela-num tabular ${variacao >= 0 ? "variacao--alta" : "variacao--baixa"}`}>
                          {variacao >= 0 ? "▲" : "▼"} {pct(Math.abs(variacao))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
      {naoIdentificados > 0 && <p className="nota-info">+ {naoIdentificados} pedido(s) embalado(s) sem identificação de quem embalou (o Tiny não informou).</p>}
      <p className="nota-info">Tempo estimado = pedidos ÷ {relatorio.pedidosPorHora} pedidos/hora (mesma conta do painel) — não é tempo medido.</p>
    </>
  );
}

function VisaoMes({ relatorio, onMetaSalva }: { relatorio: RelatorioMensal; onMetaSalva: () => void }) {
  const [metaTexto, setMetaTexto] = useState(relatorio.metaMensal !== null ? String(relatorio.metaMensal) : "");
  const [salvandoMeta, setSalvandoMeta] = useState(false);
  const meta = relatorio.metaMensal;
  const diasComPedido = relatorio.totalPorDia.filter((n) => n > 0).length;
  const maxDia = Math.max(1, ...relatorio.totalPorDia);
  const destaque = relatorio.colaboradores[0];

  const salvarMeta = useCallback(async () => {
    setSalvandoMeta(true);
    try {
      await fetch(`${API_URL}/api/embalagem/meta`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ metaMensal: metaTexto.trim() === "" ? null : Number(metaTexto) }),
      });
      onMetaSalva();
    } finally {
      setSalvandoMeta(false);
    }
  }, [metaTexto, onMetaSalva]);

  return (
    <>
      <section className="resumo-grid" aria-label="Resumo do mês">
        <CardResumo rotulo="Pedidos embalados no mês" valor={numero(relatorio.total)} detalhe={`em ${diasComPedido} dia(s) com embalagem`} tom="marca" />
        <CardResumo rotulo="Média por dia" valor={diasComPedido ? numero(relatorio.total / diasComPedido) : "—"} detalhe="nos dias com embalagem" tom="vazia" />
        <CardResumo rotulo="Destaque do mês" valor={destaque && destaque.total > 0 ? destaque.nome.split(" ")[0] : "—"} detalhe={destaque ? `${numero(destaque.total)} pedidos` : ""} tom="baixo" />
        <CardResumo
          rotulo="Meta por colaborador"
          valor={meta ? numero(meta) : "—"}
          detalhe={meta ? `${relatorio.colaboradores.filter((c) => c.total >= meta).length} bateram a meta` : "defina abaixo, se houver"}
          tom="ocupada"
        />
      </section>

      <section className="painel-card">
        <h2 className="painel-card-titulo">Pedidos embalados por dia</h2>
        <div className="colunas-dia" role="img" aria-label="Gráfico de pedidos embalados por dia do mês">
          {relatorio.dias.map((d, i) => (
            <div
              key={d.dia}
              className={`colunas-dia-item${d.semana === "DOM" || d.semana === "SÁB" ? " colunas-dia-item--fds" : ""}`}
              title={`${d.data} (${d.semana}): ${d.futuro ? "—" : `${relatorio.totalPorDia[i]} pedidos`}${!d.completo && !d.futuro ? " · parcial" : ""}`}
            >
              <span className="colunas-dia-barra-area">
                {!d.futuro && <span className={`colunas-dia-barra${d.completo ? "" : " colunas-dia-barra--parcial"}`} style={{ height: `${(relatorio.totalPorDia[i] / maxDia) * 100}%` }} />}
              </span>
              <span className="colunas-dia-rotulo tabular">{d.dia}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="painel-card">
        <div className="painel-card-cabecalho">
          <h2 className="painel-card-titulo">Relatório de desempenho mensal</h2>
          <div className="meta-form">
            <label className="filtro-campo">
              <span className="field-label">Meta mensal por colaborador</span>
              <input className="field-input" type="number" min={0} value={metaTexto} onChange={(e) => setMetaTexto(e.target.value)} placeholder="Ex.: 7500" />
            </label>
            <button type="button" className="refresh-btn" onClick={() => void salvarMeta()} disabled={salvandoMeta}>
              {salvandoMeta ? "Salvando..." : "Salvar meta"}
            </button>
            <a className="btn-primario" href={`${API_URL}/api/embalagem/relatorio.xlsx?mes=${relatorio.mes}`} download>
              Baixar Excel
            </a>
          </div>
        </div>

        <div className="tabela-wrap tabela-wrap--plana">
          <table className="tabela matriz-mensal">
            <thead>
              <tr>
                <th className="matriz-fixa">Funcionário</th>
                <th className="tabela-num">Total</th>
                <th className="tabela-num">Dias</th>
                <th className="tabela-num">Média</th>
                {meta && <th className="tabela-num matriz-separador">% meta</th>}
                {relatorio.dias.map((d) => (
                  <th
                    key={d.dia}
                    className={`matriz-dia${d.semana === "DOM" || d.semana === "SÁB" ? " matriz-dia--fds" : ""}`}
                    title={!d.completo && !d.futuro ? "Dados parciais" : undefined}
                  >
                    <span>
                      {d.dia}
                      {!d.completo && !d.futuro ? "*" : ""}
                    </span>
                    <span className="matriz-semana">{d.semana}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {relatorio.colaboradores.map((c) => (
                <tr key={c.idUsuarioEmbalador}>
                  <td className="matriz-fixa">
                    {c.nome}
                    {c.bancada && <span className="field-value--muted"> · {c.bancada}</span>}
                  </td>
                  <td className="tabela-num tabular">
                    <strong>{numero(c.total)}</strong>
                  </td>
                  <td className="tabela-num tabular">{c.diasTrabalhados}</td>
                  <td className="tabela-num tabular">{c.diasTrabalhados ? numero(c.total / c.diasTrabalhados) : "—"}</td>
                  {meta && (
                    <td className={`tabela-num tabular matriz-separador ${c.total >= meta ? "variacao--alta" : ""}`}>
                      {pct(c.total / meta)}
                    </td>
                  )}
                  {c.porDia.map((n, i) => (
                    <td key={i} className={`tabela-num tabular matriz-dia${relatorio.dias[i].semana === "DOM" || relatorio.dias[i].semana === "SÁB" ? " matriz-dia--fds" : ""}`}>
                      {relatorio.dias[i].futuro ? "" : n > 0 ? n : <span className="matriz-zero">·</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td className="matriz-fixa">Total do dia</td>
                <td className="tabela-num tabular">{numero(relatorio.total)}</td>
                <td colSpan={2} />
                {meta && <td className="matriz-separador" />}
                {relatorio.totalPorDia.map((n, i) => (
                  <td key={i} className="tabela-num tabular matriz-dia">
                    {relatorio.dias[i].futuro ? "" : n}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      </section>
      <AvisoParcial dias={relatorio.dias} />
    </>
  );
}

export function EmbalagemRelatorio() {
  const [visao, setVisao] = useState<"dia" | "mes">("dia");
  const [mes, setMes] = useState(mesAtual);
  const [relatorio, setRelatorio] = useState<RelatorioMensal | null>(null);
  const [diaEscolhido, setDiaEscolhido] = useState<number | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      const resposta = await fetch(`${API_URL}/api/embalagem/relatorio?mes=${mes}`, { cache: "no-store" });
      const json = await resposta.json();
      if (!resposta.ok) throw new Error(json.erro ?? "Não consegui carregar o relatório.");
      setRelatorio(json);
      setErro(null);
    } catch (error) {
      setErro(error instanceof Error ? error.message : "Não consegui carregar o relatório.");
    }
  }, [mes]);

  useEffect(() => {
    const kickoff = setTimeout(() => void carregar(), 0);
    const id = setInterval(() => void carregar(), POLL_MS);
    return () => {
      clearTimeout(kickoff);
      clearInterval(id);
    };
  }, [carregar]);

  // Dia padrão: hoje se o mês é o atual; senão o último dia do mês.
  const diaIdx = useMemo(() => {
    if (!relatorio) return 0;
    const validos = relatorio.dias.filter((d) => !d.futuro).length;
    const padrao = Math.max(0, validos - 1);
    return diaEscolhido !== null && diaEscolhido < validos ? diaEscolhido : padrao;
  }, [relatorio, diaEscolhido]);

  return (
    <>
      <div className="filtro-barra">
        <div className="alternar-visao" role="group" aria-label="Período do relatório">
          <button type="button" className={`alternar-visao-btn${visao === "dia" ? " alternar-visao-btn--ativo" : ""}`} aria-pressed={visao === "dia"} onClick={() => setVisao("dia")}>
            Dia
          </button>
          <button type="button" className={`alternar-visao-btn${visao === "mes" ? " alternar-visao-btn--ativo" : ""}`} aria-pressed={visao === "mes"} onClick={() => setVisao("mes")}>
            Mês
          </button>
        </div>
        <input
          className="field-input"
          type="month"
          aria-label="Mês"
          value={mes}
          max={mesAtual()}
          onChange={(e) => {
            if (!e.target.value) return;
            setMes(e.target.value);
            setDiaEscolhido(null);
          }}
        />
        <span className="nota-info">{nomeDoMes(mes)}</span>
      </div>

      {erro && <p className="error-banner">{erro}</p>}
      {!relatorio ? (
        <p className="nota-info">Carregando relatório…</p>
      ) : relatorio.mes !== mes ? (
        <p className="nota-info">Carregando {nomeDoMes(mes)}…</p>
      ) : visao === "dia" ? (
        <VisaoDia relatorio={relatorio} diaIdx={diaIdx} setDiaIdx={setDiaEscolhido} />
      ) : (
        <VisaoMes key={`${relatorio.mes}-${relatorio.metaMensal}`} relatorio={relatorio} onMetaSalva={() => void carregar()} />
      )}
    </>
  );
}

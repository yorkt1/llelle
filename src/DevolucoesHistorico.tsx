import { useCallback, useEffect, useMemo, useState } from "react";

const API_URL = import.meta.env.VITE_API_URL ?? "";

interface RegistroDevolucao {
  id: string;
  data: string;
  nf: string;
  idPedido: string;
  cliente: string;
  marketplace: string;
  ocorrencia: string;
  quantidade: number;
  produto: string;
  codigoProduto: string;
  status: string;
  reembolso: string;
  valorReembolso?: number;
  origem: "tela" | "planilha";
  registradoEm: string;
}

interface VendasAgregadas {
  porProduto: Record<string, { quantidade: number; descricao: string }>;
  diasComDados: number;
  diasNoPeriodo: number;
}

function isoHoje(): string {
  return new Date().toLocaleDateString("sv-SE"); // aaaa-mm-dd no fuso local
}

function isoDiasAtras(dias: number): string {
  const d = new Date();
  d.setDate(d.getDate() - dias);
  return d.toLocaleDateString("sv-SE");
}

function isoParaBr(iso: string): string {
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
}

function pct(parte: number, total: number): string {
  return total > 0 ? `${((parte / total) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%` : "—";
}

function contarPor(registros: RegistroDevolucao[], campo: (r: RegistroDevolucao) => string): { rotulo: string; unidades: number }[] {
  const mapa = new Map<string, number>();
  for (const r of registros) {
    const chave = campo(r) || "Não informado";
    mapa.set(chave, (mapa.get(chave) ?? 0) + r.quantidade);
  }
  return [...mapa.entries()].map(([rotulo, unidades]) => ({ rotulo, unidades })).sort((a, b) => b.unidades - a.unidades);
}

/** Lista de barras horizontais (uma série só: cor única, valor em texto ao lado, nunca cor sozinha). */
function BarrasHorizontais({ titulo, itens, total }: { titulo: string; itens: { rotulo: string; unidades: number }[]; total: number }) {
  const maximo = Math.max(1, ...itens.map((i) => i.unidades));
  return (
    <section className="painel-card">
      <h2 className="painel-card-titulo">{titulo}</h2>
      {itens.length === 0 ? (
        <p className="field-value--muted">Sem dados no período.</p>
      ) : (
        <ul className="barras">
          {itens.map((item) => (
            <li key={item.rotulo} className="barras-item" title={`${item.rotulo}: ${item.unidades} un. (${pct(item.unidades, total)})`}>
              <span className="barras-rotulo">{item.rotulo}</span>
              <span className="barras-trilho" aria-hidden="true">
                <span className="barras-barra" style={{ width: `${(item.unidades / maximo) * 100}%` }} />
              </span>
              <span className="barras-valor tabular">
                {item.unidades} <span className="field-value--muted">· {pct(item.unidades, total)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ModalImportar({ onFechar, onImportado }: { onFechar: () => void; onImportado: (mensagem: string) => void }) {
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const importar = useCallback(async () => {
    setEnviando(true);
    setErro(null);
    try {
      const resposta = await fetch(`${API_URL}/api/devolucao/historico/importar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texto }),
      });
      const json = await resposta.json();
      if (!resposta.ok) throw new Error(json.erro ?? "Não consegui importar.");
      onImportado(
        `${json.novos} nova(s), ${json.atualizados} atualizada(s)${json.ignoradas ? `, ${json.ignoradas} linha(s) ignorada(s) (sem data, NF ou produto)` : ""}.`,
      );
    } catch (error) {
      setErro(error instanceof Error ? error.message : "Não consegui importar.");
    } finally {
      setEnviando(false);
    }
  }, [texto, onImportado]);

  return (
    <div className="settings-overlay" onClick={onFechar}>
      <div className="settings-panel settings-panel--largo" onClick={(event) => event.stopPropagation()}>
        <div className="settings-panel-header">
          <button className="settings-close" onClick={onFechar} aria-label="Fechar">
            ×
          </button>
          <h2 className="settings-title">Importar da planilha</h2>
          <p className="settings-hint">
            Selecione as linhas na planilha de devoluções (colunas A até O, sem o cabeçalho), copie e cole aqui. Linha que já está no histórico
            (mesma NF + produto) é atualizada, não duplicada.
          </p>
        </div>
        <div className="settings-panel-body">
          <label className="field">
            <span className="field-label">Linhas copiadas</span>
            <textarea className="field-input importar-textarea" value={texto} onChange={(event) => setTexto(event.target.value)} autoFocus />
          </label>
        </div>
        <div className="settings-panel-footer">
          {erro && <p className="error-banner">{erro}</p>}
          <button className="btn-primario" onClick={() => void importar()} disabled={enviando || !texto.trim()}>
            {enviando ? "Importando..." : "Importar"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function DevolucoesHistorico() {
  const [de, setDe] = useState(() => isoDiasAtras(89));
  const [ate, setAte] = useState(isoHoje);
  const [marketplace, setMarketplace] = useState("");
  const [ocorrencia, setOcorrencia] = useState("");
  const [registros, setRegistros] = useState<RegistroDevolucao[]>([]);
  const [vendas, setVendas] = useState<VendasAgregadas | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [importando, setImportando] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const resposta = await fetch(`${API_URL}/api/devolucao/historico?de=${de}&ate=${ate}`, { cache: "no-store" });
      const json = await resposta.json();
      if (!resposta.ok) throw new Error(json.erro ?? "Não consegui carregar o histórico.");
      setRegistros(json.registros ?? []);
      setVendas(json.vendasPorCodigo ?? null);
    } catch (error) {
      setErro(error instanceof Error ? error.message : "Não consegui carregar o histórico.");
    } finally {
      setCarregando(false);
    }
  }, [de, ate]);

  useEffect(() => {
    const kickoff = setTimeout(() => void carregar(), 0);
    return () => clearTimeout(kickoff);
  }, [carregar]);

  const filtrados = useMemo(
    () => registros.filter((r) => (!marketplace || r.marketplace === marketplace) && (!ocorrencia || r.ocorrencia === ocorrencia)),
    [registros, marketplace, ocorrencia],
  );

  const marketplaces = useMemo(() => [...new Set(registros.map((r) => r.marketplace).filter(Boolean))].sort(), [registros]);
  const ocorrencias = useMemo(() => [...new Set(registros.map((r) => r.ocorrencia).filter(Boolean))].sort(), [registros]);

  const unidades = filtrados.reduce((s, r) => s + r.quantidade, 0);
  const porMotivo = contarPor(filtrados, (r) => r.ocorrencia);
  const porMarketplace = contarPor(filtrados, (r) => r.marketplace);
  const valorReembolsado = filtrados.reduce((s, r) => s + (r.valorReembolso ?? 0), 0);

  // Taxa só com vendas do período inteiro coletadas — com cobertura parcial o denominador fica
  // pequeno e a taxa sairia inflada.
  const vendasCompletas = vendas !== null && vendas.diasComDados >= vendas.diasNoPeriodo - 1;
  const porProduto = useMemo(() => {
    const mapa = new Map<string, { produto: string; codigo: string; unidades: number; motivos: Map<string, number> }>();
    for (const r of filtrados) {
      const chave = r.codigoProduto || r.produto;
      const atual = mapa.get(chave) ?? { produto: r.produto, codigo: r.codigoProduto, unidades: 0, motivos: new Map() };
      atual.unidades += r.quantidade;
      atual.motivos.set(r.ocorrencia || "—", (atual.motivos.get(r.ocorrencia || "—") ?? 0) + r.quantidade);
      mapa.set(chave, atual);
    }
    return [...mapa.values()]
      .map((p) => {
        const principal = [...p.motivos.entries()].sort((a, b) => b[1] - a[1])[0];
        const vendidas = p.codigo ? vendas?.porProduto[p.codigo]?.quantidade : undefined;
        return { ...p, principal: principal?.[0] ?? "—", vendidas };
      })
      .sort((a, b) => b.unidades - a.unidades);
  }, [filtrados, vendas]);

  const remover = useCallback(
    async (registro: RegistroDevolucao) => {
      if (!window.confirm(`Remover do histórico a devolução da NF ${registro.nf} (${registro.produto})?`)) return;
      const resposta = await fetch(`${API_URL}/api/devolucao/historico`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: registro.id, registradoEm: registro.registradoEm }),
      });
      if (resposta.ok) setRegistros((atuais) => atuais.filter((r) => r.id !== registro.id));
      else setErro("Não consegui remover esse registro agora.");
    },
    [],
  );

  return (
    <>
      <div className="filtro-barra">
        <label className="filtro-campo">
          <span className="field-label">De</span>
          <input className="field-input" type="date" value={de} max={ate} onChange={(event) => setDe(event.target.value)} />
        </label>
        <label className="filtro-campo">
          <span className="field-label">Até</span>
          <input className="field-input" type="date" value={ate} min={de} onChange={(event) => setAte(event.target.value)} />
        </label>
        <label className="filtro-campo">
          <span className="field-label">Marketplace</span>
          <select className="field-input" value={marketplace} onChange={(event) => setMarketplace(event.target.value)}>
            <option value="">Todos</option>
            {marketplaces.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </label>
        <label className="filtro-campo">
          <span className="field-label">Ocorrência</span>
          <select className="field-input" value={ocorrencia} onChange={(event) => setOcorrencia(event.target.value)}>
            <option value="">Todas</option>
            {ocorrencias.map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
        </label>
        <button type="button" className="refresh-btn filtro-acao" onClick={() => setImportando(true)}>
          Importar da planilha
        </button>
      </div>

      {erro && <p className="error-banner">{erro}</p>}
      {aviso && <p className="aviso-sucesso">{aviso}</p>}

      <section className="resumo-grid" aria-label="Resumo das devoluções">
        <div className="resumo-card resumo-card--marca">
          <span className="resumo-card-rotulo">Unidades devolvidas</span>
          <span className="resumo-card-valor tabular">{unidades}</span>
          <span className="resumo-card-detalhe">em {filtrados.length} registro(s)</span>
        </div>
        <div className="resumo-card resumo-card--baixo">
          <span className="resumo-card-rotulo">Principal motivo</span>
          <span className="resumo-card-valor resumo-card-valor--texto">{porMotivo[0]?.rotulo ?? "—"}</span>
          <span className="resumo-card-detalhe">{porMotivo[0] ? `${pct(porMotivo[0].unidades, unidades)} das unidades` : "sem dados"}</span>
        </div>
        <div className="resumo-card resumo-card--vazia">
          <span className="resumo-card-rotulo">Taxa de devolução</span>
          <span className="resumo-card-valor tabular">
            {vendasCompletas ? pct(porProduto.reduce((s, p) => s + (p.vendidas !== undefined ? p.unidades : 0), 0), porProduto.reduce((s, p) => s + (p.vendidas ?? 0), 0)) : "—"}
          </span>
          <span className="resumo-card-detalhe">
            {vendasCompletas ? "dos produtos devolvidos, sobre o vendido" : `vendas coletadas: ${vendas?.diasComDados ?? 0} de ${vendas?.diasNoPeriodo ?? "?"} dias`}
          </span>
        </div>
        <div className="resumo-card resumo-card--ocupada">
          <span className="resumo-card-rotulo">Reembolsado (Shopee)</span>
          <span className="resumo-card-valor tabular">{valorReembolsado.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })}</span>
          <span className="resumo-card-detalhe">só o que veio raspado do Shopee</span>
        </div>
      </section>

      <div className="painel-duplo">
        <BarrasHorizontais titulo="Por motivo (unidades)" itens={porMotivo} total={unidades} />
        <BarrasHorizontais titulo="Por marketplace (unidades)" itens={porMarketplace} total={unidades} />
      </div>

      <section className="painel-card">
        <h2 className="painel-card-titulo">Produtos que mais voltam</h2>
        {porProduto.length === 0 ? (
          <p className="field-value--muted">Sem devoluções no período.</p>
        ) : (
          <div className="tabela-wrap tabela-wrap--plana">
            <table className="tabela">
              <thead>
                <tr>
                  <th>Produto</th>
                  <th className="tabela-num">Devolvidas</th>
                  <th>Principal motivo</th>
                  <th className="tabela-num">Vendidas no período</th>
                  <th className="tabela-num">Taxa</th>
                </tr>
              </thead>
              <tbody>
                {porProduto.slice(0, 15).map((p) => (
                  <tr key={p.codigo || p.produto}>
                    <td>
                      {p.produto}
                      {p.codigo && <span className="field-value--muted"> · {p.codigo}</span>}
                    </td>
                    <td className="tabela-num tabular">{p.unidades}</td>
                    <td>{p.principal}</td>
                    <td className="tabela-num tabular">{vendasCompletas && p.vendidas !== undefined ? p.vendidas : "—"}</td>
                    <td className="tabela-num tabular">{vendasCompletas && p.vendidas ? pct(p.unidades, p.vendidas) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="painel-card">
        <h2 className="painel-card-titulo">Registros ({filtrados.length})</h2>
        {carregando ? (
          <p className="nota-info">Carregando…</p>
        ) : filtrados.length === 0 ? (
          <div className="estado-vazio estado-vazio--compacto">
            <p className="estado-vazio-titulo">Nenhuma devolução registrada nesse período.</p>
            <p className="field-value--muted">Toda linha copiada em "Registrar" entra aqui sozinha. Pra trazer o histórico antigo, importe da planilha.</p>
            <button type="button" className="btn-primario" onClick={() => setImportando(true)}>
              Importar da planilha
            </button>
          </div>
        ) : (
          <div className="tabela-wrap tabela-wrap--plana">
            <table className="tabela">
              <thead>
                <tr>
                  <th>Data</th>
                  <th>NF</th>
                  <th>Cliente</th>
                  <th>Marketplace</th>
                  <th>Produto</th>
                  <th className="tabela-num">Qtd</th>
                  <th>Ocorrência</th>
                  <th>Status</th>
                  <th>Reembolso</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtrados.map((r) => (
                  <tr key={r.id}>
                    <td className="tabular">{isoParaBr(r.data)}</td>
                    <td>{r.nf}</td>
                    <td>{r.cliente}</td>
                    <td>{r.marketplace}</td>
                    <td>{r.produto}</td>
                    <td className="tabela-num tabular">{r.quantidade}</td>
                    <td>{r.ocorrencia}</td>
                    <td>{r.status || "—"}</td>
                    <td>{r.reembolso || "—"}</td>
                    <td>
                      <button type="button" className="refresh-btn" onClick={() => void remover(r)}>
                        Remover
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {importando && (
        <ModalImportar
          onFechar={() => setImportando(false)}
          onImportado={(mensagem) => {
            setImportando(false);
            setAviso(`Importação concluída: ${mensagem}`);
            void carregar();
          }}
        />
      )}
    </>
  );
}

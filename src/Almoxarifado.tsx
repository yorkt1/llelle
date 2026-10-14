import { useEffect, useState, type FormEvent } from "react";
import { PageHeader } from "@/PageHeader";
import type { EstadoAlmoxarifado, ItemAlmox, MovimentacaoAlmox } from "../lib/almoxarifado";

const API_URL = import.meta.env.VITE_API_URL ?? "";
const INTERVALO_ATUALIZACAO = 30_000;

function numero(valor: number | string): number | null {
  if (valor === "" || valor === null) return null;
  const convertido = Number(String(valor).replace(/\./g, "").replace(",", "."));
  return Number.isFinite(convertido) ? convertido : null;
}

function formatar(valor: number | string): string {
  const convertido = numero(valor);
  return convertido === null ? String(valor) : convertido.toLocaleString("pt-BR");
}

function statusItem(item: ItemAlmox): "baixo" | "atencao" | "ok" | "sem-minimo" {
  const saldo = numero(item.saldo);
  const minimo = numero(item.minimo);
  if (saldo === null || minimo === null || minimo <= 0) return "sem-minimo";
  if (saldo < minimo) return "baixo";
  if (saldo <= minimo * 1.25) return "atencao";
  return "ok";
}

function baixarCsv(nome: string, linhas: (string | number)[][]): void {
  const csv = linhas.map((linha) => linha.map((valor) => `"${String(valor).replace(/"/g, '""')}"`).join(";")).join("\n");
  const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = nome;
  link.click();
  URL.revokeObjectURL(url);
}

function AlmoxarifadoItem({
  item,
  salvando,
  onAtualizar,
  onMovimentar,
  onAbrirMovimento,
  onRemover,
}: {
  item: ItemAlmox;
  salvando: boolean;
  onAtualizar: (id: string, dados: Partial<ItemAlmox>) => void;
  onMovimentar: (id: string, tipo: "entrada" | "saida", quantidade: number) => void;
  onAbrirMovimento: (id: string) => void;
  onRemover: (id: string) => void;
}) {
  const [nome, setNome] = useState(item.nome);
  const [saldo, setSaldo] = useState(String(item.saldo));
  const [minimo, setMinimo] = useState(String(item.minimo));
  const [passo, setPasso] = useState(String(item.passo));
  const status = statusItem(item);
  const saldoNumerico = numero(item.saldo);
  const minimoNumerico = numero(item.minimo);
  const percentual = saldoNumerico !== null && minimoNumerico && minimoNumerico > 0
    ? Math.min(100, Math.max(0, (saldoNumerico / (minimoNumerico * 2)) * 100))
    : 0;

  function salvarSaldo(): void {
    const valor = saldo.trim();
    if (!valor) return;
    const numerico = Number(valor.replace(/\./g, "").replace(",", "."));
    onAtualizar(item.id, { saldo: Number.isSafeInteger(numerico) && numerico >= 0 ? numerico : valor });
  }

  function salvarMinimo(): void {
    const valor = minimo.trim();
    const numerico = Number(valor.replace(/\./g, "").replace(",", "."));
    if (!valor) onAtualizar(item.id, { minimo: "" });
    else if (Number.isSafeInteger(numerico) && numerico >= 0) onAtualizar(item.id, { minimo: numerico });
  }

  function salvarPasso(): void {
    const numerico = Number(passo);
    if (Number.isSafeInteger(numerico) && numerico > 0) onAtualizar(item.id, { passo: numerico });
  }

  return (
    <article className={`almox-card almox-card--${status}`}>
      <header className="almox-card-topo">
        <input
          className="almox-nome"
          aria-label={`Nome do item ${item.nome}`}
          value={nome}
          onChange={(event) => setNome(event.target.value)}
          onBlur={() => nome.trim() && nome.trim() !== item.nome && onAtualizar(item.id, { nome: nome.trim() })}
          onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
          disabled={salvando}
        />
        <button
          type="button"
          className="almox-remover"
          aria-label={`Remover ${item.nome}`}
          title="Remover item"
          onClick={() => onRemover(item.id)}
          disabled={salvando}
        >
          ×
        </button>
      </header>

      <div className="almox-quantidade">
        <button
          type="button"
          aria-label={`Registrar saída de ${item.passo} ${item.unidade} de ${item.nome}`}
          onClick={() => onMovimentar(item.id, "saida", item.passo)}
          disabled={salvando || saldoNumerico === null || saldoNumerico <= 0}
        >
          −
        </button>
        <input
          aria-label={`Saldo de ${item.nome}`}
          inputMode="numeric"
          value={saldo}
          onChange={(event) => setSaldo(event.target.value)}
          onBlur={salvarSaldo}
          onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
          disabled={salvando}
        />
        <button
          type="button"
          aria-label={`Registrar entrada de ${item.passo} ${item.unidade} de ${item.nome}`}
          onClick={() => onMovimentar(item.id, "entrada", item.passo)}
          disabled={salvando || saldoNumerico === null}
        >
          +
        </button>
      </div>
      <p className="almox-unidade">
        {item.unidade}{item.saldoSecundario !== undefined ? ` (${formatar(item.saldoSecundario)} ${item.unidadeSecundaria})` : ""}
      </p>
      <div className="almox-barra" aria-label={`Estoque relativo ao mínimo: ${Math.round(percentual)}%`}>
        <span style={{ width: `${percentual}%` }} />
        <i />
      </div>
      <p className="almox-status" role="status">
        {status === "baixo" ? `Repor agora: faltam ${formatar(Math.max(0, (minimoNumerico ?? 0) - (saldoNumerico ?? 0)))} ${item.unidade}` :
          status === "atencao" ? "Atenção: perto do mínimo" :
            status === "ok" ? "Estoque ok" : "Sem mínimo definido"}
      </p>
      <div className="almox-ajustes">
        <label>
          Mínimo
          <input
            aria-label={`Mínimo de ${item.nome}`}
            inputMode="numeric"
            value={minimo}
            onChange={(event) => setMinimo(event.target.value)}
            onBlur={salvarMinimo}
            onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
            disabled={salvando}
          />
        </label>
        <label>
          Passo ±
          <input
            aria-label={`Passo de ${item.nome}`}
            inputMode="numeric"
            value={passo}
            onChange={(event) => setPasso(event.target.value)}
            onBlur={salvarPasso}
            onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
            disabled={salvando}
          />
        </label>
      </div>
      <button type="button" className="almox-registrar" onClick={() => onAbrirMovimento(item.id)} disabled={salvando}>
        Registrar movimentação
      </button>
    </article>
  );
}

export function Almoxarifado() {
  const [estado, setEstado] = useState<EstadoAlmoxarifado | null>(null);
  const [categoriaAtiva, setCategoriaAtiva] = useState("embalagens");
  const [busca, setBusca] = useState("");
  const [filtroHistorico, setFiltroHistorico] = useState("");
  const [somenteReposicao, setSomenteReposicao] = useState(false);
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [formNovo, setFormNovo] = useState(false);
  const [novoNome, setNovoNome] = useState("");
  const [novoMinimo, setNovoMinimo] = useState("");
  const [novaUnidade, setNovaUnidade] = useState("unidades");
  const [movimentoItemId, setMovimentoItemId] = useState("");
  const [movimentoAberto, setMovimentoAberto] = useState(false);
  const [movimentoTipo, setMovimentoTipo] = useState<"entrada" | "saida">("entrada");
  const [movimentoQuantidade, setMovimentoQuantidade] = useState("");
  const [movimentoObservacao, setMovimentoObservacao] = useState("");

  useEffect(() => {
    let ativo = true;
    const carregar = async () => {
      try {
        const response = await fetch(`${API_URL}/api/almoxarifado`, { cache: "no-store" });
        const json = await response.json();
        if (!response.ok) throw new Error(json.error ?? `API respondeu ${response.status}.`);
        if (ativo) {
          setEstado(json.estado);
          setErro("");
        }
      } catch (error) {
        if (ativo) setErro(error instanceof Error ? error.message : "Não consegui carregar o almoxarifado.");
      } finally {
        if (ativo) setCarregando(false);
      }
    };
    void carregar();
    const intervalo = window.setInterval(() => void carregar(), INTERVALO_ATUALIZACAO);
    return () => {
      ativo = false;
      window.clearInterval(intervalo);
    };
  }, []);

  useEffect(() => {
    const formulario = document.querySelector(".almox-mov-form");
    if (movimentoAberto && typeof formulario?.scrollIntoView === "function") {
      formulario.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [movimentoAberto]);

  async function solicitar(url: string, init?: RequestInit): Promise<boolean> {
    setSalvando(true);
    setErro("");
    try {
      const response = await fetch(`${API_URL}/api/almoxarifado${url}`, {
        ...init,
        headers: { "Content-Type": "application/json", ...init?.headers },
      });
      const json = response.status === 204 ? {} : await response.json();
      if (!response.ok) throw new Error(json.error ?? `API respondeu ${response.status}.`);
      if (json.estado) setEstado(json.estado);
      return true;
    } catch (error) {
      setErro(error instanceof Error ? error.message : "Não consegui salvar a alteração.");
      return false;
    } finally {
      setSalvando(false);
    }
  }

  const categorias = estado?.categorias ?? [];
  const itens = categorias.flatMap((categoria) => categoria.itens.map((item) => ({ categoria, item })));
  const itensCategoria = itens.filter(({ categoria }) => categoriaAtiva === "historico" || categoria.id === categoriaAtiva);
  const itensVisiveis = itensCategoria.filter(({ item }) => {
    const correspondeBusca = item.nome.toLocaleLowerCase("pt-BR").includes(busca.trim().toLocaleLowerCase("pt-BR"));
    const abaixoDoMinimo = statusItem(item) === "baixo" || statusItem(item) === "atencao";
    return categoriaAtiva !== "historico" && correspondeBusca && (!somenteReposicao || abaixoDoMinimo);
  });
  const totalBaixo = itens.filter(({ item }) => statusItem(item) === "baixo").length;
  const historico = (estado?.historico ?? []).filter((movimento) => {
    const texto = `${movimento.itemNome} ${movimento.observacao}`.toLocaleLowerCase("pt-BR");
    return texto.includes(busca.trim().toLocaleLowerCase("pt-BR")) && (!filtroHistorico || movimento.tipo === filtroHistorico);
  }).slice().reverse();

  async function mover(itemId: string, tipo: "entrada" | "saida", quantidade: number, observacao = ""): Promise<boolean> {
    return solicitar("/movimentacoes", {
      method: "POST",
      body: JSON.stringify({ itemId, tipo, quantidade, observacao }),
    });
  }

  async function enviarMovimentacao(event: FormEvent): Promise<void> {
    event.preventDefault();
    const quantidade = Number(movimentoQuantidade);
    if (!Number.isSafeInteger(quantidade) || quantidade < 1 || !movimentoItemId) {
      setErro("Selecione um item e informe uma quantidade inteira maior que zero.");
      return;
    }
    const salvo = await mover(movimentoItemId, movimentoTipo, quantidade, movimentoObservacao);
    if (!salvo) return;
    setMovimentoQuantidade("");
    setMovimentoObservacao("");
  }

  async function adicionarItem(event: FormEvent): Promise<void> {
    event.preventDefault();
    const categoriaId = categoriaAtiva === "historico" ? categorias[0]?.id : categoriaAtiva;
    const minimo = novoMinimo.trim() ? Number(novoMinimo) : null;
    if (!categoriaId || !novoNome.trim() || (minimo !== null && (!Number.isSafeInteger(minimo) || minimo < 0))) {
      setErro("Confira o nome e o mínimo do novo item.");
      return;
    }
    const salvo = await solicitar("/itens", {
      method: "POST",
      body: JSON.stringify({ categoriaId, nome: novoNome, minimo, unidade: novaUnidade }),
    });
    if (!salvo) return;
    setNovoNome("");
    setNovoMinimo("");
    setFormNovo(false);
  }

  function exportar(): void {
    if (!estado) return;
    if (categoriaAtiva === "historico") {
      const linhas: (string | number)[][] = [["Data", "Item", "Tipo", "Quantidade", "Unidade", "Saldo", "Observação"]];
      for (const movimento of historico) {
        linhas.push([new Date(movimento.criadoEm).toLocaleString("pt-BR"), movimento.itemNome, movimento.tipo, movimento.quantidade, movimento.unidade, movimento.saldo, movimento.observacao]);
      }
      baixarCsv("historico-almoxarifado.csv", linhas);
      return;
    }
    const linhas: (string | number)[][] = [["Categoria", "Item", "Saldo", "Unidade", "Mínimo", "Situação"]];
    for (const { categoria, item } of itens.filter(({ categoria: itemCategoria }) => itemCategoria.id === categoriaAtiva)) {
      const status = statusItem(item);
      linhas.push([categoria.nome, item.nome, item.saldo, item.unidade, item.minimo, status]);
    }
    baixarCsv("estoque-almoxarifado.csv", linhas);
  }

  return (
    <div className="page pagina-formulario almox-pagina">
      <PageHeader titulo="Almoxarifado">
        <span className="almox-total-alerta" role="status">{totalBaixo ? `${totalBaixo} ${totalBaixo === 1 ? "item abaixo" : "itens abaixo"} do mínimo` : "Estoque acima do mínimo"}</span>
      </PageHeader>

      {erro && <p className="error-banner" role="alert">{erro}</p>}
      {carregando && <p className="field-value--muted">Carregando estoque...</p>}

      <nav className="almox-abas" aria-label="Categorias do almoxarifado">
        {categorias.map((categoria) => {
          const abaixo = categoria.itens.filter((item) => statusItem(item) === "baixo").length;
          return (
            <button
              type="button"
              key={categoria.id}
              className={categoriaAtiva === categoria.id ? "almox-aba almox-aba--ativa" : "almox-aba"}
              aria-pressed={categoriaAtiva === categoria.id}
              onClick={() => setCategoriaAtiva(categoria.id)}
            >
              {categoria.nome}{abaixo > 0 && <span>{abaixo}</span>}
            </button>
          );
        })}
        <button
          type="button"
          className={categoriaAtiva === "historico" ? "almox-aba almox-aba--ativa" : "almox-aba"}
          aria-pressed={categoriaAtiva === "historico"}
          onClick={() => setCategoriaAtiva("historico")}
        >
          Histórico
        </button>
      </nav>

      <div className="almox-ferramentas">
        <input
          type="search"
          aria-label={categoriaAtiva === "historico" ? "Buscar no histórico" : "Buscar item"}
          placeholder={categoriaAtiva === "historico" ? "Buscar no histórico..." : "Buscar item..."}
          value={busca}
          onChange={(event) => setBusca(event.target.value)}
        />
        {categoriaAtiva === "historico" ? (
          <select aria-label="Tipo de movimento no histórico" value={filtroHistorico} onChange={(event) => setFiltroHistorico(event.target.value)}>
            <option value="">Todas as movimentações</option>
            <option value="entrada">Só entradas</option>
            <option value="saida">Só saídas</option>
            <option value="ajuste">Só ajustes</option>
          </select>
        ) : (
          <label className="almox-filtro">
            <input type="checkbox" checked={somenteReposicao} onChange={(event) => setSomenteReposicao(event.target.checked)} />
            Só reposição
          </label>
        )}
        <button type="button" className="btn-primario" onClick={() => setFormNovo((atual) => !atual)} disabled={categoriaAtiva === "historico"}>
          + Novo item
        </button>
        <button type="button" className="refresh-btn" onClick={exportar} disabled={!estado}>
          Exportar CSV
        </button>
        <button
          type="button"
          className="refresh-btn"
          onClick={() => {
            if (window.confirm("Restaurar os itens originais e apagar todo o histórico? Essa ação não pode ser desfeita.")) {
              void solicitar("/restaurar", { method: "POST", body: "{}" });
            }
          }}
          disabled={salvando}
        >
          Restaurar original
        </button>
      </div>

      {formNovo && (
        <form className="almox-formulario" onSubmit={(event) => void adicionarItem(event)}>
          <label>Item<input value={novoNome} onChange={(event) => setNovoNome(event.target.value)} required autoFocus /></label>
          <label>Mínimo<input inputMode="numeric" value={novoMinimo} onChange={(event) => setNovoMinimo(event.target.value)} placeholder="Opcional" /></label>
          <label>Unidade<input value={novaUnidade} onChange={(event) => setNovaUnidade(event.target.value)} required /></label>
          <button className="btn-primario" type="submit" disabled={salvando}>Salvar item</button>
          <button className="refresh-btn" type="button" onClick={() => setFormNovo(false)}>Cancelar</button>
        </form>
      )}

      {categoriaAtiva !== "historico" && movimentoAberto && (
        <form className="almox-mov-form" onSubmit={(event) => void enviarMovimentacao(event)}>
          <strong>Registrar movimento</strong>
          <select aria-label="Item para movimentar" value={movimentoItemId} onChange={(event) => setMovimentoItemId(event.target.value)}>
            <option value="">Selecione um item</option>
            {itens.map(({ categoria, item }) => <option key={item.id} value={item.id}>{categoria.nome} · {item.nome}</option>)}
          </select>
          <select aria-label="Tipo de movimento" value={movimentoTipo} onChange={(event) => setMovimentoTipo(event.target.value as "entrada" | "saida")}>
            <option value="entrada">Entrada</option>
            <option value="saida">Saída</option>
          </select>
          <input aria-label="Quantidade da movimentação" inputMode="numeric" type="number" min="1" step="1" placeholder="Quantidade" value={movimentoQuantidade} onChange={(event) => setMovimentoQuantidade(event.target.value)} />
          <input aria-label="Observação da movimentação" placeholder="Observação (quem pegou, nota fiscal...)" value={movimentoObservacao} onChange={(event) => setMovimentoObservacao(event.target.value)} />
          <button className="btn-primario" type="submit" disabled={salvando}>Registrar</button>
          <button className="refresh-btn" type="button" onClick={() => setMovimentoAberto(false)}>Fechar</button>
        </form>
      )}

      {categoriaAtiva === "historico" ? (
        <div className="almox-historico">
          {historico.length ? historico.map((movimento) => <LinhaHistorico key={movimento.id} movimento={movimento} />) : <p className="estado-vazio">Nenhuma movimentação encontrada.</p>}
        </div>
      ) : (
        <div className="almox-grade">
          {itensVisiveis.map(({ item }) => (
            <AlmoxarifadoItem
              key={`${item.id}:${item.nome}:${item.saldo}:${item.minimo}:${item.passo}`}
              item={item}
              salvando={salvando}
              onAtualizar={(id, dados) => void solicitar(`/itens/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(dados) })}
              onMovimentar={(id, tipo, quantidade) => void mover(id, tipo, quantidade)}
              onAbrirMovimento={(id) => {
                setMovimentoItemId(id);
                setMovimentoAberto(true);
              }}
              onRemover={(id) => {
                const nome = item.nome;
                if (window.confirm(`Remover “${nome}” do almoxarifado? O histórico será preservado.`)) {
                  void solicitar(`/itens/${encodeURIComponent(id)}`, { method: "DELETE" });
                }
              }}
            />
          ))}
          {!carregando && itensVisiveis.length === 0 && <p className="estado-vazio">Nenhum item encontrado.</p>}
        </div>
      )}
    </div>
  );
}

function LinhaHistorico({ movimento }: { movimento: MovimentacaoAlmox }) {
  const sinal = movimento.tipo === "entrada" ? "+" : movimento.tipo === "saida" ? "−" : "±";
  return (
    <article className={`almox-linha-historico almox-linha-historico--${movimento.tipo}`}>
      <strong>{sinal}{formatar(movimento.quantidade)} {movimento.unidade}</strong>
      <div>
        <b>{movimento.itemNome}</b>
        <p>{movimento.tipo} · {new Date(movimento.criadoEm).toLocaleString("pt-BR")} · saldo {formatar(movimento.saldo)} {movimento.unidade}{movimento.observacao ? ` · ${movimento.observacao}` : ""}</p>
      </div>
    </article>
  );
}
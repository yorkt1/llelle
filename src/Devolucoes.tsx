import { useCallback, useEffect, useState, type FormEvent } from "react";

interface ClienteInfo {
  nome: string;
  documento: string;
  tipoPessoa: "F" | "J" | null;
}

interface ProdutoPedido {
  codigo: string;
  descricao: string;
  quantidade: number;
}

interface PedidoEncontrado {
  numeroPedido: string;
  numeroNotaFiscal: string | null;
  dataPedido: string | null;
  cliente: ClienteInfo;
  produtos: ProdutoPedido[];
}

interface DevolucaoRegistro {
  id: string;
  codigo: string;
  numeroPedido: string;
  numeroNotaFiscal: string | null;
  clienteNome: string;
  clienteDocumento: string;
  produtoCodigo: string;
  produtoDescricao: string;
  defeito: string;
  criadoEm: string;
}

// Vazio quando front e API rodam juntos (dev, ou os dois no mesmo Express) — mesma
// convenção do painel de separação (ver src/App.tsx).
const API_URL = import.meta.env.VITE_API_URL ?? "";

function extrairErro(json: unknown, fallback: string): string {
  if (json && typeof json === "object" && "error" in json && typeof (json as { error: unknown }).error === "string") {
    return (json as { error: string }).error;
  }
  return fallback;
}

function formatarDocumento(cliente: ClienteInfo): string {
  if (!cliente.documento) return "—";
  const rotulo = cliente.tipoPessoa === "J" ? "CNPJ" : "CPF";
  return `${rotulo}: ${cliente.documento}`;
}

function formatarData(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export function Devolucoes() {
  const [codigo, setCodigo] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [buscaErro, setBuscaErro] = useState<string | null>(null);
  const [pedido, setPedido] = useState<PedidoEncontrado | null>(null);
  const [produtoIndex, setProdutoIndex] = useState(0);
  const [defeito, setDefeito] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [salvarErro, setSalvarErro] = useState<string | null>(null);

  const [registros, setRegistros] = useState<DevolucaoRegistro[]>([]);
  const [carregandoRegistros, setCarregandoRegistros] = useState(true);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      try {
        const response = await fetch(`${API_URL}/api/devolucoes`, { cache: "no-store" });
        if (!response.ok) throw new Error();
        const json = (await response.json()) as DevolucaoRegistro[];
        if (!cancelado) setRegistros(json);
      } catch {
        // Histórico é só um extra — se falhar, o formulário de busca/registro continua funcionando.
      } finally {
        if (!cancelado) setCarregandoRegistros(false);
      }
    })();
    return () => {
      cancelado = true;
    };
  }, []);

  const buscar = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      const valor = codigo.trim();
      if (!valor) return;

      setBuscando(true);
      setBuscaErro(null);
      setPedido(null);
      setProdutoIndex(0);
      setDefeito("");
      setSalvarErro(null);

      try {
        const response = await fetch(`${API_URL}/api/devolucoes/buscar?codigo=${encodeURIComponent(valor)}`, {
          cache: "no-store",
        });
        const json = await response.json();
        if (!response.ok) throw new Error(extrairErro(json, "Não consegui buscar esse código."));
        setPedido(json as PedidoEncontrado);
      } catch (error) {
        setBuscaErro(error instanceof Error ? error.message : "Não consegui buscar esse código.");
      } finally {
        setBuscando(false);
      }
    },
    [codigo],
  );

  const registrar = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      if (!pedido) return;
      const produto = pedido.produtos[produtoIndex];
      if (!produto) {
        setSalvarErro("Selecione o produto devolvido.");
        return;
      }
      if (!defeito.trim()) {
        setSalvarErro("Descreva o defeito relatado.");
        return;
      }

      setSalvando(true);
      setSalvarErro(null);

      try {
        const response = await fetch(`${API_URL}/api/devolucoes`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            codigo: codigo.trim(),
            numeroPedido: pedido.numeroPedido,
            numeroNotaFiscal: pedido.numeroNotaFiscal,
            clienteNome: pedido.cliente.nome,
            clienteDocumento: pedido.cliente.documento,
            produtoCodigo: produto.codigo,
            produtoDescricao: produto.descricao,
            defeito: defeito.trim(),
          }),
        });
        const json = await response.json();
        if (!response.ok) throw new Error(extrairErro(json, "Não consegui salvar essa devolução."));

        setRegistros((atuais) => [json as DevolucaoRegistro, ...atuais]);
        setPedido(null);
        setCodigo("");
        setDefeito("");
      } catch (error) {
        setSalvarErro(error instanceof Error ? error.message : "Não consegui salvar essa devolução.");
      } finally {
        setSalvando(false);
      }
    },
    [pedido, produtoIndex, defeito, codigo],
  );

  return (
    <div className="page devolucao-page">
      <header className="header">
        <h1 className="title">Devolução</h1>
      </header>

      <form className="devolucao-busca" onSubmit={buscar}>
        <label className="field">
          <span className="field-label">Código do pedido ou da nota</span>
          <input
            className="field-input"
            value={codigo}
            onChange={(event) => setCodigo(event.target.value)}
            placeholder="Ex: 10452"
            autoFocus
          />
        </label>
        <button className="refresh-btn" type="submit" disabled={buscando || !codigo.trim()}>
          {buscando ? "Buscando..." : "Buscar no Tiny"}
        </button>
      </form>

      {buscaErro && <p className="error-banner">{buscaErro}</p>}

      {pedido && (
        <form className="devolucao-form" onSubmit={registrar}>
          <div className="devolucao-info">
            <div className="field">
              <span className="field-label">Cliente</span>
              <span className="field-value">{pedido.cliente.nome || "—"}</span>
            </div>
            <div className="field">
              <span className="field-label">Documento</span>
              <span className="field-value">{formatarDocumento(pedido.cliente)}</span>
            </div>
            <div className="field">
              <span className="field-label">Pedido</span>
              <span className="field-value">{pedido.numeroPedido}</span>
            </div>
            <div className="field">
              <span className="field-label">Nota fiscal</span>
              <span className="field-value">{pedido.numeroNotaFiscal ?? "não localizada — preencher na hora"}</span>
            </div>
          </div>

          {pedido.produtos.length > 1 ? (
            <label className="field">
              <span className="field-label">Produto devolvido</span>
              <select
                className="field-input"
                value={produtoIndex}
                onChange={(event) => setProdutoIndex(Number(event.target.value))}
              >
                {pedido.produtos.map((produto, index) => (
                  <option key={produto.codigo || index} value={index}>
                    {produto.codigo} — {produto.descricao} (qtd. {produto.quantidade})
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <div className="field">
              <span className="field-label">Produto</span>
              <span className="field-value">
                {pedido.produtos[0] ? `${pedido.produtos[0].codigo} — ${pedido.produtos[0].descricao}` : "Pedido sem itens retornados pelo Tiny."}
              </span>
            </div>
          )}

          <label className="field">
            <span className="field-label">Defeito relatado</span>
            <textarea
              className="field-input field-textarea"
              value={defeito}
              onChange={(event) => setDefeito(event.target.value)}
              rows={3}
              placeholder="Descreva o problema relatado pelo cliente"
            />
          </label>

          {salvarErro && <p className="error-banner">{salvarErro}</p>}

          <button className="refresh-btn" type="submit" disabled={salvando}>
            {salvando ? "Salvando..." : "Registrar devolução"}
          </button>
        </form>
      )}

      <section className="devolucao-historico">
        <h2 className="devolucao-historico-title">Últimas devoluções registradas</h2>
        {carregandoRegistros ? (
          <p className="field-value">Carregando...</p>
        ) : registros.length === 0 ? (
          <p className="field-value">Nenhuma devolução registrada ainda.</p>
        ) : (
          <table className="devolucao-tabela">
            <thead>
              <tr>
                <th>Data</th>
                <th>Pedido</th>
                <th>Cliente</th>
                <th>Produto</th>
                <th>Defeito</th>
              </tr>
            </thead>
            <tbody>
              {registros.map((registro) => (
                <tr key={registro.id}>
                  <td>{formatarData(registro.criadoEm)}</td>
                  <td>{registro.numeroPedido}</td>
                  <td>{registro.clienteNome}</td>
                  <td>{registro.produtoDescricao}</td>
                  <td>{registro.defeito}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

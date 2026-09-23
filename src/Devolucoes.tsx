import { useCallback, useState, type FormEvent } from "react";

interface ItemDevolucao {
  codigo: string;
  descricao: string;
  quantidade: number;
  produtoPlanilha: string;
}

interface OutraNotaFiscal {
  numero: string;
  serie?: string;
  dataEmissao: string;
}

interface DevolucaoPreview {
  nf: string;
  dataEmissao: string;
  cliente: string;
  cpf: string;
  idPedido: string;
  marketplace: string;
  itens: ItemDevolucao[];
  outras?: OutraNotaFiscal[];
}

interface LinhaEditavel {
  dataPedidoSac: string;
  ocorrencia: string;
  observacoes: string;
  produto: string;
  quantidade: number;
}

interface BuscaRecente {
  numero: string;
  cliente: string;
  buscadoEm: string;
}

// Vazio quando front e API rodam juntos — mesma convenção do painel de separação e dos relatórios.
const API_URL = import.meta.env.VITE_API_URL ?? "";
const BUSCAS_STORAGE_KEY = "devolucao:buscasRecentes";
const MAX_BUSCAS_RECENTES = 10;

const OCORRENCIAS = ["DANIFICADO", "ARREPENDIMENTO", "ERRO OPERACIONAL", "CANCELAMENTO", "DEFEITO"] as const;

// Texto exato pedido — atenção ao DEFEITO: são dois espaços antes do parêntese, de propósito.
const OBSERVACAO_PADRAO: Record<string, string> = {
  DANIFICADO: "Demais tipos de dano (quebrado, amassado, riscado, etc.)",
  ARREPENDIMENTO: "Mudou de Ideia",
  "ERRO OPERACIONAL": "VOLTAGEM ou PRODUTO enviado ERRADO",
  CANCELAMENTO: "Falha na ENTREGA ao Cliente",
  DEFEITO: "Recebi um produto com defeito funcional  (Defeito de fábrica,com mau funcionamento,)",
};

function hojeBr(): string {
  return new Date().toLocaleDateString("pt-BR");
}

function lerBuscasRecentes(): BuscaRecente[] {
  try {
    const raw = localStorage.getItem(BUSCAS_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as BuscaRecente[]) : [];
  } catch {
    return [];
  }
}

function salvarBuscaRecente(busca: BuscaRecente): BuscaRecente[] {
  const atuais = lerBuscasRecentes().filter((b) => b.numero !== busca.numero);
  const atualizadas = [busca, ...atuais].slice(0, MAX_BUSCAS_RECENTES);
  try {
    localStorage.setItem(BUSCAS_STORAGE_KEY, JSON.stringify(atualizadas));
  } catch {
    // localStorage bloqueado (aba anônima etc.) — só perde a lista de atalhos, não trava o resto.
  }
  return atualizadas;
}

function extrairErro(json: unknown, fallback: string): string {
  if (json && typeof json === "object" && "erro" in json && typeof (json as { erro: unknown }).erro === "string") {
    return (json as { erro: string }).erro;
  }
  return fallback;
}

function linhaParaCopia(preview: DevolucaoPreview, linha: LinhaEditavel): string {
  return [
    linha.dataPedidoSac,
    preview.cliente,
    preview.cpf,
    preview.idPedido,
    preview.nf,
    preview.marketplace,
    linha.ocorrencia,
    linha.observacoes,
    String(linha.quantidade),
    linha.produto,
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
  ].join("\t");
}

export function Devolucoes() {
  const [numero, setNumero] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [preview, setPreview] = useState<DevolucaoPreview | null>(null);
  const [linhas, setLinhas] = useState<LinhaEditavel[]>([]);
  const [avisoCopia, setAvisoCopia] = useState<string | null>(null);
  const [buscasRecentes, setBuscasRecentes] = useState<BuscaRecente[]>(() => lerBuscasRecentes());

  const buscar = useCallback(
    async (event?: FormEvent, numeroForcado?: string) => {
      event?.preventDefault();
      const valor = (numeroForcado ?? numero).trim();
      if (!valor) return;

      setBuscando(true);
      setErro(null);
      setAvisoCopia(null);
      setPreview(null);
      setLinhas([]);
      setNumero(valor);

      try {
        const response = await fetch(`${API_URL}/api/devolucao/nf/${encodeURIComponent(valor)}`, { cache: "no-store" });
        const json = await response.json();
        if (!response.ok) throw new Error(extrairErro(json, "Não consegui buscar essa nota fiscal."));

        const dados = json as DevolucaoPreview;
        setPreview(dados);
        setLinhas(
          dados.itens.map((item) => ({
            dataPedidoSac: hojeBr(),
            ocorrencia: "",
            observacoes: "",
            produto: item.produtoPlanilha,
            quantidade: item.quantidade,
          })),
        );
        setBuscasRecentes(salvarBuscaRecente({ numero: dados.nf, cliente: dados.cliente, buscadoEm: hojeBr() }));
      } catch (error) {
        setErro(error instanceof Error ? error.message : "Não consegui buscar essa nota fiscal.");
      } finally {
        setBuscando(false);
      }
    },
    [numero],
  );

  const atualizarLinha = useCallback((index: number, campo: keyof LinhaEditavel, valor: string) => {
    setLinhas((atuais) =>
      atuais.map((linha, i) => {
        if (i !== index) return linha;
        if (campo === "ocorrencia") {
          return { ...linha, ocorrencia: valor, observacoes: OBSERVACAO_PADRAO[valor] ?? linha.observacoes };
        }
        return { ...linha, [campo]: valor };
      }),
    );
  }, []);

  const copiar = useCallback(async () => {
    if (!preview || linhas.length === 0) return;
    if (linhas.some((linha) => !linha.ocorrencia)) {
      setAvisoCopia(null);
      setErro("Escolha a ocorrência de cada item antes de copiar.");
      return;
    }

    const texto = linhas.map((linha) => linhaParaCopia(preview, linha)).join("\n");
    try {
      await navigator.clipboard.writeText(texto);
      setErro(null);
      setAvisoCopia(`✔ ${linhas.length} linha(s) copiada(s)`);
    } catch {
      setAvisoCopia(null);
      setErro("Não consegui copiar — seu navegador pode ter bloqueado o acesso à área de transferência.");
    }
  }, [preview, linhas]);

  return (
    <div className="page pagina-formulario">
      <header className="header">
        <h1 className="title">Devoluções</h1>
      </header>

      <form className="busca-linha" onSubmit={buscar}>
        <label className="field">
          <span className="field-label">Nº da NF</span>
          <input
            className="field-input"
            value={numero}
            onChange={(event) => setNumero(event.target.value)}
            placeholder="Ex: 338894"
            autoFocus
          />
        </label>
        <button className="refresh-btn" type="submit" disabled={buscando || !numero.trim()}>
          {buscando ? "Buscando..." : "Buscar"}
        </button>
      </form>

      {buscasRecentes.length > 0 && (
        <div className="buscas-recentes">
          {buscasRecentes.map((busca) => (
            <button
              key={busca.numero}
              className="buscas-recentes-item"
              onClick={() => void buscar(undefined, busca.numero)}
              title={`${busca.cliente} — buscado em ${busca.buscadoEm}`}
            >
              {busca.numero}
            </button>
          ))}
        </div>
      )}

      {erro && <p className="error-banner">{erro}</p>}

      {preview && (
        <>
          {preview.outras && preview.outras.length > 0 && (
            <p className="nota-info">
              Havia {preview.outras.length + 1} notas com o número {numero} — usando a mais recente, emitida em{" "}
              {preview.dataEmissao}.
            </p>
          )}

          <div className="tabela-wrap">
            <table className="tabela">
              <thead>
                <tr>
                  <th>Data pedido SAC</th>
                  <th>Cliente</th>
                  <th>CPF</th>
                  <th>ID pedido</th>
                  <th>NF</th>
                  <th>Marketplace</th>
                  <th>Ocorrência</th>
                  <th>Observações</th>
                  <th>Qtd</th>
                  <th>Produto</th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((linha, index) => (
                  <tr key={index}>
                    <td>
                      <input value={linha.dataPedidoSac} onChange={(event) => atualizarLinha(index, "dataPedidoSac", event.target.value)} />
                    </td>
                    <td>{preview.cliente}</td>
                    <td>{preview.cpf}</td>
                    <td>{preview.idPedido}</td>
                    <td>{preview.nf}</td>
                    <td>{preview.marketplace}</td>
                    <td>
                      <select value={linha.ocorrencia} onChange={(event) => atualizarLinha(index, "ocorrencia", event.target.value)}>
                        <option value="">Selecione</option>
                        {OCORRENCIAS.map((opcao) => (
                          <option key={opcao} value={opcao}>
                            {opcao}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input value={linha.observacoes} onChange={(event) => atualizarLinha(index, "observacoes", event.target.value)} />
                    </td>
                    <td>{linha.quantidade}</td>
                    <td>
                      <input value={linha.produto} onChange={(event) => atualizarLinha(index, "produto", event.target.value)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button className="refresh-btn" onClick={() => void copiar()}>
            Copiar p/ planilha
          </button>

          {avisoCopia && <p className="aviso-sucesso">{avisoCopia}</p>}
        </>
      )}
    </div>
  );
}

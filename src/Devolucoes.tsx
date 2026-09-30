import { useCallback, useRef, useState, type ClipboardEvent, type DragEvent, type FormEvent, type KeyboardEvent } from "react";

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

interface DevolucaoShopee {
  idDevolucaoShopee?: string;
  dataSolicitacao?: string; // ISO yyyy-mm-dd
  motivoDevolucao?: string;
  ocorrenciaSugerida: string | null;
  descricaoCliente?: string;
  valorReembolso?: number;
  valorCompensacao?: number;
  variacaoShopee?: string;
  dataRecebimento?: string; // ISO yyyy-mm-dd
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
  shopee?: DevolucaoShopee;
}

interface CandidatoDevolucao {
  nf: string;
  cliente: string;
  dataEmissao: string;
  produtos: string[];
}

interface LinhaEditavel {
  dataPedidoSac: string;
  ocorrencia: string;
  observacoes: string;
  produto: string;
  quantidade: number;
  dataRecebimento: string;
  defeito: string;
  codigoFabricante: string;
  lendoImagemCodigo: boolean;
  status: string;
  reembolso: string;
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

const OCORRENCIAS = ["DANIFICADO", "ARREPENDIMENTO", "ERRO OPERACIONAL", "CANCELAMENTO", "DEFEITO", "EXTRAVIO"] as const;

// Mesmas listas fixas do dropdown de validação da planilha (colunas STATUS e REEMBOLSOS).
const STATUS_OPCOES = ["TESTE", "ESTOQUE", "PERDA", "AGUARDANDO PRODUTO"] as const;

const REEMBOLSO_OPCOES = [
  "REEMBOLSO AO CLIENTE",
  "NÃO REEMBOLSADO",
  "DISPUTA EM ANALISE",
  "DISPUTA REJEITADA",
  "REEMBOLSO AUTOMATICO",
  "AGUARDANDO PRODUTO CHEGAR",
  "EFETUADO A TROCA",
  "DISPUTA APROVADA",
] as const;

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

function isoParaBr(dataIso: string): string {
  const [ano, mes, dia] = dataIso.split("-");
  return dia && mes && ano ? `${dia}/${mes}/${ano}` : dataIso;
}

function formatarReal(valor: number): string {
  return valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// Só interessa o valor do "Número de Série" (ou variações) — não o resto do texto da etiqueta
// (ex.: "USO DOMÉSTICO"). Procura a linha que menciona "série"/"serial"/"s/n" e devolve só o
// que vem depois dos dois-pontos; sem achar isso, devolve o texto inteiro reconhecido (melhor
// dar pra corrigir na mão do que devolver vazio).
function extrairNumeroDeSerie(textoOcr: string): string {
  const linhas = textoOcr
    .split("\n")
    .map((linha) => linha.trim())
    .filter(Boolean);

  for (const linha of linhas) {
    const normalizada = linha
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase();
    if (!normalizada.includes("serie") && !normalizada.includes("serial") && !normalizada.includes("s/n")) continue;

    const depoisDosDoisPontos = linha.split(":").slice(1).join(":").trim();
    return depoisDosDoisPontos || linha;
  }

  return textoOcr.trim().replace(/\s+/g, " ");
}

// Otsu: acha automaticamente o ponto de corte entre "claro" e "escuro" a partir do histograma —
// se adapta à iluminação de cada foto, diferente de um limiar fixo.
function limiarOtsu(histograma: number[], total: number): number {
  let somaTotal = 0;
  for (let i = 0; i < 256; i++) somaTotal += i * histograma[i];

  let somaFundo = 0;
  let pesoFundo = 0;
  let maiorVariancia = 0;
  let limiar = 0;
  for (let i = 0; i < 256; i++) {
    pesoFundo += histograma[i];
    if (pesoFundo === 0) continue;
    const pesoObjeto = total - pesoFundo;
    if (pesoObjeto === 0) break;

    somaFundo += i * histograma[i];
    const mediaFundo = somaFundo / pesoFundo;
    const mediaObjeto = (somaTotal - somaFundo) / pesoObjeto;
    const variancia = pesoFundo * pesoObjeto * (mediaFundo - mediaObjeto) ** 2;
    if (variancia > maiorVariancia) {
      maiorVariancia = variancia;
      limiar = i;
    }
  }
  return limiar;
}

// Fotos de etiqueta costumam vir pequenas e com fundo cinza/reflexo — aumenta a resolução e
// converte pra preto-e-branco puro (limiar automático), o que ajuda bastante o OCR a diferenciar
// o texto do fundo.
async function prepararImagemParaOcr(arquivo: File | Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(arquivo);
  const escala = Math.min(4, Math.max(1, 1200 / bitmap.width));
  const largura = Math.round(bitmap.width * escala);
  const altura = Math.round(bitmap.height * escala);

  const canvas = document.createElement("canvas");
  canvas.width = largura;
  canvas.height = altura;
  const ctx = canvas.getContext("2d");
  if (!ctx) return arquivo;
  ctx.drawImage(bitmap, 0, 0, largura, altura);

  const imagem = ctx.getImageData(0, 0, largura, altura);
  const pixels = imagem.data;
  const totalPixels = largura * altura;
  const cinzas = new Uint8ClampedArray(totalPixels);
  const histograma = new Array(256).fill(0);
  for (let i = 0, p = 0; i < pixels.length; i += 4, p += 1) {
    const cinza = Math.round(0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2]);
    cinzas[p] = cinza;
    histograma[cinza] += 1;
  }

  const limiar = limiarOtsu(histograma, totalPixels);
  for (let i = 0, p = 0; i < pixels.length; i += 4, p += 1) {
    const valor = cinzas[p] < limiar ? 0 : 255;
    pixels[i] = pixels[i + 1] = pixels[i + 2] = valor;
  }
  ctx.putImageData(imagem, 0, 0);

  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob ?? arquivo), "image/png");
  });
}

function arquivoParaDataUri(arquivo: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onload = () => resolve(leitor.result as string);
    leitor.onerror = () => reject(leitor.error);
    leitor.readAsDataURL(arquivo);
  });
}

/**
 * Tentativa 1: manda a foto original (sem tratamento — um modelo de visão lida melhor com foto
 * real do que com a binarização usada no OCR local) pro backend, que chama a Groq. Lança erro se
 * o backend não tiver GROQ_API_KEY configurado (503) ou se a Groq falhar — quem chama decide o
 * que fazer (aqui: cair pro OCR local, ver `lerCodigoDaImagem`).
 */
async function lerViaGroq(arquivo: File): Promise<string> {
  const dataUri = await arquivoParaDataUri(arquivo);
  const resposta = await fetch(`${API_URL}/api/devolucao/ler-numero-serie`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imagem: dataUri }),
  });
  if (!resposta.ok) {
    const corpo = await resposta.json().catch(() => null);
    throw new Error(`Groq indisponível (${resposta.status}): ${corpo?.erro ?? "sem detalhe"}`);
  }
  const json = (await resposta.json()) as { numeroSerie: string };
  return json.numeroSerie;
}

/** Tentativa 2 (fallback): OCR local via tesseract.js — roda inteiro no navegador, sem custo nem chave. */
async function lerViaOcrLocal(arquivo: File): Promise<string> {
  const imagemPreparada = await prepararImagemParaOcr(arquivo);
  const modulo = await import("tesseract.js");
  const Tesseract = modulo.default ?? modulo;
  const worker = await Tesseract.createWorker("eng");
  await worker.setParameters({ tessedit_pageseg_mode: Tesseract.PSM.SINGLE_BLOCK });
  const resultado = await worker.recognize(imagemPreparada);
  await worker.terminate();
  return extrairNumeroDeSerie(resultado.data.text);
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

// NF é só número, "Nº do pedido" do Shopee é número+letra — nome de cliente não tem dígito.
// Pacote chegado pelos Correios muitas vezes só tem o nome escrito, sem NF nem nº de pedido.
function pareceNomeDeCliente(valor: string): boolean {
  return valor.trim() !== "" && !/\d/.test(valor);
}

function linhaParaCopia(preview: DevolucaoPreview, linha: LinhaEditavel): string {
  return [
    linha.dataPedidoSac, // A
    preview.cliente, // B
    preview.cpf, // C
    preview.idPedido, // D
    preview.nf, // E
    preview.marketplace, // F
    linha.ocorrencia, // G
    linha.observacoes, // H
    String(linha.quantidade), // I
    linha.produto, // J
    linha.dataRecebimento, // K
    linha.defeito, // L
    linha.codigoFabricante, // M
    linha.status, // N
    linha.reembolso, // O
    "", // P - nº nota fiscal de devolução
    "", // Q - nº nota fiscal de perda
    "", // R - valor recebido do banco
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
  const [candidatos, setCandidatos] = useState<CandidatoDevolucao[] | null>(null);
  const [podeTerMaisCandidatos, setPodeTerMaisCandidatos] = useState(false);
  const tabelaRef = useRef<HTMLTableElement>(null);

  // Enter pula pro próximo campo da tabela (input ou select), igual planilha — evita ter que
  // pegar o mouse ou usar Tab pra preencher várias linhas seguidas.
  const irParaProximoCampo = useCallback((event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    const tabela = tabelaRef.current;
    if (!tabela) return;

    event.preventDefault();
    const campos = Array.from(tabela.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input, select"));
    const atual = campos.indexOf(event.target as HTMLInputElement | HTMLSelectElement);
    if (atual === -1) return;

    const proximo = campos[(atual + 1) % campos.length];
    proximo.focus();
    if (proximo instanceof HTMLInputElement) proximo.select();
  }, []);

  const buscarPorNomeCliente = useCallback(async (nome: string) => {
    setBuscando(true);
    setErro(null);
    setAvisoCopia(null);
    setPreview(null);
    setLinhas([]);
    setCandidatos(null);

    try {
      const response = await fetch(`${API_URL}/api/devolucao/nome/${encodeURIComponent(nome)}`, { cache: "no-store" });
      const json = await response.json();
      if (!response.ok) throw new Error(extrairErro(json, "Não consegui buscar por esse nome."));

      setCandidatos(json.candidatos ?? []);
      setPodeTerMaisCandidatos(Boolean(json.podeTerMais));
    } catch (error) {
      setErro(error instanceof Error ? error.message : "Não consegui buscar por esse nome.");
    } finally {
      setBuscando(false);
    }
  }, []);

  const buscar = useCallback(
    async (event?: FormEvent, numeroForcado?: string) => {
      event?.preventDefault();
      const valor = (numeroForcado ?? numero).trim();
      if (!valor) return;

      // Pacote dos Correios muitas vezes só tem o NOME do cliente, sem NF nem nº de pedido —
      // nesse caso a busca não devolve uma prévia já pronta, devolve candidatos pra escolher.
      if (!numeroForcado && pareceNomeDeCliente(valor)) {
        setNumero(valor);
        await buscarPorNomeCliente(valor);
        return;
      }

      setBuscando(true);
      setErro(null);
      setAvisoCopia(null);
      setPreview(null);
      setLinhas([]);
      setCandidatos(null);
      setNumero(valor);

      try {
        const response = await fetch(`${API_URL}/api/devolucao/nf/${encodeURIComponent(valor)}`, { cache: "no-store" });
        const json = await response.json();
        if (!response.ok) throw new Error(extrairErro(json, "Não consegui buscar essa nota fiscal."));

        const dados = json as DevolucaoPreview;
        const shopee = dados.shopee;
        const ocorrenciaInicial = shopee?.ocorrenciaSugerida ?? "";
        setPreview(dados);
        setLinhas(
          dados.itens.map((item) => ({
            dataPedidoSac: shopee?.dataSolicitacao ? isoParaBr(shopee.dataSolicitacao) : hojeBr(),
            ocorrencia: ocorrenciaInicial,
            observacoes: ocorrenciaInicial ? (OBSERVACAO_PADRAO[ocorrenciaInicial] ?? "") : "",
            produto: item.produtoPlanilha,
            quantidade: item.quantidade,
            dataRecebimento: shopee?.dataRecebimento ? isoParaBr(shopee.dataRecebimento) : "",
            defeito: shopee?.descricaoCliente ?? "",
            codigoFabricante: "",
            lendoImagemCodigo: false,
            status: "",
            reembolso: "",
          })),
        );
        setBuscasRecentes(salvarBuscaRecente({ numero: dados.nf, cliente: dados.cliente, buscadoEm: hojeBr() }));
      } catch (error) {
        setErro(error instanceof Error ? error.message : "Não consegui buscar essa nota fiscal.");
      } finally {
        setBuscando(false);
      }
    },
    [numero, buscarPorNomeCliente],
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

  const definirLendoImagem = useCallback((index: number, valor: boolean) => {
    setLinhas((atuais) => atuais.map((linha, i) => (i === index ? { ...linha, lendoImagemCodigo: valor } : linha)));
  }, []);

  // Lê o número de série de uma imagem e preenche o Cód. fabricante sozinho. Tenta primeiro a
  // Groq (mais acertiva com foto real, mas exige GROQ_API_KEY no backend); se isso não estiver
  // configurado ou falhar, cai pro OCR local (tesseract.js, sem custo nem configuração). Não é
  // 100% confiável, então o campo continua editável. Compartilhado entre colar (Ctrl+V) e
  // arrastar-e-soltar a imagem no campo.
  const lerCodigoDaImagem = useCallback(
    async (arquivo: File, index: number) => {
      setErro(null);
      definirLendoImagem(index, true);
      try {
        const numeroSerie = await lerViaGroq(arquivo).catch((erroGroq) => {
          console.warn("[llelle] Groq não disponível, caindo pro OCR local:", erroGroq);
          return lerViaOcrLocal(arquivo);
        });
        atualizarLinha(index, "codigoFabricante", numeroSerie);
      } catch (erro) {
        console.error("[llelle] falha ao ler o código da imagem:", erro);
        setErro("Não consegui ler o código dessa imagem — digite manualmente.");
      } finally {
        definirLendoImagem(index, false);
      }
    },
    [atualizarLinha, definirLendoImagem],
  );

  const aoColarNoCampoCodigo = useCallback(
    (event: ClipboardEvent<HTMLInputElement>, index: number) => {
      const item = [...event.clipboardData.items].find((i) => i.type.startsWith("image/"));
      if (!item) return; // colou texto normal — deixa o comportamento padrão do input acontecer

      event.preventDefault();
      const arquivo = item.getAsFile();
      if (arquivo) void lerCodigoDaImagem(arquivo, index);
    },
    [lerCodigoDaImagem],
  );

  const aoSoltarNoCampoCodigo = useCallback(
    (event: DragEvent<HTMLInputElement>, index: number) => {
      event.preventDefault();
      const arquivo = [...event.dataTransfer.files].find((f) => f.type.startsWith("image/"));
      if (arquivo) void lerCodigoDaImagem(arquivo, index);
    },
    [lerCodigoDaImagem],
  );

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
    <div className="page pagina-formulario pagina-formulario--larga">
      <header className="header">
        <h1 className="title">Devoluções</h1>
      </header>

      <form className="busca-linha" onSubmit={buscar}>
        <label className="field">
          <span className="field-label">Nº da NF, nº do pedido ou nome do cliente</span>
          <input
            className="field-input"
            value={numero}
            onChange={(event) => setNumero(event.target.value)}
            placeholder="Ex: 338894 (NF), 260913UJGQT69B (pedido) ou Maria Silva (nome, se só tiver isso no pacote)"
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

      {candidatos && (
        <div className="candidatos-lista">
          {candidatos.length === 0 ? (
            <p className="nota-info">Nenhum resultado encontrado com esse nome. Confere a grafia ou tenta só o primeiro nome.</p>
          ) : (
            <>
              <p className="nota-info">
                {candidatos.length} resultado(s) encontrado(s){podeTerMaisCandidatos ? " (mostrando os 5 mais recentes — refine o nome se não for nenhum desses)" : ""}:
              </p>
              {candidatos.map((candidato) => (
                <button key={candidato.nf} className="candidato-item" onClick={() => void buscar(undefined, candidato.nf)}>
                  <span className="candidato-cliente">{candidato.cliente}</span>
                  <span className="candidato-meta">
                    NF {candidato.nf} · {candidato.dataEmissao}
                  </span>
                  {candidato.produtos.length > 0 && <span className="candidato-produtos">{candidato.produtos.join(", ")}</span>}
                </button>
              ))}
            </>
          )}
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

          {preview.shopee && (
            <p className="nota-info">
              Dados do Shopee aplicados
              {preview.shopee.idDevolucaoShopee ? ` (ID devolução: ${preview.shopee.idDevolucaoShopee})` : ""}
              {preview.shopee.motivoDevolucao ? ` — motivo: "${preview.shopee.motivoDevolucao}"` : ""}
              {!preview.shopee.ocorrenciaSugerida ? " — não reconheci esse motivo automaticamente, escolha a ocorrência na mão." : ""}
              {preview.shopee.valorReembolso != null ? ` · reembolso ao cliente: ${formatarReal(preview.shopee.valorReembolso)}` : ""}
              {preview.shopee.valorCompensacao != null ? ` · compensação ao vendedor: ${formatarReal(preview.shopee.valorCompensacao)}` : ""}
              {preview.shopee.variacaoShopee ? ` · variação no Shopee: ${preview.shopee.variacaoShopee} (confira contra o PRODUTO abaixo)` : ""}
              {preview.shopee.dataRecebimento ? ` · recebido de volta em: ${isoParaBr(preview.shopee.dataRecebimento)}` : ""}
            </p>
          )}

          <div className="tabela-wrap">
            <table className="tabela" ref={tabelaRef} onKeyDown={irParaProximoCampo}>
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
                  <th>Data recebimento</th>
                  <th>Defeito</th>
                  <th>Cód. fabricante</th>
                  <th>Status</th>
                  <th>Reembolso</th>
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
                    <td>
                      <input
                        value={linha.dataRecebimento}
                        onChange={(event) => atualizarLinha(index, "dataRecebimento", event.target.value)}
                        placeholder="dd/mm/aaaa"
                      />
                    </td>
                    <td>
                      <input value={linha.defeito} onChange={(event) => atualizarLinha(index, "defeito", event.target.value)} />
                    </td>
                    <td>
                      <input
                        value={linha.codigoFabricante}
                        onChange={(event) => atualizarLinha(index, "codigoFabricante", event.target.value)}
                        onPaste={(event) => aoColarNoCampoCodigo(event, index)}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={(event) => aoSoltarNoCampoCodigo(event, index)}
                        disabled={linha.lendoImagemCodigo}
                        placeholder={linha.lendoImagemCodigo ? "Lendo imagem..." : "Cole ou arraste a imagem aqui"}
                      />
                    </td>
                    <td>
                      <select value={linha.status} onChange={(event) => atualizarLinha(index, "status", event.target.value)}>
                        <option value="">—</option>
                        {STATUS_OPCOES.map((opcao) => (
                          <option key={opcao} value={opcao}>
                            {opcao}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select value={linha.reembolso} onChange={(event) => atualizarLinha(index, "reembolso", event.target.value)}>
                        <option value="">—</option>
                        {REEMBOLSO_OPCOES.map((opcao) => (
                          <option key={opcao} value={opcao}>
                            {opcao}
                          </option>
                        ))}
                      </select>
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

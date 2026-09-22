import { randomUUID } from "node:crypto";
import { apiBaseUrl, apiFormat, apiToken, isConfigured, OlistConfigError } from "./olist";
import * as store from "./store";

/**
 * Automatiza o setor de devolução: o atendente digita o código do pedido (o
 * mesmo número que aparece na nota que veio na caixa, ou o número do
 * marketplace quando o cliente só tem esse), e o Tiny já devolve cliente e
 * produto — só falta descrever o defeito.
 *
 * IMPORTANTE — não verificado contra a documentação ao vivo do Tiny: o
 * ambiente onde este código foi escrito bloqueia acesso a tiny.com.br, então
 * os nomes de endpoint/campo abaixo vêm de memória (padrão conhecido da API
 * 2.0: plural pra pesquisa, singular pra obter — ex. produtos.pesquisa.php /
 * produto.obter.php). Teste com um código real antes de confiar no fluxo em
 * produção; se o Tiny devolver outro formato, o erro sobe com a mensagem
 * literal da API (ver `falhaComDetalhe`), o que já indica o que ajustar aqui.
 *
 * Fluxo:
 * 1. pedidos.pesquisa.php?numero=X — acha o `id` do pedido. Se não achar,
 *    tenta de novo por numeroEcommerce=X (o cliente às vezes só tem o número
 *    que o marketplace mostrou pra ele, não o número interno do Tiny).
 * 2. pedido.obter.php?id=Y — traz cliente (nome, cpf_cnpj) e itens (produto).
 * 3. notas.fiscais.pesquisa.php?numeroPedido=X — melhor esforço pra achar o
 *    número da nota fiscal vinculada. Se falhar ou não achar, não derruba a
 *    busca — o campo fica null e o atendente preenche na hora se precisar.
 */

const NO_RECORDS_ERROR_CODE = 32;

function tinyUrl(endpoint: string, params: Record<string, string>): URL {
  const url = new URL(`${apiBaseUrl()}/${endpoint}`);
  url.searchParams.set("token", apiToken());
  url.searchParams.set("formato", apiFormat());
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url;
}

async function tinyGet<T>(endpoint: string, params: Record<string, string>): Promise<T> {
  if (!isConfigured()) {
    throw new OlistConfigError("OLIST_API_TOKEN precisa estar configurado.");
  }
  const response = await fetch(tinyUrl(endpoint, params));
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`${endpoint} falhou (${response.status}): ${detail}`);
  }
  return (await response.json()) as T;
}

function falhaComDetalhe(prefixo: string, erros?: { erro: string }[]): Error {
  const detail = erros?.map((e) => e.erro).join("; ") ?? "erro desconhecido";
  return new Error(`${prefixo}: ${detail}`);
}

interface PedidoPesquisaResponse {
  retorno: {
    status: string;
    codigo_erro?: number;
    pedidos?: { pedido: { id: string; numero: string } }[];
    erros?: { erro: string }[];
  };
}

async function pesquisarIdPedido(campo: "numero" | "numeroEcommerce", valor: string): Promise<string | null> {
  const json = await tinyGet<PedidoPesquisaResponse>("pedidos.pesquisa.php", { [campo]: valor });
  const { retorno } = json;
  if (retorno.status !== "OK") {
    if (retorno.codigo_erro === NO_RECORDS_ERROR_CODE) return null;
    throw falhaComDetalhe("Tiny recusou a busca do pedido", retorno.erros);
  }
  return retorno.pedidos?.[0]?.pedido.id ?? null;
}

interface PedidoDetalhe {
  numero: string;
  data_pedido?: string;
  cliente?: { nome?: string; cpf_cnpj?: string; tipo_pessoa?: string };
  itens?: { item?: { codigo?: string; descricao?: string; quantidade?: string | number } }[];
}

interface PedidoObterResponse {
  retorno: { status: string; erros?: { erro: string }[]; pedido?: PedidoDetalhe };
}

async function obterPedido(id: string): Promise<PedidoDetalhe> {
  const json = await tinyGet<PedidoObterResponse>("pedido.obter.php", { id });
  const { retorno } = json;
  if (retorno.status !== "OK" || !retorno.pedido) {
    throw falhaComDetalhe("Tiny recusou a busca dos detalhes do pedido", retorno.erros);
  }
  return retorno.pedido;
}

interface NotaFiscalPesquisaResponse {
  retorno: {
    status: string;
    codigo_erro?: number;
    notas_fiscais?: { nota_fiscal?: { numero?: string } }[];
  };
}

/** Melhor esforço: número da nota fiscal não é essencial pro fluxo, só um extra quando o Tiny consegue achar. */
async function buscarNumeroNotaFiscal(numeroPedido: string): Promise<string | null> {
  try {
    const json = await tinyGet<NotaFiscalPesquisaResponse>("notas.fiscais.pesquisa.php", { numeroPedido });
    if (json.retorno.status !== "OK") return null;
    return json.retorno.notas_fiscais?.[0]?.nota_fiscal?.numero ?? null;
  } catch {
    return null;
  }
}

export type ClienteInfo = {
  nome: string;
  documento: string;
  tipoPessoa: "F" | "J" | null;
};

export type ProdutoPedido = {
  codigo: string;
  descricao: string;
  quantidade: number;
};

export type PedidoEncontrado = {
  numeroPedido: string;
  numeroNotaFiscal: string | null;
  dataPedido: string | null;
  cliente: ClienteInfo;
  produtos: ProdutoPedido[];
};

/** Aceita tanto o número interno do pedido quanto o número do marketplace. */
export async function buscarPedidoPorCodigo(codigoBruto: string): Promise<PedidoEncontrado> {
  const codigo = codigoBruto.trim();
  if (!codigo) {
    throw new Error("Informe o código do pedido ou da nota.");
  }

  const id = (await pesquisarIdPedido("numero", codigo)) ?? (await pesquisarIdPedido("numeroEcommerce", codigo));
  if (!id) {
    throw new Error(`Nenhum pedido encontrado com o código "${codigo}". Confira o número e tente de novo.`);
  }

  const detalhe = await obterPedido(id);
  const numeroNotaFiscal = await buscarNumeroNotaFiscal(detalhe.numero);
  const tipoPessoa = detalhe.cliente?.tipo_pessoa === "J" ? "J" : detalhe.cliente?.tipo_pessoa === "F" ? "F" : null;

  return {
    numeroPedido: detalhe.numero,
    numeroNotaFiscal,
    dataPedido: detalhe.data_pedido ?? null,
    cliente: {
      nome: detalhe.cliente?.nome ?? "",
      documento: detalhe.cliente?.cpf_cnpj ?? "",
      tipoPessoa,
    },
    produtos: (detalhe.itens ?? [])
      .map((registro) => registro.item)
      .filter((item): item is NonNullable<typeof item> => item != null)
      .map((item) => ({
        codigo: item.codigo ?? "",
        descricao: item.descricao ?? "",
        quantidade: Number(item.quantidade) || 0,
      })),
  };
}

export type DevolucaoRegistro = {
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
};

const DEVOLUCOES_KEY = "devolucoes:registros";

export async function listarDevolucoes(): Promise<DevolucaoRegistro[]> {
  const registros = (await store.get<DevolucaoRegistro[]>(DEVOLUCOES_KEY)) ?? [];
  return [...registros].sort((a, b) => b.criadoEm.localeCompare(a.criadoEm));
}

export async function salvarDevolucao(input: Omit<DevolucaoRegistro, "id" | "criadoEm">): Promise<DevolucaoRegistro> {
  const registro: DevolucaoRegistro = {
    ...input,
    id: randomUUID(),
    criadoEm: new Date().toISOString(),
  };
  const atuais = (await store.get<DevolucaoRegistro[]>(DEVOLUCOES_KEY)) ?? [];
  await store.set(DEVOLUCOES_KEY, [...atuais, registro]);
  return registro;
}

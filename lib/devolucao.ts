import { tinyGet } from "./tinyClient";
import { nomeProdutoPlanilha } from "./produtoPlanilha";

/**
 * Busca uma nota fiscal de venda no Tiny pelo número e monta a prévia da
 * linha da planilha de devoluções — só leitura, nunca escreve nada no Tiny.
 *
 * Fluxo (API 2.0, mesmo token de OLIST_API_TOKEN):
 * 1. `notas.fiscais.pesquisa.php?numero=X&tipoNota=S` acha a(s) nota(s) de
 *    venda com esse número. Se vier mais de uma (séries diferentes), usa a
 *    de emissão mais recente e devolve o resto em `outras`.
 * 2. `nota.fiscal.obter.php?id=Y` traz cliente, itens e o pedido de origem
 *    (`id_venda`).
 * 3. Pra achar o marketplace: se tiver `id_venda`, `pedido.obter.php?id=Z`
 *    e lê `pedido.ecommerce.nomeEcommerce`; se não der, cai pro
 *    `intermediador.nome` da própria nota.
 *
 * Usa GET com os parâmetros na URL (via lib/tinyClient.ts), não POST — é o
 * mesmo padrão já usado (e funcionando) em lib/olist.ts e
 * lib/relatorioVendas.ts pra separacao/pedidos.pesquisa.php e
 * pedido.obter.php. Não deu pra confirmar contra a documentação ao vivo do
 * Tiny se `notas.fiscais.pesquisa.php`/`nota.fiscal.obter.php` aceitam GET
 * do mesmo jeito (tiny.com.br bloqueado no ambiente onde isso foi escrito) —
 * teste com uma NF real antes de confiar em produção. Se o Tiny exigir POST
 * pra esses dois endpoints especificamente, é só trocar o `fetch` dentro de
 * tinyGet (lib/tinyClient.ts) pra incluir `{ method: "POST" }`.
 */

const SEM_REGISTROS_ERROR_CODE = 32;
const LIMITE_TAXA_ERROR_CODE = 6;

export class NfNaoEncontradaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NfNaoEncontradaError";
  }
}

export class TinyLimiteTaxaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TinyLimiteTaxaError";
  }
}

interface RetornoComErro {
  status: string;
  codigo_erro?: number;
  erros?: { erro: string }[];
}

function falhaTiny(prefixo: string, retorno: RetornoComErro): Error {
  if (retorno.codigo_erro === LIMITE_TAXA_ERROR_CODE) {
    return new TinyLimiteTaxaError("O Tiny bloqueou temporariamente as requisições (limite de taxa excedido). Aguarde alguns segundos e tente de novo.");
  }
  const detalhe = retorno.erros?.map((e) => e.erro).join("; ") ?? "erro desconhecido";
  return new Error(`${prefixo}: ${detalhe}`);
}

function normalizarBusca(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

function formatarNomeTitulo(nome: string): string {
  return nome
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((palavra) => palavra[0].toUpperCase() + palavra.slice(1).toLowerCase())
    .join(" ");
}

/** CPF (11 dígitos) → 000.000.000-00, CNPJ (14 dígitos) → 00.000.000/0000-00. Formato desconhecido: devolve como veio. */
function formatarDocumento(bruto: string): string {
  const digitos = bruto.replace(/\D/g, "");
  if (digitos.length === 11) return digitos.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  if (digitos.length === 14) return digitos.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  return bruto;
}

function normalizarMarketplace(nomeOrigem: string): string {
  const normalizado = normalizarBusca(nomeOrigem);
  if (!normalizado) return "";
  if (normalizado.includes("shopee")) return "SHOPEE";
  if (normalizado.includes("mercado") && normalizado.includes("full")) return "MERCADO FULL";
  if (normalizado.includes("mercado")) return "MERCADO LIVRE";
  if (normalizado.includes("tiktok")) return "TIKTOK SHOP";
  return nomeOrigem.toUpperCase();
}

function paraDataOrdenavel(dataBr: string): number {
  const [dia, mes, ano] = dataBr.split("/").map(Number);
  return new Date(ano, mes - 1, dia).getTime();
}

interface NotaFiscalResumo {
  id: string;
  numero: string;
  serie?: string;
  data_emissao: string;
}

interface NotasFiscaisPesquisaResponse {
  retorno: RetornoComErro & {
    notas_fiscais?: { nota_fiscal: NotaFiscalResumo }[];
  };
}

async function pesquisarNotasFiscais(numero: string): Promise<{ escolhida: NotaFiscalResumo; outras: NotaFiscalResumo[] }> {
  const json = await tinyGet<NotasFiscaisPesquisaResponse>("notas.fiscais.pesquisa.php", { numero, tipoNota: "S" });
  const { retorno } = json;
  if (retorno.status !== "OK") {
    if (retorno.codigo_erro === SEM_REGISTROS_ERROR_CODE) {
      throw new NfNaoEncontradaError(`Nenhuma nota fiscal de venda encontrada com o número "${numero}".`);
    }
    throw falhaTiny("Tiny recusou a busca da nota fiscal", retorno);
  }

  const encontradas = (retorno.notas_fiscais ?? []).map((registro) => registro.nota_fiscal);
  if (encontradas.length === 0) {
    throw new NfNaoEncontradaError(`Nenhuma nota fiscal de venda encontrada com o número "${numero}".`);
  }

  const [escolhida, ...outras] = [...encontradas].sort(
    (a, b) => paraDataOrdenavel(b.data_emissao) - paraDataOrdenavel(a.data_emissao),
  );
  return { escolhida, outras };
}

interface ClienteNota {
  nome?: string;
  cpf_cnpj?: string;
}

interface ItemNota {
  codigo?: string;
  descricao?: string;
  quantidade?: string | number;
}

interface NotaFiscalDetalhe {
  numero: string;
  data_emissao?: string;
  numero_ecommerce?: string;
  id_venda?: string;
  cliente?: ClienteNota;
  intermediador?: { nome?: string };
  itens?: { item?: ItemNota }[];
}

interface NotaFiscalObterResponse {
  retorno: RetornoComErro & { nota_fiscal?: NotaFiscalDetalhe };
}

async function obterNotaFiscal(id: string): Promise<NotaFiscalDetalhe> {
  const json = await tinyGet<NotaFiscalObterResponse>("nota.fiscal.obter.php", { id });
  const { retorno } = json;
  if (retorno.status !== "OK" || !retorno.nota_fiscal) {
    throw falhaTiny("Tiny recusou a busca dos detalhes da nota fiscal", retorno);
  }
  return retorno.nota_fiscal;
}

interface PedidoObterResponse {
  retorno: { status: string; pedido?: { ecommerce?: { nomeEcommerce?: string } } };
}

async function resolverMarketplace(nota: NotaFiscalDetalhe): Promise<string> {
  let nomeOrigem = nota.intermediador?.nome ?? "";

  if (nota.id_venda) {
    try {
      const json = await tinyGet<PedidoObterResponse>("pedido.obter.php", { id: nota.id_venda });
      const nomeEcommerce = json.retorno.pedido?.ecommerce?.nomeEcommerce;
      if (nomeEcommerce) nomeOrigem = nomeEcommerce;
    } catch {
      // Segue com o intermediador da nota como fallback — não trava a busca por isso.
    }
  }

  return normalizarMarketplace(nomeOrigem);
}

export type ItemDevolucao = {
  codigo: string;
  descricao: string;
  quantidade: number;
  produtoPlanilha: string;
};

export type OutraNotaFiscal = {
  numero: string;
  serie?: string;
  dataEmissao: string;
};

export type DevolucaoPreview = {
  nf: string;
  dataEmissao: string;
  cliente: string;
  cpf: string;
  idPedido: string;
  marketplace: string;
  itens: ItemDevolucao[];
  outras?: OutraNotaFiscal[];
};

export async function buscarDevolucaoPorNf(numeroBruto: string): Promise<DevolucaoPreview> {
  const numero = numeroBruto.trim();
  if (!numero) throw new Error("Informe o número da nota fiscal.");

  const { escolhida, outras } = await pesquisarNotasFiscais(numero);
  const detalhe = await obterNotaFiscal(escolhida.id);
  const marketplace = await resolverMarketplace(detalhe);

  return {
    nf: detalhe.numero,
    dataEmissao: detalhe.data_emissao ?? escolhida.data_emissao,
    cliente: formatarNomeTitulo(detalhe.cliente?.nome ?? ""),
    cpf: formatarDocumento(detalhe.cliente?.cpf_cnpj ?? ""),
    idPedido: detalhe.numero_ecommerce ?? "",
    marketplace,
    itens: (detalhe.itens ?? [])
      .map((registro) => registro.item)
      .filter((item): item is NonNullable<typeof item> => item != null)
      .map((item) => {
        const codigo = item.codigo ?? "";
        const descricao = item.descricao ?? "";
        return {
          codigo,
          descricao,
          quantidade: Math.round(Number(item.quantidade)) || 0,
          produtoPlanilha: nomeProdutoPlanilha(codigo, descricao),
        };
      }),
    outras:
      outras.length > 0
        ? outras.map((n) => ({ numero: n.numero, serie: n.serie, dataEmissao: n.data_emissao }))
        : undefined,
  };
}

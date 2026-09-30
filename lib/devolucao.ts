import { tinyGet } from "./tinyClient";
import { nomeProdutoPlanilha } from "./produtoPlanilha";
import { buscarImportacaoShopee, mapearMotivoParaOcorrencia } from "./shopeeImportacao";

/**
 * Busca uma nota fiscal de venda no Tiny pelo número e monta a prévia da
 * linha da planilha de devoluções — só leitura, nunca escreve nada no Tiny.
 *
 * Fluxo (API 2.0, mesmo token de OLIST_API_TOKEN):
 * 1. `notas.fiscais.pesquisa.php?numero=X&tipoNota=S` acha a(s) nota(s) de
 *    venda com esse número. Se vier mais de uma (séries diferentes), usa a
 *    de emissão mais recente e devolve o resto em `outras`.
 * 1b. Se não achar nenhuma NF com esse número, tenta como "Nº do pedido"
 *    (o `numero_ecommerce` que aparece na tela do Shopee) em vez de NF:
 *    `pedidos.pesquisa.php?numeroEcommerce=X` → `pedido.obter.php?id=Y` →
 *    lê `id_nota_fiscal` e segue o fluxo normal a partir daí. Isso existe
 *    pra quem está na tela de devolução do Shopee (só tem o "Nº do pedido"
 *    à mão, não a NF) não precisar ir no Tiny achar a NF antes de buscar aqui.
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
 *
 * `buscarCandidatosPorNomeCliente`: pacote chegado pelos Correios costuma só
 * ter o NOME do cliente escrito, sem NF nem nº de pedido. Tentativas
 * anteriores usaram um parâmetro `cliente` em `notas.fiscais.pesquisa.php`
 * pra filtrar por nome direto no servidor — deu dois erros reais em
 * produção (primeiro "erro ao executar a consulta", depois um 500 mesmo
 * com filtro de data), sinal forte de que esse parâmetro não existe nesse
 * endpoint. Trocado por uma estratégia que só usa peças JÁ CONFIRMADAS
 * funcionando neste projeto:
 * 1. `pedidos.pesquisa.php?dataInicial=X&dataFinal=Y&pagina=N` — mesmo
 *    endpoint+parâmetros já comprovados em lib/relatorioVendas.ts — busca
 *    TODOS os pedidos dos últimos `JANELA_BUSCA_POR_NOME_DIAS` dias.
 * 2. Compara o nome buscado contra QUALQUER campo de texto de cada pedido
 *    (`algumCampoContemTexto`) — não precisa adivinhar se o campo se chama
 *    `nome`, `cliente` etc.
 * 3. Pros até 5 pedidos mais recentes que bateram: `pedido.obter.php?id=X`
 *    → `id_nota_fiscal` → `nota.fiscal.obter.php?id=Y` (mesma cadeia já
 *    usada no fallback de "Nº do pedido" acima) pra pegar NF, cliente e
 *    itens de verdade.
 * Mais lento que um filtro no servidor (varre pedido por pedido em vez de
 * só os que baterem), por isso a janela é curta (14 dias, não meses) — teto
 * de segurança em `MAX_PEDIDOS_ESCANEADOS_POR_NOME` pra nunca escanear o
 * período inteiro numa busca que devia ser rápida.
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

interface PedidoResumoBusca {
  id: string;
}

interface PedidosPesquisaResponse {
  retorno: RetornoComErro & { pedidos?: { pedido: PedidoResumoBusca }[] };
}

interface PedidoComNotaFiscal {
  id_nota_fiscal?: string;
}

interface PedidoObterParaNotaResponse {
  retorno: { status: string; pedido?: PedidoComNotaFiscal };
}

/**
 * Fallback quando o código digitado não é uma NF, mas o "Nº do pedido" que aparece na tela do
 * Shopee (numero_ecommerce). Devolve null em qualquer passo que não achar — quem chama decide o
 * que fazer (aqui: reportar que não achou nem por NF nem por pedido).
 */
async function buscarIdNotaFiscalPorNumeroPedido(numeroEcommerce: string): Promise<string | null> {
  const pesquisa = await tinyGet<PedidosPesquisaResponse>("pedidos.pesquisa.php", { numeroEcommerce });
  if (pesquisa.retorno.status !== "OK") return null;

  const idPedido = pesquisa.retorno.pedidos?.[0]?.pedido.id;
  if (!idPedido) return null;

  const detalhe = await tinyGet<PedidoObterParaNotaResponse>("pedido.obter.php", { id: idPedido });
  if (detalhe.retorno.status !== "OK") return null;

  return detalhe.retorno.pedido?.id_nota_fiscal ?? null;
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

export type DevolucaoShopee = {
  idDevolucaoShopee?: string;
  /** ISO (yyyy-mm-dd) — a data que o comprador solicitou a devolução no Shopee. */
  dataSolicitacao?: string;
  motivoDevolucao?: string;
  /** null quando `motivoDevolucao` não bateu com nenhuma frase conhecida — o atendente escolhe na mão. */
  ocorrenciaSugerida: string | null;
  descricaoCliente?: string;
  valorReembolso?: number;
  valorCompensacao?: number;
  /** Campo "Opção" do Shopee (ex.: "110V") — só informativo, pra conferir contra o PRODUTO do Tiny. */
  variacaoShopee?: string;
  /** ISO (yyyy-mm-dd) — data em que o produto devolvido chegou de volta na loja. */
  dataRecebimento?: string;
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
  /** Presente só quando o Tampermonkey já raspou esse pedido no Shopee antes do atendente buscar a NF aqui. */
  shopee?: DevolucaoShopee;
};

export async function buscarDevolucaoPorNf(numeroBruto: string): Promise<DevolucaoPreview> {
  const numero = numeroBruto.trim();
  if (!numero) throw new Error("Informe o número da nota fiscal ou do pedido.");

  let idNota: string;
  let outras: NotaFiscalResumo[] = [];
  let dataEmissaoResumo: string | undefined;

  try {
    const resultado = await pesquisarNotasFiscais(numero);
    idNota = resultado.escolhida.id;
    outras = resultado.outras;
    dataEmissaoResumo = resultado.escolhida.data_emissao;
  } catch (error) {
    if (!(error instanceof NfNaoEncontradaError)) throw error;

    // Não é uma NF — tenta como "Nº do pedido" (o que aparece na tela de devolução do Shopee).
    const idPorPedido = await buscarIdNotaFiscalPorNumeroPedido(numero);
    if (!idPorPedido) {
      throw new NfNaoEncontradaError(`Nenhuma nota fiscal ou pedido encontrado com "${numero}".`);
    }
    idNota = idPorPedido;
  }

  const detalhe = await obterNotaFiscal(idNota);
  const marketplace = await resolverMarketplace(detalhe);
  const idPedido = detalhe.numero_ecommerce ?? "";
  const importacaoShopee = buscarImportacaoShopee(idPedido);

  return {
    nf: detalhe.numero,
    dataEmissao: detalhe.data_emissao ?? dataEmissaoResumo ?? "",
    cliente: formatarNomeTitulo(detalhe.cliente?.nome ?? ""),
    cpf: formatarDocumento(detalhe.cliente?.cpf_cnpj ?? ""),
    idPedido,
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
    shopee: importacaoShopee
      ? {
          idDevolucaoShopee: importacaoShopee.idDevolucaoShopee,
          dataSolicitacao: importacaoShopee.dataSolicitacao,
          motivoDevolucao: importacaoShopee.motivoDevolucao,
          ocorrenciaSugerida: mapearMotivoParaOcorrencia(importacaoShopee.motivoDevolucao),
          descricaoCliente: importacaoShopee.descricaoCliente,
          valorReembolso: importacaoShopee.valorReembolso,
          valorCompensacao: importacaoShopee.valorCompensacao,
          variacaoShopee: importacaoShopee.variacaoShopee,
          dataRecebimento: importacaoShopee.dataRecebimento,
        }
      : undefined,
  };
}

const MAX_CANDIDATOS_POR_NOME = 5;
// Curta de propósito: sem confirmação de que o Tiny filtra por nome no servidor, a busca varre
// TODOS os pedidos do período e casa o nome no nosso próprio código (ver doc do topo do arquivo).
// No volume real desse negócio (~630 pedidos/dia, visto em lib/relatorioVendas.ts), uma janela
// maior varreria milhares de pedidos numa busca que devia ser rápida — 14 dias fica em torno de
// ~9 mil pedidos no pior caso, ainda alto mas tolerável pra uma busca ocasional.
const JANELA_BUSCA_POR_NOME_DIAS = 14;
// Teto de segurança: para de escanear páginas de pedidos depois disso, mesmo sem ter achado nada —
// existe só pra nunca deixar uma busca por nome rodar por minutos varrendo o período inteiro.
const MAX_PEDIDOS_ESCANEADOS_POR_NOME = 3000;
const RATE_LIMIT_DELAY_MS_NOME = 120;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** dd/mm/yyyy no fuso do Brasil — mesmo formato que dataInicial/dataFinal já usam em lib/olist.ts. */
function dataEmSaoPauloBr(data: Date): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric" }).format(
    data,
  );
}

function diasAtrasEmSaoPauloBr(dias: number): string {
  const data = new Date();
  data.setUTCDate(data.getUTCDate() - dias);
  return dataEmSaoPauloBr(data);
}

/** Pedido "in natura" da pesquisa — não sabemos o nome exato do campo do cliente, então guarda tudo. */
interface PedidoResumoGenerico {
  id: string;
  data_pedido?: string;
  [chave: string]: unknown;
}

interface PedidosPesquisaGenericaResponse {
  retorno: RetornoComErro & { numero_paginas?: number; pedidos?: { pedido: PedidoResumoGenerico }[] };
}

/**
 * Em vez de apostar em qual chave o Tiny usa pro nome do cliente na lista de pedidos (`nome`?
 * `cliente`? `nomeCliente`?), procura o termo em QUALQUER campo de texto do registro — funciona
 * seja qual for o nome do campo, desde que o nome do cliente apareça em algum lugar do resumo
 * (o que precisa ser verdade de qualquer forma, senão a própria tela de pedidos do Tiny não
 * daria pra escanear visualmente por cliente).
 */
function algumCampoContemTexto(objeto: Record<string, unknown>, termoNormalizado: string): boolean {
  return Object.values(objeto).some((valor) => typeof valor === "string" && normalizarBusca(valor).includes(termoNormalizado));
}

/**
 * Mesma ideia de `algumCampoContemTexto`, mas pra CPF: compara só os DÍGITOS de cada campo contra
 * os dígitos buscados, ignorando pontuação — assim funciona tanto se o Tiny guarda o CPF formatado
 * ("037.779.470-83") quanto só os números, sem precisar adivinhar qual dos dois.
 */
function algumCampoContemDigitos(objeto: Record<string, unknown>, digitosBuscados: string): boolean {
  return Object.values(objeto).some((valor) => typeof valor === "string" && valor.replace(/\D/g, "").includes(digitosBuscados));
}

export type CandidatoDevolucao = {
  nf: string;
  cliente: string;
  dataEmissao: string;
  /** Nomes curtos (coluna PRODUTO da planilha) dos itens da nota — ajuda a reconhecer o pacote sem abrir nada. */
  produtos: string[];
};

/**
 * Motor compartilhado por busca-por-nome e busca-por-CPF: varre `pedidos.pesquisa.php` na janela
 * de `JANELA_BUSCA_POR_NOME_DIAS` dias, aplica `bate` em cada resumo de pedido, e resolve os até
 * `MAX_CANDIDATOS_POR_NOME` mais recentes que passaram em NF de verdade (pedido.obter.php →
 * id_nota_fiscal → nota.fiscal.obter.php) — pulando pedido sem NF emitida ainda.
 */
async function buscarCandidatosPorPredicado(
  bate: (pedido: PedidoResumoGenerico) => boolean,
): Promise<{ candidatos: CandidatoDevolucao[]; podeTerMais: boolean }> {
  const dataInicial = diasAtrasEmSaoPauloBr(JANELA_BUSCA_POR_NOME_DIAS);
  const dataFinal = dataEmSaoPauloBr(new Date());

  const encontrados: PedidoResumoGenerico[] = [];
  let pagina = 1;
  let totalPaginas = 1;
  let escaneados = 0;

  do {
    const json = await tinyGet<PedidosPesquisaGenericaResponse>("pedidos.pesquisa.php", {
      dataInicial,
      dataFinal,
      pagina: String(pagina),
    });
    const { retorno } = json;
    if (retorno.status !== "OK") {
      if (retorno.codigo_erro === SEM_REGISTROS_ERROR_CODE) break;
      throw falhaTiny("Tiny recusou a busca de pedidos do período", retorno);
    }

    for (const registro of retorno.pedidos ?? []) {
      escaneados++;
      if (bate(registro.pedido)) encontrados.push(registro.pedido);
    }

    totalPaginas = retorno.numero_paginas ?? 1;
    pagina++;
    if (escaneados >= MAX_PEDIDOS_ESCANEADOS_POR_NOME) break;
    if (pagina <= totalPaginas) await sleep(RATE_LIMIT_DELAY_MS_NOME);
  } while (pagina <= totalPaginas);

  const maisRecentesPrimeiro = [...encontrados].sort(
    (a, b) => paraDataOrdenavel(typeof b.data_pedido === "string" ? b.data_pedido : "") -
      paraDataOrdenavel(typeof a.data_pedido === "string" ? a.data_pedido : ""),
  );

  const candidatos: CandidatoDevolucao[] = [];
  for (const pedidoResumo of maisRecentesPrimeiro) {
    if (candidatos.length >= MAX_CANDIDATOS_POR_NOME) break;

    const pedidoDetalhe = await tinyGet<PedidoObterParaNotaResponse>("pedido.obter.php", { id: pedidoResumo.id });
    const idNotaFiscal = pedidoDetalhe.retorno.pedido?.id_nota_fiscal;
    if (pedidoDetalhe.retorno.status !== "OK" || !idNotaFiscal) continue; // pedido sem NF emitida — nada pra abrir na prévia

    const nota = await obterNotaFiscal(idNotaFiscal);
    const produtos = (nota.itens ?? [])
      .map((registro) => registro.item)
      .filter((item): item is NonNullable<typeof item> => item != null)
      .map((item) => nomeProdutoPlanilha(item.codigo ?? "", item.descricao ?? ""));

    candidatos.push({
      nf: nota.numero,
      cliente: formatarNomeTitulo(nota.cliente?.nome ?? ""),
      dataEmissao: nota.data_emissao ?? "",
      produtos,
    });
  }

  return { candidatos, podeTerMais: encontrados.length > MAX_CANDIDATOS_POR_NOME };
}

/** Busca por NOME do cliente em vez de NF/pedido — ver doc do topo do arquivo pra o porquê. */
export async function buscarCandidatosPorNomeCliente(
  nomeBruto: string,
): Promise<{ candidatos: CandidatoDevolucao[]; podeTerMais: boolean }> {
  const nome = nomeBruto.trim();
  if (!nome) throw new Error("Informe o nome do cliente.");
  const termo = normalizarBusca(nome);
  return buscarCandidatosPorPredicado((pedido) => algumCampoContemTexto(pedido, termo));
}

/**
 * Busca por CPF do cliente — a etiqueta de devolução dos Correios (DACE) traz o CPF do
 * REMETENTE bem visível, e é um dado exato (sem ambiguidade de "qual Maria é essa"), então vale
 * mais a pena que buscar por nome quando dá pra ler o CPF na etiqueta.
 */
export async function buscarCandidatosPorCpfCliente(
  cpfBruto: string,
): Promise<{ candidatos: CandidatoDevolucao[]; podeTerMais: boolean }> {
  const digitos = cpfBruto.replace(/\D/g, "");
  if (digitos.length !== 11) throw new Error("Informe um CPF com 11 dígitos.");
  return buscarCandidatosPorPredicado((pedido) => algumCampoContemDigitos(pedido, digitos));
}

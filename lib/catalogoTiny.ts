import { tinyGet } from "./tinyClient";

/**
 * Busca produtos no cadastro do Tiny pra popular o catálogo do Estoque sem digitar um por um.
 * `produtos.pesquisa.php` exige um termo (não aceita vazio) — por isso a busca é por palavra
 * (padrão "koti"). Chamada só quando alguém clica em "Buscar no Tiny" (não roda em loop), e
 * limitada a MAX_PAGINAS pra não pesar no limite de taxa.
 *
 * No Estoque a voltagem é um campo separado da posição, então o nome sugerido pro catálogo tira
 * a voltagem do nome do Tiny ("Chaleira Koti Modern Preta - 110V" → "Chaleira Koti Modern Preta")
 * e junta as variações iguais num item só.
 */

const MAX_PAGINAS = 10;
const SEM_REGISTROS_ERROR_CODE = 32;

interface ProdutosPesquisaResponse {
  retorno: {
    status: string;
    codigo_erro?: number | string;
    numero_paginas?: number;
    erros?: { erro: string }[];
    produtos?: { produto: { id?: string | number; nome?: string; codigo?: string; situacao?: string; tipoVariacao?: string } }[];
  };
}

export interface ProdutoTiny {
  /** Nome sugerido pro catálogo (sem voltagem). */
  sugestao: string;
  /** Nomes originais no Tiny que viraram essa sugestão. */
  nomesTiny: string[];
  codigos: string[];
  /** IDs dos produtos no Tiny — usados depois pra puxar a foto (lib/fotosProdutos.ts). */
  idsTiny: string[];
}

/**
 * Nome pro catálogo do Estoque: o nome do Tiny SEM a voltagem (que é escolhida na longarina) — mas
 * mantendo a cor, que separa produtos de verdade (ex.: Elegance Azul e Elegance Vermelha são dois
 * cards, cada um com a sua foto). Aceita os formatos que aparecem no Tiny:
 *   "Chaleira Koti Modern Preta 1,7L - 110V"   → "Chaleira Koti Modern Preta 1,7L"
 *   "Chaleira Elegance - Azul - 220V"          → "Chaleira Elegance Azul"
 *   "Chaleira Elegance Cor: Vermelha, Voltagem: 110V" → "Chaleira Elegance Vermelha"
 */
export function nomeSemVoltagem(nome: string): string {
  const semVoltagem = nome
    .replace(/\b(voltagem|tens[aã]o)\s*:\s*/gi, "")
    .replace(/\bcor\s*:\s*/gi, "")
    .replace(/\b(110|127|220)\s*v\b/gi, "")
    .replace(/\bbivolt\b/gi, "")
    .replace(/\(\s*\)/g, "");
  // Separadores (" - ", "/", ";", vírgula que NÃO está entre dígitos como em "1,7L") viram espaço;
  // pedaços vazios (onde estava só a voltagem) somem.
  return semVoltagem
    .split(/\s*(?:[-–—/;|]|,(?!\d))\s*/)
    .map((parte) => parte.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

interface ProdutoBruto {
  id: string;
  nome: string;
  codigo?: string;
  tipoVariacao?: string;
}

/**
 * Agrupa os produtos do Tiny pelo nome sugerido. Produto PAI de variações (tipoVariacao "P") fica de
 * fora quando as variações dele também vieram — o nome do pai não tem a cor, e viraria um card
 * genérico ("Chaleira Elegance") além dos cards por cor.
 */
export function agruparProdutosTiny(brutos: ProdutoBruto[]): ProdutoTiny[] {
  const nomesNorm = brutos.map((p) => p.nome.toLowerCase());
  const visiveis = brutos.filter((p, i) => {
    if ((p.tipoVariacao ?? "").toUpperCase() !== "P") return true;
    const base = nomesNorm[i];
    return !brutos.some((outro, j) => j !== i && (outro.tipoVariacao ?? "").toUpperCase() === "V" && nomesNorm[j].startsWith(base));
  });

  const porSugestao = new Map<string, ProdutoTiny>();
  for (const produto of visiveis) {
    const sugestao = nomeSemVoltagem(produto.nome);
    if (!sugestao) continue;
    const chave = sugestao.toLowerCase();
    const atual = porSugestao.get(chave) ?? { sugestao, nomesTiny: [], codigos: [], idsTiny: [] };
    if (!atual.nomesTiny.includes(produto.nome)) atual.nomesTiny.push(produto.nome);
    if (produto.codigo && !atual.codigos.includes(produto.codigo)) atual.codigos.push(produto.codigo);
    if (produto.id && !atual.idsTiny.includes(produto.id)) atual.idsTiny.push(produto.id);
    porSugestao.set(chave, atual);
  }
  return [...porSugestao.values()].sort((a, b) => a.sugestao.localeCompare(b.sugestao, "pt-BR"));
}

export async function buscarProdutosTiny(termo: string): Promise<ProdutoTiny[]> {
  const pesquisa = termo.trim();
  if (!pesquisa) throw new Error("Informe uma palavra pra buscar no Tiny (ex.: koti).");

  const brutos: ProdutoBruto[] = [];
  let pagina = 1;
  let totalPaginas = 1;
  do {
    const { retorno } = await tinyGet<ProdutosPesquisaResponse>("produtos.pesquisa.php", { pesquisa, situacao: "A", pagina: String(pagina) });
    if (retorno.status !== "OK") {
      if (Number(retorno.codigo_erro) === SEM_REGISTROS_ERROR_CODE) break;
      throw new Error(`Tiny recusou a busca: ${retorno.erros?.map((e) => e.erro).join("; ") || "erro desconhecido"}`);
    }
    for (const { produto } of retorno.produtos ?? []) {
      const nome = (produto.nome ?? "").trim();
      if (!nome) continue;
      brutos.push({ id: produto.id ? String(produto.id) : "", nome, codigo: produto.codigo, tipoVariacao: produto.tipoVariacao });
    }
    totalPaginas = Math.min(retorno.numero_paginas ?? 1, MAX_PAGINAS);
    pagina++;
  } while (pagina <= totalPaginas);

  return agruparProdutosTiny(brutos);
}

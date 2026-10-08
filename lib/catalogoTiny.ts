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
    produtos?: { produto: { id?: string | number; nome?: string; codigo?: string; situacao?: string } }[];
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

export function nomeSemVoltagem(nome: string): string {
  return nome
    .replace(/\b(110|127|220)\s*v\b/gi, "")
    .replace(/\bbivolt\b/gi, "")
    .replace(/\s*[-–—/]\s*$/g, "")
    .replace(/\s*[-–—]\s*(?=[-–—]|$)/g, "")
    .replace(/\(\s*\)/g, "")
    .replace(/\s{2,}/g, " ")
    .trim()
    .replace(/[-–—/,]+$/, "")
    .trim();
}

export async function buscarProdutosTiny(termo: string): Promise<ProdutoTiny[]> {
  const pesquisa = termo.trim();
  if (!pesquisa) throw new Error("Informe uma palavra pra buscar no Tiny (ex.: koti).");

  const porSugestao = new Map<string, ProdutoTiny>();
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
      const sugestao = nomeSemVoltagem(nome);
      const chave = sugestao.toLowerCase();
      const atual = porSugestao.get(chave) ?? { sugestao, nomesTiny: [], codigos: [], idsTiny: [] };
      if (!atual.nomesTiny.includes(nome)) atual.nomesTiny.push(nome);
      if (produto.codigo && !atual.codigos.includes(produto.codigo)) atual.codigos.push(produto.codigo);
      if (produto.id && !atual.idsTiny.includes(String(produto.id))) atual.idsTiny.push(String(produto.id));
      porSugestao.set(chave, atual);
    }
    totalPaginas = Math.min(retorno.numero_paginas ?? 1, MAX_PAGINAS);
    pagina++;
  } while (pagina <= totalPaginas);

  return [...porSugestao.values()].sort((a, b) => a.sugestao.localeCompare(b.sugestao, "pt-BR"));
}

import * as store from "./store";

/**
 * Histórico de devoluções registradas pela tela de Devoluções — antes ela só copiava as linhas pra
 * planilha e não guardava nada; agora cada cópia também grava aqui, e a aba "Histórico" monta os
 * indicadores (motivos, produtos que mais voltam, marketplace) a partir disso.
 *
 * Guardado em "fatias" por mês de registro (`devolucoes:historico:AAAA-MM`) em vez de uma chave só:
 * o volume cresce sem parar (dezenas por dia), e cada gravação lê+regrava a chave inteira — com
 * fatia mensal o custo de uma gravação fica no tamanho de um mês, não do histórico todo.
 *
 * Registrar de novo a mesma linha (mesma NF + mesmo produto — ex.: a pessoa copiou duas vezes, ou
 * corrigiu a ocorrência e copiou de novo) ATUALIZA o registro em vez de duplicar. A busca do
 * registro existente olha o mês atual e o anterior: recópia acontece no mesmo dia/semana na prática;
 * uma linha recopiada meses depois vira um registro novo (documentado, não é bug).
 */

const PREFIXO = "devolucoes:historico:";

export interface RegistroDevolucao {
  id: string;
  /** ISO (aaaa-mm-dd) — "Data pedido SAC" da linha; é a data usada nos filtros e indicadores. */
  data: string;
  nf: string;
  idPedido: string;
  cliente: string;
  marketplace: string;
  ocorrencia: string;
  observacoes: string;
  quantidade: number;
  produto: string;
  /** SKU do Tiny — liga a devolução às vendas (taxa de devolução por produto). Vazio em linha importada da planilha. */
  codigoProduto: string;
  dataRecebimento: string;
  defeito: string;
  codigoFabricante: string;
  status: string;
  reembolso: string;
  /** Só existe quando veio do Shopee (raspado pelo Tampermonkey). */
  valorReembolso?: number;
  origem: "tela" | "planilha";
  registradoEm: string;
}

export type EntradaDevolucao = Omit<RegistroDevolucao, "id" | "registradoEm">;

function mesDe(iso: string): string {
  return iso.slice(0, 7);
}

function mesAnterior(mes: string): string {
  const [ano, m] = mes.split("-").map(Number);
  return m === 1 ? `${ano - 1}-12` : `${ano}-${String(m - 1).padStart(2, "0")}`;
}

function normalizarChave(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Mesma NF + mesmo produto (SKU quando tem, senão nome) = mesma linha da devolução. */
export function idDoRegistro(entrada: Pick<EntradaDevolucao, "nf" | "codigoProduto" | "produto">): string {
  return `${normalizarChave(entrada.nf)}::${normalizarChave(entrada.codigoProduto || entrada.produto)}`;
}

/** "dd/mm/aaaa" → "aaaa-mm-dd". Devolve null pra qualquer coisa fora desse formato. */
export function brParaIso(dataBr: string): string | null {
  const m = dataBr.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

export async function registrarDevolucoes(entradas: EntradaDevolucao[], agora = new Date()): Promise<{ novos: number; atualizados: number }> {
  const registradoEm = agora.toISOString();
  const mesAtual = mesDe(registradoEm);
  const chaveAtual = PREFIXO + mesAtual;
  const chaveAnterior = PREFIXO + mesAnterior(mesAtual);

  const anteriores = (await store.get<RegistroDevolucao[]>(chaveAnterior)) ?? [];
  const idsNoMesAnterior = new Set(anteriores.map((r) => r.id));

  let novos = 0;
  let atualizados = 0;
  const paraMesAnterior = new Map<string, EntradaDevolucao>();

  await store.update<RegistroDevolucao[]>(chaveAtual, (atual) => {
    const lista = [...(atual ?? [])];
    for (const entrada of entradas) {
      const id = idDoRegistro(entrada);
      const indice = lista.findIndex((r) => r.id === id);
      if (indice >= 0) {
        lista[indice] = { ...lista[indice], ...entrada, id };
        atualizados++;
      } else if (idsNoMesAnterior.has(id)) {
        paraMesAnterior.set(id, entrada);
      } else {
        lista.push({ ...entrada, id, registradoEm });
        novos++;
      }
    }
    return lista;
  });

  if (paraMesAnterior.size > 0) {
    await store.update<RegistroDevolucao[]>(chaveAnterior, (atual) =>
      (atual ?? []).map((r) => {
        const entrada = paraMesAnterior.get(r.id);
        return entrada ? { ...r, ...entrada, id: r.id } : r;
      }),
    );
    atualizados += paraMesAnterior.size;
  }

  return { novos, atualizados };
}

function mesesEntre(deIso: string, ateIso: string): string[] {
  const meses: string[] = [];
  let atual = mesDe(ateIso);
  const primeiro = mesDe(deIso);
  // Registro entra na fatia do mês em que foi REGISTRADO, que pode ser depois da "data" (SAC) dele
  // — por isso lê até o mês corrente, não só até `ate`.
  const hoje = mesDe(new Date().toISOString());
  if (hoje > atual) atual = hoje;
  while (atual >= primeiro && meses.length < 120) {
    meses.push(atual);
    atual = mesAnterior(atual);
  }
  return meses;
}

/** Registros com `data` entre `de` e `ate` (inclusive, ISO), mais recentes primeiro. */
export async function listarDevolucoes(deIso: string, ateIso: string): Promise<RegistroDevolucao[]> {
  // Começa um mês antes de `de`: um registro feito no começo de um mês pode ter "data" SAC do mês
  // anterior, e vice-versa — a fatia certa é pelo registro, o filtro final é pela data.
  const fatias = await Promise.all(mesesEntre(mesAnterior(mesDe(deIso)) + "-01", ateIso).map((mes) => store.get<RegistroDevolucao[]>(PREFIXO + mes)));
  return fatias
    .flatMap((fatia) => fatia ?? [])
    .filter((r) => r.data >= deIso && r.data <= ateIso)
    .sort((a, b) => (a.data === b.data ? b.registradoEm.localeCompare(a.registradoEm) : b.data.localeCompare(a.data)));
}

export async function removerDevolucao(id: string, registradoEm: string): Promise<void> {
  await store.update<RegistroDevolucao[]>(PREFIXO + mesDe(registradoEm), (atual) => (atual ?? []).filter((r) => r.id !== id));
}

/**
 * Linhas coladas da planilha (mesma ordem de colunas que "Copiar p/ planilha" gera — A a O,
 * separadas por TAB). Linha sem NF, sem produto ou com data inválida é descartada e contada em
 * `ignoradas` — nunca inventa valor.
 */
export function parsearLinhasPlanilha(texto: string): { entradas: EntradaDevolucao[]; ignoradas: number } {
  const entradas: EntradaDevolucao[] = [];
  let ignoradas = 0;
  for (const linhaBruta of texto.split(/\r?\n/)) {
    if (!linhaBruta.trim()) continue;
    const c = linhaBruta.split("\t").map((v) => v.trim());
    const data = brParaIso(c[0] ?? "");
    const nf = c[4] ?? "";
    const produto = c[9] ?? "";
    if (!data || !nf || !produto) {
      ignoradas++;
      continue;
    }
    entradas.push({
      data,
      cliente: c[1] ?? "",
      idPedido: c[3] ?? "",
      nf,
      marketplace: c[5] ?? "",
      ocorrencia: (c[6] ?? "").toUpperCase(),
      observacoes: c[7] ?? "",
      quantidade: Number(c[8]) || 1,
      produto,
      codigoProduto: "",
      dataRecebimento: c[10] ?? "",
      defeito: c[11] ?? "",
      codigoFabricante: c[12] ?? "",
      status: c[13] ?? "",
      reembolso: c[14] ?? "",
      origem: "planilha",
    });
  }
  return { entradas, ignoradas };
}

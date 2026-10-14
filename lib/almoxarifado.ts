import { randomUUID } from "node:crypto";
import * as store from "./store";

export type TipoMovimentacaoAlmox = "entrada" | "saida" | "ajuste";

export interface ItemAlmox {
  id: string;
  nome: string;
  saldo: number | string;
  minimo: number | string;
  passo: number;
  unidade: string;
  saldoSecundario?: number | string;
  unidadeSecundaria?: string;
}

export interface CategoriaAlmox {
  id: string;
  nome: string;
  itens: ItemAlmox[];
}

export interface MovimentacaoAlmox {
  id: string;
  criadoEm: string;
  categoriaId: string;
  itemId: string;
  itemNome: string;
  tipo: TipoMovimentacaoAlmox;
  quantidade: number;
  unidade: string;
  saldo: number;
  observacao: string;
}

export interface EstadoAlmoxarifado {
  categorias: CategoriaAlmox[];
  historico: MovimentacaoAlmox[];
}

const CHAVE_STORE = "almoxarifado:estado";

const item = (
  id: string,
  nome: string,
  saldo: number | string,
  minimo: number | string,
  passo: number,
  unidade: string,
  saldoSecundario?: number,
  unidadeSecundaria = "etiquetas",
): ItemAlmox => ({ id, nome, saldo, minimo, passo, unidade, ...(saldoSecundario !== undefined ? { saldoSecundario, unidadeSecundaria } : {}) });

export const ESTADO_ALMOXARIFADO_PADRAO: EstadoAlmoxarifado = {
  categorias: [
    {
      id: "embalagens",
      nome: "Embalagens",
      itens: [
        item("emb-30x40", "EMBALAGEM 30X40", 500, 200, 50, "unidades"),
        item("emb-50x40", "EMBALAGEM 50X40", 3750, 2000, 250, "unidades"),
        item("emb-40x50", "EMBALAGEM 40X50", 1500, 2000, 250, "unidades"),
        item("emb-60x60", "EMBALAGEM 60X60", 550, 250, 50, "unidades"),
        item("emb-80x80", "EMBALAGEM 80X80", 500, 250, 50, "unidades"),
        item("bobina-strach", "BOBINA STRACH", 13, 6, 1, "bobinas"),
        item("plastico-bolha", "PLÁSTICO BOLHA", 1, 1, 1, "unidades"),
      ],
    },
    {
      id: "etiquetas",
      nome: "Etiquetas",
      itens: [
        item("etq-fragil-bancada", "ETIQUETA FRÁGIL BANCADA", 14, 10, 1, "rolos", 7000),
        item("etq-fragil-full", "ETIQUETA FRÁGIL FULL", 4, 5, 1, "rolos", 4000),
        item("etq-zebra", "ETIQUETA ZEBRA", 70000, 30000, 1000, "unidades"),
        item("etq-dupla-full", "ETIQUETA DUPLA FULL", 26000, 5000, 1000, "unidades", 13, "rolos"),
      ],
    },
    {
      id: "variados",
      nome: "Variados",
      itens: [
        item("fita-lacre", "FITA LACRE", 59, 20, 1, "rolos"),
        item("fita-durex-grande", "FITA DUREX GRANDE", 14, 5, 1, "rolos"),
        item("fita-durex-pequena", "FITA DUREX PEQUENA", 120, 30, 1, "rolos"),
        item("cadeado-pequeno", "CADEADO PEQUENO", 4, 2, 1, "unidades"),
        item("lamina-estilete", "LÂMINA PARA ESTILETE", 60, 20, 1, "unidades"),
        item("grampo-simples", "GRAMPO SIMPLES", "MEIA", "", 1, "caixas"),
        item("grampo-6mm", "GRAMPO 6MM", 200, 100, 1, "unidades"),
        item("grampo-12mm", "GRAMPO 12MM", 800, 300, 1, "unidades"),
        item("clips-medio", "CLIPS MÉDIO", 300, 100, 1, "unidades"),
        item("caneta-vermelha", "CANETA VERMELHA", 18, 5, 1, "unidades"),
        item("caneta-preta", "CANETA PRETA", 7, 5, 1, "unidades"),
        item("lapis", "LÁPIS", 6, 3, 1, "unidades"),
        item("marcador-vermelho", "MARCADOR VERMELHO", 1, 1, 1, "unidades"),
        item("marcador-azul", "MARCADOR AZUL", 1, 1, 1, "unidades"),
        item("marcador-preto", "MARCADOR PRETO", 1, 1, 1, "unidades"),
        item("bipador", "BIPADOR", 1, 1, 1, "unidades"),
        item("hub-usb", "HUB USB", 1, 1, 1, "unidades"),
      ],
    },
  ],
  historico: [],
};

function copiarPadrao(): EstadoAlmoxarifado {
  return structuredClone(ESTADO_ALMOXARIFADO_PADRAO);
}

export async function obterAlmoxarifado(): Promise<EstadoAlmoxarifado> {
  return (await store.get<EstadoAlmoxarifado>(CHAVE_STORE)) ?? copiarPadrao();
}

function quantidadeValida(valor: unknown): valor is number {
  return typeof valor === "number" && Number.isSafeInteger(valor) && valor >= 0;
}

function encontrarItem(estado: EstadoAlmoxarifado, itemId: string) {
  for (const categoria of estado.categorias) {
    const itemEncontrado = categoria.itens.find((candidato) => candidato.id === itemId);
    if (itemEncontrado) return { categoria, item: itemEncontrado };
  }
  throw new Error("Item do almoxarifado não encontrado.");
}

function registrarNoHistorico(
  estado: EstadoAlmoxarifado,
  categoria: CategoriaAlmox,
  itemAtual: ItemAlmox,
  tipo: TipoMovimentacaoAlmox,
  quantidade: number,
  saldo: number,
  observacao: string,
): void {
  estado.historico.push({
    id: randomUUID(),
    criadoEm: new Date().toISOString(),
    categoriaId: categoria.id,
    itemId: itemAtual.id,
    itemNome: itemAtual.nome,
    tipo,
    quantidade,
    unidade: itemAtual.unidade,
    saldo,
    observacao,
  });
  if (estado.historico.length > 1000) estado.historico.splice(0, estado.historico.length - 1000);
}

export async function registrarMovimentacaoAlmox(entrada: {
  itemId: string;
  tipo: "entrada" | "saida";
  quantidade: number;
  observacao?: string;
}): Promise<EstadoAlmoxarifado> {
  if (!entrada.itemId.trim()) throw new Error("Selecione um item.");
  if (entrada.tipo !== "entrada" && entrada.tipo !== "saida") throw new Error("Tipo de movimentação inválido.");
  if (!quantidadeValida(entrada.quantidade) || entrada.quantidade === 0) throw new Error("A quantidade deve ser um inteiro maior que zero.");
  const observacao = String(entrada.observacao ?? "").trim().slice(0, 300);

  return store.update<EstadoAlmoxarifado>(CHAVE_STORE, (atual) => {
    const estado = atual ?? copiarPadrao();
    const { categoria, item: itemAtual } = encontrarItem(estado, entrada.itemId);
    const saldoAtual = Number(itemAtual.saldo);
    if (!Number.isSafeInteger(saldoAtual) || saldoAtual < 0) throw new Error("Informe uma quantidade numérica para este item antes de movimentar.");
    const saldoNovo = entrada.tipo === "entrada" ? saldoAtual + entrada.quantidade : Math.max(0, saldoAtual - entrada.quantidade);
    const quantidadeReal = Math.abs(saldoNovo - saldoAtual);
    if (!quantidadeReal) throw new Error("O estoque já está zerado.");
    itemAtual.saldo = saldoNovo;
    registrarNoHistorico(estado, categoria, itemAtual, entrada.tipo, quantidadeReal, saldoNovo, observacao);
    return estado;
  });
}

export async function atualizarItemAlmox(itemId: string, alteracoes: Partial<Pick<ItemAlmox, "nome" | "saldo" | "minimo" | "passo" | "unidade" | "saldoSecundario">>): Promise<EstadoAlmoxarifado> {
  const nome = alteracoes.nome?.trim();
  if (alteracoes.nome !== undefined && !nome) throw new Error("Informe o nome do item.");
  if (alteracoes.saldo !== undefined && typeof alteracoes.saldo !== "string" && !quantidadeValida(alteracoes.saldo)) {
    throw new Error("O saldo deve ser um inteiro igual ou maior que zero.");
  }
  if (alteracoes.minimo !== undefined && alteracoes.minimo !== "" && !quantidadeValida(alteracoes.minimo)) {
    throw new Error("O mínimo deve ser um inteiro igual ou maior que zero, ou vazio.");
  }
  if (alteracoes.passo !== undefined && (!Number.isSafeInteger(alteracoes.passo) || alteracoes.passo < 1)) {
    throw new Error("O passo deve ser um inteiro maior que zero.");
  }
  if (alteracoes.unidade !== undefined && !alteracoes.unidade.trim()) throw new Error("Informe a unidade do item.");
  if (alteracoes.saldoSecundario !== undefined && !quantidadeValida(alteracoes.saldoSecundario)) {
    throw new Error("A quantidade complementar deve ser um inteiro igual ou maior que zero.");
  }

  return store.update<EstadoAlmoxarifado>(CHAVE_STORE, (atual) => {
    const estado = atual ?? copiarPadrao();
    const { categoria, item: itemAtual } = encontrarItem(estado, itemId);
    if (nome) itemAtual.nome = nome;
    if (alteracoes.minimo !== undefined) itemAtual.minimo = alteracoes.minimo;
    if (alteracoes.passo !== undefined) itemAtual.passo = alteracoes.passo;
    if (alteracoes.unidade !== undefined) itemAtual.unidade = alteracoes.unidade.trim();
    if (alteracoes.saldoSecundario !== undefined) itemAtual.saldoSecundario = alteracoes.saldoSecundario;
    if (alteracoes.saldo !== undefined) {
      const antes = Number(itemAtual.saldo);
      const novo = alteracoes.saldo;
      itemAtual.saldo = typeof novo === "string" ? novo.trim() : novo;
      const depois = Number(itemAtual.saldo);
      if (Number.isSafeInteger(antes) && Number.isSafeInteger(depois) && antes !== depois) {
        registrarNoHistorico(estado, categoria, itemAtual, "ajuste", Math.abs(depois - antes), depois, "Corrigido manualmente");
      }
    }
    return estado;
  });
}

export async function criarItemAlmox(entrada: {
  categoriaId: string;
  nome: string;
  saldo?: number;
  minimo?: number | null;
  unidade?: string;
  passo?: number;
}): Promise<EstadoAlmoxarifado> {
  const nome = entrada.nome.trim();
  if (!nome) throw new Error("Informe o nome do item.");
  if (entrada.saldo !== undefined && !quantidadeValida(entrada.saldo)) throw new Error("O saldo deve ser um inteiro igual ou maior que zero.");
  if (entrada.minimo !== undefined && entrada.minimo !== null && !quantidadeValida(entrada.minimo)) throw new Error("O mínimo deve ser um inteiro igual ou maior que zero.");
  if (entrada.passo !== undefined && (!Number.isSafeInteger(entrada.passo) || entrada.passo < 1)) throw new Error("O passo deve ser um inteiro maior que zero.");

  return store.update<EstadoAlmoxarifado>(CHAVE_STORE, (atual) => {
    const estado = atual ?? copiarPadrao();
    const categoria = estado.categorias.find((candidato) => candidato.id === entrada.categoriaId);
    if (!categoria) throw new Error("Categoria do almoxarifado não encontrada.");
    if (categoria.itens.some((candidato) => candidato.nome.toLocaleLowerCase("pt-BR") === nome.toLocaleLowerCase("pt-BR"))) {
      throw new Error("Já existe um item com esse nome nesta categoria.");
    }
    categoria.itens.push({
      id: randomUUID(),
      nome,
      saldo: entrada.saldo ?? 0,
      minimo: entrada.minimo ?? "",
      passo: entrada.passo ?? 1,
      unidade: entrada.unidade?.trim() || "unidades",
    });
    return estado;
  });
}

export async function removerItemAlmox(itemId: string): Promise<EstadoAlmoxarifado> {
  return store.update<EstadoAlmoxarifado>(CHAVE_STORE, (atual) => {
    const estado = atual ?? copiarPadrao();
    const categoria = estado.categorias.find((candidato) => candidato.itens.some((itemAtual) => itemAtual.id === itemId));
    if (!categoria) throw new Error("Item do almoxarifado não encontrado.");
    categoria.itens = categoria.itens.filter((itemAtual) => itemAtual.id !== itemId);
    return estado;
  });
}

export async function restaurarAlmoxarifado(): Promise<EstadoAlmoxarifado> {
  const estado = copiarPadrao();
  await store.set(CHAVE_STORE, estado);
  return estado;
}
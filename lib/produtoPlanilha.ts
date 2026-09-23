import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Nome do produto no formato curto que a planilha de devoluções usa (coluna
 * PRODUTO). Duas fontes, nessa ordem:
 *
 * 1. `data/produtos.json` — mapa código Tiny → nome exato da planilha,
 *    editável à mão (fica em branco de propósito: quem conhece a planilha de
 *    verdade completa depois, sem precisar entender o código).
 * 2. Se o código não estiver no mapa, monta um nome a partir da descrição do
 *    Tiny seguindo o padrão TIPO + LINHA + COR + VOLTAGEM (ex.: "CHALEIRA
 *    MODERN PRETA 127V") — best-effort, só um fallback enquanto o mapa não
 *    está completo.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MAPA_PATH = path.resolve(__dirname, "./data/produtos.json");

function carregarMapa(): Record<string, string> {
  try {
    const raw = fs.readFileSync(MAPA_PATH, "utf8");
    return JSON.parse(raw) as Record<string, string>;
  } catch (error) {
    console.error(`[produtoPlanilha] não consegui ler ${MAPA_PATH}, seguindo sem mapa fixo:`, error);
    return {};
  }
}

const mapaProdutos = carregarMapa();

function normalizarBusca(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

// Ordem segue a lista pedida — sem conflito de substring entre elas, então a
// ordem não muda o resultado, só facilita comparar com a especificação.
const TIPOS: { padrao: RegExp; label: string }[] = [
  { padrao: /chaleira/, label: "CHALEIRA" },
  { padrao: /sanduicheira/, label: "SANDUICHEIRA" },
  { padrao: /air\s*fryer/, label: "AIRFRYER" },
  { padrao: /grill/, label: "GRILL ELETRICO" },
  { padrao: /mini\s*processador/, label: "MINI PROCESSADOR" },
  { padrao: /cafeteira/, label: "CAFETEIRA" },
  { padrao: /mixer/, label: "MIXER DE MÃO" },
  { padrao: /abajur/, label: "ABAJUR" },
  { padrao: /aquecedor/, label: "AQUECEDOR ELETRICO" },
  { padrao: /portao/, label: "PORTÃO" },
  { padrao: /tapete/, label: "TAPETE" },
  { padrao: /tenda/, label: "TENDA" },
];

// INOX por último de propósito: só conta como LINHA se nenhuma das outras aparecer.
const LINHAS: { padrao: RegExp; label: string }[] = [
  { padrao: /basic/, label: "BASIC" },
  { padrao: /modern/, label: "MODERN" },
  { padrao: /elegance/, label: "ELEGANCE" },
  { padrao: /acqua/, label: "ACQUA" },
  { padrao: /family/, label: "FAMILY" },
  { padrao: /inox/, label: "INOX" },
];

const CORES: { padrao: RegExp; label: string }[] = [
  { padrao: /preta/, label: "PRETA" },
  { padrao: /prateada/, label: "PRATEADA" },
  { padrao: /prata/, label: "PRATA" },
  { padrao: /azul/, label: "AZUL" },
  { padrao: /vermelha/, label: "VERMELHA" },
  { padrao: /rosa/, label: "ROSA" },
  { padrao: /verde/, label: "VERDE" },
  { padrao: /branco/, label: "BRANCO" },
  { padrao: /vidro/, label: "VIDRO" },
];

/**
 * 110 e 127 caem no mesmo rótulo, seguindo literalmente a regra pedida — mesmo
 * o exemplo "BASE CHALEIRA PRETA 110V" da especificação (provavelmente um
 * nome legado da planilha, de antes dessa regra existir) fica "127V" aqui.
 * Se isso gerar nome diferente do esperado pra algum produto específico, o
 * conserto certo é completar `data/produtos.json` pra esse código — o mapa
 * sempre tem prioridade sobre esta heurística.
 */
function detectarVoltagem(descNormalizada: string): string | null {
  // Sem \b no final: "220v"/"127v" é uma palavra só (dígito e letra são ambos \w,
  // não há fronteira entre eles) — só a fronteira ANTES do número importa aqui.
  if (/\b220/.test(descNormalizada)) return "220V";
  if (/\b(110|127)/.test(descNormalizada)) return "127V";
  return null;
}

/** Só usado pra AIRFRYER — ex.: "Airfryer 6,5L 220V" → "6,5L". */
function detectarLitragem(descOriginal: string): string | null {
  const match = descOriginal.match(/(\d+(?:[.,]\d+)?)\s*l\b/i);
  return match ? `${match[1].replace(".", ",")}L` : null;
}

function nomeAutomatico(descricao: string): string {
  const normalizada = normalizarBusca(descricao);
  const comecaComBase = /^base\b/.test(normalizada);
  const tipo = TIPOS.find((t) => t.padrao.test(normalizada));

  if (!tipo && !comecaComBase) {
    return descricao.toUpperCase();
  }

  const partes: string[] = [];
  if (comecaComBase) partes.push("BASE");
  if (tipo) partes.push(tipo.label);
  if (tipo?.label === "AIRFRYER") {
    const litragem = detectarLitragem(descricao);
    if (litragem) partes.push(litragem);
  }

  const linha = LINHAS.find((l) => l.padrao.test(normalizada));
  if (linha) partes.push(linha.label);

  const cor = CORES.find((c) => c.padrao.test(normalizada));
  if (cor) partes.push(cor.label);

  const voltagem = detectarVoltagem(normalizada);
  if (voltagem) partes.push(voltagem);

  return partes.join(" ");
}

export function nomeProdutoPlanilha(codigo: string, descricao: string): string {
  const mapeado = codigo ? mapaProdutos[codigo] : undefined;
  return mapeado ?? nomeAutomatico(descricao);
}

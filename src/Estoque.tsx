import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { PageHeader } from "@/PageHeader";
import { calcularQuantidadeContada } from "../lib/contagemEstoque";
import { chaveComparacaoProduto, nomeProdutoComVoltagemUnica } from "../lib/nomeProduto";

interface RegistroContagem {
  id: string;
  quantidade: number;
  responsavel: string;
  /** URL pública do Cloudinary — nunca um caminho/arquivo local (ver lib/estoque.ts). */
  fotoUrl: string;
  criadoEm: string;
  tipo?: "contagem" | "entrada" | "saida" | "transferencia" | "ajuste";
  motivo?: string;
  quantidadeAnterior?: number;
  quantidadeMovimentada?: number;
  movimentacaoId?: string;
  origem?: { rua: string; codigo: string };
  destino?: { rua: string; codigo: string };
}

const VOLTAGENS = ["110V", "220V", "Bivolt"] as const;
type Voltagem = (typeof VOLTAGENS)[number];

interface PosicaoResumo {
  rua: string;
  codigo: string;
  ultima: RegistroContagem;
  /** null só pra posição criada antes dessa funcionalidade existir. */
  produto: string | null;
  voltagem: Voltagem | null;
}

function rotuloEventoEstoque(tipo: RegistroContagem["tipo"]): string {
  switch (tipo) {
    case "entrada":
      return "Entrada";
    case "saida":
      return "Saída";
    case "transferencia":
      return "Transferência";
    case "ajuste":
      return "Ajuste";
    default:
      return "Contagem";
  }
}

/** Item da busca no cadastro do Tiny (ver lib/catalogoTiny.ts). */
interface ProdutoTiny {
  sugestao: string;
  nomesTiny: string[];
  codigos: string[];
  idsTiny: string[];
}

interface SugestaoProdutoGrupo {
  categoria: string;
  itens: { nome: string; estoque: number }[];
}

const SUGESTOES_BASE: SugestaoProdutoGrupo[] = [
  {
    categoria: "Chaleiras",
    itens: [
      { nome: "Chaleira Elétrica Koti 1,5L Modern Inox Preta - 110v ou 220v - 110V - Preta", estoque: 3743 },
      { nome: "Chaleira Elétrica Koti 1,5L Modern Inox Preta - 110v ou 220v - 220V - Preta", estoque: 6142 },
      { nome: "Chaleira Elétrica Koti 1,8L Acqua Jarra de Vidro - 110v ou 220v - 110V", estoque: 1502 },
      { nome: "Chaleira Elétrica Koti 1,8L Acqua Jarra de Vidro - 110v ou 220v - 220V", estoque: 1738 },
      { nome: "Chaleira Elétrica Koti 1,8L Basic Inox Prateada - 110v ou 220v - 110V", estoque: 177 },
      { nome: "Chaleira Elétrica Koti 1,8L Basic Inox Prateada - 110v ou 220v - 220V", estoque: 2116 },
      { nome: "Chaleira Elétrica Koti 1,8L Elegance - 110v ou 220v - Azul acinzentado - 110V", estoque: 407 },
      { nome: "Chaleira Elétrica Koti 1,8L Elegance - 110v ou 220v - Azul acinzentado - 220V", estoque: 905 },
      { nome: "Chaleira Elétrica Koti 1,8L Elegance - 110v ou 220v - Vermelho - 110V", estoque: 1185 },
      { nome: "Chaleira Elétrica Koti 1,8L Elegance - 110v ou 220v - Vermelho - 220V", estoque: 2035 },
    ],
  },
  {
    categoria: "Fritadeiras elétricas",
    itens: [
      { nome: "Fritadeira Elétrica Koti 2,6L Petit 1000w - 110v ou 220v - 110V", estoque: 1923 },
      { nome: "Fritadeira Elétrica Koti 2,6L Petit 1000w - 110v ou 220v - 220V", estoque: 1374 },
      { nome: "Fritadeira Elétrica Koti 4L Smart 1200w - 110v ou 220v - 220V", estoque: 2 },
      { nome: "Fritadeira elétrica Koti 4,5L Elegance 1350W - 110V ou 220v - 110v", estoque: 364 },
      { nome: "Fritadeira elétrica Koti 4,5L Elegance 1350W - 110V ou 220v - 220v", estoque: 337 },
      { nome: "Fritadeira Elétrica Koti 5,5L Family 1500w - 110v ou 220v - 110", estoque: 283 },
      { nome: "Fritadeira Elétrica Koti 5,5L Family 1500w - 110v ou 220v - 220", estoque: 2 },
      { nome: "Fritadeira Elétrica Koti 6,5L Titanium 1500w - 110v ou 220v - 110v", estoque: 456 },
      { nome: "Fritadeira Elétrica Koti 6,5L Titanium 1500w - 110v ou 220v - 220v", estoque: 555 },
    ],
  },
  {
    categoria: "Outros eletrodomésticos",
    itens: [
      { nome: "Aquecedor Elétrico Thermo Confort Koti - 110v ou 220v - 110v", estoque: 6 },
      { nome: "Aquecedor Elétrico Thermo Confort Koti - 110v ou 220v - 220V", estoque: 216 },
      { nome: "Cafeteira Elétrica Koti Family 1,5L 800w - 110v ou 220v - 110v", estoque: 12 },
      { nome: "Cafeteira Elétrica Koti Family 1,5L 800w - 110v ou 220v - 220v", estoque: 1 },
      { nome: "Cafeteira Elétrica Koti Petit Cp15 650ml Vidro Preto - 110v ou 220v - 127V", estoque: 1 },
      { nome: "Forno Elétrico Koti 10l Petit 750W 110v ou 220v - 110v", estoque: 3 },
      { nome: "Grill Elétrico Multiuso Koti Elegance Toast 110V ou 220V - 110v", estoque: 1160 },
      { nome: "Grill Elétrico Multiuso Koti Elegance Toast 110V ou 220V - 220v", estoque: 370 },
      { nome: "Mini Processador Basic 200w Koti - 110v ou 220v - 127V", estoque: 333 },
      { nome: "Mini Processador Basic 200w Koti - 110v ou 220v - 220V", estoque: 885 },
      { nome: "Mixer de Mão Elétrico Koti Modern 200w - 110v ou 220v - 127V", estoque: 2 },
      { nome: "Mixer de Mão Elétrico Koti Modern 200w - 110v ou 220v - 220V", estoque: 612 },
      { nome: "Sanduicheira Grill Quality Koti Preta 750w - 110v ou 220v - 110V", estoque: 4321 },
      { nome: "Sanduicheira Grill Quality Koti Preta 750w - 110v ou 220v - 220V", estoque: 3046 },
    ],
  },
  {
    categoria: "Portões retráteis",
    itens: [
      { nome: "Portão Tela Segurança Bebês Pets Cercadinho Grade Retrátil - 1.5m - Branco", estoque: 465 },
      { nome: "Portão Tela Segurança Bebês Pets Cercadinho Grade Retrátil - 1.8m - Branco", estoque: 42 },
      { nome: "Portão Tela Segurança Bebês Pets Cercadinho Grade Retrátil - 3.0m - Branco", estoque: 264 },
      { nome: "Portão Tela Segurança Bebês Pets Cercadinho Grade Retrátil - 1.5m - Preto", estoque: 463 },
      { nome: "Portão Tela Segurança Bebês Pets Cercadinho Grade Retrátil - 1.8m - Preto", estoque: 243 },
      { nome: "Portão Tela Segurança Bebês Pets Cercadinho Grade Retrátil - 3.0m - Preto", estoque: 224 },
      { nome: "Portão Tela Segurança Bebês Pets Cercadinho Grade Retrátil - 1.5m - Rosa", estoque: 358 },
    ],
  },
  {
    categoria: "Tendas infantis e de praia",
    itens: [
      { nome: "Tenda Barraca de Proteção Solar Praia Acampamento UV Portatil - Azul", estoque: 5 },
      { nome: "Tenda Barraca Infantil Dobravel Praia Uv Piscina Bichos - Baleia", estoque: 1 },
      { nome: "Tenda Barraca Toca Infantil Portátil Dobrável Menina Menino - Ovelha", estoque: 87 },
      { nome: "Tenda Barraca Toca Infantil Portátil Dobrável Menina Menino - Patinho", estoque: 162 },
      { nome: "Tenda Barraca Toca Infantil Portátil Dobrável Menina Menino - Porquinho", estoque: 200 },
      { nome: "Tenda Barraca Toca Infantil Portátil Dobrável Menina Menino - Tigre", estoque: 48 },
      { nome: "Tenda Barraca Infantil Dobravel Praia Uv Piscina Bichos - Tubarão", estoque: 8 },
      { nome: "Tenda Barraca Toca Infantil Portátil Dobrável Menina Menino - Ursa", estoque: 48 },
      { nome: "Tenda Barraca Toca Infantil Portátil Dobrável Menina Menino - Ursinho", estoque: 136 },
      { nome: "Tenda Barraca de Proteção Solar Praia Acampamento UV Portatil - Rosa-chiclete", estoque: 5 },
      { nome: "Tenda Barraca de Proteção Solar Praia Acampamento UV Portatil - Vermelho", estoque: 67 },
      { nome: "Tenda Dobrável Praia Piscina Campo Proteção Uv Criança Bebê - Rosa e Branco", estoque: 583 },
      { nome: "Tenda Dobrável Praia Piscina Campo Proteção Uv Criança Bebê - Verde e Branco", estoque: 617 },
    ],
  },
  {
    categoria: "Placas adesivas de mármore",
    itens: [
      { nome: "Kit 10 Placas Adesivas Mármore 3D Autocolante Lavável 60x30cm Parede - 10 unidades - 001", estoque: 252 },
      { nome: "Kit 10 Placas Adesivas Mármore 3D Autocolante Lavável 60x30cm Parede - 10 unidades - 002", estoque: 2007 },
      { nome: "Kit 10 Placas Adesivas Mármore 3D Autocolante Lavável 60x30cm Parede - 10 unidades - 007", estoque: 92 },
      { nome: "Kit 10 Placas Adesivas Mármore 3D Autocolante Lavável 60x30cm Parede - 10 unidades - 009", estoque: 784 },
      { nome: "Kit 10 Placas Adesivas Mármore 3D Autocolante Lavável 60x30cm Parede - 10 unidades - 013", estoque: 44 },
      { nome: "Kit 10 Placas Adesivas Mármore 3D Autocolante Lavável 60x30cm Parede - 10 unidades - 014", estoque: 782 },
      { nome: "Kit 10 Placas Adesivas Mármore 3D Autocolante Lavável 60x30cm Parede - 10 unidades - 016", estoque: 18 },
      { nome: "Kit 10 Placas Adesivas Mármore 3D Autocolante Lavável 60x30cm Parede - 10 unidades - 019", estoque: 914 },
      { nome: "Kit 10 Placas Adesivas Mármore 3D Autocolante Lavável 60x30cm Parede - 10 unidades - 017", estoque: 517 },
      { nome: "Kit 10 Placas Adesivas Mármore 3D Autocolante Lavável 60x30cm Parede - 10 unidades - 022", estoque: 736 },
      { nome: "Kit 10 Placas Adesivas Mármore 3D Autocolante Lavável 60x30cm Parede - 10 unidades - 027", estoque: 515 },
      { nome: "Kit 10 Placas Adesivas Mármore 3D Autocolante Lavável 60x30cm Parede - 10 unidades - 026", estoque: 791 },
      { nome: "Kit 10 Placas Adesivas Mármore 3D Autocolante Lavável 60x30cm Parede - 10 unidades - 029", estoque: 81 },
      { nome: "Kit 10 Placas Adesivas Mármore 3D Autocolante Lavável 60x30cm Parede - 10 unidades - 030", estoque: 97 },
      { nome: "Kit 10 Placas Adesivas Mármore 3D Autocolante Lavável 60x30cm Parede - 10 unidades - 040", estoque: 795 },
      { nome: "Kit 10 Placas Adesivas Mármore 3D Autocolante Lavável 60x30cm Parede - 10 unidades - 041", estoque: 514 },
      { nome: "Kit 10 Placas Adesivas Mármore 3D Autocolante Lavável 60x30cm Parede - 10 unidades - 046", estoque: 613 },
    ],
  },
  {
    categoria: "Tatames infantis",
    itens: [
      { nome: "Tapete Tatame Eva Bebê Infantil 60x60 Personalizável Unidade - Azul royal", estoque: 237 },
      { nome: "Tapete Tatame Eva Bebê Infantil 60x60 Personalizável Unidade - Azul claro", estoque: 164 },
      { nome: "Tapete Tatame Eva Bebê Infantil 60x60 Personalizável Unidade - Verde água", estoque: 25 },
      { nome: "Tapete Tatame Eva Bebê Infantil 60x60 Personalizável Unidade - Amarelo", estoque: 308 },
      { nome: "Tapete Tatame Eva Bebê Infantil 60x60 Personalizável Unidade - Roxo", estoque: 322 },
    ],
  },
];

const SUGESTOES_PRODUTOS = SUGESTOES_BASE.map((grupo) => ({
  ...grupo,
  itens: grupo.itens.map((item) => ({
    ...item,
    nome: nomeProdutoComVoltagemUnica(item.nome)?.nome ?? item.nome,
  })),
}));

interface RuaResumo {
  rua: string;
  posicoes: PosicaoResumo[];
}

type Modal =
  | { modo: "existente"; rua: string; codigo: string; ultima: RegistroContagem; produto: string | null; voltagem: Voltagem | null }
  // Gaveta nova: a rua é escolhida no próprio formulário (a tela é por produto, não por rua).
  | { modo: "nova"; ruasExistentes: string[]; codigosPorRua: Record<string, string[]>; produtoInicial?: string; ruaInicial?: string }
  | null;

const API_URL = import.meta.env.VITE_API_URL ?? "";
const POLL_MS = 30_000;
const RESPONSAVEL_STORAGE_KEY = "estoque:ultimoResponsavel";
const RUAS_DISPONIVEIS = ["A", "B", "C", "D", "E", "F", "G", "H"] as const;
const LADO_MAXIMO_FOTO = 1600; // px — reduz fotos de celular (3-8MB) pra algo leve de enviar/guardar.
const TOAST_MS = 3_000;

function formatarDataHora(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/** Ícone de prateleira/galpão (estante com caixas) — usado quando a posição ainda não tem foto, no lugar de um texto seco. */
function IconeGondola({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M8 6v36M40 6v36" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M8 16h32M8 32h32" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <rect x="12" y="19" width="9" height="9" rx="1.5" fill="currentColor" opacity="0.55" />
      <rect x="23" y="19" width="9" height="9" rx="1.5" fill="currentColor" opacity="0.35" />
      <rect x="12" y="35" width="9" height="7" rx="1.5" fill="currentColor" opacity="0.35" />
      <rect x="23" y="35" width="9" height="7" rx="1.5" fill="currentColor" opacity="0.55" />
    </svg>
  );
}

function lerUltimoResponsavel(): string {
  try {
    return localStorage.getItem(RESPONSAVEL_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

function salvarUltimoResponsavel(nome: string): void {
  try {
    localStorage.setItem(RESPONSAVEL_STORAGE_KEY, nome);
  } catch {
    // localStorage bloqueado — só perde a conveniência de lembrar o nome, nada mais.
  }
}

/** Reduz a foto (celular tira em 3-8MB) pra um JPEG leve antes de mandar — cabe fácil no limite de 10mb do backend e sobe rápido em rede de galpão. */
async function comprimirFoto(arquivo: File): Promise<string> {
  const bitmap = await createImageBitmap(arquivo);
  const escala = Math.min(1, LADO_MAXIMO_FOTO / Math.max(bitmap.width, bitmap.height));
  const largura = Math.round(bitmap.width * escala);
  const altura = Math.round(bitmap.height * escala);

  const canvas = document.createElement("canvas");
  canvas.width = largura;
  canvas.height = altura;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Não consegui processar essa imagem neste navegador.");
  ctx.drawImage(bitmap, 0, 0, largura, altura);

  return canvas.toDataURL("image/jpeg", 0.82);
}

const PADRAO_NUMERO_GAVETA = /^\d+$/;

function validarNumeroGaveta(numero: string): string | null {
  const limpo = numero.trim();
  if (!limpo) return "Informe o número da gaveta.";
  if (!PADRAO_NUMERO_GAVETA.test(limpo)) return "Use apenas o número da gaveta (ex.: 3).";
  return null;
}

function validarQuantidade(quantidade: string): string | null {
  if (!quantidade.trim()) return "Informe a quantidade contada.";
  const numero = Number(quantidade);
  if (!Number.isSafeInteger(numero) || numero < 0) return "Quantidade precisa ser um número inteiro maior ou igual a zero.";
  return null;
}

function validarResponsavel(responsavel: string): string | null {
  return responsavel.trim() ? null : "Informe quem fez a contagem.";
}

function validarFoto(fotoPreview: string | null): string | null {
  return fotoPreview ? null : "Tire ou escolha uma foto — toda contagem precisa de uma foto própria.";
}

function validarProduto(produto: string): string | null {
  return produto.trim() ? null : "Selecione o produto dessa gaveta.";
}

function validarVoltagem(voltagem: string): string | null {
  return (VOLTAGENS as readonly string[]).includes(voltagem) ? null : "Selecione a voltagem dessa gaveta.";
}

function isUnidadesPorCaixa(value: unknown): value is Record<string, number> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.entries(value).every(([, unidades]) => typeof unidades === "number" && Number.isSafeInteger(unidades) && unidades >= 1)
  );
}

function useDialogAccessibility(onClose: () => void) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const activeBeforeRef = useRef<HTMLElement | null>(
    typeof document !== "undefined" && document.activeElement instanceof HTMLElement ? document.activeElement : null,
  );

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const activeBefore = activeBeforeRef.current;
    const panel = panelRef.current;
    if (!panel) return;
    const focusableSelector = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = [...panel.querySelectorAll<HTMLElement>(focusableSelector)].filter(
        (element) => !element.hidden && getComputedStyle(element).display !== "none" && getComputedStyle(element).visibility !== "hidden",
      );
      if (focusable.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !panel.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    (panel.querySelector<HTMLElement>("[autofocus]") ?? panel.querySelector<HTMLElement>(focusableSelector) ?? panel).focus();
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (activeBefore?.isConnected) activeBefore.focus();
    };
  }, []);

  return panelRef;
}

function mensagemErro(error: unknown, fallback: string): string {
  if (error instanceof TypeError && /failed to fetch|networkerror|load failed/i.test(error.message)) {
    return "Falha de comunicação com o servidor. Verifique sua conexão. Os dados digitados foram mantidos; atualize o estoque antes de repetir uma operação para evitar duplicidade.";
  }
  return error instanceof Error ? error.message : fallback;
}

/**
 * Voltagem dita no próprio nome do produto ("... Azul 110V", "... Bivolt") — cada cor+voltagem é um
 * produto (SKU) próprio, então a voltagem vem do nome. 127V conta como 110V (a lista de voltagens do
 * estoque só tem 110V/220V/Bivolt). Usa a ÚLTIMA menção, mesmo critério de lib/produtoPlanilha.ts
 * ("... 110v ou 220v - 220V" → 220V). null quando o nome não diz.
 */
function voltagemDoNome(nome: string): Voltagem | null {
  if (/\bbivolt\b/i.test(nome)) return "Bivolt";
  const ocorrencias = [...nome.matchAll(/\b(110|127|220)\s*v?\b/gi)];
  if (ocorrencias.length === 0) return null;
  return ocorrencias[ocorrencias.length - 1][1] === "220" ? "220V" : "110V";
}

/** Valor da opção "Posição vazia" no select de produto — não é um produto do catálogo, nunca vai pro backend. */
const PRODUTO_VAZIA = "__vazia__";

/** [H2, H3, H7] → "8". Sem nenhuma posição ainda na rua, sugere "1". */
function proximoNumeroGavetaSugerido(rua: string, codigosExistentes: string[]): string {
  const numeros = codigosExistentes
    .map((codigo) => codigo.match(/^([A-Z]+)(\d+)$/))
    .filter((m): m is RegExpMatchArray => m !== null && m[1] === rua)
    .map((m) => Number(m[2]));
  const proximo = numeros.length > 0 ? Math.max(...numeros) + 1 : 1;
  return String(proximo);
}

function ContagemPorCaixa({
  unidadesPorCaixa,
  quantidadeInicial,
  onQuantidadeChange,
  inputRef,
  erro,
  onBlur,
}: {
  unidadesPorCaixa: number;
  quantidadeInicial: string;
  onQuantidadeChange: (quantidade: string) => void;
  inputRef: (input: HTMLInputElement | null) => void;
  erro: string | null;
  onBlur: () => void;
}) {
  const numeroInicial = Number(quantidadeInicial);
  const inicialValido = quantidadeInicial.trim() !== "" && Number.isSafeInteger(numeroInicial) && numeroInicial >= 0;
  const [caixas, setCaixas] = useState(inicialValido ? String(Math.floor(numeroInicial / unidadesPorCaixa)) : "");
  const [avulsas, setAvulsas] = useState(inicialValido ? String(numeroInicial % unidadesPorCaixa) : "");

  const atualizar = (novasCaixas: string, novasAvulsas: string) => {
    setCaixas(novasCaixas);
    setAvulsas(novasAvulsas);
    if (
      !novasCaixas.trim() ||
      !novasAvulsas.trim() ||
      ![novasCaixas, novasAvulsas].every((valor) => Number.isSafeInteger(Number(valor)) && Number(valor) >= 0)
    ) {
      onQuantidadeChange("");
      return;
    }
    const total = calcularQuantidadeContada(Number(novasCaixas), Number(novasAvulsas), unidadesPorCaixa);
    onQuantidadeChange(total === null ? "" : String(total));
  };

  return (
    <div className="field">
      <span className="field-label">
        Contagem por caixa <span className="field-obrigatorio">*</span>
      </span>
      <div className="estoque-contagem-caixas">
        <label className="field">
          <span className="field-label">Caixas ({unidadesPorCaixa} un. cada)</span>
          <input
            ref={inputRef}
            className={`field-input${erro ? " field-input--erro" : ""}`}
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
            value={caixas}
            onChange={(event) => atualizar(event.target.value, avulsas)}
            onBlur={onBlur}
            placeholder="Ex.: 2"
          />
        </label>
        <label className="field">
          <span className="field-label">Unidades avulsas</span>
          <input
            className={`field-input${erro ? " field-input--erro" : ""}`}
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
            value={avulsas}
            onChange={(event) => atualizar(caixas, event.target.value)}
            onBlur={onBlur}
            placeholder="Ex.: 3"
          />
        </label>
      </div>
      <span className="estoque-quantidade-calculada tabular">
        Total contado: <strong>{quantidadeInicial === "" ? "—" : `${quantidadeInicial} un.`}</strong>
      </span>
      {erro && <span className="field-erro">{erro}</span>}
    </div>
  );
}

function FormularioContagem({
  modal,
  produtos,
  unidadesPorCaixa,
  responsaveis,
  mensagemResponsaveis,
  onFechar,
  onSalvo,
  onMetadadosSalvos,
  onExcluida,
  onAbrirMovimentacao,
}: {
  modal: Exclude<Modal, null>;
  produtos: string[];
  unidadesPorCaixa: Record<string, number>;
  responsaveis: string[];
  mensagemResponsaveis: string | null;
  onFechar: () => void;
  onSalvo: (rua: string, codigo: string) => void;
  onMetadadosSalvos: (rua: string, codigo: string, produto: string, voltagem: Voltagem) => void;
  onExcluida: (rua: string, codigo: string) => void;
  onAbrirMovimentacao: (posicao: PosicaoResumo) => void;
}) {
  // Rua: fixa numa gaveta existente; numa nova, escolhida aqui (uma das existentes ou uma letra nova).
  const [ruaNova, setRuaNova] = useState(() =>
    modal.modo === "nova" ? (modal.ruaInicial ?? (modal.ruasExistentes.length === 1 ? modal.ruasExistentes[0] : "")) : "",
  );
  const ruaAtual = modal.modo === "existente" ? modal.rua : ruaNova.trim().toUpperCase();
  const codigosExistentes = modal.modo === "nova" ? modal.codigosPorRua[ruaAtual] ?? [] : [];
  const [numeroGaveta, setNumeroGaveta] = useState(() => (modal.modo === "nova" && ruaAtual ? proximoNumeroGavetaSugerido(ruaAtual, codigosExistentes) : ""));
  const [quantidade, setQuantidade] = useState(() =>
    modal.modo === "existente" ? String(modal.ultima.quantidade) : modal.produtoInicial ? "" : "0",
  );
  const [motivoContagem, setMotivoContagem] = useState("");
  const [responsavel, setResponsavel] = useState(() => (modal.modo === "existente" ? modal.ultima.responsavel : lerUltimoResponsavel()));
  // Posição nova, ou existente que foi registrada vazia (sem produto): escolhe o produto aqui — ou
  // "Posição vazia", que registra 0 un. sem produto nem voltagem.
  const definirProduto = modal.modo === "nova" || !modal.produto;
  const [produto, setProduto] = useState(() =>
    modal.modo === "existente" ? (modal.produto ? "" : PRODUTO_VAZIA) : (modal.produtoInicial ?? PRODUTO_VAZIA),
  );
  const [voltagemEscolhida, setVoltagemEscolhida] = useState("");
  const [fotoPreview, setFotoPreview] = useState<string | null>(null);
  const [arrastandoFoto, setArrastandoFoto] = useState(false);
  const [mostrarHistorico, setMostrarHistorico] = useState(false);
  const [historico, setHistorico] = useState<RegistroContagem[] | null>(null);
  const [erroHistorico, setErroHistorico] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [tocados, setTocados] = useState<Set<string>>(new Set());
  const [tentouSalvar, setTentouSalvar] = useState(false);
  const [alterado, setAlterado] = useState(false);

  // Edição de produto/voltagem de uma posição já existente — fica fechado por padrão (os dois
  // normalmente não mudam numa recontagem), só abre se a pessoa pedir pra corrigir.
  const [editandoMetadados, setEditandoMetadados] = useState(false);
  const [produtoEdit, setProdutoEdit] = useState(modal.modo === "existente" ? modal.produto ?? "" : "");
  const [voltagemEdit, setVoltagemEdit] = useState(modal.modo === "existente" ? modal.voltagem ?? "" : "");
  const [salvandoMetadados, setSalvandoMetadados] = useState(false);
  const [erroMetadados, setErroMetadados] = useState<string | null>(null);
  const solicitarFechamento = useCallback(() => {
    if (alterado && !window.confirm("Descartar as alterações desta contagem?")) return;
    onFechar();
  }, [alterado, onFechar]);
  const painelRef = useDialogAccessibility(solicitarFechamento);

  const inputFotoRef = useRef<HTMLInputElement>(null);
  const codigoRef = useRef<HTMLInputElement>(null);
  const produtoRef = useRef<HTMLSelectElement>(null);
  const voltagemRef = useRef<HTMLSelectElement>(null);
  const quantidadeRef = useRef<HTMLInputElement>(null);
  const setQuantidadeInputRef = useCallback((input: HTMLInputElement | null) => {
    quantidadeRef.current = input;
  }, []);
  const responsavelRef = useRef<HTMLSelectElement>(null);
  const motivoContagemRef = useRef<HTMLTextAreaElement>(null);
  const fotoBotaoRef = useRef<HTMLButtonElement>(null);

  const tocar = useCallback((campo: string) => {
    setTocados((atual) => {
      if (atual.has(campo)) return atual;
      const copia = new Set(atual);
      copia.add(campo);
      return copia;
    });
  }, []);

  /** Só mostra o erro depois que a pessoa passou por esse campo (ou tentou salvar) — formulário
   * em branco não começa gritando "obrigatório" em tudo de uma vez. */
  const mostrar = useCallback((campo: string, erroCampo: string | null) => (tentouSalvar || tocados.has(campo) ? erroCampo : null), [tentouSalvar, tocados]);

  const erroRua =
    modal.modo === "nova"
      ? !ruaAtual
        ? "Selecione a rua."
        : !RUAS_DISPONIVEIS.some((rua) => rua === ruaAtual)
          ? "Selecione uma rua entre A e H."
          : null
      : null;
  const erroCodigoFormato = modal.modo === "nova" ? validarNumeroGaveta(numeroGaveta) : null;
  const erroCodigoDuplicado =
    modal.modo === "nova" && !erroCodigoFormato && codigosExistentes.includes(`${ruaAtual}${numeroGaveta.trim()}`) ? "Essa gaveta já existe nessa rua." : null;
  const erroCodigo = erroRua ?? erroCodigoFormato ?? erroCodigoDuplicado;
  const vazia = definirProduto && produto === PRODUTO_VAZIA;
  // Cada cor+voltagem é um produto próprio (nome igual ao do Tiny, ex.: "... Azul 110V"): quando o nome
  // do produto já diz a voltagem, ela vem dele e não é perguntada de novo.
  const voltagemDoProduto = vazia ? null : voltagemDoNome(produto);
  const voltagem = voltagemDoProduto ?? voltagemEscolhida;
  const produtoContado = definirProduto ? (vazia ? "" : produto) : (modal.produto ?? "");
  const quantidadePorCaixa = unidadesPorCaixa[chaveDoProduto(produtoContado)];
  const erroProduto = definirProduto ? validarProduto(produto) : null;
  const erroVoltagem = definirProduto && !vazia ? validarVoltagem(voltagem) : null;
  const erroQuantidade = quantidadePorCaixa
    ? !quantidade.trim()
      ? "Informe a quantidade de caixas e as unidades avulsas."
      : !Number.isSafeInteger(Number(quantidade)) || Number(quantidade) < 0
        ? "A quantidade total ultrapassa o limite permitido."
        : null
    : validarQuantidade(quantidade) ??
      (vazia && Number(quantidade) > 0 ? "Gaveta vazia fica com 0 un. — pra contar unidades, escolha o produto." : null);
  const precisaMotivoContagem = modal.modo === "existente" && Number(quantidade) !== modal.ultima.quantidade;
  const erroMotivoContagem = precisaMotivoContagem && !motivoContagem.trim() ? "Informe o motivo da diferença." : null;
  const responsavelSelecionado = responsaveis.includes(responsavel) ? responsavel : responsaveis[0] ?? "";
  const erroResponsavel = responsaveis.length === 0 ? (mensagemResponsaveis ?? "Nenhuma pessoa disponível para selecionar.") : validarResponsavel(responsavelSelecionado);
  const erroFoto = validarFoto(fotoPreview);
  const formularioInvalido = Boolean(erroCodigo || erroProduto || erroVoltagem || erroQuantidade || erroMotivoContagem || erroResponsavel || erroFoto);

  const ajustarQuantidade = useCallback((delta: number) => {
    setQuantidade((atual) => String(Math.max(0, (Number(atual) || 0) + delta)));
  }, []);

  const carregarArquivoFoto = useCallback(async (arquivo: File) => {
    if (!arquivo.type.startsWith("image/")) {
      setErro("Escolha um arquivo de imagem.");
      return;
    }
    setErro(null);
    try {
      setFotoPreview(await comprimirFoto(arquivo));
      setAlterado(true);
    } catch {
      setErro("Não consegui processar essa foto — tenta tirar de novo.");
    }
  }, []);

  const aoEscolherFoto = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const arquivo = event.target.files?.[0];
      event.target.value = "";
      if (arquivo) void carregarArquivoFoto(arquivo);
    },
    [carregarArquivoFoto],
  );

  const aoSoltarFoto = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setArrastandoFoto(false);
      const arquivo = event.dataTransfer.files[0];
      if (arquivo) void carregarArquivoFoto(arquivo);
    },
    [carregarArquivoFoto],
  );

  const carregarHistorico = useCallback(async () => {
    if (modal.modo !== "existente") return;
    setMostrarHistorico((atual) => !atual);
    if (historico) return;
    setErroHistorico(null);
    try {
      const resposta = await fetch(`${API_URL}/api/estoque/${encodeURIComponent(modal.rua)}/${encodeURIComponent(modal.codigo)}/historico`);
      const json = await resposta.json();
      if (!resposta.ok) throw new Error(json.error ?? "Não consegui carregar o histórico.");
      setHistorico(json.historico ?? []);
    } catch (error) {
      setErroHistorico(mensagemErro(error, "Não consegui carregar o histórico."));
    }
  }, [historico, modal]);

  const focarPrimeiroErro = useCallback(() => {
    const refAlvo =
      modal.modo === "nova" && erroCodigo
        ? codigoRef.current
        : definirProduto && erroProduto
          ? produtoRef.current
          : definirProduto && erroVoltagem
            ? voltagemRef.current
            : erroFoto
              ? fotoBotaoRef.current
              : erroQuantidade
                ? quantidadeRef.current
                : erroMotivoContagem
                  ? motivoContagemRef.current
                  : erroResponsavel
                    ? responsavelRef.current
                    : null;
    refAlvo?.scrollIntoView({ behavior: "smooth", block: "center" });
    refAlvo?.focus();
  }, [modal, definirProduto, erroCodigo, erroProduto, erroVoltagem, erroFoto, erroQuantidade, erroMotivoContagem, erroResponsavel]);

  const salvar = useCallback(async () => {
    setTentouSalvar(true);
    if (formularioInvalido) {
      focarPrimeiroErro();
      return;
    }
    const codigoFinal = modal.modo === "existente" ? modal.codigo : `${ruaAtual}${numeroGaveta.trim()}`;

    setSalvando(true);
    setErro(null);
    try {
      const resposta = await fetch(`${API_URL}/api/estoque/${encodeURIComponent(ruaAtual)}/${encodeURIComponent(codigoFinal)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quantidade: Number(quantidade),
          responsavel: responsavelSelecionado.trim(),
          fotoDataUri: fotoPreview,
          expectedUltimaId: modal.modo === "existente" ? modal.ultima.id : null,
          ...(precisaMotivoContagem ? { motivo: motivoContagem.trim() } : {}),
          ...(definirProduto && !vazia ? { produto: produto.trim(), voltagem } : {}),
        }),
      });
      const json = await resposta.json();
      if (!resposta.ok) throw new Error(json.error ?? "Não consegui salvar a contagem.");

      salvarUltimoResponsavel(responsavelSelecionado.trim());
      onSalvo(ruaAtual, codigoFinal);
    } catch (error) {
      setErro(mensagemErro(error, "Não consegui salvar a contagem."));
    } finally {
      setSalvando(false);
    }
  }, [numeroGaveta, ruaAtual, definirProduto, fotoPreview, formularioInvalido, focarPrimeiroErro, modal, onSalvo, produto, quantidade, responsavelSelecionado, vazia, voltagem, precisaMotivoContagem, motivoContagem]);

  const excluirPosicao = useCallback(async () => {
    if (modal.modo !== "existente") return;
    if (!window.confirm(`Excluir a gaveta ${modal.codigo} da Rua ${modal.rua}? Ela some da tela (o histórico fica guardado no arquivo de excluídos).`)) return;
    setErro(null);
    try {
      const resposta = await fetch(`${API_URL}/api/estoque/posicao/${encodeURIComponent(modal.rua)}/${encodeURIComponent(modal.codigo)}`, { method: "DELETE" });
      if (!resposta.ok) throw new Error((await resposta.json().catch(() => ({}))).error ?? "Não consegui excluir a gaveta.");
      onExcluida(modal.rua, modal.codigo);
    } catch (error) {
      setErro(mensagemErro(error, "Não consegui excluir a gaveta."));
    }
  }, [modal, onExcluida]);

  const salvarMetadados = useCallback(async () => {
    if (modal.modo !== "existente") return;
    const voltagemFinal = voltagemDoNome(produtoEdit) ?? voltagemEdit;
    if (!produtoEdit.trim() || !voltagemFinal) {
      setErroMetadados("Selecione produto e voltagem.");
      return;
    }
    setSalvandoMetadados(true);
    setErroMetadados(null);
    try {
      const resposta = await fetch(`${API_URL}/api/estoque/${encodeURIComponent(modal.rua)}/${encodeURIComponent(modal.codigo)}/metadados`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ produto: produtoEdit.trim(), voltagem: voltagemFinal }),
      });
      const json = await resposta.json();
      if (!resposta.ok) throw new Error(json.error ?? "Não consegui salvar produto/voltagem.");

      onMetadadosSalvos(modal.rua, modal.codigo, produtoEdit.trim(), voltagemFinal as Voltagem);
      setEditandoMetadados(false);
    } catch (error) {
      setErroMetadados(mensagemErro(error, "Não consegui salvar produto/voltagem."));
    } finally {
      setSalvandoMetadados(false);
    }
  }, [modal, produtoEdit, voltagemEdit, onMetadadosSalvos]);

  // A foto anterior só aparece como referência (pra comparar contra o que tem na posição agora) —
  // nunca é reaproveitada ao salvar: toda contagem exige tirar uma foto nova (ver `salvar`).
  const fotoAnteriorUrl = modal.modo === "existente" ? modal.ultima.fotoUrl : null;

  const historicoAnterior = modal.modo === "existente" && historico ? historico.filter((item) => item.id !== modal.ultima.id) : [];
  const contagemAnterior = historicoAnterior[0] ?? null;

  // Código em destaque pra bater com a etiqueta física da prateleira — só o código da posição
  // (mesmo texto que já aparece no card e, em tese, na etiqueta colada na prateleira), sem juntar
  // com a letra da rua, que já aparece em separado no título do modal. Na posição existente é
  // fixo, numa posição nova acompanha o número digitado e a rua escolhida.
  const codigoEmDestaque =
    modal.modo === "existente" ? modal.codigo : ruaAtual && numeroGaveta.trim() ? `${ruaAtual}${numeroGaveta.trim()}` : "?";

  return (
    <div className="settings-overlay" onClick={solicitarFechamento}>
      <div
        ref={painelRef}
        className="settings-panel estoque-contagem-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="estoque-contagem-titulo"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        onChangeCapture={() => setAlterado(true)}
      >
        <div className="settings-panel-header">
          <button className="settings-close" onClick={solicitarFechamento} aria-label="Fechar">
            ×
          </button>
          <h2 id="estoque-contagem-titulo" className="settings-title">
            Rua {ruaAtual || "?"}
            {modal.modo === "existente" ? ` · ${modal.codigo}` : " · nova gaveta"}
          </h2>
        </div>

        <div className="settings-panel-body estoque-contagem-corpo">
          {modal.modo === "nova" && (
            <div className="estoque-rua-gaveta">
              <label className="field">
                <span className="field-label">
                  Rua <span className="field-obrigatorio">*</span>
                </span>
                <select
                  className={`field-input${mostrar("codigo", erroRua) ? " field-input--erro" : ""}`}
                  value={ruaNova}
                  onChange={(event) => {
                    const rua = event.target.value;
                    setRuaNova(rua);
                    if (!tocados.has("codigo") && rua) {
                      setNumeroGaveta(proximoNumeroGavetaSugerido(rua, modal.codigosPorRua[rua] ?? []));
                    }
                  }}
                  onBlur={() => tocar("codigo")}
                  autoFocus
                >
                  <option value="">Selecione a rua…</option>
                  {RUAS_DISPONIVEIS.map((rua) => (
                    <option key={rua} value={rua}>
                      Rua {rua}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="field-label">
                  Número da gaveta <span className="field-obrigatorio">*</span>
                </span>
                <input
                  ref={codigoRef}
                  className={`field-input${mostrar("codigo", erroCodigo) ? " field-input--erro" : ""}`}
                  inputMode="numeric"
                  value={numeroGaveta}
                  onChange={(event) => setNumeroGaveta(event.target.value.replace(/\s+/g, ""))}
                  onBlur={() => tocar("codigo")}
                  placeholder="Ex.: 3"
                />
              </label>
              {mostrar("codigo", erroCodigo) && <span className="field-erro estoque-rua-gaveta-erro">{mostrar("codigo", erroCodigo)}</span>}
            </div>
          )}

          {definirProduto ? (
            <div className="estoque-produto-voltagem">
              <label className="field">
                <span className="field-label">
                  Produto <span className="field-obrigatorio">*</span>
                </span>
                <select
                  ref={produtoRef}
                  className={`field-input${mostrar("produto", erroProduto) ? " field-input--erro" : ""}`}
                  value={produto}
                  onChange={(event) => {
                    setProduto(event.target.value);
                    if (event.target.value === PRODUTO_VAZIA) {
                      setVoltagemEscolhida("");
                      setQuantidade("0");
                    }
                  }}
                  onBlur={() => tocar("produto")}
                >
                  <option value="">Selecione…</option>
                  <option value={PRODUTO_VAZIA}>Gaveta vazia (sem produto)</option>
                  {produtos.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
                {produtos.length === 0 && !vazia && (
                  <span className="field-value--muted">Nenhum produto cadastrado ainda — use "+ Produto" no topo da tela de Estoque.</span>
                )}
                {mostrar("produto", erroProduto) && <span className="field-erro">{mostrar("produto", erroProduto)}</span>}
              </label>
              {vazia ? (
                <p className="field-value--muted estoque-vazia-nota">
                  Registra a gaveta com 0 un., sem produto nem voltagem. Quando chegar mercadoria, é só recontar escolhendo o produto.
                </p>
              ) : voltagemDoProduto ? (
                <div className="field">
                  <span className="field-label">Voltagem</span>
                  <span className="estoque-voltagem-fixa">{voltagemDoProduto}</span>
                  <span className="field-value--muted">pelo nome do produto</span>
                </div>
              ) : (
                <label className="field">
                  <span className="field-label">
                    Voltagem <span className="field-obrigatorio">*</span>
                  </span>
                  <select
                    ref={voltagemRef}
                    className={`field-input${mostrar("voltagem", erroVoltagem) ? " field-input--erro" : ""}`}
                    value={voltagemEscolhida}
                    onChange={(event) => setVoltagemEscolhida(event.target.value)}
                    onBlur={() => tocar("voltagem")}
                  >
                    <option value="">Selecione…</option>
                    {VOLTAGENS.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                  {mostrar("voltagem", erroVoltagem) && <span className="field-erro">{mostrar("voltagem", erroVoltagem)}</span>}
                </label>
              )}
            </div>
          ) : (
            <div className="estoque-produto-voltagem-atual">
              {editandoMetadados ? (
                <>
                  <label className="field">
                    <span className="field-label">Produto</span>
                    <select className="field-input" value={produtoEdit} onChange={(event) => setProdutoEdit(event.target.value)}>
                      <option value="">Selecione…</option>
                      {produtos.map((item) => (
                        <option key={item} value={item}>
                          {item}
                        </option>
                      ))}
                    </select>
                  </label>
                  {voltagemDoNome(produtoEdit) ? (
                    <p className="field-value--muted">
                      Voltagem: <strong>{voltagemDoNome(produtoEdit)}</strong> (pelo nome do produto)
                    </p>
                  ) : (
                    <label className="field">
                      <span className="field-label">Voltagem</span>
                      <select className="field-input" value={voltagemEdit} onChange={(event) => setVoltagemEdit(event.target.value)}>
                        <option value="">Selecione…</option>
                        {VOLTAGENS.map((item) => (
                          <option key={item} value={item}>
                            {item}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {erroMetadados && <p className="error-banner">{erroMetadados}</p>}
                  <div className="estoque-produto-voltagem-acoes">
                    <button type="button" className="btn-primario" onClick={() => void salvarMetadados()} disabled={salvandoMetadados}>
                      {salvandoMetadados ? "Salvando..." : "Salvar produto/voltagem"}
                    </button>
                    <button type="button" className="refresh-btn" onClick={() => setEditandoMetadados(false)}>
                      Cancelar
                    </button>
                  </div>
                </>
              ) : (
                <p className="field-value--muted">
                  Produto: <strong>{modal.produto ?? "não definido"}</strong> · Voltagem: <strong>{modal.voltagem ?? "não definida"}</strong>{" "}
                  <button type="button" className="estoque-editar-metadados" onClick={() => setEditandoMetadados(true)}>
                    Editar
                  </button>
                </p>
              )}
            </div>
          )}

          <div className="field">
            <span className="field-label">
              Foto desta contagem <span className="field-obrigatorio">*</span>
            </span>
            <span className="estoque-codigo-destaque">Gaveta {codigoEmDestaque}</span>
            <div
              className={`estoque-foto-soltar${arrastandoFoto ? " estoque-foto-soltar--arrastando" : ""}`}
              onDragEnter={(event) => {
                event.preventDefault();
                setArrastandoFoto(true);
              }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setArrastandoFoto(false);
              }}
              onDrop={aoSoltarFoto}
              aria-label="Solte uma imagem aqui para anexar à contagem"
            >
              {fotoPreview ? (
                <img className="estoque-foto-preview" src={fotoPreview} alt="Foto selecionada para esta contagem" />
              ) : fotoAnteriorUrl ? (
                <>
                  <img className="estoque-foto-preview" src={fotoAnteriorUrl} alt="Foto da última contagem" />
                  <span className="field-value--muted">Essa é a foto da última contagem — ainda falta tirar uma nova.</span>
                </>
              ) : (
                <div className="estoque-foto-placeholder">{arrastandoFoto ? "Solte a imagem aqui" : "Arraste uma foto aqui"}</div>
              )}
            </div>
            <input ref={inputFotoRef} type="file" accept="image/*" capture="environment" onChange={aoEscolherFoto} hidden />
            <button
              ref={fotoBotaoRef}
              type="button"
              className="refresh-btn estoque-foto-acao"
              onClick={() => {
                tocar("foto");
                inputFotoRef.current?.click();
              }}
            >
              {fotoPreview ? "Trocar foto" : "Tirar / escolher foto"}
            </button>
            {mostrar("foto", erroFoto) && <span className="field-erro">{mostrar("foto", erroFoto)}</span>}
          </div>

          {quantidadePorCaixa ? (
            <ContagemPorCaixa
              key={`${chaveDoProduto(produtoContado)}:${quantidadePorCaixa}`}
              unidadesPorCaixa={quantidadePorCaixa}
              quantidadeInicial={quantidade}
              onQuantidadeChange={setQuantidade}
              inputRef={setQuantidadeInputRef}
              erro={mostrar("quantidade", erroQuantidade)}
              onBlur={() => tocar("quantidade")}
            />
          ) : (
            <label className="field">
              <span className="field-label">
                Quantidade contada <span className="field-obrigatorio">*</span>
              </span>
              <div className="estoque-qtd-controle">
                <button type="button" className="estoque-qtd-btn" onClick={() => ajustarQuantidade(-1)} disabled={vazia} aria-label="Diminuir quantidade">
                  −
                </button>
                <input
                  ref={quantidadeRef}
                  className={`field-input${mostrar("quantidade", erroQuantidade) ? " field-input--erro" : ""}`}
                  type="number"
                  min={0}
                  inputMode="numeric"
                  disabled={vazia}
                  value={quantidade}
                  onChange={(event) => setQuantidade(event.target.value)}
                  onBlur={() => tocar("quantidade")}
                  placeholder="Ex.: 48"
                />
                <button type="button" className="estoque-qtd-btn" onClick={() => ajustarQuantidade(1)} disabled={vazia} aria-label="Aumentar quantidade">
                  +
                </button>
                <span className="estoque-qtd-unidade">un.</span>
              </div>
              {mostrar("quantidade", erroQuantidade) && <span className="field-erro">{mostrar("quantidade", erroQuantidade)}</span>}
            </label>
          )}

          {precisaMotivoContagem && (
            <label className="field">
              <span className="field-label">Motivo da diferença <span className="field-obrigatorio">*</span></span>
              <textarea
                ref={motivoContagemRef}
                className="field-input"
                rows={2}
                maxLength={500}
                value={motivoContagem}
                onChange={(event) => setMotivoContagem(event.target.value)}
                placeholder="Ex.: diferença encontrada na conferência física"
                aria-invalid={Boolean(erroMotivoContagem)}
              />
              {erroMotivoContagem && <span className="field-erro">{erroMotivoContagem}</span>}
            </label>
          )}

          <label className="field">
            <span className="field-label">
              Quem contou <span className="field-obrigatorio">*</span>
            </span>
            <select
              ref={responsavelRef}
              className={`field-input${mostrar("responsavel", erroResponsavel) ? " field-input--erro" : ""}`}
              value={responsavelSelecionado}
              onChange={(event) => {
                setResponsavel(event.target.value);
                setErro(null);
              }}
              onBlur={() => tocar("responsavel")}
              disabled={responsaveis.length === 0}
              aria-invalid={Boolean(mostrar("responsavel", erroResponsavel))}
            >
              <option value="">Selecione quem contou</option>
              {responsaveis.map((nome) => <option key={nome} value={nome}>{nome}</option>)}
            </select>
            {responsaveis.length === 0 && <span className="field-erro">{mensagemResponsaveis}</span>}
            {mostrar("responsavel", erroResponsavel) && <span className="field-erro">{mostrar("responsavel", erroResponsavel)}</span>}
          </label>

          {modal.modo === "existente" && (
            <>
              <button type="button" className="buscas-recentes-item" onClick={() => void carregarHistorico()}>
                {mostrarHistorico ? "Ocultar histórico" : "Ver histórico"}
              </button>
              {mostrarHistorico && erroHistorico && <p className="error-banner" role="alert">{erroHistorico}</p>}
              {mostrarHistorico && historico && (
                <ul className="estoque-historico">
                  <li key={modal.ultima.id} className="estoque-historico-item">
                    {(modal.ultima.tipo ?? "contagem") === "contagem" && (
                      <img className="estoque-historico-miniatura" src={modal.ultima.fotoUrl} alt={`Foto da contagem de ${formatarDataHora(modal.ultima.criadoEm)}`} />
                    )}
                    <span>
                      <strong>
                        {(modal.ultima.tipo ?? "contagem") === "contagem" ? "Contagem atual" : `Saldo atual (${rotuloEventoEstoque(modal.ultima.tipo)})`}: {modal.ultima.quantidade}
                      </strong>{" "}
                      un. — {modal.ultima.responsavel} · {formatarDataHora(modal.ultima.criadoEm)}
                      {contagemAnterior ? (
                        <span className="estoque-historico-evolucao">
                          Era {contagemAnterior.quantidade} → agora {modal.ultima.quantidade} un.
                        </span>
                      ) : (modal.ultima.tipo ?? "contagem") === "contagem" ? (
                        <span className="estoque-historico-evolucao">Primeira contagem registrada.</span>
                      ) : null}
                      {modal.ultima.motivo && <span className="estoque-historico-evolucao">Motivo: {modal.ultima.motivo}</span>}
                    </span>
                  </li>
                  {historicoAnterior.length > 0 && (
                    <>
                      {historicoAnterior.map((item) => (
                        <li key={item.id} className="estoque-historico-item">
                          {(item.tipo ?? "contagem") === "contagem" && (
                            <img className="estoque-historico-miniatura" src={item.fotoUrl} alt={`Foto da contagem de ${formatarDataHora(item.criadoEm)}`} />
                          )}
                          <span>
                            <strong>{rotuloEventoEstoque(item.tipo)}: {item.quantidade}</strong> un. — {item.responsavel} · {formatarDataHora(item.criadoEm)}
                            {item.motivo && <span className="estoque-historico-evolucao">Motivo: {item.motivo}</span>}
                          </span>
                        </li>
                      ))}
                    </>
                  )}
                </ul>
              )}
            </>
          )}
        </div>

        <div className="settings-panel-footer">
          {erro && <p className="error-banner">{erro}</p>}
          <button className="btn-primario" onClick={() => void salvar()} disabled={salvando || (tentouSalvar && formularioInvalido)}>
            {salvando ? "Salvando..." : "Salvar"}
          </button>
          {modal.modo === "existente" && modal.produto && (
            <button
              type="button"
              className="refresh-btn"
              onClick={() =>
                onAbrirMovimentacao({
                  rua: modal.rua,
                  codigo: modal.codigo,
                  ultima: modal.ultima,
                  produto: modal.produto,
                  voltagem: modal.voltagem,
                })
              }
              disabled={salvando}
            >
              Movimentar estoque
            </button>
          )}
          {modal.modo === "existente" && (
            <button type="button" className="btn-perigo-texto" onClick={() => void excluirPosicao()} disabled={salvando}>
              Excluir gaveta {modal.codigo}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

type TipoMovimentacao = "entrada" | "saida" | "transferencia" | "ajuste";

function ModalMovimentacao({
  posicao,
  posicoes,
  responsaveis,
  mensagemResponsaveis,
  onFechar,
  onSalvo,
}: {
  posicao: PosicaoResumo;
  posicoes: PosicaoResumo[];
  responsaveis: string[];
  mensagemResponsaveis: string | null;
  onFechar: () => void;
  onSalvo: () => void;
}) {
  const [tipo, setTipo] = useState<TipoMovimentacao>("entrada");
  const [quantidade, setQuantidade] = useState("");
  const [motivo, setMotivo] = useState("");
  const [responsavel, setResponsavel] = useState(posicao.ultima.responsavel || lerUltimoResponsavel());
  const [destino, setDestino] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [alterado, setAlterado] = useState(false);
  const responsavelSelecionado = responsaveis.includes(responsavel) ? responsavel : responsaveis[0] ?? "";
  const solicitarFechamento = useCallback(() => {
    if (alterado && !window.confirm("Descartar a movimentação não salva?")) return;
    onFechar();
  }, [alterado, onFechar]);
  const painelRef = useDialogAccessibility(solicitarFechamento);

  const destinos = posicoes.filter(
    (item) =>
      item.codigo !== posicao.codigo ||
      item.rua !== posicao.rua,
  ).filter(
    (item) =>
      item.produto?.toLowerCase() === posicao.produto?.toLowerCase() &&
      item.voltagem === posicao.voltagem,
  );
  const numero = Number(quantidade);
  const quantidadeValida =
    Number.isSafeInteger(numero) &&
    (tipo === "ajuste" ? numero >= 0 : numero > 0) &&
    (tipo !== "saida" && tipo !== "transferencia" || numero <= posicao.ultima.quantidade);

  const salvar = async (event: FormEvent) => {
    event.preventDefault();
    if (!quantidadeValida) {
      setErro(tipo === "ajuste" ? "Informe um saldo final inteiro igual ou maior que zero." : "Informe uma quantidade inteira maior que zero e não superior ao saldo.");
      return;
    }
    if (!motivo.trim()) {
      setErro("Informe o motivo da movimentação.");
      return;
    }
    if (!responsavelSelecionado.trim() || !responsaveis.includes(responsavelSelecionado)) {
      setErro(mensagemResponsaveis ?? "Selecione quem registrou a movimentação.");
      return;
    }
    const destinoSelecionado = tipo === "transferencia" ? destinos.find((item) => `${item.rua}|${item.codigo}` === destino) : undefined;
    if (tipo === "transferencia" && !destinoSelecionado) {
      setErro("Selecione uma gaveta de destino do mesmo produto e voltagem.");
      return;
    }

    setSalvando(true);
    setErro(null);
    try {
      const resposta = await fetch(`${API_URL}/api/estoque/${encodeURIComponent(posicao.rua)}/${encodeURIComponent(posicao.codigo)}/movimentos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tipo,
          quantidade: numero,
          motivo: motivo.trim(),
          responsavel: responsavelSelecionado.trim(),
          expectedUltimaId: posicao.ultima.id,
          ...(destinoSelecionado
            ? {
                destino: {
                  rua: destinoSelecionado.rua,
                  codigo: destinoSelecionado.codigo,
                  expectedUltimaId: destinoSelecionado.ultima.id,
                },
              }
            : {}),
        }),
      });
      const json = await resposta.json();
      if (!resposta.ok) throw new Error(json.error ?? "Não consegui registrar a movimentação.");
      salvarUltimoResponsavel(responsavelSelecionado.trim());
      onSalvo();
    } catch (error) {
      setErro(mensagemErro(error, "Não consegui registrar a movimentação."));
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="settings-overlay" onClick={solicitarFechamento}>
      <div
        ref={painelRef}
        className="settings-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="estoque-movimentacao-titulo"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        onChangeCapture={() => setAlterado(true)}
      >
        <div className="settings-panel-header">
          <button className="settings-close" onClick={solicitarFechamento} aria-label="Fechar movimentação">×</button>
          <h2 id="estoque-movimentacao-titulo" className="settings-title">Movimentar gaveta {posicao.codigo}</h2>
          <p className="settings-hint">{posicao.produto} · {posicao.voltagem} · saldo atual: {posicao.ultima.quantidade} un.</p>
        </div>
        <form onSubmit={(event) => void salvar(event)}>
          <div className="settings-panel-body">
            <label className="field">
              <span className="field-label">Tipo de movimentação</span>
              <select className="field-input" value={tipo} onChange={(event) => { setTipo(event.target.value as TipoMovimentacao); setErro(null); }}>
                <option value="entrada">Entrada</option>
                <option value="saida">Saída</option>
                <option value="transferencia">Transferência</option>
                <option value="ajuste">Ajuste de saldo</option>
              </select>
            </label>
            <label className="field">
              <span className="field-label">{tipo === "ajuste" ? "Saldo final" : "Quantidade"}</span>
              <input
                className="field-input"
                type="number"
                min={tipo === "ajuste" ? 0 : 1}
                step={1}
                inputMode="numeric"
                value={quantidade}
                onChange={(event) => setQuantidade(event.target.value)}
                aria-label={tipo === "ajuste" ? "Saldo final" : "Quantidade"}
              />
            </label>
            {tipo === "transferencia" && (
              <label className="field">
                <span className="field-label">Gaveta de destino</span>
                <select className="field-input" value={destino} onChange={(event) => setDestino(event.target.value)}>
                  <option value="">Selecione…</option>
                  {destinos.map((item) => (
                    <option key={`${item.rua}|${item.codigo}`} value={`${item.rua}|${item.codigo}`}>
                      {item.codigo} · saldo {item.ultima.quantidade}
                    </option>
                  ))}
                </select>
                {destinos.length === 0 && <span className="field-value--muted">Não há outra gaveta cadastrada para este produto e voltagem.</span>}
              </label>
            )}
            <label className="field">
              <span className="field-label">Motivo <span className="field-obrigatorio">*</span></span>
              <textarea className="field-input" rows={2} maxLength={500} value={motivo} onChange={(event) => setMotivo(event.target.value)} />
            </label>
            <label className="field">
              <span className="field-label">Quem registrou <span className="field-obrigatorio">*</span></span>
              <select className="field-input" value={responsavelSelecionado} onChange={(event) => setResponsavel(event.target.value)} disabled={responsaveis.length === 0}>
                <option value="">Selecione quem registrou</option>
                {responsaveis.map((nome) => <option key={nome} value={nome}>{nome}</option>)}
              </select>
              {responsaveis.length === 0 && <span className="field-erro">{mensagemResponsaveis}</span>}
            </label>
          </div>
          <div className="settings-panel-footer">
            {erro && <p className="error-banner" role="alert">{erro}</p>}
            <button className="btn-primario" type="submit" disabled={salvando}>
              {salvando ? "Salvando..." : "Registrar movimentação"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function CampoUnidadesPorCaixa({
  produto,
  unidadesPorCaixa,
  onSalvar,
}: {
  produto: string;
  unidadesPorCaixa: number | undefined;
  onSalvar: (produto: string, unidades: number | null) => Promise<void>;
}) {
  const [valor, setValor] = useState(unidadesPorCaixa === undefined ? "" : String(unidadesPorCaixa));
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const salvar = async (event: FormEvent) => {
    event.preventDefault();
    const unidades = valor.trim() === "" ? null : Number(valor);
    if (unidades !== null && (!Number.isSafeInteger(unidades) || unidades < 1)) {
      setErro("Use um número inteiro maior que zero.");
      return;
    }
    setSalvando(true);
    setErro(null);
    try {
      await onSalvar(produto, unidades);
    } catch (error) {
      setErro(mensagemErro(error, "Não consegui salvar a quantidade por caixa."));
    } finally {
      setSalvando(false);
    }
  };

  return (
    <form className="estoque-config-caixa" onSubmit={(event) => void salvar(event)}>
      <label className="field">
        <span className="field-label">Unidades por caixa</span>
        <input
          className="field-input"
          type="number"
          min={1}
          step={1}
          inputMode="numeric"
          value={valor}
          onChange={(event) => setValor(event.target.value)}
          aria-label={`Unidades por caixa de ${produto}`}
          placeholder="Não usa caixa"
        />
      </label>
      <button type="submit" className="refresh-btn" disabled={salvando}>
        {salvando ? "Salvando..." : "Salvar"}
      </button>
      {erro && <span className="field-erro" role="alert">{erro}</span>}
    </form>
  );
}

/** Catálogo de produtos — antes um painel no topo da tela, agora um modal aberto pelo "+ Produto" do cabeçalho. */
function ModalProdutos({
  produtos,
  info,
  unidadesPorCaixa,
  onFechar,
  onAlterado,
  onFotosAtualizadas,
  onSalvarUnidadesPorCaixa,
}: {
  produtos: string[];
  info: Record<string, InfoProduto>;
  unidadesPorCaixa: Record<string, number>;
  onFechar: () => void;
  onAlterado: (produtos: string[]) => void;
  onFotosAtualizadas: (info: Record<string, InfoProduto>) => void;
  onSalvarUnidadesPorCaixa: (produto: string, unidades: number | null) => Promise<void>;
}) {
  const [alterado, setAlterado] = useState(false);
  const [erroProdutos, setErroProdutos] = useState<string | null>(null);
  const [salvandoProduto, setSalvandoProduto] = useState(false);

  // Cadastro em lote: "tiny" busca no cadastro de produtos do Tiny; "colar" aceita uma lista, um por linha.
  const [modo, setModo] = useState<"lista" | "tiny" | "colar" | "sugestoes">("tiny");
  const [termoTiny, setTermoTiny] = useState("koti");
  const [resultadosTiny, setResultadosTiny] = useState<ProdutoTiny[] | null>(null);
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [sugestoesSelecionadas, setSugestoesSelecionadas] = useState(
    () =>
      new Set(
        SUGESTOES_PRODUTOS.flatMap((grupo) => grupo.itens)
          .map((item) => item.nome)
          .filter((nome) => !produtos.some((produto) => produto.toLowerCase() === nome.toLowerCase())),
      ),
  );
  const [buscandoTiny, setBuscandoTiny] = useState(false);
  const [buscandoFotos, setBuscandoFotos] = useState(false);
  const [progressoFotos, setProgressoFotos] = useState<{ atual: number; total: number; aguardando?: boolean } | null>(null);
  const [textoColado, setTextoColado] = useState("");
  const [produtoParaMesclar, setProdutoParaMesclar] = useState<string | null>(null);
  const [destinoMescla, setDestinoMescla] = useState("");
  const [avisoLote, setAvisoLote] = useState<string | null>(null);
  const solicitarFechamento = useCallback(() => {
    if (alterado && !window.confirm("Descartar as alterações não salvas nos produtos?")) return;
    onFechar();
  }, [alterado, onFechar]);
  const painelRef = useDialogAccessibility(solicitarFechamento);
  const noCatalogo = useMemo(() => new Set(produtos.map(chaveComparacaoProduto)), [produtos]);
  const fotosPendentes = produtos.filter((nome) => !info[chaveDoProduto(nome)]?.fotoUrl);

  const buscarFotosFaltantes = useCallback(async () => {
    if (buscandoFotos || fotosPendentes.length === 0) return;
    setBuscandoFotos(true);
    setErroProdutos(null);
    setAvisoLote(null);
    setProgressoFotos({ atual: 0, total: fotosPendentes.length });
    let importadas = 0;
    let semVinculo = 0;
    let semImagem = 0;
    let falhas = 0;
    const detalhes = new Set<string>();
    const comId = fotosPendentes.filter((nome) => (info[chaveDoProduto(nome)]?.idsTiny?.length ?? 0) > 0);
    const semId = fotosPendentes.filter((nome) => (info[chaveDoProduto(nome)]?.idsTiny?.length ?? 0) === 0);
    const lotes: string[][] = [];
    for (let inicio = 0; inicio < comId.length; inicio += 5) lotes.push(comId.slice(inicio, inicio + 5));
    for (const nome of semId) lotes.push([nome]);
    let processados = 0;
    try {
      for (let indiceLote = 0; indiceLote < lotes.length; indiceLote++) {
        const lote = lotes[indiceLote];
        setProgressoFotos({ atual: processados, total: fotosPendentes.length });
        const resposta = await fetch(`${API_URL}/api/estoque/produtos/fotos/importar-faltantes`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nomes: lote }),
        });
        const json = await resposta.json();
        if (!resposta.ok) throw new Error(json.error ?? "Não consegui buscar as fotos no Tiny.");
        const resultados: { nome: string; status: string; mensagem?: string }[] = json.resultados ?? [];
        importadas += resultados.filter((resultado) => resultado.status === "importada").length;
        semVinculo += resultados.filter((resultado) => resultado.status === "sem-vinculo").length;
        semImagem += resultados.filter((resultado) => resultado.status === "sem-imagem").length;
        falhas += resultados.filter((resultado) => resultado.status === "erro").length;
        for (const resultado of resultados) {
          if (["sem-vinculo", "sem-imagem", "erro"].includes(resultado.status)) {
            if (resultado.mensagem) detalhes.add(`${resultado.nome}: ${resultado.mensagem}`);
          }
        }
        onFotosAtualizadas(json.info ?? {});
        processados += lote.length;
        setProgressoFotos({ atual: processados, total: fotosPendentes.length });
        if (indiceLote < lotes.length - 1) {
          setProgressoFotos({ atual: processados, total: fotosPendentes.length, aguardando: true });
          await new Promise((resolve) => window.setTimeout(resolve, 20_000));
        }
      }
      setAvisoLote(
        `${importadas} foto(s) importada(s) · ${semVinculo} sem vínculo no Tiny · ${semImagem} sem imagem no Tiny · ${falhas} falha(s).`,
      );
      if (detalhes.size > 0) setErroProdutos([...detalhes].slice(0, 4).join(" · "));
    } catch (error) {
      setErroProdutos(mensagemErro(error, "Não consegui buscar as fotos no Tiny."));
    } finally {
      setBuscandoFotos(false);
      setProgressoFotos(null);
    }
  }, [buscandoFotos, fotosPendentes, info, onFotosAtualizadas]);

  const buscarNoTiny = useCallback(async () => {
    setBuscandoTiny(true);
    setErroProdutos(null);
    try {
      const resposta = await fetch(`${API_URL}/api/estoque/produtos/tiny?termo=${encodeURIComponent(termoTiny.trim())}`);
      const json = await resposta.json();
      if (!resposta.ok) throw new Error(json.error ?? "Não consegui buscar no Tiny.");
      const lista: ProdutoTiny[] = json.produtos ?? [];
      setResultadosTiny(lista);
      setSelecionados(new Set(lista.filter((produto) => produto.idsTiny.length > 0 && produto.codigos.length > 0).map((p) => p.sugestao).filter((nome) => !noCatalogo.has(chaveComparacaoProduto(nome)))));
    } catch (error) {
      setErroProdutos(mensagemErro(error, "Não consegui buscar no Tiny."));
    } finally {
      setBuscandoTiny(false);
    }
  }, [termoTiny, noCatalogo]);

  const adicionarEmLote = useCallback(
    async (nomes: string[], itens?: { nome: string; idsTiny: string[]; codigos: string[] }[]) => {
      if (nomes.length === 0) return;
      setSalvandoProduto(true);
      setErroProdutos(null);
      try {
        const resposta = await fetch(`${API_URL}/api/estoque/produtos/lote`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nomes, itens }),
        });
        const json = await resposta.json();
        if (!resposta.ok) throw new Error(json.error ?? "Não consegui cadastrar os produtos.");
        onAlterado(json.produtos ?? []);
        setAvisoLote(`${json.adicionados} produto(s) adicionado(s)${json.adicionados < nomes.length ? ` — ${nomes.length - json.adicionados} já estavam no catálogo` : ""}.`);
        setAlterado(false);
        setModo("lista");
        setResultadosTiny(null);
        setTextoColado("");
      } catch (error) {
        setErroProdutos(mensagemErro(error, "Não consegui cadastrar os produtos."));
      } finally {
        setSalvandoProduto(false);
      }
    },
    [onAlterado],
  );

  const removerProdutoCatalogo = useCallback(
    async (nome: string) => {
      if (!window.confirm(`Remover "${nome}" do catálogo de produtos?`)) return;
      setErroProdutos(null);
      try {
        const resposta = await fetch(`${API_URL}/api/estoque/produtos/${encodeURIComponent(nome)}`, { method: "DELETE" });
        if (!resposta.ok) throw new Error("Não consegui remover esse produto agora.");
        onAlterado(produtos.filter((p) => p !== nome));
      } catch (error) {
        setErroProdutos(mensagemErro(error, "Não consegui remover esse produto agora."));
      }
    },
    [onAlterado, produtos],
  );

  const mesclarProdutoCatalogo = useCallback(async (origem: string, destino: string) => {
    if (!destino) return;
    if (!window.confirm(`Mesclar "${origem}" em "${destino}"? As gavetas e contagens ficam preservadas, e "${origem}" sai do catálogo.`)) return;
    setSalvandoProduto(true);
    setErroProdutos(null);
    try {
      const resposta = await fetch(`${API_URL}/api/estoque/produtos/mesclar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ origem, destino }),
      });
      const json = await resposta.json();
      if (!resposta.ok) throw new Error(json.error ?? "Não consegui mesclar os produtos.");
      onAlterado(json.produtos ?? []);
      onFotosAtualizadas(json.info ?? {});
      setProdutoParaMesclar(null);
      setDestinoMescla("");
      setAvisoLote(`"${origem}" foi mesclado em "${destino}".`);
      setAlterado(false);
    } catch (error) {
      setErroProdutos(mensagemErro(error, "Não consegui mesclar os produtos."));
    } finally {
      setSalvandoProduto(false);
    }
  }, [onAlterado, onFotosAtualizadas]);

  return (
    <div className="settings-overlay" onClick={solicitarFechamento}>
      <div
        ref={painelRef}
        className={`settings-panel${modo === "lista" ? "" : " settings-panel--largo"}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="estoque-produtos-titulo"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        onChangeCapture={() => setAlterado(true)}
      >
        <div className="settings-panel-header">
          <button className="settings-close" onClick={solicitarFechamento} aria-label="Fechar">
            ×
          </button>
          <h2 id="estoque-produtos-titulo" className="settings-title">Produtos</h2>
          <p className="settings-hint">
            Produtos disponíveis pra escolher ao criar uma posição nova. Remover um produto daqui não afeta posições que já usam ele.
          </p>
        </div>

        <div className="settings-panel-body">
          <div className="abas" role="tablist" aria-label="Como cadastrar">
            {(
              [
                ["tiny", "Buscar no Tiny"],
                ["lista", "Produtos cadastrados"],
              ] as const
            ).map(([valor, rotulo]) => (
              <button
                key={valor}
                type="button"
                role="tab"
                aria-selected={modo === valor}
                className={`aba${modo === valor ? " aba--ativa" : ""}`}
                onClick={() => {
                  setModo(valor);
                  setAvisoLote(null);
                  setErroProdutos(null);
                }}
              >
                {rotulo}
              </button>
            ))}
          </div>

          {avisoLote && <p className="aviso-sucesso">{avisoLote}</p>}

          {modo === "lista" && produtos.length > 0 && (
            <div className="catalogo-fotos-faltantes">
              <button
                type="button"
                className="refresh-btn"
                onClick={() => void buscarFotosFaltantes()}
                disabled={buscandoFotos || fotosPendentes.length === 0}
              >
                {buscandoFotos && progressoFotos
                  ? progressoFotos.aguardando
                    ? `Pausa para limite do Tiny · ${progressoFotos.atual}/${progressoFotos.total}`
                    : `Buscando fotos ${progressoFotos.atual}/${progressoFotos.total}…`
                  : `Buscar fotos faltantes (${fotosPendentes.length})`}
              </button>
              <span className="field-value--muted">As fotos existentes não serão substituídas.</span>
            </div>
          )}

          {modo === "sugestoes" && (
            <>
              <p className="field-value--muted">
                Sugestões baseadas no estoque informado em 30/09/2026. A quantidade é apenas referência; não altera o estoque. Os produtos já cadastrados aparecem desmarcados.
              </p>
              <div className="lote-acoes">
                <span className="field-value--muted">
                  {SUGESTOES_PRODUTOS.flatMap((grupo) => grupo.itens).filter((item) => !noCatalogo.has(chaveComparacaoProduto(item.nome))).length} disponível(is) ·{" "}
                  {sugestoesSelecionadas.size} selecionado(s)
                </span>
                <button
                  type="button"
                  className="refresh-btn"
                  onClick={() =>
                    setSugestoesSelecionadas(
                      sugestoesSelecionadas.size > 0
                        ? new Set()
                        : new Set(
                            SUGESTOES_PRODUTOS.flatMap((grupo) => grupo.itens)
                              .map((item) => item.nome)
                              .filter((nome) => !noCatalogo.has(chaveComparacaoProduto(nome))),
                          ),
                    )
                  }
                >
                  {sugestoesSelecionadas.size > 0 ? "Desmarcar todos" : "Selecionar disponíveis"}
                </button>
              </div>
              {SUGESTOES_PRODUTOS.map((grupo) => (
                <section key={grupo.categoria}>
                  <p className="field-label">{grupo.categoria}</p>
                  <ul className="lote-lista">
                    {grupo.itens.map((item) => {
                      const jaTem = noCatalogo.has(chaveComparacaoProduto(item.nome));
                      return (
                        <li key={item.nome}>
                          <label className={`lote-item${jaTem ? " lote-item--desabilitado" : ""}`}>
                            <input
                              type="checkbox"
                              disabled={jaTem}
                              checked={jaTem || sugestoesSelecionadas.has(item.nome)}
                              onChange={(event) => {
                                const novo = new Set(sugestoesSelecionadas);
                                if (event.target.checked) novo.add(item.nome);
                                else novo.delete(item.nome);
                                setSugestoesSelecionadas(novo);
                              }}
                            />
                            <span>
                              {item.nome}
                              <span className="field-value--muted">
                                {jaTem ? " · já no catálogo" : ` · estoque informado: ${item.estoque}`}
                              </span>
                            </span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
              {erroProdutos && <p className="error-banner">{erroProdutos}</p>}
              <button
                className="btn-primario"
                type="button"
                disabled={salvandoProduto || sugestoesSelecionadas.size === 0}
                onClick={() => void adicionarEmLote([...sugestoesSelecionadas])}
              >
                {salvandoProduto ? "Salvando..." : `Adicionar ${sugestoesSelecionadas.size} ao catálogo`}
              </button>
            </>
          )}

          {modo === "tiny" && (
            <>
              <p className="field-value--muted">
                Busca no cadastro de produtos do Tiny (só ativos). Cada cor e cada voltagem é um produto separado, com o mesmo nome do Tiny — a
                voltagem da gaveta sai do nome do produto.
              </p>
              <form
                className="estoque-form-produto"
                onSubmit={(event) => {
                  event.preventDefault();
                  void buscarNoTiny();
                }}
              >
                <label className="field">
                  <span className="field-label">Palavra pra buscar no Tiny</span>
                  <input className="field-input" value={termoTiny} onChange={(event) => setTermoTiny(event.target.value)} placeholder="Ex.: koti, chaleira, air fryer" />
                </label>
                <button className="btn-primario" type="submit" disabled={buscandoTiny || !termoTiny.trim()}>
                  {buscandoTiny ? "Buscando..." : "Buscar"}
                </button>
              </form>
              {erroProdutos && <p className="error-banner">{erroProdutos}</p>}
              {resultadosTiny &&
                (resultadosTiny.length === 0 ? (
                  <p className="field-value--muted">Nenhum produto ativo no Tiny com "{termoTiny}".</p>
                ) : (
                  <>
                    <div className="lote-acoes">
                      <span className="field-value--muted">
                        {resultadosTiny.length} encontrado(s) · {selecionados.size} selecionado(s)
                      </span>
                      <button
                        type="button"
                        className="refresh-btn"
                        onClick={() =>
                          setSelecionados(
                            selecionados.size > 0 ? new Set() : new Set(resultadosTiny.filter((p) => p.idsTiny.length > 0 && p.codigos.length > 0).map((p) => p.sugestao).filter((n) => !noCatalogo.has(chaveComparacaoProduto(n)))),
                          )
                        }
                      >
                        {selecionados.size > 0 ? "Desmarcar todos" : "Marcar todos"}
                      </button>
                    </div>
                    <ul className="lote-lista">
                      {resultadosTiny.map((p) => {
                        const jaTem = noCatalogo.has(chaveComparacaoProduto(p.sugestao));
                        return (
                          <li key={p.sugestao}>
                            <label className={`lote-item${jaTem ? " lote-item--desabilitado" : ""}`}>
                              <input
                                type="checkbox"
                                disabled={jaTem || p.idsTiny.length === 0 || p.codigos.length === 0}
                                checked={jaTem || (p.idsTiny.length > 0 && p.codigos.length > 0 && selecionados.has(p.sugestao))}
                                onChange={(event) => {
                                  const novo = new Set(selecionados);
                                  if (event.target.checked) novo.add(p.sugestao);
                                  else novo.delete(p.sugestao);
                                  setSelecionados(novo);
                                }}
                              />
                              <span>
                                {p.sugestao}
                                <span className="field-value--muted">
                                  {jaTem ? " · já no catálogo" : p.idsTiny.length === 0 || p.codigos.length === 0 ? " · sem SKU no Tiny" : p.nomesTiny.length > 1 ? ` · ${p.nomesTiny.length} variações no Tiny` : ""}
                                  {p.codigos.length > 0 ? ` · ${p.codigos.slice(0, 3).join(", ")}${p.codigos.length > 3 ? "…" : ""}` : ""}
                                </span>
                              </span>
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                    <button className="btn-primario" type="button" disabled={salvandoProduto || selecionados.size === 0} onClick={() =>
                        void adicionarEmLote(
                          [...selecionados],
                          resultadosTiny.filter((p) => selecionados.has(p.sugestao)).map((p) => ({ nome: p.sugestao, idsTiny: p.idsTiny, codigos: p.codigos })),
                        )
                      }>
                      {salvandoProduto ? "Salvando..." : `Adicionar ${selecionados.size} ao catálogo`}
                    </button>
                  </>
                ))}
            </>
          )}

          {modo === "colar" && (
            <>
              <label className="field">
                <span className="field-label">Um produto por linha</span>
                <textarea
                  className="field-input importar-textarea"
                  value={textoColado}
                  onChange={(event) => setTextoColado(event.target.value)}
                  placeholder={"Chaleira Koti Modern Preta\nAir Fryer Koti 4L\nSanduicheira Koti"}
                  autoFocus
                />
              </label>
              {erroProdutos && <p className="error-banner">{erroProdutos}</p>}
              <button
                className="btn-primario"
                type="button"
                disabled={salvandoProduto || !textoColado.trim()}
                onClick={() => void adicionarEmLote(textoColado.split(/\r?\n/).map((l) => l.trim()).filter(Boolean))}
              >
                {salvandoProduto ? "Salvando..." : "Adicionar ao catálogo"}
              </button>
            </>
          )}

          {modo === "lista" && (
          <>
          {erroProdutos && <p className="error-banner">{erroProdutos}</p>}

          {produtos.length === 0 ? (
            <div className="estado-vazio estado-vazio--compacto">
              <p className="estado-vazio-titulo">Nenhum produto cadastrado. Busque no Tiny para adicionar pelo SKU.</p>
              <button type="button" className="btn-primario" onClick={() => setModo("tiny")}>
                Buscar no Tiny
              </button>
            </div>
          ) : (
            <ul className="estoque-lista-produtos">
              {produtos.map((nome) => (
                <li key={nome}>
                  <span className="catalogo-item">
                    {info[chaveDoProduto(nome)]?.fotoUrl ? (
                      <img className="catalogo-miniatura" src={info[chaveDoProduto(nome)]?.fotoUrl} alt="" loading="lazy" />
                    ) : (
                      <span className="catalogo-miniatura catalogo-miniatura--vazia" aria-hidden="true" />
                    )}
                    {nome}
                  </span>
                  <CampoUnidadesPorCaixa
                    key={`${chaveDoProduto(nome)}:${unidadesPorCaixa[chaveDoProduto(nome)] ?? ""}`}
                    produto={nome}
                    unidadesPorCaixa={unidadesPorCaixa[chaveDoProduto(nome)]}
                    onSalvar={onSalvarUnidadesPorCaixa}
                  />
                  {produtoParaMesclar === nome ? (
                    <>
                      <select
                        className="field-input"
                        aria-label={`Produto de destino para ${nome}`}
                        value={destinoMescla}
                        onChange={(event) => setDestinoMescla(event.target.value)}
                      >
                        <option value="">Mesclar em…</option>
                        {produtos.filter((destino) => chaveComparacaoProduto(destino) !== chaveComparacaoProduto(nome)).map((destino) => (
                          <option key={destino} value={destino}>{destino}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="refresh-btn"
                        disabled={salvandoProduto || !destinoMescla}
                        onClick={() => void mesclarProdutoCatalogo(nome, destinoMescla)}
                      >
                        {salvandoProduto ? "Mesclando..." : "Confirmar mesclagem"}
                      </button>
                      <button type="button" className="refresh-btn" onClick={() => setProdutoParaMesclar(null)} disabled={salvandoProduto}>
                        Cancelar
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="refresh-btn"
                      aria-label={`Mesclar ${nome} em outro produto`}
                      onClick={() => {
                        setProdutoParaMesclar(nome);
                        setDestinoMescla("");
                      }}
                    >
                      Mesclar em…
                    </button>
                  )}
                  <button type="button" className="refresh-btn" onClick={() => void removerProdutoCatalogo(nome)}>
                    Excluir
                  </button>
                </li>
              ))}
            </ul>
          )}
          </>
          )}
        </div>
      </div>
    </div>
  );
}

interface InfoProduto {
  idsTiny?: string[];
  codigos?: string[];
  fotoUrl?: string;
  fotoStatus?: "pendente" | "ok" | "sem-foto" | "nao-encontrado" | "erro";
  fotoOrigem?: "tiny" | "manual";
}

/** Um produto e todas as gavetas onde ele está. */
interface GrupoProduto {
  chave: string;
  nome: string;
  noCatalogo: boolean;
  info?: InfoProduto;
  total: number;
  gavetas: PosicaoResumo[];
  porVoltagem: { voltagem: string; quantidade: number }[];
  ultimaContagem: string | null;
}

type Ordem = "nome" | "unidades";
type VisaoEstoque = "produtos" | "longarinas";

interface FiltrosEstoque {
  busca: string;
  filtroVoltagem: string;
  ordem: Ordem;
  soComEstoque: boolean;
  visaoEstoque: VisaoEstoque;
}

function lerFiltrosEstoqueDaUrl(): FiltrosEstoque {
  const params = new URLSearchParams(window.location.search);
  const ordem = params.get("estoqueOrdem");
  const voltagem = VOLTAGENS.find((item) => item === params.get("estoqueVoltagem"));
  return {
    busca: params.get("estoqueBusca") ?? "",
    filtroVoltagem: voltagem ?? "",
    ordem: ordem === "unidades" ? "unidades" : "nome",
    soComEstoque: params.get("estoqueSoComEstoque") !== "0",
    visaoEstoque: params.get("estoqueVisao") === "longarinas" ? "longarinas" : "produtos",
  };
}

function chaveDoProduto(nome: string): string {
  return nome.trim().replace(/\s+/g, " ").toLowerCase();
}

function baixarCsv(nome: string, linhas: (string | number)[][]): void {
  const csv = linhas.map((linha) => linha.map((valor) => `"${String(valor).replace(/"/g, '""')}"`).join(";")).join("\n");
  const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = nome;
  link.click();
  URL.revokeObjectURL(url);
}

function normalizar(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function escaparRegex(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function termoBateTexto(termo: string, texto: string): boolean {
  const valor = normalizar(texto);
  const busca = normalizar(termo).trim();
  if (!busca) return true;
  if (/[a-z]/i.test(busca) && /\d/.test(busca)) {
    const padrao = new RegExp(`(?:^|[^a-z0-9])${escaparRegex(busca)}(?:$|[^a-z0-9])`, "i");
    return padrao.test(valor);
  }
  return valor.includes(busca);
}

function ordenarGavetas(a: PosicaoResumo, b: PosicaoResumo): number {
  return a.rua.localeCompare(b.rua, "pt-BR") || a.codigo.localeCompare(b.codigo, "pt-BR", { numeric: true });
}

function IconeBusca({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

function CardResumo({ rotulo, valor, detalhe, tom }: { rotulo: string; valor: string | number; detalhe: string; tom: string }) {
  return (
    <div className={`resumo-card resumo-card--${tom}`}>
      <span className="resumo-card-rotulo">{rotulo}</span>
      <span className="resumo-card-valor tabular">{valor}</span>
      <span className="resumo-card-detalhe">{detalhe}</span>
    </div>
  );
}

/** Foto do produto (Cloudinary). Sem foto, ou se o link falhar, mostra o ícone da estante. */
function FotoProduto({ info, nome, className }: { info?: InfoProduto; nome: string; className: string }) {
  const [falhou, setFalhou] = useState(false);
  if (info?.fotoUrl && !falhou) {
    return <img className={className} src={info.fotoUrl} alt={nome} loading="lazy" onError={() => setFalhou(true)} />;
  }
  return (
    <div className={`${className} produto-foto--vazia`}>
      <IconeGondola className="estoque-card-icone" />
      <span>Sem foto cadastrada</span>
    </div>
  );
}

function ModalProduto({
  grupo,
  onFechar,
  onAbrirGaveta,
  onNovaGaveta,
  onFotoAlterada,
  onExcluirProduto,
  onSepararVoltagem,
}: {
  grupo: GrupoProduto;
  onFechar: () => void;
  onAbrirGaveta: (posicao: PosicaoResumo) => void;
  onNovaGaveta: (produto: string) => void;
  onFotoAlterada: () => void;
  onExcluirProduto: (produto: string) => Promise<void>;
  onSepararVoltagem: (grupo: GrupoProduto) => void;
}) {
  const inputFotoRef = useRef<HTMLInputElement>(null);
  const painelRef = useDialogAccessibility(onFechar);
  const [enviandoFoto, setEnviandoFoto] = useState(false);
  const [arrastandoFoto, setArrastandoFoto] = useState(false);
  const [avisoFoto, setAvisoFoto] = useState<string | null>(null);
  const [erroFoto, setErroFoto] = useState<string | null>(null);
  const [excluindoProduto, setExcluindoProduto] = useState(false);
  const [erroExcluirProduto, setErroExcluirProduto] = useState<string | null>(null);

  const excluirProduto = useCallback(async () => {
    if (
      !grupo.noCatalogo ||
      grupo.total !== 0 ||
      grupo.gavetas.length !== 0 ||
      !window.confirm(`Excluir "${grupo.nome}" do catálogo? Essa ação não pode ser desfeita.`)
    ) {
      return;
    }
    setExcluindoProduto(true);
    setErroExcluirProduto(null);
    try {
      await onExcluirProduto(grupo.nome);
    } catch (error) {
      setErroExcluirProduto(mensagemErro(error, "Não consegui excluir o produto."));
    } finally {
      setExcluindoProduto(false);
    }
  }, [grupo.gavetas.length, grupo.noCatalogo, grupo.nome, grupo.total, onExcluirProduto]);

  const enviarFoto = useCallback(
    async (arquivo: File) => {
      if (!arquivo.type.startsWith("image/")) {
        setErroFoto("Escolha um arquivo de imagem.");
        return;
      }
      setEnviandoFoto(true);
      setErroFoto(null);
      setAvisoFoto(null);
      try {
        const fotoDataUri = await comprimirFoto(arquivo);
        const resposta = await fetch(`${API_URL}/api/estoque/produtos/fotos/trocar`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nome: grupo.nome, fotoDataUri }),
        });
        const json = await resposta.json();
        if (!resposta.ok) throw new Error(json.error ?? "Não consegui trocar a foto.");
        setAvisoFoto("Foto atualizada.");
        onFotoAlterada();
      } catch (error) {
        setErroFoto(mensagemErro(error, "Não consegui trocar a foto."));
      } finally {
        setEnviandoFoto(false);
      }
    },
    [grupo.nome, onFotoAlterada],
  );

  const trocarFoto = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const arquivo = event.target.files?.[0];
      event.target.value = ""; // permite escolher o mesmo arquivo de novo
      if (arquivo) void enviarFoto(arquivo);
    },
    [enviarFoto],
  );

  const soltarFoto = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setArrastandoFoto(false);
      const arquivo = event.dataTransfer.files[0];
      if (arquivo) void enviarFoto(arquivo);
    },
    [enviarFoto],
  );

  const origemFoto =
    grupo.info?.fotoUrl
      ? grupo.info.fotoOrigem === "manual"
        ? "enviada manualmente"
        : "já cadastrada"
      : "sem foto cadastrada";

  return (
    <div className="settings-overlay" onClick={onFechar}>
      <div ref={painelRef} className="settings-panel settings-panel--largo" role="dialog" aria-modal="true" aria-labelledby="estoque-produto-detalhe-titulo" tabIndex={-1} onClick={(event) => event.stopPropagation()}>
        <div className="settings-panel-header produto-detalhe-cabecalho">
          <button className="settings-close" onClick={onFechar} aria-label="Fechar">
            ×
          </button>
          <div className="produto-detalhe-foto-coluna">
            <div
              className={`produto-foto-upload${!grupo.info?.fotoUrl ? " produto-foto-upload--sem-foto" : ""}${arrastandoFoto ? " produto-foto-upload--arrastando" : ""}${enviandoFoto ? " produto-foto-upload--enviando" : ""}`}
              onDragEnter={(event) => {
                event.preventDefault();
                setArrastandoFoto(true);
              }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setArrastandoFoto(false);
              }}
              onDrop={soltarFoto}
              aria-busy={enviandoFoto}
            >
              <FotoProduto info={grupo.info} nome={grupo.nome} className="produto-detalhe-foto" />
              {!grupo.info?.fotoUrl && (
                <span className="produto-foto-upload-instrucao">
                  {enviandoFoto ? "Enviando foto…" : arrastandoFoto ? "Solte a foto aqui" : "Arraste uma foto ou"}
                </span>
              )}
            </div>
            <input ref={inputFotoRef} type="file" accept="image/*" onChange={(event) => void trocarFoto(event)} hidden />
            <button type="button" className="link-acao" onClick={() => inputFotoRef.current?.click()} disabled={enviandoFoto}>
              {enviandoFoto ? "Enviando…" : grupo.info?.fotoUrl ? "Trocar foto" : "Escolher foto"}
            </button>
          </div>
          <div className="produto-detalhe-texto">
            <h2 id="estoque-produto-detalhe-titulo" className="settings-title">{grupo.nome}</h2>
            <p className="produto-detalhe-total tabular">{grupo.total} un.</p>
            <p className="settings-hint">
              {grupo.gavetas.length === 0
                ? "Não está em nenhuma gaveta."
                : `Em ${grupo.gavetas.length} gaveta(s)${grupo.porVoltagem.length > 0 ? " · " + grupo.porVoltagem.map((v) => `${v.voltagem}: ${v.quantidade}`).join(" · ") : ""}`}
            </p>
            <p className="settings-hint">Foto: {origemFoto}</p>
            {podeSepararPorVoltagem(grupo) && (
              <p className="aviso-separar">
                Esse produto está sem a voltagem no nome.{" "}
                <button type="button" className="link-acao" onClick={() => onSepararVoltagem(grupo)}>
                  Separar por voltagem
                </button>
              </p>
            )}
            {avisoFoto && <p className="aviso-sucesso">{avisoFoto}</p>}
            {erroFoto && <p className="error-banner">{erroFoto}</p>}
          </div>
        </div>
        <div className="settings-panel-body">
          {grupo.gavetas.length > 0 && (
            <div className="tabela-wrap tabela-wrap--plana">
              <table className="tabela tabela--clicavel">
                <thead>
                  <tr>
                    <th>Rua</th>
                    <th>Gaveta</th>
                    <th>Voltagem</th>
                    <th className="tabela-num">Qtd</th>
                    <th>Contado por</th>
                    <th>Atualizado</th>
                  </tr>
                </thead>
                <tbody>
                  {grupo.gavetas.map((l) => (
                    <tr
                      key={`${l.rua}::${l.codigo}`}
                      tabIndex={0}
                      onClick={() => onAbrirGaveta(l)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          onAbrirGaveta(l);
                        }
                      }}
                      aria-label={`Contar a gaveta ${l.codigo}`}
                    >
                      <td>{l.rua}</td>
                      <td>
                        <strong>{l.codigo}</strong>
                      </td>
                      <td>{l.voltagem ?? "—"}</td>
                      <td className="tabela-num tabular">{l.ultima.quantidade}</td>
                      <td>{l.ultima.responsavel}</td>
                      <td className="tabular">{formatarDataHora(l.ultima.criadoEm)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="field-value--muted">Clique numa gaveta pra fazer uma nova contagem (com foto) ou corrigir produto/voltagem.</p>
        </div>
        <div className="settings-panel-footer">
          {erroExcluirProduto && <p className="error-banner" role="alert">{erroExcluirProduto}</p>}
          <button type="button" className="btn-primario" onClick={() => onNovaGaveta(grupo.nome)}>
            + Colocar em outra gaveta
          </button>
          {grupo.noCatalogo && grupo.total === 0 && grupo.gavetas.length === 0 && (
            <button type="button" className="btn-perigo-texto" onClick={() => void excluirProduto()} disabled={excluindoProduto}>
              {excluindoProduto ? "Excluindo..." : "Excluir produto"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Produto cadastrado sem a voltagem no nome, mas com gavetas que já têm voltagem — dá pra separar. */
function podeSepararPorVoltagem(g: GrupoProduto): boolean {
  return voltagemDoNome(g.nome) === null && g.gavetas.some((l) => l.voltagem);
}

/** Prévia + confirmação do "Separar por voltagem" (um produto, ou todos nessa situação). */
function ModalSepararVoltagem({
  grupos,
  todos,
  onFechar,
  onConcluido,
}: {
  grupos: GrupoProduto[];
  todos: boolean;
  onFechar: () => void;
  onConcluido: (mensagem: string) => void;
}) {
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const painelRef = useDialogAccessibility(onFechar);

  const confirmar = useCallback(async () => {
    setEnviando(true);
    setErro(null);
    try {
      const resposta = await fetch(`${API_URL}/api/estoque/produtos/dividir-voltagem`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nomes: todos ? [] : grupos.map((g) => g.nome) }),
      });
      const json = await resposta.json();
      if (!resposta.ok) throw new Error(json.error ?? "Não consegui separar.");
      const novos = (json.divisoes ?? []).reduce((s: number, d: { novos: string[] }) => s + d.novos.length, 0);
      onConcluido(`${novos} produto(s) criado(s), ${json.gavetasAtualizadas} gaveta(s) atualizada(s)`);
    } catch (error) {
      setErro(mensagemErro(error, "Não consegui separar."));
    } finally {
      setEnviando(false);
    }
  }, [grupos, todos, onConcluido]);

  return (
    <div className="settings-overlay" onClick={onFechar}>
      <div ref={painelRef} className="settings-panel settings-panel--largo" role="dialog" aria-modal="true" aria-labelledby="estoque-separar-voltagem-titulo" tabIndex={-1} onClick={(event) => event.stopPropagation()}>
        <div className="settings-panel-header">
          <button className="settings-close" onClick={onFechar} aria-label="Fechar">
            ×
          </button>
          <h2 id="estoque-separar-voltagem-titulo" className="settings-title">Separar por voltagem</h2>
          <p className="settings-hint">
            Cada voltagem vira um produto próprio, e cada gaveta passa pro produto da voltagem dela. Contagens, fotos e histórico das gavetas não
            mudam. A foto do produto é copiada pros novos (dá pra trocar depois).
          </p>
        </div>
        <div className="settings-panel-body">
          {grupos.map((g) => {
            const porVoltagem = new Map<string, PosicaoResumo[]>();
            for (const l of g.gavetas) if (l.voltagem) porVoltagem.set(l.voltagem, [...(porVoltagem.get(l.voltagem) ?? []), l]);
            const semVoltagem = g.gavetas.filter((l) => !l.voltagem);
            return (
              <div key={g.chave} className="separar-produto">
                <p className="separar-original">{g.nome}</p>
                <ul className="separar-lista">
                  {[...porVoltagem.entries()].map(([voltagem, ls]) => (
                    <li key={voltagem}>
                      <span className="separar-seta" aria-hidden="true">
                        →
                      </span>
                      <strong>
                        {g.nome} {voltagem}
                      </strong>
                      <span className="produto-card-locais">
                        {ls.map((l) => (
                          <span key={`${l.rua}::${l.codigo}`} className="local-chip">
                            {l.codigo}
                            <span className="local-chip-qtd tabular">{l.ultima.quantidade}</span>
                          </span>
                        ))}
                      </span>
                    </li>
                  ))}
                  {semVoltagem.length > 0 && (
                    <li className="field-value--muted">Sem voltagem, ficam em "{g.nome}": {semVoltagem.map((l) => l.codigo).join(", ")}</li>
                  )}
                </ul>
              </div>
            );
          })}
        </div>
        <div className="settings-panel-footer">
          {erro && <p className="error-banner">{erro}</p>}
          <button type="button" className="btn-primario" onClick={() => void confirmar()} disabled={enviando}>
            {enviando ? "Separando..." : grupos.length > 1 ? `Separar ${grupos.length} produtos` : "Separar"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ModalLongarinas({
  ruas,
  onFechar,
  onCriar,
  onRenomear,
  onExcluir,
}: {
  ruas: RuaResumo[];
  onFechar: () => void;
  onCriar: (nome: string) => Promise<void>;
  onRenomear: (atual: string, novo: string) => Promise<void>;
  onExcluir: (rua: string) => void;
}) {
  const [novaLongarina, setNovaLongarina] = useState("");
  const [editando, setEditando] = useState<string | null>(null);
  const [nomeEditado, setNomeEditado] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [alterado, setAlterado] = useState(false);
  const solicitarFechamento = useCallback(() => {
    if (alterado && !window.confirm("Descartar as alterações da longarina?")) return;
    onFechar();
  }, [alterado, onFechar]);
  const painelRef = useDialogAccessibility(solicitarFechamento);

  const criar = async (event: FormEvent) => {
    event.preventDefault();
    setSalvando(true);
    setErro(null);
    try {
      await onCriar(novaLongarina);
      setNovaLongarina("");
      setAlterado(false);
    } catch (error) {
      setErro(mensagemErro(error, "Não consegui criar a longarina."));
    } finally {
      setSalvando(false);
    }
  };

  const renomear = async (event: FormEvent) => {
    event.preventDefault();
    if (!editando) return;
    setSalvando(true);
    setErro(null);
    try {
      await onRenomear(editando, nomeEditado);
      setEditando(null);
      setNomeEditado("");
      setAlterado(false);
    } catch (error) {
      setErro(mensagemErro(error, "Não consegui renomear a longarina."));
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="settings-overlay" onClick={solicitarFechamento}>
      <div ref={painelRef} className="settings-panel" role="dialog" aria-modal="true" aria-labelledby="estoque-longarinas-titulo" tabIndex={-1} onClick={(event) => event.stopPropagation()} onChangeCapture={() => setAlterado(true)}>
        <div className="settings-panel-header">
          <button className="settings-close" onClick={solicitarFechamento} aria-label="Fechar">
            ×
          </button>
          <h2 id="estoque-longarinas-titulo" className="settings-title">Gerenciar longarinas</h2>
          <p className="settings-hint">Crie longarinas vazias ou renomeie uma existente. Ao renomear, as gavetas e seus históricos são preservados.</p>
        </div>
        <div className="settings-panel-body">
          <form className="estoque-longarina-form" onSubmit={(event) => void criar(event)}>
            <label className="field">
              <span className="field-label">Nova longarina</span>
              <input
                className="field-input"
                value={novaLongarina}
                onChange={(event) => setNovaLongarina(event.target.value.toUpperCase().replace(/[^A-Z]/g, ""))}
                placeholder="Ex.: F"
                aria-label="Nome da nova longarina"
              />
            </label>
            <button type="submit" className="btn-primario" disabled={salvando || !novaLongarina.trim()}>
              Criar
            </button>
          </form>
          {erro && <p className="error-banner" role="alert">{erro}</p>}
          {ruas.length === 0 ? (
            <p className="field-value--muted">Nenhuma longarina cadastrada ainda.</p>
          ) : (
            <ul className="estoque-lista-produtos">
              {ruas.map((r) => (
                <li key={r.rua}>
                  {editando === r.rua ? (
                    <form className="estoque-longarina-editar" onSubmit={(event) => void renomear(event)}>
                      <label className="field">
                        <span className="field-label">Novo nome da longarina</span>
                        <input
                          className="field-input"
                          value={nomeEditado}
                          onChange={(event) => setNomeEditado(event.target.value.toUpperCase().replace(/[^A-Z]/g, ""))}
                          aria-label={`Novo nome da longarina ${r.rua}`}
                          autoFocus
                        />
                      </label>
                      <button type="submit" className="btn-primario" disabled={salvando || !nomeEditado.trim()}>
                        Salvar
                      </button>
                      <button type="button" className="refresh-btn" disabled={salvando} onClick={() => setEditando(null)}>
                        Cancelar
                      </button>
                    </form>
                  ) : (
                    <>
                      <span>
                        <strong>Longarina {r.rua}</strong>
                        <span className="field-value--muted">
                          {" "}
                          · {r.posicoes.length} gaveta(s) · {r.posicoes.reduce((s, p) => s + p.ultima.quantidade, 0)} un.
                        </span>
                      </span>
                      <span className="estoque-longarina-acoes">
                        <button
                          type="button"
                          className="refresh-btn"
                          onClick={() => {
                            setErro(null);
                            setEditando(r.rua);
                            setNomeEditado(r.rua);
                          }}
                        >
                          Renomear
                        </button>
                        <button type="button" className="btn-perigo-texto" onClick={() => onExcluir(r.rua)}>
                          Excluir
                        </button>
                      </span>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function ModalConfiguracaoAlerta({
  limiteAtual,
  onFechar,
  onSalvar,
}: {
  limiteAtual: number;
  onFechar: () => void;
  onSalvar: (limite: number) => Promise<void>;
}) {
  const [limite, setLimite] = useState(String(limiteAtual));
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [alterado, setAlterado] = useState(false);
  const solicitarFechamento = useCallback(() => {
    if (alterado && !window.confirm("Descartar a alteração do limite de estoque?")) return;
    onFechar();
  }, [alterado, onFechar]);
  const painelRef = useDialogAccessibility(solicitarFechamento);

  const salvar = async (event: FormEvent) => {
    event.preventDefault();
    const valor = Number(limite);
    if (!limite.trim() || !Number.isSafeInteger(valor) || valor < 0) {
      setErro("Informe um número inteiro igual ou maior que zero.");
      return;
    }
    setSalvando(true);
    setErro(null);
    try {
      await onSalvar(valor);
      onFechar();
    } catch (error) {
      setErro(mensagemErro(error, "Não consegui salvar o limite."));
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="settings-overlay" onClick={solicitarFechamento}>
      <div ref={painelRef} className="settings-panel" role="dialog" aria-modal="true" aria-labelledby="estoque-config-alerta-titulo" tabIndex={-1} onClick={(event) => event.stopPropagation()} onChangeCapture={() => setAlterado(true)}>
        <div className="settings-panel-header">
          <button className="settings-close" onClick={solicitarFechamento} aria-label="Fechar configuração">
            ×
          </button>
          <h2 id="estoque-config-alerta-titulo" className="settings-title">Configuração geral do estoque</h2>
          <p className="settings-hint">Este limite vale para todos os produtos e fica salvo para todos os aparelhos.</p>
        </div>
        <form onSubmit={(event) => void salvar(event)}>
          <div className="settings-panel-body">
            <label className="field">
              <span className="field-label">Alertar quando o estoque chegar a (unidades)</span>
              <input
                className="field-input"
                type="number"
                min={0}
                step={1}
                inputMode="numeric"
                value={limite}
                onChange={(event) => setLimite(event.target.value)}
                autoFocus
              />
              <span className="field-value--muted">
                Produtos com até esse número de unidades recebem um alerta vermelho. Com 0, o alerta aparece apenas para produtos sem estoque.
              </span>
            </label>
          </div>
          <div className="settings-panel-footer">
            {erro && <p className="error-banner" role="alert">{erro}</p>}
            <button type="submit" className="btn-primario" disabled={salvando}>
              {salvando ? "Salvando..." : "Salvar limite"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ModalEscolherContagem({
  posicoes,
  onEscolher,
  onNovaGaveta,
  onFechar,
}: {
  posicoes: PosicaoResumo[];
  onEscolher: (posicao: PosicaoResumo) => void;
  onNovaGaveta: () => void;
  onFechar: () => void;
}) {
  const [buscaLocal, setBuscaLocal] = useState("");
  const painelRef = useDialogAccessibility(onFechar);
  const buscaNormalizada = normalizar(buscaLocal.trim());
  const posicoesFiltradas = [...posicoes]
    .filter((posicao) =>
      !buscaNormalizada ||
      normalizar(`${posicao.rua} ${posicao.codigo} ${posicao.produto ?? ""} ${posicao.voltagem ?? ""}`).includes(buscaNormalizada),
    )
    .sort(ordenarGavetas);

  return (
    <div className="settings-overlay" onClick={onFechar}>
      <div
        ref={painelRef}
        className="settings-panel estoque-escolher-contagem"
        role="dialog"
        aria-modal="true"
        aria-labelledby="estoque-escolher-contagem-titulo"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="settings-panel-header">
          <button className="settings-close" onClick={onFechar} aria-label="Fechar">×</button>
          <h2 id="estoque-escolher-contagem-titulo" className="settings-title">Nova contagem</h2>
          <p className="settings-hint">Escolha uma gaveta para recontar ou crie uma nova.</p>
        </div>
        <div className="settings-panel-body">
          <label className="field">
            <span className="field-label">Buscar gaveta, produto ou longarina</span>
            <input
              className="field-input"
              type="search"
              placeholder="Ex.: F3 ou chaleira"
              value={buscaLocal}
              onChange={(event) => setBuscaLocal(event.target.value)}
              autoFocus
            />
          </label>
          {posicoesFiltradas.length > 0 ? (
            <ul className="estoque-escolher-contagem-lista">
              {posicoesFiltradas.map((posicao) => (
                <li key={`${posicao.rua}::${posicao.codigo}`}>
                  <button type="button" className="estoque-escolher-contagem-item" onClick={() => onEscolher(posicao)}>
                    <strong>{posicao.codigo}</strong>
                    <span>{posicao.produto ?? "Gaveta sem produto"}{posicao.voltagem ? ` · ${posicao.voltagem}` : ""}</span>
                    <span className="tabular">{posicao.ultima.quantidade} un.</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="estado-vazio-titulo">
              {posicoes.length === 0 ? "Ainda não há gavetas cadastradas." : "Nenhuma gaveta corresponde à busca."}
            </p>
          )}
        </div>
        <div className="settings-panel-footer">
          <button type="button" className="btn-primario" onClick={onNovaGaveta}>Criar gaveta nova</button>
        </div>
      </div>
    </div>
  );
}

export function Estoque() {
  const [ruas, setRuas] = useState<RuaResumo[]>([]);
  const [produtos, setProdutos] = useState<string[]>([]);
  const [info, setInfo] = useState<Record<string, InfoProduto>>({});
  const [unidadesPorCaixa, setUnidadesPorCaixa] = useState<Record<string, number>>({});
  const [erroUnidadesPorCaixa, setErroUnidadesPorCaixa] = useState<string | null>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [movimentacao, setMovimentacao] = useState<PosicaoResumo | null>(null);
  const [mostrarEscolhaContagem, setMostrarEscolhaContagem] = useState(false);
  const [carregou, setCarregou] = useState(false);
  const [erroCarregamento, setErroCarregamento] = useState<string | null>(null);
  const [responsaveisCadastrados, setResponsaveisCadastrados] = useState<string[]>([]);
  const [erroResponsaveis, setErroResponsaveis] = useState<string | null>(null);
  const [carregandoResponsaveis, setCarregandoResponsaveis] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [ultimaGavetaSalva, setUltimaGavetaSalva] = useState<{ rua: string; codigo: string } | null>(null);

  const [filtrosIniciais] = useState(lerFiltrosEstoqueDaUrl);
  const [mostrarModalProdutos, setMostrarModalProdutos] = useState(false);
  const [mostrarRuas, setMostrarRuas] = useState(false);
  const [mostrarConfiguracaoAlerta, setMostrarConfiguracaoAlerta] = useState(false);
  const [limiteEstoqueBaixo, setLimiteEstoqueBaixo] = useState<number | null>(null);
  const [erroConfiguracaoAlerta, setErroConfiguracaoAlerta] = useState<string | null>(null);
  const [produtoAberto, setProdutoAberto] = useState<string | null>(null);
  const [visaoEstoque, setVisaoEstoque] = useState<VisaoEstoque>(filtrosIniciais.visaoEstoque);

  const [busca, setBusca] = useState(filtrosIniciais.busca);
  const [filtroVoltagem, setFiltroVoltagem] = useState(filtrosIniciais.filtroVoltagem);
  const [ordem, setOrdem] = useState<Ordem>(filtrosIniciais.ordem);
  const [soComEstoque, setSoComEstoque] = useState(filtrosIniciais.soComEstoque);
  // "Separar por voltagem" aberto: um produto (do detalhe) ou todos os que estão nessa situação.
  const [separando, setSeparando] = useState<{ grupos: GrupoProduto[]; todos: boolean } | null>(null);

  // Excluir longarina vazia: confirmar digitando o nome da rua.
  const [excluindoRua, setExcluindoRua] = useState<string | null>(null);
  const [confirmacaoRua, setConfirmacaoRua] = useState("");
  const [erroExcluirRua, setErroExcluirRua] = useState<string | null>(null);
  const [excluindo, setExcluindo] = useState(false);

  const mostrarToast = useCallback((texto: string) => {
    setToast(texto);
    setTimeout(() => setToast(null), TOAST_MS);
  }, []);

  const carregar = useCallback(async () => {
    try {
      const resposta = await fetch(`${API_URL}/api/estoque`, { cache: "no-store" });
      const json = await resposta.json();
      if (!resposta.ok) throw new Error(json.error ?? "Não consegui carregar o estoque.");
      setRuas(json.ruas ?? []);
      setErroCarregamento(null);
    } catch (error) {
      setErroCarregamento(mensagemErro(error, "Não consegui carregar o estoque."));
    } finally {
      setCarregou(true);
    }
  }, []);

  const carregarResponsaveis = useCallback(async () => {
    setCarregandoResponsaveis(true);
    try {
      const resposta = await fetch(`${API_URL}/api/embalagem/colaboradores`, { cache: "no-store" });
      const json = await resposta.json();
      if (!resposta.ok) throw new Error(json.erro ?? "Não consegui carregar a lista de colaboradores.");
      if (!Array.isArray(json.colaboradores)) throw new Error("O servidor retornou uma lista de colaboradores inválida.");
      const colaboradores: unknown[] = json.colaboradores;
      const nomes = colaboradores.flatMap((valor): string[] => {
        if (typeof valor !== "object" || valor === null || !("nome" in valor) || typeof valor.nome !== "string") return [];
        const nome = valor.nome.trim();
        return nome ? [nome] : [];
      });
      setResponsaveisCadastrados([...new Set(nomes)]);
      setErroResponsaveis(null);
    } catch (error) {
      setErroResponsaveis(mensagemErro(error, "Não consegui carregar a lista de colaboradores."));
    } finally {
      setCarregandoResponsaveis(false);
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const definirParametro = (chave: string, valor: string, padrao: string) => {
      if (valor === padrao) params.delete(chave);
      else params.set(chave, valor);
    };
    definirParametro("estoqueBusca", busca, "");
    definirParametro("estoqueVoltagem", filtroVoltagem, "");
    definirParametro("estoqueOrdem", ordem, "nome");
    definirParametro("estoqueSoComEstoque", soComEstoque ? "1" : "0", "1");
    definirParametro("estoqueVisao", visaoEstoque, "produtos");
    const query = params.toString();
    const url = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
    window.history.replaceState(window.history.state, "", url);
  }, [busca, filtroVoltagem, ordem, soComEstoque, visaoEstoque]);

  useEffect(() => {
    const restaurarFiltros = () => {
      const filtros = lerFiltrosEstoqueDaUrl();
      setBusca(filtros.busca);
      setFiltroVoltagem(filtros.filtroVoltagem);
      setOrdem(filtros.ordem);
      setSoComEstoque(filtros.soComEstoque);
      setVisaoEstoque(filtros.visaoEstoque);
    };
    window.addEventListener("popstate", restaurarFiltros);
    return () => window.removeEventListener("popstate", restaurarFiltros);
  }, []);

  const criarLongarina = useCallback(
    async (nome: string) => {
      const resposta = await fetch(`${API_URL}/api/estoque/longarinas`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome }),
      });
      const json = await resposta.json();
      if (!resposta.ok) throw new Error(json.error ?? "Não consegui criar a longarina.");
      await carregar();
      mostrarToast(`Longarina ${json.longarina} criada`);
    },
    [carregar, mostrarToast],
  );

  const renomearLongarina = useCallback(
    async (atual: string, novo: string) => {
      const resposta = await fetch(`${API_URL}/api/estoque/longarinas/${encodeURIComponent(atual)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome: novo }),
      });
      const json = await resposta.json();
      if (!resposta.ok) throw new Error(json.error ?? "Não consegui renomear a longarina.");
      await carregar();
      mostrarToast(`Longarina ${atual} renomeada para ${json.longarina}`);
    },
    [carregar, mostrarToast],
  );

  const carregarProdutos = useCallback(async () => {
    try {
      const resposta = await fetch(`${API_URL}/api/estoque/produtos`, { cache: "no-store" });
      const json = await resposta.json();
      if (!resposta.ok) throw new Error(json.error ?? "Não consegui carregar o cadastro de produtos.");
      const configuracoes: unknown = json.unidadesPorCaixa ?? {};
      if (!isUnidadesPorCaixa(configuracoes)) throw new Error("O servidor retornou configurações de embalagem inválidas.");
      setProdutos(json.produtos ?? []);
      setInfo(json.info ?? {});
      setUnidadesPorCaixa(configuracoes);
      setErroUnidadesPorCaixa(null);
    } catch (error) {
      // Catálogo, fotos e embalagens não travam a tela — os cards aparecem a partir das gavetas.
      setErroUnidadesPorCaixa(mensagemErro(error, "Não consegui carregar a configuração de embalagem."));
    }
  }, []);

  const excluirProdutoDoCatalogo = useCallback(
    async (nome: string) => {
      const resposta = await fetch(`${API_URL}/api/estoque/produtos/${encodeURIComponent(nome)}`, { method: "DELETE" });
      if (!resposta.ok) {
        const json = await resposta.json();
        throw new Error(json.error ?? "Não consegui excluir o produto.");
      }
      setProdutos((atuais) => atuais.filter((produto) => produto.toLowerCase() !== nome.toLowerCase()));
      setProdutoAberto(null);
      void carregarProdutos();
      mostrarToast(`Produto "${nome}" excluído do catálogo`);
    },
    [carregarProdutos, mostrarToast],
  );

  const salvarUnidadesPorCaixa = useCallback(async (produto: string, unidades: number | null) => {
    const resposta = await fetch(`${API_URL}/api/estoque/produtos/embalagens`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ produto, unidadesPorCaixa: unidades }),
    });
    const json = await resposta.json();
    if (!resposta.ok) throw new Error(json.error ?? "Não consegui salvar a quantidade por caixa.");
    if (!isUnidadesPorCaixa(json.unidadesPorCaixa)) throw new Error("O servidor retornou configurações de embalagem inválidas.");
    setUnidadesPorCaixa(json.unidadesPorCaixa);
    setErroUnidadesPorCaixa(null);
  }, []);

  const carregarConfiguracaoAlerta = useCallback(async () => {
    try {
      const resposta = await fetch(`${API_URL}/api/estoque/configuracao-alerta`, { cache: "no-store" });
      const json = await resposta.json();
      if (!resposta.ok) throw new Error(json.error ?? "Não consegui carregar o limite de estoque baixo.");
      if (typeof json.limiteEstoqueBaixo !== "number" || !Number.isSafeInteger(json.limiteEstoqueBaixo) || json.limiteEstoqueBaixo < 0) {
        throw new Error("O servidor retornou um limite de estoque inválido.");
      }
      setLimiteEstoqueBaixo(json.limiteEstoqueBaixo);
      setErroConfiguracaoAlerta(null);
    } catch (error) {
      setErroConfiguracaoAlerta(mensagemErro(error, "Não consegui carregar o limite de estoque baixo."));
    }
  }, []);

  const salvarConfiguracaoAlerta = useCallback(async (limite: number) => {
    const resposta = await fetch(`${API_URL}/api/estoque/configuracao-alerta`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ limiteEstoqueBaixo: limite }),
    });
    const json = await resposta.json();
    if (!resposta.ok) throw new Error(json.error ?? "Não consegui salvar o limite de estoque baixo.");
    setLimiteEstoqueBaixo(json.limiteEstoqueBaixo);
    setErroConfiguracaoAlerta(null);
  }, []);

  useEffect(() => {
    const kickoff = setTimeout(() => {
      void carregar();
      void carregarProdutos();
      void carregarConfiguracaoAlerta();
      void carregarResponsaveis();
    }, 0);
    const id = setInterval(() => {
      void carregar();
      void carregarProdutos(); // as fotos chegam aos poucos, em segundo plano
      void carregarResponsaveis();
    }, POLL_MS);
    return () => {
      clearTimeout(kickoff);
      clearInterval(id);
    };
  }, [carregar, carregarProdutos, carregarConfiguracaoAlerta, carregarResponsaveis]);

  const todasAsGavetas = useMemo(() => ruas.flatMap((r) => r.posicoes), [ruas]);
  const responsaveisEstoque = useMemo(
    () => [...responsaveisCadastrados].sort((a, b) => a.localeCompare(b, "pt-BR")),
    [responsaveisCadastrados],
  );
  const mensagemListaResponsaveis =
    erroResponsaveis ?? (carregandoResponsaveis ? "Carregando a lista de pessoas..." : "Cadastre colaboradores no módulo Embalagem para registrar contagens.");
  const gavetasVazias = todasAsGavetas.filter((p) => !p.produto).sort(ordenarGavetas);

  const grupos = useMemo<GrupoProduto[]>(() => {
    const mapa = new Map<string, GrupoProduto>();
    const garantir = (nome: string, noCatalogo: boolean) => {
      const chave = chaveDoProduto(nome);
      const existente = mapa.get(chave);
      if (existente) {
        if (noCatalogo) existente.noCatalogo = true;
        return existente;
      }
      const novo: GrupoProduto = { chave, nome, noCatalogo, info: info[chave], total: 0, gavetas: [], porVoltagem: [], ultimaContagem: null };
      mapa.set(chave, novo);
      return novo;
    };
    for (const nome of produtos) garantir(nome, true);
    for (const p of todasAsGavetas) {
      if (!p.produto) continue;
      const grupo = garantir(p.produto, false);
      grupo.gavetas.push(p);
      grupo.total += p.ultima.quantidade;
      if (!grupo.ultimaContagem || p.ultima.criadoEm > grupo.ultimaContagem) grupo.ultimaContagem = p.ultima.criadoEm;
    }
    for (const grupo of mapa.values()) {
      grupo.gavetas.sort(ordenarGavetas);
      const porVoltagem = new Map<string, number>();
      for (const l of grupo.gavetas) if (l.voltagem) porVoltagem.set(l.voltagem, (porVoltagem.get(l.voltagem) ?? 0) + l.ultima.quantidade);
      grupo.porVoltagem = [...porVoltagem.entries()].map(([voltagem, quantidade]) => ({ voltagem, quantidade }));
    }
    return [...mapa.values()];
  }, [produtos, todasAsGavetas, info]);

  const termo = normalizar(busca.trim());
  const termosBusca = termo.split(/\s+/).filter(Boolean);
  const bateTermos = (texto: string) => termosBusca.every((termoAtual) => termoBateTexto(termoAtual, texto));

  const gruposExibidos = grupos
    .filter((g) => !soComEstoque || g.total > 0)
    .filter((g) => !filtroVoltagem || voltagemDoNome(g.nome) === filtroVoltagem || g.gavetas.some((l) => l.voltagem === filtroVoltagem || (l.produto && voltagemDoNome(l.produto) === filtroVoltagem)))
    .filter((g) => !termo || bateTermos(g.nome) || g.gavetas.some((l) => bateTermos(`${l.codigo} rua ${l.rua} ${l.rua}${l.codigo}`)))
    .sort((a, b) => (ordem === "unidades" ? b.total - a.total : 0) || a.nome.localeCompare(b.nome, "pt-BR"));

  const longarinasExibidas = ruas
    .map((rua) => {
      const termoBateRua = Boolean(termo && bateTermos(`rua ${rua.rua}`));
      const posicoes = rua.posicoes
        .filter(
          (posicao) =>
            (!soComEstoque || posicao.ultima.quantidade > 0) &&
            (!filtroVoltagem || posicao.voltagem === filtroVoltagem || (posicao.produto && voltagemDoNome(posicao.produto) === filtroVoltagem)) &&
            (!termo || termoBateRua || bateTermos(`${posicao.codigo} ${posicao.produto ?? ""} rua ${posicao.rua}`)),
        )
        .sort(ordenarGavetas);
      return { ...rua, posicoes };
    })
    .filter((rua) => rua.posicoes.length > 0)
    .sort((a, b) => {
      const totalA = a.posicoes.reduce((soma, posicao) => soma + posicao.ultima.quantidade, 0);
      const totalB = b.posicoes.reduce((soma, posicao) => soma + posicao.ultima.quantidade, 0);
      return (ordem === "unidades" ? totalB - totalA : 0) || a.rua.localeCompare(b.rua, "pt-BR");
    });

  const totalUnidades = todasAsGavetas.reduce((s, p) => s + p.ultima.quantidade, 0);
  const ocupadas = todasAsGavetas.filter((p) => p.ultima.quantidade > 0).length;
  const grupoAberto = produtoAberto ? grupos.find((g) => g.chave === produtoAberto) ?? null : null;
  const paraSeparar = grupos.filter(podeSepararPorVoltagem);

  const codigosPorRua = useMemo(() => Object.fromEntries(ruas.map((r) => [r.rua, r.posicoes.map((p) => p.codigo)])), [ruas]);

  const abrirNovaGaveta = useCallback(
    (produtoInicial?: string) => {
      setProdutoAberto(null);
      setMovimentacao(null);
      const codigosUltimaRua = ultimaGavetaSalva ? codigosPorRua[ultimaGavetaSalva.rua] ?? [] : [];
      const codigosAtualizados = ultimaGavetaSalva
        ? {
            ...codigosPorRua,
            [ultimaGavetaSalva.rua]: codigosUltimaRua.includes(ultimaGavetaSalva.codigo)
              ? codigosUltimaRua
              : [...codigosUltimaRua, ultimaGavetaSalva.codigo],
          }
        : codigosPorRua;
      const ruaInicial =
        ultimaGavetaSalva && RUAS_DISPONIVEIS.some((rua) => rua === ultimaGavetaSalva.rua)
          ? ultimaGavetaSalva.rua
          : ruas.length === 1 && RUAS_DISPONIVEIS.some((rua) => rua === ruas[0].rua)
            ? ruas[0].rua
            : undefined;
      setModal({
        modo: "nova",
        ruasExistentes: ruas.map((r) => r.rua),
        codigosPorRua: codigosAtualizados,
        produtoInicial,
        ruaInicial,
      });
    },
    [ruas, codigosPorRua, ultimaGavetaSalva],
  );

  const abrirGaveta = useCallback((p: PosicaoResumo) => {
    setProdutoAberto(null);
    setMovimentacao(null);
    setModal({ modo: "existente", rua: p.rua, codigo: p.codigo, ultima: p.ultima, produto: p.produto, voltagem: p.voltagem });
  }, []);

  const abrirMovimentacao = useCallback((posicao: PosicaoResumo) => {
    setModal(null);
    setMovimentacao(posicao);
  }, []);

  const aoSalvar = useCallback(
    (rua: string, codigo: string) => {
      setUltimaGavetaSalva({ rua, codigo });
      setModal(null);
      void carregar();
      mostrarToast(`Gaveta ${codigo} salva`);
    },
    [carregar, mostrarToast],
  );

  const aoSalvarMetadados = useCallback(() => {
    setModal(null);
    void carregar();
  }, [carregar]);

  const aoExcluirGaveta = useCallback(
    (_rua: string, codigo: string) => {
      setModal(null);
      void carregar();
      mostrarToast(`Gaveta ${codigo} excluída`);
    },
    [carregar, mostrarToast],
  );

  const aoSalvarMovimentacao = useCallback(() => {
    setMovimentacao(null);
    void carregar();
    mostrarToast("Movimentação registrada");
  }, [carregar, mostrarToast]);

  const confirmarExclusaoRua = useCallback(async () => {
    if (!excluindoRua) return;
    setExcluindo(true);
    setErroExcluirRua(null);
    try {
      const resposta = await fetch(`${API_URL}/api/estoque/longarinas/${encodeURIComponent(excluindoRua)}`, { method: "DELETE" });
      const json = await resposta.json();
      if (!resposta.ok) throw new Error(json.error ?? "Não consegui excluir a longarina.");
      mostrarToast(`Longarina ${excluindoRua} excluída`);
      setExcluindoRua(null);
      setConfirmacaoRua("");
      void carregar();
    } catch (error) {
      setErroExcluirRua(mensagemErro(error, "Não consegui excluir a longarina."));
    } finally {
      setExcluindo(false);
    }
  }, [carregar, excluindoRua, mostrarToast]);

  const fecharExclusaoRua = useCallback(() => {
    if (confirmacaoRua.trim() && !window.confirm("Descartar a confirmação e cancelar a exclusão?")) return;
    setExcluindoRua(null);
    setConfirmacaoRua("");
  }, [confirmacaoRua]);

  const filtroAtivo = termo !== "" || filtroVoltagem !== "" || soComEstoque;

  return (
    <div className="page pagina-formulario estoque-pagina">
      <PageHeader titulo="Estoque" subtitulo="Onde está cada produto no galpão — rua e gaveta">
        <details className="estoque-mais-acoes">
          <summary className="refresh-btn">Mais ações</summary>
          <div className="estoque-mais-acoes-menu">
            <button type="button" className="refresh-btn" onClick={() => setMostrarModalProdutos(true)}>Produtos</button>
            <button
              type="button"
              className="refresh-btn"
              onClick={() => setMostrarConfiguracaoAlerta(true)}
              disabled={limiteEstoqueBaixo === null}
            >
              Configuração geral
            </button>
            <button type="button" className="refresh-btn" onClick={() => setMostrarRuas(true)}>Gerenciar longarinas</button>
          </div>
        </details>
        <button type="button" className="btn-primario estoque-nova-contagem-cta" onClick={() => setMostrarEscolhaContagem(true)}>
          Nova contagem
        </button>
      </PageHeader>

      {erroCarregamento && (
        <div role="alert">
          <p className="error-banner">{erroCarregamento}</p>
          <button type="button" className="refresh-btn" onClick={() => void carregar()}>
            Tentar de novo
          </button>
        </div>
      )}
      {erroConfiguracaoAlerta && <p className="error-banner" role="alert">{erroConfiguracaoAlerta}</p>}
      {erroUnidadesPorCaixa && <p className="error-banner" role="alert">{erroUnidadesPorCaixa} A contagem por caixa pode não estar disponível.</p>}

      <section className="resumo-grid" aria-label="Resumo do estoque">
        <CardResumo rotulo="Produtos" valor={grupos.length} detalhe={`${grupos.filter((g) => g.total > 0).length} com estoque`} tom="marca" />
        <CardResumo rotulo="Unidades no galpão" valor={totalUnidades} detalhe="soma da última contagem de cada gaveta" tom="ocupada" />
        <CardResumo rotulo="Gavetas ocupadas" valor={ocupadas} detalhe={`de ${todasAsGavetas.length} registradas em ${ruas.length} rua(s)`} tom="vazia" />
        <CardResumo rotulo="Gavetas vazias" valor={gavetasVazias.length} detalhe="sem produto" tom="baixo" />
      </section>

      <div className="abas" role="tablist" aria-label="Visualização do estoque">
        <button
          type="button"
          role="tab"
          aria-selected={visaoEstoque === "produtos"}
          className={`aba${visaoEstoque === "produtos" ? " aba--ativa" : ""}`}
          onClick={() => setVisaoEstoque("produtos")}
        >
          Por produtos
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={visaoEstoque === "longarinas"}
          className={`aba${visaoEstoque === "longarinas" ? " aba--ativa" : ""}`}
          onClick={() => setVisaoEstoque("longarinas")}
        >
          Por longarinas
        </button>
      </div>

      <div className="filtro-barra" role="search">
        <label className="filtro-busca">
          <IconeBusca className="filtro-busca-icone" />
          <input
            className="field-input"
            type="search"
            aria-label="Buscar produto ou gaveta"
            value={busca}
            onChange={(event) => setBusca(event.target.value)}
            placeholder="Buscar produto, rua ou gaveta (ex.: F3)"
          />
        </label>
        <select
          className="field-input"
          aria-label="Filtrar por voltagem"
          value={filtroVoltagem}
          onChange={(event) => {
            setFiltroVoltagem(event.target.value);
            if (event.target.value) setSoComEstoque(false);
          }}
        >
          <option value="">Todas as voltagens</option>
          {VOLTAGENS.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        <select className="field-input" aria-label="Ordenar" value={ordem} onChange={(event) => setOrdem(event.target.value as Ordem)}>
          <option value="nome">{visaoEstoque === "produtos" ? "Ordem: nome" : "Ordem: longarina"}</option>
          <option value="unidades">Ordem: mais unidades</option>
        </select>
        <label className="filtro-check">
          <input type="checkbox" checked={soComEstoque} onChange={(event) => setSoComEstoque(event.target.checked)} />
          Só com estoque
        </label>
        {visaoEstoque === "produtos" && (
          <button
            type="button"
            className="refresh-btn"
            onClick={() =>
              baixarCsv(`estoque-${new Date().toISOString().slice(0, 10)}.csv`, [
                ["Produto", "SKU", "Voltagem", "Unidades", "Gavetas", "Última contagem"],
                ...gruposExibidos.map((grupo) => [
                  grupo.nome,
                  grupo.info?.codigos?.join(", ") ?? "",
                  grupo.porVoltagem.map((item) => `${item.voltagem}: ${item.quantidade}`).join(" · ") || voltagemDoNome(grupo.nome) || "",
                  grupo.total,
                  grupo.gavetas.map((gaveta) => `${gaveta.codigo} (${gaveta.ultima.quantidade})`).join(", "),
                  grupo.ultimaContagem ? formatarDataHora(grupo.ultimaContagem) : "",
                ]),
              ])
            }
          >
            Exportar CSV
          </button>
        )}
      </div>

      {paraSeparar.length > 0 && (
        <div className="aviso-faixa" role="status">
          <span>
            <strong>{paraSeparar.length} produto(s)</strong> cadastrado(s) sem a voltagem no nome, com gavetas de voltagens diferentes. Agora cada
            voltagem é um produto próprio.
          </span>
          <button type="button" className="btn-primario" onClick={() => setSeparando({ grupos: paraSeparar, todos: true })}>
            Separar por voltagem
          </button>
        </div>
      )}

      {!carregou ? (
        <p className="nota-info">Carregando estoque…</p>
      ) : visaoEstoque === "produtos" && grupos.length === 0 ? (
        <div className="estado-vazio">
          <IconeGondola className="estado-vazio-icone" />
          <p className="estado-vazio-titulo">Nenhum produto cadastrado ainda.</p>
          <p className="field-value--muted">Cadastre os produtos e, se quiser, adicione uma foto manualmente no detalhe do produto.</p>
          <button type="button" className="btn-primario" onClick={() => setMostrarModalProdutos(true)}>
            + Adicionar produtos
          </button>
        </div>
      ) : visaoEstoque === "produtos" && gruposExibidos.length === 0 ? (
        <div className="estado-vazio estado-vazio--compacto">
          <p className="estado-vazio-titulo">Nenhum produto com esses filtros.</p>
          {filtroAtivo && (
            <button
              type="button"
              className="refresh-btn"
              onClick={() => {
                setBusca("");
                setFiltroVoltagem("");
                setSoComEstoque(false);
              }}
            >
              Limpar filtros
            </button>
          )}
        </div>
      ) : visaoEstoque === "longarinas" && longarinasExibidas.length === 0 ? (
        <div className="estado-vazio estado-vazio--compacto">
          <p className="estado-vazio-titulo">{ruas.length === 0 ? "Nenhuma longarina cadastrada ainda." : "Nenhuma gaveta com esses filtros."}</p>
          {ruas.length === 0 ? (
            <button type="button" className="btn-primario" onClick={() => abrirNovaGaveta()}>
              + Adicionar gaveta
            </button>
          ) : filtroAtivo ? (
            <button
              type="button"
              className="refresh-btn"
              onClick={() => {
                setBusca("");
                setFiltroVoltagem("");
                setSoComEstoque(false);
              }}
            >
              Limpar filtros
            </button>
          ) : null}
        </div>
      ) : visaoEstoque === "longarinas" ? (
        <div className="estoque-longarinas-grid">
          {longarinasExibidas.map((rua) => {
            const total = rua.posicoes.reduce((soma, posicao) => soma + posicao.ultima.quantidade, 0);
            const ocupadasNaRua = rua.posicoes.filter((posicao) => posicao.ultima.quantidade > 0).length;
            return (
              <section className="estoque-longarina" key={rua.rua}>
                <div className="estoque-longarina-cabecalho">
                  <h2>Longarina {rua.rua}</h2>
                  <span className="field-value--muted">
                    {total} un. · {ocupadasNaRua}/{rua.posicoes.length} gavetas ocupadas
                  </span>
                </div>
                <div className="estoque-longarina-posicoes">
                  {rua.posicoes.map((posicao) => (
                    <button
                      key={`${posicao.rua}::${posicao.codigo}`}
                      type="button"
                      className={`estoque-longarina-gaveta${posicao.ultima.quantidade === 0 ? " estoque-longarina-gaveta--vazia" : ""}`}
                      onClick={() => abrirGaveta(posicao)}
                      title={`Abrir gaveta ${posicao.codigo}`}
                    >
                      <img
                        className="estoque-longarina-foto"
                        src={posicao.ultima.fotoUrl}
                        alt={`Foto da gaveta ${posicao.codigo}`}
                        loading="lazy"
                        decoding="async"
                      />
                      <span className="estoque-longarina-gaveta-conteudo">
                        <strong>{posicao.codigo}</strong>
                        <span>{posicao.produto ?? "Gaveta vazia"}</span>
                        <span className="estoque-longarina-quantidade">{posicao.ultima.quantidade} un.</span>
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <div className="produtos-grid">
          {gruposExibidos.map((g) => {
            const baixo = limiteEstoqueBaixo !== null && g.total > 0 && g.total <= limiteEstoqueBaixo;
            return (
              <button key={g.chave} type="button" className={`produto-card${g.total === 0 ? " produto-card--sem-estoque" : ""}`} onClick={() => setProdutoAberto(g.chave)}>
                <FotoProduto info={g.info} nome={g.nome} className="produto-card-foto" />
                <span className="produto-card-corpo">
                  <span className="produto-card-nome">{g.nome}</span>
                  <span className="produto-card-linha">
                    <span className="produto-card-total tabular">{g.total} un.</span>
                    {g.total === 0 ? (
                      <span className="estado-chip estado-chip--vazia">Sem estoque</span>
                    ) : baixo ? (
                      <span className="estado-chip estado-chip--baixo">
                        <span className="alerta-estoque-ponto" aria-hidden="true" />
                        Estoque baixo
                      </span>
                    ) : null}
                  </span>
                  {(g.porVoltagem.length > 0 || voltagemDoNome(g.nome)) && (
                    <span className="produto-card-meta">
                      {g.porVoltagem.length > 0 ? g.porVoltagem.map((v) => `${v.voltagem}: ${v.quantidade}`).join(" · ") : voltagemDoNome(g.nome)}
                    </span>
                  )}
                  <span className="produto-card-meta">
                    {g.info?.codigos?.length ? `SKU: ${g.info.codigos.join(", ")}` : "SKU não vinculado"}
                    {g.ultimaContagem ? ` · última contagem ${formatarDataHora(g.ultimaContagem)}` : " · sem contagem"}
                  </span>
                  {g.gavetas.length === 0 ? (
                    <span className="produto-card-meta">Não está em nenhuma gaveta</span>
                  ) : (
                    <span className="produto-card-locais" aria-label="Onde está">
                      {g.gavetas.map((l) => (
                        <span key={`${l.rua}::${l.codigo}`} className="local-chip" title={`Rua ${l.rua} · gaveta ${l.codigo} · ${l.ultima.quantidade} un.`}>
                          {l.codigo}
                          <span className="local-chip-qtd tabular">{l.ultima.quantidade}</span>
                        </span>
                      ))}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {visaoEstoque === "produtos" && gavetasVazias.length > 0 && (
        <section className="painel-card">
          <h2 className="painel-card-titulo">Gavetas vazias ({gavetasVazias.length})</h2>
          <div className="produto-card-locais">
            {gavetasVazias.map((l) => (
              <button key={`${l.rua}::${l.codigo}`} type="button" className="local-chip local-chip--botao" onClick={() => abrirGaveta(l)} title={`Rua ${l.rua} · contar / colocar produto`}>
                {l.codigo}
              </button>
            ))}
          </div>
        </section>
      )}

      {grupoAberto && (
        <ModalProduto
          grupo={grupoAberto}
          onFechar={() => setProdutoAberto(null)}
          onAbrirGaveta={abrirGaveta}
          onNovaGaveta={abrirNovaGaveta}
          onFotoAlterada={() => void carregarProdutos()}
          onExcluirProduto={excluirProdutoDoCatalogo}
          onSepararVoltagem={(grupo) => setSeparando({ grupos: [grupo], todos: false })}
        />
      )}

      {separando && (
        <ModalSepararVoltagem
          grupos={separando.grupos}
          todos={separando.todos}
          onFechar={() => setSeparando(null)}
          onConcluido={(mensagem) => {
            setSeparando(null);
            setProdutoAberto(null);
            mostrarToast(mensagem);
            void carregar();
            void carregarProdutos();
          }}
        />
      )}

      {mostrarRuas && (
        <ModalLongarinas
          ruas={ruas}
          onFechar={() => setMostrarRuas(false)}
          onCriar={criarLongarina}
          onRenomear={renomearLongarina}
          onExcluir={(rua) => {
            setMostrarRuas(false);
            setExcluindoRua(rua);
            setConfirmacaoRua("");
            setErroExcluirRua(null);
          }}
        />
      )}

      {mostrarConfiguracaoAlerta && limiteEstoqueBaixo !== null && (
        <ModalConfiguracaoAlerta
          limiteAtual={limiteEstoqueBaixo}
          onFechar={() => setMostrarConfiguracaoAlerta(false)}
          onSalvar={salvarConfiguracaoAlerta}
        />
      )}

      {excluindoRua && (
        <div
          className="settings-overlay"
          onClick={fecharExclusaoRua}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              fecharExclusaoRua();
            } else if (event.key === "Tab") {
              const focusable = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])')];
              if (focusable.length === 0) return;
              const first = focusable[0];
              const last = focusable[focusable.length - 1];
              if (event.shiftKey && event.target === first) {
                event.preventDefault();
                last.focus();
              } else if (!event.shiftKey && event.target === last) {
                event.preventDefault();
                first.focus();
              }
            }
          }}
        >
          <div className="settings-panel" role="dialog" aria-modal="true" aria-labelledby="estoque-excluir-longarina-titulo" tabIndex={-1} onClick={(event) => event.stopPropagation()}>
            <div className="settings-panel-header">
              <button className="settings-close" onClick={fecharExclusaoRua} aria-label="Fechar">
                ×
              </button>
              <h2 id="estoque-excluir-longarina-titulo" className="settings-title">Excluir longarina {excluindoRua}?</h2>
            </div>
            <div className="settings-panel-body">
              {(ruas.find((r) => r.rua === excluindoRua)?.posicoes.length ?? 0) > 0 ? (
                <p className="field-value">
                  Esta longarina ainda tem <strong>{ruas.find((r) => r.rua === excluindoRua)?.posicoes.length} gaveta(s)</strong>. Remova ou mova cada gaveta antes de excluir a longarina; o histórico delas será mantido.
                </p>
              ) : (
                <p className="field-value">A longarina está vazia e pode ser removida.</p>
              )}
              <label className="field">
                <span className="field-label">
                  Pra confirmar, digite <strong>{excluindoRua}</strong>
                </span>
                <input className="field-input" value={confirmacaoRua} onChange={(event) => setConfirmacaoRua(event.target.value)} autoFocus />
              </label>
            </div>
            <div className="settings-panel-footer">
              {erroExcluirRua && <p className="error-banner">{erroExcluirRua}</p>}
              <button
                type="button"
                className="btn-perigo"
                disabled={
                  excluindo ||
                  (ruas.find((r) => r.rua === excluindoRua)?.posicoes.length ?? 0) > 0 ||
                  confirmacaoRua.trim().toUpperCase() !== excluindoRua.toUpperCase()
                }
                onClick={() => void confirmarExclusaoRua()}
              >
                {excluindo ? "Excluindo..." : (ruas.find((r) => r.rua === excluindoRua)?.posicoes.length ?? 0) > 0 ? "Remova as gavetas antes de excluir" : `Excluir longarina ${excluindoRua}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {mostrarModalProdutos && (
        <ModalProdutos
          produtos={produtos}
          info={info}
          unidadesPorCaixa={unidadesPorCaixa}
          onFechar={() => setMostrarModalProdutos(false)}
          onAlterado={(lista) => {
            setProdutos(lista);
            void carregarProdutos();
          }}
          onFotosAtualizadas={setInfo}
          onSalvarUnidadesPorCaixa={salvarUnidadesPorCaixa}
        />
      )}

      {mostrarEscolhaContagem && (
        <ModalEscolherContagem
          posicoes={todasAsGavetas}
          onEscolher={(posicao) => {
            setMostrarEscolhaContagem(false);
            window.setTimeout(() => abrirGaveta(posicao), 0);
          }}
          onNovaGaveta={() => {
            setMostrarEscolhaContagem(false);
            window.setTimeout(() => abrirNovaGaveta(), 0);
          }}
          onFechar={() => setMostrarEscolhaContagem(false)}
        />
      )}

      {modal && (
        <FormularioContagem
          modal={modal}
          produtos={produtos}
          unidadesPorCaixa={unidadesPorCaixa}
          responsaveis={responsaveisEstoque}
          mensagemResponsaveis={mensagemListaResponsaveis}
          onAbrirMovimentacao={abrirMovimentacao}
          onFechar={() => setModal(null)}
          onSalvo={aoSalvar}
          onMetadadosSalvos={aoSalvarMetadados}
          onExcluida={aoExcluirGaveta}
        />
      )}

      {movimentacao && (
        <ModalMovimentacao
          posicao={movimentacao}
          posicoes={todasAsGavetas}
          responsaveis={responsaveisEstoque}
          mensagemResponsaveis={mensagemListaResponsaveis}
          onFechar={() => setMovimentacao(null)}
          onSalvo={aoSalvarMovimentacao}
        />
      )}

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}

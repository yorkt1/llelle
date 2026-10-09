import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { PageHeader } from "@/PageHeader";
import { nomeProdutoComVoltagemUnica } from "../lib/nomeProduto";

interface RegistroContagem {
  id: string;
  quantidade: number;
  responsavel: string;
  /** URL pública do Cloudinary — nunca um caminho/arquivo local (ver lib/estoque.ts). */
  fotoUrl: string;
  criadoEm: string;
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
  | { modo: "nova"; ruasExistentes: string[]; codigosPorRua: Record<string, string[]>; produtoInicial?: string }
  | null;

const API_URL = import.meta.env.VITE_API_URL ?? "";
const POLL_MS = 30_000;
const RESPONSAVEL_STORAGE_KEY = "estoque:ultimoResponsavel";
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
  if (!Number.isFinite(numero) || numero < 0) return "Quantidade precisa ser um número maior ou igual a zero.";
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

function FormularioContagem({
  modal,
  produtos,
  onFechar,
  onSalvo,
  onMetadadosSalvos,
  onExcluida,
}: {
  modal: Exclude<Modal, null>;
  produtos: string[];
  onFechar: () => void;
  onSalvo: (rua: string, codigo: string) => void;
  onMetadadosSalvos: (rua: string, codigo: string, produto: string, voltagem: Voltagem) => void;
  onExcluida: (rua: string, codigo: string) => void;
}) {
  // Rua: fixa numa gaveta existente; numa nova, escolhida aqui (uma das existentes ou uma letra nova).
  const [ruaNova, setRuaNova] = useState(() => (modal.modo === "nova" && modal.ruasExistentes.length === 1 ? modal.ruasExistentes[0] : ""));
  const ruaAtual = modal.modo === "existente" ? modal.rua : ruaNova.trim().toUpperCase();
  const codigosExistentes = modal.modo === "nova" ? modal.codigosPorRua[ruaAtual] ?? [] : [];
  const [numeroGaveta, setNumeroGaveta] = useState(() => (modal.modo === "nova" && ruaAtual ? proximoNumeroGavetaSugerido(ruaAtual, codigosExistentes) : ""));
  const [quantidade, setQuantidade] = useState(modal.modo === "existente" ? String(modal.ultima.quantidade) : "");
  const [responsavel, setResponsavel] = useState(() => (modal.modo === "existente" ? modal.ultima.responsavel : lerUltimoResponsavel()));
  // Posição nova, ou existente que foi registrada vazia (sem produto): escolhe o produto aqui — ou
  // "Posição vazia", que registra 0 un. sem produto nem voltagem.
  const definirProduto = modal.modo === "nova" || !modal.produto;
  const [produto, setProduto] = useState(modal.modo === "existente" ? (modal.produto ? "" : PRODUTO_VAZIA) : (modal.produtoInicial ?? ""));
  const [voltagemEscolhida, setVoltagemEscolhida] = useState("");
  const [fotoPreview, setFotoPreview] = useState<string | null>(null);
  const [mostrarHistorico, setMostrarHistorico] = useState(false);
  const [historico, setHistorico] = useState<RegistroContagem[] | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [tocados, setTocados] = useState<Set<string>>(new Set());
  const [tentouSalvar, setTentouSalvar] = useState(false);

  // Edição de produto/voltagem de uma posição já existente — fica fechado por padrão (os dois
  // normalmente não mudam numa recontagem), só abre se a pessoa pedir pra corrigir.
  const [editandoMetadados, setEditandoMetadados] = useState(false);
  const [produtoEdit, setProdutoEdit] = useState(modal.modo === "existente" ? modal.produto ?? "" : "");
  const [voltagemEdit, setVoltagemEdit] = useState(modal.modo === "existente" ? modal.voltagem ?? "" : "");
  const [salvandoMetadados, setSalvandoMetadados] = useState(false);
  const [erroMetadados, setErroMetadados] = useState<string | null>(null);

  const inputFotoRef = useRef<HTMLInputElement>(null);
  const codigoRef = useRef<HTMLInputElement>(null);
  const produtoRef = useRef<HTMLSelectElement>(null);
  const voltagemRef = useRef<HTMLSelectElement>(null);
  const quantidadeRef = useRef<HTMLInputElement>(null);
  const responsavelRef = useRef<HTMLInputElement>(null);
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

  const erroRua = modal.modo === "nova" ? (!ruaAtual ? "Informe a rua (letra)." : !/^[A-Z]+$/.test(ruaAtual) ? "Rua é só a letra (ex.: F)." : null) : null;
  const erroCodigoFormato = modal.modo === "nova" ? validarNumeroGaveta(numeroGaveta) : null;
  const erroCodigoDuplicado =
    modal.modo === "nova" && !erroCodigoFormato && codigosExistentes.includes(`${ruaAtual}${numeroGaveta.trim()}`) ? "Essa gaveta já existe nessa rua." : null;
  const erroCodigo = erroRua ?? erroCodigoFormato ?? erroCodigoDuplicado;
  const vazia = definirProduto && produto === PRODUTO_VAZIA;
  // Cada cor+voltagem é um produto próprio (nome igual ao do Tiny, ex.: "... Azul 110V"): quando o nome
  // do produto já diz a voltagem, ela vem dele e não é perguntada de novo.
  const voltagemDoProduto = vazia ? null : voltagemDoNome(produto);
  const voltagem = voltagemDoProduto ?? voltagemEscolhida;
  const erroProduto = definirProduto ? validarProduto(produto) : null;
  const erroVoltagem = definirProduto && !vazia ? validarVoltagem(voltagem) : null;
  const erroQuantidade =
    validarQuantidade(quantidade) ??
    (vazia && Number(quantidade) > 0 ? "Gaveta vazia fica com 0 un. — pra contar unidades, escolha o produto." : null);
  const erroResponsavel = validarResponsavel(responsavel);
  const erroFoto = validarFoto(fotoPreview);
  const formularioInvalido = Boolean(erroCodigo || erroProduto || erroVoltagem || erroQuantidade || erroResponsavel || erroFoto);

  const ajustarQuantidade = useCallback((delta: number) => {
    setQuantidade((atual) => String(Math.max(0, (Number(atual) || 0) + delta)));
  }, []);

  const aoEscolherFoto = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const arquivo = event.target.files?.[0];
    if (!arquivo) return;
    try {
      setFotoPreview(await comprimirFoto(arquivo));
    } catch {
      setErro("Não consegui processar essa foto — tenta tirar de novo.");
    }
  }, []);

  const carregarHistorico = useCallback(async () => {
    if (modal.modo !== "existente") return;
    setMostrarHistorico((atual) => !atual);
    if (historico) return;
    try {
      const resposta = await fetch(`${API_URL}/api/estoque/${encodeURIComponent(modal.rua)}/${encodeURIComponent(modal.codigo)}/historico`);
      const json = await resposta.json();
      setHistorico(json.historico ?? []);
    } catch {
      setHistorico([]);
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
                : erroResponsavel
                  ? responsavelRef.current
                  : null;
    refAlvo?.scrollIntoView({ behavior: "smooth", block: "center" });
    refAlvo?.focus();
  }, [modal, definirProduto, erroCodigo, erroProduto, erroVoltagem, erroFoto, erroQuantidade, erroResponsavel]);

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
          responsavel: responsavel.trim(),
          fotoDataUri: fotoPreview,
          ...(definirProduto && !vazia ? { produto: produto.trim(), voltagem } : {}),
        }),
      });
      const json = await resposta.json();
      if (!resposta.ok) throw new Error(json.error ?? "Não consegui salvar a contagem.");

      salvarUltimoResponsavel(responsavel.trim());
      onSalvo(ruaAtual, codigoFinal);
    } catch (error) {
      setErro(error instanceof Error ? error.message : "Não consegui salvar a contagem.");
    } finally {
      setSalvando(false);
    }
  }, [numeroGaveta, ruaAtual, definirProduto, fotoPreview, formularioInvalido, focarPrimeiroErro, modal, onSalvo, produto, quantidade, responsavel, vazia, voltagem]);

  const excluirPosicao = useCallback(async () => {
    if (modal.modo !== "existente") return;
    if (!window.confirm(`Excluir a gaveta ${modal.codigo} da Rua ${modal.rua}? Ela some da tela (o histórico fica guardado no arquivo de excluídos).`)) return;
    setErro(null);
    try {
      const resposta = await fetch(`${API_URL}/api/estoque/posicao/${encodeURIComponent(modal.rua)}/${encodeURIComponent(modal.codigo)}`, { method: "DELETE" });
      if (!resposta.ok) throw new Error((await resposta.json().catch(() => ({}))).error ?? "Não consegui excluir a gaveta.");
      onExcluida(modal.rua, modal.codigo);
    } catch (error) {
      setErro(error instanceof Error ? error.message : "Não consegui excluir a gaveta.");
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
      setErroMetadados(error instanceof Error ? error.message : "Não consegui salvar produto/voltagem.");
    } finally {
      setSalvandoMetadados(false);
    }
  }, [modal, produtoEdit, voltagemEdit, onMetadadosSalvos]);

  // A foto anterior só aparece como referência (pra comparar contra o que tem na posição agora) —
  // nunca é reaproveitada ao salvar: toda contagem exige tirar uma foto nova (ver `salvar`).
  const fotoAnteriorUrl = modal.modo === "existente" ? modal.ultima.fotoUrl : null;

  // "Anteriores" exclui a contagem atual (modal.ultima, sempre historico[0]) — já está nos campos
  // do formulário logo acima, repetir ela na lista só confunde quem tá vendo.
  const historicoAnterior = modal.modo === "existente" && historico ? historico.filter((item) => item.id !== modal.ultima.id) : [];

  // Código em destaque pra bater com a etiqueta física da prateleira — só o código da posição
  // (mesmo texto que já aparece no card e, em tese, na etiqueta colada na prateleira), sem juntar
  // com a letra da rua, que já aparece em separado no título do modal. Na posição existente é
  // fixo, numa posição nova acompanha o número digitado e a rua escolhida.
  const codigoEmDestaque =
    modal.modo === "existente" ? modal.codigo : ruaAtual && numeroGaveta.trim() ? `${ruaAtual}${numeroGaveta.trim()}` : "?";

  return (
    <div className="settings-overlay" onClick={onFechar}>
      <div className="settings-panel" onClick={(event) => event.stopPropagation()}>
        <div className="settings-panel-header">
          <button className="settings-close" onClick={onFechar} aria-label="Fechar">
            ×
          </button>
          <h2 className="settings-title">
            Rua {ruaAtual || "?"}
            {modal.modo === "existente" ? ` · ${modal.codigo}` : " · nova gaveta"}
          </h2>
        </div>

        <div className="settings-panel-body">
          {modal.modo === "nova" && (
            <div className="estoque-rua-gaveta">
              <label className="field">
                <span className="field-label">
                  Rua <span className="field-obrigatorio">*</span>
                </span>
                <input
                  className={`field-input${mostrar("codigo", erroRua) ? " field-input--erro" : ""}`}
                  list="estoque-ruas-existentes"
                  value={ruaNova}
                  onChange={(event) => {
                    const rua = event.target.value.toUpperCase().replace(/[^A-Z]/g, "");
                    setRuaNova(rua);
                    // Enquanto a pessoa não mexeu no código, ele acompanha a rua (F → próxima gaveta livre da F).
                    if (!tocados.has("codigo") && rua) setNumeroGaveta(proximoNumeroGavetaSugerido(rua, modal.codigosPorRua[rua] ?? []));
                  }}
                  placeholder="Ex.: F"
                  autoFocus
                />
                <datalist id="estoque-ruas-existentes">
                  {modal.ruasExistentes.map((r) => (
                    <option key={r} value={r} />
                  ))}
                </datalist>
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
            {fotoPreview ? (
              <img className="estoque-foto-preview" src={fotoPreview} alt="Foto tirada agora" />
            ) : fotoAnteriorUrl ? (
              <>
                <img className="estoque-foto-preview" src={fotoAnteriorUrl} alt="Foto da última contagem" />
                <span className="field-value--muted">Essa é a foto da última contagem — ainda falta tirar uma nova.</span>
              </>
            ) : (
              <div className="estoque-foto-placeholder">Sem foto ainda</div>
            )}
            <input ref={inputFotoRef} type="file" accept="image/*" capture="environment" onChange={aoEscolherFoto} hidden />
            <button
              ref={fotoBotaoRef}
              type="button"
              className="refresh-btn"
              onClick={() => {
                tocar("foto");
                inputFotoRef.current?.click();
              }}
            >
              {fotoPreview ? "Trocar foto" : "Tirar / escolher foto"}
            </button>
            <p className="estoque-em-breve">🔜 Em breve a IA vai sugerir a contagem a partir dessa foto.</p>
            {mostrar("foto", erroFoto) && <span className="field-erro">{mostrar("foto", erroFoto)}</span>}
          </div>

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

          <label className="field">
            <span className="field-label">
              Quem contou <span className="field-obrigatorio">*</span>
            </span>
            <input
              ref={responsavelRef}
              className={`field-input${mostrar("responsavel", erroResponsavel) ? " field-input--erro" : ""}`}
              value={responsavel}
              onChange={(event) => setResponsavel(event.target.value)}
              onBlur={() => tocar("responsavel")}
              placeholder="Seu nome"
            />
            {mostrar("responsavel", erroResponsavel) && <span className="field-erro">{mostrar("responsavel", erroResponsavel)}</span>}
          </label>

          {modal.modo === "existente" && (
            <>
              <button type="button" className="buscas-recentes-item" onClick={() => void carregarHistorico()}>
                {mostrarHistorico ? "Ocultar histórico" : "Ver histórico"}
              </button>
              {mostrarHistorico && historico && (
                historicoAnterior.length === 0 ? (
                  <p className="field-value--muted">Nenhuma contagem anterior.</p>
                ) : (
                  <ul className="estoque-historico">
                    {historicoAnterior.map((item) => (
                      <li key={item.id} className="estoque-historico-item">
                        <img className="estoque-historico-miniatura" src={item.fotoUrl} alt={`Foto da contagem de ${formatarDataHora(item.criadoEm)}`} />
                        <span>
                          <strong>{item.quantidade}</strong> un. — {item.responsavel} · {formatarDataHora(item.criadoEm)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )
              )}
            </>
          )}
        </div>

        <div className="settings-panel-footer">
          {erro && <p className="error-banner">{erro}</p>}
          <button className="btn-primario" onClick={() => void salvar()} disabled={salvando || (tentouSalvar && formularioInvalido)}>
            {salvando ? "Salvando..." : "Salvar"}
          </button>
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

/** Catálogo de produtos — antes um painel no topo da tela, agora um modal aberto pelo "+ Produto" do cabeçalho. */
function ModalProdutos({
  produtos,
  info,
  onFechar,
  onAlterado,
}: {
  produtos: string[];
  info: Record<string, InfoProduto>;
  onFechar: () => void;
  onAlterado: (produtos: string[]) => void;
}) {
  const [novoProduto, setNovoProduto] = useState("");
  const [erroProdutos, setErroProdutos] = useState<string | null>(null);
  const [salvandoProduto, setSalvandoProduto] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Cadastro em lote: "tiny" busca no cadastro de produtos do Tiny; "colar" aceita uma lista, um por linha.
  const [modo, setModo] = useState<"lista" | "tiny" | "colar" | "sugestoes">("lista");
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
  const [textoColado, setTextoColado] = useState("");
  const [avisoLote, setAvisoLote] = useState<string | null>(null);
  const noCatalogo = useMemo(() => new Set(produtos.map((p) => (nomeProdutoComVoltagemUnica(p)?.nome ?? p).toLowerCase())), [produtos]);

  const buscarNoTiny = useCallback(async () => {
    setBuscandoTiny(true);
    setErroProdutos(null);
    try {
      const resposta = await fetch(`${API_URL}/api/estoque/produtos/tiny?termo=${encodeURIComponent(termoTiny.trim())}`);
      const json = await resposta.json();
      if (!resposta.ok) throw new Error(json.error ?? "Não consegui buscar no Tiny.");
      const lista: ProdutoTiny[] = json.produtos ?? [];
      setResultadosTiny(lista);
      setSelecionados(new Set(lista.map((p) => p.sugestao).filter((nome) => !noCatalogo.has(nome.toLowerCase()))));
    } catch (error) {
      setErroProdutos(error instanceof Error ? error.message : "Não consegui buscar no Tiny.");
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
        setModo("lista");
        setResultadosTiny(null);
        setTextoColado("");
      } catch (error) {
        setErroProdutos(error instanceof Error ? error.message : "Não consegui cadastrar os produtos.");
      } finally {
        setSalvandoProduto(false);
      }
    },
    [onAlterado],
  );

  const adicionarProdutoCatalogo = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      const nome = novoProduto.trim();
      if (!nome) return;
      setSalvandoProduto(true);
      setErroProdutos(null);
      try {
        const resposta = await fetch(`${API_URL}/api/estoque/produtos`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nome }),
        });
        const json = await resposta.json();
        if (!resposta.ok) throw new Error(json.error ?? "Não consegui cadastrar o produto.");
        onAlterado(json.produtos ?? []);
        setNovoProduto("");
      } catch (error) {
        setErroProdutos(error instanceof Error ? error.message : "Não consegui cadastrar o produto.");
      } finally {
        setSalvandoProduto(false);
      }
    },
    [novoProduto, onAlterado],
  );

  const normalizarProdutos = useCallback(async () => {
    const confirmou = window.confirm(
      "Vou deixar apenas a última voltagem nos nomes e consolidar os produtos duplicados. 110V e 220V continuarão separados; gavetas, quantidades, histórico e fotos serão preservados. Continuar?",
    );
    if (!confirmou) return;

    setSalvandoProduto(true);
    setErroProdutos(null);
    try {
      const resposta = await fetch(`${API_URL}/api/estoque/produtos/normalizar-voltagens`, { method: "POST" });
      const json = await resposta.json();
      if (!resposta.ok) throw new Error(json.error ?? "Não consegui corrigir os nomes dos produtos.");
      onAlterado(json.produtos ?? []);
      setAvisoLote(
        json.renomeados === 0 && json.duplicadosRemovidos === 0
          ? "Os nomes já estavam padronizados; nenhum produto precisava ser removido."
          : `${json.renomeados} nome(s) corrigido(s), ${json.duplicadosRemovidos} duplicado(s) removido(s) do catálogo e ${json.posicoesAtualizadas} gaveta(s) atualizada(s). Estoque e histórico preservados.`,
      );
    } catch (error) {
      setErroProdutos(error instanceof Error ? error.message : "Não consegui corrigir os nomes dos produtos.");
    } finally {
      setSalvandoProduto(false);
    }
  }, [onAlterado]);

  const removerProdutoCatalogo = useCallback(
    async (nome: string) => {
      if (!window.confirm(`Remover "${nome}" do catálogo de produtos?`)) return;
      setErroProdutos(null);
      try {
        const resposta = await fetch(`${API_URL}/api/estoque/produtos/${encodeURIComponent(nome)}`, { method: "DELETE" });
        if (!resposta.ok) throw new Error("Não consegui remover esse produto agora.");
        onAlterado(produtos.filter((p) => p !== nome));
      } catch (error) {
        setErroProdutos(error instanceof Error ? error.message : "Não consegui remover esse produto agora.");
      }
    },
    [onAlterado, produtos],
  );

  return (
    <div className="settings-overlay" onClick={onFechar}>
      <div className={`settings-panel${modo === "lista" ? "" : " settings-panel--largo"}`} onClick={(event) => event.stopPropagation()}>
        <div className="settings-panel-header">
          <button className="settings-close" onClick={onFechar} aria-label="Fechar">
            ×
          </button>
          <h2 className="settings-title">Produtos</h2>
          <p className="settings-hint">
            Produtos disponíveis pra escolher ao criar uma posição nova. Remover um produto daqui não afeta posições que já usam ele.
          </p>
        </div>

        <div className="settings-panel-body">
          <div className="abas" role="tablist" aria-label="Como cadastrar">
            {(
              [
                ["lista", "Um por um"],
                ["tiny", "Buscar no Tiny"],
                ["colar", "Colar uma lista"],
                ["sugestoes", "Sugestões de produtos"],
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

          {modo === "sugestoes" && (
            <>
              <p className="field-value--muted">
                Sugestões baseadas no estoque informado em 30/09/2026. A quantidade é apenas referência; não altera o estoque. Os produtos já cadastrados aparecem desmarcados.
              </p>
              <div className="lote-acoes">
                <span className="field-value--muted">
                  {SUGESTOES_PRODUTOS.flatMap((grupo) => grupo.itens).filter((item) => !noCatalogo.has(item.nome.toLowerCase())).length} disponível(is) ·{" "}
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
                              .filter((nome) => !noCatalogo.has(nome.toLowerCase())),
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
                      const jaTem = noCatalogo.has(item.nome.toLowerCase());
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
                            selecionados.size > 0 ? new Set() : new Set(resultadosTiny.map((p) => p.sugestao).filter((n) => !noCatalogo.has(n.toLowerCase()))),
                          )
                        }
                      >
                        {selecionados.size > 0 ? "Desmarcar todos" : "Marcar todos"}
                      </button>
                    </div>
                    <ul className="lote-lista">
                      {resultadosTiny.map((p) => {
                        const jaTem = noCatalogo.has(p.sugestao.toLowerCase());
                        return (
                          <li key={p.sugestao}>
                            <label className={`lote-item${jaTem ? " lote-item--desabilitado" : ""}`}>
                              <input
                                type="checkbox"
                                disabled={jaTem}
                                checked={jaTem || selecionados.has(p.sugestao)}
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
                                  {jaTem ? " · já no catálogo" : p.nomesTiny.length > 1 ? ` · ${p.nomesTiny.length} variações no Tiny` : ""}
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
          <button type="button" className="refresh-btn" onClick={() => void normalizarProdutos()} disabled={salvandoProduto}>
            {salvandoProduto ? "Corrigindo produtos..." : "Corrigir voltagens e remover duplicados"}
          </button>
          <button
            type="button"
            className="btn-primario"
            onClick={() => {
              setModo("sugestoes");
              setAvisoLote(null);
              setErroProdutos(null);
            }}
          >
            Escolher produtos sugeridos do estoque
          </button>
          <form className="estoque-form-produto" onSubmit={adicionarProdutoCatalogo}>
            <label className="field">
              <span className="field-label">Novo produto</span>
              <input
                ref={inputRef}
                className="field-input"
                value={novoProduto}
                onChange={(event) => setNovoProduto(event.target.value)}
                placeholder="Ex.: Liquidificador 110V"
                autoFocus
              />
            </label>
            <button className="btn-primario" type="submit" disabled={salvandoProduto || !novoProduto.trim()}>
              {salvandoProduto ? "Salvando..." : "Adicionar"}
            </button>
          </form>
          {erroProdutos && <p className="error-banner">{erroProdutos}</p>}

          {produtos.length === 0 ? (
            <div className="estado-vazio estado-vazio--compacto">
              <p className="estado-vazio-titulo">Nenhum produto cadastrado.</p>
              <button type="button" className="btn-primario" onClick={() => inputRef.current?.focus()}>
                + Adicionar produto
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

/**
 * Ainda não existe regra de negócio pra "estoque baixo" — com null o aviso fica desligado. Pra
 * ativar, troque por um número de unidades (ex.: 10): produto com 1..N un. no total ganha o selo
 * "Estoque baixo" no card.
 */
const LIMITE_ESTOQUE_BAIXO = null as number | null;

interface InfoProduto {
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

function chaveDoProduto(nome: string): string {
  return nome.trim().replace(/\s+/g, " ").toLowerCase();
}

function normalizar(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
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
      <span>{info?.fotoStatus === "pendente" ? "Buscando foto…" : "Sem foto"}</span>
    </div>
  );
}

function ModalProduto({
  grupo,
  onFechar,
  onAbrirGaveta,
  onNovaGaveta,
  onFotoAlterada,
  onSepararVoltagem,
}: {
  grupo: GrupoProduto;
  onFechar: () => void;
  onAbrirGaveta: (posicao: PosicaoResumo) => void;
  onNovaGaveta: (produto: string) => void;
  onFotoAlterada: () => void;
  onSepararVoltagem: (grupo: GrupoProduto) => void;
}) {
  const inputFotoRef = useRef<HTMLInputElement>(null);
  const [enviandoFoto, setEnviandoFoto] = useState(false);
  const [avisoFoto, setAvisoFoto] = useState<string | null>(null);
  const [erroFoto, setErroFoto] = useState<string | null>(null);

  const trocarFoto = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const arquivo = event.target.files?.[0];
      event.target.value = ""; // permite escolher o mesmo arquivo de novo
      if (!arquivo) return;
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
        setAvisoFoto("Foto trocada. A busca automática do Tiny não mexe mais nela.");
        onFotoAlterada();
      } catch (error) {
        setErroFoto(error instanceof Error ? error.message : "Não consegui trocar a foto.");
      } finally {
        setEnviandoFoto(false);
      }
    },
    [grupo.nome, onFotoAlterada],
  );

  const usarFotoDoTiny = useCallback(async () => {
    setErroFoto(null);
    setAvisoFoto(null);
    try {
      const resposta = await fetch(`${API_URL}/api/estoque/produtos/fotos/tiny`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome: grupo.nome }),
      });
      if (!resposta.ok) throw new Error("Não consegui pedir a foto do Tiny.");
      setAvisoFoto("Buscando a foto no Tiny — aparece em alguns minutos.");
      onFotoAlterada();
    } catch (error) {
      setErroFoto(error instanceof Error ? error.message : "Não consegui pedir a foto do Tiny.");
    }
  }, [grupo.nome, onFotoAlterada]);

  const origemFoto =
    grupo.info?.fotoStatus === "pendente"
      ? "buscando no Tiny…"
      : grupo.info?.fotoUrl
        ? grupo.info.fotoOrigem === "manual"
          ? "trocada à mão"
          : "do Tiny"
        : grupo.info?.fotoStatus === "nao-encontrado"
          ? "produto não achado no Tiny"
          : "sem foto";

  return (
    <div className="settings-overlay" onClick={onFechar}>
      <div className="settings-panel settings-panel--largo" onClick={(event) => event.stopPropagation()}>
        <div className="settings-panel-header produto-detalhe-cabecalho">
          <button className="settings-close" onClick={onFechar} aria-label="Fechar">
            ×
          </button>
          <div className="produto-detalhe-foto-coluna">
            <FotoProduto info={grupo.info} nome={grupo.nome} className="produto-detalhe-foto" />
            <input ref={inputFotoRef} type="file" accept="image/*" onChange={(event) => void trocarFoto(event)} hidden />
            <button type="button" className="link-acao" onClick={() => inputFotoRef.current?.click()} disabled={enviandoFoto}>
              {enviandoFoto ? "Enviando…" : "Trocar foto"}
            </button>
            {grupo.info?.fotoOrigem === "manual" || !grupo.info?.fotoUrl ? (
              <button type="button" className="link-acao" onClick={() => void usarFotoDoTiny()} disabled={enviandoFoto || grupo.info?.fotoStatus === "pendente"}>
                Usar foto do Tiny
              </button>
            ) : null}
          </div>
          <div className="produto-detalhe-texto">
            <h2 className="settings-title">{grupo.nome}</h2>
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
          <button type="button" className="btn-primario" onClick={() => onNovaGaveta(grupo.nome)}>
            + Colocar em outra gaveta
          </button>
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
      setErro(error instanceof Error ? error.message : "Não consegui separar.");
    } finally {
      setEnviando(false);
    }
  }, [grupos, todos, onConcluido]);

  return (
    <div className="settings-overlay" onClick={onFechar}>
      <div className="settings-panel settings-panel--largo" onClick={(event) => event.stopPropagation()}>
        <div className="settings-panel-header">
          <button className="settings-close" onClick={onFechar} aria-label="Fechar">
            ×
          </button>
          <h2 className="settings-title">Separar por voltagem</h2>
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

  const criar = async (event: FormEvent) => {
    event.preventDefault();
    setSalvando(true);
    setErro(null);
    try {
      await onCriar(novaLongarina);
      setNovaLongarina("");
    } catch (error) {
      setErro(error instanceof Error ? error.message : "Não consegui criar a longarina.");
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
    } catch (error) {
      setErro(error instanceof Error ? error.message : "Não consegui renomear a longarina.");
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="settings-overlay" onClick={onFechar}>
      <div className="settings-panel" onClick={(event) => event.stopPropagation()}>
        <div className="settings-panel-header">
          <button className="settings-close" onClick={onFechar} aria-label="Fechar">
            ×
          </button>
          <h2 className="settings-title">Gerenciar longarinas</h2>
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

export function Estoque() {
  const [ruas, setRuas] = useState<RuaResumo[]>([]);
  const [produtos, setProdutos] = useState<string[]>([]);
  const [info, setInfo] = useState<Record<string, InfoProduto>>({});
  const [modal, setModal] = useState<Modal>(null);
  const [carregou, setCarregou] = useState(false);
  const [erroCarregamento, setErroCarregamento] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const [mostrarModalProdutos, setMostrarModalProdutos] = useState(false);
  const [mostrarRuas, setMostrarRuas] = useState(false);
  const [produtoAberto, setProdutoAberto] = useState<string | null>(null);
  const [visaoEstoque, setVisaoEstoque] = useState<VisaoEstoque>("produtos");

  const [busca, setBusca] = useState("");
  const [filtroVoltagem, setFiltroVoltagem] = useState("");
  const [ordem, setOrdem] = useState<Ordem>("nome");
  const [soComEstoque, setSoComEstoque] = useState(false);
  // "Separar por voltagem" aberto: um produto (do detalhe) ou todos os que estão nessa situação.
  const [separando, setSeparando] = useState<{ grupos: GrupoProduto[]; todos: boolean } | null>(null);

  // Excluir rua: confirmação digitando o nome da rua (apaga todas as gavetas dela de uma vez).
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
      setErroCarregamento(error instanceof Error ? error.message : "Não consegui carregar o estoque.");
    } finally {
      setCarregou(true);
    }
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
      if (resposta.ok) {
        setProdutos(json.produtos ?? []);
        setInfo(json.info ?? {});
      }
    } catch {
      // Catálogo/fotos não travam a tela — os cards aparecem a partir das gavetas mesmo assim.
    }
  }, []);

  useEffect(() => {
    const kickoff = setTimeout(() => {
      void carregar();
      void carregarProdutos();
    }, 0);
    const id = setInterval(() => {
      void carregar();
      void carregarProdutos(); // as fotos chegam aos poucos, em segundo plano
    }, POLL_MS);
    return () => {
      clearTimeout(kickoff);
      clearInterval(id);
    };
  }, [carregar, carregarProdutos]);

  const todasAsGavetas = useMemo(() => ruas.flatMap((r) => r.posicoes), [ruas]);
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
  const gruposExibidos = grupos
    .filter((g) => !soComEstoque || g.total > 0)
    .filter((g) => !filtroVoltagem || g.gavetas.some((l) => l.voltagem === filtroVoltagem))
    .filter(
      (g) =>
        !termo ||
        normalizar(g.nome).includes(termo) ||
        g.gavetas.some((l) => normalizar(`${l.codigo} rua ${l.rua} ${l.rua}${l.codigo}`).includes(termo)),
    )
    .sort((a, b) => (ordem === "unidades" ? b.total - a.total : 0) || a.nome.localeCompare(b.nome, "pt-BR"));

  const longarinasExibidas = ruas
    .map((rua) => {
      const termoBateRua = Boolean(termo && normalizar(`rua ${rua.rua}`).includes(termo));
      const posicoes = rua.posicoes
        .filter(
          (posicao) =>
            (!soComEstoque || posicao.ultima.quantidade > 0) &&
            (!filtroVoltagem || posicao.voltagem === filtroVoltagem) &&
            (!termo ||
              termoBateRua ||
              normalizar(`${posicao.codigo} ${posicao.produto ?? ""} rua ${posicao.rua}`).includes(termo)),
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
  const semFoto = grupos.filter((g) => g.noCatalogo && !g.info?.fotoUrl).length;
  const buscandoFotos = grupos.some((g) => g.info?.fotoStatus === "pendente");
  const grupoAberto = produtoAberto ? grupos.find((g) => g.chave === produtoAberto) ?? null : null;
  const paraSeparar = grupos.filter(podeSepararPorVoltagem);

  const codigosPorRua = useMemo(() => Object.fromEntries(ruas.map((r) => [r.rua, r.posicoes.map((p) => p.codigo)])), [ruas]);

  const abrirNovaGaveta = useCallback(
    (produtoInicial?: string) => {
      setProdutoAberto(null);
      setModal({ modo: "nova", ruasExistentes: ruas.map((r) => r.rua), codigosPorRua, produtoInicial });
    },
    [ruas, codigosPorRua],
  );

  const abrirGaveta = useCallback((p: PosicaoResumo) => {
    setProdutoAberto(null);
    setModal({ modo: "existente", rua: p.rua, codigo: p.codigo, ultima: p.ultima, produto: p.produto, voltagem: p.voltagem });
  }, []);

  const aoSalvar = useCallback(
    (_rua: string, codigo: string) => {
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

  const buscarFotos = useCallback(async () => {
    try {
      const resposta = await fetch(`${API_URL}/api/estoque/produtos/fotos/buscar`, { method: "POST" });
      const json = await resposta.json();
      if (!resposta.ok) throw new Error(json.error ?? "falhou");
      mostrarToast(json.pendentes > 0 ? `Buscando ${json.pendentes} foto(s) no Tiny — aparecem aos poucos` : "Todos os produtos já têm foto");
      void carregarProdutos();
    } catch {
      mostrarToast("Não consegui pedir as fotos agora");
    }
  }, [carregarProdutos, mostrarToast]);

  const confirmarExclusaoRua = useCallback(async () => {
    if (!excluindoRua) return;
    setExcluindo(true);
    setErroExcluirRua(null);
    try {
      const resposta = await fetch(`${API_URL}/api/estoque/longarinas/${encodeURIComponent(excluindoRua)}`, { method: "DELETE" });
      const json = await resposta.json();
      if (!resposta.ok) throw new Error(json.error ?? "Não consegui excluir a longarina.");
      mostrarToast(`Longarina ${excluindoRua} excluída (${json.gavetasExcluidas ?? 0} gaveta(s) arquivadas)`);
      setExcluindoRua(null);
      setConfirmacaoRua("");
      void carregar();
    } catch (error) {
      setErroExcluirRua(error instanceof Error ? error.message : "Não consegui excluir a longarina.");
    } finally {
      setExcluindo(false);
    }
  }, [carregar, excluindoRua, mostrarToast]);

  const filtroAtivo = termo !== "" || filtroVoltagem !== "" || soComEstoque;

  return (
    <div className="page pagina-formulario">
      <PageHeader titulo="Estoque" subtitulo="Onde está cada produto no galpão — rua e gaveta">
        <button type="button" className="refresh-btn" onClick={() => setMostrarModalProdutos(true)}>
          + Produto
        </button>
        <button type="button" className="refresh-btn" onClick={() => setMostrarRuas(true)}>
          Gerenciar longarinas
        </button>
        <button type="button" className="btn-primario" onClick={() => abrirNovaGaveta()}>
          + Gaveta
        </button>
      </PageHeader>

      {erroCarregamento && <p className="error-banner">{erroCarregamento}</p>}

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
        <select className="field-input" aria-label="Filtrar por voltagem" value={filtroVoltagem} onChange={(event) => setFiltroVoltagem(event.target.value)}>
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
        {semFoto > 0 && (
          <button type="button" className="refresh-btn filtro-acao" onClick={() => void buscarFotos()} disabled={buscandoFotos}>
            {buscandoFotos ? "Buscando fotos…" : `Buscar fotos no Tiny (${semFoto})`}
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
          <p className="field-value--muted">Comece trazendo os produtos do Tiny (já com foto) — depois é só dizer em que gaveta cada um está.</p>
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
                      <strong>{posicao.codigo}</strong>
                      <span>{posicao.produto ?? "Gaveta vazia"}</span>
                      <span className="estoque-longarina-quantidade">{posicao.ultima.quantidade} un.</span>
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
            const baixo = LIMITE_ESTOQUE_BAIXO !== null && g.total > 0 && g.total <= LIMITE_ESTOQUE_BAIXO;
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
                      <span className="estado-chip estado-chip--baixo">Estoque baixo</span>
                    ) : null}
                  </span>
                  {g.porVoltagem.length > 0 && (
                    <span className="produto-card-meta">{g.porVoltagem.map((v) => `${v.voltagem}: ${v.quantidade}`).join(" · ")}</span>
                  )}
                  {g.gavetas.length === 0 ? (
                    <span className="produto-card-meta">Não está em nenhuma gaveta</span>
                  ) : (
                    <span className="produto-card-locais" aria-label="Onde está">
                      {g.gavetas.slice(0, 4).map((l) => (
                        <span key={`${l.rua}::${l.codigo}`} className="local-chip" title={`Rua ${l.rua} · gaveta ${l.codigo} · ${l.ultima.quantidade} un.`}>
                          {l.codigo}
                          <span className="local-chip-qtd tabular">{l.ultima.quantidade}</span>
                        </span>
                      ))}
                      {g.gavetas.length > 4 && <span className="local-chip local-chip--mais">+{g.gavetas.length - 4}</span>}
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

      {excluindoRua && (
        <div className="settings-overlay" onClick={() => setExcluindoRua(null)}>
          <div className="settings-panel" onClick={(event) => event.stopPropagation()}>
            <div className="settings-panel-header">
              <button className="settings-close" onClick={() => setExcluindoRua(null)} aria-label="Fechar">
                ×
              </button>
              <h2 className="settings-title">Excluir longarina {excluindoRua}?</h2>
            </div>
            <div className="settings-panel-body">
              <p className="field-value">
                As <strong>{ruas.find((r) => r.rua === excluindoRua)?.posicoes.length ?? 0} gaveta(s)</strong> dessa longarina serão arquivadas com o histórico
                de contagens. Nada é apagado de vez: fica guardado num arquivo de excluídos e dá pra recuperar se precisar.
              </p>
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
                disabled={excluindo || confirmacaoRua.trim().toUpperCase() !== excluindoRua.toUpperCase()}
                onClick={() => void confirmarExclusaoRua()}
              >
                {excluindo ? "Excluindo..." : `Excluir longarina ${excluindoRua}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {mostrarModalProdutos && (
        <ModalProdutos
          produtos={produtos}
          info={info}
          onFechar={() => setMostrarModalProdutos(false)}
          onAlterado={(lista) => {
            setProdutos(lista);
            void carregarProdutos();
          }}
        />
      )}

      {modal && (
        <FormularioContagem
          modal={modal}
          produtos={produtos}
          onFechar={() => setModal(null)}
          onSalvo={aoSalvar}
          onMetadadosSalvos={aoSalvarMetadados}
          onExcluida={aoExcluirGaveta}
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

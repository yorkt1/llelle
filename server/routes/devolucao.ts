import { Router } from "express";
import { OlistConfigError } from "../../lib/olist";
import { buscarDevolucaoPorNf, NfNaoEncontradaError, TinyLimiteTaxaError } from "../../lib/devolucao";
import { salvarImportacaoShopee, type ShopeeImportacaoEntrada } from "../../lib/shopeeImportacao";
import { salvarImportacaoMercadoLivre, type MercadoLivreImportacaoEntrada } from "../../lib/mercadoLivreImportacao";
import { GroqConfigError, lerNumeroSerieComGroq } from "../../lib/groqOcr";
import {
  brParaIso,
  listarDevolucoes,
  parsearLinhasPlanilha,
  registrarDevolucoes,
  removerDevolucao,
  type EntradaDevolucao,
} from "../../lib/devolucaoHistorico";
import { vendasPorCodigoNoPeriodo } from "../../lib/vendasSync";

export const devolucaoRouter = Router();

// Responde com { erro } (não { error }, diferente do resto da API) por pedido explícito
// de quem vai consumir isso — mantido consistente dentro desta rota inteira.
devolucaoRouter.get("/nf/:numero", async (req, res) => {
  try {
    const preview = await buscarDevolucaoPorNf(String(req.params.numero));
    res.status(200).json(preview);
  } catch (error) {
    if (error instanceof NfNaoEncontradaError) {
      res.status(404).json({ erro: "NF não encontrada" });
      return;
    }
    if (error instanceof TinyLimiteTaxaError) {
      res.status(429).json({ erro: error.message });
      return;
    }
    if (error instanceof OlistConfigError) {
      res.status(503).json({ erro: error.message });
      return;
    }
    const mensagem = error instanceof Error ? error.message : "Erro inesperado ao buscar a nota fiscal.";
    res.status(500).json({ erro: mensagem });
  }
});

function paraTexto(valor: unknown): string | undefined {
  return typeof valor === "string" && valor.trim() !== "" ? valor.trim() : undefined;
}

function paraNumero(valor: unknown): number | undefined {
  const numero = typeof valor === "number" ? valor : typeof valor === "string" ? Number(valor.replace(",", ".")) : NaN;
  return Number.isFinite(numero) ? numero : undefined;
}

/** null quando o registro não tem nem `idPedido` — não dá pra guardar nada sem saber a que pedido pertence. */
function paraEntradaShopee(bruto: unknown): ShopeeImportacaoEntrada | null {
  if (!bruto || typeof bruto !== "object") return null;
  const body = bruto as Record<string, unknown>;
  const idPedido = paraTexto(body.idPedido);
  if (!idPedido) return null;

  return {
    idPedido,
    idDevolucaoShopee: paraTexto(body.idDevolucaoShopee),
    dataSolicitacao: paraTexto(body.dataSolicitacao),
    motivoDevolucao: paraTexto(body.motivoDevolucao),
    descricaoCliente: paraTexto(body.descricaoCliente),
    valorReembolso: paraNumero(body.valorReembolso),
    valorCompensacao: paraNumero(body.valorCompensacao),
    variacaoShopee: paraTexto(body.variacaoShopee),
    dataRecebimento: paraTexto(body.dataRecebimento),
  };
}

/**
 * Recebe o que o Tampermonkey raspa da tela do Shopee (ver tampermonkey/devolucao-shopee.user.js)
 * — um registro só (tela de detalhe de uma devolução) ou uma lista (tela de lista de solicitações).
 * Protegida por um token separado do OLIST_API_TOKEN (SHOPEE_IMPORT_TOKEN), porque essa rota não
 * fala com o Tiny — é só uma porta de entrada pra dado de fora, e sem isso qualquer um que
 * descobrisse a URL poderia mandar dado falso pro sistema.
 */
devolucaoRouter.post("/shopee", (req, res) => {
  const tokenConfigurado = process.env.SHOPEE_IMPORT_TOKEN;
  if (!tokenConfigurado) {
    res.status(503).json({ erro: "SHOPEE_IMPORT_TOKEN não configurado no servidor." });
    return;
  }
  if (req.get("x-import-token") !== tokenConfigurado) {
    res.status(401).json({ erro: "Token inválido." });
    return;
  }

  const bruto = Array.isArray(req.body) ? req.body : [req.body];
  const entradas = bruto.map(paraEntradaShopee);
  const validas = entradas.filter((entrada): entrada is ShopeeImportacaoEntrada => entrada != null);

  if (validas.length === 0) {
    res.status(400).json({ erro: "Nenhum registro válido — cada um precisa de pelo menos idPedido." });
    return;
  }

  const salvos = validas.map((entrada) => salvarImportacaoShopee(entrada).idPedido);
  res.status(201).json({ ok: true, salvos: salvos.length, ignorados: entradas.length - validas.length, idPedidos: salvos });
});

/** null quando o registro não tem nem `idPedido` — não dá pra guardar nada sem saber a que venda pertence. */
function paraEntradaMercadoLivre(bruto: unknown): MercadoLivreImportacaoEntrada | null {
  if (!bruto || typeof bruto !== "object") return null;
  const body = bruto as Record<string, unknown>;
  const idPedido = paraTexto(body.idPedido);
  if (!idPedido) return null;

  return {
    idPedido,
    motivoDevolucao: paraTexto(body.motivoDevolucao),
    cliente: paraTexto(body.cliente),
    cpf: paraTexto(body.cpf),
    corML: paraTexto(body.corML),
    skuML: paraTexto(body.skuML),
    dataRecebimento: paraTexto(body.dataRecebimento),
  };
}

/**
 * Recebe o que o Tampermonkey raspa da tela de detalhe de venda do Mercado Livre (ver
 * tampermonkey/devolucao-mercadolivre.user.js). Mesmo padrão de segurança do `/shopee`: token
 * próprio (MERCADOLIVRE_IMPORT_TOKEN), porque essa rota também não fala com o Tiny.
 */
devolucaoRouter.post("/mercadolivre", (req, res) => {
  const tokenConfigurado = process.env.MERCADOLIVRE_IMPORT_TOKEN;
  if (!tokenConfigurado) {
    res.status(503).json({ erro: "MERCADOLIVRE_IMPORT_TOKEN não configurado no servidor." });
    return;
  }
  if (req.get("x-import-token") !== tokenConfigurado) {
    res.status(401).json({ erro: "Token inválido." });
    return;
  }

  const bruto = Array.isArray(req.body) ? req.body : [req.body];
  const entradas = bruto.map(paraEntradaMercadoLivre);
  const validas = entradas.filter((entrada): entrada is MercadoLivreImportacaoEntrada => entrada != null);

  if (validas.length === 0) {
    res.status(400).json({ erro: "Nenhum registro válido — cada um precisa de pelo menos idPedido." });
    return;
  }

  const salvos = validas.map((entrada) => salvarImportacaoMercadoLivre(entrada).idPedido);
  res.status(201).json({ ok: true, salvos: salvos.length, ignorados: entradas.length - validas.length, idPedidos: salvos });
});

/**
 * Lê o número de série de uma foto de etiqueta via Groq (ver lib/groqOcr.ts). 503 quando
 * GROQ_API_KEY não está configurado — o front trata isso como "sem Groq disponível" e cai pro
 * OCR local, não como um erro pro usuário.
 */
devolucaoRouter.post("/ler-numero-serie", async (req, res) => {
  const imagem = req.body?.imagem;
  if (typeof imagem !== "string" || !imagem.startsWith("data:image/")) {
    res.status(400).json({ erro: "Envie a imagem em base64 (data URI)." });
    return;
  }

  try {
    const numeroSerie = await lerNumeroSerieComGroq(imagem);
    res.status(200).json({ numeroSerie });
  } catch (error) {
    if (error instanceof GroqConfigError) {
      res.status(503).json({ erro: error.message });
      return;
    }
    const mensagem = error instanceof Error ? error.message : "Erro inesperado ao ler a imagem.";
    res.status(502).json({ erro: mensagem });
  }
});

// ---------- Histórico (ver lib/devolucaoHistorico.ts) ----------

function erroDe(error: unknown, padrao: string): string {
  return error instanceof Error ? error.message : padrao;
}

function paraEntradaHistorico(bruto: unknown): EntradaDevolucao | null {
  if (!bruto || typeof bruto !== "object") return null;
  const b = bruto as Record<string, unknown>;
  const texto = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const data = brParaIso(texto(b.dataPedidoSac)) ?? (/^\d{4}-\d{2}-\d{2}$/.test(texto(b.data)) ? texto(b.data) : null);
  const nf = texto(b.nf);
  const produto = texto(b.produto);
  if (!data || !nf || !produto) return null;
  return {
    data,
    nf,
    idPedido: texto(b.idPedido),
    cliente: texto(b.cliente),
    marketplace: texto(b.marketplace),
    ocorrencia: texto(b.ocorrencia),
    observacoes: texto(b.observacoes),
    quantidade: paraNumero(b.quantidade) ?? 1,
    produto,
    codigoProduto: texto(b.codigoProduto),
    dataRecebimento: texto(b.dataRecebimento),
    defeito: texto(b.defeito),
    codigoFabricante: texto(b.codigoFabricante),
    status: texto(b.status),
    reembolso: texto(b.reembolso),
    valorReembolso: paraNumero(b.valorReembolso),
    origem: "tela",
  };
}

devolucaoRouter.post("/historico", async (req, res) => {
  const brutos: unknown[] = Array.isArray(req.body?.registros) ? req.body.registros : [];
  const entradas = brutos.map(paraEntradaHistorico).filter((e): e is EntradaDevolucao => e !== null);
  if (entradas.length === 0) {
    res.status(400).json({ erro: "Nenhuma linha válida (precisa de data dd/mm/aaaa, NF e produto)." });
    return;
  }
  try {
    res.status(201).json(await registrarDevolucoes(entradas));
  } catch (error) {
    res.status(500).json({ erro: erroDe(error, "Não consegui salvar no histórico.") });
  }
});

devolucaoRouter.post("/historico/importar", async (req, res) => {
  const texto = typeof req.body?.texto === "string" ? req.body.texto : "";
  const { entradas, ignoradas } = parsearLinhasPlanilha(texto);
  if (entradas.length === 0) {
    res.status(400).json({ erro: "Nenhuma linha reconhecida — cole as linhas da planilha (colunas A até O), sem o cabeçalho." });
    return;
  }
  try {
    const resultado = await registrarDevolucoes(entradas);
    res.status(201).json({ ...resultado, ignoradas });
  } catch (error) {
    res.status(500).json({ erro: erroDe(error, "Não consegui importar.") });
  }
});

devolucaoRouter.get("/historico", async (req, res) => {
  const de = String(req.query.de ?? "");
  const ate = String(req.query.ate ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(de) || !/^\d{4}-\d{2}-\d{2}$/.test(ate) || de > ate) {
    res.status(400).json({ erro: "Informe o período (de/ate no formato aaaa-mm-dd)." });
    return;
  }
  try {
    res.status(200).json({ registros: await listarDevolucoes(de, ate), vendasPorCodigo: await vendasPorCodigoNoPeriodo(de, ate) });
  } catch (error) {
    res.status(500).json({ erro: erroDe(error, "Não consegui carregar o histórico.") });
  }
});

devolucaoRouter.delete("/historico", async (req, res) => {
  const id = typeof req.body?.id === "string" ? req.body.id : "";
  const registradoEm = typeof req.body?.registradoEm === "string" ? req.body.registradoEm : "";
  if (!id || !registradoEm) {
    res.status(400).json({ erro: "Informe o registro a remover." });
    return;
  }
  try {
    await removerDevolucao(id, registradoEm);
    res.status(204).end();
  } catch (error) {
    res.status(500).json({ erro: erroDe(error, "Não consegui remover.") });
  }
});

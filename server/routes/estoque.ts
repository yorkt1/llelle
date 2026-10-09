import { Router } from "express";
import {
  CloudinaryConfigError,
  adicionarProduto,
  definirMetadados,
  listarEstoque,
  listarProdutos,
  obterHistorico,
  registrarContagem,
  removerProduto,
  adicionarProdutos,
  removerPosicao,
  removerRua,
  dividirProdutosPorVoltagem,
  normalizarNomesComVoltagemDuplicada,
} from "../../lib/estoque";
import { StoreConfigError } from "../../lib/store";
import { OlistConfigError } from "../../lib/olist";
import { buscarProdutosTiny } from "../../lib/catalogoTiny";
import {
  copiarFotoParaProdutos,
  definirFotoManual,
  listarInfoProdutos,
  normalizarInfoProdutos,
  refazerFotoDoTiny,
  registrarInfoProdutos,
  solicitarFotosFaltantes,
} from "../../lib/fotosProdutos";

export const estoqueRouter = Router();

estoqueRouter.get("/", async (_req, res) => {
  try {
    const ruas = await listarEstoque();
    res.status(200).json({ ruas });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Erro inesperado ao listar o estoque." });
  }
});

estoqueRouter.get("/produtos", async (_req, res) => {
  try {
    const [produtos, info] = await Promise.all([listarProdutos(), listarInfoProdutos()]);
    // `info` = foto e IDs do Tiny por produto (chave: nome em minúsculas) — ver lib/fotosProdutos.ts.
    res.status(200).json({ produtos, info });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Erro inesperado ao listar produtos." });
  }
});

estoqueRouter.post("/produtos", async (req, res) => {
  const nome = paraTextoObrigatorio(req.body?.nome);
  if (!nome) {
    res.status(400).json({ error: "Informe o nome do produto." });
    return;
  }
  try {
    const produtos = await adicionarProduto(nome);
    await registrarInfoProdutos([{ nome }]);
    res.status(201).json({ produtos });
  } catch (error) {
    if (error instanceof StoreConfigError) {
      res.status(503).json({ error: error.message });
      return;
    }
    res.status(400).json({ error: error instanceof Error ? error.message : "Erro inesperado ao cadastrar o produto." });
  }
});

estoqueRouter.delete("/produtos/:nome", async (req, res) => {
  try {
    await removerProduto(decodeURIComponent(String(req.params.nome)));
    res.status(204).end();
  } catch (error) {
    if (error instanceof StoreConfigError) {
      res.status(503).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: error instanceof Error ? error.message : "Erro inesperado ao remover o produto." });
  }
});


// Rotas específicas ANTES das genéricas `/:rua/:codigo...` lá embaixo — senão "produtos/lote" e
// "rua/X" seriam lidos como rua+código.

estoqueRouter.post("/produtos/normalizar-voltagens", async (_req, res) => {
  try {
    const resultado = await normalizarNomesComVoltagemDuplicada();
    await normalizarInfoProdutos(resultado.mapaNomes);
    res.status(200).json({
      produtos: resultado.produtos,
      renomeados: resultado.renomeados,
      duplicadosRemovidos: resultado.duplicadosRemovidos,
      posicoesAtualizadas: resultado.posicoesAtualizadas,
      produtosComEstoquePreservado: resultado.produtosComEstoquePreservado,
    });
  } catch (error) {
    if (error instanceof StoreConfigError) {
      res.status(503).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: error instanceof Error ? error.message : "Não consegui padronizar os produtos." });
  }
});

estoqueRouter.post("/produtos/lote", async (req, res) => {
  const nomes: unknown[] = Array.isArray(req.body?.nomes) ? req.body.nomes : [];
  const validos = nomes.filter((n): n is string => typeof n === "string" && n.trim() !== "");
  if (validos.length === 0) {
    res.status(400).json({ error: "Nenhum nome de produto informado." });
    return;
  }
  // `itens` (opcional, vindo da busca do Tiny) traz os IDs de cada produto — a foto sai deles.
  const itens: { nome: string; idsTiny?: string[]; codigos?: string[] }[] = Array.isArray(req.body?.itens)
    ? req.body.itens.filter((i: unknown): i is { nome: string } => typeof (i as { nome?: unknown })?.nome === "string")
    : [];
  try {
    const resultado = await adicionarProdutos(validos);
    const porNome = new Map(itens.map((i) => [i.nome.trim().toLowerCase(), i]));
    await registrarInfoProdutos(validos.map((nome) => porNome.get(nome.trim().toLowerCase()) ?? { nome }));
    res.status(201).json(resultado);
  } catch (error) {
    if (error instanceof StoreConfigError) {
      res.status(503).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: error instanceof Error ? error.message : "Erro inesperado ao cadastrar os produtos." });
  }
});


estoqueRouter.post("/produtos/fotos/buscar", async (_req, res) => {
  try {
    res.status(202).json({ pendentes: await solicitarFotosFaltantes() });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Erro inesperado ao pedir as fotos." });
  }
});

// "Trocar foto" no detalhe do produto: foto escolhida/tirada na hora, guardada no Cloudinary.
estoqueRouter.post("/produtos/fotos/trocar", async (req, res) => {
  const nome = paraTextoObrigatorio(req.body?.nome);
  const fotoDataUri = paraTextoObrigatorio(req.body?.fotoDataUri);
  if (!nome || !fotoDataUri) {
    res.status(400).json({ error: "Informe o produto e a foto." });
    return;
  }
  try {
    res.status(200).json({ info: await definirFotoManual(nome, fotoDataUri) });
  } catch (error) {
    if (error instanceof CloudinaryConfigError || error instanceof StoreConfigError) {
      res.status(503).json({ error: error.message });
      return;
    }
    res.status(400).json({ error: error instanceof Error ? error.message : "Erro inesperado ao trocar a foto." });
  }
});

// "Usar foto do Tiny": descarta a foto atual e põe o produto na fila da busca automática de novo.
estoqueRouter.post("/produtos/fotos/tiny", async (req, res) => {
  const nome = paraTextoObrigatorio(req.body?.nome);
  if (!nome) {
    res.status(400).json({ error: "Informe o produto." });
    return;
  }
  try {
    await refazerFotoDoTiny(nome);
    res.status(202).json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Erro inesperado." });
  }
});

// "Separar por voltagem": produto sem a voltagem no nome vira um produto por voltagem (ver
// dividirProdutosPorVoltagem). `nomes` vazio = todos os produtos nessa situação.
estoqueRouter.post("/produtos/dividir-voltagem", async (req, res) => {
  const nomes: string[] = Array.isArray(req.body?.nomes) ? req.body.nomes.filter((n: unknown): n is string => typeof n === "string") : [];
  try {
    const resultado = await dividirProdutosPorVoltagem(nomes);
    for (const d of resultado.divisoes) await copiarFotoParaProdutos(d.original, d.novos);
    res.status(200).json(resultado);
  } catch (error) {
    if (error instanceof StoreConfigError) {
      res.status(503).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: error instanceof Error ? error.message : "Erro inesperado ao separar por voltagem." });
  }
});
estoqueRouter.get("/produtos/tiny", async (req, res) => {
  try {
    res.status(200).json({ produtos: await buscarProdutosTiny(String(req.query.termo ?? "")) });
  } catch (error) {
    if (error instanceof OlistConfigError) {
      res.status(503).json({ error: error.message });
      return;
    }
    res.status(400).json({ error: error instanceof Error ? error.message : "Erro inesperado ao buscar no Tiny." });
  }
});

estoqueRouter.delete("/rua/:rua", async (req, res) => {
  try {
    const posicoes = await removerRua(String(req.params.rua));
    res.status(200).json({ posicoesExcluidas: posicoes });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Erro inesperado ao excluir a rua." });
  }
});

estoqueRouter.delete("/posicao/:rua/:codigo", async (req, res) => {
  try {
    await removerPosicao(String(req.params.rua), String(req.params.codigo));
    res.status(204).end();
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Erro inesperado ao excluir a posição." });
  }
});
estoqueRouter.get("/:rua/:codigo/historico", async (req, res) => {
  try {
    const historico = await obterHistorico(String(req.params.rua), String(req.params.codigo));
    res.status(200).json({ historico });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Erro inesperado ao buscar o histórico." });
  }
});

estoqueRouter.put("/:rua/:codigo/metadados", async (req, res) => {
  const produto = paraTextoObrigatorio(req.body?.produto);
  const voltagem = paraTextoObrigatorio(req.body?.voltagem);
  if (!produto || !voltagem) {
    res.status(400).json({ error: "Produto e voltagem são obrigatórios." });
    return;
  }
  try {
    const metadados = await definirMetadados(String(req.params.rua), String(req.params.codigo), produto, voltagem);
    res.status(200).json({ metadados });
  } catch (error) {
    if (error instanceof StoreConfigError) {
      res.status(503).json({ error: error.message });
      return;
    }
    res.status(400).json({ error: error instanceof Error ? error.message : "Erro inesperado ao salvar produto/voltagem." });
  }
});

function paraQuantidade(valor: unknown): number | null {
  const numero = typeof valor === "number" ? valor : typeof valor === "string" ? Number(valor) : NaN;
  return Number.isFinite(numero) && numero >= 0 ? numero : null;
}

function paraTextoObrigatorio(valor: unknown): string | null {
  return typeof valor === "string" && valor.trim() !== "" ? valor.trim() : null;
}

estoqueRouter.post("/:rua/:codigo", async (req, res) => {
  const rua = paraTextoObrigatorio(req.params.rua);
  const codigo = paraTextoObrigatorio(req.params.codigo);
  const quantidade = paraQuantidade(req.body?.quantidade);
  const responsavel = paraTextoObrigatorio(req.body?.responsavel);
  const fotoDataUri = paraTextoObrigatorio(req.body?.fotoDataUri);
  const produto = paraTextoObrigatorio(req.body?.produto) ?? undefined;
  const voltagem = paraTextoObrigatorio(req.body?.voltagem) ?? undefined;

  if (!rua || !codigo) {
    res.status(400).json({ error: "Rua e código da posição são obrigatórios." });
    return;
  }
  if (quantidade === null) {
    res.status(400).json({ error: "Quantidade precisa ser um número maior ou igual a zero." });
    return;
  }
  if (!responsavel) {
    res.status(400).json({ error: "Informe quem fez a contagem." });
    return;
  }
  if (!fotoDataUri) {
    res.status(400).json({ error: "Tire ou escolha uma foto — toda contagem precisa de uma foto própria." });
    return;
  }

  try {
    const registro = await registrarContagem({ rua, codigo, quantidade, responsavel, fotoDataUri, produto, voltagem });
    res.status(201).json({ registro });
  } catch (error) {
    if (error instanceof CloudinaryConfigError || error instanceof StoreConfigError) {
      res.status(503).json({ error: error.message });
      return;
    }
    res.status(400).json({ error: error instanceof Error ? error.message : "Erro inesperado ao registrar a contagem." });
  }
});

// Não existe mais rota /foto/:arquivo — a foto agora é uma URL do Cloudinary, servida direto do
// navegador pra esse domínio, sem passar pelo nosso backend (ver lib/estoque.ts).

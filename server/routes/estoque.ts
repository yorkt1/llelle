import { Router } from "express";
import {
  CloudinaryConfigError,
  criarLongarina,
  definirMetadados,
  listarEstoque,
  listarProdutos,
  obterHistorico,
  registrarContagem,
  removerProduto,
  adicionarProdutos,
  removerPosicao,
  removerRua,
  renomearLongarina,
  dividirProdutosPorVoltagem,
  normalizarNomesComVoltagemDuplicada,
  obterLimiteEstoqueBaixo,
  definirLimiteEstoqueBaixo,
  listarUnidadesPorCaixa,
  definirUnidadesPorCaixa,
  ContagemConflitoError,
  registrarMovimentacao,
  mesclarProdutos,
  LongarinaComGavetasError,
} from "../../lib/estoque";
import { StoreConfigError } from "../../lib/store";
import { OlistConfigError } from "../../lib/olist";
import { buscarProdutosTiny } from "../../lib/catalogoTiny";
import { listarColaboradores } from "../../lib/embalagem";
import {
  copiarFotoParaProdutos,
  definirFotoManual,
  listarInfoProdutos,
  normalizarInfoProdutos,
  registrarInfoProdutos,
  importarFotosFaltantesTiny,
} from "../../lib/fotosProdutos";

export const estoqueRouter = Router();

async function responsavelEstaCadastrado(nome: string): Promise<boolean> {
  const chave = nome.trim().toLocaleLowerCase("pt-BR");
  const colaboradores = await listarColaboradores();
  return colaboradores.some((colaborador) => colaborador.nome.trim().toLocaleLowerCase("pt-BR") === chave);
}

estoqueRouter.get("/", async (_req, res) => {
  try {
    const ruas = await listarEstoque();
    res.status(200).json({ ruas });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Erro inesperado ao listar o estoque." });
  }
});

estoqueRouter.get("/configuracao-alerta", async (_req, res) => {
  try {
    res.status(200).json({ limiteEstoqueBaixo: await obterLimiteEstoqueBaixo() });
  } catch (error) {
    res.status(error instanceof StoreConfigError ? 503 : 500).json({
      error: error instanceof Error ? error.message : "Não consegui carregar a configuração do alerta.",
    });
  }
});

estoqueRouter.put("/configuracao-alerta", async (req, res) => {
  const limite = req.body?.limiteEstoqueBaixo;
  if (typeof limite !== "number" || !Number.isSafeInteger(limite) || limite < 0) {
    res.status(400).json({ error: "O limite deve ser um número inteiro igual ou maior que zero." });
    return;
  }
  try {
    res.status(200).json({ limiteEstoqueBaixo: await definirLimiteEstoqueBaixo(limite) });
  } catch (error) {
    res.status(error instanceof StoreConfigError ? 503 : 500).json({
      error: error instanceof Error ? error.message : "Não consegui salvar a configuração do alerta.",
    });
  }
});

estoqueRouter.get("/produtos", async (_req, res) => {
  try {
    const [produtos, info, unidadesPorCaixa] = await Promise.all([listarProdutos(), listarInfoProdutos(), listarUnidadesPorCaixa()]);
    // `info` = foto e IDs do Tiny por produto (chave: nome em minúsculas) — ver lib/fotosProdutos.ts.
    res.status(200).json({ produtos, info, unidadesPorCaixa });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Erro inesperado ao listar produtos." });
  }
});

estoqueRouter.put("/produtos/embalagens", async (req, res) => {
  const produto = paraTextoObrigatorio(req.body?.produto);
  const unidadesPorCaixa: unknown = req.body?.unidadesPorCaixa;
  if (!produto) {
    res.status(400).json({ error: "Informe o produto." });
    return;
  }
  if (unidadesPorCaixa !== null && (typeof unidadesPorCaixa !== "number" || !Number.isSafeInteger(unidadesPorCaixa) || unidadesPorCaixa < 1)) {
    res.status(400).json({ error: "A quantidade por caixa deve ser um número inteiro maior que zero, ou vazia para remover a configuração." });
    return;
  }
  try {
    const configuracoes = await definirUnidadesPorCaixa(produto, unidadesPorCaixa);
    res.status(200).json({ unidadesPorCaixa: configuracoes });
  } catch (error) {
    res.status(error instanceof StoreConfigError ? 503 : 400).json({
      error: error instanceof Error ? error.message : "Não consegui salvar a quantidade por caixa.",
    });
  }
});

estoqueRouter.post("/produtos", async (req, res) => {
  res.status(400).json({ error: "Cadastre novos produtos pela busca do Tiny, vinculando o SKU." });
});

estoqueRouter.post("/produtos/mesclar", async (req, res) => {
  const origem = paraTextoObrigatorio(req.body?.origem);
  const destino = paraTextoObrigatorio(req.body?.destino);
  if (!origem || !destino) {
    res.status(400).json({ error: "Selecione o produto de origem e o produto que vai mantê-lo." });
    return;
  }
  try {
    const catalogo = await listarProdutos();
    const produtoOrigem = catalogo.find((produto) => produto.toLocaleLowerCase("pt-BR") === origem.toLocaleLowerCase("pt-BR"));
    const produtoDestino = catalogo.find((produto) => produto.toLocaleLowerCase("pt-BR") === destino.toLocaleLowerCase("pt-BR"));
    if (!produtoOrigem || !produtoDestino) {
      res.status(400).json({ error: "Escolha dois produtos que estejam no catálogo." });
      return;
    }
    if (produtoOrigem.toLocaleLowerCase("pt-BR") === produtoDestino.toLocaleLowerCase("pt-BR")) {
      res.status(400).json({ error: "Escolha produtos diferentes para mesclar." });
      return;
    }
    await normalizarInfoProdutos({ [produtoOrigem]: produtoDestino });
    const resultado = await mesclarProdutos(produtoOrigem, produtoDestino);
    res.status(200).json({ ...resultado, info: await listarInfoProdutos() });
  } catch (error) {
    if (error instanceof StoreConfigError) {
      res.status(503).json({ error: error.message });
      return;
    }
    res.status(400).json({ error: error instanceof Error ? error.message : "Não consegui mesclar os produtos." });
  }
});

estoqueRouter.delete("/produtos/:nome", async (req, res) => {
  try {
    const nome = decodeURIComponent(String(req.params.nome));
    const ruas = await listarEstoque();
    const possuiGavetas = ruas.some((rua) => rua.posicoes.some((posicao) => posicao.produto?.toLowerCase() === nome.toLowerCase()));
    if (possuiGavetas) {
      res.status(409).json({ error: "Não é possível excluir este produto enquanto houver gavetas vinculadas a ele." });
      return;
    }
    await removerProduto(nome);
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

estoqueRouter.post("/longarinas", async (req, res) => {
  const nome = paraTextoObrigatorio(req.body?.nome);
  if (!nome) {
    res.status(400).json({ error: "Informe o nome da longarina." });
    return;
  }
  try {
    const longarina = await criarLongarina(nome);
    res.status(201).json({ longarina });
  } catch (error) {
    res.status(error instanceof StoreConfigError ? 503 : 400).json({
      error: error instanceof Error ? error.message : "Não consegui criar a longarina.",
    });
  }
});

estoqueRouter.put("/longarinas/:rua", async (req, res) => {
  const nome = paraTextoObrigatorio(req.body?.nome);
  if (!nome) {
    res.status(400).json({ error: "Informe o novo nome da longarina." });
    return;
  }
  try {
    const longarina = await renomearLongarina(String(req.params.rua), nome);
    res.status(200).json({ longarina });
  } catch (error) {
    res.status(error instanceof StoreConfigError ? 503 : 400).json({
      error: error instanceof Error ? error.message : "Não consegui renomear a longarina.",
    });
  }
});

estoqueRouter.delete("/longarinas/:rua", async (req, res) => {
  try {
    const gavetasExcluidas = await removerRua(String(req.params.rua));
    res.status(200).json({ gavetasExcluidas });
  } catch (error) {
    res.status(error instanceof StoreConfigError ? 503 : error instanceof LongarinaComGavetasError ? 409 : 500).json({
      error: error instanceof Error ? error.message : "Não consegui excluir a longarina.",
    });
  }
});

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
  const itens: { nome: string; idsTiny: string[]; codigos: string[] }[] = Array.isArray(req.body?.itens)
    ? req.body.itens.flatMap((value: unknown) => {
        if (typeof value !== "object" || value === null) return [];
        const item = value as { nome?: unknown; idsTiny?: unknown; codigos?: unknown };
        if (typeof item.nome !== "string" || !Array.isArray(item.idsTiny) || !Array.isArray(item.codigos)) return [];
        return [{
          nome: item.nome.trim(),
          idsTiny: item.idsTiny.filter((id): id is string => typeof id === "string" && id.trim() !== ""),
          codigos: item.codigos.filter((codigo): codigo is string => typeof codigo === "string" && codigo.trim() !== ""),
        }];
      })
    : [];
  const porNome = new Map(itens.map((item) => [item.nome.toLocaleLowerCase(), item]));
  if (validos.some((nome) => {
    const item = porNome.get(nome.trim().toLocaleLowerCase());
    return !item || item.idsTiny.length === 0 || item.codigos.length === 0;
  })) {
    res.status(400).json({ error: "Cada produto precisa ser selecionado no Tiny e ter SKU vinculado." });
    return;
  }
  try {
    const resultado = await adicionarProdutos(validos);
    await registrarInfoProdutos(validos.map((nome) => porNome.get(nome.trim().toLocaleLowerCase())!));
    res.status(201).json(resultado);
  } catch (error) {
    if (error instanceof StoreConfigError) {
      res.status(503).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: error instanceof Error ? error.message : "Erro inesperado ao cadastrar os produtos." });
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

estoqueRouter.post("/produtos/fotos/importar-faltantes", async (req, res) => {
  const nomes = Array.isArray(req.body?.nomes)
    ? req.body.nomes.filter((nome: unknown): nome is string => typeof nome === "string").map((nome: string) => nome.trim()).filter(Boolean)
    : [];
  if (nomes.length === 0 || nomes.length > 5) {
    res.status(400).json({ error: "Envie de 1 a 5 produtos por lote." });
    return;
  }
  try {
    const resultados = await importarFotosFaltantesTiny(nomes);
    const info = await listarInfoProdutos();
    res.status(200).json({ resultados, info });
  } catch (error) {
    if (error instanceof OlistConfigError || error instanceof CloudinaryConfigError || error instanceof StoreConfigError) {
      res.status(503).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: error instanceof Error ? error.message : "Erro inesperado ao buscar fotos no Tiny." });
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
    res.status(error instanceof LongarinaComGavetasError ? 409 : error instanceof StoreConfigError ? 503 : 500).json({
      error: error instanceof Error ? error.message : "Erro inesperado ao excluir a rua.",
    });
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

estoqueRouter.post("/:rua/:codigo/movimentos", async (req, res) => {
  const tipo = req.body?.tipo;
  const quantidade = paraQuantidade(req.body?.quantidade);
  const responsavel = paraTextoObrigatorio(req.body?.responsavel);
  const motivo = paraTextoObrigatorio(req.body?.motivo);
  const expectedUltimaId = req.body?.expectedUltimaId;
  const destinoBody = req.body?.destino;
  const destino =
    destinoBody && typeof destinoBody === "object"
      ? {
          rua: paraTextoObrigatorio(destinoBody.rua),
          codigo: paraTextoObrigatorio(destinoBody.codigo),
          expectedUltimaId: destinoBody.expectedUltimaId,
        }
      : undefined;

  if (!["entrada", "saida", "transferencia", "ajuste"].includes(tipo)) {
    res.status(400).json({ error: "Tipo de movimentação inválido." });
    return;
  }
  if (
    quantidade === null ||
    (tipo !== "ajuste" && quantidade === 0) ||
    !responsavel ||
    !motivo ||
    motivo.length > 500 ||
    typeof expectedUltimaId !== "string" ||
    !expectedUltimaId
  ) {
    res.status(400).json({ error: "Informe uma quantidade válida, o motivo (até 500 caracteres), quem movimentou e a versão atual da gaveta." });
    return;
  }
  if (
    tipo === "transferencia" &&
    (!destino?.rua || !destino.codigo || typeof destino.expectedUltimaId !== "string" || !destino.expectedUltimaId)
  ) {
    res.status(400).json({ error: "Informe a gaveta de destino e sua versão atual." });
    return;
  }

  try {
    if (!(await responsavelEstaCadastrado(responsavel))) {
      res.status(400).json({ error: "Selecione uma pessoa cadastrada no módulo Embalagem." });
      return;
    }
    const eventos = await registrarMovimentacao({
      rua: String(req.params.rua),
      codigo: String(req.params.codigo),
      tipo,
      quantidade,
      responsavel,
      motivo,
      expectedUltimaId,
      ...(tipo === "transferencia"
        ? {
            destino: {
              rua: destino!.rua!,
              codigo: destino!.codigo!,
              expectedUltimaId: destino!.expectedUltimaId as string,
            },
          }
        : {}),
    });
    res.status(201).json({ eventos });
  } catch (error) {
    if (error instanceof ContagemConflitoError) {
      res.status(409).json({ error: error.message });
      return;
    }
    if (error instanceof StoreConfigError) {
      res.status(503).json({ error: error.message });
      return;
    }
    res.status(400).json({ error: error instanceof Error ? error.message : "Erro inesperado ao registrar a movimentação." });
  }
});

function paraQuantidade(valor: unknown): number | null {
  const numero = typeof valor === "number" ? valor : typeof valor === "string" ? Number(valor) : NaN;
  return Number.isSafeInteger(numero) && numero >= 0 ? numero : null;
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
  const expectedUltimaId = req.body?.expectedUltimaId;

  if (!rua || !codigo) {
    res.status(400).json({ error: "Rua e código da posição são obrigatórios." });
    return;
  }
  if (quantidade === null) {
    res.status(400).json({ error: "Quantidade precisa ser um número inteiro maior ou igual a zero." });
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
  if (expectedUltimaId !== undefined && expectedUltimaId !== null && typeof expectedUltimaId !== "string") {
    res.status(400).json({ error: "Identificador da contagem anterior inválido." });
    return;
  }
  if (expectedUltimaId === undefined) {
    res.status(400).json({ error: "Atualize a gaveta antes de registrar a contagem." });
    return;
  }

  try {
    if (!(await responsavelEstaCadastrado(responsavel))) {
      res.status(400).json({ error: "Selecione uma pessoa cadastrada no módulo Embalagem." });
      return;
    }
    const registro = await registrarContagem({
      rua, codigo, quantidade, responsavel, fotoDataUri, produto, voltagem, expectedUltimaId,
      motivo: paraTextoObrigatorio(req.body?.motivo) ?? undefined,
    });
    res.status(201).json({ registro });
  } catch (error) {
    if (error instanceof ContagemConflitoError) {
      res.status(409).json({ error: error.message });
      return;
    }
    if (error instanceof CloudinaryConfigError || error instanceof StoreConfigError) {
      res.status(503).json({ error: error.message });
      return;
    }
    res.status(400).json({ error: error instanceof Error ? error.message : "Erro inesperado ao registrar a contagem." });
  }
});

// Não existe mais rota /foto/:arquivo — a foto agora é uma URL do Cloudinary, servida direto do
// navegador pra esse domínio, sem passar pelo nosso backend (ver lib/estoque.ts).

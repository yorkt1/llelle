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
} from "../../lib/estoque";
import { StoreConfigError } from "../../lib/store";

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
    const produtos = await listarProdutos();
    res.status(200).json({ produtos });
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

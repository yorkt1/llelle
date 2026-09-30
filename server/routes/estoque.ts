import { Router } from "express";
import { caminhoDaFoto, listarEstoque, obterHistorico, registrarContagem } from "../../lib/estoque";

export const estoqueRouter = Router();

estoqueRouter.get("/", async (_req, res) => {
  try {
    const ruas = await listarEstoque();
    res.status(200).json({ ruas });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Erro inesperado ao listar o estoque." });
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
    const registro = await registrarContagem({ rua, codigo, quantidade, responsavel, fotoDataUri });
    res.status(201).json({ registro });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Erro inesperado ao registrar a contagem." });
  }
});

// Serve a foto de um registro específico — indireto (por id, não pelo nome de arquivo direto)
// pra não precisar expor a pasta de fotos inteira como estática.
estoqueRouter.get("/foto/:arquivo", async (req, res) => {
  const arquivo = String(req.params.arquivo);
  // Nunca deixa o parâmetro sair da pasta de fotos (ex.: "../../server/index.ts").
  if (!/^[\w-]+\.(jpg|jpeg|png|webp)$/i.test(arquivo)) {
    res.status(400).json({ error: "Nome de arquivo inválido." });
    return;
  }
  res.sendFile(caminhoDaFoto(arquivo), (error) => {
    if (error) res.status(404).json({ error: "Foto não encontrada." });
  });
});

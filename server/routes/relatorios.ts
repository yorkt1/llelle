import { randomUUID } from "node:crypto";
import { Router } from "express";
import ExcelJS from "exceljs";
import { handle, fail, ok } from "../http";
import { gerarRelatorioVendas, pivotarPorDia, type LinhaVendaDiaria, type Progresso } from "../../lib/relatorioVendas";

export const relatoriosRouter = Router();

type Job = {
  status: "processando" | "concluido" | "erro";
  progresso: Progresso;
  termo: string;
  dataInicial: string;
  dataFinal: string;
  linhas?: LinhaVendaDiaria[];
  erro?: string;
};

// Em memória de propósito: relatório é sob demanda e efêmero, não precisa sobreviver a um redeploy.
// Guardado por no máximo 1h pra não acumular na memória se ninguém baixar o arquivo.
const jobs = new Map<string, Job>();
const JOB_TTL_MS = 60 * 60 * 1000;

relatoriosRouter.post(
  "/vendas",
  handle(async (req, res) => {
    const body = req.body as Record<string, unknown>;
    const termo = typeof body.termo === "string" ? body.termo.trim() : "";
    const dataInicial = typeof body.dataInicial === "string" ? body.dataInicial : "";
    const dataFinal = typeof body.dataFinal === "string" ? body.dataFinal : "";
    if (!termo || !dataInicial || !dataFinal) {
      fail(res, "Informe o produto, a data inicial e a data final.", 400);
      return;
    }

    const id = randomUUID();
    jobs.set(id, { status: "processando", progresso: { atual: 0, total: 0 }, termo, dataInicial, dataFinal });
    setTimeout(() => jobs.delete(id), JOB_TTL_MS);

    void gerarRelatorioVendas(termo, dataInicial, dataFinal, (progresso) => {
      const job = jobs.get(id);
      if (job) job.progresso = progresso;
    })
      .then((linhas) => {
        const job = jobs.get(id);
        if (job) {
          job.status = "concluido";
          job.linhas = linhas;
        }
      })
      .catch((error: unknown) => {
        const job = jobs.get(id);
        if (job) {
          job.status = "erro";
          job.erro = error instanceof Error ? error.message : "Erro inesperado ao gerar o relatório.";
        }
      });

    ok(res, { jobId: id }, 202);
  }),
);

relatoriosRouter.get(
  "/vendas/:id",
  handle(async (req, res) => {
    const job = jobs.get(String(req.params.id));
    if (!job) {
      fail(res, "Relatório não encontrado (pode ter expirado — gere de novo).", 404);
      return;
    }
    ok(res, { status: job.status, progresso: job.progresso, erro: job.erro });
  }),
);

relatoriosRouter.get(
  "/vendas/:id/download",
  handle(async (req, res) => {
    const job = jobs.get(String(req.params.id));
    if (!job) {
      fail(res, "Relatório não encontrado (pode ter expirado — gere de novo).", 404);
      return;
    }
    if (job.status !== "concluido" || !job.linhas) {
      fail(res, "Relatório ainda não está pronto.", 409);
      return;
    }

    const pivot = pivotarPorDia(job.linhas, job.dataInicial, job.dataFinal);
    const workbook = new ExcelJS.Workbook();
    const planilha = workbook.addWorksheet("Vendas por dia");

    planilha.columns = [
      { header: "Data", key: "data", width: 12 },
      ...pivot.produtos.map((produto) => ({ header: produto, key: produto, width: 26 })),
    ];
    planilha.getRow(1).font = { bold: true };

    for (const dia of pivot.dias) {
      const [ano, mes, diaNumero] = dia.split("-");
      const linha: Record<string, unknown> = { data: `${diaNumero}/${mes}/${ano}` };
      for (const produto of pivot.produtos) linha[produto] = pivot.quantidadePorDiaEProduto[dia][produto];
      planilha.addRow(linha);
    }

    const buffer = await workbook.xlsx.writeBuffer();
    const nomeArquivo = `vendas-${job.termo.toLowerCase().replace(/\s+/g, "-")}-${job.dataInicial}_a_${job.dataFinal}.xlsx`;
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${nomeArquivo}"`);
    res.send(Buffer.from(buffer));
  }),
);

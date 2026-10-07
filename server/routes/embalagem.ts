import { Router } from "express";
import { StoreConfigError } from "../../lib/store";
import { OlistConfigError } from "../../lib/olist";
import ExcelJS from "exceljs";
import {
  listarColaboradores,
  obterDesempenho,
  relatorioMensal,
  removerColaborador,
  salvarColaborador,
  salvarMetaMensal,
  type RelatorioMensalEmbalagem,
} from "../../lib/embalagem";

export const embalagemRouter = Router();

// ?dia=dd/mm/yyyy — sem isso, usa hoje (fuso de São Paulo, ver lib/olist.ts).
embalagemRouter.get("/", async (req, res) => {
  try {
    const dia = typeof req.query.dia === "string" ? req.query.dia : undefined;
    const desempenho = await obterDesempenho(dia);
    res.status(200).json(desempenho);
  } catch (error) {
    if (error instanceof OlistConfigError) {
      res.status(503).json({ erro: error.message });
      return;
    }
    const mensagem = error instanceof Error ? error.message : "Erro inesperado ao calcular o desempenho de embalagem.";
    res.status(500).json({ erro: mensagem });
  }
});

embalagemRouter.get("/colaboradores", async (_req, res) => {
  try {
    const colaboradores = await listarColaboradores();
    res.status(200).json({ colaboradores });
  } catch (error) {
    res.status(500).json({ erro: error instanceof Error ? error.message : "Erro inesperado ao listar colaboradores." });
  }
});

embalagemRouter.post("/colaboradores", async (req, res) => {
  const idUsuarioEmbalador = String(req.body?.idUsuarioEmbalador ?? "");
  const nome = String(req.body?.nome ?? "");
  const bancada = req.body?.bancada ? String(req.body.bancada) : undefined;
  try {
    const colaborador = await salvarColaborador(idUsuarioEmbalador, nome, bancada);
    res.status(201).json({ colaborador });
  } catch (error) {
    if (error instanceof StoreConfigError) {
      res.status(503).json({ erro: error.message });
      return;
    }
    res.status(400).json({ erro: error instanceof Error ? error.message : "Erro inesperado ao salvar o colaborador." });
  }
});

embalagemRouter.delete("/colaboradores/:idUsuarioEmbalador", async (req, res) => {
  try {
    await removerColaborador(String(req.params.idUsuarioEmbalador));
    res.status(204).end();
  } catch (error) {
    if (error instanceof StoreConfigError) {
      res.status(503).json({ erro: error.message });
      return;
    }
    res.status(500).json({ erro: error instanceof Error ? error.message : "Erro inesperado ao remover o colaborador." });
  }
});

// ---------- Relatório mensal / do dia (lê só o cache — nunca chama o Tiny no request) ----------

function mesDaQuery(valor: unknown): string | null {
  return typeof valor === "string" && /^\d{4}-\d{2}$/.test(valor) ? valor : null;
}

embalagemRouter.get("/relatorio", async (req, res) => {
  const mes = mesDaQuery(req.query.mes);
  if (!mes) {
    res.status(400).json({ erro: "Informe o mês (?mes=aaaa-mm)." });
    return;
  }
  try {
    res.status(200).json(await relatorioMensal(mes));
  } catch (error) {
    res.status(500).json({ erro: error instanceof Error ? error.message : "Erro inesperado ao montar o relatório." });
  }
});

embalagemRouter.put("/meta", async (req, res) => {
  const bruto = req.body?.metaMensal;
  const meta = bruto === null || bruto === "" || bruto === undefined ? null : Number(bruto);
  try {
    res.status(200).json({ metaMensal: await salvarMetaMensal(meta) });
  } catch (error) {
    res.status(500).json({ erro: error instanceof Error ? error.message : "Erro inesperado ao salvar a meta." });
  }
});

/** Mesmo layout da planilha que já usavam: colaborador × dia, dia da semana em cima, total no fim. */
async function planilhaMensal(relatorio: RelatorioMensalEmbalagem): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const [ano, mes] = relatorio.mes.split("-");
  const planilha = workbook.addWorksheet(`Embalagem ${mes}-${ano}`, { views: [{ state: "frozen", xSplit: 1, ySplit: 3 }] });
  const nDias = relatorio.dias.length;
  const temMeta = relatorio.metaMensal !== null;

  const titulo = planilha.addRow([`RELATÓRIO DE DESEMPENHO MENSAL — EMBALAGEM — ${mes}/${ano}`]);
  titulo.font = { bold: true, size: 13 };

  const extras = ["TOTAL", "DIAS TRAB.", "MÉDIA/DIA", ...(temMeta ? ["META", "% META"] : [])];
  const cabecalho = planilha.addRow(["FUNCIONÁRIO", ...relatorio.dias.map((d) => d.dia), ...extras]);
  const semana = planilha.addRow(["", ...relatorio.dias.map((d) => d.semana + (d.completo || d.futuro ? "" : "*")), ...extras.map(() => "")]);
  for (const linha of [cabecalho, semana]) linha.font = { bold: true };

  for (const c of relatorio.colaboradores) {
    const media = c.diasTrabalhados > 0 ? Math.round((c.total / c.diasTrabalhados) * 10) / 10 : 0;
    planilha.addRow([
      c.nome + (c.bancada ? ` (bancada ${c.bancada})` : ""),
      ...c.porDia.map((n, i) => (relatorio.dias[i].futuro ? "" : n)),
      c.total,
      c.diasTrabalhados,
      media,
      ...(temMeta ? [relatorio.metaMensal, relatorio.metaMensal ? c.total / relatorio.metaMensal : ""] : []),
    ]);
  }

  const totalLinha = planilha.addRow(["TOTAL DO DIA", ...relatorio.totalPorDia.map((n, i) => (relatorio.dias[i].futuro ? "" : n)), relatorio.total]);
  totalLinha.font = { bold: true };

  if (relatorio.dias.some((d) => !d.completo && !d.futuro)) {
    planilha.addRow([]);
    planilha.addRow(["* Dia com dados ainda parciais (o sistema ainda está conferindo esse dia com o Tiny)."]);
  }

  planilha.getColumn(1).width = 30;
  for (let i = 2; i <= nDias + 1; i++) planilha.getColumn(i).width = 5.5;
  for (let i = nDias + 2; i <= nDias + 1 + extras.length; i++) planilha.getColumn(i).width = 11;
  if (temMeta) planilha.getColumn(nDias + 1 + extras.length).numFmt = "0%";

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

embalagemRouter.get("/relatorio.xlsx", async (req, res) => {
  const mes = mesDaQuery(req.query.mes);
  if (!mes) {
    res.status(400).json({ erro: "Informe o mês (?mes=aaaa-mm)." });
    return;
  }
  try {
    const buffer = await planilhaMensal(await relatorioMensal(mes));
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="embalagem-${mes}.xlsx"`);
    res.send(buffer);
  } catch (error) {
    res.status(500).json({ erro: error instanceof Error ? error.message : "Erro inesperado ao gerar a planilha." });
  }
});

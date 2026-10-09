import { Router } from "express";
import ExcelJS from "exceljs";
import { excluirDiaPedidos, listarDiasPedidos, listarTodosDiasPedidos, obterDiaPedidos, salvarDiaPedidos, type DiaPedidos } from "../../lib/controlePedidos";
import { StoreConfigError } from "../../lib/store";

export const pedidosRouter = Router();

pedidosRouter.get("/planilha.xlsx", async (_req, res) => {
  try {
    const dias = await listarTodosDiasPedidos();
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "LLE Importadora";
    workbook.created = new Date();

    const resumo = workbook.addWorksheet("Resumo diário", { views: [{ state: "frozen", ySplit: 1 }] });
    resumo.columns = [
      { header: "Data", key: "data", width: 14 },
      { header: "Recebidos", key: "recebidos", width: 14 },
      { header: "Separados", key: "separados", width: 14 },
      { header: "Embalados", key: "embalados", width: 14 },
      { header: "Expedidos", key: "expedidos", width: 14 },
      { header: "Cancelados", key: "cancelados", width: 14 },
      { header: "Pendentes", key: "pendentes", width: 14 },
    ];

    const detalhes = workbook.addWorksheet("Detalhes por turno", { views: [{ state: "frozen", xSplit: 3, ySplit: 1 }] });
    detalhes.columns = [
      { header: "Data", key: "data", width: 14 },
      { header: "Turno", key: "turno", width: 20 },
      { header: "Horário", key: "horario", width: 16 },
      { header: "Responsável", key: "responsavel", width: 24 },
      { header: "Marketplace", key: "marketplace", width: 20 },
      { header: "Recebidos", key: "recebidos", width: 14 },
      { header: "Separados", key: "separados", width: 14 },
      { header: "Embalados", key: "embalados", width: 14 },
      { header: "Expedidos", key: "expedidos", width: 14 },
      { header: "Cancelados", key: "cancelados", width: 14 },
      { header: "Pendentes", key: "pendentes", width: 14 },
      { header: "Observações", key: "observacoes", width: 48 },
    ];

    for (const [planilha, ultimaColuna] of [[resumo, "G"], [detalhes, "L"]] as const) {
      planilha.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
      planilha.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F5FBF" } };
      planilha.autoFilter = { from: "A1", to: `${ultimaColuna}1` };
    }

    for (const dia of dias) {
      const dataFormatada = `${dia.data.slice(8, 10)}/${dia.data.slice(5, 7)}/${dia.data.slice(0, 4)}`;
      const totais = { recebidos: 0, separados: 0, embalados: 0, expedidos: 0, cancelados: 0 };

      for (const [chave, turno, horario] of [
        ["manha", "Turno manhã", "06h – 12h"],
        ["tarde", "Turno tarde", "12h – 18h"],
      ] as const) {
        const dados = dia[chave];
        for (const marketplace of [
          ["tiktok", "TikTok Shop"],
          ["ml", "Mercado Livre"],
          ["shopee", "Shopee"],
        ] as const) {
          const valores = dados[marketplace[0]];
          const pendentes = valores.recebidos - valores.expedidos - valores.cancelados;
          detalhes.addRow({
            data: dataFormatada,
            turno,
            horario,
            responsavel: dados.resp,
            marketplace: marketplace[1],
            ...valores,
            pendentes,
            observacoes: dados.obs,
          });
          for (const etapa of Object.keys(totais) as (keyof typeof totais)[]) totais[etapa] += valores[etapa];
        }
      }

      resumo.addRow({
        data: dataFormatada,
        ...totais,
        pendentes: totais.recebidos - totais.expedidos - totais.cancelados,
      });
    }

    const buffer = await workbook.xlsx.writeBuffer();
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="controle-de-pedidos.xlsx"');
    res.send(Buffer.from(buffer));
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Não consegui gerar a planilha do Controle de Pedidos." });
  }
});

pedidosRouter.get("/historico", async (req, res) => {
  const limite = Number(req.query.limite ?? 14);
  if (!Number.isInteger(limite) || limite < 1 || limite > 60) {
    res.status(400).json({ error: "O limite do histórico deve ser de 1 a 60 dias." });
    return;
  }
  try {
    res.status(200).json({ dias: await listarDiasPedidos(limite) });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Não consegui carregar o histórico de pedidos." });
  }
});

pedidosRouter.get("/:data", async (req, res) => {
  try {
    const dia = await obterDiaPedidos(String(req.params.data));
    res.status(200).json({ dia });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Não consegui carregar os pedidos desse dia." });
  }
});

pedidosRouter.delete("/:data", async (req, res) => {
  try {
    const excluido = await excluirDiaPedidos(String(req.params.data));
    if (!excluido) {
      res.status(404).json({ error: "Não há um registro salvo para essa data." });
      return;
    }
    res.status(204).end();
  } catch (error) {
    if (error instanceof StoreConfigError) {
      res.status(503).json({ error: error.message });
      return;
    }
    res.status(400).json({ error: error instanceof Error ? error.message : "Não consegui excluir esse dia." });
  }
});

pedidosRouter.put("/:data", async (req, res) => {
  try {
    const dia = await salvarDiaPedidos(String(req.params.data), req.body as Partial<DiaPedidos>);
    res.status(200).json({ dia });
  } catch (error) {
    if (error instanceof StoreConfigError) {
      res.status(503).json({ error: error.message });
      return;
    }
    res.status(400).json({ error: error instanceof Error ? error.message : "Não consegui salvar os pedidos." });
  }
});

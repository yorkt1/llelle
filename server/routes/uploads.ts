import { Router } from "express";
import multer from "multer";
import { handle, fail, ok } from "../http";
import { parseSalesReport, suggestReportDate } from "../../src/lib/domain/parser";
import { collectStatuses } from "../../src/lib/domain/aggregate";
import { getRepository } from "../../src/lib/storage";

export const uploadsRouter = Router();

const MAX_BYTES = 25 * 1024 * 1024;

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_BYTES } });

/** Recebe o relatorio do Tiny (CSV ou XLSX), parseia e guarda para os recalculos. */
uploadsRouter.post(
  "/",
  upload.single("file"),
  handle(async (req, res) => {
    const file = req.file;
    if (!file) return fail(res, "Envie um arquivo no campo 'file'.");
    if (file.size === 0) return fail(res, "Arquivo vazio.");

    const report = await parseSalesReport(file.buffer);
    if (report.headers.length === 0) return fail(res, "Nao consegui ler nenhuma linha deste arquivo.");

    const savedUpload = await getRepository().saveUpload({ filename: file.originalname, report });

    ok(res, {
      uploadId: savedUpload.id,
      filename: savedUpload.filename,
      detectedFormat: report.detectedFormat,
      headers: report.headers,
      mapping: report.mapping,
      warnings: report.warnings,
      totalRows: report.totalRows,
      lineCount: report.lines.length,
      statuses: collectStatuses(report),
      suggestedDate: suggestReportDate(report),
    });
  }),
);

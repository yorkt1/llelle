import type { Request, Response } from "express";
import { z } from "zod";
import { BusinessError } from "../src/lib/errors";

export function ok(res: Response, data: unknown, status = 200): void {
  res.status(status).json(data);
}

export function fail(res: Response, message: string, status = 400, extra?: Record<string, unknown>): void {
  res.status(status).json({ error: message, ...extra });
}

/**
 * Envelope unico das rotas: erro de validacao vira 400 com o campo problematico,
 * qualquer outra falha vira 500 com a mensagem — uso interno, sem stack trace.
 */
export function handle(fn: (req: Request, res: Response) => Promise<void>) {
  return async (req: Request, res: Response) => {
    try {
      await fn(req, res);
    } catch (error) {
      if (error instanceof z.ZodError) {
        const first = error.issues[0];
        const path = first?.path.join(".") ?? "";
        fail(res, path ? path + ": " + first.message : first.message, 400);
        return;
      }
      if (error instanceof BusinessError) {
        fail(res, error.message, 422);
        return;
      }
      const message = error instanceof Error ? error.message : "Erro inesperado.";
      fail(res, message, 500);
    }
  };
}

import type { Request, Response } from "express";
import { OlistConfigError } from "../lib/olist";

export function ok(res: Response, data: unknown, status = 200): void {
  res.status(status).json(data);
}

export function fail(res: Response, message: string, status = 400): void {
  res.status(status).json({ error: message });
}

export function handle(fn: (req: Request, res: Response) => Promise<void>) {
  return async (req: Request, res: Response) => {
    try {
      await fn(req, res);
    } catch (error) {
      if (error instanceof OlistConfigError) {
        fail(res, error.message, 503);
        return;
      }
      const message = error instanceof Error ? error.message : "Erro inesperado.";
      fail(res, message, 500);
    }
  };
}

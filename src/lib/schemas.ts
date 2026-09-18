import { z } from "zod";

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "data esperada no formato AAAA-MM-DD");

export const countingModeSchema = z.enum(["order", "invoice"]);

export const columnMappingSchema = z
  .object({
    productName: z.number().int().min(0),
    sku: z.number().int().min(0),
    quantity: z.number().int().min(0),
    orderNumber: z.number().int().min(0),
    orderDate: z.number().int().min(0),
    orderStatus: z.number().int().min(0),
    invoiceNumber: z.number().int().min(0),
    invoiceDate: z.number().int().min(0),
    invoiceStatus: z.number().int().min(0),
    channel: z.number().int().min(0),
  })
  .partial();

export const countingRulesSchema = z
  .object({
    excludedOrderStatuses: z.array(z.string()).max(50),
    excludedInvoiceStatuses: z.array(z.string()).max(50),
    excludedChannels: z.array(z.string()).max(50),
    requireInvoiceNumber: z.boolean(),
    ignoreDatesUseWholeFile: z.boolean(),
  })
  .partial();

export const computeSchema = z.object({
  uploadId: z.string().min(1),
  invoiceUploadId: z.string().min(1).nullish(),
  start: isoDate,
  end: isoDate.nullish(),
  mode: countingModeSchema,
  rules: countingRulesSchema.optional(),
  decisions: z.record(z.string(), z.string()).optional(),
  columnOverrides: columnMappingSchema.optional(),
});

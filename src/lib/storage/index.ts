import { LocalRepository } from "./local";
import { SupabaseRepository } from "./supabase";
import type { Repository } from "./types";

export type StorageDriver = "supabase" | "local";

function readSupabaseConfig(): { url: string; key: string } | null {
  const url = process.env.SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  return url.trim() && key.trim() ? { url: url.trim(), key: key.trim() } : null;
}

export function storageDriver(): StorageDriver {
  return readSupabaseConfig() ? "supabase" : "local";
}

let cached: Repository | null = null;

/**
 * Usa Supabase quando as credenciais existem; senao cai no arquivo JSON local.
 * Assim o app roda antes de qualquer configuracao e a troca depois e so env.
 */
export function getRepository(): Repository {
  if (cached) return cached;
  const config = readSupabaseConfig();
  cached = config ? new SupabaseRepository(config.url, config.key) : new LocalRepository();
  return cached;
}

export type { Repository } from "./types";

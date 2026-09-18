/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** URL pública da API (Render), só necessária quando o front roda num domínio separado (ex: Vercel). */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

import { apiBaseUrl, apiFormat, apiToken, isConfigured, OlistConfigError } from "./olist";

/**
 * Helper compartilhado pras chamadas GET à API 2.0 do Tiny/Olist — usado por
 * lib/relatorioVendas.ts e lib/devolucao.ts. lib/olist.ts tem seu próprio
 * fetchPage (mais antigo, sem retry), intocado aqui pra não arriscar
 * regressão no painel de separação já testado em produção.
 */

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function tinyUrl(endpoint: string, params: Record<string, string>): URL {
  const url = new URL(`${apiBaseUrl()}/${endpoint}`);
  url.searchParams.set("token", apiToken());
  url.searchParams.set("formato", apiFormat());
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url;
}

/** Retenta com backoff: uma rajada de chamadas pode fazer o Tiny recusar temporariamente ("Token inválido"), não é erro definitivo. */
export async function tinyGet<T>(endpoint: string, params: Record<string, string>, tentativas = 3): Promise<T> {
  if (!isConfigured()) {
    throw new OlistConfigError("OLIST_API_TOKEN precisa estar configurado.");
  }
  let ultimoErro: unknown;
  for (let tentativa = 1; tentativa <= tentativas; tentativa++) {
    try {
      const response = await fetch(tinyUrl(endpoint, params));
      if (!response.ok) throw new Error(`${endpoint} falhou (${response.status})`);
      return (await response.json()) as T;
    } catch (error) {
      ultimoErro = error;
      if (tentativa < tentativas) await sleep(150 * tentativa * 4);
    }
  }
  throw ultimoErro instanceof Error ? ultimoErro : new Error("Falha desconhecida ao consultar o Tiny.");
}

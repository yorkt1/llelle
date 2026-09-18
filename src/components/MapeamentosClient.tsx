import { useMemo, useState } from "react";
import { Badge, Button, Callout, Card, SectionTitle, inputClass } from "@/components/ui";
import { getJson, sendJson } from "@/lib/client/api";
import type { MappingsResponse } from "@/lib/client/types";
import { OUT_OF_SHEET } from "@/lib/domain/matching";

export function MapeamentosClient({ initial }: { initial: MappingsResponse }) {
  const [data, setData] = useState<MappingsResponse>(initial);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      setData(await getJson<MappingsResponse>("/api/mappings"));
    } catch {
      setError("Não consegui carregar os mapeamentos.");
    }
  }

  async function alterar(reportName: string, productId: string) {
    await sendJson("/api/mappings", { entries: [{ reportName, productId }] });
    await load();
  }

  async function remover(id: string) {
    await sendJson("/api/mappings", { id }, "DELETE");
    await load();
  }

  const visiveis = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return data.mappings;
    return data.mappings.filter(
      (item) =>
        item.reportName.toLowerCase().includes(term) ||
        (item.sheetName ?? "").toLowerCase().includes(term),
    );
  }, [data, search]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Mapeamentos</h1>
        <p className="mt-1 text-sm text-muted">
          O que o sistema aprendeu sobre qual nome do Tiny corresponde a qual linha da planilha. Corrigir
          aqui vale para todos os próximos dias.
        </p>
      </div>

      {error && <Callout tone="danger">{error}</Callout>}

      <Card>
        <SectionTitle
          title={`${data.mappings.length} nomes memorizados`}
          hint="Marcados como manuais foram confirmados por uma pessoa e nunca são sobrescritos por palpite automático."
        />
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Buscar por nome do anúncio ou da planilha..."
          className={`${inputClass} mb-3 max-w-md py-1.5 text-xs`}
        />

        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-muted text-left text-xs text-muted">
                <th className="px-3 py-2 font-medium">Nome no relatório do Tiny</th>
                <th className="px-3 py-2 font-medium">Linha da planilha</th>
                <th className="px-3 py-2 font-medium">Origem</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {visiveis.map((item) => (
                <tr key={item.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2">{item.reportName}</td>
                  <td className="px-3 py-1.5">
                    <select
                      value={item.outOfSheet ? OUT_OF_SHEET : (item.productId ?? "")}
                      onChange={(event) => void alterar(item.reportName, event.target.value)}
                      className={`${inputClass} max-w-64 py-1.5 text-xs`}
                    >
                      <option value={OUT_OF_SHEET}>— fora da planilha —</option>
                      {data.products.map((product) => (
                        <option key={product.id} value={product.id}>
                          {product.sheetName}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <Badge tone={item.source === "manual" ? "accent" : "neutral"}>
                      {item.source === "manual" ? "confirmado" : "automático"}
                    </Badge>
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => void remover(item.id)}>
                      Esquecer
                    </Button>
                  </td>
                </tr>
              ))}
              {visiveis.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-10 text-center text-sm text-muted">
                    Nenhum mapeamento memorizado ainda.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

import { useState } from "react";
import { Button, Callout, Card, Field, SectionTitle, inputClass } from "@/components/ui";
import { getJson, sendJson } from "@/lib/client/api";
import type { ProductsResponse } from "@/lib/client/types";

const EXEMPLO = "ABAJUR AMARELO\t221\nABAJUR AZUL\t44\nASA LED VERMELHA\t46";

export function ProdutosClient({ initial }: { initial: ProductsResponse }) {
  const [data, setData] = useState<ProductsResponse>(initial);
  const [paste, setPaste] = useState("");
  const [seedDate, setSeedDate] = useState(new Date().toISOString().slice(0, 10));
  const [replace, setReplace] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      setData(await getJson<ProductsResponse>("/api/products"));
    } catch {
      setError("Não consegui carregar os produtos.");
    }
  }

  async function importar() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await sendJson<{ imported: number; warnings: string[] }>("/api/products", {
        paste,
        seedDate,
        replace,
      });
      setMessage(
        `${result.imported} produtos importados.` +
          (result.warnings.length > 0 ? ` ${result.warnings.join(" ")}` : ""),
      );
      setPaste("");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao importar.");
    } finally {
      setBusy(false);
    }
  }

  async function salvarSku(id: string, sku: string) {
    await sendJson("/api/products", { id, sku: sku.trim() || null }, "PATCH");
    await load();
  }

  const ativos = data.products.filter((product) => product.active);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Produtos e saldos</h1>
        <p className="mt-1 text-sm text-muted">
          A ordem das linhas aqui é a ordem da planilha — é ela que faz a coluna gerada colar alinhada.
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-[420px_1fr]">
        <Card>
          <SectionTitle
            title="Importar da planilha"
            hint="Copie na planilha a coluna de produtos e a última coluna de saldo preenchida, e cole aqui."
          />
          <div className="space-y-3">
            <textarea
              value={paste}
              onChange={(event) => setPaste(event.target.value)}
              rows={12}
              spellCheck={false}
              placeholder={EXEMPLO}
              className={`${inputClass} font-mono text-xs`}
            />
            <p className="text-[11px] text-muted">
              Formatos aceitos: <code>NOME</code>, <code>NOME ⇥ SALDO</code> ou{" "}
              <code>NOME ⇥ SKU ⇥ SALDO</code>. Incluir o SKU é o que permite casar os anúncios do Tiny sem
              depender do nome.
            </p>

            <Field label="Data da coluna colada" hint="O dia que esse saldo representa na planilha.">
              <input
                type="date"
                value={seedDate}
                onChange={(event) => setSeedDate(event.target.value)}
                className={inputClass}
              />
            </Field>

            <label className="flex items-start gap-2 text-xs">
              <input
                type="checkbox"
                checked={replace}
                onChange={(event) => setReplace(event.target.checked)}
                className="mt-0.5 size-3.5 accent-[var(--accent)]"
              />
              <span>
                Esta lista passa a ser a planilha inteira
                <span className="block text-[11px] text-muted">
                  Produtos ausentes ficam inativos, mas o histórico deles é preservado.
                </span>
              </span>
            </label>

            <Button variant="primary" disabled={busy || paste.trim() === ""} onClick={() => void importar()}>
              {busy ? "Importando..." : "Importar produtos e saldos"}
            </Button>

            {message && <Callout tone="positive">{message}</Callout>}
            {error && <Callout tone="danger">{error}</Callout>}
          </div>
        </Card>

        <Card>
          <SectionTitle
            title={`Produtos cadastrados (${ativos.length})`}
            hint={
              data.snapshot
                ? `Saldos da coluna ${data.snapshot.label}.`
                : "Nenhum saldo importado ainda."
            }
          />
          <div className="max-h-[560px] overflow-auto rounded-lg border border-border">
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0 bg-surface-muted text-left text-xs text-muted">
                <tr className="border-b border-border">
                  <th className="px-3 py-2 font-medium">#</th>
                  <th className="px-3 py-2 font-medium">Produto</th>
                  <th className="px-3 py-2 font-medium">SKU</th>
                  <th className="px-3 py-2 text-right font-medium">Saldo</th>
                </tr>
              </thead>
              <tbody>
                {ativos.map((product) => (
                  <tr key={product.id} className="border-b border-border last:border-0">
                    <td className="tabular px-3 py-1.5 text-xs text-muted">{product.rowOrder}</td>
                    <td className="px-3 py-1.5 font-medium">{product.sheetName}</td>
                    <td className="px-3 py-1">
                      <input
                        defaultValue={product.sku ?? ""}
                        placeholder="—"
                        onBlur={(event) => {
                          if (event.target.value.trim() !== (product.sku ?? "")) {
                            void salvarSku(product.id, event.target.value);
                          }
                        }}
                        className="w-28 rounded border border-transparent bg-transparent px-1.5 py-1 font-mono text-xs outline-none hover:border-border focus:border-accent"
                      />
                    </td>
                    <td className="tabular px-3 py-1.5 text-right font-semibold">{product.balance}</td>
                  </tr>
                ))}
                {ativos.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-3 py-10 text-center text-sm text-muted">
                      Nenhum produto ainda. Cole a lista ao lado.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}

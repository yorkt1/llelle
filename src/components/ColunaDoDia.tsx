import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AdvancedPanel } from "@/components/AdvancedPanel";
import { DecisionsPanel } from "@/components/DecisionsPanel";
import { ExportPanel } from "@/components/ExportPanel";
import { ModeToggle } from "@/components/ModeToggle";
import { PeriodPanel } from "@/components/PeriodPanel";
import { PreviewTable } from "@/components/PreviewTable";
import { UploadPanel } from "@/components/UploadPanel";
import { Badge, Callout, Card, SectionTitle, Stat } from "@/components/ui";
import { getJson, sendJson } from "@/lib/client/api";
import type {
  ColumnMapping,
  CountingMode,
  CountingRules,
  PreviewResponse,
  ProductsResponse,
  StatusResponse,
  UploadResponse,
} from "@/lib/client/types";
import { unresolvedCount } from "@/lib/domain/column";
import { DEFAULT_COUNTING_RULES } from "@/lib/domain/types";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function ColunaDoDia({
  initialStatus,
  initialProducts,
}: {
  initialStatus: StatusResponse;
  initialProducts: ProductsResponse["products"];
}) {
  const [status, setStatus] = useState<StatusResponse>(initialStatus);
  const [products, setProducts] = useState<ProductsResponse["products"]>(initialProducts);

  const [upload, setUpload] = useState<UploadResponse | null>(null);
  const [invoiceUpload, setInvoiceUpload] = useState<UploadResponse | null>(null);
  const [start, setStart] = useState(today());
  const [end, setEnd] = useState(today());
  const [grouped, setGrouped] = useState(false);
  const [mode, setMode] = useState<CountingMode>("order");
  const [rules, setRules] = useState<CountingRules>(DEFAULT_COUNTING_RULES);
  const [overrides, setOverrides] = useState<ColumnMapping>({});
  const [decisions, setDecisions] = useState<Record<string, string>>({});

  // Guarda o resultado junto da chave que o gerou: comparar as duas dá o estado
  // de "recalculando" sem um setState extra que possa ficar preso ligado.
  const [computed, setComputed] = useState<{ key: string; data: PreviewResponse | null; error: string | null }>({
    key: "",
    data: null,
    error: null,
  });
  const [error, setError] = useState<string | null>(null);
  const [committing, setCommitting] = useState(false);
  const [committed, setCommitted] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [statusData, productsData] = await Promise.all([
        getJson<StatusResponse>("/api/status"),
        getJson<ProductsResponse>("/api/products"),
      ]);
      setStatus(statusData);
      setProducts(productsData.products);
    } catch {
      setError("Não consegui carregar o estado atual.");
    }
  }, []);

  // A chave serializada evita recalcular a cada re-render por identidade de objeto.
  const requestKey = useMemo(
    () =>
      JSON.stringify({
        uploadId: upload?.uploadId ?? null,
        invoiceUploadId: invoiceUpload?.uploadId ?? null,
        start,
        end: grouped ? end : null,
        mode,
        rules,
        decisions,
        columnOverrides: overrides,
      }),
    [upload, invoiceUpload, start, end, grouped, mode, rules, decisions, overrides],
  );

  useEffect(() => {
    const request = JSON.parse(requestKey) as Record<string, unknown>;
    // Sem arquivo não há o que calcular; a prévia é limpa junto com o upload.
    if (!request.uploadId) return;

    let cancelled = false;

    sendJson<PreviewResponse>("/api/preview", request)
      .then((data) => {
        if (!cancelled) setComputed({ key: requestKey, data, error: null });
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        const message = cause instanceof Error ? cause.message : "Falha ao calcular a coluna.";
        setComputed({ key: requestKey, data: null, error: message });
      });

    return () => {
      cancelled = true;
    };
  }, [requestKey]);

  const result = computed.data;
  const loading = upload !== null && computed.key !== requestKey;

  function onUploaded(next: UploadResponse) {
    setUpload(next);
    setOverrides({});
    setDecisions({});
    setCommitted(null);
    if (next.suggestedDate) {
      setStart(next.suggestedDate);
      setEnd(next.suggestedDate);
    }
  }

  async function commit() {
    if (!upload) return;
    setCommitting(true);
    setError(null);
    try {
      await sendJson("/api/snapshots", { ...JSON.parse(requestKey), note: null });
      setCommitted(result?.preview.period.label ?? null);
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao fechar o dia.");
    } finally {
      setCommitting(false);
    }
  }

  const unresolved = result ? unresolvedCount(result.preview) : 0;
  const semProdutos = status.productCount === 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Coluna do dia</h1>
          <p className="mt-1 text-sm text-muted">
            Relatório de vendas do Tiny + saldo do dia anterior = coluna pronta para colar.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
            <Badge tone={status.driver === "supabase" ? "positive" : "neutral"}>
              {status.driver === "supabase" ? "Supabase" : "arquivo local"}
            </Badge>
            <span>{status.productCount} produtos</span>
          {status.lastSnapshot && <span>· última coluna: {status.lastSnapshot.label}</span>}
        </div>
      </div>

      {semProdutos && (
        <Callout tone="warning">
          Nenhum produto cadastrado ainda. Comece colando a lista de produtos e o saldo da última coluna
          preenchida em{" "}
          <Link to="/produtos" className="underline">
            Produtos e saldos
          </Link>
          .
        </Callout>
      )}

      <div className="grid gap-5 lg:grid-cols-[380px_1fr]">
        <div className="space-y-5">
          <Card>
            <SectionTitle step={1} title="Relatório de vendas" hint="CSV ou XLSX exportado do Tiny." />
            <div className="space-y-4">
              <UploadPanel
                label="Relatório do dia"
                hint="Arraste o arquivo aqui"
                value={upload}
                onLoaded={onUploaded}
                onCleared={() => {
                  setUpload(null);
                  setComputed({ key: "", data: null, error: null });
                }}
              />
              <UploadPanel
                label="Relatório por nota fiscal"
                hint="Só se o Tiny exporta pedidos e notas em arquivos separados"
                optional
                value={invoiceUpload}
                onLoaded={setInvoiceUpload}
                onCleared={() => setInvoiceUpload(null)}
              />
            </div>
          </Card>

          <Card>
            <SectionTitle step={2} title="Período da coluna" />
            <PeriodPanel
              start={start}
              end={end}
              grouped={grouped}
              onStartChange={(value) => {
                setStart(value);
                if (!grouped) setEnd(value);
              }}
              onEndChange={setEnd}
              onGroupedChange={(value) => {
                setGrouped(value);
                if (!value) setEnd(start);
              }}
              label={result?.preview.period.label ?? null}
            />
          </Card>

          <Card>
            <SectionTitle step={3} title="Modo de contagem" />
            <ModeToggle
              value={mode}
              onChange={setMode}
              divergentCount={result?.preview.divergentCount ?? null}
              invoiceAvailable={result ? result.preview.invoiceAvailable : null}
            />
          </Card>

          {upload && (
            <AdvancedPanel
              upload={upload}
              mapping={result?.report.mapping ?? upload.mapping}
              rules={result?.rules ?? rules}
              onMappingChange={(role, index) =>
                setOverrides((current) => {
                  const next = { ...current };
                  if (index === undefined) delete next[role];
                  else next[role] = index;
                  return next;
                })
              }
              onRulesChange={(patch) => setRules((current) => ({ ...current, ...patch }))}
            />
          )}
        </div>

        <div className="space-y-5">
          {(error ?? computed.error) && <Callout tone="danger">{error ?? computed.error}</Callout>}
          {committed && (
            <Callout tone="positive">
              Coluna {committed} fechada. O saldo gravado já é o ponto de partida do próximo dia.
            </Callout>
          )}

          {!upload && (
            <Card className="grid min-h-64 place-items-center text-center">
              <p className="max-w-sm text-sm text-muted">
                Envie o relatório de vendas do dia para ver a prévia da coluna: quanto cada produto vendeu,
                qual era o saldo anterior e qual fica o saldo novo.
              </p>
            </Card>
          )}

          {upload && result && (
            <>
              <Card>
                <SectionTitle step={4} title="Conferência" />
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Stat label="Vendido por pedido" value={result.preview.totals.byOrder} />
                  <Stat
                    label="Vendido por nota"
                    value={result.preview.invoiceAvailable ? result.preview.totals.byInvoice : "—"}
                  />
                  <Stat
                    label="Divergências"
                    value={result.preview.invoiceAvailable ? result.preview.divergentCount : "—"}
                    tone={
                      !result.preview.invoiceAvailable
                        ? "neutral"
                        : result.preview.divergentCount > 0
                          ? "warning"
                          : "positive"
                    }
                  />
                  <Stat label="Sem destino" value={unresolved} tone={unresolved > 0 ? "danger" : "positive"} />
                </div>

                {result.previousSnapshot ? (
                  <p className="mt-3 text-xs text-muted">
                    Saldo anterior lido da coluna{" "}
                    <span className="font-medium text-foreground">{result.previousSnapshot.label}</span>.
                  </p>
                ) : (
                  <div className="mt-3">
                    <Callout tone="warning">
                      Não há saldo anterior gravado: a coluna sairia como 0 menos o vendido. Importe os saldos
                      em{" "}
                      <Link to="/produtos" className="underline">
                        Produtos e saldos
                      </Link>
                      .
                    </Callout>
                  </div>
                )}

                {result.preview.skippedLines > 0 && (
                  <p className="mt-2 text-xs text-muted">
                    {result.preview.skippedLines} linha(s) do arquivo não entraram em nenhum dos dois modos
                    (fora do período, canceladas ou de canal excluído).
                  </p>
                )}
              </Card>

              <Card>
                <SectionTitle step={5} title="Produtos a decidir" />
                <DecisionsPanel
                  pending={result.preview.pending}
                  unknown={result.preview.unknown}
                  products={products}
                  onDecide={(reportName, decision) =>
                    setDecisions((current) => ({ ...current, [reportName]: decision }))
                  }
                />
              </Card>

              <Card>
                <SectionTitle
                  step={6}
                  title="Coluna gerada"
                  hint={
                    loading ? "Recalculando..." : `${result.preview.rows.length} linhas, na ordem da planilha.`
                  }
                />
                <PreviewTable
                  rows={result.preview.rows}
                  mode={result.preview.mode}
                  invoiceAvailable={result.preview.invoiceAvailable}
                />
                <div className="mt-4 border-t border-border pt-4">
                  <ExportPanel
                    result={result}
                    unresolved={unresolved}
                    committing={committing}
                    onCommit={() => void commit()}
                  />
                </div>
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

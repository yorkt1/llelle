function pct(parte: number, total: number): string {
  return total > 0 ? `${((parte / total) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%` : "—";
}

/** Lista de barras horizontais (uma série só: cor única, valor em texto ao lado, nunca só cor). */
export function BarrasHorizontais({ titulo, itens, total }: { titulo: string; itens: { rotulo: string; valor: number }[]; total: number }) {
  const maximo = Math.max(1, ...itens.map((i) => i.valor));
  return (
    <section className="painel-card">
      <h2 className="painel-card-titulo">{titulo}</h2>
      {itens.length === 0 ? (
        <p className="field-value--muted">Sem dados no período.</p>
      ) : (
        <ul className="barras">
          {itens.map((item) => (
            <li key={item.rotulo} className="barras-item" title={`${item.rotulo}: ${item.valor} (${pct(item.valor, total)})`}>
              <span className="barras-rotulo">{item.rotulo}</span>
              <span className="barras-trilho" aria-hidden="true">
                <span className="barras-barra" style={{ width: `${(item.valor / maximo) * 100}%` }} />
              </span>
              <span className="barras-valor tabular">
                {item.valor} <span className="field-value--muted">· {pct(item.valor, total)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

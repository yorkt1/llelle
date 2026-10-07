interface Guia {
  titulo: string;
  descricao: string;
  marketplace: "MERCADO LIVRE" | "SHOPEE";
  arquivo: string;
}

// Cada guia é um HTML interativo standalone (com o próprio CSS/JS) — vive em public/guias/ e
// abre numa aba nova em vez de embutido, pra não ter nenhum conflito de estilo com o resto do
// sistema. Pra adicionar um guia novo: solta o arquivo .html em public/guias/ e acrescenta uma
// entrada aqui.
const GUIAS: Guia[] = [
  {
    titulo: "Devoluções — Mercado Livre",
    descricao: "Fluxo completo: triagem, prazos do painel, recebimento filmado, contestação e checklist de fechamento.",
    marketplace: "MERCADO LIVRE",
    arquivo: "mercado-livre-devolucoes.html",
  },
  {
    titulo: "Contestação de devoluções — Shopee",
    descricao: "Como analisar a alegação do cliente, reunir provas por caso, responder e acompanhar até o encerramento.",
    marketplace: "SHOPEE",
    arquivo: "shopee-contestacao.html",
  },
];

const COR_MARKETPLACE: Record<Guia["marketplace"], string> = {
  "MERCADO LIVRE": "#ffe600",
  SHOPEE: "#ff6200",
};

export function Suporte() {
  return (
    <div className="page pagina-formulario">
      <header className="header">
        <h1 className="title">Suporte</h1>
      </header>

      <div className="guia-lista">
        {GUIAS.map((guia) => (
          <a key={guia.arquivo} className="guia-item" href={`/guias/${guia.arquivo}`} target="_blank" rel="noopener noreferrer">
            <span className="guia-tag" style={{ background: COR_MARKETPLACE[guia.marketplace], color: "var(--fg-on-light)" }}>
              {guia.marketplace}
            </span>
            <span className="guia-titulo">{guia.titulo}</span>
            <span className="guia-descricao">{guia.descricao}</span>
          </a>
        ))}
      </div>
    </div>
  );
}

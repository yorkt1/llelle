import { PageHeader } from "@/PageHeader";

interface Guia {
  titulo: string;
  descricao: string;
  categoria: "MERCADO LIVRE" | "SHOPEE" | "COMERCIAL";
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
    categoria: "MERCADO LIVRE",
    arquivo: "mercado-livre-devolucoes.html",
  },
  {
    titulo: "Contestação de devoluções — Shopee",
    descricao: "Como analisar a alegação do cliente, reunir provas por caso, responder e acompanhar até o encerramento.",
    categoria: "SHOPEE",
    arquivo: "shopee-contestacao.html",
  },
  {
    titulo: "Manual do Vendedor B2B",
    descricao: "Da prospecção à recompra: fluxo comercial, rotina diária, uso da planilha de follow-up e checklist de integração.",
    categoria: "COMERCIAL",
    arquivo: "manual-vendedor-b2b.html",
  },
];

const COR_CATEGORIA: Record<Guia["categoria"], string> = {
  "MERCADO LIVRE": "#ffe600",
  SHOPEE: "#ff6200",
  COMERCIAL: "#a9c4ff",
};

export function Suporte() {
  return (
    <div className="page pagina-formulario">
      <PageHeader titulo="Suporte" />

      <div className="guia-lista">
        {GUIAS.map((guia) => (
          <a key={guia.arquivo} className="guia-item" href={`/guias/${guia.arquivo}`} target="_blank" rel="noopener noreferrer">
            <span className="guia-tag" style={{ background: COR_CATEGORIA[guia.categoria], color: "var(--fg-on-light)" }}>
              {guia.categoria}
            </span>
            <span className="guia-titulo">{guia.titulo}</span>
            <span className="guia-descricao">{guia.descricao}</span>
          </a>
        ))}
      </div>
    </div>
  );
}

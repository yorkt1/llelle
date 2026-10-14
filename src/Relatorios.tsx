import { PageHeader } from "@/PageHeader";
import { EmbalagemRelatorio } from "@/EmbalagemRelatorio";

const API_URL = import.meta.env.VITE_API_URL ?? "";

export function Relatorios() {
  return (
    <div className="page pagina-formulario">
      <PageHeader titulo="Relatórios" />

      <section className="painel-card" aria-labelledby="relatorio-pedidos-titulo">
        <div className="painel-card-cabecalho">
          <h2 id="relatorio-pedidos-titulo" className="painel-card-titulo">Controle de Pedidos</h2>
          <p className="field-value--muted">
            Baixe os registros manuais por data, turno e marketplace, com os totais diários.
          </p>
        </div>
        <a className="btn-primario" href={`${API_URL}/api/pedidos/planilha.xlsx`} download>
          Baixar planilha do Controle de Pedidos (.xlsx)
        </a>
      </section>

      <section className="painel-card" aria-labelledby="relatorio-embalagem-titulo">
        <div className="painel-card-cabecalho">
          <h2 id="relatorio-embalagem-titulo" className="painel-card-titulo">Embalagem</h2>
          <p className="field-value--muted">
            Acompanhamento do desempenho por dia e mês da operação de embalagem.
          </p>
        </div>
        <EmbalagemRelatorio />
      </section>
    </div>
  );
}

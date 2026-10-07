import { PageHeader } from "@/PageHeader";

export interface Ideia {
  resumo: string;
  oQueFaz: string[];
  dados: string[];
  paraComecar: string[];
  /** Prévia ilustrativa (wireframe), só pra visualizar a ideia — sem dados reais. */
  previa: { tipo: "colunas"; titulos: string[] } | { tipo: "tabela"; colunas: string[] };
}

function Previa({ previa }: { previa: Ideia["previa"] }) {
  if (previa.tipo === "colunas") {
    return (
      <div className="previa-colunas">
        {previa.titulos.map((titulo, i) => (
          <div key={titulo} className="previa-coluna">
            <span className="previa-coluna-titulo">{titulo}</span>
            {Array.from({ length: Math.max(1, 3 - (i % 3)) }, (_, j) => (
              <span key={j} className="previa-cartao">
                <span className="previa-linha previa-linha--forte" />
                <span className="previa-linha" />
              </span>
            ))}
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="tabela-wrap tabela-wrap--plana">
      <table className="tabela previa-tabela">
        <thead>
          <tr>
            {previa.colunas.map((coluna) => (
              <th key={coluna}>{coluna}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {[0, 1, 2, 3].map((linha) => (
            <tr key={linha}>
              {previa.colunas.map((coluna) => (
                <td key={coluna}>
                  <span className="previa-linha" />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Página-base de um módulo ainda não construído — registra a ideia dentro do sistema, sem funcionalidade. */
export function EmBreve({ titulo, ideia }: { titulo: string; ideia: Ideia }) {
  return (
    <div className="page pagina-formulario">
      <PageHeader
        titulo={titulo}
        subtitulo={
          <>
            <span className="selo-em-breve">Em breve</span> {ideia.resumo}
          </>
        }
      />

      <div className="painel-triplo">
        <section className="painel-card">
          <h2 className="painel-card-titulo">O que vai fazer</h2>
          <ul className="lista-ideia">
            {ideia.oQueFaz.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
        <section className="painel-card">
          <h2 className="painel-card-titulo">De onde vêm os dados</h2>
          <ul className="lista-ideia">
            {ideia.dados.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
        <section className="painel-card">
          <h2 className="painel-card-titulo">O que falta pra começar</h2>
          <ul className="lista-ideia">
            {ideia.paraComecar.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      </div>

      <section className="painel-card previa" aria-label="Prévia ilustrativa">
        <h2 className="painel-card-titulo">
          Prévia <span className="field-value--muted">(ilustrativa — sem dados reais)</span>
        </h2>
        <Previa previa={ideia.previa} />
      </section>
    </div>
  );
}

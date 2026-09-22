import { useEffect, useState } from "react";
import { App } from "@/App";
import { Devolucoes } from "@/Devolucoes";
import { Relatorios } from "@/Relatorios";

type View = "separacao" | "devolucao" | "relatorios";

const VIEWS: { key: View; label: string; hash: string }[] = [
  { key: "separacao", label: "Painel", hash: "" },
  { key: "devolucao", label: "Devolução", hash: "devolucao" },
  { key: "relatorios", label: "Relatórios", hash: "relatorios" },
];

function viewFromHash(): View {
  const encontrada = VIEWS.find((item) => item.hash !== "" && window.location.hash === `#${item.hash}`);
  return encontrada?.key ?? "separacao";
}

/**
 * Discreto de propósito, no mesmo espírito do botão de configurações do painel:
 * o painel de separação é feito pra TV do estoque, sem chrome de navegação por
 * cima. A troca de tela mora num link no canto, não numa barra de menu — e
 * serve também como "saída" pra voltar de Devolução/Relatórios pro Painel.
 */
function NavCorner({ view, onChange }: { view: View; onChange: (view: View) => void }) {
  return (
    <nav className="nav-corner">
      {VIEWS.map((item) => (
        <button
          key={item.key}
          className={`nav-corner-item${item.key === view ? " nav-corner-item--active" : ""}`}
          onClick={() => onChange(item.key)}
        >
          {item.label}
        </button>
      ))}
    </nav>
  );
}

export function Root() {
  const [view, setView] = useState<View>(viewFromHash);

  useEffect(() => {
    const onHashChange = () => setView(viewFromHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const go = (next: View) => {
    window.location.hash = VIEWS.find((item) => item.key === next)?.hash ?? "";
    setView(next);
  };

  return (
    <>
      {view === "separacao" && <App />}
      {view === "devolucao" && <Devolucoes />}
      {view === "relatorios" && <Relatorios />}
      <NavCorner view={view} onChange={go} />
    </>
  );
}

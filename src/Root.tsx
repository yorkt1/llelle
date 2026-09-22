import { useEffect, useState } from "react";
import { App } from "@/App";
import { Devolucoes } from "@/Devolucoes";

type View = "separacao" | "devolucao";

function viewFromHash(): View {
  return window.location.hash === "#devolucao" ? "devolucao" : "separacao";
}

/**
 * Discreto de propósito, no mesmo espírito do botão de configurações do painel:
 * o painel de separação é feito pra TV do estoque, sem chrome de navegação por
 * cima. A troca de tela mora num link no canto, não numa barra de menu.
 */
function NavCorner({ view, onChange }: { view: View; onChange: (view: View) => void }) {
  const proximo: View = view === "separacao" ? "devolucao" : "separacao";
  const rotulo = proximo === "devolucao" ? "Devolução" : "Painel de separação";
  return (
    <button className="nav-corner" onClick={() => onChange(proximo)}>
      {rotulo}
    </button>
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
    window.location.hash = next === "devolucao" ? "devolucao" : "";
    setView(next);
  };

  return (
    <>
      {view === "separacao" ? <App /> : <Devolucoes />}
      <NavCorner view={view} onChange={go} />
    </>
  );
}

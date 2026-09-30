import { useEffect, useState } from "react";
import { App } from "@/App";
import { Devolucoes } from "@/Devolucoes";
import { Estoque } from "@/Estoque";
import { Relatorios } from "@/Relatorios";
import { Suporte } from "@/Suporte";

type View = "separacao" | "devolucoes" | "estoque" | "relatorios" | "suporte";

const VIEWS: { key: View; label: string; hash: string }[] = [
  { key: "separacao", label: "Painel", hash: "" },
  { key: "devolucoes", label: "Devoluções", hash: "devolucoes" },
  { key: "estoque", label: "Estoque", hash: "estoque" },
  { key: "relatorios", label: "Relatórios", hash: "relatorios" },
  { key: "suporte", label: "Suporte", hash: "suporte" },
];

function viewFromHash(): View {
  const encontrada = VIEWS.find((item) => item.hash !== "" && window.location.hash === `#${item.hash}`);
  return encontrada?.key ?? "separacao";
}

/**
 * Discreto de propósito, no mesmo espírito do botão de configurações do painel:
 * o painel de separação é feito pra TV do estoque, sem chrome de navegação por
 * cima. A troca de tela mora num link no canto, não numa barra de menu — e
 * serve também como "saída" pra voltar de Devoluções/Relatórios pro Painel.
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
      {view === "devolucoes" && <Devolucoes />}
      {view === "estoque" && <Estoque />}
      {view === "relatorios" && <Relatorios />}
      {view === "suporte" && <Suporte />}
      <NavCorner view={view} onChange={go} />
    </>
  );
}

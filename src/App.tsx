import { Link, Route, Routes } from "react-router-dom";
import { ColunaDoDiaPage } from "@/pages/ColunaDoDiaPage";
import { ProdutosPage } from "@/pages/ProdutosPage";
import { MapeamentosPage } from "@/pages/MapeamentosPage";
import { HistoricoPage } from "@/pages/HistoricoPage";

const NAV = [
  { href: "/", label: "Coluna do dia" },
  { href: "/produtos", label: "Produtos e saldos" },
  { href: "/mapeamentos", label: "Mapeamentos" },
  { href: "/historico", label: "Histórico" },
];

export function App() {
  return (
    <>
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-6 gap-y-2 px-6 py-3">
          <span className="text-sm font-semibold tracking-tight">Vitae</span>
          <nav className="flex flex-wrap gap-1">
            {NAV.map((item) => (
              <Link
                key={item.href}
                to={item.href}
                className="rounded-md px-3 py-1.5 text-sm text-muted transition-colors hover:bg-surface-muted hover:text-foreground"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1400px] flex-1 px-6 py-8">
        <Routes>
          <Route path="/" element={<ColunaDoDiaPage />} />
          <Route path="/produtos" element={<ProdutosPage />} />
          <Route path="/mapeamentos" element={<MapeamentosPage />} />
          <Route path="/historico" element={<HistoricoPage />} />
        </Routes>
      </main>
    </>
  );
}

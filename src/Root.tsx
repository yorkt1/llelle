import { useCallback, useEffect, useState } from "react";
import { MODULOS, type Modulo } from "@/modulos";

const SIDEBAR_STORAGE_KEY = "shell:sidebarRecolhida";

function moduloFromHash(): Modulo {
  return MODULOS.find((item) => item.hash !== "" && window.location.hash === `#${item.hash}`) ?? MODULOS[0];
}

function lerSidebarRecolhida(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function IconeRecolher({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16" />
      <path d="m15 10-2 2 2 2" />
    </svg>
  );
}

function ItemNav({ modulo, ativo, className }: { modulo: Modulo; ativo: boolean; className: string }) {
  return (
    <a
      href={`#${modulo.hash}`}
      className={`${className}${ativo ? ` ${className}--ativo` : ""}`}
      aria-current={ativo ? "page" : undefined}
      title={modulo.label}
    >
      <modulo.Icone className="app-nav-icone" />
      <span className="app-nav-label">{modulo.label}</span>
    </a>
  );
}

/**
 * Desktop (≥1024px): sidebar fixa à esquerda, recolhível (só ícones — preferência lembrada no
 * navegador, útil pra TV do Painel/Embalagem). Celular/tablet: barra inferior fixa. Em tela cheia
 * (botão do Painel) todo o chrome some, pra TV continuar limpa como antes.
 */
export function Root() {
  const [modulo, setModulo] = useState<Modulo>(moduloFromHash);
  const [recolhida, setRecolhida] = useState(lerSidebarRecolhida);

  useEffect(() => {
    const onHashChange = () => setModulo(moduloFromHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const alternarSidebar = useCallback(() => {
    setRecolhida((atual) => {
      try {
        localStorage.setItem(SIDEBAR_STORAGE_KEY, atual ? "0" : "1");
      } catch {
        // localStorage bloqueado — só não lembra a preferência.
      }
      return !atual;
    });
  }, []);

  const principais = MODULOS.filter((item) => !item.secundario);
  const secundarios = MODULOS.filter((item) => item.secundario);
  const Tela = modulo.Tela;

  return (
    <div className={`app-shell${recolhida ? " app-shell--recolhida" : ""}`}>
      <aside className="app-sidebar">
        <div className="app-sidebar-topo">
          <span className="app-brand" aria-label="LLE Importadora">
            LLE
          </span>
        </div>
        <nav className="app-sidebar-nav" aria-label="Módulos">
          {principais.map((item) => (
            <ItemNav key={item.key} modulo={item} ativo={item.key === modulo.key} className="app-sidebar-item" />
          ))}
        </nav>
        <div className="app-sidebar-rodape">
          {secundarios.map((item) => (
            <ItemNav key={item.key} modulo={item} ativo={item.key === modulo.key} className="app-sidebar-item" />
          ))}
          <button
            type="button"
            className="app-sidebar-item app-sidebar-recolher"
            onClick={alternarSidebar}
            aria-label={recolhida ? "Expandir menu" : "Recolher menu"}
            aria-expanded={!recolhida}
            title={recolhida ? "Expandir menu" : "Recolher menu"}
          >
            <IconeRecolher className="app-nav-icone" />
            <span className="app-nav-label">Recolher menu</span>
          </button>
        </div>
      </aside>

      <main className="app-main">
        <Tela />
      </main>

      <nav className="app-bottom-nav" aria-label="Módulos">
        {MODULOS.map((item) => (
          <ItemNav key={item.key} modulo={item} ativo={item.key === modulo.key} className="app-bottom-item" />
        ))}
      </nav>
    </div>
  );
}

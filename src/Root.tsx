import { useCallback, useEffect, useState } from "react";
import { MODULOS, type Modulo } from "@/modulos";
import { EmBreve } from "@/EmBreve";

const SIDEBAR_STORAGE_KEY = "shell:sidebarRecolhida";
/** Quantos módulos cabem direto na barra inferior do celular — o resto vai pro "Mais". */
const ATALHOS_BARRA_INFERIOR = 4;

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

function IconeMais({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <circle cx="5" cy="12" r="1.3" />
      <circle cx="12" cy="12" r="1.3" />
      <circle cx="19" cy="12" r="1.3" />
    </svg>
  );
}

function ItemNav({ modulo, ativo, className, onClick }: { modulo: Modulo; ativo: boolean; className: string; onClick?: () => void }) {
  return (
    <a
      href={`#${modulo.hash}`}
      className={`${className}${ativo ? ` ${className}--ativo` : ""}${modulo.ideia ? ` ${className}--ideia` : ""}`}
      aria-current={ativo ? "page" : undefined}
      title={modulo.ideia ? `${modulo.label} (em breve)` : modulo.label}
      onClick={onClick}
    >
      <modulo.Icone className="app-nav-icone" />
      <span className="app-nav-label">{modulo.label}</span>
    </a>
  );
}

/**
 * Desktop (≥1024px): sidebar fixa à esquerda, recolhível (só ícones — preferência lembrada no
 * navegador, útil pra TV do Painel/Embalagem). Celular/tablet: barra inferior fixa com os
 * primeiros módulos + "Mais". Em tela cheia (botão do Painel) todo o chrome some, pra TV continuar
 * limpa como antes.
 */
export function Root() {
  const [modulo, setModulo] = useState<Modulo>(moduloFromHash);
  const [recolhida, setRecolhida] = useState(lerSidebarRecolhida);
  const [maisAberto, setMaisAberto] = useState(false);

  useEffect(() => {
    const onHashChange = () => {
      setModulo(moduloFromHash());
      setMaisAberto(false);
    };
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

  const principais = MODULOS.filter((item) => !item.secundario && !item.ideia);
  const ideias = MODULOS.filter((item) => item.ideia);
  const secundarios = MODULOS.filter((item) => item.secundario);
  const atalhos = principais.slice(0, ATALHOS_BARRA_INFERIOR);
  const noMais = MODULOS.filter((item) => !atalhos.includes(item));
  const ativoNoMais = noMais.some((item) => item.key === modulo.key);

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
          {ideias.length > 0 && (
            <>
              <span className="app-sidebar-secao">Em breve</span>
              {ideias.map((item) => (
                <ItemNav key={item.key} modulo={item} ativo={item.key === modulo.key} className="app-sidebar-item" />
              ))}
            </>
          )}
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

      <main className="app-main">{modulo.ideia ? <EmBreve titulo={modulo.label} ideia={modulo.ideia} /> : <modulo.Tela />}</main>

      {maisAberto && (
        <div className="app-mais-overlay" onClick={() => setMaisAberto(false)}>
          <nav className="app-mais" aria-label="Mais módulos" onClick={(event) => event.stopPropagation()}>
            {noMais.map((item) => (
              <ItemNav key={item.key} modulo={item} ativo={item.key === modulo.key} className="app-mais-item" onClick={() => setMaisAberto(false)} />
            ))}
          </nav>
        </div>
      )}

      <nav className="app-bottom-nav" aria-label="Módulos">
        {atalhos.map((item) => (
          <ItemNav key={item.key} modulo={item} ativo={item.key === modulo.key} className="app-bottom-item" />
        ))}
        <button
          type="button"
          className={`app-bottom-item${ativoNoMais || maisAberto ? " app-bottom-item--ativo" : ""}`}
          aria-expanded={maisAberto}
          onClick={() => setMaisAberto((atual) => !atual)}
        >
          <IconeMais className="app-nav-icone" />
          <span className="app-nav-label">Mais</span>
        </button>
      </nav>
    </div>
  );
}

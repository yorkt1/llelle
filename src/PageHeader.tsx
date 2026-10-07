import type { ReactNode } from "react";

/** Cabeçalho padrão de toda tela: título (e subtítulo opcional) à esquerda, ações principais à direita. */
export function PageHeader({ titulo, subtitulo, children }: { titulo: string; subtitulo?: ReactNode; children?: ReactNode }) {
  return (
    <header className="page-header">
      <div className="page-header-texto">
        <h1 className="title">{titulo}</h1>
        {subtitulo && <p className="page-header-subtitulo">{subtitulo}</p>}
      </div>
      {children && <div className="page-header-acoes">{children}</div>}
    </header>
  );
}

import type { ComponentType } from "react";
import { App } from "@/App";
import { Devolucoes } from "@/Devolucoes";
import { Estoque } from "@/Estoque";
import { Embalagem } from "@/Embalagem";
import { Relatorios } from "@/Relatorios";
import { Suporte } from "@/Suporte";

type Icone = ComponentType<{ className?: string }>;

export interface Modulo {
  key: string;
  label: string;
  /** Hash da URL (sem "#"). "" = tela inicial. */
  hash: string;
  Icone: Icone;
  Tela: ComponentType;
  /** Fica no rodapé da sidebar, separado dos módulos de operação. */
  secundario?: boolean;
}

function svg(paths: React.ReactNode): Icone {
  return function IconeModulo({ className }) {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {paths}
      </svg>
    );
  };
}

const IconePainel = svg(
  <>
    <rect x="3" y="3" width="7" height="9" rx="1.5" />
    <rect x="14" y="3" width="7" height="5" rx="1.5" />
    <rect x="14" y="12" width="7" height="9" rx="1.5" />
    <rect x="3" y="16" width="7" height="5" rx="1.5" />
  </>,
);

const IconeDevolucoes = svg(
  <>
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
  </>,
);

const IconeEstoque = svg(
  <>
    <path d="M3 21V8l9-5 9 5v13" />
    <path d="M7 21v-8h10v8" />
    <path d="M7 17h10" />
  </>,
);

const IconeEmbalagem = svg(
  <>
    <path d="M21 8 12 3 3 8v8l9 5 9-5V8Z" />
    <path d="m3 8 9 5 9-5" />
    <path d="M12 13v8" />
  </>,
);

const IconeRelatorios = svg(
  <>
    <path d="M3 3v18h18" />
    <path d="M8 17v-5" />
    <path d="M13 17V8" />
    <path d="M18 17v-9" />
  </>,
);

const IconeSuporte = svg(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14" />
    <path d="M12 17.5h.01" />
  </>,
);

/**
 * Único lugar pra registrar um módulo novo: entra aqui e já aparece na sidebar (desktop), na barra
 * inferior (celular) e no roteamento por hash — nada mais precisa mudar.
 */
export const MODULOS: Modulo[] = [
  { key: "separacao", label: "Painel", hash: "", Icone: IconePainel, Tela: App },
  { key: "devolucoes", label: "Devoluções", hash: "devolucoes", Icone: IconeDevolucoes, Tela: Devolucoes },
  { key: "estoque", label: "Estoque", hash: "estoque", Icone: IconeEstoque, Tela: Estoque },
  { key: "embalagem", label: "Embalagem", hash: "embalagem", Icone: IconeEmbalagem, Tela: Embalagem },
  { key: "relatorios", label: "Relatórios", hash: "relatorios", Icone: IconeRelatorios, Tela: Relatorios },
  { key: "suporte", label: "Suporte", hash: "suporte", Icone: IconeSuporte, Tela: Suporte, secundario: true },
];

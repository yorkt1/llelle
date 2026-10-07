import type { ReactNode } from "react";

export interface PropsIcone {
  className?: string;
}

function IconeBase({ className, children }: PropsIcone & { children: ReactNode }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

export function IconePainel({ className }: PropsIcone) {
  return (
    <IconeBase className={className}>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </IconeBase>
  );
}

export function IconeDevolucoes({ className }: PropsIcone) {
  return (
    <IconeBase className={className}>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </IconeBase>
  );
}

export function IconeEstoque({ className }: PropsIcone) {
  return (
    <IconeBase className={className}>
      <path d="M3 21V8l9-5 9 5v13" />
      <path d="M7 21v-8h10v8" />
      <path d="M7 17h10" />
    </IconeBase>
  );
}

export function IconeEmbalagem({ className }: PropsIcone) {
  return (
    <IconeBase className={className}>
      <path d="M21 8 12 3 3 8v8l9 5 9-5V8Z" />
      <path d="m3 8 9 5 9-5" />
      <path d="M12 13v8" />
    </IconeBase>
  );
}

export function IconeRelatorios({ className }: PropsIcone) {
  return (
    <IconeBase className={className}>
      <path d="M3 3v18h18" />
      <path d="M8 17v-5" />
      <path d="M13 17V8" />
      <path d="M18 17v-9" />
    </IconeBase>
  );
}

export function IconeSuporte({ className }: PropsIcone) {
  return (
    <IconeBase className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14" />
      <path d="M12 17.5h.01" />
    </IconeBase>
  );
}


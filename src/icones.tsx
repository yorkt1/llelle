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

export function IconePedidos({ className }: PropsIcone) {
  return (
    <IconeBase className={className}>
      <path d="M4 5h16v14H4z" />
      <path d="M8 9h8M8 13h5M8 17h3" />
      <path d="m16 16 1.5 1.5L21 14" />
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


export function IconeCompras({ className }: PropsIcone) {
  return (
    <IconeBase className={className}>
      <path d="M3 4h2l2.4 11.2a1.5 1.5 0 0 0 1.5 1.2h8.7a1.5 1.5 0 0 0 1.5-1.1L21 8H6.2" />
      <circle cx="9.5" cy="20" r="1.2" />
      <circle cx="17.5" cy="20" r="1.2" />
    </IconeBase>
  );
}

export function IconeCrm({ className }: PropsIcone) {
  return (
    <IconeBase className={className}>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3 20c.6-3.4 3-5.5 6-5.5s5.4 2.1 6 5.5" />
      <path d="M16 4.6a3.2 3.2 0 0 1 0 6.3" />
      <path d="M18 14.8c1.7.7 2.8 2.5 3 5.2" />
    </IconeBase>
  );
}

export function IconeConciliacao({ className }: PropsIcone) {
  return (
    <IconeBase className={className}>
      <path d="M12 3v18" />
      <path d="M5 7h14" />
      <path d="m5 7-3 7a3.5 3.5 0 0 0 6 0Z" />
      <path d="m19 7-3 7a3.5 3.5 0 0 0 6 0Z" />
      <path d="M8 21h8" />
    </IconeBase>
  );
}

export function IconeGargalos({ className }: PropsIcone) {
  return (
    <IconeBase className={className}>
      <circle cx="12" cy="13" r="8" />
      <path d="M12 9v4l2.5 2.5" />
      <path d="M10 2h4" />
    </IconeBase>
  );
}

export function IconeFotoIa({ className }: PropsIcone) {
  return (
    <IconeBase className={className}>
      <path d="M3 8.5A1.5 1.5 0 0 1 4.5 7h2.2l1.5-2h5.6l1.5 2h2.2A1.5 1.5 0 0 1 19 8.5V18a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 3 18Z" />
      <circle cx="11" cy="13" r="3.2" />
      <path d="M21 3v3M19.5 4.5h3" />
    </IconeBase>
  );
}

export function IconeAcesso({ className }: PropsIcone) {
  return (
    <IconeBase className={className}>
      <rect x="4.5" y="10.5" width="15" height="10" rx="2" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
      <path d="M12 15v2" />
    </IconeBase>
  );
}

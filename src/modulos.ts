import type { ComponentType } from "react";
import { App } from "@/App";
import { Devolucoes } from "@/Devolucoes";
import { Estoque } from "@/Estoque";
import { Embalagem } from "@/Embalagem";
import { Relatorios } from "@/Relatorios";
import { Suporte } from "@/Suporte";
import { IconeDevolucoes, IconeEmbalagem, IconeEstoque, IconePainel, IconeRelatorios, IconeSuporte, type PropsIcone } from "@/icones";

export interface Modulo {
  key: string;
  label: string;
  /** Hash da URL (sem "#"). "" = tela inicial. */
  hash: string;
  Icone: ComponentType<PropsIcone>;
  Tela: ComponentType;
  /** Fica no rodapé da sidebar, separado dos módulos de operação. */
  secundario?: boolean;
}

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

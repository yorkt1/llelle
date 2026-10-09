import type { ComponentType } from "react";
import { App } from "@/App";
import { Devolucoes } from "@/Devolucoes";
import { Estoque } from "@/Estoque";
import { Embalagem } from "@/Embalagem";
import { Relatorios } from "@/Relatorios";
import { Suporte } from "@/Suporte";
import { Compras } from "@/Compras";
import { ControlePedidos } from "@/ControlePedidos";
import type { Ideia } from "@/EmBreve";
import {
  IconeAcesso,
  IconeCompras,
  IconeConciliacao,
  IconeCrm,
  IconeDevolucoes,
  IconeEmbalagem,
  IconeEstoque,
  IconeFotoIa,
  IconeGargalos,
  IconePainel,
  IconePedidos,
  IconeRelatorios,
  IconeSuporte,
  type PropsIcone,
} from "@/icones";

interface ModuloBase {
  key: string;
  label: string;
  /** Hash da URL (sem "#"). "" = tela inicial. */
  hash: string;
  Icone: ComponentType<PropsIcone>;
  /** Fica no rodapé da sidebar, separado dos módulos de operação. */
  secundario?: boolean;
}

/**
 * Um módulo é uma tela pronta (`Tela`) ou uma ideia ainda não construída (`ideia`) — a ideia aparece
 * na seção "Em breve" da sidebar com uma página-base (EmBreve.tsx). Pra tirar uma ideia do papel,
 * troca `ideia` por `Tela` aqui.
 */
export type Modulo = ModuloBase & ({ Tela: ComponentType; ideia?: undefined } | { ideia: Ideia; Tela?: undefined });

const IDEIA_CRM: Ideia = {
  resumo: "Carteira e funil do time B2B dentro do sistema, no lugar da planilha de follow-up.",
  oQueFaz: [
    "Leads e clientes com etapa do funil (Novo lead → Pedido fechado), responsável e próximo passo.",
    "Alertas de follow-up atrasado (vermelho) e de hoje (amarelo), como na planilha.",
    "Aviso de recompra: \"esse cliente compra a cada 45 dias e já faz 50\".",
    "Painel de conversão, propostas e valor vendido por vendedor.",
  ],
  dados: ["Planilha FOLLOW-UP atual (importação inicial)", "Clientes e pedidos do Tiny (histórico de compra de cada CNPJ)"],
  paraComecar: ["Login por pessoa (cada vendedor vê a própria carteira)", "Importar a planilha atual", "Definir as etapas e status oficiais"],
  previa: { tipo: "colunas", titulos: ["Novo lead", "Contato realizado", "Proposta enviada", "Negociação", "Pedido fechado"] },
};

const IDEIA_CONCILIACAO: Ideia = {
  resumo: "Compara a contagem física do galpão com o saldo do Tiny e aponta as diferenças.",
  oQueFaz: [
    "Por produto: quanto o Tiny diz que tem × quanto foi contado nas posições.",
    "Lista de divergências ordenada pelo tamanho da diferença.",
    "Ajuda a achar erro de lançamento, extravio e devolução que não voltou pro estoque.",
  ],
  dados: ["Contagens da tela de Estoque (já existem)", "Saldo por produto do Tiny (já coletado pela tela de Compras)"],
  paraComecar: ["Vincular cada produto do catálogo do Estoque ao SKU do Tiny", "Contar todas as posições de um produto num mesmo período"],
  previa: { tipo: "tabela", colunas: ["Produto", "SKU", "Saldo Tiny", "Contado", "Diferença", "Última contagem"] },
};

const IDEIA_GARGALOS: Ideia = {
  resumo: "Quanto tempo um pedido leva de aprovado a embalado, e onde a operação engarrafa.",
  oQueFaz: [
    "Tempo médio por etapa: aprovado → em separação → separado → embalado.",
    "Horários de pico do galpão (pedidos por hora × capacidade).",
    "Evolução semanal por bancada e por colaborador.",
  ],
  dados: ["Separações do Tiny (já consultadas pelo Painel e pela Embalagem)", "Cadastro de colaboradores e bancadas da Embalagem"],
  paraComecar: ["Guardar o histórico diário que hoje só fica em memória/cache", "Definir a meta de tempo por etapa"],
  previa: { tipo: "tabela", colunas: ["Etapa", "Tempo médio", "Pico do dia", "Pedidos parados", "Tendência"] },
};

const IDEIA_FOTO_IA: Ideia = {
  resumo: "A IA sugere a quantidade a partir da foto da contagem; a pessoa confirma.",
  oQueFaz: [
    "Conta as caixas visíveis (colunas × camadas) na foto que já é obrigatória.",
    "Multiplica pela profundidade padrão de cada produto pra estimar o total.",
    "Mostra como sugestão (\"IA sugere 48 — confirme\"), nunca salva sozinha.",
  ],
  dados: ["Fotos e quantidades das contagens já salvas (servem pra medir a precisão antes de liberar)", "Padrão de empilhamento por produto"],
  paraComecar: ["Testar a IA nas fotos já salvas e medir o acerto por produto", "Cadastrar o empilhamento padrão de cada produto", "Padronizar a foto (de frente, pilha inteira)"],
  previa: { tipo: "tabela", colunas: ["Posição", "Foto", "IA sugeriu", "Contado", "Diferença"] },
};

const IDEIA_ACESSO: Ideia = {
  resumo: "Login por pessoa e permissões por módulo — base pra dados sensíveis (compras, clientes, comissão).",
  oQueFaz: [
    "Cada pessoa entra com o próprio usuário.",
    "Permissão por módulo (ex.: vendedor não vê Compras; galpão só Estoque e Embalagem).",
    "Registro de quem fez o quê (contagem, devolução, alteração de parâmetro).",
  ],
  dados: ["Supabase (já usado pra guardar os dados) tem autenticação pronta"],
  paraComecar: ["Lista de pessoas e o que cada uma pode acessar", "Decidir login por e-mail ou por código"],
  previa: { tipo: "tabela", colunas: ["Pessoa", "Função", "Módulos", "Último acesso"] },
};

/**
 * Único lugar pra registrar um módulo novo: entra aqui e já aparece na sidebar (desktop), na barra
 * inferior (celular) e no roteamento por hash — nada mais precisa mudar.
 */
export const MODULOS: Modulo[] = [
  { key: "separacao", label: "Painel", hash: "", Icone: IconePainel, Tela: App },
  { key: "pedidos", label: "Controle de Pedidos", hash: "pedidos", Icone: IconePedidos, Tela: ControlePedidos },
  { key: "devolucoes", label: "Devoluções", hash: "devolucoes", Icone: IconeDevolucoes, Tela: Devolucoes },
  { key: "estoque", label: "Estoque", hash: "estoque", Icone: IconeEstoque, Tela: Estoque },
  { key: "embalagem", label: "Embalagem", hash: "embalagem", Icone: IconeEmbalagem, Tela: Embalagem },
  { key: "compras", label: "Compras", hash: "compras", Icone: IconeCompras, Tela: Compras },
  { key: "relatorios", label: "Relatórios", hash: "relatorios", Icone: IconeRelatorios, Tela: Relatorios },
  { key: "crm", label: "CRM B2B", hash: "crm", Icone: IconeCrm, ideia: IDEIA_CRM },
  { key: "conciliacao", label: "Conciliação de estoque", hash: "conciliacao", Icone: IconeConciliacao, ideia: IDEIA_CONCILIACAO },
  { key: "gargalos", label: "Gargalos da operação", hash: "gargalos", Icone: IconeGargalos, ideia: IDEIA_GARGALOS },
  { key: "contagem-ia", label: "Contagem por foto (IA)", hash: "contagem-ia", Icone: IconeFotoIa, ideia: IDEIA_FOTO_IA },
  { key: "acesso", label: "Acesso e permissões", hash: "acesso", Icone: IconeAcesso, ideia: IDEIA_ACESSO },
  { key: "suporte", label: "Suporte", hash: "suporte", Icone: IconeSuporte, Tela: Suporte, secundario: true },
];

// ==UserScript==
// @name         LLE Importadora — Devolução Shopee -> llelle
// @namespace    lle-importadora
// @version      0.1.0
// @description  Raspa a lista/detalhe de devolução do Shopee Seller e manda pro backend do llelle (aba Devoluções)
// @match        https://seller.shopee.com.br/portal/sale/returnrefundcancel*
// @match        https://seller.shopee.com.br/portal/sale/return/*
// @grant        GM_xmlhttpRequest
// @connect      llelle.onrender.com
// ==/UserScript==

/**
 * PONTO DE PARTIDA, NÃO PRODUTO PRONTO.
 *
 * Este script foi escrito sem acesso à tela real do Shopee Seller (só ao texto que foi colado
 * numa conversa) — os seletores abaixo marcados com TODO quase certamente vão precisar de ajuste.
 * O jeito de achar o seletor certo: botão direito num elemento na tela do Shopee > Inspecionar,
 * ver a classe/estrutura real no painel do navegador (F12 > Elements).
 *
 * O que ESTE script tenta fazer:
 * 1. Na tela de LISTA (/returnrefundcancel): acha cada "card" de solicitação visível na página e
 *    manda um lote (array) pro backend de uma vez — idPedido, idDevolucaoShopee, motivoDevolucao,
 *    valorReembolso, valorCompensacao (não tem data exata da solicitação nem a descrição do
 *    comprador aqui, só na tela de detalhe).
 * 2. Na tela de DETALHE (/return/:id): pega o que só existe ali — data exata da solicitação e a
 *    descrição que o comprador escreveu — e manda só esse registro.
 *
 * As duas raspagens se completam no backend (merge por idPedido, ver lib/shopeeImportacao.ts) —
 * rodar só uma das duas já ajuda, não precisa das duas pra funcionar.
 */
(function () {
  "use strict";

  // ===== CONFIGURAÇÃO — ajuste antes de usar =====
  const BACKEND_URL = "https://llelle.onrender.com/api/devolucao/shopee";
  const IMPORT_TOKEN = "COLE_AQUI_O_MESMO_VALOR_DE_SHOPEE_IMPORT_TOKEN_DO_RENDER";
  // ================================================

  function enviar(payload) {
    GM_xmlhttpRequest({
      method: "POST",
      url: BACKEND_URL,
      headers: { "Content-Type": "application/json", "x-import-token": IMPORT_TOKEN },
      data: JSON.stringify(payload),
      onload: (resposta) => console.log("[llelle] enviado:", resposta.status, resposta.responseText),
      onerror: (erro) => console.error("[llelle] falha ao enviar pro backend:", erro),
    });
  }

  /**
   * Acha o texto que aparece logo DEPOIS de um rótulo (ex: acha o elemento cujo texto é
   * "ID do Pedido" e devolve o texto do elemento seguinte, que costuma ser o valor).
   * TODO: se a tela real não seguir esse padrão "rótulo num elemento, valor no próximo irmão",
   * ajuste aqui — pode ser preciso subir pro elemento pai e pegar outro filho, por exemplo.
   */
  function valorAposRotulo(raiz, rotulo) {
    const candidatos = [...raiz.querySelectorAll("*")].filter(
      (el) => el.children.length === 0 && el.textContent?.trim() === rotulo,
    );
    for (const el of candidatos) {
      const valor = el.nextElementSibling?.textContent?.trim();
      if (valor) return valor;
    }
    return null;
  }

  function paraNumero(texto) {
    if (!texto) return undefined;
    const limpo = texto.replace(/[^\d,.-]/g, "").replace(/\.(?=\d{3},)/g, "").replace(",", ".");
    const numero = Number(limpo);
    return Number.isFinite(numero) ? numero : undefined;
  }

  /** "12-09-2026 10:36" ou "12/09/2026" -> "2026-09-12". */
  function paraIso(dataBrasileira) {
    const match = dataBrasileira?.match(/(\d{2})[-/](\d{2})[-/](\d{4})/);
    if (!match) return undefined;
    const [, dia, mes, ano] = match;
    return `${ano}-${mes}-${dia}`;
  }

  // ===== Tela de LISTA (/returnrefundcancel) =====
  function rasparLista() {
    // TODO: trocar pelo seletor real de cada bloco/card de solicitação (o que se repete uma vez
    // por linha da lista — "vilmacastro529", "ID do Pedido", "ID da Solicitação" etc. dentro dele).
    const cards = document.querySelectorAll("[SELETOR_DE_CADA_CARD_DE_SOLICITACAO]");
    if (cards.length === 0) {
      console.warn("[llelle] nenhum card encontrado na lista — ajuste o seletor em rasparLista().");
      return;
    }

    const registros = [...cards]
      .map((card) => {
        const idPedido = valorAposRotulo(card, "ID do Pedido");
        if (!idPedido) return null;
        return {
          idPedido,
          idDevolucaoShopee: valorAposRotulo(card, "ID da Solicitação") ?? undefined,
          motivoDevolucao: valorAposRotulo(card, "Motivo de Devolução") ?? undefined,
          valorReembolso: paraNumero(valorAposRotulo(card, "Reembolso")),
          valorCompensacao: paraNumero(valorAposRotulo(card, "Compensação")),
        };
      })
      .filter((registro) => registro != null);

    console.log(`[llelle] ${registros.length} solicitação(ões) reconhecida(s) de ${cards.length} card(s) na tela.`);
    if (registros.length > 0) enviar(registros);
  }

  // ===== Tela de DETALHE (/return/:id) =====
  function rasparDetalhe() {
    const idDevolucaoShopee = location.pathname.split("/").filter(Boolean).pop();
    const idPedido = valorAposRotulo(document.body, "ID do Pedido") ?? undefined;

    // "Comprador solicitou Devolução/Reembolso" aparece na linha do tempo, com a data/hora do lado.
    const eventoSolicitacao = [...document.querySelectorAll("*")].find(
      (el) => el.children.length === 0 && el.textContent?.includes("solicitou Devolução"),
    );
    const dataSolicitacao = paraIso(eventoSolicitacao?.nextElementSibling?.textContent?.trim());

    const motivoDevolucao = valorAposRotulo(document.body, "Motivo da devolução:") ?? undefined;
    const descricaoCliente = valorAposRotulo(document.body, "Descrição:") ?? undefined;
    const valorReembolso = paraNumero(valorAposRotulo(document.body, "Valor do reembolso:"));

    if (!idPedido) {
      console.warn("[llelle] não achei o ID do Pedido nessa tela de detalhe — ajuste rasparDetalhe().");
      return;
    }

    console.log("[llelle] raspado da tela de detalhe:", { idPedido, idDevolucaoShopee, dataSolicitacao, motivoDevolucao });
    enviar({ idPedido, idDevolucaoShopee, dataSolicitacao, motivoDevolucao, descricaoCliente, valorReembolso });
  }

  function rasparAgora() {
    if (location.pathname.startsWith("/portal/sale/return/")) rasparDetalhe();
    else rasparLista();
  }

  // Botão flutuante — a tela do Shopee é React (carrega os dados depois do HTML inicial), então o
  // disparo automático abaixo pode rodar cedo demais; o botão deixa repetir manualmente quando der.
  const botao = document.createElement("button");
  botao.textContent = "Enviar p/ llelle";
  botao.style.cssText =
    "position:fixed;bottom:16px;right:16px;z-index:99999;padding:10px 16px;background:#111;color:#fff;border:none;border-radius:999px;font-size:13px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.3);";
  botao.onclick = rasparAgora;
  document.body.appendChild(botao);

  // Tenta uma vez sozinho, alguns segundos depois de carregar.
  setTimeout(rasparAgora, 3000);
})();

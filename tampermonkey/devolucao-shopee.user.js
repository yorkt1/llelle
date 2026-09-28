// ==UserScript==
// @name         LLE Importadora — Devolução Shopee -> llelle
// @namespace    lle-importadora
// @version      0.2.0
// @description  Raspa a lista/detalhe de devolução do Shopee Seller e manda pro backend do llelle (aba Devoluções)
// @match        https://seller.shopee.com.br/portal/sale/returnrefundcancel*
// @match        https://seller.shopee.com.br/portal/sale/return/*
// @grant        GM_xmlhttpRequest
// @connect      llelle.onrender.com
// ==/UserScript==

/**
 * Rótulos confirmados numa tela real de devolução (print, não só texto colado):
 *   "Nº da solicitação", "Nº do pedido", "Motivo da devolução", "Descrição",
 *   "Valor do reembolso", e um campo "Opção" (a variação exata do item, ex.: "110V") —
 *   bem mais confiável que tentar adivinhar a voltagem pela descrição do produto.
 *
 * A tela de LISTA (/returnrefundcancel) ainda não tem seletor confirmado — o card de cada
 * solicitação continua marcado como TODO. Pra achar: botão direito num card > Inspecionar.
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
   * Acha o valor associado a um rótulo, tentando 3 formas comuns de a tela montar isso — sem
   * precisar saber de antemão qual delas o Shopee usa:
   * 1. Rótulo é o texto exato de um elemento, valor é o elemento irmão seguinte.
   * 2. Rótulo e valor estão em blocos separados (o irmão seguinte do PAI do rótulo).
   * 3. Rótulo e valor são o mesmo nó de texto (ex.: "Nº do pedido\n260913...") — devolve o que
   *    vem depois do rótulo dentro do mesmo elemento.
   */
  function acharValor(raiz, testeTexto, comprimentoParaCortar) {
    const elementos = [...raiz.querySelectorAll("*")];
    for (const el of elementos) {
      if (el.children.length !== 0) continue;
      const texto = el.textContent?.trim() ?? "";
      if (!testeTexto(texto)) continue;

      const valorIrmao = el.nextElementSibling?.textContent?.trim();
      if (valorIrmao) return valorIrmao;

      const valorIrmaoDoPai = el.parentElement?.nextElementSibling?.textContent?.trim();
      if (valorIrmaoDoPai) return valorIrmaoDoPai;

      if (comprimentoParaCortar != null && texto.length > comprimentoParaCortar) {
        return texto.slice(comprimentoParaCortar).trim();
      }
    }
    return null;
  }

  function valorAposRotulo(raiz, rotulo) {
    // Tenta com e sem ":" no final — não deu pra confirmar se o rótulo real inclui o dois-pontos.
    return (
      acharValor(raiz, (texto) => texto === rotulo, rotulo.length) ??
      acharValor(raiz, (texto) => texto === `${rotulo}:`, rotulo.length + 1)
    );
  }

  function valorProximoDoTextoQueContem(raiz, trecho) {
    return acharValor(raiz, (texto) => texto.includes(trecho), null);
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
    // por linha da lista). Ainda não confirmado contra a tela real.
    const cards = document.querySelectorAll("[SELETOR_DE_CADA_CARD_DE_SOLICITACAO]");
    if (cards.length === 0) {
      console.warn("[llelle] nenhum card encontrado na lista — ajuste o seletor em rasparLista().");
      return;
    }

    const registros = [...cards]
      .map((card) => {
        const idPedido = valorAposRotulo(card, "Nº do pedido");
        if (!idPedido) return null;
        return {
          idPedido,
          idDevolucaoShopee: valorAposRotulo(card, "Nº da solicitação") ?? undefined,
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
    const idPedido = valorAposRotulo(document.body, "Nº do pedido") ?? undefined;
    const idDevolucaoShopee =
      valorAposRotulo(document.body, "Nº da solicitação") ?? location.pathname.split("/").filter(Boolean).pop();

    const dataSolicitacao = paraIso(valorProximoDoTextoQueContem(document.body, "solicitou Devolução"));
    const motivoDevolucao = valorAposRotulo(document.body, "Motivo da devolução") ?? undefined;
    const descricaoCliente = valorAposRotulo(document.body, "Descrição") ?? undefined;
    const valorReembolso = paraNumero(valorAposRotulo(document.body, "Valor do reembolso"));
    // "Opção" é a variação exata do item (ex.: "110V") — mais confiável que adivinhar pela descrição.
    const variacaoShopee = valorAposRotulo(document.body, "Opção") ?? undefined;

    if (!idPedido) {
      console.warn("[llelle] não achei o Nº do pedido nessa tela de detalhe — ajuste rasparDetalhe().");
      return;
    }

    const payload = { idPedido, idDevolucaoShopee, dataSolicitacao, motivoDevolucao, descricaoCliente, valorReembolso, variacaoShopee };
    console.log("[llelle] raspado da tela de detalhe:", payload);
    enviar(payload);
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

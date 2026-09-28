// ==UserScript==
// @name         LLE Importadora — Devolução Shopee -> llelle
// @namespace    lle-importadora
// @version      0.7.0
// @description  Raspa a lista/detalhe de devolução do Shopee Seller e manda pro backend do llelle (aba Devoluções)
// @match        https://seller.shopee.com.br/portal/sale/returnrefundcancel*
// @match        https://seller.shopee.com.br/portal/sale/return/*
// @grant        GM_xmlhttpRequest
// @connect      llelle.onrender.com
// ==/UserScript==

/**
 * v0.3.0: trocou a raspagem por DOM (achar o elemento do rótulo e olhar o "irmão") por raspagem
 * em cima de `document.body.innerText` — o texto puro da tela, na ordem visual, sem CSS/script
 * no meio. Motivo do troca: na tela real, o número do pedido e o link "Ver pedido relacionado"
 * ficam em elementos DOM vizinhos mas SEM espaço entre os textContent, então a raspagem por
 * "elemento irmão" colava os dois ("260916792USJJXVer pedido relacionado"). No innerText eles
 * viram linhas separadas, então dá pra pegar só a linha seguinte ao rótulo e parar aí.
 *
 * Confirmado num innerText real colado pelo usuário (tela de detalhe de uma devolução):
 *   "Nº da solicitação" / "Nº do pedido" -> rótulo numa linha, valor na linha seguinte.
 *   "Motivo da devolução: ..." / "Descrição: ..." / "Opção: Vermelho,110V" -> rótulo e valor na
 *     MESMA linha, separados por ": ".
 *   "Valor do reembolso:" -> rótulo numa linha (com dois pontos no final), valor na linha seguinte.
 *   "Comprador solicitou Devolução/ Reembolso" -> cabeçalho do início da linha do tempo; a
 *     data/hora da solicitação é a linha seguinte (ex.: "21-09-2026 10:44").
 *   "Pedido devolvido" -> evento da linha do tempo de rastreio; a data/hora seguinte (ex.:
 *     "2026-09-25 15:11:10", já em ISO) é quando o produto devolvido chegou de volta na loja —
 *     vira a coluna DATA RECEBIMENTO PRODUTO na planilha.
 *
 * v0.5.0: tirou o botão "Enviar p/ llelle" — agora é 100% automático. Em vez de um
 * `setTimeout` de tempo fixo (que podia disparar antes do React terminar de desenhar a tela),
 * fica num loop de verificação (`setInterval`) que só raspa quando o "Nº do pedido" já apareceu
 * de verdade no texto da página, e detecta troca de URL (inclusive sem reload de página, comum
 * em SPA) pra resetar e tentar de novo na devolução seguinte.
 *
 * v0.7.0: trocou o avisinho que aparecia/sumia por um indicador FIXO no canto da tela —
 * vermelho ("● Aguardando dados...") assim que abre a página (ou troca de devolução), e vira
 * verde ("✔ Enviado pro llelle") quando o envio dá certo. Fica visível o tempo todo, então dá
 * pra saber o status de longe sem precisar abrir o Console.
 *
 * A tela de LISTA (/returnrefundcancel) ainda não tem seletor de card confirmado — TODO.
 */
(function () {
  "use strict";

  // ===== CONFIGURAÇÃO — ajuste antes de usar =====
  const BACKEND_URL = "https://llelle.onrender.com/api/devolucao/shopee";
  const IMPORT_TOKEN = "COLE_AQUI_O_MESMO_VALOR_DE_SHOPEE_IMPORT_TOKEN_DO_RENDER";
  // ================================================

  // Indicador fixo (não some sozinho) — começa vermelho quando a página abre/troca de devolução,
  // e vira verde quando o envio pra o llelle dá certo. Se der erro, fica vermelho com o motivo,
  // pra dar pra notar sem precisar abrir o Console.
  const VERMELHO = "#b3261e";
  const VERDE = "#1a7d3a";

  function criarIndicador() {
    const el = document.createElement("div");
    el.id = "llelle-indicador";
    el.style.cssText = `
      position:fixed;bottom:16px;right:16px;z-index:99999;padding:10px 16px;
      color:#fff;border-radius:8px;font-size:13px;font-family:sans-serif;
      box-shadow:0 2px 8px rgba(0,0,0,.3);transition:background-color .3s;
    `;
    document.body.appendChild(el);
    return el;
  }

  const indicador = criarIndicador();

  function atualizarIndicador(texto, cor) {
    indicador.textContent = texto;
    indicador.style.background = cor;
  }

  atualizarIndicador("● Aguardando dados...", VERMELHO);

  function enviar(payload) {
    GM_xmlhttpRequest({
      method: "POST",
      url: BACKEND_URL,
      headers: { "Content-Type": "application/json", "x-import-token": IMPORT_TOKEN },
      data: JSON.stringify(payload),
      onload: (resposta) => {
        console.log("[llelle] enviado:", resposta.status, resposta.responseText);
        if (resposta.status >= 200 && resposta.status < 300) {
          atualizarIndicador("✔ Enviado pro llelle", VERDE);
        } else {
          atualizarIndicador(`✕ Erro ao enviar (${resposta.status})`, VERMELHO);
        }
      },
      onerror: (erro) => {
        console.error("[llelle] falha ao enviar pro backend:", erro);
        atualizarIndicador("✕ Falha ao enviar pro llelle", VERMELHO);
      },
    });
  }

  function escapeRegExp(texto) {
    return texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function linhasNaoVazias(texto) {
    return texto
      .split("\n")
      .map((linha) => linha.trim())
      .filter(Boolean);
  }

  /**
   * Aceita os 2 formatos confirmados na tela real:
   * 1. "Rótulo: valor" na mesma linha.
   * 2. "Rótulo" (sozinho, com ou sem ":" no final) numa linha, valor na linha seguinte não vazia.
   */
  function valorDoRotulo(texto, rotulo) {
    const escapado = escapeRegExp(rotulo);

    const inline = texto.match(new RegExp(`${escapado}:\\s*([^\\n]+)`));
    if (inline) return inline[1].trim();

    const linhas = linhasNaoVazias(texto);
    const idx = linhas.findIndex((linha) => linha === rotulo || linha === `${rotulo}:`);
    if (idx !== -1 && idx + 1 < linhas.length) return linhas[idx + 1];

    return null;
  }

  function paraNumero(texto) {
    if (!texto) return undefined;
    const limpo = texto
      .replace(/[^\d,.-]/g, "")
      .replace(/\.(?=\d{3},)/g, "")
      .replace(",", ".");
    const numero = Number(limpo);
    return Number.isFinite(numero) ? numero : undefined;
  }

  /**
   * A tela mistura dois formatos de data: "21-09-2026 10:44" (brasileiro, no início da linha do
   * tempo) e "2026-09-25 15:11:10" (já ISO, nos eventos de rastreio como "Pedido devolvido").
   * Tenta ISO primeiro — senão dá pra confundir "21-09-2026" com ano=21 se checasse na ordem errada.
   */
  function paraIso(data) {
    if (!data) return undefined;

    const iso = data.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

    const brasileira = data.match(/(\d{2})[-/](\d{2})[-/](\d{4})/);
    if (!brasileira) return undefined;
    const [, dia, mes, ano] = brasileira;
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
        const texto = card.innerText;
        const idPedido = valorDoRotulo(texto, "Nº do pedido");
        if (!idPedido) return null;
        return {
          idPedido,
          idDevolucaoShopee: valorDoRotulo(texto, "Nº da solicitação") ?? undefined,
          motivoDevolucao: valorDoRotulo(texto, "Motivo da devolução") ?? undefined,
          valorReembolso: paraNumero(valorDoRotulo(texto, "Valor do reembolso")),
          valorCompensacao: paraNumero(valorDoRotulo(texto, "Compensação")),
        };
      })
      .filter((registro) => registro != null);

    console.log(`[llelle] ${registros.length} solicitação(ões) reconhecida(s) de ${cards.length} card(s) na tela.`);
    if (registros.length > 0) enviar(registros);
  }

  // ===== Tela de DETALHE (/return/:id) =====
  function rasparDetalhe() {
    const texto = document.body.innerText;

    const idPedido = valorDoRotulo(texto, "Nº do pedido") ?? undefined;
    const idDevolucaoShopee =
      valorDoRotulo(texto, "Nº da solicitação") ?? location.pathname.split("/").filter(Boolean).pop();

    const dataSolicitacao = paraIso(valorDoRotulo(texto, "Comprador solicitou Devolução/ Reembolso"));
    const motivoDevolucao = valorDoRotulo(texto, "Motivo da devolução") ?? undefined;
    const descricaoCliente = valorDoRotulo(texto, "Descrição") ?? undefined;
    const valorReembolso = paraNumero(valorDoRotulo(texto, "Valor do reembolso"));
    // "Opção" é a variação exata do item (ex.: "Vermelho,110V") — mais confiável que adivinhar
    // a voltagem/cor pela descrição do produto no Tiny.
    const variacaoShopee = valorDoRotulo(texto, "Opção") ?? undefined;
    // "Pedido devolvido" na linha do tempo de rastreio = quando o produto chegou de volta na loja.
    const dataRecebimento = paraIso(valorDoRotulo(texto, "Pedido devolvido"));

    if (!idPedido) {
      console.warn("[llelle] não achei o Nº do pedido nessa tela de detalhe — ajuste rasparDetalhe().");
      return;
    }

    const payload = {
      idPedido,
      idDevolucaoShopee,
      dataSolicitacao,
      motivoDevolucao,
      descricaoCliente,
      valorReembolso,
      variacaoShopee,
      dataRecebimento,
    };
    console.log("[llelle] raspado da tela de detalhe:", payload);
    enviar(payload);
  }

  // Sem botão — 100% automático. A tela do Shopee é React (o conteúdo aparece um tempo depois do
  // HTML inicial, e navegar de uma devolução pra outra às vezes nem recarrega a página), então em
  // vez de esperar um tempo fixo, fica checando em loop: só raspa a tela de detalhe quando o
  // "Nº do pedido" já apareceu de verdade no texto, e reseta o controle sempre que a URL muda —
  // assim funciona tanto no carregamento inicial quanto ao trocar de devolução sem recarregar.
  let ultimaUrlVista = null;
  let jaEnviadoNestaUrl = false;

  function verificarEEnviar() {
    const urlAtual = location.pathname + location.search;
    if (urlAtual !== ultimaUrlVista) {
      ultimaUrlVista = urlAtual;
      jaEnviadoNestaUrl = false;
      atualizarIndicador("● Aguardando dados...", VERMELHO); // nova devolução, ainda não enviou
    }
    if (jaEnviadoNestaUrl) return;

    if (location.pathname.startsWith("/portal/sale/return/")) {
      if (!document.body.innerText.includes("Nº do pedido")) return; // React ainda carregando
      rasparDetalhe();
      jaEnviadoNestaUrl = true;
      return;
    }

    if (location.pathname.startsWith("/portal/sale/returnrefundcancel")) {
      rasparLista();
      jaEnviadoNestaUrl = true; // não repete o aviso de seletor faltando toda hora nessa tela
    }
  }

  setInterval(verificarEEnviar, 800);
  verificarEEnviar();
})();

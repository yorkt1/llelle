// ==UserScript==
// @name         LLE Importadora — Devolução Mercado Livre -> llelle
// @namespace    lle-importadora
// @version      0.1.0
// @description  Raspa a tela de detalhe de venda devolvida do Mercado Livre e manda pro backend do llelle (aba Devoluções)
// @match        https://www.mercadolivre.com.br/*
// @match        https://myaccount.mercadolivre.com.br/*
// @grant        GM_xmlhttpRequest
// @connect      llelle.onrender.com
// ==/UserScript==

/**
 * Confirmado num texto real colado pelo usuário (tela de detalhe de uma venda devolvida,
 * "Pós-venda" > "Detalhe da venda"):
 *   "Venda #2000018413435016 11 set 18:43 hs" -> número da venda logo depois de "Venda #".
 *   "PKDF" (iniciais) / "Patricia Kelley De Freitas" / "PATFREITAS08 | CPF 36129007817" -> o
 *     nome do comprador vem na linha IMEDIATAMENTE ANTES da linha "USUARIO | CPF NUMERO".
 *   "Problema da venda:O comprador disse que não é da cor, tamanho ou modelo escolhido" -> sem
 *     espaço depois dos dois-pontos nessa tela (diferente do Shopee) — o motivo é "Problema da
 *     venda:", valor na mesma linha.
 *   "Cor: Branco | SKU LLETSEG-2" -> variação do item.
 *   "Devolvido" seguido de "29 set. 15:37 | Entregamos o pacote." na linha do tempo de rastreio —
 *     data em que o produto devolvido chegou de volta na loja. A tela só mostra dia/mês (sem
 *     ano), então o ano é inferido como o ano corrente no momento em que o script roda — pode
 *     sair errado só se o atendente abrir essa tela bem depois da virada do ano em cima de uma
 *     devolução de dezembro, caso raro.
 *
 * A URL exata da tela de detalhe de venda não foi confirmada (o dump original não trouxe
 * location.href) — por isso o @match é amplo (qualquer página do domínio do Mercado Livre) e o
 * script só age quando reconhece os marcadores de texto da tela ("Venda #", "Problema da venda")
 * de verdade, em vez de confiar só na URL. Se identificar a URL real da tela de detalhe de venda,
 * dá pra trocar o @match por algo mais específico.
 */
(function () {
  "use strict";

  // ===== CONFIGURAÇÃO — ajuste antes de usar =====
  const BACKEND_URL = "https://llelle.onrender.com/api/devolucao/mercadolivre";
  const IMPORT_TOKEN = "COLE_AQUI_O_MESMO_VALOR_DE_MERCADOLIVRE_IMPORT_TOKEN_DO_RENDER";
  // ================================================

  // Mesmo indicador fixo (bolinha de 12px) já usado no script do Shopee — vermelho enquanto
  // espera, verde quando envia com sucesso, tooltip com o detalhe.
  const VERMELHO = "#b3261e";
  const VERDE = "#1a7d3a";

  function criarIndicador() {
    const el = document.createElement("div");
    el.id = "llelle-indicador-ml";
    el.style.cssText = `
      position:fixed;bottom:32px;right:16px;z-index:99999;width:12px;height:12px;
      border-radius:50%;box-shadow:0 1px 4px rgba(0,0,0,.4);transition:background-color .3s;
    `;
    document.body.appendChild(el);
    return el;
  }

  const indicador = criarIndicador();

  function atualizarIndicador(texto, cor) {
    indicador.title = texto;
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

  function linhasNaoVazias(texto) {
    return texto
      .split("\n")
      .map((linha) => linha.trim())
      .filter(Boolean);
  }

  const MESES_PT = {
    jan: 1,
    fev: 2,
    mar: 3,
    abr: 4,
    mai: 5,
    jun: 6,
    jul: 7,
    ago: 8,
    set: 9,
    out: 10,
    nov: 11,
    dez: 12,
  };

  function extrairVendaId(texto) {
    const match = texto.match(/Venda #(\d+)/);
    return match ? match[1] : null;
  }

  // "USUARIO | CPF 00000000000" — o nome do comprador fica na linha imediatamente anterior,
  // confirmado na tela real (ver comentário no topo do arquivo).
  function extrairClienteECpf(texto) {
    const linhas = linhasNaoVazias(texto);
    const idx = linhas.findIndex((linha) => /\|\s*CPF\s*\d+/i.test(linha));
    if (idx === -1) return { cliente: null, cpf: null };

    const cpfMatch = linhas[idx].match(/CPF\s*(\d+)/i);
    const cliente = idx > 0 ? linhas[idx - 1] : null;
    return { cliente, cpf: cpfMatch ? cpfMatch[1] : null };
  }

  function extrairProblemaDaVenda(texto) {
    const match = texto.match(/Problema da venda:\s*([^\n]+)/);
    return match ? match[1].trim() : null;
  }

  function extrairCorESku(texto) {
    const match = texto.match(/Cor:\s*([^|\n]+?)\s*\|\s*SKU\s*([^\n]+)/i);
    if (!match) return { cor: null, sku: null };
    return { cor: match[1].trim(), sku: match[2].trim() };
  }

  // "29 set. 15:37 | Entregamos o pacote." (o ponto depois do mês é opcional — variou entre a
  // data da venda e a do evento de rastreio na tela real). Ano inferido (ver comentário do topo).
  function extrairDataRecebimento(texto) {
    const match = texto.match(/(\d{1,2})\s+([a-zç]{3})\.?\s+\d{2}:\d{2}\s*\|\s*Entregamos o pacote/i);
    if (!match) return null;

    const dia = Number(match[1]);
    const mes = MESES_PT[match[2].toLowerCase()];
    if (!mes) return null;

    const ano = new Date().getFullYear();
    return `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
  }

  let ultimoIdEnviado = null;

  function verificarEEnviar() {
    const texto = document.body.innerText;
    const idPedido = extrairVendaId(texto);
    if (!idPedido || !texto.includes("Problema da venda")) return; // não é a tela de detalhe de uma devolução

    if (idPedido === ultimoIdEnviado) return; // já enviado nessa venda, evita reenviar em loop

    const { cliente, cpf } = extrairClienteECpf(texto);
    const { cor, sku } = extrairCorESku(texto);

    const payload = {
      idPedido,
      motivoDevolucao: extrairProblemaDaVenda(texto) ?? undefined,
      cliente: cliente ?? undefined,
      cpf: cpf ?? undefined,
      corML: cor ?? undefined,
      skuML: sku ?? undefined,
      dataRecebimento: extrairDataRecebimento(texto) ?? undefined,
    };

    console.log("[llelle] raspado da tela de detalhe de venda do Mercado Livre:", payload);
    enviar(payload);
    ultimoIdEnviado = idPedido;
    atualizarIndicador("● Aguardando dados...", VERMELHO);
  }

  // Mesma ideia do script do Shopee: a tela é React e o conteúdo demora a aparecer, então fica
  // num loop de verificação em vez de um tempo fixo — e detecta a venda seguinte automaticamente
  // (via `ultimoIdEnviado`) sem precisar de reload de página.
  setInterval(verificarEEnviar, 800);
  verificarEEnviar();
})();

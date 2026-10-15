// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Estoque } from "../src/Estoque";

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status }));
}

function fetchEstoqueVazio(input: unknown) {
  const url = String(input);
  if (url.endsWith("/api/estoque")) return jsonResponse({ ruas: [] });
  if (url.endsWith("/api/estoque/produtos")) return jsonResponse({ produtos: [], info: {}, unidadesPorCaixa: {} });
  if (url.endsWith("/api/estoque/configuracao-alerta")) return jsonResponse({ limiteEstoqueBaixo: 5 });
  if (url.endsWith("/api/embalagem/colaboradores")) return jsonResponse({ colaboradores: [{ nome: "Ana" }] });
  return jsonResponse({});
}

describe("Estoque", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    window.history.replaceState(null, "", "/");
  });

  it("abre um diálogo acessível, mantém o foco dentro dele e pede confirmação ao descartar alterações", async () => {
    vi.stubGlobal("fetch", vi.fn(fetchEstoqueVazio));
    const confirmar = vi.spyOn(window, "confirm").mockReturnValue(false);
    const user = userEvent.setup();
    render(<Estoque />);

    const abrir = await screen.findByRole("button", { name: "+ Gaveta" });
    await user.click(abrir);
    const dialog = screen.getByRole("dialog", { name: /nova gaveta/i });
    const fechar = within(dialog).getByRole("button", { name: "Fechar" });
    const botoes = within(dialog).getAllByRole("button");
    botoes[botoes.length - 1].focus();
    await user.tab();
    expect(fechar).toHaveFocus();

    await user.selectOptions(within(dialog).getByLabelText(/rua/i), "A");
    await user.clear(within(dialog).getByPlaceholderText("Ex.: 3"));
    await user.type(within(dialog).getByPlaceholderText("Ex.: 3"), "2");
    await user.keyboard("{Escape}");
    expect(confirmar).toHaveBeenCalledWith("Descartar as alterações desta contagem?");
    expect(screen.getByRole("dialog", { name: /nova gaveta/i })).toBeInTheDocument();

    confirmar.mockReturnValue(true);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(abrir).toHaveFocus();
  });

  it("mostra erro de rede em português e permite tentar carregar novamente", async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetch);
    render(<Estoque />);

    expect((await screen.findAllByText(/falha de comunicação com o servidor/i)).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Tentar de novo" })).toBeInTheDocument();
  });

  it("só oferece cadastro de produtos pela busca do Tiny", async () => {
    vi.stubGlobal("fetch", vi.fn(fetchEstoqueVazio));
    const user = userEvent.setup();
    render(<Estoque />);

    await user.click(await screen.findByRole("button", { name: "+ Adicionar produtos" }));
    const dialog = screen.getByRole("dialog", { name: "Produtos" });
    expect(within(dialog).getByRole("tab", { name: "Buscar no Tiny" })).toHaveAttribute("aria-selected", "true");
    expect(within(dialog).getByRole("tab", { name: "Produtos cadastrados" })).toBeInTheDocument();
    expect(within(dialog).queryByRole("tab", { name: /colar uma lista|sugestões|um por um/i })).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText("Novo produto")).not.toBeInTheDocument();
  });

  it("filtra por estoque por padrão e registra no endereço quando a pessoa inclui zerados", async () => {
    vi.stubGlobal("fetch", vi.fn((input: unknown) => {
      const url = String(input);
      if (url.endsWith("/api/estoque")) {
        return jsonResponse({
          ruas: [{
            rua: "A",
            posicoes: [{
              rua: "A",
              codigo: "A1",
              produto: "Liquidificador 220V",
              voltagem: "220V",
              ultima: { id: "contagem-1", quantidade: 3, responsavel: "Ana", fotoUrl: "foto", criadoEm: "2026-10-15T12:00:00.000Z" },
            }],
          }],
        });
      }
      if (url.endsWith("/api/estoque/produtos")) {
        return jsonResponse({ produtos: ["Liquidificador 220V", "Chaleira 110V"], info: {}, unidadesPorCaixa: {} });
      }
      if (url.endsWith("/api/estoque/configuracao-alerta")) return jsonResponse({ limiteEstoqueBaixo: 5 });
      if (url.endsWith("/api/embalagem/colaboradores")) return jsonResponse({ colaboradores: [{ nome: "Ana" }] });
      return jsonResponse({});
    }));
    const user = userEvent.setup();
    render(<Estoque />);

    expect(await screen.findByText("Liquidificador 220V")).toBeInTheDocument();
    expect(screen.queryByText("Chaleira 110V")).not.toBeInTheDocument();
    await user.click(screen.getByLabelText("Só com estoque"));
    expect(await screen.findByText("Chaleira 110V")).toBeInTheDocument();
    await waitFor(() => expect(window.location.search).toContain("estoqueSoComEstoque=0"));
  });

  it("filtro de voltagem inclui produtos zerados", async () => {
    vi.stubGlobal("fetch", vi.fn((input: unknown) => {
      const url = String(input);
      if (url.endsWith("/api/estoque")) return jsonResponse({ ruas: [] });
      if (url.endsWith("/api/estoque/produtos")) {
        return jsonResponse({ produtos: ["Chaleira Koti 110V", "Chaleira Koti 220V"], info: {}, unidadesPorCaixa: {} });
      }
      if (url.endsWith("/api/estoque/configuracao-alerta")) return jsonResponse({ limiteEstoqueBaixo: 5 });
      if (url.endsWith("/api/embalagem/colaboradores")) return jsonResponse({ colaboradores: [{ nome: "Ana" }] });
      return jsonResponse({});
    }));
    const user = userEvent.setup();
    render(<Estoque />);

    expect(await screen.findByRole("checkbox", { name: "Só com estoque" })).toBeChecked();
    await user.selectOptions(screen.getByLabelText("Filtrar por voltagem"), "110V");
    expect(screen.getByRole("checkbox", { name: "Só com estoque" })).not.toBeChecked();
    expect(await screen.findByText("Chaleira Koti 110V")).toBeInTheDocument();
    expect(screen.queryByText("Chaleira Koti 220V")).not.toBeInTheDocument();
  });

  it("mostra a contagem atual e a diferença para a anterior no histórico", async () => {
    window.history.replaceState(null, "", "/?estoqueVisao=longarinas");
    const historico = [
      { id: "atual", quantidade: 40, responsavel: "Ana", fotoUrl: "https://example.com/atual.jpg", criadoEm: "2026-10-15T12:00:00.000Z" },
      { id: "anterior", quantidade: 42, responsavel: "Bruno", fotoUrl: "https://example.com/anterior.jpg", criadoEm: "2026-10-14T12:00:00.000Z" },
    ];
    vi.stubGlobal("fetch", vi.fn((input: unknown) => {
      const url = String(input);
      if (url.endsWith("/api/estoque/A/A1/historico")) return jsonResponse({ historico });
      if (url.endsWith("/api/estoque")) {
        return jsonResponse({
          ruas: [
            {
              rua: "A",
              posicoes: [
                {
                  rua: "A",
                  codigo: "A1",
                  produto: "Liquidificador",
                  voltagem: "220V",
                  ultima: historico[0],
                },
              ],
            },
          ],
        });
      }
      return jsonResponse({ produtos: ["Liquidificador"], info: {}, unidadesPorCaixa: {}, limiteEstoqueBaixo: 5 });
    }));
    const user = userEvent.setup();
    render(<Estoque />);

    await user.click(await screen.findByTitle("Abrir gaveta A1"));
    await user.click(screen.getByRole("button", { name: "Ver histórico" }));

    expect(await screen.findByText("Era 42 → agora 40 un.")).toBeInTheDocument();
    expect(screen.getByText(/Contagem atual: 40/)).toBeInTheDocument();
  });

  it("permite registrar uma transferência pelo formulário da gaveta", async () => {
    window.history.replaceState(null, "", "/?estoqueVisao=longarinas");
    let quantidades = [10, 2];
    const base = [
      { rua: "A", codigo: "A1", produto: "Liquidificador", voltagem: "220V", ultima: { id: "origem", quantidade: 10, responsavel: "Ana", fotoUrl: "https://example.com/a1.jpg", criadoEm: "2026-10-15T12:00:00.000Z" } },
      { rua: "A", codigo: "A2", produto: "Liquidificador", voltagem: "220V", ultima: { id: "destino", quantidade: 2, responsavel: "Ana", fotoUrl: "https://example.com/a2.jpg", criadoEm: "2026-10-15T12:00:00.000Z" } },
    ];
    const fetch = vi.fn((input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/movimentos") && init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        quantidades = [quantidades[0] - body.quantidade, quantidades[1] + body.quantidade];
        return jsonResponse({ eventos: [] }, 201);
      }
      if (url.endsWith("/api/estoque")) {
        return jsonResponse({
          ruas: [{
            rua: "A",
            posicoes: base.map((item, index) => ({
              ...item,
              ultima: { ...item.ultima, id: index === 0 ? "origem" : "destino", quantidade: quantidades[index] },
            })),
          }],
        });
      }
      if (url.endsWith("/api/estoque/produtos")) return jsonResponse({ produtos: ["Liquidificador"], info: {}, unidadesPorCaixa: {} });
      if (url.endsWith("/api/estoque/configuracao-alerta")) return jsonResponse({ limiteEstoqueBaixo: 5 });
      if (url.endsWith("/api/embalagem/colaboradores")) return jsonResponse({ colaboradores: [{ nome: "Ana" }] });
      return jsonResponse({});
    });
    vi.stubGlobal("fetch", fetch);
    const user = userEvent.setup();
    render(<Estoque />);

    await user.click(await screen.findByTitle("Abrir gaveta A1"));
    await user.click(screen.getByRole("button", { name: "Movimentar estoque" }));
    const dialog = screen.getByRole("dialog", { name: /movimentar gaveta A1/i });
    await user.selectOptions(within(dialog).getByLabelText("Tipo de movimentação"), "transferencia");
    await user.type(within(dialog).getByRole("spinbutton", { name: "Quantidade" }), "3");
    await user.selectOptions(within(dialog).getByLabelText("Gaveta de destino"), "A|A2");
    await user.type(within(dialog).getByLabelText(/Motivo/), "Reorganização");
    await user.click(within(dialog).getByRole("button", { name: "Registrar movimentação" }));

    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      "/api/estoque/A/A1/movimentos",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"tipo":"transferencia"'),
      }),
    ));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(quantidades).toEqual([7, 5]);
  });
});

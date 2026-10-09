// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ControlePedidos } from "../src/ControlePedidos";

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status }));
}

describe("ControlePedidos", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("carrega, calcula pendências e salva alterações automaticamente", async () => {
    const fetchMock = vi.fn((input: unknown, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.includes("/api/pedidos/historico")) return jsonResponse({ dias: [] });
      if (method === "PUT") {
        return jsonResponse({ dia: { ...JSON.parse(String(init?.body)), data: url.split("/").pop(), atualizado: new Date().toISOString() } });
      }
      return jsonResponse({ dia: null });
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    const { container } = render(<ControlePedidos />);

    const [responsavel] = await screen.findAllByRole("textbox", { name: "Responsável" });
    await user.type(responsavel, "Tiago");
    await user.type(screen.getByRole("spinbutton", { name: /TikTok Shop Recebidos Turno manhã/i }), "12");
    await user.type(screen.getByRole("spinbutton", { name: /TikTok Shop Expedidos Turno manhã/i }), "5");

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/pedidos\/\d{4}-\d{2}-\d{2}$/),
      expect.objectContaining({ method: "PUT" }),
    ), { timeout: 3000 });
    await waitFor(() => expect(screen.getByText("7", { selector: "strong" })).toBeInTheDocument());
    expect(container.querySelector(".controle-pedidos-status")?.textContent).toContain("Salvo");

    const escrita = fetchMock.mock.calls
      .map(([, init]) => init)
      .find((init) => init?.method === "PUT");
    expect(JSON.parse(String(escrita?.body)).manha.resp).toBe("Tiago");
  });
});

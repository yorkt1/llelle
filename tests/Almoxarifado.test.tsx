// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Almoxarifado } from "../src/Almoxarifado";
import type { EstadoAlmoxarifado } from "../lib/almoxarifado";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Almoxarifado", () => {
  it("abre o movimento do item, salva pela API e atualiza o saldo", async () => {
    const estado: EstadoAlmoxarifado = {
      categorias: [{
        id: "embalagens",
        nome: "Embalagens",
        itens: [{ id: "saco", nome: "SACO 30X40", saldo: 20, minimo: 5, passo: 1, unidade: "unidades" }],
      }],
      historico: [],
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "POST" && url.endsWith("/movimentacoes")) {
        const body = JSON.parse(String(init.body)) as { itemId: string; tipo: "entrada" | "saida"; quantidade: number };
        const item = estado.categorias[0].itens.find((candidato) => candidato.id === body.itemId)!;
        item.saldo = Number(item.saldo) + (body.tipo === "entrada" ? body.quantidade : -body.quantidade);
        return new Response(JSON.stringify({ estado: structuredClone(estado) }), { status: 200 });
      }
      return new Response(JSON.stringify({ estado }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Almoxarifado />);
    expect(screen.queryByRole("button", { name: /restaurar original/i })).not.toBeInTheDocument();
    await userEvent.click(await screen.findByRole("button", { name: /registrar movimentação/i }));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Item para movimentar" }), "saco");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Tipo de movimento" }), "entrada");
    await userEvent.type(screen.getByRole("spinbutton", { name: "Quantidade da movimentação" }), "5");
    await userEvent.type(screen.getByRole("textbox", { name: "Observação da movimentação" }), "Reposição");
    await userEvent.click(screen.getByRole("button", { name: /^registrar$/i }));

    await waitFor(() => expect(screen.getByRole("textbox", { name: "Saldo de SACO 30X40" })).toHaveValue("25"));
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/almoxarifado/movimentacoes"),
      expect.objectContaining({ method: "POST", body: expect.stringContaining('"observacao":"Reposição"') }),
    );
  });
});
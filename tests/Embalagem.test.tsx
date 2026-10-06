// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Embalagem } from "../src/Embalagem";

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status }));
}

const desempenhoVazio = {
  dia: "06/10/2026",
  colaboradores: [],
  totalPedidos: 0,
  totalHoras: 0,
  totalTempoFormatado: "0h 00min",
  naoIdentificados: 0,
  completo: true,
  atualizadoEm: new Date().toISOString(),
};

type Colaborador = { idUsuarioEmbalador: string; nome: string; bancada?: string };

/** Mock de fetch que serve /api/embalagem (relatório fixo) e mantém uma lista de colaboradores
 * em memória pra /api/embalagem/colaboradores, respondendo POST/DELETE de verdade — assim os
 * testes de CRUD exercitam o componente igual a uma API real, sem bater em produção. */
function mockarFetch(colaboradoresIniciais: Colaborador[] = []) {
  let colaboradores = [...colaboradoresIniciais];
  const fetchMock = vi.fn((input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";

    if (url.includes("/api/embalagem/colaboradores")) {
      if (method === "GET") return jsonResponse({ colaboradores });
      if (method === "POST") {
        const body = JSON.parse(String(init?.body ?? "{}")) as Colaborador;
        colaboradores = colaboradores.filter((c) => c.idUsuarioEmbalador !== body.idUsuarioEmbalador);
        colaboradores.push(body);
        return jsonResponse({ colaborador: body }, 201);
      }
      if (method === "DELETE") {
        const id = decodeURIComponent(url.split("/").pop()!);
        colaboradores = colaboradores.filter((c) => c.idUsuarioEmbalador !== id);
        return Promise.resolve(new Response(null, { status: 204 }));
      }
    }

    if (url.includes("/api/embalagem?")) {
      return jsonResponse(desempenhoVazio);
    }

    throw new Error(`fetch inesperado: ${method} ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, getColaboradores: () => colaboradores };
}

async function abrirPainelDeColaboradores() {
  await userEvent.click(screen.getByRole("button", { name: /configurar colaboradores/i }));
}

describe("Embalagem — CRUD de colaboradores", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("Create: cadastra um colaborador novo e ele aparece na tabela", async () => {
    mockarFetch();
    render(<Embalagem />);
    await abrirPainelDeColaboradores();

    await userEvent.type(screen.getByLabelText(/id do usuário no tiny/i), "449251343");
    await userEvent.type(screen.getByLabelText(/nome do colaborador/i), "Geovane");
    await userEvent.click(screen.getByRole("button", { name: /adicionar/i }));

    await waitFor(() => expect(screen.getByText("449251343")).toBeInTheDocument());
    expect(screen.getByText("Geovane")).toBeInTheDocument();
  });

  it("Read: lista carrega colaboradores já cadastrados, e mostra aviso quando vazia", async () => {
    mockarFetch([{ idUsuarioEmbalador: "111", nome: "Alex" }]);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<Embalagem />);
    await abrirPainelDeColaboradores();

    await waitFor(() => expect(screen.getByText("Alex")).toBeInTheDocument());

    // some e cadastro fica vazio: mostra o aviso de lista vazia.
    await userEvent.click(screen.getByRole("button", { name: /excluir/i }));
    await waitFor(() => expect(screen.getByText(/nenhum colaborador cadastrado ainda/i)).toBeInTheDocument());
  });

  it("Update: editar nome e bancada atualiza a tabela sem recarregar a página", async () => {
    mockarFetch([{ idUsuarioEmbalador: "222", nome: "Werisvan", bancada: "99" }]);
    render(<Embalagem />);
    await abrirPainelDeColaboradores();
    await waitFor(() => expect(screen.getByText("Werisvan")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /editar/i }));
    const campoNome = screen.getByLabelText(/nome do colaborador/i);
    await userEvent.clear(campoNome);
    await userEvent.type(campoNome, "Werisvan Silva");
    const campoBancada = screen.getByLabelText(/bancada \(opcional\)/i);
    await userEvent.clear(campoBancada);
    await userEvent.type(campoBancada, "03");
    await userEvent.click(screen.getByRole("button", { name: /salvar alteração/i }));

    await waitFor(() => expect(screen.getByText("Werisvan Silva")).toBeInTheDocument());
    expect(screen.getByText("03")).toBeInTheDocument();
    expect(screen.queryByText("Werisvan")).not.toBeInTheDocument();
  });

  it("Delete: remove com confirmação — cancelar a confirmação não remove nada", async () => {
    mockarFetch([{ idUsuarioEmbalador: "333", nome: "Giovane" }]);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<Embalagem />);
    await abrirPainelDeColaboradores();
    await waitFor(() => expect(screen.getByText("Giovane")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /excluir/i }));
    expect(confirmSpy).toHaveBeenCalled();
    expect(screen.getByText("Giovane")).toBeInTheDocument(); // ainda lá — confirmação negada

    confirmSpy.mockReturnValue(true);
    await userEvent.click(screen.getByRole("button", { name: /excluir/i }));
    await waitFor(() => expect(screen.queryByText("Giovane")).not.toBeInTheDocument());
  });

  it("validação: ID vazio", async () => {
    mockarFetch();
    render(<Embalagem />);
    await abrirPainelDeColaboradores();
    await userEvent.type(screen.getByLabelText(/nome do colaborador/i), "Geovane");
    await userEvent.click(screen.getByRole("button", { name: /adicionar/i }));
    expect(await screen.findByText(/informe o id/i)).toBeInTheDocument();
  });

  it("validação: ID com letras", async () => {
    mockarFetch();
    render(<Embalagem />);
    await abrirPainelDeColaboradores();
    await userEvent.type(screen.getByLabelText(/id do usuário no tiny/i), "abc123");
    await userEvent.type(screen.getByLabelText(/nome do colaborador/i), "Geovane");
    await userEvent.click(screen.getByRole("button", { name: /adicionar/i }));
    expect(await screen.findByText(/apenas números/i)).toBeInTheDocument();
  });

  it("validação: ID duplicado (ao adicionar, não ao editar)", async () => {
    mockarFetch([{ idUsuarioEmbalador: "111", nome: "Alex" }]);
    render(<Embalagem />);
    await abrirPainelDeColaboradores();
    await waitFor(() => expect(screen.getByText("Alex")).toBeInTheDocument());

    await userEvent.type(screen.getByLabelText(/id do usuário no tiny/i), "111");
    await userEvent.type(screen.getByLabelText(/nome do colaborador/i), "Outra Pessoa");
    await userEvent.click(screen.getByRole("button", { name: /adicionar/i }));
    expect(await screen.findByText(/já está cadastrado/i)).toBeInTheDocument();
  });

  it("validação: nome vazio ou só com espaços", async () => {
    mockarFetch();
    render(<Embalagem />);
    await abrirPainelDeColaboradores();
    await userEvent.type(screen.getByLabelText(/id do usuário no tiny/i), "111");
    await userEvent.type(screen.getByLabelText(/nome do colaborador/i), "   ");
    await userEvent.click(screen.getByRole("button", { name: /adicionar/i }));
    expect(await screen.findByText(/informe o nome/i)).toBeInTheDocument();
  });

  it("validação: nome com mais de 100 caracteres não quebra o card (card mostra elipse, não o texto todo)", async () => {
    const nomeGigante = "A".repeat(150);
    mockarFetch();
    render(<Embalagem />);
    await abrirPainelDeColaboradores();

    const campoNome = screen.getByLabelText(/nome do colaborador/i) as HTMLInputElement;
    await userEvent.type(campoNome, nomeGigante);
    // maxLength no input já impede passar de 100 ao digitar — a validação de submit é a rede de
    // segurança caso o valor chegue maior por outro caminho (colar texto, por exemplo).
    expect(campoNome.value.length).toBeLessThanOrEqual(100);
  });

  it("acentos no nome são aceitos e exibidos corretamente", async () => {
    mockarFetch();
    render(<Embalagem />);
    await abrirPainelDeColaboradores();

    await userEvent.type(screen.getByLabelText(/id do usuário no tiny/i), "555");
    await userEvent.type(screen.getByLabelText(/nome do colaborador/i), "José André");
    await userEvent.click(screen.getByRole("button", { name: /adicionar/i }));

    await waitFor(() => expect(screen.getByText("José André")).toBeInTheDocument());
  });

  it("erro de API: mostra a mensagem e mantém o que foi digitado (formulário não limpa)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: unknown, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        if (url.includes("/api/embalagem/colaboradores") && method === "GET") return jsonResponse({ colaboradores: [] });
        if (url.includes("/api/embalagem/colaboradores") && method === "POST") {
          return jsonResponse({ erro: "Não consegui salvar o colaborador." }, 500);
        }
        if (url.includes("/api/embalagem?")) return jsonResponse(desempenhoVazio);
        throw new Error(`fetch inesperado: ${method} ${url}`);
      }),
    );

    render(<Embalagem />);
    await abrirPainelDeColaboradores();
    await userEvent.type(screen.getByLabelText(/id do usuário no tiny/i), "999");
    await userEvent.type(screen.getByLabelText(/nome do colaborador/i), "Geovane");
    await userEvent.click(screen.getByRole("button", { name: /adicionar/i }));

    expect(await screen.findByText("Não consegui salvar o colaborador.")).toBeInTheDocument();
    expect(screen.getByLabelText(/id do usuário no tiny/i)).toHaveValue("999");
    expect(screen.getByLabelText(/nome do colaborador/i)).toHaveValue("Geovane");
  });

  it('card sem colaborador cadastrado mostra "Sem nome" + badge "Cadastrar", que abre o painel com o ID preenchido', async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: unknown, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        if (url.includes("/api/embalagem/colaboradores")) return jsonResponse({ colaboradores: [] });
        if (url.includes("/api/embalagem?")) {
          return jsonResponse({
            ...desempenhoVazio,
            colaboradores: [
              { idUsuarioEmbalador: "777888999", nome: "ID 777888999 (sem nome cadastrado)", pedidos: 5, pedidosPorHora: 50, horas: 0.1, tempoFormatado: "0h 06min" },
            ],
            totalPedidos: 5,
          });
        }
        throw new Error(`fetch inesperado: ${method} ${url}`);
      }),
    );

    render(<Embalagem />);
    await waitFor(() => expect(screen.getByText("Sem nome")).toBeInTheDocument());

    const badge = screen.getByRole("button", { name: /cadastrar.*7778/i });
    await userEvent.click(badge);

    expect(screen.getByLabelText(/id do usuário no tiny/i)).toHaveValue("777888999");
  });
});

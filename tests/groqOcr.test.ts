import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

async function freshGroqOcr() {
  vi.resetModules();
  return import("../lib/groqOcr");
}

describe("lerNumeroSerieComGroq", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.GROQ_API_KEY;
    delete process.env.GROQ_VISION_MODEL;
  });

  it("lança GroqConfigError sem GROQ_API_KEY, sem nem chamar fetch", async () => {
    delete process.env.GROQ_API_KEY;
    const { lerNumeroSerieComGroq, GroqConfigError } = await freshGroqOcr();

    await expect(lerNumeroSerieComGroq("data:image/png;base64,abc")).rejects.toBeInstanceOf(GroqConfigError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("manda a imagem e o prompt certos, devolve o texto da resposta", async () => {
    process.env.GROQ_API_KEY = "chave-de-teste";
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ choices: [{ message: { content: "TRL08 220240912MP-0857" } }] }),
    );

    const { lerNumeroSerieComGroq } = await freshGroqOcr();
    const resultado = await lerNumeroSerieComGroq("data:image/png;base64,abc");

    expect(resultado).toBe("TRL08 220240912MP-0857");
    const [url, opcoes] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(opcoes?.headers).toMatchObject({ Authorization: "Bearer chave-de-teste" });
    const corpo = JSON.parse(opcoes?.body as string);
    expect(corpo.model).toBe("meta-llama/llama-4-scout-17b-16e-instruct");
    expect(corpo.messages[0].content[1]).toEqual({ type: "image_url", image_url: { url: "data:image/png;base64,abc" } });
  });

  it("usa GROQ_VISION_MODEL quando configurado, em vez do padrão", async () => {
    process.env.GROQ_API_KEY = "chave-de-teste";
    process.env.GROQ_VISION_MODEL = "outro-modelo-de-visao";
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: "ABC123" } }] }));

    const { lerNumeroSerieComGroq } = await freshGroqOcr();
    await lerNumeroSerieComGroq("data:image/png;base64,abc");

    const corpo = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(corpo.model).toBe("outro-modelo-de-visao");
  });

  it("lança erro quando a Groq responde NAO_ENCONTRADO", async () => {
    process.env.GROQ_API_KEY = "chave-de-teste";
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: "NAO_ENCONTRADO" } }] }));

    const { lerNumeroSerieComGroq } = await freshGroqOcr();
    await expect(lerNumeroSerieComGroq("data:image/png;base64,abc")).rejects.toThrow(/não encontrou/i);
  });

  it("lança erro com o status quando a Groq responde com erro HTTP", async () => {
    process.env.GROQ_API_KEY = "chave-de-teste";
    vi.mocked(fetch).mockResolvedValueOnce(new Response("modelo inválido", { status: 400 }));

    const { lerNumeroSerieComGroq } = await freshGroqOcr();
    await expect(lerNumeroSerieComGroq("data:image/png;base64,abc")).rejects.toThrow(/400/);
  });
});

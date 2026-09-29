/**
 * Lê o "Número de Série" de uma foto de etiqueta usando um modelo de visão via Groq (API
 * compatível com a da OpenAI) — muito mais tolerante a foto real (reflexo, ângulo, fundo sujo)
 * do que OCR tradicional, mas é uma chamada externa: exige `GROQ_API_KEY` configurado, custa
 * uma requisição por leitura, e o nome do modelo de visão muda com o tempo no catálogo da Groq
 * (o padrão abaixo pode precisar de ajuste — confira em https://console.groq.com/docs/models
 * quais modelos de visão estão disponíveis, e ajuste via GROQ_VISION_MODEL se precisar).
 *
 * Usado como primeira tentativa em `src/Devolucoes.tsx`; se isso não estiver configurado (ou
 * falhar), o front cai pro OCR local (`tesseract.js`) — nunca é a única forma de preencher o
 * campo.
 */

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODELO_PADRAO = "meta-llama/llama-4-scout-17b-16e-instruct";

export class GroqConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GroqConfigError";
  }
}

const PROMPT = [
  'Esta é a foto de uma etiqueta de produto. Ache o campo "Número de Série" (ou "Serial", "S/N",',
  '"SN") e responda SOMENTE com o valor desse campo — sem aspas, sem o rótulo, sem explicação.',
  "Se não conseguir achar esse campo na imagem, responda exatamente: NAO_ENCONTRADO",
].join(" ");

interface RespostaGroq {
  choices?: { message?: { content?: string } }[];
}

/** `imagemDataUri` é a imagem inteira como data URI (ex.: `data:image/png;base64,...`). */
export async function lerNumeroSerieComGroq(imagemDataUri: string): Promise<string> {
  const chave = process.env.GROQ_API_KEY;
  if (!chave) {
    throw new GroqConfigError("GROQ_API_KEY não configurado no servidor.");
  }

  const modelo = process.env.GROQ_VISION_MODEL ?? MODELO_PADRAO;

  const resposta = await fetch(GROQ_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${chave}` },
    body: JSON.stringify({
      model: modelo,
      temperature: 0,
      max_tokens: 100,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: PROMPT },
            { type: "image_url", image_url: { url: imagemDataUri } },
          ],
        },
      ],
    }),
  });

  if (!resposta.ok) {
    const corpo = await resposta.text().catch(() => "");
    throw new Error(`Groq recusou a leitura da imagem (status ${resposta.status}): ${corpo.slice(0, 300)}`);
  }

  const json = (await resposta.json()) as RespostaGroq;
  const texto = json.choices?.[0]?.message?.content?.trim();
  if (!texto || texto === "NAO_ENCONTRADO") {
    throw new Error("Groq não encontrou o número de série nessa imagem.");
  }
  return texto;
}

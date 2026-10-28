// Cliente do modelo local (vLLM, API compatível com OpenAI). A resposta sai sempre no formato JSON pedido
// (decodificação guiada pelo esquema), então não há texto livre para interpretar.
import { config } from "./config.js";

export type Conteudo = string | ({ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } })[];
export interface MensagemModelo { role: "system" | "user"; content: Conteudo }

export class FalhaModelo extends Error {}

export async function respostaEstruturada<T>(
  mensagens: MensagemModelo[], esquema: object, maxTokens = 2000,
): Promise<{ dados: T; ms: number }> {
  if (!config.ia.url) throw new FalhaModelo("IA_URL não configurada");
  const inicio = Date.now();
  let resposta: Response;
  try {
    resposta = await fetch(`${config.ia.url}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(config.ia.timeoutMs),
      body: JSON.stringify({
        model: config.ia.modelo,
        messages: mensagens,
        temperature: 0.2,
        max_tokens: maxTokens,
        chat_template_kwargs: { enable_thinking: false },
        response_format: { type: "json_schema", json_schema: { name: "resposta", schema: esquema, strict: true } },
      }),
    });
  } catch (e) {
    throw new FalhaModelo(`Modelo inacessível: ${(e as Error).message}`);
  }
  if (!resposta.ok) throw new FalhaModelo(`Modelo respondeu HTTP ${resposta.status}: ${(await resposta.text()).slice(0, 300)}`);
  const corpo = await resposta.json() as any;
  const escolha = corpo.choices?.[0];
  if (escolha?.finish_reason === "length") throw new FalhaModelo("Resposta do modelo cortada (limite de tokens)");
  try {
    return { dados: JSON.parse(escolha?.message?.content ?? "") as T, ms: Date.now() - inicio };
  } catch {
    throw new FalhaModelo("Resposta do modelo não é JSON válido");
  }
}

/** Conferência rápida para a tela de configuração. */
export async function modeloDisponivel(): Promise<boolean> {
  try {
    const r = await fetch(`${config.ia.url}/models`, { signal: AbortSignal.timeout(5000) });
    return r.ok;
  } catch {
    return false;
  }
}

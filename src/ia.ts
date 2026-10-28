// Cliente do modelo local (vLLM, API compatível com OpenAI).
// A resposta é pedida em JSON pelo prompt, SEM decodificação guiada: com a gramática forçando o formato, este
// modelo às vezes "travava" emitindo espaços até o limite de tokens. Quem chama valida tudo o que voltar.
import { config } from "./config.js";

export type Conteudo = string | ({ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } })[];
export interface MensagemModelo { role: "system" | "user"; content: Conteudo }

export class FalhaModelo extends Error {}

/** Extrai o objeto JSON da resposta (tolera ```json ... ``` e texto em volta). */
export function extrairJson(texto: string): unknown {
  const semCerca = texto.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
  try {
    return JSON.parse(semCerca);
  } catch {
    const ini = semCerca.indexOf("{");
    const fim = semCerca.lastIndexOf("}");
    if (ini >= 0 && fim > ini) return JSON.parse(semCerca.slice(ini, fim + 1));
    throw new Error("sem JSON");
  }
}

/** Pede a resposta em JSON. Se vier cortada ou ilegível, tenta mais uma vez (temperatura 0) antes de falhar. */
export async function respostaJson(mensagens: MensagemModelo[], maxTokens = 2500): Promise<{ dados: any; ms: number }> {
  if (!config.ia.url) throw new FalhaModelo("IA_URL não configurada");
  const inicio = Date.now();
  let erro = "";
  for (const temperatura of [0.2, 0]) {
    const escolha = await chamar(mensagens, maxTokens, temperatura);
    const conteudo = String(escolha?.message?.content ?? "");
    if (escolha?.finish_reason === "length") {
      erro = `Resposta do modelo cortada (limite de tokens): ${conteudo.slice(0, 200)} … ${conteudo.slice(-200)}`;
      continue;
    }
    try {
      return { dados: extrairJson(conteudo), ms: Date.now() - inicio };
    } catch {
      erro = `Resposta do modelo não é JSON válido: ${conteudo.slice(0, 300)}`;
    }
  }
  throw new FalhaModelo(erro);
}

async function chamar(mensagens: MensagemModelo[], maxTokens: number, temperatura: number): Promise<any> {
  let resposta: Response;
  try {
    resposta = await fetch(`${config.ia.url}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(config.ia.timeoutMs),
      body: JSON.stringify({
        model: config.ia.modelo,
        messages: mensagens,
        temperature: temperatura,
        max_tokens: maxTokens,
        chat_template_kwargs: { enable_thinking: false },
      }),
    });
  } catch (e) {
    throw new FalhaModelo(`Modelo inacessível: ${(e as Error).message}`);
  }
  if (!resposta.ok) throw new FalhaModelo(`Modelo respondeu HTTP ${resposta.status}: ${(await resposta.text()).slice(0, 300)}`);
  const corpo = await resposta.json() as any;
  return corpo.choices?.[0];
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

import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

function obrigatoria(nome: string): string {
  const valor = process.env[nome];
  if (!valor) throw new Error(`Variável de ambiente ${nome} não definida (veja .env.example)`);
  return valor;
}

const sessionSecret = obrigatoria("SESSION_SECRET");
if (sessionSecret.length < 32) throw new Error("SESSION_SECRET precisa ter pelo menos 32 caracteres");

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baseUrl = process.env.BASE_URL ?? "http://127.0.0.1:3200";

export const config = {
  raiz,
  // Anexos ficam fora da pasta pública.
  pastaAnexos: path.resolve(raiz, process.env.PASTA_ANEXOS ?? "data/anexos"),
  producao: process.env.NODE_ENV === "production",
  porta: Number(process.env.PORT ?? 3200),
  // Endereço do portal do cliente (links nos e-mails dos clientes).
  baseUrl,
  // Endereço do painel da OCP (links nos e-mails da equipe). Hoje pelo Tailscale; na Fase 4, Cloudflare Access.
  painelUrl: process.env.PAINEL_URL ?? baseUrl,
  // Endereço e rede Docker por onde chega a internet (Cloudflare Tunnel); ver src/publico.ts.
  hostPublico: process.env.HOST_PUBLICO ?? "",
  redePublicaPrefixo: process.env.REDE_PUBLICA_PREFIXO ?? "172.31.251.",
  // Proxies confiáveis para descobrir o IP real (tailscale serve e cloudflared chegam por redes Docker).
  trustProxy: process.env.TRUST_PROXY ?? "loopback, uniquelocal",
  sessionSecret,
  // "smtp" envia de verdade; "arquivo" grava em data/emails (instância de teste).
  emailModo: process.env.EMAIL_MODO === "arquivo" ? "arquivo" : "smtp",
  pastaEmails: path.resolve(raiz, process.env.PASTA_EMAILS ?? "data/emails"),
  smtp: {
    host: process.env.SMTP_HOST ?? "",
    port: Number(process.env.SMTP_PORT ?? 465),
    user: process.env.SMTP_USER ?? "",
    password: process.env.SMTP_PASSWORD ?? "",
    from: process.env.SMTP_FROM ?? "OCP Suporte <notifications@ocp.com.br>",
  },
  // Chamado resolvido sem resposta do cliente fecha sozinho depois de N dias.
  diasFecharResolvido: Number(process.env.DIAS_FECHAR_RESOLVIDO ?? 5),
  // Triagem com o modelo local (vLLM do Hermes, pela rede Docker ocp-ia). Vazio desliga.
  ia: {
    url: process.env.IA_URL ?? "http://vllm:8000/v1",
    modelo: process.env.IA_MODELO ?? "nvidia/Qwen3.6-35B-A3B-NVFP4",
    timeoutMs: Number(process.env.IA_TIMEOUT_MS ?? 120_000),
    maxRodadas: Number(process.env.IA_MAX_RODADAS ?? 2),          // rodadas de perguntas ao cliente
    horasSemResposta: Number(process.env.IA_HORAS_SEM_RESPOSTA ?? 24), // depois disso, segue para a equipe
    esperaTentativaS: Number(process.env.IA_ESPERA_TENTATIVA_S ?? 60), // modelo fora: espera 1×, 2× isso entre tentativas
  },
  db: {
    host: obrigatoria("DB_HOST"),
    port: Number(process.env.DB_PORT ?? 3306),
    database: obrigatoria("DB_NAME"),
    user: obrigatoria("DB_USER"),
    password: obrigatoria("DB_PASSWORD"),
  },
};

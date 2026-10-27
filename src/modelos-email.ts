import type { Email } from "./email.js";
import { config } from "./config.js";

// Escapa texto vindo do usuário antes de entrar no HTML do e-mail.
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
// Trecho da mensagem no e-mail (o resto fica no portal).
const trecho = (texto: string, max = 600) => (texto.length > max ? `${texto.slice(0, max)}…` : texto);

interface Corpo {
  titulo: string;
  paragrafos: string[]; // já escapados
  citacao?: string;     // texto livre do usuário (escapado aqui)
  botao?: { texto: string; url: string };
}

function montar(para: string, assunto: string, corpo: Corpo): Email {
  const citacao = corpo.citacao
    ? `<div style="border-left:3px solid #d9dee6;padding:4px 12px;margin:0 0 12px;white-space:pre-wrap;color:#344054">${esc(trecho(corpo.citacao))}</div>`
    : "";
  const botao = corpo.botao
    ? `<p style="margin:24px 0"><a href="${esc(corpo.botao.url)}" style="background:#0b5cab;color:#fff;text-decoration:none;padding:12px 22px;border-radius:6px;font-weight:600;display:inline-block">${esc(corpo.botao.texto)}</a></p>
       <p style="font-size:12px;color:#667085">Se o botão não abrir, copie este endereço no navegador:<br>${esc(corpo.botao.url)}</p>`
    : "";
  const html = `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#f4f6f9;font-family:Segoe UI,Arial,sans-serif;color:#1d2633">
<div style="max-width:560px;margin:0 auto;padding:24px 16px">
  <p style="font-size:20px;font-weight:700;margin:0 0 16px">OCP<span style="color:#0b5cab">Suporte</span></p>
  <div style="background:#fff;border:1px solid #d9dee6;border-radius:10px;padding:24px">
    <h1 style="font-size:18px;margin:0 0 16px">${esc(corpo.titulo)}</h1>
    ${corpo.paragrafos.map((p) => `<p style="line-height:1.5;margin:0 0 12px">${p}</p>`).join("\n")}
    ${citacao}
    ${botao}
  </div>
  <p style="font-size:12px;color:#667085;margin-top:16px">Mensagem automática do suporte da OCP. Para responder, use o portal (as respostas a este e-mail não chegam ao chamado).</p>
</div></body></html>`;
  const texto = [
    corpo.titulo, "",
    ...corpo.paragrafos.map((p) => p.replace(/<[^>]+>/g, "").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))),
    corpo.citacao ? `\n${trecho(corpo.citacao)}` : "",
    corpo.botao ? `\n${corpo.botao.texto}: ${corpo.botao.url}` : "",
  ].join("\n");
  return { para, assunto, html, texto };
}

interface Pessoa { nome: string; email: string }
interface Chamado { id: number; titulo: string; cliente?: string }

export const numero = (id: number) => `#${String(id).padStart(5, "0")}`;
const linkPortal = (c: Chamado) => `${config.baseUrl}/portal/chamados/${c.id}`;
const linkPainel = (c: Chamado) => `${config.painelUrl}/painel/chamados/${c.id}`;

// --- Conta ---

export function convite(p: Pessoa, link: string, empresa: string | null): Email {
  return montar(p.email, "Seu acesso ao suporte da OCP", {
    titulo: "Bem-vindo ao suporte da OCP",
    paragrafos: [
      `Olá, ${esc(p.nome)}. Foi criado um acesso para você${empresa ? ` (${esc(empresa)})` : ""} no portal de suporte da OCP.`,
      "Clique no botão abaixo para definir sua senha. O link vale por 7 dias.",
    ],
    botao: { texto: "Definir minha senha", url: link },
  });
}

export function redefinirSenha(p: Pessoa, link: string): Email {
  return montar(p.email, "Redefinição de senha — suporte OCP", {
    titulo: "Redefinir senha",
    paragrafos: [
      `Olá, ${esc(p.nome)}. Recebemos um pedido para redefinir sua senha.`,
      "O link vale por 1 hora. Se não foi você, ignore este e-mail: sua senha atual continua valendo.",
    ],
    botao: { texto: "Criar nova senha", url: link },
  });
}

export function codigoLogin(p: Pessoa, codigo: string): Email {
  return montar(p.email, `${codigo} é seu código de acesso ao suporte OCP`, {
    titulo: "Código de acesso",
    paragrafos: [
      `Olá, ${esc(p.nome)}. Use o código abaixo para concluir seu login:`,
      `<span style="font-size:30px;font-weight:700;letter-spacing:6px">${esc(codigo)}</span>`,
      "O código vale por 10 minutos. Se não foi você quem tentou entrar, troque sua senha.",
    ],
  });
}

// --- Chamados: para o cliente ---

export function chamadoAberto(p: Pessoa, c: Chamado): Email {
  return montar(p.email, `Chamado ${numero(c.id)} aberto: ${c.titulo}`, {
    titulo: `Recebemos seu chamado ${numero(c.id)}`,
    paragrafos: [
      `Olá, ${esc(p.nome)}. Seu chamado <strong>“${esc(c.titulo)}”</strong> foi registrado e será encaminhado para a equipe.`,
      "Você recebe um aviso por e-mail a cada novidade.",
    ],
    botao: { texto: "Acompanhar chamado", url: linkPortal(c) },
  });
}

export function respostaParaCliente(p: Pessoa, c: Chamado, autor: string, texto: string, aguardando: boolean): Email {
  return montar(p.email, `${aguardando ? "Precisamos de informações" : "Nova resposta"} — chamado ${numero(c.id)}`, {
    titulo: aguardando ? "Precisamos de mais informações" : "Nova resposta no seu chamado",
    paragrafos: [`<strong>${esc(autor)}</strong> respondeu ao chamado <strong>${numero(c.id)} “${esc(c.titulo)}”</strong>:`],
    citacao: texto,
    botao: { texto: "Responder no portal", url: linkPortal(c) },
  });
}

export function chamadoResolvido(p: Pessoa, c: Chamado, texto: string): Email {
  return montar(p.email, `Resolvido: chamado ${numero(c.id)}`, {
    titulo: "Seu chamado foi resolvido",
    paragrafos: [`O chamado <strong>${numero(c.id)} “${esc(c.titulo)}”</strong> foi marcado como resolvido:`],
    citacao: texto,
    botao: { texto: "Confirmar ou reabrir", url: linkPortal(c) },
  });
}

// --- Chamados: para a equipe da OCP ---

export function novoChamado(p: Pessoa, c: Chamado, solicitante: string, texto: string): Email {
  return montar(p.email, `Novo chamado ${numero(c.id)} — ${c.cliente}: ${c.titulo}`, {
    titulo: "Novo chamado aguardando distribuição",
    paragrafos: [`<strong>${esc(solicitante)}</strong> (${esc(c.cliente)}) abriu <strong>${numero(c.id)} “${esc(c.titulo)}”</strong>:`],
    citacao: texto,
    botao: { texto: "Abrir no painel", url: linkPainel(c) },
  });
}

export function chamadoAtribuido(p: Pessoa, c: Chamado, por: string): Email {
  return montar(p.email, `Chamado ${numero(c.id)} atribuído a você — ${c.cliente}`, {
    titulo: "Chamado atribuído a você",
    paragrafos: [`${esc(por)} atribuiu a você o chamado <strong>${numero(c.id)} “${esc(c.titulo)}”</strong> (${esc(c.cliente)}).`],
    botao: { texto: "Abrir no painel", url: linkPainel(c) },
  });
}

export function respostaParaEquipe(p: Pessoa, c: Chamado, autor: string, texto: string, reaberto: boolean): Email {
  return montar(p.email, `${reaberto ? "Reaberto" : "Resposta do cliente"} — chamado ${numero(c.id)} (${c.cliente})`, {
    titulo: reaberto ? "O cliente reabriu o chamado" : "O cliente respondeu",
    paragrafos: [`<strong>${esc(autor)}</strong> (${esc(c.cliente)}) escreveu no chamado <strong>${numero(c.id)} “${esc(c.titulo)}”</strong>:`],
    citacao: texto,
    botao: { texto: "Abrir no painel", url: linkPainel(c) },
  });
}

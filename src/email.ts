import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import nodemailer from "nodemailer";
import { config } from "./config.js";

export interface Email {
  para: string;
  assunto: string;
  html: string;
  texto: string;
  responderPara?: string;
}

const transporte = config.emailModo === "smtp"
  ? nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.port === 465,
    auth: { user: config.smtp.user, pass: config.smtp.password },
    disableFileAccess: true,
    disableUrlAccess: true,
  })
  : null;

export async function enviarEmail(email: Email): Promise<void> {
  if (!transporte) {
    // Instância de teste: nada sai daqui; o teste lê os arquivos.
    await mkdir(config.pastaEmails, { recursive: true });
    await writeFile(path.join(config.pastaEmails, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`), JSON.stringify(email, null, 2));
    return;
  }
  await transporte.sendMail({
    from: config.smtp.from,
    to: email.para,
    replyTo: email.responderPara,
    subject: email.assunto,
    html: email.html,
    text: email.texto,
  });
}

// Avisos de andamento: uma falha de e-mail não pode desfazer a ação (o chamado já foi gravado).
export function avisar(emails: Email[]): void {
  for (const email of emails) {
    enviarEmail(email).catch((e) => console.error(`Falha ao enviar e-mail para ${email.para}:`, (e as Error).message));
  }
}

// Página pública do link de cadastro (/conta/cadastro/:token): a pessoa pede acesso; o administrador aprova no painel.
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { ErroCadastro, departamentosDoCliente } from "../cadastro.js";
import { linkPorToken, solicitar } from "../autocadastro.js";

export const rotasAutocadastro = Router();

// Por IP: uma empresa inteira pode se cadastrar ao mesmo tempo, mas um robô não enche a fila.
const limitePedido = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: (_req, res) => res.status(429).render("erro", { mensagem: "Muitos pedidos deste endereço. Tente de novo em uma hora." }),
});

const linkInvalido = "Este link de cadastro não é válido ou já expirou. Peça um novo à OCP.";

rotasAutocadastro.get("/:token", async (req, res) => {
  const link = await linkPorToken(req.params.token);
  if (!link) return res.status(404).render("erro", { mensagem: linkInvalido });
  res.render("conta/cadastro", { link, departamentos: await departamentosDoCliente(link.cliente_id, true), dados: {}, erro: null, enviado: false });
});

rotasAutocadastro.post("/:token", limitePedido, async (req, res) => {
  const link = await linkPorToken(req.params.token);
  if (!link) return res.status(404).render("erro", { mensagem: linkInvalido });
  // Campo escondido que pessoas não preenchem: robô recebe a mesma resposta, sem gravar nada.
  if (String(req.body.site ?? "") !== "") return res.render("conta/cadastro", { link, departamentos: [], dados: {}, erro: null, enviado: true });
  try {
    await solicitar(req, link, req.body);
    res.render("conta/cadastro", { link, departamentos: [], dados: {}, erro: null, enviado: true });
  } catch (e) {
    if (!(e instanceof ErroCadastro)) throw e;
    res.status(400).render("conta/cadastro", {
      link, departamentos: await departamentosDoCliente(link.cliente_id, true), dados: req.body, erro: e.message, enviado: false,
    });
  }
});

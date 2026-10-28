// Cadastros do administrador: clientes (contrato, departamentos, usuários, sistemas) e a equipe da OCP (analistas, áreas).
import { Router, type Request, type Response } from "express";
import { pool } from "../db/conexao.js";
import { exigirAdmin, exigirEquipe } from "../auth.js";
import { registrar } from "../auditoria.js";
import { derrubarAcessos } from "../contas.js";
import {
  ErroCadastro, atualizarDepartamento, atualizarUsuarioCliente, convidar, criarDepartamento, criarUsuarioCliente,
  departamentosDoCliente, reenviarConvite, usuariosDoCliente,
} from "../cadastro.js";
import { escolha, id, ids, texto } from "../formulario.js";
import { cnpjValido, emailValido, limparDigitos, normalizarCelular } from "../validacao.js";
import { config as configApp } from "../config.js";
import { modeloDisponivel } from "../ia.js";
import { carregarFeriados, recalcularAbertos } from "../prazos.js";
import { consumo, csv, lancamentosDoMes, mesOuAtual, relatorioMes } from "../horas.js";

export const rotasCadastros = Router();
rotasCadastros.use(exigirEquipe, exigirAdmin);

const CATEGORIAS = { erp: "ERP (Protheus)", portal: "Portal / sistema web", infraestrutura: "Infraestrutura", outro: "Outro" } as const;

async function salvar(req: Request, res: Response, voltar: string, fn: () => Promise<string | void>, aviso: string) {
  try {
    req.session.aviso = (await fn()) || aviso;
  } catch (e) {
    if (!(e instanceof ErroCadastro)) throw e;
    req.session.aviso = e.message;
  }
  res.redirect(voltar);
}

// --- Clientes ---

rotasCadastros.get("/clientes", async (_req, res) => {
  const [clientes] = await pool.query<any[]>(
    `SELECT c.*, (SELECT COUNT(*) FROM usuarios u WHERE u.cliente_id = c.id AND u.ativo) AS usuarios,
       (SELECT COUNT(*) FROM chamados ch WHERE ch.cliente_id = c.id AND ch.status NOT IN ('fechado', 'cancelado')) AS abertos,
       (SELECT horas_mes FROM contratos ct WHERE ct.cliente_id = c.id AND ct.inicio <= CURDATE() AND (ct.fim IS NULL OR ct.fim >= CURDATE())
        ORDER BY ct.inicio DESC LIMIT 1) AS horas_mes
     FROM clientes c ORDER BY c.ativo DESC, c.nome`,
  );
  res.render("painel/clientes", { clientes });
});

function dadosCliente(body: any) {
  const nome = texto(body.nome, 150);
  const cnpj = limparDigitos(body.cnpj) || null;
  if (!nome) throw new ErroCadastro("Informe o nome do cliente.");
  if (cnpj && !cnpjValido(cnpj)) throw new ErroCadastro("CNPJ inválido.");
  return { nome, cnpj, observacoes: texto(body.observacoes, 5000) || null };
}

rotasCadastros.post("/clientes", async (req, res) => {
  try {
    const d = dadosCliente(req.body);
    const [r] = await pool.query<any>("INSERT INTO clientes (nome, cnpj, observacoes) VALUES (?, ?, ?)", [d.nome, d.cnpj, d.observacoes])
      .catch((e) => {
        if (e.code === "ER_DUP_ENTRY") throw new ErroCadastro("Já existe cliente com esse CNPJ.");
        throw e;
      });
    await registrar(req, "cliente_criado", { cliente_id: r.insertId, nome: d.nome });
    req.session.aviso = "Cliente criado. Cadastre agora departamentos, usuários e sistemas.";
    res.redirect(`/painel/clientes/${r.insertId}`);
  } catch (e) {
    if (!(e instanceof ErroCadastro)) throw e;
    req.session.aviso = e.message;
    res.redirect("/painel/clientes");
  }
});

async function clienteOu404(req: Request, res: Response) {
  const [linhas] = await pool.query<any[]>("SELECT * FROM clientes WHERE id = ?", [id(req.params.id)]);
  if (!linhas[0]) res.status(404).render("erro", { mensagem: "Cliente não encontrado." });
  return linhas[0];
}

rotasCadastros.get("/clientes/:id", async (req, res) => {
  const cliente = await clienteOu404(req, res);
  if (!cliente) return;
  const [contratos] = await pool.query<any[]>("SELECT * FROM contratos WHERE cliente_id = ? ORDER BY inicio DESC", [cliente.id]);
  const [sistemas] = await pool.query<any[]>(
    `SELECT s.*, GROUP_CONCAT(sd.departamento_id) AS departamento_ids FROM sistemas s
     LEFT JOIN sistema_departamentos sd ON sd.sistema_id = s.id WHERE s.cliente_id = ? GROUP BY s.id ORDER BY s.ativo DESC, s.nome`,
    [cliente.id],
  );
  for (const s of sistemas) s.departamento_ids = s.departamento_ids ? String(s.departamento_ids).split(",").map(Number) : [];
  const [prazosPadrao] = await pool.query<any[]>("SELECT * FROM prazos_padrao");
  const [prazosCliente] = await pool.query<any[]>("SELECT * FROM prazos_cliente WHERE cliente_id = ?", [cliente.id]);
  res.render("painel/cliente", {
    cliente, contratos, sistemas, categorias: CATEGORIAS, consumoMes: await consumo(cliente.id, mesOuAtual(undefined)),
    prazosPadrao: Object.fromEntries(prazosPadrao.map((p) => [p.prioridade, p])),
    prazosCliente: Object.fromEntries(prazosCliente.map((p) => [p.prioridade, p])),
    usuarios: await usuariosDoCliente(cliente.id),
    departamentos: await departamentosDoCliente(cliente.id),
  });
});

const voltarCliente = (req: Request, ancora = "") => `/painel/clientes/${id(req.params.id)}${ancora}`;

rotasCadastros.post("/clientes/:id", async (req, res) => {
  const cliente = await clienteOu404(req, res);
  if (!cliente) return;
  await salvar(req, res, voltarCliente(req), async () => {
    const d = dadosCliente(req.body);
    const ativo = req.body.ativo === "1";
    await pool.query("UPDATE clientes SET nome = ?, cnpj = ?, observacoes = ?, ativo = ? WHERE id = ?", [d.nome, d.cnpj, d.observacoes, ativo, cliente.id])
      .catch((e) => {
        if (e.code === "ER_DUP_ENTRY") throw new ErroCadastro("Já existe cliente com esse CNPJ.");
        throw e;
      });
    if (!ativo && cliente.ativo) {
      // Cliente desativado: ninguém da empresa continua logado.
      const [usuarios] = await pool.query<any[]>("SELECT id FROM usuarios WHERE cliente_id = ?", [cliente.id]);
      await derrubarAcessos(usuarios.map((u) => u.id));
    }
    await registrar(req, "cliente_alterado", { cliente_id: cliente.id, ...d, ativo });
  }, "Cliente atualizado.");
});

rotasCadastros.post("/clientes/:id/contratos", async (req, res) => {
  const cliente = await clienteOu404(req, res);
  if (!cliente) return;
  await salvar(req, res, voltarCliente(req, "#contrato"), async () => {
    const horas = Number(String(req.body.horas_mes ?? "").replace(",", "."));
    const valor = req.body.valor_hora_excedente ? Number(String(req.body.valor_hora_excedente).replace(",", ".")) : null;
    const inicio = String(req.body.inicio ?? "");
    const fim = String(req.body.fim ?? "") || null;
    if (!(horas > 0 && horas < 10000)) throw new ErroCadastro("Informe as horas do pacote mensal.");
    if (valor !== null && !(valor >= 0)) throw new ErroCadastro("Valor da hora excedente inválido.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(inicio) || (fim && (!/^\d{4}-\d{2}-\d{2}$/.test(fim) || fim < inicio))) {
      throw new ErroCadastro("Datas do contrato inválidas.");
    }
    await pool.query(
      "INSERT INTO contratos (cliente_id, horas_mes, valor_hora_excedente, inicio, fim, observacoes) VALUES (?, ?, ?, ?, ?, ?)",
      [cliente.id, horas, valor, inicio, fim, texto(req.body.observacoes, 2000) || null],
    );
    await registrar(req, "contrato_criado", { cliente_id: cliente.id, horas_mes: horas, inicio, fim });
  }, "Contrato registrado.");
});

rotasCadastros.post("/clientes/:id/departamentos", (req, res) =>
  salvar(req, res, voltarCliente(req, "#departamentos"), () => criarDepartamento(req, id(req.params.id)!, req.body), "Departamento criado."));

rotasCadastros.post("/clientes/:id/departamentos/:dep", (req, res) =>
  salvar(req, res, voltarCliente(req, "#departamentos"),
    () => atualizarDepartamento(req, id(req.params.id)!, Number(req.params.dep), req.body), "Departamento atualizado."));

rotasCadastros.post("/clientes/:id/usuarios", async (req, res) => {
  const cliente = await clienteOu404(req, res);
  if (!cliente) return;
  await salvar(req, res, voltarCliente(req, "#usuarios"), async () => {
    if (!(await criarUsuarioCliente(req, cliente.id, req.body))) return "Usuário criado, mas o e-mail de convite falhou. Use “reenviar convite”.";
  }, "Usuário criado. Ele recebeu um e-mail para definir a senha.");
});

rotasCadastros.post("/clientes/:id/usuarios/:usuario", (req, res) =>
  salvar(req, res, voltarCliente(req, "#usuarios"),
    () => atualizarUsuarioCliente(req, id(req.params.id)!, Number(req.params.usuario), req.body), "Usuário atualizado."));

rotasCadastros.post("/clientes/:id/usuarios/:usuario/convite", (req, res) =>
  salvar(req, res, voltarCliente(req, "#usuarios"),
    () => reenviarConvite(req, id(req.params.id)!, Number(req.params.usuario)), "Convite reenviado."));

// Sistemas e ambientes: o que a IA vai consultar para entender o chamado. Nunca senhas.
async function salvarSistema(req: Request, clienteId: number, sistemaId: number | null) {
  const nome = texto(req.body.nome, 100);
  const categoria = escolha(CATEGORIAS, req.body.categoria) ?? "outro";
  if (!nome) throw new ErroCadastro("Informe o nome do sistema.");
  const campos = [nome, categoria, texto(req.body.acesso, 500) || null, texto(req.body.ambientes, 255) || null, texto(req.body.observacoes, 5000) || null];
  const departamentos = ids(req.body.departamentos);
  if (departamentos.length) {
    const [validos] = await pool.query<any[]>("SELECT id FROM departamentos WHERE cliente_id = ? AND id IN (?)", [clienteId, departamentos]);
    if (validos.length !== departamentos.length) throw new ErroCadastro("Departamento inválido.");
  }
  const duplicado = (e: any) => {
    if (e.code === "ER_DUP_ENTRY") throw new ErroCadastro("Já existe um sistema com esse nome para este cliente.");
    throw e;
  };
  if (sistemaId) {
    const [r] = await pool.query<any>(
      "UPDATE sistemas SET nome = ?, categoria = ?, acesso = ?, ambientes = ?, observacoes = ?, ativo = ? WHERE id = ? AND cliente_id = ?",
      [...campos, req.body.ativo === "1", sistemaId, clienteId],
    ).catch(duplicado);
    if (!r.affectedRows) throw new ErroCadastro("Sistema não encontrado.");
  } else {
    const [r] = await pool.query<any>(
      "INSERT INTO sistemas (nome, categoria, acesso, ambientes, observacoes, cliente_id) VALUES (?, ?, ?, ?, ?, ?)", [...campos, clienteId],
    ).catch(duplicado);
    sistemaId = r.insertId as number;
  }
  await pool.query("DELETE FROM sistema_departamentos WHERE sistema_id = ?", [sistemaId]);
  if (departamentos.length) {
    await pool.query("INSERT INTO sistema_departamentos (sistema_id, departamento_id) VALUES ?", [departamentos.map((d) => [sistemaId, d])]);
  }
  await registrar(req, "sistema_salvo", { cliente_id: clienteId, sistema_id: sistemaId, nome });
}

rotasCadastros.post("/clientes/:id/sistemas", (req, res) =>
  salvar(req, res, voltarCliente(req, "#sistemas"), () => salvarSistema(req, id(req.params.id)!, null), "Sistema cadastrado."));

rotasCadastros.post("/clientes/:id/sistemas/:sistema", (req, res) =>
  salvar(req, res, voltarCliente(req, "#sistemas"), () => salvarSistema(req, id(req.params.id)!, id(req.params.sistema)), "Sistema atualizado."));

// --- Equipe da OCP e áreas de atendimento ---

rotasCadastros.get("/equipe", async (_req, res) => {
  const [usuarios] = await pool.query<any[]>(
    `SELECT u.id, u.nome, u.email, u.celular, u.papel, u.ativo, u.ultimo_login, u.senha_hash IS NOT NULL AS acesso_definido,
            GROUP_CONCAT(aa.area_id) AS area_ids
     FROM usuarios u LEFT JOIN analista_areas aa ON aa.usuario_id = u.id
     WHERE u.cliente_id IS NULL GROUP BY u.id ORDER BY u.ativo DESC, u.nome`,
  );
  for (const u of usuarios) u.area_ids = u.area_ids ? String(u.area_ids).split(",").map(Number) : [];
  const [areas] = await pool.query<any[]>("SELECT * FROM areas ORDER BY ativo DESC, nome");
  res.render("painel/equipe", { usuarios, areas });
});

async function areasValidas(valor: unknown): Promise<number[]> {
  const pedidas = ids(valor);
  if (!pedidas.length) return [];
  const [linhas] = await pool.query<any[]>("SELECT id FROM areas WHERE id IN (?)", [pedidas]);
  if (linhas.length !== pedidas.length) throw new ErroCadastro("Área inválida.");
  return pedidas;
}

async function gravarAreas(usuarioId: number, areas: number[]) {
  await pool.query("DELETE FROM analista_areas WHERE usuario_id = ?", [usuarioId]);
  if (areas.length) await pool.query("INSERT INTO analista_areas (usuario_id, area_id) VALUES ?", [areas.map((a) => [usuarioId, a])]);
}

rotasCadastros.post("/equipe/usuarios", (req, res) => salvar(req, res, "/painel/equipe", async () => {
  const nome = texto(req.body.nome, 150);
  const email = texto(req.body.email, 190).toLowerCase();
  const celular = texto(req.body.celular, 30) ? normalizarCelular(req.body.celular) : null;
  const papel = req.body.papel === "admin" ? "admin" : "analista";
  if (!nome || !emailValido(email)) throw new ErroCadastro("Informe nome e e-mail válidos.");
  if (texto(req.body.celular, 30) && !celular) throw new ErroCadastro("Celular inválido. Use DDD + número.");
  const areas = await areasValidas(req.body.areas);
  const [existe] = await pool.query<any[]>("SELECT id FROM usuarios WHERE email = ?", [email]);
  if (existe.length) throw new ErroCadastro("Já existe um usuário com esse e-mail.");
  const [r] = await pool.query<any>("INSERT INTO usuarios (papel, nome, email, celular) VALUES (?, ?, ?, ?)", [papel, nome, email, celular]);
  await gravarAreas(r.insertId, areas);
  await registrar(req, "usuario_criado", { usuario_id: r.insertId, email, papel, areas });
  if (!(await convidar(r.insertId))) return "Usuário criado, mas o e-mail de convite falhou. Use “reenviar convite”.";
}, "Usuário criado. Ele recebeu um e-mail para definir a senha."));

rotasCadastros.post("/equipe/usuarios/:id", (req, res) => salvar(req, res, "/painel/equipe", async () => {
  const usuarioId = Number(req.params.id);
  const [linhas] = await pool.query<any[]>("SELECT * FROM usuarios WHERE id = ? AND cliente_id IS NULL", [usuarioId]);
  const alvo = linhas[0];
  if (!alvo) throw new ErroCadastro("Usuário não encontrado.");
  const papel = req.body.papel === "admin" ? "admin" : "analista";
  const ativo = req.body.ativo === "1";
  const celular = texto(req.body.celular, 30) ? normalizarCelular(req.body.celular) : null;
  if (texto(req.body.celular, 30) && !celular) throw new ErroCadastro("Celular inválido. Use DDD + número.");
  if (usuarioId === req.session.usuario!.id && (papel !== alvo.papel || !ativo)) {
    throw new ErroCadastro("Você não pode mudar o próprio perfil nem se desativar.");
  }
  const areas = await areasValidas(req.body.areas);
  await pool.query("UPDATE usuarios SET nome = ?, celular = ?, papel = ?, ativo = ? WHERE id = ?",
    [texto(req.body.nome, 150) || alvo.nome, celular, papel, ativo, usuarioId]);
  await gravarAreas(usuarioId, areas);
  if (!ativo || papel !== alvo.papel) await derrubarAcessos([usuarioId]);
  await registrar(req, "usuario_alterado", { usuario_id: usuarioId, papel, ativo, areas });
}, "Usuário atualizado."));

rotasCadastros.post("/equipe/usuarios/:id/convite", (req, res) =>
  salvar(req, res, "/painel/equipe", () => reenviarConvite(req, null, Number(req.params.id)), "Convite reenviado."));

rotasCadastros.post("/equipe/areas", (req, res) => salvar(req, res, "/painel/equipe#areas", async () => {
  const nome = texto(req.body.nome, 100);
  if (!nome) throw new ErroCadastro("Informe o nome da área.");
  await pool.query("INSERT INTO areas (nome, descricao) VALUES (?, ?)", [nome, texto(req.body.descricao, 255) || null]).catch((e) => {
    if (e.code === "ER_DUP_ENTRY") throw new ErroCadastro("Essa área já existe.");
    throw e;
  });
  await registrar(req, "area_criada", { nome });
}, "Área criada."));

rotasCadastros.post("/equipe/areas/:id", (req, res) => salvar(req, res, "/painel/equipe#areas", async () => {
  const nome = texto(req.body.nome, 100);
  if (!nome) throw new ErroCadastro("Informe o nome da área.");
  await pool.query("UPDATE areas SET nome = ?, descricao = ?, ativo = ? WHERE id = ?",
    [nome, texto(req.body.descricao, 255) || null, req.body.ativo === "1", id(req.params.id)]).catch((e) => {
    if (e.code === "ER_DUP_ENTRY") throw new ErroCadastro("Essa área já existe.");
    throw e;
  });
  await registrar(req, "area_alterada", { area_id: id(req.params.id), nome, ativo: req.body.ativo === "1" });
}, "Área atualizada."));

// --- Assistente de triagem (IA local) ---

rotasCadastros.get("/ia", async (_req, res) => {
  const [config] = await pool.query<any[]>("SELECT valor FROM configuracoes WHERE chave = 'triagem_ativa'");
  const [roteiros] = await pool.query<any[]>(
    `SELECT r.*, u.nome AS autor FROM roteiros_triagem r LEFT JOIN usuarios u ON u.id = r.atualizado_por
     ORDER BY FIELD(r.tipo, 'incidente', 'duvida', 'solicitacao', 'melhoria')`,
  );
  const [recentes] = await pool.query<any[]>(
    `SELECT t.chamado_id, t.estado, t.rodada, t.duracao_ms, t.erro, t.atualizado_em, c.titulo, cl.nome AS cliente
     FROM triagens t JOIN chamados c ON c.id = t.chamado_id JOIN clientes cl ON cl.id = c.cliente_id
     ORDER BY t.atualizado_em DESC LIMIT 20`,
  );
  const [contagem] = await pool.query<any[]>("SELECT estado, COUNT(*) AS n FROM triagens GROUP BY estado");
  res.render("painel/ia", {
    ativa: config[0]?.valor === "1", disponivel: await modeloDisponivel(), modelo: configApp.ia.modelo,
    roteiros, recentes, contagem: Object.fromEntries(contagem.map((c) => [c.estado, c.n])),
  });
});

rotasCadastros.post("/ia/ativa", async (req, res) => {
  const ativa = req.body.ativa === "1";
  await pool.query("UPDATE configuracoes SET valor = ? WHERE chave = 'triagem_ativa'", [ativa ? "1" : "0"]);
  await registrar(req, "triagem_configurada", { ativa });
  req.session.aviso = ativa ? "Triagem automática ligada." : "Triagem automática desligada: os chamados novos vão direto para a fila.";
  res.redirect("/painel/ia");
});

rotasCadastros.post("/ia/roteiros/:tipo", (req, res) => salvar(req, res, "/painel/ia#roteiros", async () => {
  const instrucoes = texto(req.body.instrucoes, 4000);
  if (!instrucoes) throw new ErroCadastro("O roteiro não pode ficar vazio.");
  const [r] = await pool.query<any>(
    "UPDATE roteiros_triagem SET instrucoes = ?, atualizado_por = ? WHERE tipo = ?", [instrucoes, req.session.usuario!.id, req.params.tipo],
  );
  if (!r.affectedRows) throw new ErroCadastro("Tipo de chamado inválido.");
  await registrar(req, "roteiro_alterado", { tipo: req.params.tipo });
}, "Roteiro salvo. Vale a partir da próxima triagem."));

// --- Horas: relatório mensal por cliente (só a OCP; o cliente recebe quando pedir) ---

rotasCadastros.get("/horas", async (req, res) => {
  const mes = mesOuAtual(req.query.mes);
  res.render("painel/horas", { mes, linhas: await relatorioMes(mes) });
});

rotasCadastros.get("/horas/:cliente", async (req, res) => {
  const mes = mesOuAtual(req.query.mes);
  const clienteId = id(req.params.cliente);
  if (!clienteId) return res.status(404).render("erro", { mensagem: "Cliente não encontrado." });
  const c = await consumo(clienteId, mes);
  if (!c.cliente) return res.status(404).render("erro", { mensagem: "Cliente não encontrado." });
  const lancamentos = await lancamentosDoMes(clienteId, mes);
  if (req.query.formato === "csv") {
    await registrar(req, "horas_exportadas", { cliente_id: clienteId, mes });
    const nome = `horas-${c.cliente.normalize("NFD").replace(/[^\w]+/g, "-").toLowerCase()}-${mes}.csv`;
    return res.type("text/csv; charset=utf-8").attachment(nome).send(csv(lancamentos));
  }
  // Agrupado por chamado, para o relatório que vai ao cliente.
  const porChamado = new Map<number, { id: number; titulo: string; solicitante: string; minutos: number; itens: any[] }>();
  for (const l of lancamentos) {
    const g = porChamado.get(l.chamado_id) ?? { id: l.chamado_id, titulo: l.titulo, solicitante: l.solicitante, minutos: 0, itens: [] as any[] };
    g.itens.push(l);
    if (l.faturavel) g.minutos += l.minutos;
    porChamado.set(l.chamado_id, g);
  }
  res.render("painel/horas-cliente", { mes, c, grupos: [...porChamado.values()], imprimir: req.query.imprimir === "1" });
});

// --- Configurações: prazos padrão e feriados ---

const PRIORIDADES_ORDEM = ["critica", "alta", "normal", "baixa"] as const;

// "1h30", "90", "1,5h" não: o formulário manda horas e minutos separados; aqui só converte e confere.
function minutosDoFormulario(body: any, campo: string): number {
  const h = Number(String(body[`${campo}_h`] ?? "0").replace(",", ".")) || 0;
  const m = Number(body[`${campo}_m`] ?? 0) || 0;
  const total = Math.round(h * 60 + m);
  if (!(total >= 1 && total <= 60 * 600)) throw new ErroCadastro("Prazo inválido (de 1 minuto a 60 dias úteis).");
  return total;
}

rotasCadastros.get("/configuracoes", async (_req, res) => {
  const [prazos] = await pool.query<any[]>("SELECT * FROM prazos_padrao ORDER BY FIELD(prioridade, 'critica', 'alta', 'normal', 'baixa')");
  const [feriados] = await pool.query<any[]>("SELECT DATE_FORMAT(data, '%Y-%m-%d') AS data, nome FROM feriados WHERE data >= CURDATE() - INTERVAL 30 DAY ORDER BY data");
  res.render("painel/configuracoes", { prazos, feriados });
});

rotasCadastros.post("/configuracoes/prazos", (req, res) => salvar(req, res, "/painel/configuracoes#prazos", async () => {
  const novos = PRIORIDADES_ORDEM.map((p) => ({ p, resposta: minutosDoFormulario(req.body, `${p}_resposta`), solucao: minutosDoFormulario(req.body, `${p}_solucao`) }));
  for (const n of novos) {
    if (n.resposta > n.solucao) throw new ErroCadastro("O prazo de 1ª resposta não pode ser maior que o de solução.");
  }
  for (const n of novos) {
    await pool.query("UPDATE prazos_padrao SET resposta_min = ?, solucao_min = ? WHERE prioridade = ?", [n.resposta, n.solucao, n.p]);
  }
  const n = await recalcularAbertos();
  await registrar(req, "prazos_padrao_alterados", { prazos: novos });
  return `Prazos padrão salvos. ${n} chamado(s) aberto(s) recalculado(s).`;
}, ""));

rotasCadastros.post("/configuracoes/feriados", (req, res) => salvar(req, res, "/painel/configuracoes#feriados", async () => {
  const data = String(req.body.data ?? "");
  const nome = texto(req.body.nome, 100);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || !nome) throw new ErroCadastro("Informe a data e o nome do feriado.");
  await pool.query("INSERT INTO feriados (data, nome) VALUES (?, ?) ON DUPLICATE KEY UPDATE nome = VALUES(nome)", [data, nome]);
  await carregarFeriados();
  const n = await recalcularAbertos();
  await registrar(req, "feriado_salvo", { data, nome });
  return `Feriado salvo. ${n} chamado(s) aberto(s) recalculado(s).`;
}, ""));

rotasCadastros.post("/configuracoes/feriados/:data/remover", (req, res) => salvar(req, res, "/painel/configuracoes#feriados", async () => {
  await pool.query("DELETE FROM feriados WHERE data = ?", [String(req.params.data)]);
  await carregarFeriados();
  const n = await recalcularAbertos();
  await registrar(req, "feriado_removido", { data: req.params.data });
  return `Feriado removido. ${n} chamado(s) aberto(s) recalculado(s).`;
}, ""));

// Prazos combinados com o cliente: prioridade em branco = usa o padrão.
rotasCadastros.post("/clientes/:id/prazos", async (req, res) => {
  const cliente = await clienteOu404(req, res);
  if (!cliente) return;
  await salvar(req, res, voltarCliente(req, "#prazos"), async () => {
    const definidos: Record<string, { resposta: number; solucao: number }> = {};
    for (const p of PRIORIDADES_ORDEM) {
      const vazio = ["resposta_h", "resposta_m", "solucao_h", "solucao_m"].every((k) => !String(req.body[`${p}_${k}`] ?? "").trim());
      if (vazio) continue;
      const resposta = minutosDoFormulario(req.body, `${p}_resposta`);
      const solucao = minutosDoFormulario(req.body, `${p}_solucao`);
      if (resposta > solucao) throw new ErroCadastro("O prazo de 1ª resposta não pode ser maior que o de solução.");
      definidos[p] = { resposta, solucao };
    }
    await pool.query("DELETE FROM prazos_cliente WHERE cliente_id = ?", [cliente.id]);
    for (const [p, v] of Object.entries(definidos)) {
      await pool.query("INSERT INTO prazos_cliente (cliente_id, prioridade, resposta_min, solucao_min) VALUES (?, ?, ?, ?)", [cliente.id, p, v.resposta, v.solucao]);
    }
    const n = await recalcularAbertos(cliente.id);
    await registrar(req, "prazos_cliente_alterados", { cliente_id: cliente.id, prazos: definidos });
    return `Prazos do cliente salvos. ${n} chamado(s) aberto(s) recalculado(s).`;
  }, "");
});

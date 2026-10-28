-- Fase 2: triagem automática com o modelo local.

-- Quem escreveu a mensagem: uma pessoa, o sistema (avisos automáticos) ou o assistente de triagem.
ALTER TABLE mensagens ADD COLUMN origem ENUM('pessoa', 'sistema', 'ia') NOT NULL DEFAULT 'pessoa' AFTER autor_id;
UPDATE mensagens SET origem = 'sistema' WHERE autor_id IS NULL;

-- Texto pesquisável do chamado (assunto + descrição + resumo da triagem) para achar chamados parecidos.
ALTER TABLE chamados ADD COLUMN texto_busca TEXT NULL;
UPDATE chamados c SET texto_busca = (SELECT m.texto FROM mensagens m WHERE m.chamado_id = c.id ORDER BY m.id LIMIT 1);
ALTER TABLE chamados ADD FULLTEXT INDEX ft_chamados_busca (titulo, texto_busca);

-- Uma triagem por chamado. A IA só sugere: nada aqui altera o chamado sem uma pessoa da OCP aceitar.
CREATE TABLE IF NOT EXISTS triagens (
  chamado_id INT UNSIGNED PRIMARY KEY,
  -- pendente: na fila do modelo · aguardando_cliente: perguntas feitas · concluida: ficha pronta ·
  -- falhou: modelo indisponível (o chamado seguiu sem ficha); cancelada: a equipe agiu antes
  estado ENUM('pendente', 'processando', 'aguardando_cliente', 'concluida', 'falhou', 'cancelada') NOT NULL DEFAULT 'pendente',
  rodada TINYINT UNSIGNED NOT NULL DEFAULT 0,   -- quantas vezes já perguntou ao cliente
  concluir BOOLEAN NOT NULL DEFAULT FALSE,      -- não perguntar mais: gerar a ficha com o que tem
  tentativas TINYINT UNSIGNED NOT NULL DEFAULT 0,
  proxima_tentativa_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  perguntado_em DATETIME NULL,
  concluida_em DATETIME NULL,
  ficha JSON NULL,
  sugestao_area_id INT UNSIGNED NULL,
  sugestao_responsavel_id INT UNSIGNED NULL,
  sugestao_prioridade ENUM('baixa', 'normal', 'alta', 'critica') NULL,
  sugestao_tipo ENUM('incidente', 'duvida', 'solicitacao', 'melhoria') NULL,
  sugestao_aplicada_em DATETIME NULL,
  modelo VARCHAR(120) NULL,
  duracao_ms INT UNSIGNED NULL,
  erro VARCHAR(1000) NULL,
  criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (chamado_id) REFERENCES chamados(id),
  FOREIGN KEY (sugestao_area_id) REFERENCES areas(id),
  FOREIGN KEY (sugestao_responsavel_id) REFERENCES usuarios(id),
  INDEX idx_triagens_fila (estado, proxima_tentativa_em)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- O que a IA deve levantar em cada tipo de chamado (editável no painel).
CREATE TABLE IF NOT EXISTS roteiros_triagem (
  tipo ENUM('incidente', 'duvida', 'solicitacao', 'melhoria') PRIMARY KEY,
  instrucoes TEXT NOT NULL,
  atualizado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  atualizado_por INT UNSIGNED NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO roteiros_triagem (tipo, instrucoes) VALUES
('incidente', 'Erro ou problema. Levantar: a mensagem de erro exata (texto ou print); o que a pessoa estava fazendo (rotina, tela, botão); os passos para repetir; desde quando acontece e se já funcionou antes; se acontece com outros usuários ou outras máquinas; o ambiente (produção ou homologação) e, no Protheus, a filial e a rotina; números envolvidos (nota, pedido, título). Se a operação está parada, registrar isso como alerta.'),
('duvida', 'Dúvida de uso. Levantar: o que a pessoa quer fazer (o objetivo, não só a tela); onde travou; em qual sistema e rotina; se é algo novo ou que já fazia antes de outro jeito.'),
('solicitacao', 'Pedido de serviço (acesso, cadastro, instalação, liberação, ajuste de configuração). Levantar: o que exatamente é pedido; para quem (nome e usuário/e-mail); em qual sistema/ambiente; até quando precisa; quem autoriza, se for acesso ou permissão.'),
('melhoria', 'Melhoria ou nova funcionalidade. Levantar: o objetivo de negócio; como é feito hoje; como deveria ficar; quem usa e com que frequência; um exemplo concreto (dados de entrada e resultado esperado); regras e exceções; se há prazo ou dependência. A ficha deve servir de base para uma especificação: incluir critérios de aceite nos próximos passos.');

-- Ajustes gerais (ex.: triagem automática ligada ou não).
CREATE TABLE IF NOT EXISTS configuracoes (
  chave VARCHAR(60) PRIMARY KEY,
  valor VARCHAR(500) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO configuracoes (chave, valor) VALUES ('triagem_ativa', '1');

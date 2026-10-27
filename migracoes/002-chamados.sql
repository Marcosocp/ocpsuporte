-- Chamados, conversa (pública ou interna) e anexos.

CREATE TABLE IF NOT EXISTS chamados (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  cliente_id INT UNSIGNED NOT NULL,
  solicitante_id INT UNSIGNED NOT NULL,
  aberto_por_id INT UNSIGNED NOT NULL, -- o próprio solicitante, ou alguém da OCP em nome dele
  departamento_id INT UNSIGNED NULL,
  sistema_id INT UNSIGNED NULL,
  titulo VARCHAR(200) NOT NULL,
  tipo ENUM('incidente', 'duvida', 'solicitacao', 'melhoria') NOT NULL,
  impacto ENUM('pessoa', 'setor', 'empresa') NOT NULL DEFAULT 'pessoa',
  prioridade ENUM('baixa', 'normal', 'alta', 'critica') NOT NULL DEFAULT 'normal',
  -- triagem: IA conversando com o cliente (Fase 2); novo: aguardando distribuição
  status ENUM('triagem', 'novo', 'atribuido', 'em_atendimento', 'aguardando_cliente', 'resolvido', 'fechado', 'cancelado')
    NOT NULL DEFAULT 'novo',
  canal ENUM('portal', 'painel', 'email', 'whatsapp') NOT NULL DEFAULT 'portal',
  area_id INT UNSIGNED NULL,
  responsavel_id INT UNSIGNED NULL,
  criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  primeira_resposta_em DATETIME NULL,
  resolvido_em DATETIME NULL,
  fechado_em DATETIME NULL,
  FOREIGN KEY (cliente_id) REFERENCES clientes(id),
  FOREIGN KEY (solicitante_id) REFERENCES usuarios(id),
  FOREIGN KEY (aberto_por_id) REFERENCES usuarios(id),
  FOREIGN KEY (departamento_id) REFERENCES departamentos(id),
  FOREIGN KEY (sistema_id) REFERENCES sistemas(id),
  FOREIGN KEY (area_id) REFERENCES areas(id),
  FOREIGN KEY (responsavel_id) REFERENCES usuarios(id),
  INDEX idx_chamados_cliente (cliente_id, status),
  INDEX idx_chamados_solicitante (solicitante_id),
  INDEX idx_chamados_responsavel (responsavel_id, status),
  INDEX idx_chamados_status (status, atualizado_em)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- A primeira mensagem pública é a descrição do chamado. Interna = só a OCP vê.
-- autor_id NULL = mensagem do sistema (ex.: fechamento automático).
CREATE TABLE IF NOT EXISTS mensagens (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  chamado_id INT UNSIGNED NOT NULL,
  autor_id INT UNSIGNED NULL,
  visibilidade ENUM('publica', 'interna') NOT NULL DEFAULT 'publica',
  texto TEXT NOT NULL,
  criado_em DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  FOREIGN KEY (chamado_id) REFERENCES chamados(id),
  FOREIGN KEY (autor_id) REFERENCES usuarios(id),
  INDEX idx_mensagens_chamado (chamado_id, criado_em)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Arquivos fora da pasta pública, com nome gerado por nós; a visibilidade é a da mensagem.
CREATE TABLE IF NOT EXISTS anexos (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  chamado_id INT UNSIGNED NOT NULL,
  mensagem_id INT UNSIGNED NOT NULL,
  nome VARCHAR(200) NOT NULL,
  arquivo VARCHAR(64) NOT NULL,
  tipo VARCHAR(100) NOT NULL,
  tamanho INT UNSIGNED NOT NULL,
  enviado_por INT UNSIGNED NOT NULL,
  criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (chamado_id) REFERENCES chamados(id),
  FOREIGN KEY (mensagem_id) REFERENCES mensagens(id),
  FOREIGN KEY (enviado_por) REFERENCES usuarios(id),
  INDEX idx_anexos_mensagem (mensagem_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Link de cadastro por cliente: quem tem o link pede acesso; a conta só existe depois da aprovação do administrador.
-- O token fica guardado em claro para o administrador copiar o link de novo: sozinho ele só permite PEDIR acesso.
CREATE TABLE IF NOT EXISTS links_cadastro (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  cliente_id INT UNSIGNED NOT NULL,
  token CHAR(43) NOT NULL UNIQUE,
  expira_em DATETIME NULL,
  revogado_em DATETIME NULL,
  criado_por INT UNSIGNED NOT NULL,
  criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (cliente_id) REFERENCES clientes(id),
  FOREIGN KEY (criado_por) REFERENCES usuarios(id),
  INDEX idx_links_cadastro_cliente (cliente_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS solicitacoes_cadastro (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  cliente_id INT UNSIGNED NOT NULL,
  link_id INT UNSIGNED NOT NULL,
  nome VARCHAR(150) NOT NULL,
  email VARCHAR(190) NOT NULL,
  celular VARCHAR(15) NULL,
  cargo VARCHAR(150) NULL,
  departamento_ids VARCHAR(255) NULL,
  status ENUM('pendente', 'aprovada', 'recusada') NOT NULL DEFAULT 'pendente',
  ip VARCHAR(45) NULL,
  criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  decidido_em DATETIME NULL,
  decidido_por INT UNSIGNED NULL,
  usuario_id INT UNSIGNED NULL,
  FOREIGN KEY (cliente_id) REFERENCES clientes(id),
  FOREIGN KEY (link_id) REFERENCES links_cadastro(id),
  FOREIGN KEY (decidido_por) REFERENCES usuarios(id),
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id),
  INDEX idx_solicitacoes_status (status, cliente_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

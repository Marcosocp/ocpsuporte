-- Clientes, contratos, departamentos, áreas da OCP, usuários (dos dois lados) e acesso.

CREATE TABLE IF NOT EXISTS clientes (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  nome VARCHAR(150) NOT NULL,
  cnpj CHAR(14) NULL UNIQUE,
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  observacoes TEXT NULL, -- internas: o cliente nunca vê
  criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Pacote mensal de horas. As horas não usadas zeram a cada mês; o cliente não vê nada daqui.
CREATE TABLE IF NOT EXISTS contratos (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  cliente_id INT UNSIGNED NOT NULL,
  horas_mes DECIMAL(6,1) NOT NULL,
  valor_hora_excedente DECIMAL(10,2) NULL,
  inicio DATE NOT NULL,
  fim DATE NULL,
  observacoes TEXT NULL,
  criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (cliente_id) REFERENCES clientes(id),
  INDEX idx_contratos_cliente (cliente_id, inicio)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Departamentos do cliente (Financeiro, Logística, Estoque...).
CREATE TABLE IF NOT EXISTS departamentos (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  cliente_id INT UNSIGNED NOT NULL,
  nome VARCHAR(100) NOT NULL,
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  FOREIGN KEY (cliente_id) REFERENCES clientes(id),
  UNIQUE KEY uq_departamento (cliente_id, nome)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Áreas de atendimento da OCP (Protheus, Portais/Desenvolvimento, Infraestrutura...).
CREATE TABLE IF NOT EXISTS areas (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  nome VARCHAR(100) NOT NULL UNIQUE,
  descricao VARCHAR(255) NULL,
  ativo BOOLEAN NOT NULL DEFAULT TRUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Usuários da OCP (cliente_id NULL: admin/analista) e dos clientes (gestor/usuario).
-- senha_hash NULL = convite ainda não aceito.
CREATE TABLE IF NOT EXISTS usuarios (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  cliente_id INT UNSIGNED NULL,
  papel ENUM('admin', 'analista', 'gestor', 'usuario') NOT NULL,
  nome VARCHAR(150) NOT NULL,
  email VARCHAR(190) NOT NULL UNIQUE,
  celular VARCHAR(15) NULL,
  senha_hash VARCHAR(255) NULL,
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  ultimo_login DATETIME NULL,
  criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (cliente_id) REFERENCES clientes(id),
  INDEX idx_usuarios_cliente (cliente_id),
  CONSTRAINT ck_usuario_lado CHECK (
    (cliente_id IS NULL AND papel IN ('admin', 'analista')) OR
    (cliente_id IS NOT NULL AND papel IN ('gestor', 'usuario'))
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS usuario_departamentos (
  usuario_id INT UNSIGNED NOT NULL,
  departamento_id INT UNSIGNED NOT NULL,
  PRIMARY KEY (usuario_id, departamento_id),
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id),
  FOREIGN KEY (departamento_id) REFERENCES departamentos(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS analista_areas (
  usuario_id INT UNSIGNED NOT NULL,
  area_id INT UNSIGNED NOT NULL,
  PRIMARY KEY (usuario_id, area_id),
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id),
  FOREIGN KEY (area_id) REFERENCES areas(id)
) ENGINE=InnoDB;

-- Sistemas e ambientes do cliente: o "mapa" que a IA consulta. NUNCA guarda senha.
CREATE TABLE IF NOT EXISTS sistemas (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  cliente_id INT UNSIGNED NOT NULL,
  nome VARCHAR(100) NOT NULL,
  categoria ENUM('erp', 'portal', 'infraestrutura', 'outro') NOT NULL DEFAULT 'outro',
  acesso VARCHAR(500) NULL,     -- "Workspace", https://portal..., VPN...
  ambientes VARCHAR(255) NULL,  -- "produção, homologação"
  observacoes TEXT NULL,        -- módulos usados, versão, particularidades
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  FOREIGN KEY (cliente_id) REFERENCES clientes(id),
  UNIQUE KEY uq_sistema (cliente_id, nome)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sistema_departamentos (
  sistema_id INT UNSIGNED NOT NULL,
  departamento_id INT UNSIGNED NOT NULL,
  PRIMARY KEY (sistema_id, departamento_id),
  FOREIGN KEY (sistema_id) REFERENCES sistemas(id),
  FOREIGN KEY (departamento_id) REFERENCES departamentos(id)
) ENGINE=InnoDB;

-- Links de convite (definir a primeira senha) e de redefinição de senha. Só o hash fica gravado.
CREATE TABLE IF NOT EXISTS links_conta (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  usuario_id INT UNSIGNED NOT NULL,
  tipo ENUM('convite', 'senha') NOT NULL,
  token_hash CHAR(64) NOT NULL,
  expira_em DATETIME NOT NULL,
  usado_em DATETIME NULL,
  criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id),
  INDEX idx_links_usuario (usuario_id)
) ENGINE=InnoDB;

-- Verificação em duas etapas: código de 6 dígitos por e-mail (só o HMAC fica gravado).
CREATE TABLE IF NOT EXISTS codigos_login (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  usuario_id INT UNSIGNED NOT NULL,
  codigo_hash CHAR(64) NOT NULL,
  expira_em DATETIME NOT NULL,
  tentativas TINYINT UNSIGNED NOT NULL DEFAULT 0,
  usado_em DATETIME NULL,
  criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id),
  INDEX idx_codigos_usuario (usuario_id, criado_em)
) ENGINE=InnoDB;

-- "Confiar neste navegador por 30 dias": dispensa o código. Só o hash do cookie fica gravado.
CREATE TABLE IF NOT EXISTS navegadores_confiaveis (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  usuario_id INT UNSIGNED NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  user_agent VARCHAR(500) NULL,
  expira_em DATETIME NOT NULL,
  criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
) ENGINE=InnoDB;

-- Trilha de auditoria: só recebe INSERT pelo código (nunca UPDATE/DELETE).
CREATE TABLE IF NOT EXISTS auditoria (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  usuario_id INT UNSIGNED NULL,
  chamado_id INT UNSIGNED NULL,
  acao VARCHAR(80) NOT NULL,
  ip VARCHAR(45) NULL,
  user_agent VARCHAR(500) NULL,
  detalhes JSON NULL,
  criado_em DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_auditoria_usuario (usuario_id),
  INDEX idx_auditoria_chamado (chamado_id),
  INDEX idx_auditoria_acao (acao)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

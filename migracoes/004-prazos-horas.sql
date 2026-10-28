-- Fase 3: prazos de atendimento (SLA em horário útil) e horas trabalhadas por contrato.

-- Prazos em MINUTOS ÚTEIS (seg–sex, 08h–18h, sem feriados). "1 dia" = 600 minutos úteis.
CREATE TABLE IF NOT EXISTS prazos_padrao (
  prioridade ENUM('baixa', 'normal', 'alta', 'critica') PRIMARY KEY,
  resposta_min INT UNSIGNED NOT NULL,
  solucao_min INT UNSIGNED NOT NULL
) ENGINE=InnoDB;

INSERT IGNORE INTO prazos_padrao (prioridade, resposta_min, solucao_min) VALUES
('critica', 60, 240), ('alta', 240, 600), ('normal', 600, 1800), ('baixa', 1200, 3000);

-- Prazos combinados com um cliente específico (substituem o padrão para aquela prioridade).
CREATE TABLE IF NOT EXISTS prazos_cliente (
  cliente_id INT UNSIGNED NOT NULL,
  prioridade ENUM('baixa', 'normal', 'alta', 'critica') NOT NULL,
  resposta_min INT UNSIGNED NOT NULL,
  solucao_min INT UNSIGNED NOT NULL,
  PRIMARY KEY (cliente_id, prioridade),
  FOREIGN KEY (cliente_id) REFERENCES clientes(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS feriados (
  data DATE PRIMARY KEY,
  nome VARCHAR(100) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO feriados (data, nome) VALUES
('2026-01-01', 'Confraternização Universal'), ('2026-02-16', 'Carnaval (segunda)'), ('2026-02-17', 'Carnaval (terça)'),
('2026-04-03', 'Sexta-feira Santa'), ('2026-04-21', 'Tiradentes'), ('2026-05-01', 'Dia do Trabalho'),
('2026-06-04', 'Corpus Christi'), ('2026-09-07', 'Independência'), ('2026-10-12', 'Nossa Senhora Aparecida'),
('2026-11-02', 'Finados'), ('2026-11-15', 'Proclamação da República'), ('2026-11-20', 'Dia da Consciência Negra'),
('2026-12-25', 'Natal'),
('2027-01-01', 'Confraternização Universal'), ('2027-02-08', 'Carnaval (segunda)'), ('2027-02-09', 'Carnaval (terça)'),
('2027-03-26', 'Sexta-feira Santa'), ('2027-04-21', 'Tiradentes'), ('2027-05-01', 'Dia do Trabalho'),
('2027-05-27', 'Corpus Christi'), ('2027-09-07', 'Independência'), ('2027-10-12', 'Nossa Senhora Aparecida'),
('2027-11-02', 'Finados'), ('2027-11-15', 'Proclamação da República'), ('2027-11-20', 'Dia da Consciência Negra'),
('2027-12-25', 'Natal'),
('2028-01-01', 'Confraternização Universal'), ('2028-02-28', 'Carnaval (segunda)'), ('2028-02-29', 'Carnaval (terça)'),
('2028-04-14', 'Sexta-feira Santa'), ('2028-04-21', 'Tiradentes'), ('2028-05-01', 'Dia do Trabalho'),
('2028-06-15', 'Corpus Christi'), ('2028-09-07', 'Independência'), ('2028-10-12', 'Nossa Senhora Aparecida'),
('2028-11-02', 'Finados'), ('2028-11-15', 'Proclamação da República'), ('2028-11-20', 'Dia da Consciência Negra'),
('2028-12-25', 'Natal');

-- O prazo começa quando o chamado chega à equipe (depois da triagem) e para enquanto se espera o cliente.
ALTER TABLE chamados
  ADD COLUMN sla_inicio_em DATETIME NULL,
  ADD COLUMN prazo_resposta_em DATETIME NULL,
  ADD COLUMN prazo_solucao_em DATETIME NULL,
  ADD COLUMN sla_aviso_resposta_em DATETIME NULL,
  ADD COLUMN sla_aviso_solucao_em DATETIME NULL,
  ADD COLUMN sla_estouro_resposta_em DATETIME NULL,
  ADD COLUMN sla_estouro_solucao_em DATETIME NULL;

UPDATE chamados SET sla_inicio_em = criado_em WHERE status <> 'triagem';

-- Períodos em que o prazo de solução fica parado (aguardando cliente, resolvido aguardando confirmação).
CREATE TABLE IF NOT EXISTS chamado_pausas (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  chamado_id INT UNSIGNED NOT NULL,
  inicio DATETIME NOT NULL,
  fim DATETIME NULL,
  FOREIGN KEY (chamado_id) REFERENCES chamados(id),
  INDEX idx_pausas_chamado (chamado_id)
) ENGINE=InnoDB;

-- Horas trabalhadas. O cliente nunca vê. "faturavel" = conta no pacote do contrato.
CREATE TABLE IF NOT EXISTS apontamentos (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  chamado_id INT UNSIGNED NOT NULL,
  usuario_id INT UNSIGNED NOT NULL,
  data DATE NOT NULL,
  minutos SMALLINT UNSIGNED NOT NULL,
  descricao VARCHAR(500) NOT NULL,
  faturavel BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (chamado_id) REFERENCES chamados(id),
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id),
  INDEX idx_apontamentos_chamado (chamado_id),
  INDEX idx_apontamentos_data (data)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Avisos de consumo do pacote já enviados (80% e 100%), um por cliente/mês/nível.
CREATE TABLE IF NOT EXISTS alertas_horas (
  cliente_id INT UNSIGNED NOT NULL,
  mes CHAR(7) NOT NULL,
  nivel TINYINT UNSIGNED NOT NULL,
  criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (cliente_id, mes, nivel),
  FOREIGN KEY (cliente_id) REFERENCES clientes(id)
) ENGINE=InnoDB;

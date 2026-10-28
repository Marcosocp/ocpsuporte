-- Escopo de cada analista: quais clientes atende (todos ou uma lista) e quais áreas (todas ou uma lista).
-- Ex.: analista alocado num cliente = só aquele cliente, todas as áreas.
-- Os analistas que já existem continuam como estavam: todos os clientes, só as áreas marcadas.
ALTER TABLE usuarios
  ADD COLUMN todos_clientes BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN todas_areas BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS analista_clientes (
  usuario_id INT UNSIGNED NOT NULL,
  cliente_id INT UNSIGNED NOT NULL,
  PRIMARY KEY (usuario_id, cliente_id),
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id),
  FOREIGN KEY (cliente_id) REFERENCES clientes(id)
) ENGINE=InnoDB;

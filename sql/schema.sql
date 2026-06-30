-- ==========================================================================
-- SCHEMA PostgreSQL — Dashboard de Estoque Operacional
-- Banco: sistema_db
-- Schema: estoque
-- ==========================================================================

CREATE SCHEMA IF NOT EXISTS estoque;
SET search_path TO estoque;

-- --------------------------------------------------------------------------
-- Extensões
-- --------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- --------------------------------------------------------------------------
-- Clientes
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clientes (
  id          VARCHAR(20)  PRIMARY KEY,
  nome        VARCHAR(200) NOT NULL,
  documento   VARCHAR(20),
  ativo       BOOLEAN      NOT NULL DEFAULT TRUE,
  criado_em   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  clientes      IS 'Cadastro de clientes vinculados às ordens de serviço';
COMMENT ON COLUMN clientes.id   IS 'Identificador textual do cliente (ex: CLI-01)';

-- --------------------------------------------------------------------------
-- Técnicos
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tecnicos (
  id          VARCHAR(20)  PRIMARY KEY,
  nome        VARCHAR(120) NOT NULL,
  matricula   VARCHAR(30),
  ativo       BOOLEAN      NOT NULL DEFAULT TRUE,
  criado_em   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE tecnicos IS 'Técnicos de campo responsáveis pelas OS';

-- --------------------------------------------------------------------------
-- Ordens de Serviço (OS)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ordens_servico (
  id          VARCHAR(30)  PRIMARY KEY,
  assunto     VARCHAR(300) NOT NULL,
  cliente_id  VARCHAR(20)  NOT NULL REFERENCES clientes(id) ON DELETE RESTRICT,
  status      VARCHAR(30)  NOT NULL DEFAULT 'aberta'
                           CHECK (status IN ('aberta','em_andamento','concluida','cancelada')),
  abertura    DATE,
  fechamento  DATE,
  criado_em   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_os_cliente ON ordens_servico(cliente_id);
CREATE INDEX IF NOT EXISTS idx_os_status  ON ordens_servico(status);

COMMENT ON TABLE ordens_servico IS 'Ordens de serviço — vinculam produtos, técnicos e clientes';

-- --------------------------------------------------------------------------
-- Produtos
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS produtos (
  id             VARCHAR(20)    PRIMARY KEY,
  descricao      VARCHAR(300)   NOT NULL,
  unidade        VARCHAR(10)    NOT NULL DEFAULT 'un',
  consumo_medio  NUMERIC(10,2)  NOT NULL DEFAULT 0
                                CHECK (consumo_medio >= 0),
  ativo          BOOLEAN        NOT NULL DEFAULT TRUE,
  criado_em      TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  atualizado_em  TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  produtos              IS 'Catálogo de materiais/produtos rastreados no estoque';
COMMENT ON COLUMN produtos.consumo_medio IS 'Média histórica de consumo por OS (calculada pelo ETL)';

-- --------------------------------------------------------------------------
-- Estoque (snapshot por produto)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS estoque (
  id              SERIAL          PRIMARY KEY,
  produto_id      VARCHAR(20)     NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
  quantidade      INTEGER         NOT NULL DEFAULT 0 CHECK (quantidade >= 0),
  mes_referencia  VARCHAR(10)     NOT NULL,  -- ex: 'Abr/2026'
  snapshot_em     TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

  UNIQUE (produto_id, mes_referencia)
);

CREATE INDEX IF NOT EXISTS idx_estoque_produto ON estoque(produto_id);
CREATE INDEX IF NOT EXISTS idx_estoque_mes     ON estoque(mes_referencia);

COMMENT ON TABLE  estoque              IS 'Snapshots mensais de quantidade em estoque por produto';
COMMENT ON COLUMN estoque.mes_referencia IS 'Formato: Mmm/AAAA  ex: Abr/2026';

-- --------------------------------------------------------------------------
-- Movimentações (saídas vinculadas a OS + técnico)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS movimentacoes (
  id               SERIAL          PRIMARY KEY,
  produto_id       VARCHAR(20)     NOT NULL REFERENCES produtos(id)       ON DELETE RESTRICT,
  os_id            VARCHAR(30)     REFERENCES ordens_servico(id)          ON DELETE RESTRICT,
  tecnico_id       VARCHAR(20)     REFERENCES tecnicos(id)                ON DELETE RESTRICT,
  quantidade_saida INTEGER         NOT NULL CHECK (quantidade_saida > 0),
  mes_referencia   VARCHAR(10)     NOT NULL,
  tipo_movimentacao VARCHAR(20)    NOT NULL DEFAULT 'equipamento'
                                   CHECK (tipo_movimentacao IN ('equipamento','material')),
  status_comodato  VARCHAR(20),
  id_almox_origem  INTEGER,
  id_almox_destino INTEGER,
  registrado_em    TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  origem_etl       VARCHAR(60),

  UNIQUE (produto_id, os_id, mes_referencia, tipo_movimentacao)
);

CREATE INDEX IF NOT EXISTS idx_mov_produto ON movimentacoes(produto_id);
CREATE INDEX IF NOT EXISTS idx_mov_os      ON movimentacoes(os_id);
CREATE INDEX IF NOT EXISTS idx_mov_tecnico ON movimentacoes(tecnico_id);
CREATE INDEX IF NOT EXISTS idx_mov_mes     ON movimentacoes(mes_referencia);

COMMENT ON TABLE  movimentacoes             IS 'Saídas de material por OS e técnico';
COMMENT ON COLUMN movimentacoes.origem_etl  IS 'Identificador do processo ETL que originou o registro';

-- --------------------------------------------------------------------------
-- View consolidada (usada pelas queries das rotas)
-- --------------------------------------------------------------------------
CREATE OR REPLACE VIEW vw_movimentacoes_completa AS
SELECT
  p.id                  AS id_produto,
  p.descricao           AS descricao,
  e.quantidade          AS qtd_estoque,
  m.quantidade_saida    AS qtd_saida,
  p.consumo_medio       AS consumo_medio,
  t.id                  AS tecnico_id,
  t.nome                AS tecnico_nome,
  os.id                 AS os_id,
  os.assunto            AS os_assunto,
  cl.id                 AS cliente_id,
  cl.nome               AS cliente_nome,
  m.mes_referencia      AS mes_referencia,
  CASE
    WHEN m.quantidade_saida > e.quantidade             THEN 'divergencia'
    WHEN m.quantidade_saida > p.consumo_medio * 1.5   THEN 'alerta'
    ELSE 'ok'
  END                   AS status,
  (m.quantidade_saida - p.consumo_medio) AS diferenca
FROM movimentacoes m
JOIN produtos        p  ON p.id  = m.produto_id
JOIN estoque         e  ON e.produto_id = m.produto_id
                       AND e.mes_referencia = m.mes_referencia
JOIN ordens_servico  os ON os.id = m.os_id
JOIN tecnicos        t  ON t.id  = m.tecnico_id
JOIN clientes        cl ON cl.id = os.cliente_id;

COMMENT ON VIEW vw_movimentacoes_completa IS 'View consolidada para o dashboard — combina movimentação, estoque e OS';

-- --------------------------------------------------------------------------
-- Função auxiliar: atualizar timestamp atualizado_em automaticamente
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_set_atualizado_em()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.atualizado_em = NOW();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_clientes_atualizado_em
  BEFORE UPDATE ON clientes
  FOR EACH ROW EXECUTE FUNCTION fn_set_atualizado_em();

CREATE OR REPLACE TRIGGER trg_produtos_atualizado_em
  BEFORE UPDATE ON produtos
  FOR EACH ROW EXECUTE FUNCTION fn_set_atualizado_em();

CREATE OR REPLACE TRIGGER trg_os_atualizado_em
  BEFORE UPDATE ON ordens_servico
  FOR EACH ROW EXECUTE FUNCTION fn_set_atualizado_em();

-- --------------------------------------------------------------------------
-- Movimentações sem OS (transferências diretas entre almoxarifados)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS movimentacoes_transf (
  id               SERIAL          PRIMARY KEY,
  produto_id       VARCHAR(20)     NOT NULL REFERENCES produtos(id) ON DELETE RESTRICT,
  tecnico_id       VARCHAR(20),
  quantidade_saida INTEGER         NOT NULL CHECK (quantidade_saida > 0),
  mes_referencia   VARCHAR(10)     NOT NULL,
  id_almox_origem  INTEGER,
  id_almox_destino INTEGER,
  status_comodato  VARCHAR(20),
  origem_etl       VARCHAR(60),
  registrado_em    TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_movt_produto ON movimentacoes_transf(produto_id);
CREATE INDEX IF NOT EXISTS idx_movt_mes     ON movimentacoes_transf(mes_referencia);

-- --------------------------------------------------------------------------
-- Log de execuções do ETL
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS etl_log (
  id                    SERIAL       PRIMARY KEY,
  iniciado_em           TIMESTAMPTZ  NOT NULL,
  concluido_em          TIMESTAMPTZ,
  status                VARCHAR(20)  NOT NULL DEFAULT 'executando',
  registros_processados INTEGER      DEFAULT 0,
  erro                  TEXT
);

-- Dados populados via ETL.

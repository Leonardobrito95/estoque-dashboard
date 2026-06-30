/* ==========================================================================
   ROUTES — /api/estoque  (preparado para ETL / Power BI)
   ========================================================================== */
const express = require('express');
const { query } = require('../db/connection');

const router = express.Router();

/* Converte 'Abr/2026' em valor numérico ordenável (ex: 202604) */
const MES_SORT = `(
  SPLIT_PART(m.mes_referencia,'/',2)::int * 100 +
  CASE SPLIT_PART(m.mes_referencia,'/',1)
    WHEN 'Jan' THEN 1  WHEN 'Fev' THEN 2  WHEN 'Mar' THEN 3
    WHEN 'Abr' THEN 4  WHEN 'Mai' THEN 5  WHEN 'Jun' THEN 6
    WHEN 'Jul' THEN 7  WHEN 'Ago' THEN 8  WHEN 'Set' THEN 9
    WHEN 'Out' THEN 10 WHEN 'Nov' THEN 11 WHEN 'Dez' THEN 12
    ELSE 0
  END
)`;

/* --------------------------------------------------------------------------
   Middleware: log de requisições
   -------------------------------------------------------------------------- */
router.use((req, _res, next) => {
  console.log(`[API] ${req.method} ${req.originalUrl}`);
  next();
});

/* --------------------------------------------------------------------------
   GET /api/estoque/movimentacoes
   Filtros opcionais via query string: mes, tecnico_id, cliente_id
   -------------------------------------------------------------------------- */
router.get('/movimentacoes', async (req, res) => {
  const { mes, tecnico_id, cliente_id, tipo } = req.query;

  const conditions = [];
  const params     = [];

  if (mes) {
    params.push(mes);
    conditions.push(`m.mes_referencia = $${params.length}`);
  }
  if (tecnico_id) {
    params.push(tecnico_id);
    conditions.push(`t.id = $${params.length}`);
  }
  if (cliente_id) {
    params.push(cliente_id);
    conditions.push(`cl.id = $${params.length}`);
  }
  /* tipo=equipamento | tipo=material | omitido=todos */
  if (tipo && ['equipamento', 'material'].includes(tipo)) {
    params.push(tipo);
    conditions.push(`m.tipo_movimentacao = $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const sql = `
    SELECT
      p.id                                        AS id_produto,
      p.descricao                                 AS descricao,
      COALESCE(e.quantidade, 0)                   AS qtd_estoque,
      m.quantidade_saida                          AS qtd_saida,
      p.consumo_medio                             AS consumo_medio,
      COALESCE(t.id::text, '')                    AS tecnico_id,
      COALESCE(t.nome, 'Não informado')           AS tecnico_nome,
      COALESCE(os.id, '')                         AS os_id,
      COALESCE(os.assunto, '')                    AS os_assunto,
      COALESCE(cl.id, '0')                        AS cliente_id,
      COALESCE(cl.nome, 'Não informado / Interno') AS cliente_nome,
      m.mes_referencia                            AS mes_referencia,
      m.tipo_movimentacao                         AS tipo_movimentacao,
      CASE
        WHEN m.quantidade_saida > COALESCE(e.quantidade, 0)           THEN 'divergencia'
        WHEN p.consumo_medio > 0
         AND m.quantidade_saida > p.consumo_medio * 1.5              THEN 'alerta'
        ELSE 'ok'
      END                                         AS status
    FROM (
      SELECT produto_id, os_id, tecnico_id,
             SUM(quantidade_saida) AS quantidade_saida,
             mes_referencia, tipo_movimentacao
      FROM movimentacoes
      GROUP BY produto_id, os_id, tecnico_id, mes_referencia, tipo_movimentacao
      UNION ALL
      SELECT produto_id, NULL AS os_id, tecnico_id,
             SUM(quantidade_saida) AS quantidade_saida,
             mes_referencia, 'material' AS tipo_movimentacao
      FROM movimentacoes_transf
      WHERE mes_referencia IS NOT NULL AND mes_referencia != ''
      GROUP BY produto_id, tecnico_id, mes_referencia
    ) m
    JOIN  produtos       p  ON p.id = m.produto_id
    LEFT JOIN (
      SELECT DISTINCT ON (produto_id) produto_id, quantidade
      FROM estoque
      ORDER BY produto_id, mes_referencia DESC
    )                    e  ON e.produto_id = m.produto_id
    LEFT JOIN ordens_servico os ON os.id = m.os_id
    LEFT JOIN tecnicos       t  ON t.id = m.tecnico_id
    LEFT JOIN clientes       cl ON cl.id = os.cliente_id
    ${where}
    ORDER BY ${MES_SORT} DESC, p.descricao ASC
  `;

  try {
    const rows = await query(sql, params);
    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    console.error('[ROUTE] movimentacoes:', err.message);
    res.status(500).json({ success: false, error: 'Erro ao consultar movimentações.' });
  }
});

/* --------------------------------------------------------------------------
   GET /api/estoque/kpis
   Retorna totalizadores para os KPI Cards
   -------------------------------------------------------------------------- */
router.get('/kpis', async (req, res) => {
  const { mes } = req.query;
  const params  = [];
  const whereM  = mes ? `WHERE m.mes_referencia = $1` : '';
  if (mes) params.push(mes);

  const sql = `
    SELECT
      SUM(COALESCE(e.quantidade, 0))                             AS total_estoque,
      SUM(m.quantidade_saida)                                    AS total_saida,
      ROUND(AVG(p.consumo_medio)::numeric, 2)                    AS consumo_medio,
      COUNT(*) FILTER (
        WHERE m.quantidade_saida > COALESCE(e.quantidade, 0)
      )                                                          AS divergencias
    FROM (
      SELECT produto_id, SUM(quantidade_saida) AS quantidade_saida, mes_referencia
      FROM movimentacoes
      GROUP BY produto_id, mes_referencia
      UNION ALL
      SELECT produto_id, SUM(quantidade_saida) AS quantidade_saida, mes_referencia
      FROM movimentacoes_transf
      WHERE mes_referencia IS NOT NULL AND mes_referencia != ''
      GROUP BY produto_id, mes_referencia
    ) m
    JOIN produtos p ON p.id = m.produto_id
    LEFT JOIN (
      SELECT DISTINCT ON (produto_id) produto_id, quantidade
      FROM estoque
      ORDER BY produto_id, mes_referencia DESC
    ) e ON e.produto_id = m.produto_id
    ${whereM}
  `;

  try {
    const rows = await query(sql, params);
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    console.error('[ROUTE] kpis:', err.message);
    res.status(500).json({ success: false, error: 'Erro ao calcular KPIs.' });
  }
});

/* --------------------------------------------------------------------------
   GET /api/estoque/consumo-tecnico
   Dados para o gráfico de barras
   -------------------------------------------------------------------------- */
router.get('/consumo-tecnico', async (req, res) => {
  const { mes } = req.query;
  const params  = [];
  const where   = mes ? `WHERE m.mes_referencia = $1` : '';
  if (mes) params.push(mes);

  const sql = `
    SELECT
      COALESCE(t.nome, 'Não informado') AS nome,
      SUM(m.quantidade_saida)           AS consumo
    FROM (
      SELECT tecnico_id, SUM(quantidade_saida) AS quantidade_saida, mes_referencia
      FROM movimentacoes
      GROUP BY tecnico_id, mes_referencia
      UNION ALL
      SELECT tecnico_id, SUM(quantidade_saida) AS quantidade_saida, mes_referencia
      FROM movimentacoes_transf
      WHERE mes_referencia IS NOT NULL AND mes_referencia != ''
      GROUP BY tecnico_id, mes_referencia
    ) m
    LEFT JOIN tecnicos t ON t.id = m.tecnico_id
    ${where}
    GROUP BY t.id, t.nome
    ORDER BY consumo DESC
    LIMIT 10
  `;

  try {
    const rows = await query(sql, params);
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('[ROUTE] consumo-tecnico:', err.message);
    res.status(500).json({ success: false, error: 'Erro ao calcular consumo por técnico.' });
  }
});

/* --------------------------------------------------------------------------
   GET /api/estoque/evolucao
   Dados para o gráfico de linha (últimos 6 meses)
   -------------------------------------------------------------------------- */
router.get('/evolucao', async (_req, res) => {
  const MES_SORT_E = `(
    SPLIT_PART(mes_referencia,'/',2)::int * 100 +
    CASE SPLIT_PART(mes_referencia,'/',1)
      WHEN 'Jan' THEN 1  WHEN 'Fev' THEN 2  WHEN 'Mar' THEN 3
      WHEN 'Abr' THEN 4  WHEN 'Mai' THEN 5  WHEN 'Jun' THEN 6
      WHEN 'Jul' THEN 7  WHEN 'Ago' THEN 8  WHEN 'Set' THEN 9
      WHEN 'Out' THEN 10 WHEN 'Nov' THEN 11 WHEN 'Dez' THEN 12
      ELSE 0
    END
  )`;
  const sql = `
    SELECT
      mes_referencia             AS mes,
      SUM(e.quantidade)          AS valor
    FROM estoque e
    WHERE mes_referencia IS NOT NULL AND mes_referencia != ''
    GROUP BY mes_referencia
    ORDER BY ${MES_SORT_E} DESC
    LIMIT 6
  `;

  try {
    const rows = await query(sql);
    res.json({ success: true, data: rows.reverse() });
  } catch (err) {
    console.error('[ROUTE] evolucao:', err.message);
    res.status(500).json({ success: false, error: 'Erro ao calcular evolução do estoque.' });
  }
});

/* --------------------------------------------------------------------------
   GET /api/estoque/divergencias
   Lista de itens com divergência para o painel lateral
   -------------------------------------------------------------------------- */
router.get('/divergencias', async (req, res) => {
  const { mes } = req.query;
  const params  = [];
  const where   = mes ? `WHERE m.mes_referencia = $1` : '';
  if (mes) params.push(mes);

  const sql = `
    SELECT
      p.id                                        AS id_produto,
      p.descricao                                 AS descricao,
      COALESCE(t.nome, 'Não informado')           AS tecnico_nome,
      COALESCE(os.id, '')                         AS os_id,
      COALESCE(e.quantidade, 0)                   AS qtd_estoque,
      m.quantidade_saida                          AS qtd_saida,
      p.consumo_medio                             AS consumo_medio,
      (m.quantidade_saida - p.consumo_medio)      AS diferenca,
      CASE
        WHEN m.quantidade_saida > COALESCE(e.quantidade, 0)         THEN 'divergencia'
        WHEN p.consumo_medio > 0
         AND m.quantidade_saida > p.consumo_medio * 1.5            THEN 'alerta'
      END AS status
    FROM (
      SELECT produto_id, os_id, tecnico_id,
             SUM(quantidade_saida) AS quantidade_saida,
             mes_referencia, tipo_movimentacao
      FROM movimentacoes
      GROUP BY produto_id, os_id, tecnico_id, mes_referencia, tipo_movimentacao
      UNION ALL
      SELECT produto_id, NULL AS os_id, tecnico_id,
             SUM(quantidade_saida) AS quantidade_saida,
             mes_referencia, 'material' AS tipo_movimentacao
      FROM movimentacoes_transf
      WHERE mes_referencia IS NOT NULL AND mes_referencia != ''
      GROUP BY produto_id, tecnico_id, mes_referencia
    ) m
    JOIN  produtos       p  ON p.id = m.produto_id
    LEFT JOIN (
      SELECT DISTINCT ON (produto_id) produto_id, quantidade
      FROM estoque
      ORDER BY produto_id, mes_referencia DESC
    )                    e  ON e.produto_id = m.produto_id
    LEFT JOIN ordens_servico os ON os.id = m.os_id
    LEFT JOIN tecnicos       t  ON t.id = m.tecnico_id
    ${where}
    HAVING m.quantidade_saida > COALESCE(e.quantidade, 0)
        OR (p.consumo_medio > 0 AND m.quantidade_saida > p.consumo_medio * 1.5)
    ORDER BY ${MES_SORT} DESC, diferenca DESC
  `;

  try {
    const rows = await query(sql, params);
    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    console.error('[ROUTE] divergencias:', err.message);
    res.status(500).json({ success: false, error: 'Erro ao listar divergências.' });
  }
});

/* --------------------------------------------------------------------------
   GET /api/estoque/tecnicos — lista de técnicos para o filtro
   GET /api/estoque/clientes — lista de clientes para o filtro
   -------------------------------------------------------------------------- */
router.get('/tecnicos', async (_req, res) => {
  try {
    const rows = await query('SELECT id, nome FROM tecnicos ORDER BY nome');
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/clientes', async (_req, res) => {
  try {
    const rows = await query('SELECT id, nome FROM clientes ORDER BY nome');
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/* Debug: contagem por mes_referencia nas duas tabelas */
router.get('/debug/meses', async (_req, res) => {
  try {
    const [movs, transf] = await Promise.all([
      query(`SELECT mes_referencia, COUNT(*) AS total
             FROM movimentacoes
             GROUP BY mes_referencia
             ORDER BY mes_referencia`),
      query(`SELECT mes_referencia, COUNT(*) AS total
             FROM movimentacoes_transf
             GROUP BY mes_referencia
             ORDER BY mes_referencia`)
    ]);
    res.json({ movimentacoes: movs, movimentacoes_transf: transf });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

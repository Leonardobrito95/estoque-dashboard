/* ==========================================================================
   DB — Pool de conexão PostgreSQL (node-postgres)
   ========================================================================== */
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME     || 'estoque_db',
  user:     process.env.DB_USER     || 'estoque_user',
  password: process.env.DB_PASSWORD || '',
  max:                20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 4000,
});

pool.on('error', (err) => {
  console.error('[DB] Erro inesperado no cliente idle:', err.message);
});

pool.on('connect', (client) => {
  client.query('SET search_path TO estoque');
});

/**
 * Executa uma query com parâmetros e retorna as linhas.
 * @param {string} text - SQL parametrizado
 * @param {any[]}  params - Valores de binding
 */
async function query(text, params = []) {
  const client = await pool.connect();
  try {
    const result = await client.query(text, params);
    return result.rows;
  } finally {
    client.release();
  }
}

module.exports = { pool, query };

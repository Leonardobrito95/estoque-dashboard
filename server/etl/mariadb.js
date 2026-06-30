/* ==========================================================================
   ETL — Conexão com MariaDB do IXC Soft
   Host: 45.184.68.18:3306  |  Schema: ixcprovedor
   ========================================================================== */
'use strict';

require('dotenv').config();
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host:               process.env.IXC_DB_HOST     || '45.184.68.18',
  port:               parseInt(process.env.IXC_DB_PORT || '3306', 10),
  database:           process.env.IXC_DB_NAME     || 'ixcprovedor',
  user:               process.env.IXC_DB_USER     || '',
  password:           process.env.IXC_DB_PASSWORD || '',
  charset:            'utf8mb4',
  timezone:           '-03:00',          /* Horário de Brasília */
  waitForConnections: true,
  connectionLimit:    5,
  queueLimit:         0,
  connectTimeout:     15000,
  /* Leitura apenas — nunca escrevemos no IXC */
  multipleStatements: false,
});

/**
 * Executa uma query no IXC (MariaDB) e retorna as linhas.
 * @param {string}  sql
 * @param {any[]}   params
 */
async function ixcQuery(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

async function testConnection() {
  try {
    const [rows] = await pool.execute('SELECT 1 AS ok');
    return rows[0].ok === 1;
  } catch (err) {
    console.error('[IXC] Falha na conexão:', err.message);
    return false;
  }
}

module.exports = { ixcQuery, testConnection, pool };

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('./connection');

async function initDB() {
  try {
    const sqlPath = path.join(__dirname, '../../sql/schema.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    console.log('Lendo arquivo schema.sql...');
    
    await pool.query(sql);
    console.log('✅ Schema e tabelas criados com sucesso!');
    
  } catch (err) {
    console.error('❌ Erro ao criar tabelas:', err.message);
  } finally {
    await pool.end();
  }
}

initDB();

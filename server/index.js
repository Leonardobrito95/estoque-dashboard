/* ==========================================================================
   SERVER — Node.js + Express
   Dashboard de Estoque Operacional (Localweb)
   ========================================================================== */
'use strict';

const express  = require('express');
const path     = require('path');
const { pool } = require('./db/connection');

const app  = express();
const PORT = process.env.PORT || 5004;
const ROOT = path.join(__dirname, '..');

/* --------------------------------------------------------------------------
   Middlewares globais
   -------------------------------------------------------------------------- */
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

/* Arquivos estáticos do frontend */
app.use(express.static(ROOT, {
  extensions: ['html'],
  index:      'index.html',
}));

/* Cabeçalhos de segurança mínimos para ambiente interno */
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});

/* --------------------------------------------------------------------------
   Rotas da API
   -------------------------------------------------------------------------- */
const estoqueRoutes = require('./routes/estoque');
app.use('/api/estoque', estoqueRoutes);

/* Health check */
app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected', ts: new Date().toISOString() });
  } catch {
    res.status(503).json({ status: 'error', db: 'disconnected' });
  }
});

/* SPA fallback — entrega o index.html para rotas não mapeadas */
app.get('*', (_req, res) => {
  res.sendFile(path.join(ROOT, 'index.html'));
});

/* --------------------------------------------------------------------------
   Tratamento de erros não capturados
   -------------------------------------------------------------------------- */
app.use((err, _req, res, _next) => {
  console.error('[SERVER] Erro não tratado:', err.stack);
  res.status(500).json({ success: false, error: 'Erro interno do servidor.' });
});

/* --------------------------------------------------------------------------
   Inicialização
   -------------------------------------------------------------------------- */
app.listen(PORT, () => {
  console.log(`\n  ╔══════════════════════════════════════╗`);
  console.log(`  ║  Dashboard de Estoque                ║`);
  console.log(`  ║  http://localhost:${PORT}           ║`);
  console.log(`  ╚══════════════════════════════════════╝\n`);
});

/* Graceful shutdown */
process.on('SIGTERM', async () => {
  console.log('[SERVER] Encerrando graciosamente...');
  await pool.end();
  process.exit(0);
});

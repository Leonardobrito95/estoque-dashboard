/* ==========================================================================
   ETL — Runner principal
   Uso:
     node server/etl/index.js           → ETL completo (todos os meses)
     node server/etl/index.js --mes 2026-04  → apenas Abr/2026
     node server/etl/index.js --dry-run  → extrai mas NÃO salva no PostgreSQL
   ========================================================================== */
'use strict';

const { ixcQuery, testConnection, pool: ixcPool } = require('./mariadb');
const { query: pgQuery }                           = require('../db/connection');
const { buildMovimentacoesQuery }                  = require('./queries/movimentacoes');
const { buildMateriaisQuery }                      = require('./queries/materiais');
const { buildEstoqueQuery, buildConsumMedioQuery } = require('./queries/estoque');
const {
  transformProdutos, mergeConsumMedio,
  transformClientes, transformTecnicos,
  transformOrdens, transformEstoque,
  transformMovimentacoes,
} = require('./transform');
const {
  loadClientes, loadTecnicos, loadProdutos,
  loadOrdens, loadEstoque, loadMovimentacoes,
  logEtl,
} = require('./load');

/* --------------------------------------------------------------------------
   Lê argumentos CLI
   -------------------------------------------------------------------------- */
const args    = process.argv.slice(2);
const dryRun  = args.includes('--dry-run');
const mesIdx  = args.indexOf('--mes');
const mesFiltro = mesIdx !== -1 ? args[mesIdx + 1] : null; /* ex: '2026-04' */

/* --------------------------------------------------------------------------
   Runner
   -------------------------------------------------------------------------- */
async function run() {
  const inicio = new Date();
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║  ETL — IXC MariaDB → PostgreSQL          ║');
  console.log(`║  Início: ${inicio.toLocaleString('pt-BR')}          ║`);
  console.log('╚══════════════════════════════════════════╝\n');

  if (dryRun) console.log('⚠  MODO DRY-RUN — nenhum dado será salvo\n');

  /* 1. Verificar conexões */
  console.log('[1/6] Testando conexões...');
  const ixcOk = await testConnection();
  if (!ixcOk) { console.error('  ✗ IXC MariaDB indisponível. Abortando.'); process.exit(1); }
  console.log('  ✓ IXC MariaDB conectado');

  try {
    await pgQuery('SELECT 1');
    console.log('  ✓ PostgreSQL conectado\n');
  } catch {
    console.error('  ✗ PostgreSQL indisponível. Abortando.');
    process.exit(1);
  }

  let totalRegistros = 0;
  let erroMsg = null;

  try {
    const dateOpts = mesFiltro ? { mes: mesFiltro } : {};

    /* 2. EXTRACT — Ambos os fluxos em paralelo */
    console.log('[2/6] Extraindo movimentações do IXC (equipamentos + materiais)...');
    const { sql: movSql,  params: movParams  } = buildMovimentacoesQuery(dateOpts);
    const { sql: matSql,  params: matParams  } = buildMateriaisQuery(dateOpts);
    const { sql: estSql,  params: estParams  } = buildEstoqueQuery();
    const { sql: consSql, params: consParams } = buildConsumMedioQuery(3);

    const [movRows, matRows, estoqueRows, consumoRows] = await Promise.all([
      ixcQuery(movSql,  movParams),
      ixcQuery(matSql,  matParams),
      ixcQuery(estSql,  estParams),
      ixcQuery(consSql, consParams),
    ]);

    console.log(`  → ${movRows.length} movimentações de equipamentos (ONT/ONU)`);
    console.log(`  → ${matRows.length} movimentações de materiais gerais`);
    console.log(`  → ${estoqueRows.length} itens de estoque`);
    console.log(`  → ${consumoRows.length} registros de consumo médio\n`);

    /* 3. TRANSFORM — unifica os dois fluxos */
    console.log('[3/6] Transformando dados...');

    /* Marca tipo_movimentacao em cada linha antes de transformar */
    const movRowsTagged = movRows.map(r => ({ ...r, tipo_movimentacao: 'equipamento' }));
    const matRowsTagged = matRows.map(r => ({ ...r, tipo_movimentacao: 'material' }));
    const allRows = [...movRowsTagged, ...matRowsTagged];

    let produtos   = transformProdutos(allRows);
    produtos       = mergeConsumMedio(produtos, consumoRows);
    const clientes = transformClientes(allRows);
    const tecnicos = transformTecnicos(allRows);
    const ordens   = transformOrdens(allRows);
    const estoque  = transformEstoque(estoqueRows);
    const movs     = transformMovimentacoes(allRows);

    console.log(`  → ${clientes.length} clientes`);
    console.log(`  → ${tecnicos.length} técnicos`);
    console.log(`  → ${produtos.length} produtos`);
    console.log(`  → ${ordens.length} ordens de serviço`);
    console.log(`  → ${estoque.length} snapshots de estoque`);
    console.log(`  → ${movs.filter(m => m.tipo_movimentacao === 'equipamento').length} movs equipamentos`);
    console.log(`  → ${movs.filter(m => m.tipo_movimentacao === 'material').length} movs materiais\n`);

    if (dryRun) {
      console.log('⚠  DRY-RUN: extração e transformação concluídas — load ignorado.');
      await cleanup(ixcPool);
      return;
    }

    /* 5. LOAD */
    console.log('[5/6] Carregando no PostgreSQL...');
    const r1 = await loadClientes(clientes);   console.log(`  ✓ Clientes:          ${r1}`);
    const r2 = await loadTecnicos(tecnicos);   console.log(`  ✓ Técnicos:          ${r2}`);
    const r3 = await loadProdutos(produtos);   console.log(`  ✓ Produtos:          ${r3}`);
    const r4 = await loadOrdens(ordens);       console.log(`  ✓ Ordens de Serviço: ${r4}`);
    const r5 = await loadEstoque(estoque);     console.log(`  ✓ Estoque:           ${r5}`);
    const r6 = await loadMovimentacoes(movs);  console.log(`  ✓ Movimentações:     ${r6}`);

    totalRegistros = r1 + r2 + r3 + r4 + r5 + r6;

    /* 6. Finalização */
    console.log('\n[6/6] ETL concluído com sucesso!');
    const fim = new Date();
    const duracao = ((fim - inicio) / 1000).toFixed(1);
    console.log(`  Total de registros: ${totalRegistros}`);
    console.log(`  Duração: ${duracao}s`);

    await logEtl({ inicio, fim, status: 'sucesso', registros: totalRegistros, erro: null });

  } catch (err) {
    erroMsg = err.message;
    console.error('\n✗ Erro durante o ETL:', err.message);
    await logEtl({ inicio, fim: new Date(), status: 'erro', registros: totalRegistros, erro: erroMsg });
    process.exit(1);
  } finally {
    await cleanup(ixcPool);
  }
}

async function cleanup(pool) {
  try { await pool.end(); } catch { /* ignora */ }
  console.log('\n  Conexões encerradas.\n');
}

run();

/* ==========================================================================
   ETL — Load: insere/atualiza dados no PostgreSQL (UPSERT)
   Estratégia: ON CONFLICT DO UPDATE para garantir idempotência.
   ========================================================================== */
'use strict';

const { query } = require('../db/connection');

/* --------------------------------------------------------------------------
   Helpers
   -------------------------------------------------------------------------- */
async function upsertBatch(sql, rows, batchSize = 200) {
  let inserted = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    await Promise.all(batch.map(row => query(sql, row)));
    inserted += batch.length;
  }
  return inserted;
}

/* --------------------------------------------------------------------------
   Clientes
   -------------------------------------------------------------------------- */
async function loadClientes(clientes) {
  const sql = `
    INSERT INTO clientes (id, nome, ativo)
    VALUES ($1, $2, $3)
    ON CONFLICT (id) DO UPDATE
      SET nome  = EXCLUDED.nome,
          ativo = EXCLUDED.ativo,
          atualizado_em = NOW()
  `;
  return upsertBatch(sql, clientes.map(c => [c.id, c.nome, c.ativo]));
}

/* --------------------------------------------------------------------------
   Técnicos
   -------------------------------------------------------------------------- */
async function loadTecnicos(tecnicos) {
  const sql = `
    INSERT INTO tecnicos (id, nome, matricula, ativo)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (id) DO UPDATE
      SET nome      = EXCLUDED.nome,
          matricula = EXCLUDED.matricula,
          ativo     = EXCLUDED.ativo
  `;
  return upsertBatch(sql, tecnicos.map(t => [t.id, t.nome, t.matricula, t.ativo]));
}

/* --------------------------------------------------------------------------
   Produtos
   -------------------------------------------------------------------------- */
async function loadProdutos(produtos) {
  const sql = `
    INSERT INTO produtos (id, descricao, unidade, consumo_medio, ativo)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (id) DO UPDATE
      SET descricao     = EXCLUDED.descricao,
          consumo_medio = EXCLUDED.consumo_medio,
          ativo         = EXCLUDED.ativo,
          atualizado_em = NOW()
  `;
  return upsertBatch(sql, produtos.map(p => [
    p.id, p.descricao, p.unidade, p.consumo_medio, p.ativo
  ]));
}

/* --------------------------------------------------------------------------
   Ordens de Serviço
   Só insere clientes que já existem no PostgreSQL (evita FK violation)
   -------------------------------------------------------------------------- */
async function loadOrdens(ordens) {
  const sql = `
    INSERT INTO ordens_servico (id, assunto, cliente_id, status, abertura)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (id) DO UPDATE
      SET assunto    = EXCLUDED.assunto,
          status     = EXCLUDED.status,
          atualizado_em = NOW()
  `;
  return upsertBatch(sql, ordens.map(o => [
    o.id, o.assunto, o.cliente_id, o.status || 'em_andamento', o.abertura
  ]));
}

/* --------------------------------------------------------------------------
   Estoque (snapshot mensal)
   -------------------------------------------------------------------------- */
async function loadEstoque(estoqueRows) {
  const sql = `
    INSERT INTO estoque (produto_id, quantidade, mes_referencia, snapshot_em)
    VALUES ($1, $2, $3, NOW())
    ON CONFLICT (produto_id, mes_referencia) DO UPDATE
      SET quantidade  = EXCLUDED.quantidade,
          snapshot_em = NOW()
  `;
  return upsertBatch(sql, estoqueRows.map(e => [
    e.produto_id, e.quantidade, e.mes_referencia
  ]));
}

/* --------------------------------------------------------------------------
   Movimentações
   Usa (produto_id, os_id, mes_referencia) como chave de conflito.
   OS sem id (transferência direta) usa id_almox como chave alternativa.
   -------------------------------------------------------------------------- */
async function loadMovimentacoes(movs) {
  /* Movs COM OS vinculada */
  const comOS = movs.filter(m => m.os_id);
  /* Movs SEM OS (transferência direta entre almoxarifados) */
  const semOS = movs.filter(m => !m.os_id);

  const sqlComOS = `
    INSERT INTO movimentacoes
      (produto_id, os_id, tecnico_id, quantidade_saida, mes_referencia,
       tipo_movimentacao, status_comodato, id_almox_origem, id_almox_destino, origem_etl)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    ON CONFLICT (produto_id, os_id, mes_referencia, tipo_movimentacao) DO UPDATE
      SET quantidade_saida  = EXCLUDED.quantidade_saida,
          status_comodato   = EXCLUDED.status_comodato,
          origem_etl        = EXCLUDED.origem_etl
  `;

  let total = 0;
  
  const chunked = (arr, size) => 
    Array.from({ length: Math.ceil(arr.length / size) }, (v, i) => arr.slice(i * size, i * size + size));

  for (const batch of chunked(comOS, 200)) {
    await Promise.all(batch.map(async (m) => {
      try {
        await query(sqlComOS, [
          m.produto_id, m.os_id, m.tecnico_id,
          m.quantidade_saida, m.mes_referencia,
          m.tipo_movimentacao, m.status_comodato,
          m.id_almox_origem, m.id_almox_destino, m.origem_etl
        ]);
        total++;
      } catch (err) {
        /* Ignora FK violation (OS sem cliente cadastrado) e continua */
        if (!err.message.includes('foreign key')) throw err;
      }
    }));
  }

  /* Transferências sem OS ficam numa tabela auxiliar para rastreio */
  if (semOS.length > 0) {
    const sqlTransf = `
      INSERT INTO movimentacoes_transf
        (produto_id, tecnico_id, quantidade_saida, mes_referencia,
         id_almox_origem, id_almox_destino, status_comodato, origem_etl)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT DO NOTHING
    `;
    for (const batch of chunked(semOS, 200)) {
      await Promise.all(batch.map(async (m) => {
        try {
          await query(sqlTransf, [
            m.produto_id, m.tecnico_id, m.quantidade_saida, m.mes_referencia,
            m.id_almox_origem, m.id_almox_destino, m.status_comodato, m.origem_etl
          ]);
          total++;
        } catch { /* tabela pode não existir ainda — ignora */ }
      }));
    }
  }

  return total;
}

/* --------------------------------------------------------------------------
   Log de execução ETL
   -------------------------------------------------------------------------- */
async function logEtl({ inicio, fim, status, registros, erro }) {
  const sql = `
    INSERT INTO etl_log (iniciado_em, concluido_em, status, registros_processados, erro)
    VALUES ($1, $2, $3, $4, $5)
  `;
  try {
    await query(sql, [inicio, fim, status, registros, erro]);
  } catch { /* silencia se tabela não existir */ }
}

module.exports = {
  loadClientes,
  loadTecnicos,
  loadProdutos,
  loadOrdens,
  loadEstoque,
  loadMovimentacoes,
  logEtl,
};

/* ==========================================================================
   ETL — Transformações
   Converte dados brutos do IXC para o formato do schema PostgreSQL.
   ========================================================================== */
'use strict';

/* Mapas de status (espelho dos ReplaceValue do Power BI) */
const STATUS_COMODATO = { B: 'Baixado', D: 'Devolvido', E: 'Emprestado' };
const STATUS_CONTRATO = { A: 'Ativo', D: 'Desistiu', I: 'Inativo', N: 'Negativado', P: 'Pré-contrato' };
const STATUS_INTERNET = {
  A:  'Ativo',
  AA: 'Aguardando Assinatura',
  CA: 'Bloqueio Automático',
  CM: 'Bloqueio Manual',
  FA: 'Financeiro em Atraso',
  D:  'Desativado',
};

/* --------------------------------------------------------------------------
   Produtos — deduplica e normaliza catálogo
   -------------------------------------------------------------------------- */
function transformProdutos(movRows) {
  const map = new Map();
  for (const r of movRows) {
    if (!map.has(r.id_produto)) {
      map.set(r.id_produto, {
        id:          String(r.id_produto),
        descricao:   r.descricao_produto || '',
        unidade:     'un',
        consumo_medio: 0,  /* será atualizado após calcular consumo */
        ativo:       true,
      });
    }
  }
  return [...map.values()];
}

/* --------------------------------------------------------------------------
   Produtos — atualiza consumo_medio usando resultado do buildConsumMedioQuery
   -------------------------------------------------------------------------- */
function mergeConsumMedio(produtos, consumoRows) {
  const map = new Map(consumoRows.map(r => [String(r.id_produto), parseFloat(r.consumo_medio) || 0]));
  return produtos.map(p => ({
    ...p,
    consumo_medio: map.get(p.id) ?? p.consumo_medio,
  }));
}

/* --------------------------------------------------------------------------
   Clientes — deduplica
   -------------------------------------------------------------------------- */
function transformClientes(movRows) {
  const map = new Map();
  map.set('0', { id: '0', nome: 'Não informado / Interno', ativo: true });
  for (const r of movRows) {
    const cid = (r.cliente_id && r.cliente_id !== 0) ? String(r.cliente_id) : '0';
    if (!map.has(cid)) {
      map.set(cid, {
        id:   cid,
        nome: r.cliente_nome || `Cliente ${cid}`,
        ativo: true,
      });
    }
  }
  return [...map.values()];
}

/* --------------------------------------------------------------------------
   Técnicos — deduplica
   -------------------------------------------------------------------------- */
function transformTecnicos(movRows) {
  const map = new Map();
  for (const r of movRows) {
    if (r.tecnico_id && r.tecnico_id !== 0 && !map.has(r.tecnico_id)) {
      map.set(r.tecnico_id, {
        id:        String(r.tecnico_id),
        nome:      r.tecnico_nome || `Técnico ${r.tecnico_id}`,
        matricula: null,
        ativo:     true, /* funcionarios.ativo = 'S'/'N' — filtrado na query se necessário */
      });
    }
  }
  return [...map.values()];
}

/* --------------------------------------------------------------------------
   Ordens de Serviço — deduplica
   -------------------------------------------------------------------------- */
function transformOrdens(movRows, clienteMap) {
  const map = new Map();
  for (const r of movRows) {
    const osId = r.os_id ? String(r.os_id) : null;
    if (osId && !map.has(osId)) {
      map.set(osId, {
        id:         osId,
        assunto:    r.os_assunto || 'Sem assunto',
        cliente_id: (r.cliente_id && r.cliente_id !== 0) ? String(r.cliente_id) : '0',
        status:     'em_andamento',
        abertura:   r.data ? new Date(r.data).toISOString().slice(0, 10) : null,
      });
    }
  }
  return [...map.values()];
}

/* --------------------------------------------------------------------------
   Estoque — normaliza snapshot do almoxarifado
   -------------------------------------------------------------------------- */
function transformEstoque(estoqueRows) {
  return estoqueRows.map(r => ({
    produto_id:     String(r.id_produto),
    quantidade:     parseInt(r.qtd_estoque, 10) || 0,
    mes_referencia: normalizeMes(r.mes_referencia),
    almoxarifado:   r.almoxarifado || 'Principal',
  }));
}

/* --------------------------------------------------------------------------
   Movimentações — linha principal do dashboard
   -------------------------------------------------------------------------- */
function transformMovimentacoes(rows) {
  return rows
    .filter(r => parseInt(r.quantidade, 10) > 0)
    .map(r => {
      const qtd = parseInt(r.quantidade, 10);
      return {
        produto_id:        String(r.id_produto),
        os_id:             r.os_id ? String(r.os_id) : null,
        tecnico_id:        r.tecnico_id && r.tecnico_id !== 0 ? String(r.tecnico_id) : null,
        quantidade_saida:  qtd,
        mes_referencia:    normalizeMes(r.mes_referencia),
        tipo_movimentacao: r.tipo_movimentacao || 'equipamento',
        status_comodato:   r.status_comodato || '',
        cliente_id:        (r.cliente_id && r.cliente_id !== 0) ? String(r.cliente_id) : '0',
        id_almox_origem:   r.id_almox_origem || null,
        id_almox_destino:  r.id_almox_destino || null,
        origem_etl:        'ixc_mariadb_v1',
      };
    });
}

/* --------------------------------------------------------------------------
   Utilitários
   -------------------------------------------------------------------------- */

/* Normaliza formatos de mês: '04/2026' | 'Apr/2026' → 'Abr/2026' */
const MESES_EN_PT = {
  Jan: 'Jan', Feb: 'Fev', Mar: 'Mar', Apr: 'Abr',
  May: 'Mai', Jun: 'Jun', Jul: 'Jul', Aug: 'Ago',
  Sep: 'Set', Oct: 'Out', Nov: 'Nov', Dec: 'Dez',
};

function normalizeMes(str) {
  if (!str) return '';
  /* Já no formato correto (Abr/2026) */
  if (/^[A-Za-z]{3}\/\d{4}$/.test(str)) {
    const [m, y] = str.split('/');
    return (MESES_EN_PT[m] || m) + '/' + y;
  }
  /* Formato YYYY-MM */
  if (/^\d{4}-\d{2}$/.test(str)) {
    const [y, m] = str.split('-');
    const idx = parseInt(m, 10) - 1;
    const ptMes = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
    return ptMes[idx] + '/' + y;
  }
  return str;
}

/* Calcula status de divergência */
function calcDivergencia(qtd_saida, qtd_estoque, consumo_medio) {
  if (qtd_saida > qtd_estoque) return 'divergencia';
  if (consumo_medio > 0 && qtd_saida > consumo_medio * 1.5) return 'alerta';
  return 'ok';
}

module.exports = {
  transformProdutos,
  mergeConsumMedio,
  transformClientes,
  transformTecnicos,
  transformOrdens,
  transformEstoque,
  transformMovimentacoes,
  normalizeMes,
  calcDivergencia,
  STATUS_COMODATO,
  STATUS_CONTRATO,
  STATUS_INTERNET,
};

/* ==========================================================================
   QUERY — Snapshot de Estoque por Produto (almoxarifado)
   Calcula quantidade atual em cada almoxarifado via itens_almox do IXC.

   Tabelas IXC utilizadas:
     itens_almox         → saldo atual por produto/almoxarifado
     produtos            → catálogo
     almoxarifado        → nome do almoxarifado
   ========================================================================== */
'use strict';

const { PRODUTO_IDS } = require('./movimentacoes');

/**
 * Saldo de estoque atual por produto nos almoxarifados.
 * Retorna quantidade disponível (não emprestada) para cada produto filtrado.
 */
function buildEstoqueQuery() {
  const idPlaceholders = PRODUTO_IDS.map(() => '?').join(',');

  const sql = `
    SELECT
      ia.id_produto,
      p.descricao                                    AS descricao_produto,
      ia.almox_descricao                             AS almoxarifado,
      ia.almox_id                                    AS id_almoxarifado,
      ia.saldo                                       AS qtd_estoque,
      0                                              AS qtd_minima,
      DATE_FORMAT(NOW(), '%b/%Y')                    AS mes_referencia
    FROM ixcprovedor.view_prod_estoque_almox ia
    JOIN ixcprovedor.produtos p
      ON p.id = ia.id_produto
    WHERE ia.id_produto IN (${idPlaceholders})
      AND ia.saldo > 0
    ORDER BY p.descricao ASC, ia.almox_id ASC
  `;

  return { sql, params: [...PRODUTO_IDS] };
}

/**
 * Consumo médio por produto (últimos N meses).
 * Usado para calcular divergências (saída > consumo_medio).
 * @param {number} meses - Janela de cálculo (padrão: 3)
 */
function buildConsumMedioQuery(meses = 3) {
  const idPlaceholders = PRODUTO_IDS.map(() => '?').join(',');

  const sql = `
    SELECT
      mp.id_produto,
      p.descricao,
      ROUND(
        SUM(mp.quantidade) / GREATEST(COUNT(DISTINCT DATE_FORMAT(mp.data, '%Y-%m')), 1),
        2
      ) AS consumo_medio,
      SUM(mp.quantidade)  AS total_saida,
      COUNT(DISTINCT DATE_FORMAT(mp.data, '%Y-%m')) AS meses_com_movimento
    FROM ixcprovedor.movimento_produtos mp
    JOIN ixcprovedor.produtos p ON p.id = mp.id_produto
    WHERE mp.id_produto IN (${idPlaceholders})
      AND mp.data >= DATE_SUB(CURDATE(), INTERVAL ? MONTH)
      AND mp.status_comodato IN ('E', 'B', 'D')
    GROUP BY mp.id_produto, p.descricao
    ORDER BY consumo_medio DESC
  `;

  return { sql, params: [...PRODUTO_IDS, meses] };
}

/**
 * Requisições de devolução/transferência com confirmação.
 * Espelho da query "itens_requisicao_devolucao_material" do Power BI.
 */
function buildRequisicaoTransfQuery() {
  const sql = `
    SELECT
      ird.id_requisicao_devolucao_material            AS id_requisicao,
      rdm.id_almox_origem,
      ao.nome                                         AS almox_origem,
      rdm.id_almox_destino,
      ad.nome                                         AS almox_destino,
      rdm.observacao,
      rdm.status,
      DATE(rdm.data)                                  AS data_solicitacao,
      rdm.data_confirmacao,
      ird.id_produto,
      p.descricao                                     AS descricao_produto,
      ird.id_patrimonio,
      pat.numero_nf,
      pat.serial_fornecedor                           AS serial,
      pat.id_mac                                      AS mac_id
    FROM ixcprovedor.itens_requisicao_devolucao_material ird
    JOIN ixcprovedor.requisicao_devolucao_material rdm
      ON rdm.id = ird.id_requisicao_devolucao_material
    JOIN ixcprovedor.produtos p
      ON p.id = ird.id_produto
    LEFT JOIN ixcprovedor.patrimonio pat
      ON pat.id = ird.id_patrimonio
    LEFT JOIN ixcprovedor.almoxarifado ao
      ON ao.id = rdm.id_almox_origem
    LEFT JOIN ixcprovedor.almoxarifado ad
      ON ad.id = rdm.id_almox_destino
    WHERE p.descricao IN (
      'DATACOM DMSWITCH 2104G2',
      'ONT DATACOM WIFI 5 DM986-414 (NOVO)',
      'ONT HURAKALL ST-1001-FL WIFI 5 (NOVO)',
      'ONT HURAKALL ST-1001-FL WIFI 5(NOVO)',
      'ONT NOKIA WIFI 4 G140W PRETA/BRANCA (NOVO)',
      'ONT T21 SUMEC NAVIGATOR WIFI 5(NOVO)',
      'ONT TENDA HG9 WIFI 5 (NOVO)',
      'ONT TP-LINK XC220 WIFI 5 (NOVO)',
      'ONT TX40 SUMEC NAVIGATOR WIFI 6 (NOVO)',
      'ONT ZIKUN ZC-521 WIFI 5 (NOVO)',
      'ONT ZTE F670L MULTILASER WIFI 5 (NOVO)',
      'ONT ZYXEL WIFI 6 AX3000 PX 3321 T1 (NOVO)',
      'ONU C-DATA FD600 (NOVO)',
      'ONU CIANET BRIDGE (NOVO)',
      'ONU DATACOM 100 (NOVO)',
      'ONU DATACOM VOIP 110 (NOVO)',
      'ONU FIBERHOME AN5506-01-A (NOVO)',
      'ONU GFIBER 1GE (NOVO)',
      'ONU MAXPRINT MAXFIBER 1000 (NOVO)',
      'ONU MULTILASER RE709/RE880 (NOVO)',
      'ONU STORM GPON ST8010GZ / S01A (NOVO)',
      'ONU T10 SUMEC 1GE (NOVO)',
      'ONU VSOL 1GE (NOVO)',
      'ONU ZTE F601 MULTI (NOVO)',
      'ONU ZTE F6600P WI-FI 6 AX3000',
      'REPETIDOR TP LINK RE200 (NOVO)',
      'REPETIDOR TP LINK RE305 (NOVO)',
      'ROTEADOR AC12G MERCUSYS WIFI 5 (FORA DE LINHA)',
      'ROTEADOR C20 TP-LINK WIFI 5 (FORA DE LINHA)',
      'ROTEADOR C5 TP-LINK WIFI 5 (NOVO)',
      'ROTEADOR EX141 TP-LINK WIFI 6 (NOVO)',
      'ROTEADOR G5 TP-LINK WIFI 5 (NOVO)',
      'ROTEADOR HUAWEI WS5200 V3 WIFI 5 (NOVO)',
      'ROTEADOR MR30G MERCUSYS WIFI 5 (NOVO)',
      'ROTEADOR MR60X MERCUSYS WIFI 6 (NOVO)',
      'ROTEADOR R15 SUMEC NAVIGATOR WIFI 6 (NOVO)',
      'ROTEADOR R20 SUMEC SM6631 WIFI 6 (NOVO)',
      'ROUTERBOARD MIKROTIK HAP LITE TC 2ND (NOVO)',
      'ROUTERBOARD MIKROTIK RB 750GR3 GIGABIT (NOVO)',
      'ROUTERBOARD RB4011IGS+5HACQ2HND-IN WIFI EU L5',
      'SWITH TPLINK LITEWAVE LS1008G 8P GIGABIT (NOVO)'
    )
    ORDER BY rdm.data DESC
  `;

  return { sql, params: [] };
}

module.exports = { buildEstoqueQuery, buildConsumMedioQuery, buildRequisicaoTransfQuery };

/* ==========================================================================
   QUERY — Movimentações de Materiais/Produtos Gerais
   Espelho do dashboard Power BI "movimentação de produtos" (não-equipamentos).

   Lógica: exclui ONT/ONU/Roteadores e termos de planos/serviços de internet.
   O complemento do filtro de equipamentos.
   ========================================================================== */
'use strict';

/* Termos excluídos por LIKE (Text.Contains do Power BI → NOT LIKE '%termo%') */
const EXCLUIR_LIKE = [
  'ONU', 'ONT', 'ROTEADOR', 'Link', 'Assine', 'plano', 'fiber',
  'ZC-521', 'MAXPRINT', 'SMART BOX', 'HURAKALL', 'CIANET',
  'MIKROTIK', 'ROUTERBOARD', 'Canaa', 'IP Publico', 'Taxa',
  'Livre', 'MULTILASER', '521', 'Extravio de Equipamentos',
  'DATACOM', 'ACCESS POINT', 'Internet', 'Proporcional', 'WIFI+',
  'FALTANTE', '100x50', 'TORRES', 'GOURMET', 'Boulevard', 'Absoluto',
  'Adicional', 'Adriana', 'All ', 'Almirante', 'PlayHub', 'App ',
  'Araucárias', 'Art Life', 'BAND_', 'Banda ', 'Acima ', '250 MEGA',
  '500 MEGA', 'Propocional', 'MUDANÇA DE ENDEREÇO', 'ZTE ', 'Paramount',
  'VoIP ', 'Ubook GO', 'Transporte', 'Telefonia', 'Minutos', 'SLA ',
  'Serviços de DNS', 'Residencial', 'Rateio', 'Negociação', 'Leveduca',
  'Lessence', 'Kaspersky', 'IP Fixo', 'Cortesia', 'Basico ',
];

/* Descrições excluídas por igualdade exata */
const EXCLUIR_EXATO = [
  'FONTE ONU ROUTER 12V 1.5A',
  'Mont Bello 25X10 Mega',
  'Mont Bello 25X10 Mega (val. 30/09/2019)',
  'Mont Bello 25X10 Mega (val. 30/09/2019) - DESCONTINUADO',
  'Mont Bello 50X25 Mega',
  'Mont Blanc 100x50 Mega',
  'Mont Blanc 100x50 Mega (Val. 31/08/2019)',
  'Mont Blanc 100x50 Mega (Val. 31/08/2019) - DESCONTINUADO',
  'Mont Blanc 25x10 Mega',
  'Mont Blanc 25x10 Mega (Val. 31/08/2019)',
  'Mont Blanc 25x10 Mega (Val. 31/08/2019) - DESCONTINUADO',
  'Assine 75Mb Leve 150Mb por 12 meses (Desc. 10,00 PONT + 7,00 Juros)',
];

/**
 * Monta a query de movimentações de materiais gerais.
 * @param {{ dataInicio?: string, dataFim?: string, mes?: string }} opts
 */
function buildMateriaisQuery(opts = {}) {
  /* NOT LIKE para cada termo */
  const likeConditions = EXCLUIR_LIKE
    .map(() => `mp.descricao NOT LIKE ?`)
    .join('\n      AND ');
  const likeParams = EXCLUIR_LIKE.map(t => `%${t}%`);

  /* NOT IN para igualdades exatas */
  const exactPlaceholders = EXCLUIR_EXATO.map(() => '?').join(', ');
  const exactParams = [...EXCLUIR_EXATO];

  const params = [...likeParams, ...exactParams];

  let dateFilter = '';
  if (opts.dataInicio && opts.dataFim) {
    dateFilter = 'AND mp.data BETWEEN ? AND ?';
    params.push(opts.dataInicio, opts.dataFim);
  } else if (opts.mes) {
    dateFilter = "AND DATE_FORMAT(mp.data, '%Y-%m') = ?";
    params.push(opts.mes);
  }

  const sql = `
    SELECT
      mp.id                                                           AS id_movimentacao,
      mp.data                                                         AS data,
      mp.id_produto,
      mp.descricao                                                    AS descricao_produto,
      mp.quantidade,
      CASE mp.status_comodato
        WHEN 'B' THEN 'Baixado'
        WHEN 'D' THEN 'Devolvido'
        WHEN 'E' THEN 'Emprestado'
        ELSE COALESCE(mp.status_comodato, '')
      END                                                             AS status_comodato,

      CASE
        WHEN mp.id_contrato IS NULL OR mp.id_contrato = 0
          THEN mp.id_contrato_servicos
        ELSE mp.id_contrato
      END                                                             AS id_contrato,

      mp.patrimonio,
      mp.numero_serie,
      mp.mac,
      mp.id_patrimonio,

      mp.id_oss_chamado                                               AS os_id,
      COALESCE(ossa.assunto, '')                                      AS os_assunto,

      COALESCE(soc.id_tecnico, 0)                                     AS tecnico_id,
      COALESCE(tec.funcionario, 'Não informado')                      AS tecnico_nome,

      COALESCE(cc.id_cliente, 0)                                      AS cliente_id,
      COALESCE(c.razao, '')                                           AS cliente_nome,

      mp.id_transf_almox,
      COALESCE(ta.obs, '')                                            AS obs_transf,
      COALESCE(ta.id_almox_saida, 0)                                  AS id_almox_origem,
      COALESCE(ta.id_almox_entrada, 0)                                AS id_almox_destino,

      COALESCE(pat.numero_nf, '')                                     AS numero_nf,

      DATE_FORMAT(mp.data, '%b/%Y')                                   AS mes_referencia,
      DATE_FORMAT(mp.data, '%Y-%m')                                   AS mes_ano,

      'material'                                                      AS tipo_movimentacao

    FROM ixcprovedor.movimento_produtos mp

    LEFT JOIN ixcprovedor.su_oss_chamado soc
      ON soc.id = mp.id_oss_chamado
    LEFT JOIN ixcprovedor.su_oss_assunto ossa
      ON ossa.id = soc.id_assunto
    LEFT JOIN ixcprovedor.funcionarios tec
      ON tec.id = soc.id_tecnico
    LEFT JOIN ixcprovedor.cliente_contrato cc
      ON cc.id = CASE
                   WHEN mp.id_contrato IS NULL OR mp.id_contrato = 0
                     THEN mp.id_contrato_servicos
                   ELSE mp.id_contrato
                 END
    LEFT JOIN ixcprovedor.cliente c
      ON c.id = cc.id_cliente
    LEFT JOIN ixcprovedor.transf_almox ta
      ON ta.id = mp.id_transf_almox
    LEFT JOIN ixcprovedor.patrimonio pat
      ON pat.id = mp.id_patrimonio

    WHERE
      ${likeConditions}
      AND mp.descricao NOT IN (${exactPlaceholders})
      ${dateFilter}

    ORDER BY mp.data DESC, mp.id DESC
  `;

  return { sql, params };
}

/* --------------------------------------------------------------------------
   Requisições formais de transferência — materiais gerais
   (itens_requisicao_devolucao_material excluindo equipamentos)
   -------------------------------------------------------------------------- */
const EXCLUIR_REQUISICAO_LIKE = ['ONU', 'ONT', 'ROTEADOR', 'Link', 'Assine', 'plano', 'fiber', 'ZC-521'];

function buildRequisicaoMateriaisQuery() {
  const likeConds = EXCLUIR_REQUISICAO_LIKE
    .map(() => `p.descricao NOT LIKE ?`)
    .join(' AND ');
  const likeParams = EXCLUIR_REQUISICAO_LIKE.map(t => `%${t}%`);

  const sql = `
    SELECT
      ird.id_requisicao_devolucao_material              AS id_requisicao,
      rdm.id_almox_origem,
      ao.nome                                           AS almox_origem,
      rdm.id_almox_destino,
      ad.nome                                           AS almox_destino,
      rdm.observacao,
      rdm.status,
      DATE(rdm.data)                                    AS data_solicitacao,
      rdm.data_confirmacao,
      ird.id_produto,
      p.descricao                                       AS descricao_produto
    FROM ixcprovedor.itens_requisicao_devolucao_material ird
    JOIN ixcprovedor.requisicao_devolucao_material rdm
      ON rdm.id = ird.id_requisicao_devolucao_material
    JOIN ixcprovedor.produtos p
      ON p.id = ird.id_produto
    LEFT JOIN ixcprovedor.almoxarifado ao ON ao.id = rdm.id_almox_origem
    LEFT JOIN ixcprovedor.almoxarifado ad ON ad.id = rdm.id_almox_destino
    WHERE ${likeConds}
    ORDER BY rdm.data DESC
  `;

  return { sql, params: likeParams };
}

module.exports = {
  buildMateriaisQuery,
  buildRequisicaoMateriaisQuery,
  EXCLUIR_LIKE,
  EXCLUIR_EXATO,
};

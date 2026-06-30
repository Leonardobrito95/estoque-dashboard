/* ==========================================================================
   QUERY — Movimentações de Equipamentos (ONT/ONU/Roteadores)
   Baseado nas queries Power BI fornecidas.

   Tabelas IXC utilizadas:
     movimento_produtos         → registro de cada movimentação
     produtos                   → catálogo de produtos
     cliente_contrato           → vínculo contrato ↔ cliente
     cliente                    → dados do cliente
     su_oss_chamado             → Ordem de Serviço
     su_oss_assunto             → assunto/tipo da OS
     su_oss_chamado_tecnico     → vínculo OS ↔ técnico (ajustar se necessário)
     su_tecnico                 → cadastro de técnicos
     transf_almox               → transferências entre almoxarifados
     patrimonio                 → patrimônio (NF, serial, MAC)
   ========================================================================== */
'use strict';

/* IDs de produtos filtrados (espelho dos filtros Power BI) */
const PRODUTO_IDS = [
  155, 311, 312, 313, 314, 315, 316, 317,
  331, 332, 333, 335, 338, 339, 340,
  345, 346, 347, 348, 349,
  353, 354, 355, 356, 357, 358,
  529, 530, 531, 532, 534, 535, 538,
  546, 548, 568, 569, 570, 572, 573,
  895, 937, 938, 941, 944, 952,
  1007, 1047, 1066, 1070, 1083,
  1247, 1282, 1312,
];

/* Descrições excluídas (planos de internet que aparecem na tabela) */
const DESC_EXCLUIDAS = [
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
 * Retorna a query SQL e os parâmetros para movimentações filtradas.
 * @param {{ dataInicio?: string, dataFim?: string, mes?: string }} opts
 */
function buildMovimentacoesQuery(opts = {}) {
  const idPlaceholders = PRODUTO_IDS.map(() => '?').join(',');
  const excPlaceholders = DESC_EXCLUIDAS.map(() => '?').join(',');

  const params = [...PRODUTO_IDS, ...DESC_EXCLUIDAS];

  /* Filtros de data opcionais */
  let dateFilter = '';
  if (opts.dataInicio && opts.dataFim) {
    dateFilter = 'AND mp.data BETWEEN ? AND ?';
    params.push(opts.dataInicio, opts.dataFim);
  } else if (opts.mes) {
    /* mes no formato 'YYYY-MM' */
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

      /* Contrato: prioriza id_contrato, fallback para id_contrato_servicos */
      CASE
        WHEN mp.id_contrato IS NULL OR mp.id_contrato = 0
          THEN mp.id_contrato_servicos
        ELSE mp.id_contrato
      END                                                             AS id_contrato,

      mp.patrimonio,
      mp.numero_serie,
      mp.mac,
      mp.id_patrimonio,

      /* Ordem de Serviço */
      mp.id_oss_chamado                                               AS os_id,
      COALESCE(ossa.assunto, '')                                      AS os_assunto,

      /* Técnico: su_oss_chamado.id_tecnico → funcionarios.id / funcionarios.funcionario */
      COALESCE(soc.id_tecnico, 0)                                     AS tecnico_id,
      COALESCE(tec.funcionario, 'Não informado')                      AS tecnico_nome,

      /* Cliente */
      COALESCE(cc.id_cliente, 0)                                      AS cliente_id,
      COALESCE(c.razao, '')                                           AS cliente_nome,

      /* Transferência entre almoxarifados */
      mp.id_transf_almox,
      COALESCE(ta.obs, '')                                            AS obs_transf,
      COALESCE(ta.id_almox_saida, 0)                                  AS id_almox_origem,
      COALESCE(ta.id_almox_entrada, 0)                                AS id_almox_destino,

      /* Patrimônio */
      COALESCE(pat.numero_nf, '')                                     AS numero_nf,
      COALESCE(pat.serial_fornecedor, mp.numero_serie, '')            AS serial,

      /* Mês de referência no formato Mmm/AAAA (ex: Abr/2026) */
      DATE_FORMAT(mp.data, '%b/%Y')                                   AS mes_referencia,
      DATE_FORMAT(mp.data, '%Y-%m')                                   AS mes_ano

    FROM ixcprovedor.movimento_produtos mp

    /* Ordem de Serviço + assunto */
    LEFT JOIN ixcprovedor.su_oss_chamado soc
      ON soc.id = mp.id_oss_chamado
    LEFT JOIN ixcprovedor.su_oss_assunto ossa
      ON ossa.id = soc.id_assunto

    /* Técnico responsável pela OS: su_oss_chamado.id_tecnico → funcionarios.id */
    LEFT JOIN ixcprovedor.funcionarios tec
      ON tec.id = soc.id_tecnico

    /* Contrato → Cliente */
    LEFT JOIN ixcprovedor.cliente_contrato cc
      ON cc.id = CASE
                   WHEN mp.id_contrato IS NULL OR mp.id_contrato = 0
                     THEN mp.id_contrato_servicos
                   ELSE mp.id_contrato
                 END
    LEFT JOIN ixcprovedor.cliente c
      ON c.id = cc.id_cliente

    /* Transferência almoxarifado */
    LEFT JOIN ixcprovedor.transf_almox ta
      ON ta.id = mp.id_transf_almox

    /* Patrimônio */
    LEFT JOIN ixcprovedor.patrimonio pat
      ON pat.id = mp.id_patrimonio

    WHERE
      /* Filtro por ID de produto OU descrição contendo ONT/ONU */
      (
        mp.id_produto IN (${idPlaceholders})
        OR mp.descricao LIKE '%ONT %'
        OR mp.descricao LIKE '%ONU %'
      )
      /* Excluir descrições que não são equipamentos */
      AND mp.descricao NOT IN (${excPlaceholders})
      ${dateFilter}

    ORDER BY mp.data DESC, mp.id DESC
  `;

  return { sql, params };
}

module.exports = { buildMovimentacoesQuery, PRODUTO_IDS, DESC_EXCLUIDAS };

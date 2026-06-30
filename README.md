# 📦 Estoque Dashboard

> Dashboard operacional de controle de estoque com pipeline ETL próprio: extrai movimentações e materiais do ERP (IXC/MariaDB), transforma e carrega num PostgreSQL otimizado para leitura, e serve um painel web com gráficos.

![Node.js](https://img.shields.io/badge/Node.js-18+-339933?logo=nodedotjs&logoColor=white)
![Express](https://img.shields.io/badge/Express-API-000000?logo=express&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-dashboard-336791?logo=postgresql&logoColor=white)
![MariaDB](https://img.shields.io/badge/MariaDB-IXC-003545?logo=mariadb&logoColor=white)

## 🎯 O problema

O controle de estoque vivia dentro do ERP (IXC), pesado para consultas analíticas e sem uma visão consolidada de movimentação. Rodar relatório direto na base de produção era lento e arriscado.

## 💡 A solução

Separar o operacional do analítico com um ETL dedicado:

```
  IXC / MariaDB                  ETL (Node)                  PostgreSQL              Dashboard
  ┌──────────┐   extract    ┌──────────────┐   load    ┌──────────────┐          ┌──────────┐
  │ materiais │ ───────────► │  transform   │ ────────► │  tabelas      │ ──────►  │ Express  │
  │ movimentos│              │ (normaliza)  │           │  analíticas   │  API     │ + charts │
  └──────────┘              └──────────────┘           └──────────────┘          └──────────┘
```

- **Extract:** queries isoladas por domínio (`estoque`, `materiais`, `movimentacoes`) contra o IXC.
- **Transform:** normalização dos dados num módulo dedicado (`transform.js`).
- **Load:** escrita idempotente no PostgreSQL, com modo `--dry-run` e `--mes`.
- **Serve:** API Express e frontend com gráficos de movimentação e saldo.

## 🛠️ Stack

| Camada | Tecnologia |
|---|---|
| Runtime | **Node.js 18+** |
| API | **Express** |
| ETL | Scripts Node (`mysql2` para `pg`) |
| Fonte | **MariaDB** (IXC) |
| Destino | **PostgreSQL** |
| Frontend | HTML e JS (charts) |

## 📂 Estrutura

```
server/
├── index.js              # API Express
├── db/                   # conexão e init do schema
├── etl/
│   ├── index.js          # orquestra o ETL (flags --mes, --dry-run)
│   ├── queries/          # extract por domínio
│   ├── transform.js      # normalização
│   └── load.js           # carga no PostgreSQL
└── routes/estoque.js     # endpoints do dashboard
sql/schema.sql            # schema analítico
js/ + styles/ + index.html # frontend
```

## 🚀 Rodando localmente

```bash
npm install
cp .env.example .env       # preencha PostgreSQL (destino) e MariaDB/IXC (fonte)
npm run db:init            # cria o schema
npm run etl                # roda o ETL
npm start                  # http://localhost:5004
```

Variações do ETL:
```bash
npm run etl:dry            # simula sem gravar
npm run etl:mes            # processa apenas o mês corrente
```

<sub>Dashboard interno de uma ISP regional. Credenciais e dados reais foram removidos desta versão de portfólio.</sub>

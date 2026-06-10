# CLAUDE.md — Contexto do Projeto para o Claude Code

> Este arquivo é lido automaticamente pelo Claude Code em toda sessão aberta nesta
> pasta. Ele resume o projeto e as convenções de trabalho. A especificação completa
> está em [`docs/ESPECIFICACAO-TECNICA.md`](docs/ESPECIFICACAO-TECNICA.md) — leia-a
> antes de qualquer decisão de arquitetura ou de dados.

## O que é o projeto

Aplicação web de **SIG** (Sistema de Informação Geográfica) para análise
**estatística** da evolução espaço-temporal das manchas criminais no Estado de SP
(com plano de contingência focado em São José dos Campos). Disciplina **CSI-10 /
ITA**, feito por uma **dupla**. Fonte de dados: planilhas abertas da **SSP-SP**
(Jan/2022 a Abr/2026, ~6 milhões de registros).

**Prazo de entrega: 02/07/2026 (semana 16).**

## Stack

- **Frontend:** React + TypeScript + **OpenLayers**.
- **Backend/API:** Node.js (Express ou Fastify).
- **Banco:** PostgreSQL + **PostGIS**.
- **Infra:** Docker (banco + API conteinerizados).
- **ETL:** Node.js + TypeScript (`csv-parse`, `pg`, `pg-copy-streams`, `dotenv`).

## Estrutura do repositório

```
ProjetoCSI10/
├── CLAUDE.md                       # este arquivo
├── README.md                       # visão geral para humanos
├── docs/
│   └── ESPECIFICACAO-TECNICA.md    # DET — fonte da verdade do escopo
├── etl/                            # extração, transformação e carga (Node/TS)
│   ├── src/index.ts                # ETL: limpa as planilhas -> ocorrencias_limpas.csv
│   ├── src/load.ts                 # carga em massa do CSV no PostGIS (COPY)
│   ├── src/municipios.ts           # baixa a malha municipal do IBGE -> tabela municipios
│   ├── src/centroides_bairro.ts    # preenche centroides de bairro via OpenStreetMap
│   ├── data/raw/                   # planilhas brutas da SSP-SP (NÃO versionar)
│   └── data/processed/             # saída limpa do ETL (NÃO versionar)
└── infra/                          # banco de dados (Docker)
    ├── docker-compose.yml          # serviço PostGIS (postgis/postgis:16-3.4)
    ├── .env.example                # modelo de credenciais (.env real NÃO versionado)
    └── initdb/01_schema.sql        # esquema da tabela "ocorrencias"
```

Pastas futuras (ainda não criadas): `api/` (backend Node), `web/` (frontend React).

## Como rodar (resumo)

```bash
# 1) Banco de dados (a partir de infra/, com Docker Desktop aberto)
docker compose up -d            # liga o PostGIS;  down = desliga (dados persistem)

# 2) Pipeline de dados (a partir de etl/)
npm run etl                     # limpa as planilhas de data/raw -> data/processed
npm run load                    # carrega o CSV limpo no banco (tabela ocorrencias)
npm run municipios              # baixa a malha do IBGE -> tabela municipios
npm run centroides              # preenche centroides de bairro (OSM) nas ocorrencias
```

## Convenções de trabalho (IMPORTANTES)

- **Idioma:** todo código, comentário e documentação em **português**.
- **Nível do usuário:** só conhece **C básico**. Portanto:
  - Comentar o código de forma **abundante e didática**, explicando conceitos de
    JavaScript/TypeScript/Node que não existem em C (imports, `async/await`, tipos,
    `Promise`, módulos, etc.) na primeira vez que aparecem.
  - Preferir clareza a "esperteza"; evitar one-liners obscuros.
- **Dados:** nunca versionar `etl/data/raw/` nem `.env` (contêm dados oficiais
  grandes e/ou senhas).
- **Restrição do projeto:** manter sempre a abordagem **estatística/neutra** — nunca
  introduzir análise política/social.

## Fase atual

Backend de dados **funcionando**:
- ✅ ETL de limpeza das 9 planilhas semestrais (Jan/2022–Abr/2026) →
  `ocorrencias_limpas.csv` (**5.168.102 linhas**).
- ✅ Banco **PostGIS** no Docker, com a tabela `ocorrencias` carregada e indexada
  (índice GIST espacial). ~3,7 milhões de linhas com coordenada exata.
- ✅ Tabela `municipios` (malha do IBGE, 645 polígonos) para centroide de cidade e
  para a ferramenta de buffer.
- ✅ Centroides de **bairro** preenchidos via **OpenStreetMap** (Overpass + match
  exato/fuzzy). Geolocalização total: **87,7%** (SJC: **91%**). O que não casou
  fica **sem coordenada** (oculto no mapa) — nunca jogamos no centroide da cidade.

**Próximos passos:** (1) **API** (backend Node) com os filtros/consultas espaciais;
(2) **frontend** (React + OpenLayers): heatmap, time slider, filtros, buffer.
Reforços opcionais de cobertura de bairro: `admin_level=10` do OSM, fallback
Nominatim para faltantes de alto volume.

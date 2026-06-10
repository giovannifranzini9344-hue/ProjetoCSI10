# Projeto CSI-10 — Visualizador Georreferenciado de Segurança Pública

Aplicação web de **SIG** para analisar, de forma **estatística**, a evolução
espaço-temporal das ocorrências criminais no Estado de São Paulo (com foco de
contingência em São José dos Campos), a partir dos dados abertos da **SSP-SP**
(Jan/2022 a Abr/2026, ~5,17 milhões de registros).

> Disciplina **CSI-10 — Fundamentos de Sistemas de Informação Geográfica (ITA)**
> · Equipe: dupla · Entrega: **02/07/2026**.

📄 Especificação completa: [`docs/ESPECIFICACAO-TECNICA.md`](docs/ESPECIFICACAO-TECNICA.md)
· Decisões tomadas na construção: [`docs/DECISOES-AUTONOMAS.md`](docs/DECISOES-AUTONOMAS.md)

## Arquitetura (Web GIS de 3 Camadas)

```
 Navegador ── React + OpenLayers (web/)  ──HTTP──▶  API Fastify (api/)  ──SQL──▶  PostgreSQL + PostGIS (infra/)
   mapa, heatmap, time slider, filtros        filtros e consultas espaciais        dados + cálculos geográficos
```

| Camada | Pasta | Tecnologia |
|---|---|---|
| Frontend | `web/` | React + TypeScript + **OpenLayers** + Vite |
| Backend/API | `api/` | **Fastify** + `pg` |
| Banco | `infra/` | PostgreSQL + **PostGIS** (Docker) |
| ETL / dados | `etl/` | Node.js + TypeScript |

## Pré-requisitos

Node.js 18+ · Docker Desktop · (Git). Já instalados nesta máquina.

## Como rodar localmente (fluxo de desenvolvimento — testado)

São 3 peças. Abra um terminal para cada (ou rode em segundo plano).

```bash
# 1) Banco de dados (a partir de infra/)
cd infra
cp .env.example .env          # ajuste a senha se quiser (só na 1ª vez)
docker compose up -d          # sobe o PostGIS

# 2) Popular o banco (a partir de etl/) — só na 1ª vez, ou ao trocar os dados
cd ../etl
npm install
# coloque as planilhas da SSP-SP em etl/data/raw/ (ver docs)
npm run etl                   # limpa as planilhas -> ocorrencias_limpas.csv
npm run load                  # carrega no banco (tabela ocorrencias)
npm run municipios            # malha do IBGE -> tabela municipios
npm run centroides            # centroides de bairro (OSM) -> preenche ocorrencias

# 3) API (a partir de api/)
cd ../api
npm install
npm run dev                   # API em http://localhost:3001

# 4) Frontend (a partir de web/)
cd ../web
npm install
npm run dev                   # app em http://localhost:5173
```

Abra **http://localhost:5173**.

## Como rodar tudo em containers (full Docker)

Útil para validar a stack como ela irá para produção. Ver instruções no topo de
[`docker-compose.full.yml`](docker-compose.full.yml). Resumo:

```bash
docker compose -f docker-compose.full.yml --env-file infra/.env up -d db
# (popular o banco uma vez, como no passo 2 acima)
docker compose -f docker-compose.full.yml --env-file infra/.env up -d --build api web
# -> http://localhost:8080
```

## Deploy em nuvem

As imagens (`api/Dockerfile`, `web/Dockerfile`) estão prontas. O deploy em si é
feito nas **suas contas**: banco em Supabase/Neon (Postgres+PostGIS), API em
Render/Railway, frontend em Vercel/Netlify. (Esta etapa exige criar contas, por
isso não é automatizada.)

## Estrutura

```
ProjetoCSI10/
├── docs/      # especificação técnica + diário de decisões
├── etl/       # extração, limpeza, carga e enriquecimento dos dados
├── infra/     # banco PostGIS (docker-compose, esquema)
├── api/       # API Fastify (camada de lógica)
├── web/       # frontend React + OpenLayers
└── docker-compose.full.yml  # stack completa em containers
```

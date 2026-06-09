# Projeto CSI-10 — Visualizador Georreferenciado de Segurança Pública

Aplicação web de **SIG** para analisar, de forma **estatística**, a evolução
espaço-temporal das manchas criminais no Estado de São Paulo (com recorte de
contingência em São José dos Campos), a partir dos dados abertos da **SSP-SP**.

> Disciplina **CSI-10 — Fundamentos de Sistemas de Informação Geográfica (ITA)**
> · Equipe: dupla · Entrega: **02/07/2026**.

📄 **Especificação completa:** [`docs/ESPECIFICACAO-TECNICA.md`](docs/ESPECIFICACAO-TECNICA.md)

## Arquitetura (Web GIS de 3 Camadas)

| Camada | Tecnologia |
|---|---|
| Frontend | React + TypeScript + OpenLayers |
| Backend/API | Node.js (Express/Fastify) |
| Banco de dados | PostgreSQL + PostGIS |
| Infraestrutura | Docker |

## Pré-requisitos (já instalados nesta máquina)

- Node.js `v24.16` + npm `11.13`
- Git `2.54`
- Docker `29.5`

## Como rodar o ETL (etapa atual)

```bash
cd etl
npm install        # instala as dependências (só na primeira vez)
npm run etl        # roda o verificador de ambiente / o ETL
```

1. Coloque as planilhas `.xlsx`/`.csv` da SSP-SP em **`etl/data/raw/`**.
2. Rode `npm run etl`. A saída limpa será gravada em `etl/data/processed/`.

## Estrutura

```
ProjetoCSI10/
├── docs/      # documentação e especificação
└── etl/       # script de extração/transformação/carga dos dados da SSP-SP
```

Pastas futuras: `api/` (backend), `web/` (frontend), `infra/` (Docker/PostGIS).

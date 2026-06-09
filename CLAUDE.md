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
- **ETL:** Node.js + TypeScript (`xlsx`, `pg`, `dotenv`).

## Estrutura do repositório

```
ProjetoCSI10/
├── CLAUDE.md                       # este arquivo
├── README.md                       # visão geral para humanos
├── docs/
│   └── ESPECIFICACAO-TECNICA.md    # DET — fonte da verdade do escopo
└── etl/                            # script de ETL (etapa atual)
    ├── src/index.ts                # ponto de entrada do ETL
    ├── data/raw/                   # planilhas brutas da SSP-SP (NÃO versionar)
    └── data/processed/             # saída limpa do ETL
```

Pastas futuras (ainda não criadas): `api/` (backend Node), `web/` (frontend React),
`infra/` (docker-compose com PostGIS).

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

Início da implementação: ambiente montado, **escrevendo o ETL**. Próximo passo
depende de receber as planilhas da SSP-SP em `etl/data/raw/`. A modelagem do
PostGIS/Docker está **em espera** por decisão da equipe.

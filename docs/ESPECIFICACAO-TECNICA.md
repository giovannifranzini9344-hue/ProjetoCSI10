# Documento de Especificação Técnica (DET)

**Projeto:** Visualizador Georreferenciado de Dados de Segurança Pública
**Disciplina:** CSI-10 — Fundamentos de Sistemas de Informação Geográfica (ITA)
**Equipe:** dupla
**Entrega avaliativa:** semana 16 — **02/07/2026**
**Status:** especificação fechada; início da fase de implementação (ETL).

> Este documento consolida todas as decisões tomadas no planejamento do projeto.
> É a fonte da verdade do escopo — o relatório final deve nascer praticamente
> escrito a partir daqui. A seção [Registro de Decisões](#9-registro-de-decisões)
> guarda o "porquê" de cada escolha.

---

## 1. Visão Geral e Motivação

Desenvolver uma **aplicação web interativa de SIG** voltada para a **análise
estatística** de dados oficiais de segurança pública.

- **Área de aplicação:** Segurança Pública.
- **Motivação (a "grande pergunta" do mapa):** analisar a **dinâmica espacial e a
  evolução temporal das manchas criminais** no Estado de São Paulo (com plano de
  contingência focado em **São José dos Campos — SJC**), permitindo visualizar
  tendências e o possível deslocamento da criminalidade ao longo dos anos.
- **Restrição metodológica obrigatória:** abordagem **estritamente estatística**,
  para respeitar a regra do CSI-10 de não abordar temas polêmicos. O foco é o
  dado e o padrão espacial, nunca o juízo político/social.

---

## 2. Arquitetura do Sistema — Web GIS de 3 Camadas (3-Tier)

Padrão escolhido: **Web GIS de 3 Camadas**. (DDD foi descartado por ser excessivo
para um projeto acadêmico de ~1 mês feito por 2 pessoas.)

| Camada | Tecnologia | Responsabilidade |
|---|---|---|
| **Apresentação (Frontend)** | React + TypeScript + **OpenLayers** | Renderizar o mapa interativo, capturar filtros e cliques. Só exibe e coleta interação. |
| **Lógica (Backend/API)** | **Node.js** (Express ou Fastify) | Microsserviço "ponte": recebe os filtros do frontend e traduz em consultas geométricas no banco. |
| **Dados (Database)** | **PostgreSQL + PostGIS** | Armazenar os dados e executar operações espaciais de alta performance (interseção, buffer, índices espaciais). |
| **Infraestrutura** | **Docker** | Conteinerizar banco + API para garantir reprodutibilidade e facilitar a documentação exata de versões exigida no relatório. |

**Sistemas de referência (CRS):** dados em **EPSG:4326** (Lat/Lon, GPS) são
projetados para **EPSG:3857** (Web Mercator) para casar com o mapa-base.

---

## 3. Especificação de Dados e Processo de ETL

- **Natureza dos dados:** estáticos (base "congelada" que atende ao trabalho).
- **Recorte temporal:** **Janeiro/2022 a Abril/2026**.
- **Volume estimado:** ~600 mil registros por semestre → **~6 milhões de registros**
  considerando o estado inteiro no período.
- **Fonte:** planilhas oficiais de ocorrências criminais (`.xlsx` / `.csv`) do
  portal de Dados Abertos da **SSP-SP**.

### 3.1. Colunas mantidas após a limpeza

Todas as demais colunas são **descartadas** no ETL.

| Coluna | Uso no sistema |
|---|---|
| `LATITUDE` | Geometria do ponto |
| `LONGITUDE` | Geometria do ponto |
| `NOME_MUNICIPIO` | Filtro espacial + ferramenta de buffer |
| `ANO_ESTATISTICA` | Controle temporal (Time Slider) |
| `MES_ESTATISTICA` | Controle temporal (Time Slider) |
| `NATUREZA_APURADA` | Tipo de crime → colorização no mapa |
| `BAIRRO` | Inferência do centroide quando falta lat/long |
| `LOGRADOURO` | Detectar a flag `VEDAÇÃO DA DIVULGAÇÃO...` |
| `NOME_DELEGACIA` | Contexto extra exibido no popup |

**Descartadas explicitamente:**
- `DATA_OCORRENCIA_BO` → usamos apenas **mês/ano da estatística oficial** (o Time
  Slider pula de mês em mês; a data exata do B.O. tem erros de digitação e furos
  cronológicos).
- `RUBRICA` → é apenas uma especificação/ratificação de `NATUREZA_APURADA`;
  ficamos só com a natureza, por ser mais geral.

### 3.2. Conversão de tipos

- `LATITUDE` / `LONGITUDE` → forçar conversão para `float`.
- `ANO_ESTATISTICA` / `MES_ESTATISTICA` → inteiros.
- Demais → strings normalizadas (trim, caixa consistente).

### 3.3. Tratamento de anomalias e sigilo (regras críticas)

Anomalias **confirmadas na base real** (9 arquivos semestrais, **5.168.102 linhas**):

- **Codificação mista entre os arquivos:** 2022 vem em **Latin1/ANSI**; 2023–2026 em
  **UTF-8 (com BOM)**. → o ETL detecta a codificação de cada arquivo automaticamente.
- **Cabeçalhos divergentes por ano:** a coluna da cidade chama-se `CIDADE` em 2022 e
  `NOME_MUNICIPIO` de 2023 em diante (2025/2026 ganham `DESCR_TIPOLOCAL`). → o ETL
  casa colunas **pelo nome**, com apelido `NOME_MUNICIPIO`/`CIDADE`. As colunas que
  importam (`LATITUDE`, `BAIRRO`, `NATUREZA_APURADA`...) têm o mesmo nome em todos.
- **Linhas desalinhadas:** campos com `;` ou aspas embutidos quebram um split ingênuo.
  → usamos a biblioteca `csv-parse` (entende aspas; 0 linhas perdidas por erro).
- **Tipagem mista nas coordenadas:** vírgula decimal, traço `-`, valor `0` ou vazio. →
  converter para `float` (vírgula→ponto); se inválido, acionar a regra de centroide.
- **`VEDAÇÃO DA DIVULGAÇÃO DOS DADOS RELATIVOS`** no `LOGRADOURO` (lat/long `0`) —
  restrição legal de sigilo. Tratado como coordenada inválida.
- **Delegacia Eletrônica:** endereço presente, mas coordenadas com `-`.
- **Variações de grafia nas naturezas** (`TRÁFICO` vs `TRAFICO`, hífens) → unificadas
  numa categoria canônica (MAIÚSCULAS, sem acento/pontuação): **24 categorias**.
- **Ausência de horário exato** (`HORA_OCORRENCIA_BO` nula) → confirma o Time Slider
  por **Mês/Ano**, não por hora/dia.

**Distribuição real após o ETL:** `EXATA` **71,7%** · `CENTROIDE_BAIRRO` **27,9%**
(~1,44 milhão) · `CENTROIDE_CIDADE` **0,3%** (~17 mil).

#### Regra final de geolocalização — coluna `precisao_geo`

| Situação da linha | Tag (`precisao_geo`) | Onde é plotado | Visibilidade no mapa |
|---|---|---|---|
| **Lat/long válida** | `EXATA` (sem alerta) | coordenadas reais | **sempre visível** |
| **Lat/long inválida + COM bairro** | `localização imprecisa, registrado no centroide do bairro` | centroide do **bairro** | **oculto por padrão** (toggle) |
| **Lat/long inválida + SEM bairro** | `localização imprecisa, registrado no centroide da cidade` | centroide do **município** | **oculto por padrão** (toggle) |

- Os dados ocultos (casos 2 e 3) ficam atrelados ao botão **"Incluir Ocorrências
  sem Local Exato"** (desligado por padrão, para não criar "falsos hotspots" no
  mapa de calor).
- **Importante:** mesmo ocultos no mapa, eles **sempre contam** nos números e
  gráficos da interface — nunca subnotificamos o volume real de crimes.
- A tag "registro virtual" foi **eliminada** para simplificar a lógica.

> ⚠️ **Pendência de implementação:** precisamos de uma fonte de **centroides de
> bairro** e de **centroides de município** (ex.: IBGE para municípios; para
> bairros, malha de SP/IBGE ou base municipal). A definir antes de codar os casos
> 2 e 3.

---

## 4. Especificações da Interface (Frontend)

### 4.1. Visualização inicial e renderização

- **Estado inicial:** mapa do **Estado de SP inteiro**, todos os tipos de crime do
  ano-base **2026**, renderizado como **Heatmap (Mapa de Calor)** devido à altíssima
  densidade.
- **Transição dinâmica:** ao afunilar a busca (selecionar município ou um tipo de
  crime), o Heatmap dá lugar a **pontos vetoriais** individuais; em áreas densas
  usa-se **Clustering** (`ol/source/Cluster`).

### 4.2. Colorização por "famílias de cores"

- Crimes **parecidos** → tons da **mesma cor base**
  (ex.: Furto-Outros = verde escuro; Furto de Carga = verde claro;
  Furto de Veículo = verde neon).
- Crimes **muito diferentes** (Estupro / Homicídio / Roubo) → **famílias de cores
  completamente distintas**, para contraste visual imediato.

### 4.3. Controles e filtros

- **Seletor de Município:** **checkboxes** — seleção múltipla, individual, ou
  "Selecionar Tudo" (estado inteiro).
- **Seletor de Natureza Criminal:** **checkboxes** — isolar tipos/categorias.
- **Toggle "Incluir Ocorrências sem Local Exato":** **desligado por padrão**;
  controla a exibição das ocorrências com tag de centroide (bairro/cidade).

### 4.4. Controle temporal (Time Slider)

- Barra inferior estilo **Windy**: arraste manual + botão **Play/Pause**.
- **Intervalo:** Jan/2022 → Abr/2026.
- **Modos:**
  - **Atual:** o mapa limpa a cada transição, exibindo só o período focado.
  - **Acumulado:** o mapa preserva os períodos anteriores e sobrepõe os novos,
    mostrando o adensamento histórico das manchas.

### 4.5. Interatividade (Popups)

- Clique num ponto vetorial → componente **Overlay** (balão HTML sobre o mapa) com:
  **Mês/Ano**, **Natureza Criminal** e o **status de precisão** (endereço exato vs.
  aproximação de bairro/delegacia).

---

## 5. Ferramenta de Análise Espacial — Buffer Dinâmico

- Para **qualquer município (ou grupo)** selecionado, o usuário pode habilitar um
  **Buffer Externo** com **amplitude configurável** (ex.: 5 km, 15 km).
- É um buffer **apenas externo** (o interior do limite já está contemplado).
- Operacionalizado no PostGIS com **`ST_Buffer`** (expandir a fronteira) +
  **`ST_Intersects`** (reter só as ocorrências dentro da geometria expandida).
- Objetivo analítico: observar o comportamento criminal nas zonas vizinhas / rotas
  de fuga imediatas (ex.: região metropolitana de SJC).

---

## 6. Estratégia de Renderização em Escala e Plano de Contingência

- **Não usar GeoJSON para o estado inteiro:** transmitir milhões de pontos num
  único arquivo de texto trava o navegador. Para o escopo estadual, adotar
  **Vector Tiles (MVT)** — o OpenLayers tem suporte nativo; o mapa pede "ladrilhos"
  contendo só a geometria necessária para cada zoom (ex.: microsserviço
  `pg_tileserv` sobre o PostGIS).
- **Gatilho de contingência:** se a performance comprometer ou o prazo apertar,
  **restringir o escopo** para SJC.
- **Operação de recorte:** `ST_Buffer` no limite municipal de SJC expandindo em
  **15 km** + `ST_Intersects` para reter só o que está dentro — garante a análise
  da cidade e de suas conexões metropolitanas.

---

## 7. Entregáveis (semana 16 — 02/07/2026)

1. **Relatório (mídia digital, PDF — `NomeApp_Relatorio.pdf`):** especificação da
   área, motivação, descritivo da interface, declaração da restrição
   técnica/estatística, declaração de eventual uso de IA, e **versionamento exato**
   de todas as ferramentas (Node, React, OpenLayers, PostgreSQL/PostGIS, etc.).
2. **Vídeo de demonstração:** gravação operando o Time Slider, as ferramentas de
   buffer, os filtros via checkbox e o detalhamento dos metadados geográficos.

---

## 8. Ferramentas de Gestão e Desenvolvimento

- **Notion:** esqueleto e redação do relatório teórico.
- **Trello (Kanban):** quebra das tarefas de desenvolvimento até a semana 16.
- **Git:** controle de versão do código.
- **Docker Desktop:** banco PostGIS + API conteinerizados.
- **VS Code:** IDE.
- **Node.js (LTS) + npm:** runtime e gerenciador de pacotes.

Bibliotecas previstas (instaladas via npm conforme a etapa):
`xlsx` (ler planilhas) · `pg` (conector PostgreSQL) · `dotenv` (variáveis de
ambiente) · `typescript` / `ts-node` / `@types/*` (tipagem e execução).

---

## 9. Registro de Decisões

Histórico do "porquê" de cada escolha (atualizar conforme o projeto evolui):

- **Foco em ocorrências criminais** (em vez de Bombeiros ou SPVida/letalidade):
  gera maior impacto visual e é o clássico de geoprocessamento para evolução
  espaço-temporal. (Bombeiros teria melhor precisão georreferencial, mas o tema
  criminal foi o escolhido.)
- **Web GIS 3 camadas, não DDD:** DDD é "canhão para matar mosquito" num projeto
  acadêmico curto.
- **Vector Tiles para o estado todo:** GeoJSON de 6M de pontos inviabiliza o
  navegador; o gargalo é renderização, não armazenamento.
- **Descartar `DATA_OCORRENCIA_BO`:** o Time Slider é por mês/ano; a data do B.O.
  tem erros. Usar mês/ano da estatística oficial alinha a régua de tempo com os
  relatórios oficiais da SSP.
- **Descartar `RUBRICA`:** redundante com `NATUREZA_APURADA` (é só
  especificação/ratificação); manter só a natureza por ser mais geral.
- **Unificar anomalias em centroides + toggle desligado:** equilibra transparência
  estatística (nenhum dado é descartado dos números) com integridade visual do
  mapa de calor (sem falsos hotspots sem o consentimento do usuário).
- **Buffer como ferramenta geral** (não só plano B de SJC): eleva o nível técnico —
  análise espacial dinâmica para qualquer município.

---

## 10. Estado da Implementação

✅ **Concluído:**
- Escopo, arquitetura e especificação (este DET); decisões de UX.
- **ETL** (`etl/src/index.ts`): limpa as 9 planilhas semestrais →
  `ocorrencias_limpas.csv` (**5.168.102 linhas**).
- **Banco PostGIS** no Docker (`infra/`). Tabela **`ocorrencias`** carregada via
  `COPY` (`etl/src/load.ts`), com coluna `geom` (Point/4326) gerada de lat/long e
  índices (GIST espacial + ano/mês + natureza + município).
- Tabela **`municipios`** (`etl/src/municipios.ts`): malha do IBGE (645 polígonos)
  com centroide por cidade — base do centroide de cidade e da ferramenta de buffer.

### Esquema do banco (resumo)

- `ocorrencias(id, municipio, ano, mes, natureza, bairro, delegacia, latitude,
  longitude, precisao_geo, geom geometry(Point,4326))`
- `municipios(cod_ibge, nome, nome_norm, geom geometry(MultiPolygon,4326), centroide)`

🔜 **Próximos passos:**
1. Preencher os **centroides de bairro** das ~28% de linhas `CENTROIDE_BAIRRO`
   (depende da fonte de coordenadas de bairro — **em pesquisa pela equipe**).
2. **API** (backend Node.js) expondo os filtros/consultas espaciais.
3. **Frontend** (React + OpenLayers): heatmap, time slider, filtros, buffer.
4. Deploy, relatório e vídeo.

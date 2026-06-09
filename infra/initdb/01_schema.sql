-- ============================================================================
--  PROJETO CSI-10 - Esquema do banco de dados (PostgreSQL + PostGIS)
--
--  Este arquivo e executado:
--   (a) automaticamente, na 1a vez que o container do banco sobe; e
--   (b) de forma defensiva, pelo script de carga (etl/src/load.ts).
--  Por isso tudo aqui e "idempotente": pode rodar varias vezes sem dar erro.
-- ============================================================================

-- Liga as funcoes geograficas do PostGIS (tipos de geometria, indices espaciais,
-- ST_Buffer, ST_Intersects, etc.). "IF NOT EXISTS" = nao reclama se ja existir.
CREATE EXTENSION IF NOT EXISTS postgis;

-- Tabela principal: uma linha por ocorrencia criminal ja higienizada.
CREATE TABLE IF NOT EXISTS ocorrencias (
  id            bigserial PRIMARY KEY,     -- numero sequencial automatico
  municipio     text,
  ano           smallint,
  mes           smallint,
  natureza      text,                      -- categoria canonica do crime
  bairro        text,
  delegacia     text,
  latitude      double precision,          -- NULL quando a coordenada e inferida
  longitude     double precision,          -- NULL quando a coordenada e inferida
  precisao_geo  text,                      -- EXATA | CENTROIDE_BAIRRO | CENTROIDE_CIDADE

  -- Coluna geografica GERADA automaticamente a partir de latitude/longitude.
  -- - SRID 4326 = sistema de coordenadas padrao do GPS (graus de lat/long).
  -- - ST_MakePoint(long, lat): repare que em PostGIS a ORDEM e (X=long, Y=lat).
  -- - Fica NULL quando nao ha coordenada (essas linhas serao tratadas depois,
  --   quando preenchermos os centroides de bairro/cidade).
  geom geometry(Point, 4326) GENERATED ALWAYS AS (
    CASE
      WHEN latitude IS NOT NULL AND longitude IS NOT NULL
      THEN ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)
    END
  ) STORED
);

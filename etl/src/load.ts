/**
 * ============================================================================
 *  PROJETO CSI-10 — Carga (o "L" de ETL: Load)
 *  Le o arquivo limpo (ocorrencias_limpas.csv) e insere no banco PostGIS.
 * ============================================================================
 *
 *  PRE-REQUISITOS:
 *   1) O banco precisa estar de pe (na pasta "infra": docker compose up -d).
 *   2) O arquivo limpo precisa existir (rode "npm run etl" antes).
 *
 *  COMO RODAR (dentro da pasta "etl"):
 *      npm run load
 *
 *  COMO FUNCIONA:
 *   Usamos o comando COPY do PostgreSQL — a forma MAIS RAPIDA de inserir
 *   milhoes de linhas. Em vez de mandar 5 milhoes de INSERTs (lentissimo),
 *   "despejamos" o CSV inteiro de uma vez, em fluxo (streaming).
 *
 *  NOTA PARA QUEM VEM DO C:
 *   - "await client.query(...)" envia um comando SQL e espera a resposta.
 *   - "pipeline(origem, destino)" liga dois canos: le do arquivo e joga no COPY.
 * ============================================================================
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { pipeline } from "node:stream/promises";
import * as dotenv from "dotenv";
import { Client } from "pg";
import { from as copyFrom } from "pg-copy-streams";

// As credenciais do banco ficam em infra/.env (o mesmo arquivo do docker-compose).
dotenv.config({ path: path.resolve(__dirname, "..", "..", "infra", ".env") });

const CSV = path.resolve(__dirname, "..", "data", "processed", "ocorrencias_limpas.csv");
const SCHEMA_SQL = path.resolve(__dirname, "..", "..", "infra", "initdb", "01_schema.sql");

// Os indices que vamos (re)criar depois da carga, para o mapa filtrar rapido.
const INDICES: Record<string, string> = {
  idx_ocorrencias_geom:      "CREATE INDEX idx_ocorrencias_geom ON ocorrencias USING GIST (geom)",
  idx_ocorrencias_ano_mes:   "CREATE INDEX idx_ocorrencias_ano_mes ON ocorrencias (ano, mes)",
  idx_ocorrencias_natureza:  "CREATE INDEX idx_ocorrencias_natureza ON ocorrencias (natureza)",
  idx_ocorrencias_municipio: "CREATE INDEX idx_ocorrencias_municipio ON ocorrencias (municipio)",
};

async function main() {
  // Confere que o arquivo limpo existe antes de comecar.
  if (!fs.existsSync(CSV)) {
    console.error("Arquivo limpo nao encontrado:", CSV);
    console.error("Rode 'npm run etl' primeiro para gera-lo.");
    process.exit(1);
  }

  // Abre a conexao com o banco (dados vindos do infra/.env).
  const client = new Client({
    host: process.env.PGHOST || "localhost",
    port: Number(process.env.POSTGRES_PORT) || 5432,
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB,
  });
  await client.connect();
  console.log("Conectado ao banco:", process.env.POSTGRES_DB);

  // 1) Garante o esquema (cria a extensao e a tabela se ainda nao existirem).
  await client.query(fs.readFileSync(SCHEMA_SQL, "utf8"));

  // 2) Derruba os indices e esvazia a tabela -> carga mais rapida e repetivel.
  for (const nome of Object.keys(INDICES)) {
    await client.query(`DROP INDEX IF EXISTS ${nome}`);
  }
  await client.query("TRUNCATE ocorrencias RESTART IDENTITY");

  // 3) Carga em massa via COPY (le o CSV em fluxo e despeja no banco).
  console.log("Carregando o CSV via COPY (pode levar 1-2 minutos)...");
  const inicio = Date.now();
  const destino = client.query(copyFrom(
    `COPY ocorrencias (municipio, ano, mes, natureza, bairro, delegacia, latitude, longitude, precisao_geo)
     FROM STDIN WITH (FORMAT csv, HEADER true)`,
  ));
  await pipeline(fs.createReadStream(CSV), destino);
  console.log(`COPY concluido em ${((Date.now() - inicio) / 1000).toFixed(1)}s`);

  // 4) (Re)cria os indices DEPOIS da carga — bem mais rapido do que durante.
  console.log("Criando indices...");
  for (const sql of Object.values(INDICES)) {
    await client.query(sql);
  }
  await client.query("ANALYZE ocorrencias"); // atualiza as estatisticas do banco

  // 5) Verificacao final.
  const total = await client.query("SELECT count(*)::int AS n FROM ocorrencias");
  const comGeom = await client.query("SELECT count(*)::int AS n FROM ocorrencias WHERE geom IS NOT NULL");
  const sjc = await client.query(
    "SELECT count(*)::int AS n FROM ocorrencias WHERE municipio = 'S.JOSE DOS CAMPOS'",
  );
  console.log("\n===== CARGA CONCLUIDA =====");
  console.log("Linhas no banco       :", total.rows[0].n.toLocaleString());
  console.log("Com coordenada (geom) :", comGeom.rows[0].n.toLocaleString());
  console.log("Sao Jose dos Campos   :", sjc.rows[0].n.toLocaleString());

  await client.end();
}

main().catch((e) => { console.error("ERRO:", e); process.exit(1); });

/**
 * ============================================================================
 *  PROJETO CSI-10 — Preenchimento dos centroides de BAIRRO via OpenStreetMap
 * ============================================================================
 *  Objetivo: dar coordenada (centroide do bairro) as linhas marcadas como
 *  CENTROIDE_BAIRRO, usando os dados do OSM. O que nao casar fica SEM coordenada
 *  (oculto no mapa) — nunca jogamos no centro da cidade.
 *
 *  ETAPAS:
 *   1) Baixa todos os bairros do OSM no estado de SP (Overpass).
 *   2) Carrega na tabela bairros_osm e descobre o municipio de cada um (junção
 *      espacial com a tabela municipios do IBGE).
 *   3) Mapeia o municipio da SSP ("S.PAULO") -> codigo IBGE ("São Paulo").
 *   4) Casa a demanda (municipio,bairro) com o OSM: 1o exato, depois aproximado
 *      (fuzzy, com a extensao pg_trgm).
 *   5) Preenche latitude/longitude das ocorrencias que casaram.
 *   6) Relatorio de cobertura.
 *
 *  COMO RODAR (dentro de "etl", com o banco no ar):
 *      npm run centroides
 * ============================================================================
 */
import * as path from "node:path";
import * as dotenv from "dotenv";
import { Client } from "pg";

dotenv.config({ path: path.resolve(__dirname, "..", "..", "infra", ".env") });

// Normalizacao de nome de CIDADE em JS (para a "ponte" SSP -> IBGE).
const deacc = (s: string) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "");
const normCity = (s: string) =>
  deacc(s).toUpperCase().replace(/[^A-Z0-9]+/g, " ").replace(/\s+/g, " ").trim();

// Consulta Overpass: todos os bairros (place=suburb/neighbourhood/quarter) de SP.
const OVERPASS = "https://overpass-api.de/api/interpreter";
const QUERY = `
[out:json][timeout:300];
area["boundary"="administrative"]["admin_level"="4"]["name"="São Paulo"]->.sp;
( node["place"~"^(suburb|neighbourhood|quarter)$"](area.sp);
  way["place"~"^(suburb|neighbourhood|quarter)$"](area.sp); );
out center tags;`;

// Expressao SQL que normaliza um texto igual ao normCity (usa a extensao unaccent).
const SQL_NORM = (col: string) =>
  `btrim(regexp_replace(regexp_replace(upper(unaccent(${col})),'[^A-Z0-9]+',' ','g'),'\\s+',' ','g'))`;

// Limiar de similaridade do match aproximado (0..1). Acima de ~0.6 evita casar
// bairros diferentes que so compartilham palavras comuns ("Jardim", "Residencial").
const FUZZY_MIN = Number(process.env.FUZZY_MIN) || 0.6;

async function main() {
  const cli = new Client({
    host: process.env.PGHOST || "localhost",
    port: Number(process.env.POSTGRES_PORT) || 5432,
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB,
  });
  await cli.connect();
  const q = (sql: string, p?: any[]) => cli.query(sql, p);

  await q("CREATE EXTENSION IF NOT EXISTS pg_trgm");   // similaridade de texto (fuzzy)
  await q("CREATE EXTENSION IF NOT EXISTS unaccent");  // remover acentos no SQL

  // ----- 1) Baixa bairros do OSM -----
  console.log("1/6  Baixando bairros do OSM (Overpass)...");
  const r = await fetch(OVERPASS, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "CSI10-ITA-academic/1.0" },
    body: "data=" + encodeURIComponent(QUERY),
  });
  if (!r.ok) throw new Error("Overpass HTTP " + r.status);
  const geo: any = await r.json();
  const feats = geo.elements
    .filter((e: any) => e.tags && e.tags.name)
    .map((e: any) => ({ nome: e.tags.name, lat: e.lat ?? e.center?.lat, lon: e.lon ?? e.center?.lon }))
    .filter((f: any) => Number.isFinite(f.lat) && Number.isFinite(f.lon));
  console.log("    ", feats.length, "bairros com coordenada");

  // ----- 2) Carrega na tabela bairros_osm + junção espacial com municipios -----
  console.log("2/6  Carregando e atribuindo municipio (junção espacial)...");
  await q("DROP TABLE IF EXISTS bairros_osm");
  await q(`CREATE TABLE bairros_osm (
            nome text, bairro_norm text, lat double precision, lon double precision,
            geom geometry(Point,4326), cod_ibge integer)`);
  // Insere tudo de uma vez usando arrays (unnest) — bem mais rapido que 1 a 1.
  await q(
    `INSERT INTO bairros_osm (nome, lat, lon, geom)
     SELECT n, la, lo, ST_SetSRID(ST_MakePoint(lo, la), 4326)
     FROM unnest($1::text[], $2::float8[], $3::float8[]) AS t(n, la, lo)`,
    [feats.map((f: any) => f.nome), feats.map((f: any) => f.lat), feats.map((f: any) => f.lon)],
  );
  await q(`UPDATE bairros_osm SET bairro_norm = ${SQL_NORM("nome")}`);
  // Cada ponto recebe o municipio cujo poligono o contem.
  await q(`UPDATE bairros_osm b SET cod_ibge = m.cod_ibge FROM municipios m WHERE ST_Contains(m.geom, b.geom)`);

  // Agrega para 1 centroide por (municipio, bairro) — media dos pontos homonimos.
  await q("DROP TABLE IF EXISTS bairros_osm_agg");
  await q(`CREATE TABLE bairros_osm_agg AS
           SELECT cod_ibge, bairro_norm, avg(lat) AS lat, avg(lon) AS lon
           FROM bairros_osm WHERE cod_ibge IS NOT NULL
           GROUP BY cod_ibge, bairro_norm`);
  await q("CREATE INDEX ON bairros_osm_agg (cod_ibge, bairro_norm)");
  await q("CREATE INDEX ON bairros_osm_agg USING gin (bairro_norm gin_trgm_ops)");

  // ----- 3) Ponte: municipio da SSP -> codigo IBGE -----
  console.log("3/6  Mapeando municipios da SSP -> IBGE...");
  const ibge = (await q("SELECT cod_ibge, nome FROM municipios")).rows;
  const keyToCod = new Map<string, number>();
  for (const m of ibge) keyToCod.set(normCity(m.nome), m.cod_ibge);
  const bridge = (mun: string): number | null => {
    const t = normCity(mun).split(" ");
    let cands: string[] = [];
    if (t[0] === "S") cands = ["SAO", "SANTO", "SANTA"].map((p) => [p, ...t.slice(1)].join(" "));
    else if (t[0] === "STO") cands = [["SANTO", ...t.slice(1)].join(" ")];
    else if (t[0] === "STA") cands = [["SANTA", ...t.slice(1)].join(" ")];
    for (const c of cands) if (keyToCod.has(c)) return keyToCod.get(c)!;
    return keyToCod.get(t.join(" ")) ?? null;
  };
  const sspMun = (await q("SELECT DISTINCT municipio FROM ocorrencias WHERE precisao_geo='CENTROIDE_BAIRRO'")).rows;
  const muns = sspMun.map((x: any) => x.municipio);
  const cods = muns.map((m: string) => bridge(m));
  await q("DROP TABLE IF EXISTS municipio_ssp_map");
  await q("CREATE TABLE municipio_ssp_map (ssp_municipio text PRIMARY KEY, cod_ibge integer)");
  await q(
    `INSERT INTO municipio_ssp_map (ssp_municipio, cod_ibge)
     SELECT m, c FROM unnest($1::text[], $2::int[]) AS t(m, c) ON CONFLICT DO NOTHING`,
    [muns, cods],
  );
  console.log("    municipios SSP sem correspondencia IBGE:", cods.filter((c) => c == null).length);

  // ----- 4) Demanda + casamento (exato e fuzzy) -----
  console.log("4/6  Casando bairros (exato + fuzzy)...");
  await q("DROP TABLE IF EXISTS demanda_centroide");
  await q(`CREATE TABLE demanda_centroide AS
           SELECT o.municipio, o.bairro, ${SQL_NORM("o.bairro")} AS bairro_norm,
                  msm.cod_ibge, count(*)::int AS n,
                  NULL::float8 AS lat, NULL::float8 AS lon, NULL::text AS fonte
           FROM ocorrencias o
           JOIN municipio_ssp_map msm ON msm.ssp_municipio = o.municipio
           WHERE o.precisao_geo='CENTROIDE_BAIRRO' AND msm.cod_ibge IS NOT NULL
           GROUP BY o.municipio, o.bairro, msm.cod_ibge`);
  await q("CREATE INDEX ON demanda_centroide (municipio, bairro)");

  // 4a) Exato: mesmo municipio e mesmo nome normalizado.
  await q(`UPDATE demanda_centroide d SET lat=a.lat, lon=a.lon, fonte='OSM_EXATO'
           FROM bairros_osm_agg a WHERE a.cod_ibge=d.cod_ibge AND a.bairro_norm=d.bairro_norm`);

  // 4b) Fuzzy: para o que sobrou, melhor similaridade (>= FUZZY_MIN) no mesmo municipio.
  console.log("     (limiar fuzzy =", FUZZY_MIN, ")");
  await q("SELECT set_limit($1::real)", [FUZZY_MIN]); // define o limiar do operador %
  await q(`UPDATE demanda_centroide d SET lat=s.lat, lon=s.lon, fonte='OSM_FUZZY'
           FROM (
             SELECT DISTINCT ON (d2.municipio, d2.bairro) d2.municipio, d2.bairro, a.lat, a.lon
             FROM demanda_centroide d2
             JOIN bairros_osm_agg a ON a.cod_ibge=d2.cod_ibge AND a.bairro_norm % d2.bairro_norm
             WHERE d2.fonte IS NULL
             ORDER BY d2.municipio, d2.bairro, similarity(a.bairro_norm, d2.bairro_norm) DESC
           ) s
           WHERE d.municipio=s.municipio AND d.bairro=s.bairro AND d.fonte IS NULL`);

  // ----- 5) Preenche as ocorrencias -----
  console.log("5/6  Preenchendo coordenadas nas ocorrencias...");
  await q("ALTER TABLE ocorrencias ADD COLUMN IF NOT EXISTS centroide_fonte text");
  // Zera preenchimentos anteriores (para o script poder rodar de novo do zero,
  // sem deixar coordenadas antigas de uma execucao com outro limiar).
  await q(`UPDATE ocorrencias SET latitude=NULL, longitude=NULL, centroide_fonte=NULL
           WHERE precisao_geo='CENTROIDE_BAIRRO' AND centroide_fonte IS NOT NULL`);
  const upd = await q(`UPDATE ocorrencias o
           SET latitude=d.lat, longitude=d.lon, centroide_fonte=d.fonte
           FROM demanda_centroide d
           WHERE o.precisao_geo='CENTROIDE_BAIRRO'
             AND o.municipio=d.municipio AND o.bairro=d.bairro AND d.lat IS NOT NULL`);
  console.log("    ocorrencias atualizadas:", (upd.rowCount ?? 0).toLocaleString());
  await q("ANALYZE ocorrencias");

  // ----- 6) Relatorio -----
  console.log("\n6/6  ===== COBERTURA =====");
  const fonte = (await q(`SELECT COALESCE(centroide_fonte,'(sem match)') f, count(*)::int n
                          FROM ocorrencias WHERE precisao_geo='CENTROIDE_BAIRRO' GROUP BY 1 ORDER BY 2 DESC`)).rows;
  const totBairro = fonte.reduce((a: number, x: any) => a + x.n, 0);
  console.log("Linhas CENTROIDE_BAIRRO:", totBairro.toLocaleString());
  for (const f of fonte) console.log(`   ${String(f.f).padEnd(12)} ${String(f.n).toLocaleString().padStart(10)}  (${(100 * f.n / totBairro).toFixed(1)}%)`);

  const geral = (await q(`SELECT count(*) FILTER (WHERE geom IS NOT NULL)::int com, count(*)::int tot FROM ocorrencias`)).rows[0];
  console.log(`\nTotal geolocalizado no banco: ${geral.com.toLocaleString()} / ${geral.tot.toLocaleString()} (${(100 * geral.com / geral.tot).toFixed(1)}%)`);

  const sjc = (await q(`SELECT count(*) FILTER (WHERE geom IS NOT NULL)::int com, count(*)::int tot
                        FROM ocorrencias WHERE municipio='S.JOSE DOS CAMPOS'`)).rows[0];
  console.log(`SJC geolocalizado: ${sjc.com.toLocaleString()} / ${sjc.tot.toLocaleString()} (${(100 * sjc.com / sjc.tot).toFixed(1)}%)`);

  await cli.end();
}

main().catch((e) => { console.error("ERRO:", e); process.exit(1); });

/**
 * ============================================================================
 *  PROJETO CSI-10 — Preenchimento dos centroides de BAIRRO
 * ============================================================================
 *  Da coordenada (centroide do bairro) as linhas marcadas como CENTROIDE_BAIRRO,
 *  usando uma "escada" de fontes, da mais confiavel para a menos:
 *    1) OSM exato  : nome do bairro identico (via Overpass).
 *    2) OSM fuzzy  : nome parecido (>= FUZZY_MIN), no mesmo municipio (pg_trgm).
 *    3) Nominatim  : geocodificacao, so para os faltantes de ALTO volume.
 *  O que nao casa em nenhuma fonte fica SEM coordenada (oculto no mapa). Nunca
 *  jogamos no centroide da cidade (evita falso hotspot).
 *
 *  COMO RODAR (dentro de "etl", com o banco no ar):
 *      npm run centroides
 *  Variaveis opcionais: FUZZY_MIN (0..1), NOMINATIM_MIN (volume), NOMINATIM_CAP.
 * ============================================================================
 */
import * as path from "node:path";
import * as dotenv from "dotenv";
import { Client } from "pg";

dotenv.config({ path: path.resolve(__dirname, "..", "..", "infra", ".env") });

const deacc = (s: string) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "");
const normCity = (s: string) =>
  deacc(s).toUpperCase().replace(/[^A-Z0-9]+/g, " ").replace(/\s+/g, " ").trim();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Limiar do match aproximado (0..1). 0.65 evita casar bairros diferentes que so
// compartilham palavras comuns ("Jardim", "Residencial"), mantendo os bons.
const FUZZY_MIN = Number(process.env.FUZZY_MIN) || 0.65;
// Fallback Nominatim: so para bairros faltantes com volume >= NOMINATIM_MIN,
// limitado a NOMINATIM_CAP buscas (politica do Nominatim: ~1 req/segundo).
const NOMINATIM_MIN = Number(process.env.NOMINATIM_MIN) || 80;
const NOMINATIM_CAP = process.env.NOMINATIM_CAP !== undefined ? Number(process.env.NOMINATIM_CAP) : 600;

const OVERPASS = "https://overpass-api.de/api/interpreter";
// Consulta ampliada: nos de bairro + localidades menores + limites admin 9/10.
const QUERY = `
[out:json][timeout:300];
area["boundary"="administrative"]["admin_level"="4"]["name"="São Paulo"]->.sp;
(
  node["place"~"^(suburb|neighbourhood|quarter|hamlet|locality|village)$"](area.sp);
  way["place"~"^(suburb|neighbourhood|quarter|hamlet|locality|village)$"](area.sp);
  relation["boundary"="administrative"]["admin_level"~"^(9|10)$"](area.sp);
  way["boundary"="administrative"]["admin_level"~"^(9|10)$"](area.sp);
);
out center tags;`;

// Expressao SQL que normaliza um texto (usa a extensao unaccent).
const SQL_NORM = (col: string) =>
  `btrim(regexp_replace(regexp_replace(upper(unaccent(${col})),'[^A-Z0-9]+',' ','g'),'\\s+',' ','g'))`;

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

  await q("CREATE EXTENSION IF NOT EXISTS pg_trgm");
  await q("CREATE EXTENSION IF NOT EXISTS unaccent");

  // ----- 1) Baixa bairros do OSM -----
  console.log("1/7  Baixando bairros do OSM (Overpass, consulta ampliada)...");
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
  console.log("    ", feats.length, "feicoes com coordenada");

  // ----- 2) Carrega + junção espacial com municipios -----
  console.log("2/7  Carregando e atribuindo municipio (junção espacial)...");
  await q("DROP TABLE IF EXISTS bairros_osm");
  await q(`CREATE TABLE bairros_osm (
            nome text, bairro_norm text, lat double precision, lon double precision,
            geom geometry(Point,4326), cod_ibge integer)`);
  await q(
    `INSERT INTO bairros_osm (nome, lat, lon, geom)
     SELECT n, la, lo, ST_SetSRID(ST_MakePoint(lo, la), 4326)
     FROM unnest($1::text[], $2::float8[], $3::float8[]) AS t(n, la, lo)`,
    [feats.map((f: any) => f.nome), feats.map((f: any) => f.lat), feats.map((f: any) => f.lon)],
  );
  await q(`UPDATE bairros_osm SET bairro_norm = ${SQL_NORM("nome")}`);
  await q(`UPDATE bairros_osm b SET cod_ibge = m.cod_ibge FROM municipios m WHERE ST_Contains(m.geom, b.geom)`);

  await q("DROP TABLE IF EXISTS bairros_osm_agg");
  await q(`CREATE TABLE bairros_osm_agg AS
           SELECT cod_ibge, bairro_norm, avg(lat) AS lat, avg(lon) AS lon
           FROM bairros_osm WHERE cod_ibge IS NOT NULL GROUP BY cod_ibge, bairro_norm`);
  await q("CREATE INDEX ON bairros_osm_agg (cod_ibge, bairro_norm)");
  await q("CREATE INDEX ON bairros_osm_agg USING gin (bairro_norm gin_trgm_ops)");

  // ----- 3) Ponte municipio SSP -> codigo IBGE -----
  console.log("3/7  Mapeando municipios da SSP -> IBGE...");
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

  // ----- 4) Demanda + match exato + fuzzy -----
  console.log("4/7  Casando bairros (exato + fuzzy >=", FUZZY_MIN, ")...");
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

  await q(`UPDATE demanda_centroide d SET lat=a.lat, lon=a.lon, fonte='OSM_EXATO'
           FROM bairros_osm_agg a WHERE a.cod_ibge=d.cod_ibge AND a.bairro_norm=d.bairro_norm`);

  await q("SELECT set_limit($1::real)", [FUZZY_MIN]);
  await q(`UPDATE demanda_centroide d SET lat=s.lat, lon=s.lon, fonte='OSM_FUZZY'
           FROM (
             SELECT DISTINCT ON (d2.municipio, d2.bairro) d2.municipio, d2.bairro, a.lat, a.lon
             FROM demanda_centroide d2
             JOIN bairros_osm_agg a ON a.cod_ibge=d2.cod_ibge AND a.bairro_norm % d2.bairro_norm
             WHERE d2.fonte IS NULL
             ORDER BY d2.municipio, d2.bairro, similarity(a.bairro_norm, d2.bairro_norm) DESC
           ) s WHERE d.municipio=s.municipio AND d.bairro=s.bairro AND d.fonte IS NULL`);

  // ----- 4c / 5) Fallback Nominatim para faltantes de alto volume -----
  if (NOMINATIM_CAP > 0) {
    const resid = (await q(
      `SELECT d.municipio, d.bairro, d.cod_ibge, d.n, m.nome AS mun
       FROM demanda_centroide d JOIN municipios m ON m.cod_ibge=d.cod_ibge
       WHERE d.fonte IS NULL AND d.n >= $1 ORDER BY d.n DESC LIMIT $2`,
      [NOMINATIM_MIN, NOMINATIM_CAP])).rows;
    console.log(`5/7  Fallback Nominatim em ${resid.length} bairros (>= ${NOMINATIM_MIN} ocorr., ~1/s)...`);
    const SUB = new Set(["suburb", "neighbourhood", "quarter", "city_district", "residential", "hamlet", "locality", "village"]);
    let hits = 0;
    for (const b of resid) {
      const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=3&q=${encodeURIComponent(b.bairro + ", " + b.mun + ", São Paulo, Brasil")}`;
      try {
        const res = await fetch(url, { headers: { "User-Agent": "CSI10-ITA-academic/1.0 (projeto academico ITA)" } });
        const arr: any[] = await res.json();
        for (const a of arr) {
          if (!SUB.has(a.addresstype)) continue;
          const lat = +a.lat, lon = +a.lon;
          // So aceita se o ponto cai DENTRO do poligono do municipio.
          const inside = (await q(
            `SELECT ST_Contains(geom, ST_SetSRID(ST_MakePoint($1,$2),4326)) AS ok FROM municipios WHERE cod_ibge=$3`,
            [lon, lat, b.cod_ibge])).rows[0]?.ok;
          if (inside) {
            await q(`UPDATE demanda_centroide SET lat=$1, lon=$2, fonte='NOMINATIM' WHERE municipio=$3 AND bairro=$4`,
              [lat, lon, b.municipio, b.bairro]);
            hits++;
            break;
          }
        }
      } catch { /* ignora falha pontual de rede */ }
      await sleep(1100);
    }
    console.log(`     Nominatim recuperou ${hits} bairros de alto volume.`);
  }

  // ----- 6) Preenche as ocorrencias -----
  console.log("6/7  Preenchendo coordenadas nas ocorrencias...");
  await q("ALTER TABLE ocorrencias ADD COLUMN IF NOT EXISTS centroide_fonte text");
  await q(`UPDATE ocorrencias SET latitude=NULL, longitude=NULL, centroide_fonte=NULL
           WHERE precisao_geo='CENTROIDE_BAIRRO' AND centroide_fonte IS NOT NULL`);
  const upd = await q(`UPDATE ocorrencias o
           SET latitude=d.lat, longitude=d.lon, centroide_fonte=d.fonte
           FROM demanda_centroide d
           WHERE o.precisao_geo='CENTROIDE_BAIRRO'
             AND o.municipio=d.municipio AND o.bairro=d.bairro AND d.lat IS NOT NULL`);
  console.log("    ocorrencias atualizadas:", (upd.rowCount ?? 0).toLocaleString());
  await q("ANALYZE ocorrencias");

  // ----- 7) Relatorio detalhado (para a documentacao) -----
  const tot = (await q("SELECT count(*)::int n FROM ocorrencias")).rows[0].n;
  const exata = (await q("SELECT count(*)::int n FROM ocorrencias WHERE precisao_geo='EXATA'")).rows[0].n;
  const cidade = (await q("SELECT count(*)::int n FROM ocorrencias WHERE precisao_geo='CENTROIDE_CIDADE'")).rows[0].n;
  const fr = (await q(`SELECT COALESCE(centroide_fonte,'SEM_COORD') f, count(*)::int n
                       FROM ocorrencias WHERE precisao_geo='CENTROIDE_BAIRRO' GROUP BY 1`)).rows;
  const get = (k: string) => Number(fr.find((x: any) => x.f === k)?.n || 0);
  const oExato = get("OSM_EXATO"), oFuzzy = get("OSM_FUZZY"), oNomi = get("NOMINATIM"), semB = get("SEM_COORD");
  const aprox = oExato + oFuzzy + oNomi;
  const semCoord = semB + cidade;
  const pc = (n: number) => (100 * n / tot).toFixed(1) + "%";

  console.log("\n7/7  ===== RELATORIO FINAL (cobertura geografica) =====");
  console.log(`Total de ocorrencias .................. ${tot.toLocaleString()}`);
  console.log(`100% OK (coordenada exata) ............ ${exata.toLocaleString()}  ${pc(exata)}`);
  console.log(`Aproximado (centroide de bairro) ...... ${aprox.toLocaleString()}  ${pc(aprox)}`);
  console.log(`   - OSM exato .......................... ${oExato.toLocaleString()}`);
  console.log(`   - OSM fuzzy (>=${FUZZY_MIN}) ............... ${oFuzzy.toLocaleString()}`);
  console.log(`   - Nominatim .......................... ${oNomi.toLocaleString()}`);
  console.log(`Sem coordenada (oculto no mapa) ....... ${semCoord.toLocaleString()}  ${pc(semCoord)}`);
  console.log(`   - bairro nao localizado (cauda longa) ${semB.toLocaleString()}`);
  console.log(`   - sem bairro informado (CENTROIDE_CIDADE) ${cidade.toLocaleString()}`);
  console.log(`\nGeolocalizado (visivel no mapa) ....... ${(exata + aprox).toLocaleString()}  ${pc(exata + aprox)}`);
  const sjc = (await q(`SELECT count(*) FILTER (WHERE geom IS NOT NULL)::int com, count(*)::int t FROM ocorrencias WHERE municipio='S.JOSE DOS CAMPOS'`)).rows[0];
  console.log(`Sao Jose dos Campos ................... ${sjc.com.toLocaleString()} / ${sjc.t.toLocaleString()} (${(100 * sjc.com / sjc.t).toFixed(1)}%)`);

  await cli.end();
}

main().catch((e) => { console.error("ERRO:", e); process.exit(1); });

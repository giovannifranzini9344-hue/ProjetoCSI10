/**
 * ============================================================================
 *  PROJETO CSI-10 — Carga da malha municipal de Sao Paulo (IBGE) no PostGIS
 * ============================================================================
 *  Baixa os limites (poligonos) dos 645 municipios de SP direto da API do IBGE
 *  e grava na tabela "municipios". Isso nos da duas coisas valiosas:
 *    (a) o CENTROIDE de cada cidade (para as ocorrencias sem bairro); e
 *    (b) o POLIGONO de cada cidade (base da ferramenta de buffer).
 *
 *  COMO RODAR (dentro da pasta "etl", com o banco no ar):
 *      npm run municipios
 *
 *  FONTES (APIs publicas do IBGE):
 *    - Nomes:  /api/v1/localidades/estados/35/municipios
 *    - Malha:  /api/v3/malhas/estados/35?...&intrarregiao=municipio  (GeoJSON)
 * ============================================================================
 */
import * as path from "node:path";
import * as dotenv from "dotenv";
import { Client } from "pg";

dotenv.config({ path: path.resolve(__dirname, "..", "..", "infra", ".env") });

const UF = 35; // codigo do estado de Sao Paulo no IBGE
const URL_NOMES = `https://servicodados.ibge.gov.br/api/v1/localidades/estados/${UF}/municipios`;
const URL_MALHA = `https://servicodados.ibge.gov.br/api/v3/malhas/estados/${UF}?formato=application/vnd.geo+json&intrarregiao=municipio`;

/** Remove acentos e padroniza para MAIUSCULAS (ajuda a casar nomes depois). */
function norm(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toUpperCase().replace(/\s+/g, " ").trim();
}

/** Baixa uma URL e devolve o JSON (a funcao "fetch" ja vem pronta no Node 18+). */
async function getJson(url: string): Promise<any> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Falha ao baixar ${url}: HTTP ${r.status}`);
  return r.json();
}

async function main() {
  // 1) Baixa a lista de nomes (codigo IBGE -> nome da cidade).
  console.log("Baixando nomes dos municipios (IBGE)...");
  const nomes: Array<{ id: number; nome: string }> = await getJson(URL_NOMES);
  const nomePorCod = new Map<number, string>();
  for (const m of nomes) nomePorCod.set(m.id, m.nome);
  console.log("  ", nomePorCod.size, "municipios");

  // 2) Baixa a malha (poligonos) em GeoJSON.
  console.log("Baixando a malha municipal (GeoJSON)...");
  const geo: any = await getJson(URL_MALHA);
  console.log("  ", geo.features.length, "poligonos");

  // 3) Conecta no banco.
  const client = new Client({
    host: process.env.PGHOST || "localhost",
    port: Number(process.env.POSTGRES_PORT) || 5432,
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB,
  });
  await client.connect();
  console.log("Conectado ao banco:", process.env.POSTGRES_DB);

  // 4) Cria a tabela dos municipios (poligono + ponto central).
  await client.query(`
    CREATE TABLE IF NOT EXISTS municipios (
      cod_ibge  integer PRIMARY KEY,
      nome      text,
      nome_norm text,                          -- nome MAIUSCULO sem acento
      geom      geometry(MultiPolygon, 4326),  -- limite (fronteira) da cidade
      centroide geometry(Point, 4326)          -- ponto central, sempre DENTRO do limite
    )`);
  await client.query("TRUNCATE municipios");

  // 5) Insere cada municipio. ST_GeomFromGeoJSON converte o poligono do GeoJSON
  //    em geometria do PostGIS; ST_Multi padroniza tudo como MultiPolygon.
  await client.query("BEGIN");
  for (const f of geo.features) {
    const cod = parseInt(f.properties.codarea, 10);
    const nome = nomePorCod.get(cod) ?? String(cod);
    await client.query(
      `INSERT INTO municipios (cod_ibge, nome, nome_norm, geom)
       VALUES ($1, $2, $3, ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($4), 4326)))`,
      [cod, nome, norm(nome), JSON.stringify(f.geometry)],
    );
  }
  await client.query("COMMIT");

  // 6) Calcula o ponto central de cada cidade e cria o indice espacial.
  await client.query("UPDATE municipios SET centroide = ST_PointOnSurface(geom)");
  await client.query("CREATE INDEX IF NOT EXISTS idx_municipios_geom ON municipios USING GIST (geom)");
  await client.query("ANALYZE municipios");

  // ----- Validacao -----
  const total = await client.query("SELECT count(*)::int n FROM municipios");
  const sjc = await client.query(
    `SELECT cod_ibge, nome,
            round(ST_Y(centroide)::numeric, 5) AS lat,
            round(ST_X(centroide)::numeric, 5) AS lon
     FROM municipios WHERE nome_norm = 'SAO JOSE DOS CAMPOS'`);
  console.log("\n===== MUNICIPIOS CARREGADOS =====");
  console.log("Total:", total.rows[0].n);
  console.log("SJC (centroide):", sjc.rows[0]);

  // Demonstracao da ferramenta de BUFFER: ocorrencias DENTRO de SJC vs SJC + 15km.
  // O operador "&&" usa o indice espacial (caixa delimitadora) antes do ST_Intersects.
  const dentro = await client.query(`
    SELECT count(*)::int n FROM ocorrencias o, municipios m
    WHERE m.nome_norm = 'SAO JOSE DOS CAMPOS'
      AND o.geom && m.geom AND ST_Intersects(o.geom, m.geom)`);
  const comBuffer = await client.query(`
    WITH sjc AS (
      SELECT ST_Buffer(geom::geography, 15000)::geometry AS area
      FROM municipios WHERE nome_norm = 'SAO JOSE DOS CAMPOS'
    )
    SELECT count(*)::int n FROM ocorrencias o, sjc
    WHERE o.geom && sjc.area AND ST_Intersects(o.geom, sjc.area)`);
  console.log("\nOcorrencias DENTRO de SJC         :", dentro.rows[0].n.toLocaleString());
  console.log("Ocorrencias em SJC + 15km (buffer):", comBuffer.rows[0].n.toLocaleString());

  await client.end();
}

main().catch((e) => { console.error("ERRO:", e); process.exit(1); });

/**
 * ============================================================================
 *  API do Projeto CSI-10 (Fastify + PostGIS)
 * ============================================================================
 *  E a "ponte" (camada de logica) entre o frontend (mapa) e o banco. Recebe os
 *  filtros do usuario, monta a consulta espacial e devolve os dados prontos:
 *   - /api/naturezas   lista de tipos de crime (para os checkboxes e cores)
 *   - /api/municipios  lista de cidades (para o filtro)
 *   - /api/periodo     intervalo de tempo disponivel (para a barra do tempo)
 *   - /api/pontos      pontos individuais (GeoJSON) da consulta filtrada
 *   - /api/heatmap     densidade agregada (grade) para a visao estadual
 *   - /api/stats       numeros do painel (conta TUDO, ate o que e oculto)
 *   - /api/buffer      poligono do municipio + raio e contagem dentro
 *
 *  Rodar (dentro de "api", com o banco no ar): npm run dev
 * ============================================================================
 */
import Fastify from "fastify";
import cors from "@fastify/cors";
import { pool } from "./db";

const app = Fastify({ logger: true });
app.register(cors, { origin: true }); // permite o frontend (outra porta) chamar a API

// --------------------------------------------------------------------------
// Helpers de filtro (montam o "WHERE" da consulta a partir dos parametros)
// --------------------------------------------------------------------------
type Q = Record<string, string | undefined>;
const lista = (s?: string) => (s ? s.split(",").map((x) => x.trim()).filter(Boolean) : []);
const ehVerdadeiro = (s?: string) => s === "true" || s === "1";

/** Filtro comum (tempo + recorte espacial + natureza). O recorte espacial e
 *  por NOME de municipio OU, se houver buffer, pela GEOMETRIA do buffer (cidade
 *  + raio) — assim o mapa/numeros passam a abranger as cidades vizinhas. */
function filtroBase(q: Q) {
  const cond: string[] = [];
  const p: any[] = [];
  if (q.de) { p.push(Number(q.de)); cond.push(`(ano*100+mes) >= $${p.length}`); }   // de = AAAAMM
  if (q.ate) { p.push(Number(q.ate)); cond.push(`(ano*100+mes) <= $${p.length}`); } // ate = AAAAMM

  const bufMun = lista(q.bufMun);
  const bufRaio = Number(q.bufRaio);
  if (bufMun.length && bufRaio > 0) {
    // Buffer ativo: filtra pela area = municipios + raio (km). O subquery do
    // buffer e calculado uma vez; reaproveitamos os mesmos parametros ($iMun,$iR).
    p.push(bufMun); const iMun = p.length;
    p.push(bufRaio); const iR = p.length;
    const area = `(SELECT ST_Buffer(ST_Union(m.geom)::geography, $${iR}*1000)::geometry
                   FROM municipios m JOIN municipio_ssp_map x ON x.cod_ibge=m.cod_ibge
                   WHERE x.ssp_municipio = ANY($${iMun}))`;
    cond.push(`geom && ${area} AND ST_Intersects(geom, ${area})`);
  } else {
    const muns = lista(q.municipios);
    if (muns.length) { p.push(muns); cond.push(`municipio = ANY($${p.length})`); }
  }

  const nats = lista(q.naturezas);
  if (nats.length) { p.push(nats); cond.push(`natureza = ANY($${p.length})`); }
  return { cond, p };
}

/** Filtro para o MAPA: exige geometria, respeita o toggle e a area visivel (bbox). */
function filtroMapa(q: Q) {
  const { cond, p } = filtroBase(q);
  cond.push("geom IS NOT NULL");
  // Toggle desligado por padrao -> so coordenadas EXATAS. Ligado -> tambem os
  // centroides de bairro (que tem geom). Os "sem coordenada" nunca aparecem.
  if (!ehVerdadeiro(q.incluirSemLocal)) cond.push("precisao_geo = 'EXATA'");
  // bbox = "minLon,minLat,maxLon,maxLat" (area visivel do mapa). Usa o indice
  // espacial (operador &&) para trazer so o que esta na tela -> bem mais rapido.
  if (q.bbox) {
    const b = q.bbox.split(",").map(Number);
    if (b.length === 4 && b.every((x) => Number.isFinite(x))) {
      p.push(b[0], b[1], b[2], b[3]);
      cond.push(`geom && ST_MakeEnvelope($${p.length - 3},$${p.length - 2},$${p.length - 1},$${p.length},4326)`);
    }
  }
  return { where: cond.length ? "WHERE " + cond.join(" AND ") : "", p };
}

// --------------------------------------------------------------------------
// Rotas
// --------------------------------------------------------------------------
app.get("/api/health", async () => ({ ok: true }));

app.get("/api/naturezas", async () => {
  const r = await pool.query("SELECT natureza, count(*)::int n FROM ocorrencias GROUP BY natureza ORDER BY n DESC");
  return r.rows;
});

app.get("/api/municipios", async () => {
  const r = await pool.query("SELECT municipio, count(*)::int n FROM ocorrencias WHERE municipio<>'' GROUP BY municipio ORDER BY n DESC");
  return r.rows;
});

app.get("/api/periodo", async () => {
  const r = await pool.query("SELECT min(ano*100+mes) AS min, max(ano*100+mes) AS max FROM ocorrencias WHERE ano IS NOT NULL");
  return r.rows[0];
});

// Caixa geografica (bbox) dos municipios selecionados — para o mapa enquadrar
// automaticamente na cidade escolhida. Retorna [minLon,minLat,maxLon,maxLat].
app.get("/api/extent", async (req) => {
  const muns = lista((req.query as Q).municipios);
  if (!muns.length) return null;
  const r = await pool.query(
    `SELECT ST_XMin(e) AS minx, ST_YMin(e) AS miny, ST_XMax(e) AS maxx, ST_YMax(e) AS maxy
     FROM (SELECT ST_Extent(m.geom) e FROM municipios m
           JOIN municipio_ssp_map x ON x.cod_ibge=m.cod_ibge
           WHERE x.ssp_municipio = ANY($1)) t`, [muns]);
  const row = r.rows[0];
  return row && row.minx != null ? [row.minx, row.miny, row.maxx, row.maxy] : null;
});

// Pontos individuais (GeoJSON). Tem teto para nao travar o navegador.
app.get("/api/pontos", async (req) => {
  const q = req.query as Q;
  const { where, p } = filtroMapa(q);
  const teto = Math.min(Number(q.limite) || 50000, 100000);
  const r = await pool.query(
    `SELECT ST_AsGeoJSON(geom)::json AS g, natureza, ano, mes, bairro, precisao_geo, centroide_fonte
     FROM ocorrencias ${where} LIMIT ${teto + 1}`, p);
  const truncado = r.rows.length > teto;
  const features = r.rows.slice(0, teto).map((x) => ({
    type: "Feature",
    geometry: x.g,
    properties: { natureza: x.natureza, ano: x.ano, mes: x.mes, bairro: x.bairro, precisao: x.precisao_geo, fonte: x.centroide_fonte },
  }));
  return { type: "FeatureCollection", truncado, features };
});

// Cache simples em memoria: a mesma consulta devolve a mesma resposta, entao
// guardamos por alguns minutos. Acelera muito a visao estadual inicial (que
// todos abrem) e consultas repetidas. TTL curto para nao "envelhecer".
const cache = new Map<string, { t: number; data: any }>();
const TTL_MS = 5 * 60 * 1000;
function comCache(chave: string, gera: () => Promise<any>): Promise<any> {
  const hit = cache.get(chave);
  if (hit && Date.now() - hit.t < TTL_MS) return Promise.resolve(hit.data);
  return gera().then((data) => {
    cache.set(chave, { t: Date.now(), data });
    if (cache.size > 300) cache.delete(cache.keys().next().value as string); // limita memoria
    return data;
  });
}

// Heatmap agregado: agrupa os pontos numa grade e devolve centro+contagem.
app.get("/api/heatmap", async (req) => {
  const q = req.query as Q;
  const cell = Math.max(0.005, Math.min(Number(q.cell) || 0.02, 0.5)); // graus (~0.02 = ~2 km)
  const { where, p } = filtroMapa(q);
  const chave = `heat|${cell}|${where}|${JSON.stringify(p)}`;
  return comCache(chave, async () => {
    const r = await pool.query(
      `SELECT round((ST_X(geom)/${cell})::numeric)*${cell} AS x,
              round((ST_Y(geom)/${cell})::numeric)*${cell} AS y, count(*)::int AS n
       FROM ocorrencias ${where} GROUP BY x, y`, p);
    return r.rows;
  });
});

// Numeros do painel: conta TUDO que casa o filtro (inclusive os ocultos).
app.get("/api/stats", async (req) => {
  const q = req.query as Q;
  const { cond, p } = filtroBase(q);
  const where = cond.length ? "WHERE " + cond.join(" AND ") : "";
  const r = await pool.query(
    `SELECT count(*)::int total,
            count(*) FILTER (WHERE precisao_geo='EXATA')::int exata,
            count(*) FILTER (WHERE precisao_geo='CENTROIDE_BAIRRO')::int centroide_bairro,
            count(*) FILTER (WHERE geom IS NULL)::int sem_coordenada
     FROM ocorrencias ${where}`, p);
  return r.rows[0];
});

// Buffer: poligono do(s) municipio(s) expandido em raioKm + contagem dentro.
app.get("/api/buffer", async (req, reply) => {
  const q = req.query as Q;
  const muns = lista(q.municipios);
  const raio = Math.max(0, Math.min(Number(q.raioKm) || 15, 100));
  if (!muns.length) return reply.code(400).send({ error: "informe ?municipios=" });
  const r = await pool.query(
    `WITH area AS (
       SELECT ST_Buffer(ST_Union(m.geom)::geography, $2*1000)::geometry AS g
       FROM municipios m JOIN municipio_ssp_map x ON x.cod_ibge=m.cod_ibge
       WHERE x.ssp_municipio = ANY($1))
     SELECT ST_AsGeoJSON(g)::json AS poligono,
            (SELECT count(*)::int FROM ocorrencias o, area
             WHERE o.geom && area.g AND ST_Intersects(o.geom, area.g)) AS total
     FROM area`, [muns, raio]);
  return r.rows[0] || { poligono: null, total: 0 };
});

const PORT = Number(process.env.PORT) || 3001;
app.listen({ port: PORT, host: "0.0.0.0" })
  .then(() => app.log.info(`API ouvindo em http://localhost:${PORT}`))
  .catch((e) => { app.log.error(e); process.exit(1); });

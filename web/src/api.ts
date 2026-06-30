/** Funcoes que conversam com a nossa API (Fastify). O Vite faz proxy de /api. */

export type Filtros = {
  de?: number;          // periodo inicial AAAAMM
  ate?: number;         // periodo final AAAAMM
  municipios: string[]; // nomes da SSP
  naturezas: string[];
  incluirSemLocal: boolean;
  // Quando o buffer esta ativo, o recorte espacial passa a ser a area do buffer
  // (cidade + raio) em vez do filtro por nome de municipio.
  buffer?: { municipios: string[]; raioKm: number } | null;
};

// Parametros extras de mapa (area visivel e tamanho da celula do heatmap).
export type ExtraMapa = { bbox?: string; cell?: number };

async function get(path: string) {
  const r = await fetch("/api" + path);
  if (!r.ok) throw new Error("API " + r.status + " em " + path);
  return r.json();
}

function qs(f: Filtros, extra?: ExtraMapa): string {
  const p = new URLSearchParams();
  if (f.de) p.set("de", String(f.de));
  if (f.ate) p.set("ate", String(f.ate));
  if (f.buffer && f.buffer.municipios.length) {
    p.set("bufMun", f.buffer.municipios.join(","));
    p.set("bufRaio", String(f.buffer.raioKm));
  } else if (f.municipios.length) {
    p.set("municipios", f.municipios.join(","));
  }
  if (f.naturezas.length) p.set("naturezas", f.naturezas.join(","));
  if (f.incluirSemLocal) p.set("incluirSemLocal", "1");
  if (extra?.bbox) p.set("bbox", extra.bbox);
  if (extra?.cell) p.set("cell", String(extra.cell));
  return p.toString();
}

export const apiNaturezas = (): Promise<{ natureza: string; n: number }[]> => get("/naturezas");
export const apiMunicipios = (): Promise<{ municipio: string; n: number }[]> => get("/municipios");
export const apiPeriodo = (): Promise<{ min: number; max: number }> => get("/periodo");

export const apiPontos = (f: Filtros, extra?: ExtraMapa) => get("/pontos?" + qs(f, extra));
export const apiHeatmap = (f: Filtros, extra?: ExtraMapa): Promise<{ x: number; y: number; n: number }[]> =>
  get("/heatmap?" + qs(f, extra));
export const apiStats = (f: Filtros): Promise<{ total: number; exata: number; centroide_bairro: number; sem_coordenada: number }> =>
  get("/stats?" + qs(f));
export const apiBuffer = (municipios: string[], raioKm: number) =>
  get(`/buffer?municipios=${encodeURIComponent(municipios.join(","))}&raioKm=${raioKm}`);
// Caixa geografica (bbox) dos municipios selecionados: [minLon,minLat,maxLon,maxLat].
export const apiExtent = (municipios: string[]): Promise<number[] | null> =>
  get(`/extent?municipios=${encodeURIComponent(municipios.join(","))}`);

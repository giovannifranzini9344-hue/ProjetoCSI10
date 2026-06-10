/** Funcoes que conversam com a nossa API (Fastify). O Vite faz proxy de /api. */

export type Filtros = {
  de?: number;          // periodo inicial AAAAMM
  ate?: number;         // periodo final AAAAMM
  municipios: string[]; // nomes da SSP
  naturezas: string[];
  incluirSemLocal: boolean;
};

async function get(path: string) {
  const r = await fetch("/api" + path);
  if (!r.ok) throw new Error("API " + r.status + " em " + path);
  return r.json();
}

function qs(f: Filtros): string {
  const p = new URLSearchParams();
  if (f.de) p.set("de", String(f.de));
  if (f.ate) p.set("ate", String(f.ate));
  if (f.municipios.length) p.set("municipios", f.municipios.join(","));
  if (f.naturezas.length) p.set("naturezas", f.naturezas.join(","));
  if (f.incluirSemLocal) p.set("incluirSemLocal", "1");
  return p.toString();
}

export const apiNaturezas = (): Promise<{ natureza: string; n: number }[]> => get("/naturezas");
export const apiMunicipios = (): Promise<{ municipio: string; n: number }[]> => get("/municipios");
export const apiPeriodo = (): Promise<{ min: number; max: number }> => get("/periodo");

export const apiPontos = (f: Filtros) => get("/pontos?" + qs(f));
export const apiHeatmap = (f: Filtros): Promise<{ x: number; y: number; n: number }[]> => get("/heatmap?" + qs(f));
export const apiStats = (f: Filtros): Promise<{ total: number; exata: number; centroide_bairro: number; sem_coordenada: number }> =>
  get("/stats?" + qs(f));
export const apiBuffer = (municipios: string[], raioKm: number) =>
  get(`/buffer?municipios=${encodeURIComponent(municipios.join(","))}&raioKm=${raioKm}`);

/** ====================================================================
 *  Mapa (OpenLayers).
 *   - A camada exibida depende do ZOOM: afastado = heatmap; bem perto
 *     (>= zoom de bairro) = pontos agrupados em clusters COLORIDOS.
 *   - Busca sempre so a AREA VISIVEL (bbox) -> rapido mesmo no estado todo.
 *   - O mapa so se reposiciona quando o usuario MUDA a cidade (no play o
 *     zoom fica fixo).
 *  ==================================================================== */
import { useEffect, useRef, useState } from "react";
import "ol/ol.css";
import Map from "ol/Map";
import View from "ol/View";
import TileLayer from "ol/layer/Tile";
import OSM from "ol/source/OSM";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import Heatmap from "ol/layer/Heatmap";
import Cluster from "ol/source/Cluster";
import GeoJSON from "ol/format/GeoJSON";
import Feature from "ol/Feature";
import Point from "ol/geom/Point";
import Overlay from "ol/Overlay";
import { fromLonLat, transformExtent } from "ol/proj";
import { Style, Circle as CircleStyle, Fill, Stroke, Text } from "ol/style";
import { Filtros, apiPontos, apiHeatmap, apiExtent } from "../api";
import { corDaNatureza } from "../colors";

const geojson = new GeoJSON();
const SP_CENTRO = fromLonLat([-48.5, -22.4]);
const ZOOM_INICIAL = 7;
const ZOOM_PONTOS = 13; // a partir daqui: pontos/clusters; abaixo: heatmap

// Celula do heatmap conforme o zoom (mais grossa quando afastado = mais rapido).
function cellPorZoom(z: number): number {
  if (z < 7) return 0.08;
  if (z < 9) return 0.04;
  if (z < 11) return 0.02;
  return 0.012;
}

// Cor de um cluster = cor da natureza MAIS COMUM dentro dele.
function corDominante(features: any[]): string {
  const cont: Record<string, number> = {};
  let melhor = "", max = -1;
  for (const f of features) {
    const n = f.get("natureza");
    cont[n] = (cont[n] || 0) + 1;
    if (cont[n] > max) { max = cont[n]; melhor = n; }
  }
  return corDaNatureza(melhor);
}

function estiloCluster(feature: any) {
  const fs = feature.get("features");
  const size = fs ? fs.length : 1;
  if (size > 1) {
    const r = Math.min(24, 9 + Math.log2(size) * 2.2);
    return new Style({
      image: new CircleStyle({ radius: r, fill: new Fill({ color: corDominante(fs) }), stroke: new Stroke({ color: "rgba(255,255,255,.85)", width: 1.5 }) }),
      text: new Text({ text: String(size), fill: new Fill({ color: "#fff" }), font: "bold 11px sans-serif", stroke: new Stroke({ color: "rgba(0,0,0,.4)", width: 2 }) }),
    });
  }
  const f0 = fs ? fs[0] : feature;
  return new Style({ image: new CircleStyle({ radius: 6, fill: new Fill({ color: corDaNatureza(f0.get("natureza")) }), stroke: new Stroke({ color: "rgba(0,0,0,.5)", width: 1 }) }) });
}

const estiloBuffer = new Style({
  stroke: new Stroke({ color: "#4f8cff", width: 2, lineDash: [6, 4] }),
  fill: new Fill({ color: "rgba(79,140,255,.06)" }),
});

type Props = { filtros: Filtros; buffer: any; onLoading: (b: boolean) => void };

export default function MapView({ filtros, buffer, onLoading }: Props) {
  const elRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const map = useRef<Map>();
  const heat = useRef<Heatmap>();
  const pts = useRef<VectorSource>();
  const buf = useRef<VectorSource>();
  const overlay = useRef<Overlay>();
  const carregaRef = useRef<() => void>(() => {});  // recarga atual (chamada no moveend)
  const reqId = useRef(0);                            // descarta respostas atrasadas
  const ultMun = useRef<string>("__inicial__");       // detecta troca de cidade
  const [popup, setPopup] = useState<any>(null);

  // ---- cria o mapa uma unica vez ----
  useEffect(() => {
    const ptsSrc = new VectorSource();
    const bufSrc = new VectorSource();
    const heatLayer = new Heatmap({ source: new VectorSource(), blur: 16, radius: 9, weight: (f: any) => f.get("w") });
    const ptsLayer = new VectorLayer({ source: new Cluster({ distance: 42, source: ptsSrc }), style: estiloCluster as any });
    const bufLayer = new VectorLayer({ source: bufSrc, style: estiloBuffer });

    const m = new Map({
      target: elRef.current!,
      layers: [new TileLayer({ source: new OSM() }), heatLayer, ptsLayer, bufLayer],
      view: new View({ center: SP_CENTRO, zoom: ZOOM_INICIAL }),
    });
    const ov = new Overlay({ element: popupRef.current!, positioning: "bottom-center", stopEvent: false });
    m.addOverlay(ov);

    // Recarrega os dados sempre que o usuario termina de mover/dar zoom.
    m.on("moveend", () => carregaRef.current());

    m.on("singleclick", (evt) => {
      let alvo: any = null;
      m.forEachFeatureAtPixel(evt.pixel, (f: any) => {
        const fs = f.get("features");
        if (fs) { if (fs.length === 1) alvo = fs[0]; else { alvo = "cluster"; m.getView().animate({ center: evt.coordinate, zoom: m.getView().getZoom()! + 2, duration: 250 }); } }
        else if (f.get("natureza")) alvo = f;
        return true;
      });
      if (alvo && alvo !== "cluster") { ov.setPosition(evt.coordinate); setPopup(alvo.getProperties()); }
      else { ov.setPosition(undefined); setPopup(null); }
    });

    map.current = m; heat.current = heatLayer; pts.current = ptsSrc; buf.current = bufSrc; overlay.current = ov;
    return () => m.setTarget(undefined);
  }, []);

  // ---- (re)define a funcao de carga sempre que os filtros mudam ----
  useEffect(() => {
    const recarrega = async () => {
      const m = map.current; if (!m) return;
      const view = m.getView();
      const z = view.getZoom() ?? ZOOM_INICIAL;
      const ext = transformExtent(view.calculateExtent(m.getSize()), "EPSG:3857", "EPSG:4326");
      const bbox = ext.map((n) => n.toFixed(5)).join(",");
      const id = ++reqId.current;
      onLoading(true);
      try {
        if (z < ZOOM_PONTOS) {
          // ----- HEATMAP -----
          const grid = await apiHeatmap(filtros, { bbox, cell: cellPorZoom(z) });
          if (id !== reqId.current) return;
          const maxN = Math.max(1, ...grid.map((g) => g.n));
          const feats = grid.map((g) => { const f = new Feature(new Point(fromLonLat([g.x, g.y]))); f.set("w", 0.25 + 0.75 * (g.n / maxN)); return f; });
          const hs = heat.current!.getSource()!; hs.clear(); hs.addFeatures(feats);
          heat.current!.setVisible(true);
          pts.current!.clear();
        } else {
          // ----- PONTOS / CLUSTERS -----
          const fc = await apiPontos(filtros, { bbox });
          if (id !== reqId.current) return;
          const feats = geojson.readFeatures(fc, { dataProjection: "EPSG:4326", featureProjection: "EPSG:3857" });
          pts.current!.clear(); pts.current!.addFeatures(feats);
          heat.current!.setVisible(false);
        }
      } catch (e) { console.error(e); }
      finally { if (id === reqId.current) onLoading(false); }
    };
    carregaRef.current = recarrega;
    recarrega(); // recarrega ao mudar qualquer filtro (tempo, natureza, toggle...)
  }, [filtros]);

  // ---- enquadra o mapa SO quando muda a cidade selecionada ----
  useEffect(() => {
    const chave = filtros.municipios.join("|");
    if (chave === ultMun.current) return;
    const primeiraVez = ultMun.current === "__inicial__";
    ultMun.current = chave;
    if (primeiraVez) return; // nao mexe na carga inicial
    const m = map.current; if (!m) return;
    if (!filtros.municipios.length) {
      m.getView().animate({ center: SP_CENTRO, zoom: ZOOM_INICIAL, duration: 400 }); // voltou ao estado
      return;
    }
    apiExtent(filtros.municipios).then((ext) => {
      if (!ext) return;
      const ext3857 = transformExtent(ext, "EPSG:4326", "EPSG:3857");
      m.getView().fit(ext3857, { padding: [60, 60, 130, 60], maxZoom: 12, duration: 450 });
    }).catch(console.error);
  }, [filtros.municipios]);

  // ---- buffer ----
  useEffect(() => {
    const src = buf.current; if (!src) return;
    src.clear();
    if (buffer?.poligono) {
      const f = geojson.readFeature({ type: "Feature", geometry: buffer.poligono }, { dataProjection: "EPSG:4326", featureProjection: "EPSG:3857" });
      src.addFeature(f as Feature);
    }
  }, [buffer]);

  const exata = popup?.precisao === "EXATA";
  return (
    <>
      <div ref={elRef} className="map" />
      <div ref={popupRef} className="ol-popup" style={{ display: popup ? "block" : "none" }}>
        {popup && (
          <>
            <div className="nat">{popup.natureza}</div>
            <div className="meta">{String(popup.mes).padStart(2, "0")}/{popup.ano} · {popup.bairro || "—"}</div>
            <span className={"tag " + (exata ? "exata" : "aprox")}>
              {exata ? "localização exata" : "aproximado (centroide de bairro)"}
            </span>
          </>
        )}
      </div>
    </>
  );
}

/** ====================================================================
 *  Mapa (OpenLayers). Gerencia 4 camadas sobre o mapa-base:
 *   - heatmap (visao densa, estado inteiro)
 *   - pontos coloridos por natureza, agrupados em clusters (visao filtrada)
 *   - buffer (poligono do municipio + raio)
 *  Recarrega os dados quando os filtros mudam, e mostra popup ao clicar.
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
import { fromLonLat } from "ol/proj";
import { Style, Circle as CircleStyle, Fill, Stroke, Text } from "ol/style";
import { Filtros, apiPontos, apiHeatmap } from "../api";
import { corDaNatureza } from "../colors";

const geojson = new GeoJSON();
const SP_CENTRO = fromLonLat([-48.5, -22.4]);

// Estilo de um cluster: bolha com contagem (>1) ou ponto colorido (==1).
function estiloCluster(feature: any) {
  const fs = feature.get("features");
  const size = fs ? fs.length : 1;
  if (size > 1) {
    const r = Math.min(22, 9 + Math.log2(size) * 2.2);
    return new Style({
      image: new CircleStyle({ radius: r, fill: new Fill({ color: "rgba(79,140,255,.78)" }), stroke: new Stroke({ color: "#dfe8ff", width: 1 }) }),
      text: new Text({ text: String(size), fill: new Fill({ color: "#fff" }), font: "11px sans-serif" }),
    });
  }
  const f0 = fs ? fs[0] : feature;
  return new Style({
    image: new CircleStyle({ radius: 5, fill: new Fill({ color: corDaNatureza(f0.get("natureza")) }), stroke: new Stroke({ color: "rgba(0,0,0,.45)", width: 1 }) }),
  });
}

const estiloBuffer = new Style({
  stroke: new Stroke({ color: "#4f8cff", width: 2, lineDash: [6, 4] }),
  fill: new Fill({ color: "rgba(79,140,255,.06)" }),
});

type Props = { filtros: Filtros; mostrarPontos: boolean; buffer: any; onLoading: (b: boolean) => void };

export default function MapView({ filtros, mostrarPontos, buffer, onLoading }: Props) {
  const elRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const map = useRef<Map>();
  const heat = useRef<Heatmap>();
  const pts = useRef<VectorSource>();
  const buf = useRef<VectorSource>();
  const overlay = useRef<Overlay>();
  const [popup, setPopup] = useState<any>(null);

  // ---- cria o mapa uma unica vez ----
  useEffect(() => {
    const ptsSrc = new VectorSource();
    const bufSrc = new VectorSource();
    const heatLayer = new Heatmap({ source: new VectorSource(), blur: 17, radius: 9, weight: (f: any) => f.get("w") });
    const ptsLayer = new VectorLayer({ source: new Cluster({ distance: 42, source: ptsSrc }), style: estiloCluster as any });
    const bufLayer = new VectorLayer({ source: bufSrc, style: estiloBuffer });

    const m = new Map({
      target: elRef.current!,
      layers: [new TileLayer({ source: new OSM() }), heatLayer, ptsLayer, bufLayer],
      view: new View({ center: SP_CENTRO, zoom: 7 }),
    });
    const ov = new Overlay({ element: popupRef.current!, positioning: "bottom-center", stopEvent: false });
    m.addOverlay(ov);

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

  // ---- recarrega os dados quando filtros/modo mudam ----
  useEffect(() => {
    let cancelado = false;
    onLoading(true);
    (async () => {
      try {
        if (mostrarPontos) {
          const fc = await apiPontos(filtros);
          if (cancelado) return;
          const feats = geojson.readFeatures(fc, { dataProjection: "EPSG:4326", featureProjection: "EPSG:3857" });
          pts.current!.clear(); pts.current!.addFeatures(feats);
          heat.current!.setVisible(false);
          // enquadra a vista nos pontos carregados
          if (feats.length) {
            const ext = pts.current!.getExtent();
            map.current!.getView().fit(ext, { padding: [60, 60, 120, 60], maxZoom: 14, duration: 300 });
          }
        } else {
          const grid = await apiHeatmap(filtros);
          if (cancelado) return;
          const max = Math.max(1, ...grid.map((g) => g.n));
          const feats = grid.map((g) => { const f = new Feature(new Point(fromLonLat([g.x, g.y]))); f.set("w", 0.25 + 0.75 * (g.n / max)); return f; });
          const hs = heat.current!.getSource()!; hs.clear(); hs.addFeatures(feats);
          heat.current!.setVisible(true);
          pts.current!.clear();
        }
      } catch (e) { console.error(e); }
      finally { if (!cancelado) onLoading(false); }
    })();
    return () => { cancelado = true; };
  }, [filtros, mostrarPontos]);

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

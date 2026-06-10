/** ====================================================================
 *  App: orquestra o estado (filtros, tempo, buffer) e monta o layout
 *  (barra lateral + mapa + barra do tempo).
 *  ==================================================================== */
import { useEffect, useMemo, useState } from "react";
import MapView from "./components/MapView";
import Sidebar from "./components/Sidebar";
import TimeSlider, { Modo } from "./components/TimeSlider";
import { Filtros, apiNaturezas, apiMunicipios, apiPeriodo, apiStats, apiBuffer } from "./api";

// Monta a lista de periodos (AAAAMM) de min a max, mes a mes.
function listaPeriodos(min: number, max: number): number[] {
  const out: number[] = [];
  let a = Math.floor(min / 100), m = min % 100;
  const A = Math.floor(max / 100), M = max % 100;
  while (a < A || (a === A && m <= M)) {
    out.push(a * 100 + m);
    m++; if (m > 12) { m = 1; a++; }
  }
  return out;
}

export default function App() {
  // dados de apoio
  const [naturezas, setNaturezas] = useState<{ natureza: string; n: number }[]>([]);
  const [municipiosLista, setMunicipiosLista] = useState<{ municipio: string; n: number }[]>([]);
  const [periodos, setPeriodos] = useState<number[]>([]);

  // selecoes do usuario
  const [municipios, setMunicipios] = useState<string[]>([]);
  const [naturezasSel, setNaturezasSel] = useState<string[]>([]);
  const [incluirSemLocal, setIncluir] = useState(false);

  // tempo
  const [index, setIndex] = useState(0);
  const [modo, setModo] = useState<Modo>("acumulado");
  const [playing, setPlaying] = useState(false);

  // buffer / painel
  const [raioKm, setRaioKm] = useState(15);
  const [buffer, setBuffer] = useState<any>(null);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  // carrega dados de apoio uma vez
  useEffect(() => {
    apiNaturezas().then(setNaturezas).catch(console.error);
    apiMunicipios().then(setMunicipiosLista).catch(console.error);
    apiPeriodo().then((p) => {
      const lista = listaPeriodos(p.min, p.max);
      setPeriodos(lista);
      setIndex(lista.length - 1); // comeca no periodo mais recente (acumulado = tudo)
    }).catch(console.error);
  }, []);

  // filtros derivados (memoizados para nao refazer fetch a toa)
  const filtros: Filtros = useMemo(() => {
    const atual = periodos[index];
    const de = modo === "acumulado" ? periodos[0] : atual;
    const ate = atual;
    return { de, ate, municipios, naturezas: naturezasSel, incluirSemLocal };
  }, [periodos, index, modo, municipios, naturezasSel, incluirSemLocal]);

  // numeros do painel
  useEffect(() => {
    if (!periodos.length) return;
    apiStats(filtros).then(setStats).catch(console.error);
  }, [filtros]);

  // play: avanca o tempo automaticamente
  useEffect(() => {
    if (!playing || !periodos.length) return;
    const id = setInterval(() => {
      setIndex((i) => (i >= periodos.length - 1 ? (setPlaying(false), i) : i + 1));
    }, 900);
    return () => clearInterval(id);
  }, [playing, periodos]);

  const setFiltros = (nf: Filtros) => {
    setMunicipios(nf.municipios);
    setNaturezasSel(nf.naturezas);
    setIncluir(nf.incluirSemLocal);
  };

  const aplicarBuffer = async () => {
    if (!municipios.length) return;
    try { setBuffer(await apiBuffer(municipios, raioKm)); } catch (e) { console.error(e); }
  };

  return (
    <div className="app">
      <Sidebar
        naturezas={naturezas}
        municipios={municipiosLista}
        filtros={filtros}
        setFiltros={setFiltros}
        stats={stats}
        bufferInfo={buffer ? { total: buffer.total } : null}
        raioKm={raioKm}
        setRaioKm={setRaioKm}
        onAplicarBuffer={aplicarBuffer}
        onLimparBuffer={() => setBuffer(null)}
      />
      <div className="map-wrap">
        {loading && <div className="loading">carregando…</div>}
        <MapView filtros={filtros} buffer={buffer} onLoading={setLoading} />
        {periodos.length > 0 && (
          <TimeSlider periodos={periodos} index={index} setIndex={setIndex} modo={modo} setModo={setModo} playing={playing} setPlaying={setPlaying} />
        )}
      </div>
    </div>
  );
}

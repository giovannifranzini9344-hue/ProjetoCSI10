/** ====================================================================
 *  App: orquestra o estado (filtros, intervalo de tempo, buffer) e monta o
 *  layout (barra lateral + mapa + barra do tempo).
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

  // tempo: intervalo [iniIdx, fimIdx] (indices na lista de periodos)
  const [iniIdx, setIniIdx] = useState(0);
  const [fimIdx, setFimIdx] = useState(0);
  const [modo, setModo] = useState<Modo>("acumulado");
  const [playing, setPlaying] = useState(false);

  // buffer / painel
  const [raioKm, setRaioKm] = useState(15);
  const [bufferAtivo, setBufferAtivo] = useState<{ municipios: string[]; raioKm: number } | null>(null);
  const [bufferPoly, setBufferPoly] = useState<any>(null);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  // carrega dados de apoio uma vez
  useEffect(() => {
    apiNaturezas().then(setNaturezas).catch(console.error);
    apiMunicipios().then(setMunicipiosLista).catch(console.error);
    apiPeriodo().then((p) => {
      const lista = listaPeriodos(p.min, p.max);
      setPeriodos(lista);
      setIniIdx(0);                 // inicio = Jan/2022
      setFimIdx(lista.length - 1);  // fim = periodo mais recente (acumulado = tudo)
    }).catch(console.error);
  }, []);

  // filtros derivados (memoizados para nao refazer fetch a toa)
  const filtros: Filtros = useMemo(() => {
    const ate = periodos[fimIdx];
    // Acumulado: do inicio escolhido ate o fim. Atual: so o mes do fim.
    const de = modo === "acumulado" ? periodos[iniIdx] : periodos[fimIdx];
    return { de, ate, municipios, naturezas: naturezasSel, incluirSemLocal, buffer: bufferAtivo };
  }, [periodos, iniIdx, fimIdx, modo, municipios, naturezasSel, incluirSemLocal, bufferAtivo]);

  // numeros do painel
  useEffect(() => {
    if (!periodos.length) return;
    apiStats(filtros).then(setStats).catch(console.error);
  }, [filtros]);

  // play: avanca o FIM do intervalo automaticamente
  useEffect(() => {
    if (!playing || !periodos.length) return;
    const id = setInterval(() => {
      setFimIdx((f) => {
        if (f >= periodos.length - 1) { setPlaying(false); return f; }
        const nf = f + 1;
        if (modo === "atual") setIniIdx(nf); // no "atual" o mes unico anda junto
        return nf;
      });
    }, 900);
    return () => clearInterval(id);
  }, [playing, periodos, modo]);

  // Ao trocar para "atual", o cursor unico passa a ser o fim.
  const trocarModo = (m: Modo) => { if (m === "atual") setIniIdx(fimIdx); setModo(m); };

  const setFiltros = (nf: Filtros) => {
    setMunicipios(nf.municipios);
    setNaturezasSel(nf.naturezas);
    setIncluir(nf.incluirSemLocal);
  };

  const aplicarBuffer = async () => {
    if (!municipios.length) return;
    const alvo = { municipios: [...municipios], raioKm };
    setBufferAtivo(alvo);
    try { setBufferPoly(await apiBuffer(alvo.municipios, alvo.raioKm)); } catch (e) { console.error(e); }
  };
  const limparBuffer = () => { setBufferAtivo(null); setBufferPoly(null); };

  return (
    <div className="app">
      <Sidebar
        naturezas={naturezas}
        municipios={municipiosLista}
        filtros={filtros}
        setFiltros={setFiltros}
        stats={stats}
        bufferInfo={bufferPoly ? { total: bufferPoly.total } : null}
        raioKm={raioKm}
        setRaioKm={setRaioKm}
        onAplicarBuffer={aplicarBuffer}
        onLimparBuffer={limparBuffer}
      />
      <div className="map-wrap">
        {loading && <div className="loading">carregando…</div>}
        <MapView filtros={filtros} buffer={bufferPoly} onLoading={setLoading} />
        {periodos.length > 0 && (
          <TimeSlider
            periodos={periodos}
            iniIdx={iniIdx} fimIdx={fimIdx}
            setIniIdx={setIniIdx} setFimIdx={setFimIdx}
            modo={modo} setModo={trocarModo}
            playing={playing} setPlaying={setPlaying}
          />
        )}
      </div>
    </div>
  );
}

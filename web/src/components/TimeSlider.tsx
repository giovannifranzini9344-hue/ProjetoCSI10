/** Barra do tempo: play/pause e seleção do intervalo.
 *  - Atual: um cursor (mês único).
 *  - Acumulado: DOIS cursores (início e fim do período acumulado). */

export type Modo = "atual" | "acumulado";

function rotulo(p: number) {
  if (p == null) return "—";
  const ano = Math.floor(p / 100);
  const mes = p % 100;
  return String(mes).padStart(2, "0") + "/" + ano;
}

type Props = {
  periodos: number[];
  iniIdx: number;
  fimIdx: number;
  setIniIdx: (i: number) => void;
  setFimIdx: (i: number) => void;
  modo: Modo;
  setModo: (m: Modo) => void;
  playing: boolean;
  setPlaying: (b: boolean) => void;
};

export default function TimeSlider({ periodos, iniIdx, fimIdx, setIniIdx, setFimIdx, modo, setModo, playing, setPlaying }: Props) {
  const max = Math.max(0, periodos.length - 1);
  return (
    <div className="timebar">
      <button className="play primary" onClick={() => setPlaying(!playing)} title={playing ? "Pausar" : "Reproduzir"}>
        {playing ? "❚❚" : "▶"}
      </button>

      <div className="periodo">
        {modo === "acumulado"
          ? `${rotulo(periodos[iniIdx])} → ${rotulo(periodos[fimIdx])}`
          : rotulo(periodos[fimIdx])}
      </div>

      {modo === "acumulado" ? (
        // Dois cursores sobrepostos na mesma trilha (início e fim).
        <div className="dual">
          <input type="range" min={0} max={max} value={iniIdx}
            onChange={(e) => { setIniIdx(Math.min(Number(e.target.value), fimIdx)); setPlaying(false); }} />
          <input type="range" min={0} max={max} value={fimIdx}
            onChange={(e) => { setFimIdx(Math.max(Number(e.target.value), iniIdx)); setPlaying(false); }} />
        </div>
      ) : (
        <input className="single" type="range" min={0} max={max} value={fimIdx}
          onChange={(e) => { setFimIdx(Number(e.target.value)); setPlaying(false); }} />
      )}

      <div className="modo">
        <button className={modo === "atual" ? "on" : ""} onClick={() => setModo("atual")}>Atual</button>
        <button className={modo === "acumulado" ? "on" : ""} onClick={() => setModo("acumulado")}>Acumulado</button>
      </div>
    </div>
  );
}

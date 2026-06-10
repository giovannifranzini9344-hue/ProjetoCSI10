/** Barra do tempo: play/pause, slider de Jan/2022 a Abr/2026 e os dois modos
 *  de visualizacao (Atual = so o mes selecionado; Acumulado = do inicio ate ele). */

export type Modo = "atual" | "acumulado";

function rotulo(p: number) {
  const ano = Math.floor(p / 100);
  const mes = p % 100;
  return String(mes).padStart(2, "0") + "/" + ano;
}

type Props = {
  periodos: number[];
  index: number;
  setIndex: (i: number) => void;
  modo: Modo;
  setModo: (m: Modo) => void;
  playing: boolean;
  setPlaying: (b: boolean) => void;
};

export default function TimeSlider({ periodos, index, setIndex, modo, setModo, playing, setPlaying }: Props) {
  const atual = periodos[index];
  return (
    <div className="timebar">
      <button className="play primary" onClick={() => setPlaying(!playing)} title={playing ? "Pausar" : "Reproduzir"}>
        {playing ? "❚❚" : "▶"}
      </button>
      <div className="periodo">{atual ? rotulo(atual) : "—"}</div>
      <input
        type="range"
        min={0}
        max={Math.max(0, periodos.length - 1)}
        value={index}
        onChange={(e) => { setIndex(Number(e.target.value)); setPlaying(false); }}
      />
      <div className="modo">
        <button className={modo === "atual" ? "on" : ""} onClick={() => setModo("atual")}>Atual</button>
        <button className={modo === "acumulado" ? "on" : ""} onClick={() => setModo("acumulado")}>Acumulado</button>
      </div>
    </div>
  );
}

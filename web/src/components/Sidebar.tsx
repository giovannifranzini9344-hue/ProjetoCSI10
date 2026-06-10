/** Barra lateral: filtros (municipio, natureza), toggle de anomalias,
 *  ferramenta de buffer, numeros do painel e legenda de cores. */
import { useState } from "react";
import { Filtros, apiStats } from "../api";
import { FAMILIAS } from "../colors";

const fmt = (n: number | undefined) => (n ?? 0).toLocaleString("pt-BR");

type Stats = { total: number; exata: number; centroide_bairro: number; sem_coordenada: number } | null;

type Props = {
  naturezas: { natureza: string; n: number }[];
  municipios: { municipio: string; n: number }[];
  filtros: Filtros;
  setFiltros: (f: Filtros) => void;
  stats: Stats;
  bufferInfo: { total: number } | null;
  raioKm: number;
  setRaioKm: (n: number) => void;
  onAplicarBuffer: () => void;
  onLimparBuffer: () => void;
};

// Liga/desliga um item dentro de um array de filtros.
function alterna(arr: string[], v: string): string[] {
  return arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];
}

export default function Sidebar(p: Props) {
  const [busca, setBusca] = useState("");
  const f = p.filtros;
  const contagemNat: Record<string, number> = {};
  for (const x of p.naturezas) contagemNat[x.natureza] = x.n;

  const munFiltrados = (busca
    ? p.municipios.filter((m) => m.municipio.includes(busca.toUpperCase()))
    : p.municipios
  ).slice(0, 50);

  return (
    <aside className="sidebar">
      <div>
        <h1>Mapa de Segurança Pública — SP</h1>
        <p className="sub">Evolução espaço-temporal das ocorrências (SSP-SP, 2022–2026)</p>
      </div>

      {/* ---- Painel de números ---- */}
      <div className="bloco">
        <h2>Ocorrências no filtro</h2>
        <div className="stat-row"><span>Total</span><b>{fmt(p.stats?.total)}</b></div>
        <div className="stat-row"><span>Localização exata</span><b>{fmt(p.stats?.exata)}</b></div>
        <div className="stat-row"><span>Centroide de bairro</span><b>{fmt(p.stats?.centroide_bairro)}</b></div>
        <div className="stat-row"><span>Sem coordenada (oculto)</span><b>{fmt(p.stats?.sem_coordenada)}</b></div>
      </div>

      {/* ---- Municípios ---- */}
      <div className="bloco">
        <h2>Município</h2>
        {f.municipios.length > 0 && (
          <div style={{ marginBottom: 6, display: "flex", flexWrap: "wrap", gap: 4 }}>
            {f.municipios.map((m) => (
              <button key={m} onClick={() => p.setFiltros({ ...f, municipios: alterna(f.municipios, m) })} style={{ padding: "2px 7px", fontSize: 11 }}>
                {m} ✕
              </button>
            ))}
          </div>
        )}
        <input type="text" placeholder="buscar cidade..." value={busca} onChange={(e) => setBusca(e.target.value)} />
        <div className="scroll" style={{ marginTop: 6 }}>
          {munFiltrados.map((m) => (
            <label key={m.municipio} className="check">
              <input type="checkbox" checked={f.municipios.includes(m.municipio)} onChange={() => p.setFiltros({ ...f, municipios: alterna(f.municipios, m.municipio) })} />
              <span>{m.municipio}</span>
              <span className="cnt">{fmt(m.n)}</span>
            </label>
          ))}
        </div>
        {f.municipios.length > 0 && <p className="muted" style={{ marginTop: 4 }}>Vendo pontos das cidades selecionadas.</p>}
        {f.municipios.length === 0 && <p className="muted" style={{ marginTop: 4 }}>Sem cidade selecionada → mapa de calor estadual.</p>}
      </div>

      {/* ---- Ferramenta de buffer ---- */}
      <div className="bloco">
        <h2>Buffer (área de vizinhança)</h2>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input type="number" min={1} max={100} value={p.raioKm} onChange={(e) => p.setRaioKm(Number(e.target.value))} style={{ width: 70 }} />
          <span className="muted">km externos</span>
        </div>
        <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
          <button className="primary" disabled={!f.municipios.length} onClick={p.onAplicarBuffer}>Aplicar</button>
          <button onClick={p.onLimparBuffer}>Limpar</button>
        </div>
        {p.bufferInfo && <p className="muted" style={{ marginTop: 6 }}>{fmt(p.bufferInfo.total)} ocorrências dentro do município + {p.raioKm} km.</p>}
        {!f.municipios.length && <p className="muted" style={{ marginTop: 6 }}>Selecione ao menos um município.</p>}
      </div>

      {/* ---- Toggle anomalias ---- */}
      <div className="bloco">
        <label className="check">
          <input type="checkbox" checked={f.incluirSemLocal} onChange={() => p.setFiltros({ ...f, incluirSemLocal: !f.incluirSemLocal })} />
          <span>Incluir ocorrências sem local exato</span>
        </label>
        <p className="muted" style={{ marginTop: 4 }}>Mostra também os pontos no centroide de bairro (aproximados).</p>
      </div>

      {/* ---- Naturezas por família ---- */}
      <div className="bloco">
        <h2>Natureza criminal</h2>
        <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
          <button onClick={() => p.setFiltros({ ...f, naturezas: [] })} style={{ fontSize: 11, padding: "3px 8px" }}>Todas</button>
        </div>
        <div className="scroll" style={{ maxHeight: 260 }}>
          {FAMILIAS.map((fam) => (
            <div key={fam.nome}>
              <div className="familia">{fam.nome}</div>
              {fam.itens.map((it) => (
                <label key={it.natureza} className="check">
                  <input type="checkbox" checked={f.naturezas.includes(it.natureza)} onChange={() => p.setFiltros({ ...f, naturezas: alterna(f.naturezas, it.natureza) })} />
                  <span className="dot" style={{ background: it.cor }} />
                  <span style={{ fontSize: 11.5 }}>{it.natureza}</span>
                  <span className="cnt">{fmt(contagemNat[it.natureza])}</span>
                </label>
              ))}
            </div>
          ))}
        </div>
        <p className="muted" style={{ marginTop: 4 }}>Nenhuma marcada = todas as naturezas.</p>
      </div>
    </aside>
  );
}

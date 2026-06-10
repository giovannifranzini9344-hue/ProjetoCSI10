/** ====================================================================
 *  Cores por "familia" de crime (conforme a especificacao): crimes
 *  parecidos recebem tons da MESMA cor; familias diferentes recebem cores
 *  bem distintas. As naturezas seguem os nomes canonicos do banco.
 *  ==================================================================== */

export type Familia = { nome: string; itens: { natureza: string; cor: string }[] };

export const FAMILIAS: Familia[] = [
  {
    nome: "Furto (verdes)",
    itens: [
      { natureza: "FURTO OUTROS", cor: "#2e7d32" },
      { natureza: "FURTO DE VEICULO", cor: "#66bb6a" },
      { natureza: "FURTO DE CARGA", cor: "#a5d6a7" },
    ],
  },
  {
    nome: "Roubo (laranjas)",
    itens: [
      { natureza: "ROUBO OUTROS", cor: "#e65100" },
      { natureza: "ROUBO DE VEICULO", cor: "#fb8c00" },
      { natureza: "ROUBO DE CARGA", cor: "#ffb74d" },
      { natureza: "ROUBO A BANCO", cor: "#ff7043" },
    ],
  },
  {
    nome: "Letais (vermelhos)",
    itens: [
      { natureza: "HOMICIDIO DOLOSO", cor: "#b71c1c" },
      { natureza: "TENTATIVA DE HOMICIDIO", cor: "#e53935" },
      { natureza: "LATROCINIO", cor: "#7f0000" },
      { natureza: "LESAO CORPORAL SEGUIDA DE MORTE", cor: "#8e0000" },
      { natureza: "EXTORSAO MEDIANTE SEQUESTRO", cor: "#c62828" },
      { natureza: "HOMICIDIO DOLOSO POR ACIDENTE DE TRANSITO", cor: "#ad1457" },
    ],
  },
  {
    nome: "Trânsito / culposos (marrons)",
    itens: [
      { natureza: "HOMICIDIO CULPOSO POR ACIDENTE DE TRANSITO", cor: "#6d4c41" },
      { natureza: "LESAO CORPORAL CULPOSA POR ACIDENTE DE TRANSITO", cor: "#a1887f" },
      { natureza: "HOMICIDIO CULPOSO OUTROS", cor: "#8d6e63" },
      { natureza: "LESAO CORPORAL CULPOSA OUTRAS", cor: "#bcaaa4" },
    ],
  },
  {
    nome: "Lesão dolosa (âmbar)",
    itens: [{ natureza: "LESAO CORPORAL DOLOSA", cor: "#f9a825" }],
  },
  {
    nome: "Sexuais (roxos)",
    itens: [
      { natureza: "ESTUPRO", cor: "#6a1b9a" },
      { natureza: "ESTUPRO DE VULNERAVEL", cor: "#ab47bc" },
    ],
  },
  {
    nome: "Drogas (azuis)",
    itens: [
      { natureza: "TRAFICO DE ENTORPECENTES", cor: "#1565c0" },
      { natureza: "PORTE DE ENTORPECENTES", cor: "#1e88e5" },
      { natureza: "APREENSAO DE ENTORPECENTES", cor: "#64b5f6" },
    ],
  },
  {
    nome: "Armas (turquesa)",
    itens: [{ natureza: "PORTE DE ARMA", cor: "#00838f" }],
  },
];

// Mapa rapido natureza -> cor (montado a partir das familias).
const MAPA: Record<string, string> = {};
for (const f of FAMILIAS) for (const it of f.itens) MAPA[it.natureza] = it.cor;

export function corDaNatureza(natureza: string): string {
  return MAPA[natureza] || "#9e9e9e"; // cinza para qualquer natureza nao mapeada
}

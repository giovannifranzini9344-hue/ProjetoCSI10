/**
 * ============================================================================
 *  PROJETO CSI-10 — Script de ETL (Extract, Transform, Load)
 *  Le as planilhas brutas da SSP-SP, limpa, e gera UM arquivo CSV higienizado.
 * ============================================================================
 *
 *  COMO RODAR (dentro da pasta "etl"):
 *      npm run etl                  -> processa TODOS os arquivos
 *      ETL_LIMIT=20000 npm run etl  -> so 20 mil linhas por arquivo (teste rapido)
 *
 *  ENTRADA : etl/data/raw/JAN-JUN-2022.csv, JUL-DEZ-2022.csv, ... (9 arquivos)
 *  SAIDA   : etl/data/processed/ocorrencias_limpas.csv
 *
 *  O QUE ESTE SCRIPT RESOLVE (descobrimos isso inspecionando os dados reais):
 *   1) Codificacao MISTA: 2022 esta em Latin1; 2023+ em UTF-8. -> detecta sozinho.
 *   2) Cabecalhos DIFERENTES por ano: a coluna da cidade se chama "CIDADE" em
 *      2022 e "NOME_MUNICIPIO" de 2023 em diante. -> usamos as duas como apelido.
 *   3) Linhas com ";" ou aspas embutidos que desalinham um split ingenuo.
 *      -> usamos a biblioteca "csv-parse", que entende aspas corretamente.
 *   4) Coordenadas com virgula decimal, "-", "0" ou vazias. -> regra de precisao.
 *
 *  NOTA PARA QUEM VEM DO C:
 *   - "import" e como "#include": traz codigo de outra biblioteca.
 *   - "async/await" e "for await" servem para ler arquivos gigantes aos poucos
 *     (em fluxo), sem carregar 1,8 GB na memoria de uma vez.
 *   - Um "stream" e um cano por onde os dados passam pouco a pouco.
 *   - ": string", ": number" sao tipos (como int/char* do C); o TypeScript usa
 *     para avisar erros antes de rodar.
 * ============================================================================
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { once } from "node:events";
import { parse } from "csv-parse";

// ---------------------------------------------------------------------------
// Caminhos e configuracao
// ---------------------------------------------------------------------------
const PASTA_RAW = path.resolve(__dirname, "..", "data", "raw");
const PASTA_OUT = path.resolve(__dirname, "..", "data", "processed");
const ARQUIVO_SAIDA = path.join(PASTA_OUT, "ocorrencias_limpas.csv");

// Se rodar com "ETL_LIMIT=20000", processa no maximo 20 mil linhas por arquivo
// (util para testar rapido). Sem essa variavel, processa tudo (0 = sem limite).
const LIMITE = Number(process.env.ETL_LIMIT) || 0;

// As colunas que vamos GRAVAR no arquivo limpo, nesta ordem:
const COLUNAS_SAIDA = [
  "municipio", "ano", "mes", "natureza", "bairro", "delegacia",
  "latitude", "longitude", "precisao_geo",
];

// ---------------------------------------------------------------------------
// Funcoes auxiliares (pequenas "ferramentas" reutilizaveis)
// ---------------------------------------------------------------------------

/** Descobre se o arquivo esta em UTF-8 ou Latin1 (lendo so o comeco dele). */
function detectarEncoding(arquivo: string): "utf8" | "latin1" {
  const fd = fs.openSync(arquivo, "r");
  const buf = Buffer.alloc(65536);                 // le os primeiros 64 KB
  const n = fs.readSync(fd, buf, 0, buf.length, 0);
  fs.closeSync(fd);
  // corta no ultimo "\n" para nao cortar um caractere acentuado no meio
  let fim = buf.subarray(0, n).lastIndexOf(0x0a);
  if (fim < 0) fim = n;
  try {
    // Se decodificar como UTF-8 sem erro, e UTF-8. Se der erro, e Latin1.
    new TextDecoder("utf-8", { fatal: true }).decode(buf.subarray(0, fim));
    return "utf8";
  } catch {
    return "latin1";
  }
}

/** Limpa um texto: tira espacos das pontas, junta espacos repetidos, MAIUSCULAS. */
function limparTexto(s: string | undefined): string {
  return (s ?? "").replace(/\s+/g, " ").trim().toUpperCase();
}

/** Remove os acentos de um texto (ex.: "TRÁFICO" -> "TRAFICO"). */
function semAcento(s: string): string {
  // normalize("NFD") separa a letra do acento; depois apagamos as marcas de acento.
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/**
 * Padroniza a NATUREZA para uma "categoria canonica", unindo grafias diferentes
 * do MESMO crime. Ex.: "TRÁFICO DE ENTORPECENTES" e "TRAFICO DE ENTORPECENTES"
 * viram "TRAFICO DE ENTORPECENTES"; "LESÃO ... - OUTRAS" e "LESÃO ... OUTRAS"
 * viram o mesmo texto. (O nome "bonito" com acento sera recuperado na tela depois.)
 */
function canonNatureza(s: string | undefined): string {
  return semAcento(limparTexto(s))     // MAIUSCULAS, sem acento
    .replace(/[^A-Z0-9 ]+/g, " ")      // troca hifens/pontuacao por espaco
    .replace(/\s+/g, " ")              // junta espacos repetidos
    .trim();
}

/** Converte a coordenada de texto ("-23,55") para numero (-23.55) ou null. */
function parseCoord(s: string | undefined): number | null {
  const t = (s ?? "").trim();
  if (t === "" || t === "-") return null;          // vazio ou traco = sem coordenada
  const n = parseFloat(t.replace(",", "."));       // troca virgula por ponto
  if (Number.isNaN(n) || n === 0) return null;     // texto invalido ou zero = sem coord
  return n;
}

/** A coordenada cai dentro da "caixa" geografica aproximada de Sao Paulo? */
function dentroDeSP(lat: number, lon: number): boolean {
  return lat > -26 && lat < -19 && lon > -54 && lon < -44;
}

/** Prepara um valor para virar celula de CSV (poe aspas se tiver virgula/aspas). */
function csvCell(v: string): string {
  return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}

// "Caixinha" de contadores que vamos preenchendo enquanto lemos os arquivos.
interface Contadores {
  total: number;
  exata: number;
  centroideBairro: number;
  centroideCidade: number;
  pulados: number;
  naturezas: Map<string, number>;
}

// ---------------------------------------------------------------------------
// Processa UM arquivo, gravando as linhas limpas no stream de saida.
// ---------------------------------------------------------------------------
async function processarArquivo(nome: string, saida: fs.WriteStream, c: Contadores) {
  const caminho = path.join(PASTA_RAW, nome);
  const encoding = detectarEncoding(caminho);

  // Monta o "cano": le o arquivo (na codificacao certa) -> entrega ao csv-parse.
  const parser = fs
    .createReadStream(caminho, { encoding })
    .pipe(parse({
      delimiter: ";",                 // colunas separadas por ponto-e-virgula
      bom: true,                      // ignora o "BOM" invisivel do inicio (UTF-8)
      columns: true,                  // cada linha vira um objeto: r.LATITUDE, r.BAIRRO...
      skip_empty_lines: true,
      relax_column_count: true,       // tolera linhas com nº de colunas diferente
      relax_quotes: true,             // tolera aspas fora do padrao
      skip_records_with_error: true,  // pula (sem travar) linhas impossiveis de ler
    }));

  parser.on("skip", () => c.pulados++);

  let doArquivo = 0;
  for await (const r of parser as AsyncIterable<Record<string, string>>) {
    // Pula as "linhas-lixo" totalmente vazias (sem ano da estatistica)
    const ano = (r.ANO_ESTATISTICA ?? "").trim();
    if (!ano) continue;

    if (LIMITE && doArquivo >= LIMITE) { parser.destroy(); break; } // corte do modo teste
    doArquivo++;
    c.total++;

    // --- Coluna da cidade: "NOME_MUNICIPIO" (2023+) ou "CIDADE" (2022) ---
    const municipio = limparTexto(r.NOME_MUNICIPIO ?? r.CIDADE);
    const mes = (r.MES_ESTATISTICA ?? "").trim();
    const natureza = canonNatureza(r.NATUREZA_APURADA); // unifica grafias do mesmo crime
    const bairro = limparTexto(r.BAIRRO);
    const delegacia = limparTexto(r.NOME_DELEGACIA);

    // --- Regra de precisao geografica (o "coracao" da limpeza) ---
    const lat = parseCoord(r.LATITUDE);
    const lon = parseCoord(r.LONGITUDE);
    let precisao: string;
    let latOut = "";
    let lonOut = "";

    if (lat !== null && lon !== null && dentroDeSP(lat, lon)) {
      precisao = "EXATA";                 // tem coordenada boa -> plota no lugar certo
      latOut = String(lat);
      lonOut = String(lon);
      c.exata++;
    } else if (bairro !== "" && bairro !== "-") {
      precisao = "CENTROIDE_BAIRRO";      // coord vazia -> sera preenchida numa etapa futura
      c.centroideBairro++;
    } else {
      precisao = "CENTROIDE_CIDADE";      // coord vazia -> sera preenchida numa etapa futura
      c.centroideCidade++;
    }

    // Conta as naturezas distintas (para planejarmos as cores depois)
    c.naturezas.set(natureza, (c.naturezas.get(natureza) || 0) + 1);

    // Monta e grava a linha de saida (uma celula por coluna)
    const linha = [municipio, ano, mes, natureza, bairro, delegacia, latOut, lonOut, precisao]
      .map(csvCell)
      .join(",") + "\n";

    // Se o "cano" de saida encheu, espera ele esvaziar (controle de memoria)
    if (!saida.write(linha)) await once(saida, "drain");
  }

  console.log(`  ok ${nome.padEnd(18)} [${encoding}] -> ${doArquivo.toLocaleString()} linhas`);
}

// ---------------------------------------------------------------------------
// Programa principal
// ---------------------------------------------------------------------------
async function main() {
  // Descobre os arquivos de semestre (JAN-... e JUL-...), ignorando a amostra antiga.
  const arquivos = fs.readdirSync(PASTA_RAW)
    .filter((f) => /^(JAN|JUL)-.*\.csv$/i.test(f))
    .sort();

  if (arquivos.length === 0) {
    console.error("Nenhum arquivo de semestre encontrado em", PASTA_RAW);
    return;
  }

  console.log(
    `Processando ${arquivos.length} arquivo(s)` +
    (LIMITE ? ` (modo teste: ${LIMITE}/arquivo)` : "") + " ...",
  );

  // Abre o arquivo de saida e escreve o cabecalho
  const saida = fs.createWriteStream(ARQUIVO_SAIDA, { encoding: "utf8" });
  saida.write(COLUNAS_SAIDA.join(",") + "\n");

  const c: Contadores = {
    total: 0, exata: 0, centroideBairro: 0, centroideCidade: 0,
    pulados: 0, naturezas: new Map(),
  };

  // Processa um arquivo de cada vez (await = espera terminar antes do proximo)
  for (const nome of arquivos) {
    await processarArquivo(nome, saida, c);
  }

  saida.end();
  await once(saida, "finish"); // espera o arquivo terminar de ser gravado no disco

  // ----- Relatorio final -----
  const pct = (n: number) => (c.total ? (100 * n / c.total).toFixed(1) : "0") + "%";
  console.log("\n===== RESUMO =====");
  console.log("Linhas gravadas:", c.total.toLocaleString());
  console.log("  EXATA            :", c.exata.toLocaleString(), pct(c.exata));
  console.log("  CENTROIDE_BAIRRO :", c.centroideBairro.toLocaleString(), pct(c.centroideBairro));
  console.log("  CENTROIDE_CIDADE :", c.centroideCidade.toLocaleString(), pct(c.centroideCidade));
  console.log("Linhas puladas por erro de leitura:", c.pulados);
  console.log("Arquivo gerado:", ARQUIVO_SAIDA);
  console.log("\nNaturezas distintas:", c.naturezas.size, "(top 60):");
  [...c.naturezas.entries()].sort((a, b) => b[1] - a[1]).slice(0, 60)
    .forEach(([k, v]) => console.log("   " + String(v).padStart(9) + "  " + k));
}

main().catch((e) => { console.error("ERRO:", e); process.exit(1); });

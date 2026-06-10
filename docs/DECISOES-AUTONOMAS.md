# Diário de Decisões Autônomas

> Este arquivo registra as decisões que o Claude tomou sozinho durante a
> construção autônoma das etapas (API → frontend → execução local), conforme
> combinado. Cada item traz: o **contexto**, as **opções**, o que foi **escolhido**
> e o **porquê**, e **como reverter**. Use para revisar e pedir mudanças.

Data de início da sessão autônoma: 2026-06-09.

---

## D0 — Alvo do "deploy": local, não nuvem

- **Contexto:** o pedido incluía "faça um deploy". Não posso criar contas nem
  inserir credenciais em serviços de nuvem (regra de segurança).
- **Escolha:** entregar o produto **rodando localmente** (objetivo declarado),
  conteinerizado, com arquivos de deploy prontos (Dockerfiles/configs).
- **Reverter/avançar:** quando você quiser, basta publicar nas suas contas
  (instruções no final do processo). Nada a reverter — só o passo da nuvem é seu.

## D1 — Framework da API: Fastify

- **Opções:** Express (mais popular, mais verboso) vs Fastify (moderno, rápido,
  ótimo suporte a TypeScript e validação de schema).
- **Escolha:** **Fastify**. Mais rápido e com tipagem/validação melhores, alinhado
  ao rigor esperado num projeto do ITA.
- **Reverter:** a lógica das rotas é simples; migrar para Express é direto.

## D2 — Como servir os pontos (5 milhões) ao mapa

- **Opções:** (a) Vector Tiles (MVT via pg_tileserv) — escalável, mais infra;
  (b) API retorna GeoJSON filtrado + agregação server-side para a visão densa.
- **Escolha:** **(b)** para esta entrega local. A API filtra por
  município/natureza/tempo e devolve pontos (com teto); para a visão estadual
  densa, devolve um **heatmap agregado** (grade no servidor). Mais simples, sem
  serviço extra, e cobre 100% do valor (SJC + vistas filtradas).
- **Reverter/evoluir:** Vector Tiles fica como upgrade de produção (registrado no
  DET como plano de escala). Trocar exige subir o pg_tileserv e uma camada MVT.

## D3 — Filtro de município usa os nomes da SSP

- **Contexto:** os dados usam nomes abreviados ("S.PAULO"); o IBGE usa por extenso.
- **Escolha:** o filtro lista os nomes **da SSP** (é por eles que filtramos a
  tabela ocorrencias). Para o buffer, faço a ponte SSP→IBGE (tabela
  municipio_ssp_map) internamente.
- **Reverter:** dá para exibir o nome bonito do IBGE no rótulo mantendo o valor SSP.

---

<!-- Próximas decisões serão acrescentadas abaixo conforme surgirem. -->

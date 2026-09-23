# Painel de Separação — Olist ERP

Painel fixo pra TV do estoque: contadores da fila de separação, sincronizados
com a API 2.0 (Tiny) do Olist ERP. Cada tela escolhe (tela de configuração,
guardado localmente no navegador) quais dos 4 contadores mostrar — pra times
diferentes acompanharem etapas diferentes sem afetar o que aparece em outra TV.

- **Aguardando separação** (`situacao=1`)
- **Em separação** (`situacao=4`)
- **Separadas** (`situacao=2`)
- **Embaladas** (`situacao=3`) — aproximado, ver seção de arquitetura abaixo.

## Arquitetura

- `lib/store.ts` — KV em arquivo JSON local (só guarda o último snapshot sincronizado).
- `lib/olist.ts` — `fetchCoreCountsLive()` (Aguardando/Em separação/Separadas) e
  `fetchEmbaladasCountLive()` (Embaladas) sincronizam **independente um do outro**
  — cada um preserva no cache o que o outro já tinha calculado. `fetchSeparacaoCountsLive()`
  faz os dois de uma vez (só usada pelo botão manual). `getCachedCounts()` serve o cache.
- `server/routes/separacao.ts` — `GET /api/separacao` (cache, rápido) e `POST /api/separacao/sync` (força uma sincronização completa sob demanda).
- `server/index.ts` — sobe o Express e agenda **dois** `setInterval` — um pra Aguardando/Em
  separação/Separadas (30s, padrão) e outro pra Embaladas (10min, padrão) — como o
  processo fica sempre no ar (Render, PC do escritório etc.), não precisa de Vercel Cron
  nem Vercel KV.
- `src/App.tsx` / `src/styles/globals.css` — frontend: faz polling em `/api/separacao` a cada 30s.

Autenticação é por **token fixo da API 2.0** (gerado em ERP Olist >
Configurações > Token API), não OAuth — bem mais simples: o token não expira
sozinho, só é preciso trocar se alguém revogar/regenerar manualmente no ERP.

`GET /separacao.pesquisa.php` devolve `{ retorno: { status, pagina, numero_paginas, separacoes: [...] } }`,
100 registros por página, sem um campo de total pronto.

Cada etapa usa um critério de "hoje" diferente — ajustados um por um
comparando com a tela de separação do próprio Olist ERP até os números
baterem:

- **Aguardando / Em separação** (`situacao=1`/`4`): o parâmetro nativo
  `dataInicial`/`dataFinal=hoje` já filtra certo (por `dataCriacao`). Conta
  pela página 1 + última, sem precisar trazer os itens.
- **Separadas** (`situacao=2`): a tela do Olist conta por `dataSeparacao`, não
  por `dataCriacao` — a API não tem esse filtro pronto. Busca **sem** filtro
  de data (essa fila é pequena, não acumula) e conta no código quem tem
  `dataSeparacao === hoje`.
- Um `codigo_erro: 32` (a forma da API dizer "consulta sem registros") vira
  contagem 0 em vez de erro — fila vazia é estado normal, não falha.
- **Embaladas** (`situacao=3`): a tela do Olist mostra um "prazo máximo de
  despacho" que bateria 100%, mas esse campo **não existe** na resposta dessa
  API (só `dataCriacao`/`dataSeparacao`/`dataCheckout`). A aproximação usada
  (`dataCheckout === hoje`) tem duas fontes de divergência conhecidas e
  aceitas: (1) o campo em si não é 100% equivalente ao "prazo máximo de
  despacho" da tela, e (2) só entram na conta itens **criados** dentro da
  janela de dias (`OLIST_EMBALADAS_WINDOW_DAYS`, padrão 6) — um item criado
  antes disso e embalado hoje escapa da contagem (foi a causa de uma
  divergência de ~2% observada: 528 aqui vs 539 na tela do Olist, com janela
  de 3 dias). Aumentar a janela reduz (2), mas tem um teto de páginas (40,
  ~4000 registros) pra nunca arriscar o limite não documentado da API
  (`codigo_erro 35` visto em ~50+ páginas nos testes) — se estourar, essa etapa
  falha isolada e mantém o último valor em cache, sem derrubar as outras 3.

  Essa fila nunca esvazia (~500-600 embalagens/dia acumuladas), diferente de
  Separadas, então não dá pra buscar sem filtro de data como lá. E como depois
  de "Separadas" só existe um caminho possível (virar "Embaladas", sem outra
  saída), esse número não precisa ser tão ao vivo quanto os outros 3 — por
  isso sincroniza numa frequência própria e bem mais baixa
  (`OLIST_EMBALADAS_SYNC_INTERVAL_MS`, padrão 10min, ver `server/index.ts`).
  Isso importa na prática: rodar a busca de Embaladas (várias páginas) junto
  com o sync de 30s das outras 3 etapas foi o que estourou o rate limit real
  do Tiny nos testes — a API passou a recusar toda requisição com "Token
  inválido" por alguns segundos depois de uma rajada de ~20 páginas (não é o
  token, é limite de taxa).

## Rodando localmente

```bash
npm install
cp .env.example .env.local   # preencha OLIST_API_TOKEN
npm run dev                  # front em :5173, API em :4000
```

1. No Olist ERP, vá em **Configurações > Token API** e copie o token da conta.
2. Cole em `OLIST_API_TOKEN` no `.env.local`.
3. Abra `http://localhost:5173` — o servidor já sincroniza sozinho ao subir e
   depois a cada 30s por padrão, sem precisar clicar em nada.

Sem o token configurado, a tela mostra um aviso claro em vez de números
zerados ou travados em "—".

## Deploy

Duas formas de hospedar — a diferença é só se o front e a API moram no mesmo
lugar ou não. **A Vercel sozinha não serve**: ela não mantém processo vivo
(sem `setInterval`) nem disco persistente, e a sincronização de 30 em 30s
depende dos dois.

### Opção A — tudo no Render (mais simples)

1. Web Service novo, apontando pra este repo. Build command: `npm run build`.
   Start command: `npm start`.
2. Variáveis de ambiente: `OLIST_API_TOKEN` (obrigatório) e o resto do
   `.env.example` se quiser mudar os padrões. **Não** precisa de `CORS_ORIGIN`
   nem `VITE_API_URL` — front e API são o mesmo domínio.
3. **Adicione um Persistent Disk** (Render > seu serviço > Disks) montado em,
   por exemplo, `/data`, e defina `DATA_DIR=/data`. Sem isso, o cache do
   último snapshot zera a cada redeploy — nada grave, o painel só mostra
   "esqueleto" até a próxima sincronização automática rodar, mas evita esse
   soluço.

### Opção B — front na Vercel, API no Render

Crie o Render **primeiro** (é de lá que sai a URL que a Vercel vai usar).

**Render (API):**
1. Web Service novo, apontando pra este repo.
2. Build command: `npm install && npx tsc --noEmit` (não precisa rodar
   `vite build` aqui — a Vercel cuida do front). Start command: `npm start`.
3. Variáveis: `OLIST_API_TOKEN` (obrigatório), `DATA_DIR=/data` + Persistent
   Disk (mesma razão da Opção A), e `CORS_ORIGIN=https://seu-painel.vercel.app`
   (a URL que a Vercel vai te dar — pode ajustar depois de criar).
4. Anote a URL pública que o Render gerou (algo como
   `https://olist-dashboard-xxxx.onrender.com`).

**Vercel (front):**
1. Importe o mesmo repo na Vercel — ela detecta Vite sozinha (build command
   `npm run build`, output `dist/`).
2. Em Settings > Environment Variables, adicione `VITE_API_URL` com a URL do
   Render do passo anterior (sem barra no final). Precisa existir **antes** do
   build, porque o Vite lê em build-time, não em runtime.
3. Deploy. Se a URL da Vercel não bater com o que você colocou em
   `CORS_ORIGIN` no Render, volte lá e corrija (redeploy o Render depois).

Como o token não expira sozinho (diferente de um OAuth), não tem limitação de
"reconectar depois de X tempo fora do ar" — o serviço do Render volta a
sincronizar sozinho assim que o processo sobe de novo, nas duas opções.

## Devoluções

Segunda aba (`#devolucoes`) pro setor de devolução: digita o **número da nota
fiscal de venda**, clica em Buscar (ou aperta Enter) e aparece uma prévia
editável, linha por item, pra copiar (`Ctrl+V`) direto na planilha de
controle de devoluções.

- `lib/devolucao.ts` — busca no Tiny (só leitura, nunca escreve nada lá):
  `notas.fiscais.pesquisa.php?numero=X&tipoNota=S` acha a nota; se tiver mais
  de uma com o mesmo número (séries diferentes), usa a de emissão mais
  recente e devolve o resto em `outras`. `nota.fiscal.obter.php?id=Y` traz
  cliente e itens. Pro marketplace: se a nota tiver `id_venda`,
  `pedido.obter.php?id=Z` e lê `pedido.ecommerce.nomeEcommerce`; sem isso,
  cai pro `intermediador.nome` da própria nota. `codigo_erro: 6` do Tiny
  (limite de taxa) vira uma mensagem clara em vez de erro genérico.
- `lib/produtoPlanilha.ts` + `lib/data/produtos.json` — nome do produto no
  formato curto da planilha (coluna PRODUTO). Primeiro tenta o mapa editável
  (`data/produtos.json`, código Tiny → nome exato — fica vazio de propósito,
  pra quem conhece a planilha completar); se o código não estiver lá, monta
  TIPO + LINHA + COR + VOLTAGEM a partir da descrição do Tiny (ex.: "Chaleira
  Modern Preta 127V" → "CHALEIRA MODERN PRETA 127V"). 110V e 127V caem no
  mesmo rótulo "127V", seguindo a regra pedida.
- `server/routes/devolucao.ts` — `GET /api/devolucao/nf/:numero`. Responde
  `{ erro: "..." }` (não `{ error }`, diferente do resto da API — por pedido
  explícito de quem for consumir isso) com 404 pra NF não encontrada, 429 pro
  limite de taxa do Tiny.
- `src/Devolucoes.tsx` — campo de busca, prévia em tabela larga (usa a tela
  toda — `.pagina-formulario--larga`, diferente do Relatórios que fica
  estreito de propósito) com DATA PEDIDO SAC/OCORRÊNCIA/OBSERVAÇÕES/PRODUTO
  editáveis (OCORRÊNCIA é um select de 5 opções fixas que preenche
  OBSERVAÇÕES automaticamente, mas o texto continua editável depois) e mais
  dois selects, STATUS e REEMBOLSOS, com as mesmas listas fixas da validação
  de dados da planilha — normalmente ficam vazios na hora do registro
  inicial (só dão pra saber depois que o produto físico chega), mas dá pra
  preencher já se você souber. Botão "Copiar p/ planilha"
  (`navigator.clipboard`) e as últimas 10 buscas guardadas no navegador
  (`localStorage`) pra reabrir rápido.

**Formato exato do que é copiado**: uma linha por item da nota, 18 colunas
separadas por TAB (`\t`) e sem cabeçalho — A a J preenchidas (data, cliente,
CPF, ID pedido, NF, marketplace, ocorrência, observações, quantidade,
produto), K a M vazias (data de recebimento, defeito da inspeção e código de
série só existem depois que o produto físico chega — não tem como vir da
busca pela NF), N e O preenchidas se você escolheu status/reembolso na
prévia (ficam vazias senão), P a R vazias. Ver `linhaParaCopia` em
`src/Devolucoes.tsx` se a ordem das colunas da planilha mudar.

**Atenção**: `lib/tinyClient.ts` faz as chamadas via GET com os parâmetros na
URL — mesmo padrão já usado (e funcionando) em `lib/olist.ts` e
`lib/relatorioVendas.ts`. Não deu pra confirmar contra a documentação ao vivo
do Tiny se `notas.fiscais.pesquisa.php`/`nota.fiscal.obter.php` aceitam GET
do mesmo jeito (`tiny.com.br` bloqueado no ambiente onde isso foi escrito) —
**teste com uma NF real antes de confiar em produção**. Se o Tiny exigir POST
pra esses dois endpoints, é só adicionar `{ method: "POST" }` no `fetch`
dentro de `tinyGet` (`lib/tinyClient.ts`).

## Relatórios

Terceira aba (`#relatorios`): digita o nome (ou parte do nome) de um produto
e um período, e baixa um `.xlsx` com uma linha por dia — inclusive os dias
sem venda — e uma coluna por variação de produto encontrada (ex: 110V, 220V),
detectadas automaticamente pelo texto da descrição, sem nada fixo no código.

- `lib/relatorioVendas.ts` — busca todos os pedidos do período
  (`pedidos.pesquisa.php`, paginado por `dataInicial`/`dataFinal`) e, pra
  cada um, os itens (`pedido.obter.php`), somando as quantidades dos itens
  cujo nome contém o termo buscado. **1 chamada ao Tiny por pedido do
  período, não só pelos que têm o produto** — isso importa porque, com o
  volume real visto em produção (~630 pedidos/dia), um período de ~1 mês já
  passa de 15 mil chamadas.
- `server/routes/relatorios.ts` — roda isso em background (job em memória,
  não sobrevive a um redeploy) porque um relatório grande pode levar bem mais
  de 1 hora. `POST /api/relatorios/vendas` inicia e devolve um `jobId`;
  `GET /api/relatorios/vendas/:id` dá o progresso (`atual`/`total` de pedidos
  já consultados); `GET /api/relatorios/vendas/:id/download` baixa o `.xlsx`
  quando `status: "concluido"`. O job só é apagado da memória 2h **depois de
  terminar** (nunca a partir do início — um relatório longo não pode ser
  descartado antes de acabar).
- `src/Relatorios.tsx` — um botão só: gera, mostra o progresso (faz polling a
  cada 1,5s) e troca por um link de download quando pronto.

Pontos de atenção pra quem for usar em volume alto:

- **Demora é esperado, não é falha.** No volume visto (~630 pedidos/dia), um
  período de ~27 dias já passa de 15 mil chamadas ao `pedido.obter.php` — com
  o intervalo de 150ms entre chamadas (`RATE_LIMIT_DELAY_MS` em
  `lib/relatorioVendas.ts`), isso é bem mais de 1 hora rodando. O teto de
  segurança (`MAX_PEDIDOS_POR_RELATORIO`) está em 50 mil pedidos só pra pegar
  um termo/período claramente errado antes de gastar tempo nisso — não é
  pensado pra limitar um relatório mensal real.
- **Mesmo token do painel de separação.** Uma rajada de milhares de chamadas
  pode fazer o Tiny recusar temporariamente ("Token inválido" por alguns
  segundos) — isso afeta o painel de separação também, que sincroniza a cada
  30s com o mesmo token. `tinyGet` já retenta com backoff quando isso
  acontece, então o relatório não falha por causa disso, só fica mais lento;
  ainda assim, evite gerar relatórios grandes durante o horário de pico se o
  painel estiver sendo usado ao vivo numa TV.
- **Não filtra pedidos cancelados** (não deu pra confirmar qual código do
  Tiny representa isso — mesma ressalva de sempre). Confira o total contra o
  relatório de vendas do próprio Tiny antes de usar os números pra decisão.

## Desenvolvimento

```bash
npm test
npm run typecheck
npm run lint
npm run build     # build de produção do front (Vite) em dist/
npm start         # roda o Express, servindo a API e o build de dist/
```

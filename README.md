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

- `lib/store.ts` — KV com dois backends escolhidos automaticamente: **Supabase**
  (Postgres gerenciado, grátis) se `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`
  estiverem configuradas — é o modo usado em produção, sobrevive a
  redeploy/restart; sem elas, cai pro arquivo JSON local de sempre (modo usado
  em dev, zero configuração). Ver seção de hospedagem abaixo pro porquê disso
  importar em produção. **Em produção (`NODE_ENV=production`, padrão do
  Render) sem Supabase configurado, gravar (`set`/`update`/`del`) lança
  `StoreConfigError` em vez de cair quieto pro arquivo local** — as rotas que
  usam isso (colaboradores, catálogo de produtos, produto/voltagem de
  posição) devolvem HTTP 503 com uma mensagem clara, e a tela mostra esse
  erro em vez de dar a falsa impressão de que salvou. Só em dev/teste
  (`NODE_ENV` não é `"production"`) o arquivo local continua aceitando
  gravação sem Supabase, sem precisar configurar nada.
- `lib/olist.ts` — `fetchCoreCountsLive()` (Aguardando/Em separação/Separadas) e
  `fetchEmbaladasCountLive()` (Embaladas) sincronizam **independente um do outro**
  — cada um preserva no cache o que o outro já tinha calculado. `fetchSeparacaoCountsLive()`
  faz os dois de uma vez (só usada pelo botão manual). `getCachedCounts()` serve o cache.
- `server/routes/separacao.ts` — `GET /api/separacao` (cache, rápido) e `POST /api/separacao/sync` (força uma sincronização completa sob demanda).
- `lib/controlePedidos.ts` / `server/routes/pedidos.ts` — CRUD manual do Controle diário de pedidos (`GET`/`PUT`/`DELETE` por data), persistido na chave `controle-pedidos:dias` do mesmo `kv_store`; `GET /api/pedidos/planilha.xlsx` exporta todo o histórico. O campo interno `doTiago` é derivado do responsável do turno e não é devolvido ao navegador nem incluído na planilha.
- `src/ControlePedidos.tsx` — tela Controle de Pedidos, acessível em `#pedidos`, com salvamento automático, exclusão confirmada e histórico compartilhado entre dispositivos.
- `src/Relatorios.tsx` — acesso ao download Excel do Controle de Pedidos, no lugar do relatório de vendas por produto/período.
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
3. **Configure `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`** (ver `.env.example`
   pro SQL da tabela) — o Render Free não tem disco persistente, então sem
   isso o cadastro (colaboradores do Embalagem, catálogo de produtos e
   produto/voltagem de cada posição do Estoque) **some de verdade** a cada
   vez que o serviço "acorda" de inatividade ou é redeployado, já que é dado
   digitado à mão, sem nenhuma fonte pra recriar sozinho. (O cache do último
   snapshot sincronizado do Tiny também usa esse mesmo KV, mas perder ele é
   inofensivo — só espera a próxima sincronização automática. Alternativa ao
   Supabase: um **Persistent Disk** do Render, Render > seu serviço > Disks,
   com `DATA_DIR` apontando pro mount path — mas isso só existe em planos
   pagos do Render.)

### Opção B — front na Vercel, API no Render

Crie o Render **primeiro** (é de lá que sai a URL que a Vercel vai usar).

**Render (API):**
1. Web Service novo, apontando pra este repo.
2. Build command: `npm install && npx tsc --noEmit` (não precisa rodar
   `vite build` aqui — a Vercel cuida do front). Start command: `npm start`.
3. Variáveis: `OLIST_API_TOKEN` (obrigatório), `SUPABASE_URL`/
   `SUPABASE_SERVICE_ROLE_KEY` (mesma razão da Opção A), e
   `CORS_ORIGIN=https://seu-painel.vercel.app` (a URL que a Vercel vai te
   dar — pode ajustar depois de criar).
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
   **Deploys de preview da Vercel** (URL nova a cada deploy, tipo
   `llelle-xxxxx-seu-time.vercel.app`) são liberados automaticamente pelo
   backend (`server/index.ts`, `PADRAO_PREVIEW_VERCEL`) sem precisar tocar em
   `CORS_ORIGIN` pra cada um — só a URL de produção fixa precisa estar lá.

Como o token não expira sozinho (diferente de um OAuth), não tem limitação de
"reconectar depois de X tempo fora do ar" — o serviço do Render volta a
sincronizar sozinho assim que o processo sobe de novo, nas duas opções.

## Devoluções

Segunda aba (`#devolucoes`) pro setor de devolução: digita o **número da nota
fiscal de venda** ou o **"Nº do pedido"**/**"Venda #"** (o número que aparece
na tela do Shopee ou do Mercado Livre, quando você não tem a NF em mãos),
clica em Buscar (ou aperta Enter), e aparece a prévia editável, linha por
item, pra copiar (`Ctrl+V`) direto na planilha de controle de devoluções.

> **Busca por nome/CPF do cliente foi tentada e abandonada.** Pacote de
> devolução dos Correios costuma só ter o nome (ou, na etiqueta DACE, o CPF)
> do cliente escrito — mas a API pública do Tiny não expõe um filtro de
> busca por cliente indexado (duas tentativas com um parâmetro `cliente` em
> `notas.fiscais.pesquisa.php` deram erro real em produção; varrer
> `pedidos.pesquisa.php` por data e comparar campo por campo no próprio
> código também não se mostrou confiável — ou achava rápido demais pra não
> ficar lento, ou simplesmente não achava). Só a tela do Tiny consegue isso,
> porque consulta o banco interno deles direto. Sem um filtro de servidor
> confirmado, essa busca ficou de fora por ora.

- `lib/devolucao.ts` — busca no Tiny (só leitura, nunca escreve nada lá):
  `notas.fiscais.pesquisa.php?numero=X&tipoNota=S` acha a nota; se tiver mais
  de uma com o mesmo número (séries diferentes), usa a de emissão mais
  recente e devolve o resto em `outras`. Se não achar nenhuma NF com esse
  número, tenta como **"Nº do pedido"** (Shopee) ou **"Venda #"** (Mercado
  Livre) — ambos guardados por Tiny no mesmo campo `numero_ecommerce`:
  `pedidos.pesquisa.php?numeroEcommerce=X` → `pedido.obter.php?id=Y` → lê
  `id_nota_fiscal` e segue o fluxo normal a partir daí — assim quem está na
  tela de devolução do Shopee/ML (só tem o "Nº do pedido"/"Venda #" à mão)
  não precisa ir no Tiny achar a NF antes de buscar aqui. `nota.fiscal.obter.php?id=Y`
  traz cliente e itens. Pro marketplace: se a nota tiver `id_venda`,
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
  estreito de propósito) com todas as colunas de A a O editáveis: DATA
  PEDIDO SAC/OCORRÊNCIA/OBSERVAÇÕES/PRODUTO (OCORRÊNCIA é um select de 5
  opções fixas que preenche OBSERVAÇÕES automaticamente, mas o texto
  continua editável depois), DATA RECEBIMENTO/DEFEITO/CÓDIGO FABRICANTE
  (texto livre — normalmente só dão pra preencher depois que o produto
  físico chega, mas ficam disponíveis desde já; CÓDIGO FABRICANTE também
  aceita colar (`Ctrl+V`) ou arrastar-e-soltar uma imagem — ex.: copiada do
  WhatsApp Web — pra tirar o **número de série**, em duas etapas (ver
  `lerCodigoDaImagem`):
  1. Tenta `POST /api/devolucao/ler-numero-serie` (backend chama um modelo de
     visão via Groq — `lib/groqOcr.ts` —, bem mais tolerante a foto real com
     reflexo/ângulo do que OCR tradicional). Exige `GROQ_API_KEY`; sem isso o
     backend responde 503 e o front trata como "sem Groq", não como erro.
  2. Se a Groq não estiver configurada ou falhar, cai pro OCR local
     (`tesseract.js`, no navegador, sem custo nem configuração): a imagem
     passa por `prepararImagemParaOcr` (aumenta a resolução e binariza pra
     preto-e-branco com limiar automático — Otsu — pra apagar fundo
     cinza/reflexo de etiqueta) antes do OCR, e depois `extrairNumeroDeSerie`
     procura a linha com "série"/"serial"/"s/n" e devolve só o valor depois
     dos dois-pontos (cai pro texto inteiro se não achar esse rótulo).

  De qualquer um dos dois caminhos, não é 100% confiável, então o campo
  continua editável pra corrigir) e
  STATUS/REEMBOLSOS (dois
  selects com as mesmas listas fixas da validação de dados da planilha).
  Tudo fica vazio por padrão exceto o que o Tiny já traz — nada é
  obrigatório além da OCORRÊNCIA. Botão "Copiar p/ planilha"
  (`navigator.clipboard`) e as últimas 10 buscas guardadas no navegador
  (`localStorage`) pra reabrir rápido.

**Formato exato do que é copiado**: uma linha por item da nota, 18 colunas
separadas por TAB (`\t`) e sem cabeçalho — A a O vêm do formulário (data,
cliente, CPF, ID pedido, NF, marketplace, ocorrência, observações,
quantidade, produto, data de recebimento, defeito, código de série, status,
reembolso — as que não foram preenchidas ficam vazias), P a R sempre vazias
(nota de devolução, nota de perda e valor recebido do banco — não tem campo
pra isso ainda). Ver `linhaParaCopia` em `src/Devolucoes.tsx` se a ordem das
colunas da planilha mudar.

**Atenção**: `lib/tinyClient.ts` faz as chamadas via GET com os parâmetros na
URL — mesmo padrão já usado (e funcionando) em `lib/olist.ts` e
`lib/relatorioVendas.ts`. Não deu pra confirmar contra a documentação ao vivo
do Tiny se `notas.fiscais.pesquisa.php`/`nota.fiscal.obter.php` aceitam GET
do mesmo jeito (`tiny.com.br` bloqueado no ambiente onde isso foi escrito) —
**teste com uma NF real antes de confiar em produção**. Se o Tiny exigir POST
pra esses dois endpoints, é só adicionar `{ method: "POST" }` no `fetch`
dentro de `tinyGet` (`lib/tinyClient.ts`).

### Importação do Shopee (Tampermonkey)

O Tiny não sabe nada sobre a devolução em si (motivo que o comprador deu,
data que ele solicitou, ID do caso no Shopee) — só sobre a venda original.
Pra trazer isso, `tampermonkey/devolucao-shopee.user.js` roda dentro do
navegador na tela de devolução do Shopee Seller
(`seller.shopee.com.br/portal/sale/return...`), raspa o que dá, e manda pro
backend via `POST /api/devolucao/shopee` — que guarda em memória, casado pelo
**ID do Pedido** (o mesmo `numero_ecommerce` que o Tiny devolve), esperando o
atendente buscar a NF correspondente aqui no sistema.

- `lib/shopeeImportacao.ts` — guarda os registros (`Map` em memória, expira em
  7 dias) e faz **merge** em vez de sobrescrever: a raspagem da tela de lista
  (rápida, vários pedidos de uma vez, mas sem a data exata da solicitação nem
  a descrição do comprador) e a raspagem da tela de detalhe de um caso
  específico (mais completa, mas uma de cada vez) se completam em vez de uma
  apagar o que a outra já achou. Também tem `mapearMotivoParaOcorrencia`, que
  reconhece o "Motivo da devolução" do Shopee e já sugere a OCORRÊNCIA — hoje
  reconhece 4 frases **confirmadas de verdade** numa tela real ("Demais
  tipos de dano..." → DANIFICADO, "Mudei de ideia" → ARREPENDIMENTO, "Recebi
  um produto com defeito funcional..." → DEFEITO, "Recebi um produto
  errado..." → ERRO OPERACIONAL); CANCELAMENTO ainda não tem frase
  confirmada, então nunca é sugerido sozinho — o atendente escolhe na mão
  nesse caso, de propósito (nunca adivinha sem evidência real, mesma lição
  do bug de voltagem). Também guarda `variacaoShopee` (campo "Opção" da tela,
  ex.: "110V") — a variação exata do item, mais confiável que tentar
  adivinhar pela descrição, mas só mostrado como informação pra conferir
  contra o PRODUTO do Tiny, não substitui automaticamente.
- `POST /api/devolucao/shopee` (`server/routes/devolucao.ts`) — aceita um
  registro só ou uma lista (array). Protegida por um token separado do
  `OLIST_API_TOKEN`: exige o header `x-import-token` batendo com
  `SHOPEE_IMPORT_TOKEN` (variável de ambiente nova, ver `.env.example`) —
  sem isso, qualquer um que descobrisse a URL podia mandar dado falso pro
  sistema. `GM_xmlhttpRequest` (usado no Tampermonkey) ignora CORS, então não
  precisa mexer em `CORS_ORIGIN` pra essa rota.
- Quando o atendente busca uma NF em `GET /api/devolucao/nf/:numero`
  (`lib/devolucao.ts`), se já existir uma importação do Shopee pro mesmo ID
  de pedido, ela vem junto no campo `shopee` da resposta — e
  `src/Devolucoes.tsx` usa isso pra pré-preencher DATA PEDIDO SAC (data real
  da solicitação, não "hoje"), OCORRÊNCIA (quando reconhecida) + OBSERVAÇÕES,
  e DEFEITO (com a descrição que o próprio comprador escreveu). Mostra
  também, só como informação (ainda sem coluna certa — ver abaixo), o
  "Reembolso ao comprador" e a "Compensação ao vendedor" que o Shopee mostra.

**Sem confirmação ainda**: se "VALOR RECEBIDO BANCO" (coluna R) é a
Compensação ao vendedor (dinheiro que entra) ou outra coisa — os dois valores
aparecem na tela só como texto informativo, nenhum vai pro texto copiado
ainda.

**Sobre os seletores do `.user.js`**: os rótulos da tela de **detalhe**
("Nº do pedido", "Nº da solicitação", "Motivo da devolução", "Descrição",
"Valor do reembolso", "Opção") já foram confirmados contra uma tela real
(não só texto colado) — `valorAposRotulo` tenta 3 formas comuns de a página
montar rótulo+valor, então tem uma chance razoável de funcionar direto. A
tela de **lista** (`/returnrefundcancel`) ainda não tem o seletor de cada
"card" de solicitação confirmado — segue marcado como `TODO` no arquivo. Pra
achar: abra essa tela, botão direito num card > Inspecionar.

### Importação do Mercado Livre (Tampermonkey)

Mesma ideia da importação do Shopee acima, só que pra devoluções do Mercado
Livre: `tampermonkey/devolucao-mercadolivre.user.js` roda na tela de
**detalhe de venda** do ML ("Pós-venda" > "Detalhe da venda" — a mesma tela
que mostra "Venda #", o status "Devolvido" e os dados do comprador), raspa o
que dá, e manda pro backend via `POST /api/devolucao/mercadolivre` — casado
pelo mesmo **"Nº do pedido"** (`numero_ecommerce`) usado pro Shopee, só que
aqui é o número que aparece em "Venda #2000018413435016" na tela do ML.

- `lib/mercadoLivreImportacao.ts` — mesmo padrão do `shopeeImportacao.ts`
  (`Map` em memória, expira em 7 dias, faz merge). `mapearMotivoParaOcorrenciaML`
  reconhece só 1 frase **confirmada numa tela real** por enquanto: "O
  comprador disse que não é da cor, tamanho ou modelo escolhido" → ERRO
  OPERACIONAL (equivalente ao "Recebi um produto errado" do Shopee). Qualquer
  outro "Problema da venda" não reconhecido devolve `null` — o atendente
  escolhe a ocorrência na mão, nunca adivinha sem evidência real.
- `POST /api/devolucao/mercadolivre` (`server/routes/devolucao.ts`) — mesmo
  esquema de segurança do `/shopee`: token próprio
  (`MERCADOLIVRE_IMPORT_TOKEN`, separado do `SHOPEE_IMPORT_TOKEN` e do
  `OLIST_API_TOKEN`, ver `.env.example`).
- Quando o atendente busca uma NF/pedido/venda em `GET /api/devolucao/nf/:numero`,
  se já existir uma importação do ML pro mesmo "Nº do pedido", ela vem junto
  no campo `mercadoLivre` da resposta — e `src/Devolucoes.tsx` usa isso pra
  pré-preencher OCORRÊNCIA (quando reconhecida) + OBSERVAÇÕES e DATA
  RECEBIMENTO (data do evento "Entregamos o pacote" da linha do tempo de
  rastreio). Mostra também, só como informação, o nome/CPF do comprador e a
  cor/SKU do item (pra conferir contra o PRODUTO/CLIENTE que vêm do Tiny).

**Confirmado contra uma tela real** (texto colado pelo usuário, não só
documentação): "Venda #NÚMERO", o nome do comprador na linha logo antes de
"USUARIO \| CPF NÚMERO", "Problema da venda:TEXTO" (sem espaço depois dos
dois-pontos nessa tela, diferente do Shopee), "Cor: X \| SKU Y", e o evento
"DIA MÊS. HH:MM \| Entregamos o pacote." na linha do tempo de rastreio — esse
último só tem dia/mês na tela (sem ano), então o script assume o ano corrente
no momento em que roda.

**Não confirmado ainda**: a URL exata da tela de detalhe de venda (o texto
colado não trouxe `location.href`) — por isso o `@match` do script é amplo
(qualquer página do domínio do Mercado Livre) e ele só age ao reconhecer os
marcadores de texto da tela ("Venda #", "Problema da venda") em vez de
confiar na URL. Também não há (ainda) um evento confirmado de "data da
solicitação da devolução" equivalente ao do Shopee — por isso DATA PEDIDO SAC
continua caindo no padrão (hoje) pra devoluções do ML.

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

## Estoque

Aba (`#estoque`): registro visual e manual do galpão, organizado pela
estrutura física real — Rua (letra) > Posição/longarina (código, ex.: "A5").
Substitui controle informal (mensagem, planilha solta) por um card por
posição com foto, quantidade contada e quem contou.

**100% manual de propósito nesta fase** — sem nenhuma lógica de visão
computacional. O formulário mostra uma nota fixa avisando que uma etapa
futura vai usar IA pra sugerir a contagem pela foto, sempre com confirmação
humana antes de salvar — por enquanto é só a nota, nenhuma função real por
trás.

- `lib/estoque.ts` — modelo de dados: cada posição guarda um **histórico**
  de contagens (nunca sobrescreve, só acrescenta — mais recente primeiro),
  persistido via `lib/store.ts` (Supabase em produção, ver seção de
  Arquitetura acima — isso inclui também o catálogo de produtos e o
  produto/voltagem de cada posição). Foto sobe pro **Cloudinary** (storage
  externo) — só a URL pública fica guardada
  no registro, nunca um arquivo local. Isso existe porque o servidor roda
  num plano sem disco persistente (ver seção de hospedagem): um arquivo
  salvo localmente desaparecia a cada deploy/"acordar" do serviço. Precisa
  de `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY` e `CLOUDINARY_API_SECRET`
  no ambiente (conta grátis em cloudinary.com) — sem isso, salvar uma
  contagem falha com um erro claro (`CloudinaryConfigError`, HTTP 503) em
  vez de uma falha genérica do SDK. **Foto é obrigatória em toda contagem,
  mesmo recontagem** — o ponto do sistema é um registro visual auditável
  por evento, não um número solto ou uma foto velha reaproveitada.
- `lib/store.ts` ganhou `update()` — leitura+modificação+escrita atômica
  (dentro da mesma fila do `set`/`get` já existentes), necessário porque
  `set()` sozinho tem uma janela onde duas contagens em posições diferentes,
  quase simultâneas, podiam se atropelar (uma sobrescrevendo o resultado da
  outra, já que as duas partiam do mesmo estado lido antes).
- `server/routes/estoque.ts` — `GET /api/estoque` (tudo agrupado por rua,
  só a contagem mais recente de cada posição), `GET /api/estoque/:rua/:codigo/historico`
  (histórico completo de uma posição), `POST /api/estoque/:rua/:codigo`
  (registra uma contagem — cria a rua/posição na hora, se não existir
  ainda). Não existe mais rota pra servir foto — o navegador busca a URL do
  Cloudinary direto, sem passar pelo nosso backend.
- `src/Estoque.tsx` — abas por rua (com "+ Nova rua", cria na hora — não
  tem lista fixa de ruas/posições no código, já que isso é a organização
  física real do galpão de cada um); grid de cards por posição, cada um
  clicável abrindo um formulário: tirar/escolher foto (`capture="environment"`,
  usa a câmera no celular), quantidade, quem contou. Foto é comprimida no
  navegador antes de enviar (`comprimirFoto`, reduz pra até 1600px de lado
  maior, JPEG) — foto de celular sai de 3-8MB, pesado demais pra mandar sem
  isso. Atualiza a lista a cada 30s (mesmo padrão "quase tempo real" do
  painel de separação).
- **Produto + Voltagem** — fixos da posição, não da contagem: definidos uma
  vez ao criar a posição (`POST /api/estoque/:rua/:codigo` exige os dois só
  nesse momento — `lib/estoque.ts` checa se já existe metadado pra decidir
  se é posição nova) e herdados automaticamente em toda recontagem seguinte,
  sem perguntar de novo. Voltagem é uma lista fixa (`110V`/`220V`/`Bivolt`).
  Produto vem de um catálogo próprio (`GET/POST /api/estoque/produtos`,
  `DELETE /api/estoque/produtos/:nome`) gerenciado em "Configurar produtos"
  na própria tela — remover um produto do catálogo não afeta posições que já
  usam ele, só tira da lista pra novas posições. Pra corrigir produto/voltagem
  de uma posição já existente (sem contar nada), tem um "Editar" dentro do
  próprio card da posição, que chama `PUT /api/estoque/:rua/:codigo/metadados`.
- **Filtro/relatório** — dois selects (produto, voltagem) acima da grade:
  com qualquer um dos dois preenchido, a grade troca de "só a rua ativa" pra
  "todas as ruas que combinam com o filtro" (com o código mostrando a rua
  junto, já que mistura ruas) e aparece um total de posições + unidades
  combinando. É uma visão/filtro só na própria tela — sem exportação.

**Não implementado nesta fase** (fora do escopo pedido): nenhuma integração
com o Tiny pra pré-preencher produtos esperados por posição — seria um
facilitador puramente opcional, e a contagem continuaria sendo sempre manual
mesmo com isso. Exportação do relatório (CSV/planilha) também não — por
enquanto é só a visão filtrada na tela.

## Embalagem

Aba (`#embalagem`): quantos pedidos cada colaborador embalou num dia,
calculado automaticamente a partir do Tiny — sem ninguém digitar a
quantidade na mão (diferente de uma planilha/HTML solto que só calcula
`pedidos ÷ pedidos-por-hora` em cima de um número que alguém lançou).

- `lib/embalagem.ts` — fluxo:
  1. `separacao.pesquisa.php?situacao=3&dataInicial=X&dataFinal=Y&pagina=N`
     lista os RESUMOS de separações "Embalada" — mesmo endpoint+parâmetros já
     confirmados em produção por `lib/olist.ts` (painel de separação). Não
     existe filtro de `dataCheckout` na busca, só `dataCriacao`, então usa a
     mesma janela de dias (`OLIST_EMBALADAS_WINDOW_DAYS`, reaproveitada) e
     filtra por `dataCheckout === dia` no próprio código — igual
     `countEmbaladasHoje` em `lib/olist.ts`.
  2. Pra cada resumo com `dataCheckout` do dia pedido,
     `separacao.obter.php?idSeparacao=X` traz o detalhe — com o campo
     `idUsuarioEmbalador`, que identifica quem embalou (um ID numérico, não
     o nome) — **confirmado contra dados reais de produção**.
  3. Um cadastro próprio (não fica no Tiny) mapeia `idUsuarioEmbalador` →
     nome do colaborador — editável pela própria aba, sem precisar de
     deploy. Um ID sem cadastro aparece no relatório como `ID 12345 (sem
     nome cadastrado)` em vez de ser escondido.

  **Quem chama o Tiny**: só `sincronizarEmbalagemHoje`, acionada por um job
  de fundo em `server/index.ts` (mesmo padrão de `fetchCoreCountsLive` em
  `lib/olist.ts`) — nunca uma requisição HTTP direto. `GET /api/embalagem`
  pro dia de HOJE só lê o que esse job já deixou em cache; nunca bloqueia
  nem conta pro limite de taxa do Tiny, pode pollar à vontade. Um dia
  PASSADO específico (`?dia=` diferente de hoje) ainda busca ao vivo — é
  consulta rara/manual, e a resolução por separação normalmente já está
  quente no cache de quando esse dia era "hoje".

  `separacao.obter.php` custa **1 chamada ao Tiny por separação** — caro no
  volume real desse negócio (centenas de pedidos/dia). Por isso o resultado
  é cacheado por `idSeparacao` pra sempre (depois de embalada, quem embalou
  não muda): cada sincronização só resolve as separações NOVAS desde a
  última vez, não o dia inteiro de novo. Um teto de segurança
  (`MAX_RESOLUCOES_POR_CHAMADA`) limita quantas separações NOVAS uma única
  sincronização resolve — o resto fica pra próxima (`completo: false` na
  resposta avisa o front disso), pra nunca gerar uma rajada grande de
  chamadas de uma vez (isso já causou bloqueio de limite de taxa na
  prática, com a cache fria logo depois de um deploy/redeploy).
- `server/index.ts` — `syncEmbalagemOnce`, no mesmo esquema de
  `syncCoreOnce`/`syncEmbaladasOnce`: roda a cada
  `EMBALAGEM_SYNC_INTERVAL_MS` (padrão 60s), com um atraso no boot
  (30s) pra não colidir com os outros dois syncs bem na subida.
- `server/routes/embalagem.ts` — `GET /api/embalagem?dia=dd/mm/yyyy` (sem
  isso, usa hoje), `GET/POST /api/embalagem/colaboradores`,
  `DELETE /api/embalagem/colaboradores/:idUsuarioEmbalador`.
- `src/Embalagem.tsx` — tabela (Colaborador/Pedidos/Pedidos-Hora/Tempo),
  total, aviso de "ainda sincronizando" quando `completo: false`, e uma
  seção pra cadastrar/remover colaboradores. Atualiza a cada 30s (seguro:
  só lê cache) e tem botão "Atualizar" pra quem quer forçar uma olhada na
  hora, sem esperar o próximo tick.

`EMBALAGEM_PEDIDOS_POR_HORA` (variável de ambiente, padrão 50) troca o
"pedidos por hora" usado pra calcular o tempo — mesmo valor do protótipo
original, configurável sem precisar editar código.

## Desenvolvimento

```bash
npm test
npm run typecheck
npm run lint
npm run build     # build de produção do front (Vite) em dist/
npm start         # roda o Express, servindo a API e o build de dist/
```

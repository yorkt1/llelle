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

## Devolução

Aba separada (link discreto no canto inferior esquerdo, ou `#devolucao` na
URL) pro setor de devolução: digita o código do pedido (ou o número do
marketplace, quando é esse que o cliente/nota trazem), e o Tiny já devolve
cliente e produto — só falta descrever o defeito antes de registrar.

- `lib/devolucoes.ts` — busca no Tiny (só leitura, nunca escreve nada lá) e
  guarda os registros de devolução no mesmo KV de arquivo local
  (`lib/store.ts`) que o painel de separação já usa.
- `server/routes/devolucoes.ts` — `GET /api/devolucoes/buscar?codigo=X` (busca
  ao vivo, não salva nada), `GET /api/devolucoes` (histórico) e
  `POST /api/devolucoes` (registra).
- `src/Devolucoes.tsx` — formulário: busca → confere cliente/produto trazidos
  → escolhe o produto (quando o pedido tem mais de um item) → descreve o
  defeito → registra. Lista embaixo as últimas devoluções já registradas.

Fluxo de busca no Tiny (API 2.0, mesmo token da `OLIST_API_TOKEN`):

1. `pedidos.pesquisa.php?numero=X` acha o `id` do pedido. Se não achar, tenta
   de novo por `numeroEcommerce=X` (número que o marketplace mostra pro
   cliente, quando é diferente do número interno do Tiny).
2. `pedido.obter.php?id=Y` traz cliente (nome, CPF/CNPJ) e os itens do pedido.
3. `notas.fiscais.pesquisa.php?numeroPedido=X` tenta achar o número da nota
   fiscal vinculada — só um extra: se falhar ou não achar, o campo fica vazio
   e não trava o resto do fluxo.

**Atenção**: os nomes de endpoint/campo acima (`pedidos.pesquisa.php`,
`pedido.obter.php`, `cpf_cnpj`, `tipo_pessoa`, `notas.fiscais.pesquisa.php`
etc.) seguem o padrão conhecido da API 2.0 do Tiny, mas não deu pra confirmar
contra a documentação ao vivo (`tiny.com.br` bloqueado no ambiente onde isso
foi escrito). **Teste com um código de pedido real antes de confiar nisso em
produção.** Se o Tiny devolver um formato diferente, o erro sobe com a
mensagem literal da API (ver `falhaComDetalhe` em `lib/devolucoes.ts`), o que
já indica o que ajustar — os nomes de campo estão isolados nas interfaces
`PedidoDetalhe`/`PedidoPesquisaResponse`/`NotaFiscalPesquisaResponse` desse
arquivo, então corrigir é só questão de acertar os nomes ali.

## Desenvolvimento

```bash
npm test
npm run typecheck
npm run lint
npm run build     # build de produção do front (Vite) em dist/
npm start         # roda o Express, servindo a API e o build de dist/
```

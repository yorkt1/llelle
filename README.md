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
- `lib/olist.ts` — `fetchSeparacaoCountsLive()` (bate na API de verdade) + `getCachedCounts()` (serve o cache).
- `server/routes/separacao.ts` — `GET /api/separacao` (cache, rápido) e `POST /api/separacao/sync` (força uma sincronização sob demanda).
- `server/index.ts` — sobe o Express e agenda a sincronização a cada 30s (padrão) com `setInterval` — como o processo fica sempre no ar (Render, PC do escritório etc.), não precisa de Vercel Cron nem Vercel KV.
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
  (`dataCheckout === hoje`) fica com ~0,5% de diferença testada contra a tela
  real (375 vs 377) — aceita conscientemente. Diferente de Separadas, essa fila
  nunca esvazia (~500-600 embalagens/dia acumuladas), então não dá pra buscar
  sem filtro de data: filtra por `dataCriacao` numa janela de dias
  (`OLIST_EMBALADAS_WINDOW_DAYS`, padrão 3) com um teto de páginas (40, ~4000
  registros) pra nunca arriscar o limite não documentado da API (`codigo_erro
  35` visto em ~50+ páginas nos testes). Se estourar o teto, essa etapa falha
  isolada e mantém o último valor em cache — não derruba as outras 3.

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

## Desenvolvimento

```bash
npm test
npm run typecheck
npm run lint
npm run build     # build de produção do front (Vite) em dist/
npm start         # roda o Express, servindo a API e o build de dist/
```

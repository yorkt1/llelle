# Coluna do dia — controle de estoque

Gera automaticamente a coluna diária de saldo da planilha de estoque, a partir do
relatório de vendas exportado do Tiny.

Entrada: relatório de vendas do dia + saldo da última coluna preenchida.
Saída: uma coluna pronta para colar, um valor por linha, na ordem da planilha.

## Rodando

```bash
npm install
npm run dev      # front em http://localhost:5173, API em http://localhost:4000
```

`npm run dev` sobe os dois processos juntos (Vite + Express); o Vite faz proxy
de `/api/*` para o Express, então a UI só conhece caminhos relativos.

Sem nenhuma configuração o app já funciona: os dados ficam num arquivo JSON em
`data/vitae-db.json`.

### Supabase (opcional)

Preencha `.env.local` a partir de `.env.example`:

```
SUPABASE_URL=...                 # Project Settings > Data API > Project URL
SUPABASE_SERVICE_ROLE_KEY=...    # Project Settings > API Keys > service_role
```

**Passo obrigatório:** abra o SQL Editor do projeto e rode o conteúdo de
[`src/lib/supabase/schema.sql`](src/lib/supabase/schema.sql). Sem isso as tabelas
não existem e o app avisa na tela.

A `service_role` key ignora RLS e por isso só é usada no servidor (`server/`) —
nunca é lida ou embutida no bundle do navegador.

## Primeiro uso

Em **Produtos e saldos**, cole da planilha a coluna de produtos junto com a
última coluna de saldo preenchida:

```
ABAJUR AMARELO	221
ABAJUR AZUL	44
AQUECEDOR 110V	97
```

A ordem das linhas coladas é a ordem da planilha — é ela que faz a coluna gerada
colar alinhada de volta. Se a planilha tiver SKU, cole também
(`NOME ⇥ SKU ⇥ SALDO`): o SKU é o que casa os anúncios do Tiny sem depender do
nome.

## Dia a dia

1. Suba o relatório de vendas do Tiny (CSV ou XLSX).
2. Escolha a data — ou marque "agrupa vários dias" para uma coluna tipo
   `04/09 à 07/09`.
3. Escolha o modo de contagem.
4. Resolva os produtos que o sistema não conseguiu mapear sozinho.
5. Copie a coluna e cole na planilha.
6. **Fechar o dia** grava o saldo, que vira o saldo anterior de amanhã.

## Os dois modos de contagem

A decisão de qual adotar ainda está em aberto, então os dois convivem e a
comparação fica visível na tela.

- **Por Pedido** — soma os pedidos do período, ignorando os cancelados.
- **Por Nota Fiscal** — soma só o que virou nota emitida no período.

Quais situações entram na conta é ajustável em "Ajustes do relatório", junto com
o filtro de canais (o full de Amazon/Mercado Livre pode ser separado ali).

**Importante:** o relatório agregado do Tiny (`E-commerce | Produto | Código
(SKU) | Quantidade | ...`) não traz dados de nota fiscal. Com ele só o modo Por
Pedido tem base, e o app diz isso em vez de fingir que comparou. Para comparar os
dois modos, exporte também o relatório por nota fiscal e envie no segundo campo.

## Mapeamento de nomes

O relatório traz o título do anúncio ("Aquecedor de Ambiente Elétrico 110V
Portátil"); a planilha usa o nome curto ("AQUECEDOR 110V"). O sistema resolve
nesta ordem: mapeamento já salvo → SKU exato → nome exato → similaridade.

Só mapeia sozinho quando a confiança é alta e não há empate. Especificação
numérica divergente (110V vs 220V) derruba o score de propósito — errar isso
baixaria o estoque do produto errado. O resto vai para confirmação humana, e a
resposta fica salva em **Mapeamentos** para não perguntar de novo.

Um produto do relatório que não existe na planilha nunca é descartado em
silêncio: aparece em destaque e trava o fechamento até alguém decidir.

## Desenvolvimento

```bash
npm test         # testes do domínio
npm run typecheck
npm run lint
npm run build    # build de produção do front (Vite) em dist/
npm start        # roda o Express (server/), servindo a API e o build de dist/
```

Onde as coisas estão:

| Caminho | O quê |
|---|---|
| `src/pages/`, `src/components/`, `src/App.tsx` | Frontend (Vite + React + React Router) |
| `server/` | API HTTP (Express) — uma rota por recurso, monta os mesmos módulos de domínio |
| `src/lib/domain/parser/` | Leitura de CSV/XLSX, encoding, detecção de colunas |
| `src/lib/domain/aggregate.ts` | Os dois modos de contagem |
| `src/lib/domain/matching.ts` | Nome do relatório → linha da planilha |
| `src/lib/domain/column.ts` | Montagem da coluna e formatos de exportação |
| `src/lib/service/columns.ts` | Orquestra prévia e fechamento |
| `src/lib/storage/` | Persistência: driver Supabase e driver arquivo |

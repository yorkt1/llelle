# Vitae — stack

Frontend: Vite + React + React Router (`src/`, entry em `src/main.tsx`).
Backend: Express (`server/`), reaproveitando a lógica de domínio de `src/lib/`.

Em dev, `npm run dev` sobe os dois processos juntos (Vite em `:5173`, API em
`:4000`); o Vite faz proxy de `/api/*` para o Express.

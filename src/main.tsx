import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "@/App";
import "@/styles/globals.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Painel fica com a aba aberta indefinidamente numa TV — recarrega a página
// inteira de tempos em tempos pra nunca acumular estado travado e pra sempre
// pegar um deploy novo do código, sem precisar de ninguém dar F5 na TV.
const RELOAD_INTERVAL_MS = 60 * 60 * 1000; // 1h
setTimeout(() => window.location.reload(), RELOAD_INTERVAL_MS);

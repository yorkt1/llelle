import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    // Testes de componente (.tsx) declaram `// @vitest-environment jsdom` no topo do arquivo —
    // o resto (lib/ puro Node) fica em "node" por padrão, mais rápido e sem simular navegador.
    setupFiles: ["tests/setup-react.ts"],
  },
});

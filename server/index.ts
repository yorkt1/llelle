import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import express from "express";
import multer from "multer";
import { statusRouter } from "./routes/status";
import { productsRouter } from "./routes/products";
import { mappingsRouter } from "./routes/mappings";
import { previewRouter } from "./routes/preview";
import { snapshotsRouter } from "./routes/snapshots";
import { uploadsRouter } from "./routes/uploads";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

config({ path: path.resolve(__dirname, "../.env.local") });
config({ path: path.resolve(__dirname, "../.env") });

const app = express();
app.use(express.json());

app.use("/api/status", statusRouter);
app.use("/api/products", productsRouter);
app.use("/api/mappings", mappingsRouter);
app.use("/api/preview", previewRouter);
app.use("/api/snapshots", snapshotsRouter);
app.use("/api/uploads", uploadsRouter);

app.use((error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
    res.status(400).json({ error: "Arquivo maior que 25 MB." });
    return;
  }
  next(error);
});

// Quando existe um build do Vite (dist/), o backend tambem serve o front — assim "npm start" sobe tudo.
const staticDir = path.resolve(__dirname, "../dist");
if (fs.existsSync(staticDir)) {
  app.use(express.static(staticDir));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(staticDir, "index.html")));
}

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => {
  console.log(`API rodando em http://localhost:${port}`);
});

// Production server: serves the built app from dist/ and the news API. Run `npm run build` first.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { handleApi, warmUp } from "./api.mjs";

const DIST = fileURLToPath(new URL("../dist/", import.meta.url));
const PORT = Number(process.env.PORT) || 4173;
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".jpg": "image/jpeg", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".ico": "image/x-icon" };

createServer(async (req, res) => {
  if (req.url.startsWith("/api/")) return handleApi(req, res);
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^(\.\.[/\\])+/, "");
  let file = join(DIST, path);
  try {
    if ((await stat(file)).isDirectory()) file = join(file, "index.html");
  } catch {
    file = join(DIST, "index.html");
  }
  try {
    const body = await readFile(file);
    const ext = extname(file);
    const immutable = file.includes("/assets/") || file.includes("/textures/");
    res.writeHead(200, { "content-type": TYPES[ext] || "application/octet-stream", "cache-control": immutable ? "public, max-age=604800" : "no-cache" });
    res.end(body);
  } catch {
    res.writeHead(404).end("Not found");
  }
}).listen(PORT, () => {
  warmUp();
  console.log(`Prakash running at http://localhost:${PORT}`);
});

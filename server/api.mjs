// Shared HTTP handler for /api/* — mounted by the Vite dev server and by server.mjs in production.
import { gzipSync } from "node:zlib";
import { startNewsEngine, getStatus, getAllNews, getCountryNews, searchNews } from "./news.mjs";

let started = false;

function send(req, res, status, data, maxAge = 0) {
  let body = Buffer.from(JSON.stringify(data));
  const headers = { "content-type": "application/json; charset=utf-8", "cache-control": maxAge ? `public, max-age=${maxAge}` : "no-store" };
  if (body.length > 1024 && /\bgzip\b/.test(req.headers["accept-encoding"] || "")) {
    body = gzipSync(body);
    headers["content-encoding"] = "gzip";
  }
  headers["content-length"] = body.length;
  res.writeHead(status, headers);
  res.end(body);
}

export async function handleApi(req, res) {
  if (!started) { started = true; startNewsEngine(); }
  const url = new URL(req.url, "http://local");
  try {
    switch (url.pathname) {
      case "/api/status":
        return send(req, res, 200, getStatus());
      case "/api/news":
        return send(req, res, 200, getAllNews());
      case "/api/country": {
        const data = await getCountryNews((url.searchParams.get("code") || "").toUpperCase());
        return send(req, res, data.status || 200, data, 60);
      }
      case "/api/search":
        return send(req, res, 200, await searchNews(url.searchParams.get("q") || ""), 60);
      default:
        return send(req, res, 404, { error: "Not found" });
    }
  } catch (err) {
    return send(req, res, 502, { error: "Upstream news source failed", detail: String(err?.message || err) });
  }
}

export function warmUp() {
  if (!started) { started = true; startNewsEngine(); }
}

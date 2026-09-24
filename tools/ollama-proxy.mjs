#!/usr/bin/env node
/**
 * Optional CORS helper for static `dist/` when the browser blocks
 * direct calls to localhost:11434. Not required for `npm run dev`
 * (Vite already proxies /ollama) or for Chrome→localhost Ollama
 * (CORS usually allowed).
 *
 *   node tools/ollama-proxy.mjs
 *   # then set localStorage or open via a tiny rewrite — prefer fixing
 *   # OLLAMA_ORIGINS instead. See results.md Phase 2.5.
 */
import http from "node:http";
import { request as httpRequest } from "node:http";

const LISTEN = Number(process.env.PROXY_PORT || 11435);
const UPSTREAM = process.env.OLLAMA_HOST || "127.0.0.1";
const UP_PORT = Number(process.env.OLLAMA_PORT || 11434);

const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const opts = {
    hostname: UPSTREAM,
    port: UP_PORT,
    path: req.url,
    method: req.method,
    headers: { ...req.headers, host: `${UPSTREAM}:${UP_PORT}` },
  };

  const proxy = httpRequest(opts, (up) => {
    res.writeHead(up.statusCode || 502, {
      ...up.headers,
      "Access-Control-Allow-Origin": "*",
    });
    up.pipe(res);
  });
  proxy.on("error", (err) => {
    res.writeHead(502, { "Content-Type": "text/plain" });
    res.end(`ollama proxy error: ${err.message}`);
  });
  req.pipe(proxy);
});

server.listen(LISTEN, "127.0.0.1", () => {
  console.log(`ollama CORS proxy on http://127.0.0.1:${LISTEN} → ${UPSTREAM}:${UP_PORT}`);
});

// Local HTTP harness for the webOS service modules (desktop verification only).
// Mirrors the Luna methods so the web app can be exercised in Chromium / TV browser.
import http from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const svcDir = path.resolve(__dirname, "..", "webos", "services", "com.webosflux.xuptertv.fidelity.service");
const magis = require(path.join(svcDir, "magis.js"));
const proxy = require(path.join(svcDir, "proxy.js"));

const PORT = Number(process.argv[2] || 8910);

const json = (res, status, data) => {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json;charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store",
  });
  res.end(body);
};

const server = http.createServer((req, res) => {
  const u = new URL(req.url, `http://127.0.0.1:${PORT}`);
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "content-type",
    });
    res.end();
    return;
  }
  const done = (err, data) => (err ? json(res, 502, { returnValue: false, errorText: String(err.message || err), errorCode: err.portalCode || 1 }) : json(res, 200, { returnValue: true, ...data }));

  if (u.pathname === "/ping") return json(res, 200, { returnValue: true, port: PORT, proxy: proxy.port() });
  if (u.pathname === "/home") return magis.home(u.searchParams.get("root") || "movies", done);
  if (u.pathname === "/search") return magis.search(u.searchParams.get("value") || "", done);
  if (u.pathname === "/detail") {
    return magis.detail(u.searchParams.get("contentId") || u.searchParams.get("id") || "", done);
  }
  if (u.pathname === "/resolve") {
    const contentId = u.searchParams.get("contentId") || u.searchParams.get("id") || "";
    const seriesId = u.searchParams.get("seriesContentId") || u.searchParams.get("series") || "";
    return magis.resolve(contentId, seriesId, (err, stream) => {
      if (err) return done(err);
      proxy.start((perr) => {
        if (perr) return done(perr);
        const isTs = (stream.mime === 'video/mp2t' || /\.ts(?:\?|$)/i.test(stream.url));
        const token = proxy.add(stream.url, stream.headers, stream.duration);
        if (isTs) {
          stream.proxyPath = proxy.baseUrl() + '/media/' + token + '/stream.m3u8';
          stream.mime = 'application/vnd.apple.mpegurl';
          stream.isHls = true;
        } else {
          stream.proxyPath = proxy.baseUrl() + '/media/' + token + '/stream.mp4';
        }
        done(null, stream);
      });
    });
  }
  json(res, 404, { returnValue: false, errorText: "not found" });
});

proxy.start((err, p) => {
  if (err) { console.error("proxy error", err); process.exit(1); }
  server.listen(PORT, "127.0.0.1", () => {
    console.log(`dev service running on http://127.0.0.1:${PORT} (media proxy on ${p})`);
  });
});

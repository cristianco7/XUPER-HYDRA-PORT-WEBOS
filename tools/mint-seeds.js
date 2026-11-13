#!/usr/bin/env node
"use strict";

var fs = require("fs");
var path = require("path");

var SVC_DIR = path.join(
  __dirname,
  "..",
  "webos",
  "services",
  "com.webosflux.xuptertv.fidelity.service"
);

function arg(name, fallback) {
  var i = process.argv.indexOf("--" + name);
  if (i === -1 || i + 1 >= process.argv.length) return fallback;
  return process.argv[i + 1];
}

var COUNT = Math.max(1, parseInt(arg("count", "30"), 10) || 30);
var MAX = Math.max(1, parseInt(arg("max", "200"), 10) || 200);
var TTL_HOURS = Math.max(1, parseFloat(arg("ttl-hours", "8")) || 8);
var POOL_FILE = path.resolve(arg("pool", path.join(__dirname, "..", "dist", "seeds", "seeds.json")));
var OUT_FILE = path.resolve(arg("out", POOL_FILE));

/* magis.js guarda su pool en /tmp; en un proceso nuevo queremos empezar limpio
   para no confundir semillas viejas con la activación real que vamos a probar. */
["/tmp/xuper-seeds.json", "/tmp/xuper-seeds-dead.json"].forEach(function (f) {
  try {
    fs.unlinkSync(f);
  } catch (e) {}
});

var magis = require(path.join(SVC_DIR, "magis.js"));
var upstream = require(path.join(SVC_DIR, "upstream.js"));
var https = require("https");
var http = require("http");
var net = require("net");

var backupProxies = [];

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function log(msg) {
  console.log("[mint] " + msg);
}

function resetSession() {
  var s = magis.session;
  s.ready = false;
  s.userId = "";
  s.userToken = "";
  s.snToken = "";
  s.seed = null;
  s.usesSeed = false;
  s.at = 0;
  s.lastError = "";
}

function fetchUrl(u, timeoutMs, cb) {
  var mod = u.indexOf("https:") === 0 ? https : http;
  var req = mod.get(u, { timeout: timeoutMs || 7000 }, function (res) {
    var d = "";
    res.on("data", function (c) { d += c; });
    res.on("end", function () { cb(null, d); });
  });
  req.on("error", cb);
  req.on("timeout", function () {
    try { req.abort(); } catch (e) {}
    cb(new Error("timeout"));
  });
}

function fetchLatamProxies(cb) {
  var urls = [
    "https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=7000&country=CO,MX,PE,EC,AR,CL,BR,BO,UY,PY,PA,CR,GT,DO&ssl=yes",
    "https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=7000&country=CO,MX,PE,EC,AR,CL,BR,BO,UY,PY,PA,CR,GT,DO&ssl=all",
    "https://proxylist.geonode.com/api/proxy-list?country=CO&protocols=http%2Chttps&limit=30&sort_by=lastChecked&sort_type=desc",
    "https://proxylist.geonode.com/api/proxy-list?country=MX&protocols=http%2Chttps&limit=30&sort_by=lastChecked&sort_type=desc",
    "https://proxylist.geonode.com/api/proxy-list?country=PE&protocols=http%2Chttps&limit=25&sort_by=lastChecked&sort_type=desc",
    "https://proxylist.geonode.com/api/proxy-list?country=AR&protocols=http%2Chttps&limit=25&sort_by=lastChecked&sort_type=desc",
    "https://proxylist.geonode.com/api/proxy-list?country=CL&protocols=http%2Chttps&limit=25&sort_by=lastChecked&sort_type=desc",
    "https://proxylist.geonode.com/api/proxy-list?country=EC&protocols=http%2Chttps&limit=25&sort_by=lastChecked&sort_type=desc"
  ];
  var results = [];
  var pending = urls.length;

  urls.forEach(function (u) {
    fetchUrl(u, 7000, function (err, d) {
      if (!err && d) {
        if (d.trim().indexOf("{") === 0) {
          try {
            var j = JSON.parse(d);
            if (j && Array.isArray(j.data)) {
              j.data.forEach(function (x) {
                if (x && x.ip && x.port) results.push(x.ip + ":" + x.port);
              });
            }
          } catch (e) {}
        } else {
          var lines = d.split(/\r?\n/);
          lines.forEach(function (l) {
            var s = l.trim();
            if (s && /^[\d\.]+\:\d+$/.test(s)) results.push(s);
          });
        }
      }
      if (--pending === 0) {
        var seen = {};
        var unique = [];
        results.forEach(function (p) {
          if (!seen[p]) {
            seen[p] = true;
            unique.push(p);
          }
        });
        cb(null, unique);
      }
    });
  });
}

function testConnect(proxyStr, targetHost, targetPort, timeoutMs, cb) {
  var parts = proxyStr.split(":");
  var host = parts[0];
  var port = parseInt(parts[1], 10);
  if (!host || !port) return cb(new Error("invalid"));
  var done = false;
  var socket;
  function finish(err, ok) {
    if (done) return;
    done = true;
    if (socket) {
      try { socket.destroy(); } catch (e) {}
    }
    cb(err, ok);
  }
  var timer = setTimeout(function () {
    finish(new Error("timeout"));
  }, timeoutMs);

  try {
    socket = net.connect(port, host, function () {
      socket.write("CONNECT " + targetHost + ":" + targetPort + " HTTP/1.1\r\nHost: " + targetHost + ":" + targetPort + "\r\n\r\n");
    });
    socket.setTimeout(timeoutMs, function () {
      finish(new Error("timeout"));
    });
    socket.on("error", finish);
    socket.on("data", function (chunk) {
      var s = chunk.toString();
      if (/HTTP\/1\.[01]\s+200/i.test(s)) {
        clearTimeout(timer);
        finish(null, true);
      } else {
        finish(new Error("status " + s.slice(0, 20)));
      }
    });
  } catch (e) {
    finish(e);
  }
}

function probeProxy(proxy, cb) {
  upstream.configure("http://" + proxy);
  resetSession();
  var done = false;
  var timer = setTimeout(function () {
    if (done) return;
    done = true;
    cb(new Error("timeout"));
  }, 9000);

  magis.ensureSession(function (err) {
    if (done) return;
    done = true;
    clearTimeout(timer);
    if (err) return cb(err);
    if (magis.session.usesSeed || !magis.session.userId) return cb(new Error("bloqueado"));
    cb(null, proxy);
  });
}

function ensureWorkingRoute(cb) {
  var forcedProxy = arg("proxy", "");
  if (forcedProxy) {
    log("usando proxy forzado por argumento: " + forcedProxy);
    upstream.configure(forcedProxy);
    return cb(null);
  }

  log("verificando conectividad directa con el portal...");
  resetSession();
  magis.ensureSession(function (err) {
    if (!err && !magis.session.usesSeed && magis.session.userId) {
      log("conexión directa funcional (zona no bloqueada)");
      return cb(null);
    }
    log("conexión directa bloqueada por región (portal100024); buscando proxy regional LatAm para GitHub Actions...");
    fetchLatamProxies(function (err2, list) {
      if (!list || !list.length) {
        log("no se obtuvieron proxies de las listas");
        return cb(new Error("sin proxies disponibles"));
      }
      log("reunidos " + list.length + " proxies candidatos de LatAm. Filtrando TCP CONNECT en paralelo...");

      var candidates = list.slice(0, 150);
      var live = [];
      var tested = 0;
      candidates.forEach(function (p) {
        testConnect(p, "cloudflare.com", 443, 6000, function (err3, ok) {
          if (!err3 && ok) {
            live.push(p);
          }
          if (++tested === candidates.length) {
            log("proxies con túnel CONNECT activo: " + live.length);
            if (!live.length) {
              return cb(new Error("ningún proxy respondió al túnel CONNECT"));
            }
            var idx = 0;
            function tryNextLive() {
              if (idx >= live.length) {
                return cb(new Error("ningún proxy activo logró activar sesión en Magis"));
              }
              var cand = live[idx++];
              probeProxy(cand, function (err4, ok) {
                if (!err4 && ok) {
                  log("proxy LatAm activo y desbloqueado: " + ok);
                  backupProxies = live.slice(idx);
                  if (backupProxies.length > 0) {
                    log("proxies de respaldo listos ante fallas: " + backupProxies.length);
                  }
                  return cb(null);
                }
                tryNextLive();
              });
            }
            tryNextLive();
          }
        });
      });
    });
  });
}

/* Una semilla nueva: activación anónima real + catálogo real.
   Si el portal contesta portal100024 (zona bloqueada) o aaa100028 (sesión
   muerta), esta IP no sirve para acuñar y hay que abortar el lote. */
function mintOne(cb) {
  resetSession();
  var finished = false;
  var timer = setTimeout(function () {
    if (finished) return;
    finished = true;
    cb(new Error("timeout acuñando la semilla"));
  }, 90000);

  function finish(err, seed) {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    cb(err, seed);
  }

  magis.ensureSession(function (err) {
    if (err) return finish(err);
    var s = magis.session;
    if (s.usesSeed) return finish(new Error("el portal devolvió una semilla en vez de activar (zona bloqueada)"));
    if (!s.userId || !s.userToken) return finish(new Error("activación incompleta"));
    magis.home("movies", 1, function (err2, res) {
      if (err2) return finish(err2);
      var list = res && res.items ? res.items : res;
      var n = (list && list.length) || 0;
      if (n < 1) return finish(new Error("el catálogo vino vacío: sesión sin acceso"));
      finish(null, {
        sn: String(s.sn || "").toLowerCase(),
        userId: String(s.userId),
        userToken: String(s.userToken),
        mintedAt: nowSec(),
        exp: nowSec() + Math.round(TTL_HOURS * 3600),
        items: n,
      });
    });
  });
}

function readPool() {
  try {
    var raw = JSON.parse(fs.readFileSync(POOL_FILE, "utf8"));
    var list = raw && raw.seeds ? raw.seeds : raw;
    return Array.isArray(list) ? list : [];
  } catch (e) {
    return [];
  }
}

function usable(entry, at) {
  if (!entry || !entry.userId || !entry.userToken || !entry.sn) return false;
  if (typeof entry.exp === "number" && entry.exp > 0 && entry.exp - at < 600) return false;
  return true;
}

function merge(oldList, fresh) {
  var at = nowSec();
  var bySn = {};
  var order = [];

  function add(e) {
    if (!usable(e, at)) return;
    var sn = String(e.sn).toLowerCase();
    if (!bySn[sn]) {
      order.push(sn);
      bySn[sn] = {
        sn: sn,
        userId: String(e.userId),
        userToken: String(e.userToken),
        mintedAt: e.mintedAt || at,
        exp: e.exp || at + Math.round(TTL_HOURS * 3600),
      };
    } else if ((e.mintedAt || 0) >= (bySn[sn].mintedAt || 0)) {
      bySn[sn] = {
        sn: sn,
        userId: String(e.userId),
        userToken: String(e.userToken),
        mintedAt: e.mintedAt || at,
        exp: e.exp || at + Math.round(TTL_HOURS * 3600),
      };
    }
  }

  fresh.forEach(add);
  oldList.forEach(add);

  var list = order.map(function (sn) {
    return bySn[sn];
  });
  /* Más nuevas primero; si sobran, se quedan las de vida más larga. */
  list.sort(function (a, b) {
    return (b.exp || 0) - (a.exp || 0) || (b.mintedAt || 0) - (a.mintedAt || 0);
  });
  return list.slice(0, MAX);
}

function writePool(seeds) {
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify({ at: Date.now(), seeds: seeds }, null, 1) + "\n");
  log("pool escrito en " + OUT_FILE + " (" + seeds.length + " semillas)");
}

log("servicio: " + SVC_DIR);
log("acuñando " + COUNT + " semillas (vida declarada " + TTL_HOURS + " h)");

var fresh = [];
var i = 0;

function next() {
  if (i >= COUNT) return done();
  i++;
  var t0 = Date.now();
  mintOne(function (err, seed) {
    if (err) {
      log("intento " + i + "/" + COUNT + " FALLÓ: " + (err.message || err));
      if (backupProxies && backupProxies.length > 0) {
        var nextProxy = backupProxies.shift();
        log("Proxy actual falló; cambiando a proxy de respaldo: " + nextProxy + " (" + backupProxies.length + " restantes)");
        upstream.configure("http://" + nextProxy);
        resetSession();
        i--;
        setTimeout(next, 1000);
        return;
      }
      /* Un bloqueo de zona sin más proxies no se arregla insistiendo: abortar el lote. */
      if (/portal100024|zona bloqueada|aaa10002[78]/i.test(String(err.message || err))) {
        return done(true);
      }
    } else {
      fresh.push(seed);
      log("intento " + i + "/" + COUNT + " ok: sn=" + seed.sn.slice(0, 12) + " items=" + seed.items + " (" + (Date.now() - t0) + " ms)");
    }
    setTimeout(next, 700);
  });
}

var SOFT_FAIL = process.argv.indexOf("--soft-fail") !== -1;

function done(aborted) {
  if (!fresh.length) {
    log(aborted ? "ABORTADO: esta IP está bloqueada por el portal; no se acuñó ninguna semilla." : "sin semillas nuevas; el pool queda como estaba.");
    /* Si se pasa --soft-fail (usado en CI / GitHub Actions), un bloqueo de IP
       no rompe el pipeline: se conserva el pool anterior intacto y se sale con 0. */
    process.exitCode = SOFT_FAIL ? 0 : (aborted ? 2 : 1);
    return;
  }
  var seeds = merge(readPool(), fresh);
  writePool(seeds);
  log("nuevas: " + fresh.length + " / pool final: " + seeds.length);
  process.exitCode = 0;
}

ensureWorkingRoute(function (err) {
  if (err) {
    log("No se pudo establecer ruta sin bloqueo: " + (err.message || err));
    return done(true);
  }
  next();
});

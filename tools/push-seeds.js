#!/usr/bin/env node
"use strict";

var cp = require("child_process");
var fs = require("fs");
var path = require("path");

var poolPath = path.resolve(__dirname, "..", "dist", "seeds", "seeds.json");
if (!fs.existsSync(poolPath)) {
  console.error("No se encontró el archivo de semillas en: " + poolPath);
  process.exit(1);
}

try {
  var raw = JSON.parse(fs.readFileSync(poolPath, "utf8"));
  var count = (raw.seeds && raw.seeds.length) || 0;
  console.log("[push-seeds] Publicando " + count + " semillas a GitHub (rama seeds)...");

  // Actualizar el fallback empaquetado local para futuras compilaciones
  var fallbackPath = path.resolve(
    __dirname,
    "..",
    "webos",
    "services",
    "com.webosflux.xuptertv.fidelity.service",
    "seeds-fallback.json"
  );
  fs.writeFileSync(fallbackPath, JSON.stringify(raw, null, 2) + "\n");
  console.log("[push-seeds] seeds-fallback.json actualizado localmente.");

  // Subir directamente a origin/seeds usando git plumbing
  var blob = cp.execSync("git hash-object -w \"" + poolPath + "\"").toString().trim();
  var treeInput = "100644 blob " + blob + "\tseeds.json\n";
  var proc = cp.spawnSync("git", ["mktree"], { input: treeInput });
  var tree = proc.stdout.toString().trim();

  cp.execSync("git fetch origin seeds");
  var parent = cp.execSync("git rev-parse origin/seeds").toString().trim();
  var msg = "seeds: pool " + count + " " + new Date().toISOString();
  var proc2 = cp.spawnSync("git", ["commit-tree", tree, "-p", parent, "-m", msg]);
  var commit = proc2.stdout.toString().trim();

  cp.execSync("git push origin " + commit + ":seeds");
  console.log("[push-seeds] ¡Éxito! Rama seeds actualizada en GitHub (" + count + " semillas vivas).");
} catch (e) {
  console.error("[push-seeds] Error publicando semillas:", e.message || e);
  process.exit(1);
}


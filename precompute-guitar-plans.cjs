'use strict';
/* Precompute the classical-guitar fingering plans for the integrated
 * app. GuitarFingering.build() is a beam search that takes seconds
 * per song; the integrated shell must never stall on a song switch,
 * so the plans are computed here, once, and shipped as
 * dist/instruments/guitar-plans.js (window.GUITAR_PLAN_CACHE).
 * The shell injects the cached object into song.fingering before
 * GuitarMotion.plan() runs; plan() only calls build() when
 * song.fingering is absent, so the cache is a pure shortcut.
 *
 * Self-check: for every song, a plan built from the JSON-revived
 * fingering must produce poses identical to the plan built from the
 * original in-memory fingering (max abs diff over sampled times).
 * Run: node precompute-guitar-plans.cjs */
const fs = require('fs'), vm = require('vm'), path = require('path'), crypto = require('crypto');
const DIST = path.join(__dirname, 'dist', 'instruments');
const stamp = f => crypto.createHash('sha256').update(fs.readFileSync(path.join(DIST, f))).digest('hex').slice(0, 16);
global.window = global;
for (const f of ['guitar-songs.js', 'guitar-fingering.js', 'guitar-motion.js'])
  vm.runInThisContext(fs.readFileSync(path.join(DIST, f), 'utf8'));

const cache = {}, report = [];
for (const song of window.GUITAR_SONGS) {
  const t0 = Date.now();
  window.GuitarFingering.build(song);
  const buildMs = Date.now() - t0;
  const json = JSON.stringify(song.fingering);
  const revived = JSON.parse(json);
  // Pose equality: original fingering vs JSON-revived fingering.
  const fresh = { ...song, fingering: revived };
  const planA = window.GuitarMotion.plan(song);
  const planB = window.GuitarMotion.plan(fresh);
  let maxDiff = 0;
  const diff = (a, b) => {
    if (typeof a === 'number' && typeof b === 'number') { const d = Math.abs(a - b); if (d > maxDiff) maxDiff = d; return; }
    if (Array.isArray(a) && Array.isArray(b)) { a.forEach((v, i) => diff(v, b[i])); return; }
    if (a && b && typeof a === 'object' && typeof b === 'object') for (const k of Object.keys(a)) diff(a[k], b[k]);
  };
  for (let s = 0; s <= 24; s++) {
    const t = song.duration * s / 24;
    diff(window.GuitarMotion.pose(planA, t), window.GuitarMotion.pose(planB, t));
  }
  if (maxDiff > 0) throw new Error(song.id + ': revived plan pose differs by ' + maxDiff);
  cache[song.id] = revived;
  report.push({ song: song.id, buildMs, bytes: json.length, maxPoseDiff: maxDiff });
}
const out = "'use strict';\n/* Precomputed guitar fingering plans (see precompute-guitar-plans.cjs).\n * Injected into song.fingering by the shell so GuitarFingering.build()\n * (a multi-second beam search) never runs in the page.\n * Stamps (sha256[0:16]) — integration-test.cjs checks them:\n * guitar-fingering.js " + stamp('guitar-fingering.js') + ", guitar-songs.js " + stamp('guitar-songs.js') + ". */\nwindow.GUITAR_PLAN_CACHE = " + JSON.stringify(cache) + ";\n";
fs.writeFileSync(path.join(DIST, 'guitar-plans.js'), out);
console.log(JSON.stringify({ songs: report, totalBytes: out.length }, null, 1));

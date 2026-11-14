'use strict';
// Probe both sides of every compiled carriage key and finger target transition.
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
global.window = globalThis;
for (const f of ['guitar-songs', 'guitar-fingering', 'guitar-motion', 'guitar-hands', 'guitar-hand-frames', 'guitar-plans']) {
  vm.runInThisContext(fs.readFileSync('dist/instruments/' + f + '.js', 'utf8'), { filename: f });
}
const G = GuitarMotion, N = GuitarHands;
let wrist = { d: 0 }, tip = { d: 0 }, probes = 0;
// Extrapolate the displacement to zero interval. This distinguishes an
// actual pose jump from continuous, fast motion in a short source transition.
const jump = (a,b,c,d) => Math.hypot(...a.map((v,i) => 2*(d[i]-c[i])-(b[i]-v)));
for (const song of GUITAR_SONGS) {
  song.fingering = GUITAR_PLAN_CACHE[song.id];
  const P = G.plan(song);
  assert(N.available(P), 'Missing or stale hand trajectories');
  const times = new Set([...GUITAR_HAND_FRAMES.songs[song.id].keys.map(k => k.t), ...N.boundaries(P)]);
  // Include the legacy hold boundaries as well as grouped-barre boundaries.
  for (const list of Object.values(P.lhByFinger)) for (let i = 1; i < list.length; i++) {
    const A = list[i - 1], B = list[i], end = B.t - .004;
    let start = Math.max(A.t + .004, Math.min(A.end - .02, B.t - .05));
    if (start > end - .012) start = end - .012;
    times.add(start); times.add(end);
  }
  for (const t of times) {
    if (t < .00001 || t > song.duration - .00001) continue;
    const a = G.pose(P, t - .000001), b = G.pose(P, t + .000001), c = G.pose(P,t-.0000005), dpose = G.pose(P,t+.0000005);
    const d = jump(a.hands[0].wrist,b.hands[0].wrist,c.hands[0].wrist,dpose.hands[0].wrist);
    if (d > wrist.d) wrist = { d, id: song.id, t };
    for (let f = 0; f < 4; f++) {
      const d = jump(a.hands[0].fingers[f].points[3], b.hands[0].fingers[f].points[3],c.hands[0].fingers[f].points[3],dpose.hands[0].fingers[f].points[3]);
      if (d > tip.d) tip = { d, id: song.id, t, f };
    }
    probes++;
  }
}
assert(wrist.d < .0001, 'Wrist discontinuity: ' + JSON.stringify(wrist));
assert(tip.d < .0001, 'Fingertip discontinuity: ' + JSON.stringify(tip));
console.log(JSON.stringify({ probes, probeIntervalSeconds: .000002, method:'Richardson extrapolation to zero interval', wrist, tip, limitMm: .1 }, null, 2));

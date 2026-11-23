'use strict';
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
global.window = globalThis;
for (const f of ['hand-surface', 'violin-skin', 'guitar-songs', 'guitar-fingering', 'guitar-motion', 'guitar-hands', 'guitar-hand-frames', 'guitar-skin', 'guitar-model', 'guitar-plans']) {
  vm.runInThisContext(fs.readFileSync('dist/instruments/' + f + '.js', 'utf8'), { filename: f });
}
const G = GuitarMotion, N = GuitarHands, M = GuitarModel;
const dist = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));
const report = { songs: [], samples: 0, maxArmError: 0, maxHeadStepMm: 0, maxGazeStepDeg: 0, runtimeFits: 0 };

for (const song of GUITAR_SONGS) {
  song.fingering = GUITAR_PLAN_CACHE[song.id];
  const P = G.plan(song);
  assert(N.available(P), 'Missing/stale guitar hand frames: ' + song.id);
  let prev = null;
  const ranges = { gaze: [9, -9], pitch: [9, -9], roll: [9, -9], lean: [9, -9], torsoYaw: [9, -9], torsoRoll: [9, -9] };
  const track = (k, v) => { ranges[k][0] = Math.min(ranges[k][0], v); ranges[k][1] = Math.max(ranges[k][1], v); };
  let maxLeftElbowDrop = -9, minLeftElbowDrop = 9, maxRightElbowX = -9;

  for (let t = 0; t <= song.duration; t += 1 / 15) {
    const S = G.pose(P, t), E = S.expression;
    assert(E && E.head && E.torso, 'Missing guitar expression state');
    for (const arm of S.arms) {
      report.maxArmError = Math.max(report.maxArmError, arm.error);
      assert(arm.error < 1e-6, `${song.id} ${t}: arm reach error ${arm.error}`);
      assert(Math.abs(dist(arm.shoulder, arm.elbow) - arm.lengths[0]) < 1e-8);
      assert(Math.abs(dist(arm.wrist, arm.elbow) - arm.lengths[1]) < 1e-8);
    }
    // Realistic posture: left elbow hangs well below the left shoulder; right elbow sits outward to anatomical right.
    const drop = S.arms[0].shoulder[1] - S.arms[0].elbow[1];
    minLeftElbowDrop = Math.min(minLeftElbowDrop, drop);
    maxLeftElbowDrop = Math.max(maxLeftElbowDrop, drop);
    assert(drop > 0.18, `${song.id} ${t}: left elbow too high (drop ${drop})`);
    maxRightElbowX = Math.max(maxRightElbowX, S.arms[1].elbow[0]);
    assert(S.arms[1].elbow[0] < -0.15, `${song.id} ${t}: right elbow tucked inward (${S.arms[1].elbow[0]})`);

    track('gaze', E.head.gazeAngle);
    track('pitch', E.head.pitch);
    track('roll', E.head.roll);
    track('lean', -E.torso.pitch);
    track('torsoYaw', E.torso.yaw);
    track('torsoRoll', E.torso.roll);

    if (prev) {
      const headStep = dist(E.head.pos, prev.head.pos) * 1000;
      const gazeStep = Math.abs(E.head.gazeAngle - prev.head.gazeAngle) * 180 / Math.PI;
      report.maxHeadStepMm = Math.max(report.maxHeadStepMm, headStep);
      report.maxGazeStepDeg = Math.max(report.maxGazeStepDeg, gazeStep);
      assert(headStep < 12, `${song.id} ${t}: head jump ${headStep} mm`);
      assert(gazeStep < 6, `${song.id} ${t}: gaze jump ${gazeStep} deg`);
    }
    prev = E;
    report.samples++;
  }
  // Verify deterministic seeking does not mutate or grow the compiled expression track.
  const trackLen = P._expressionTrack.length;
  const sA = G.pose(P, song.duration * 0.63).expression;
  G.pose(P, song.duration * 0.12);
  const sB = G.pose(P, song.duration * 0.63).expression;
  assert.equal(P._expressionTrack.length, trackLen);
  assert.deepEqual(sA, sB, 'Seeking changed guitar expression deterministically');

  // Verify expressive range is genuinely active in every song.
  const deg = r => +(r * 180 / Math.PI).toFixed(2);
  const span = k => deg(ranges[k][1] - ranges[k][0]);
  assert(span('gaze') > 10, `${song.id}: face direction too static (${span('gaze')} deg)`);
  assert(span('pitch') > 6, `${song.id}: head pitch too static (${span('pitch')} deg)`);
  assert(span('roll') > 5, `${song.id}: head roll too static (${span('roll')} deg)`);
  assert(span('lean') > 2.5, `${song.id}: torso lean too static (${span('lean')} deg)`);
  assert(span('torsoRoll') > 3.5, `${song.id}: torso sway too static (${span('torsoRoll')} deg)`);
  report.songs.push({
    id: song.id,
    gazeSpanDeg: span('gaze'),
    headPitchSpanDeg: span('pitch'),
    headRollSpanDeg: span('roll'),
    torsoLeanSpanDeg: span('lean'),
    torsoYawSpanDeg: span('torsoYaw'),
    torsoRollSpanDeg: span('torsoRoll'),
    minLeftElbowDropMm: +(minLeftElbowDrop * 1000).toFixed(1),
    maxRightElbowXMm: +(maxRightElbowX * 1000).toFixed(1),
  });
}

// Verify headFrame uses expressive angles for pose() and preserves legacy for poseLegacy().
const s0 = GUITAR_SONGS[0];
const p0 = G.plan(s0);
const hfExpr = M.headFrame(G.pose(p0, 12));
const hfLeg = M.headFrame(G.poseLegacy(p0, 12));
assert(Math.abs(hfExpr.rx - hfLeg.rx) > 0.05, 'Expressive head pitch not applied in headFrame');

report.runtimeFits = N.stats().fits;
assert.equal(report.runtimeFits, 0, 'Nonlinear hand fits ran at playback');
console.log(JSON.stringify(report, null, 2));

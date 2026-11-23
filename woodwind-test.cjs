'use strict';
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
global.window = globalThis;
for (const n of ['bow-hand', 'hand-surface', 'violin-skin', 'woodwind-fingering', 'woodwind-songs', 'woodwind-model', 'woodwind-instrument']) {
  vm.runInThisContext(fs.readFileSync('dist/instruments/' + n + '.js', 'utf8'), { filename: n });
}

const WF = WoodwindFingering, WE = WoodwindEngine;
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

// 1. Verify full Boehm flute (C4..C7) and Conservatoire oboe (Bb3..G6) fingering charts
for (let m = 60; m <= 96; m++) {
  const f = WF.lookup('flute', m);
  assert(f, `Missing flute fingering for MIDI ${m}`);
  assert(typeof WF.label('flute', m) === 'string' && WF.label('flute', m).length > 0);
}
assert.equal(WF.lookup('flute', 60).r4, 'c', 'Flute C4 must press low C foot key');
assert.equal(WF.lookup('flute', 62).l1, 1, 'Flute D4 must close LH1');
assert.equal(WF.lookup('flute', 62).r4, '', 'Flute D4 must lift RH4');
assert.equal(WF.lookup('flute', 74).l1, 0, 'Flute D5 must vent LH1');
assert.equal(WF.lookup('flute', 72).th, 0, 'Flute C5 must lift thumb');
assert.equal(WF.lookup('flute', 72).l1, 1, 'Flute C5 must close LH1');
assert.equal(WF.lookup('flute', 73).l1, 0, 'Flute C#5 must lift LH1');
assert.equal(WF.lookup('flute', 68).l4, 1, 'Flute G#4 must press G# lever');

for (let m = 58; m <= 91; m++) {
  const f = WF.lookup('oboe', m);
  assert(f, `Missing oboe fingering for MIDI ${m}`);
  assert(typeof WF.label('oboe', m) === 'string' && WF.label('oboe', m).length > 0);
}
assert.equal(WF.lookup('oboe', 74).l1, 0.5, 'Oboe D5 must use half-hole on LH1');
assert.equal(WF.lookup('oboe', 75).l1, 0.5, 'Oboe Eb5 must use half-hole on LH1');
for (let m = 76; m <= 80; m++) assert.equal(WF.lookup('oboe', m).oct, 1, `Oboe MIDI ${m} must use 1st octave key`);
for (let m = 81; m <= 84; m++) assert.equal(WF.lookup('oboe', m).oct, 2, `Oboe MIDI ${m} must use 2nd octave key`);

// 2. Verify all songs, kinematics, finger/thumb bone lengths, fingertip-to-key contact, arm IK, closed skin, expression, draw
const report = {
  fluteSongs: WOODWIND_SONGS.flute.length,
  oboeSongs: WOODWIND_SONGS.oboe.length,
  samples: 0,
  maxFingerBoneErrMm: 0,
  maxThumbBoneErrMm: 0,
  maxFingertipErrMm: 0,
  maxThumbTipErrMm: 0,
  maxArmErrMm: 0,
  skinChecks: 0,
  drawChecks: 0,
};

const skinL = ViolinFingerSkin.create(false, true, true, true);
const skinR = ViolinFingerSkin.create(false, true, false, true);

for (const [kind, songs] of [['flute', WOODWIND_SONGS.flute], ['oboe', WOODWIND_SONGS.oboe]]) {
  assert(songs.length >= 3, `Expected at least 3 songs for ${kind}`);
  for (const song of songs) {
    assert(song.notes.length > 10 && song.duration > 5);
    const P = WE.plan(kind, song);
    const times = [0, song.duration * 0.25, song.duration * 0.5, song.duration * 0.75, song.duration];
    for (let i = 0; i < Math.min(song.notes.length, 24); i++) {
      const n = song.notes[Math.floor(i * song.notes.length / Math.min(song.notes.length, 24))];
      times.push(n[0] + n[1] * 0.5);
    }

    for (const t of times) {
      const S = WE.stateAt(P, t);
      for (const [isR, H, A] of [[false, S.handL, S.armL], [true, S.handR, S.armR]]) {
        assert.equal(H.fingers.length, 4);
        for (let f = 0; f < 4; f++) {
          const fg = H.fingers[f];
          for (let j = 0; j < 3; j++) {
            const err = Math.abs(dist(fg.points[j], fg.points[j + 1]) - WE.FINGER_LEN[f][j]);
            report.maxFingerBoneErrMm = Math.max(report.maxFingerBoneErrMm, err * 1000);
            assert(err < 1e-6, `${kind} ${song.id} finger bone length drift: ${err}`);
          }
          report.maxFingertipErrMm = Math.max(report.maxFingertipErrMm, fg.error * 1000);
          assert(fg.error < 0.002, `${kind} ${song.id} ${isR ? 'R' : 'L'}F${f + 1} fingertip miss ${(fg.error * 1000).toFixed(2)} mm at t=${t.toFixed(2)}`);
        }
        for (let j = 0; j < 3; j++) {
          const err = Math.abs(dist(H.thumb[j], H.thumb[j + 1]) - WE.THUMB_LEN[j]);
          report.maxThumbBoneErrMm = Math.max(report.maxThumbBoneErrMm, err * 1000);
          assert(err < 1e-6, `${kind} ${song.id} thumb bone length drift: ${err}`);
        }
        report.maxThumbTipErrMm = Math.max(report.maxThumbTipErrMm, H.thumbInfo.error * 1000);
        assert(H.thumbInfo.error < 0.0025, `${kind} ${song.id} ${isR ? 'R' : 'L'} thumb miss ${(H.thumbInfo.error * 1000).toFixed(2)} mm`);

        const armErr = Math.max(
          Math.abs(dist(A.shoulder, A.elbow) - WE.ARM_LEN[0]),
          Math.abs(dist(A.elbow, A.wrist) - WE.ARM_LEN[1]),
          A.error
        );
        report.maxArmErrMm = Math.max(report.maxArmErrMm, armErr * 1000);
        assert(armErr < 1e-5, `${kind} ${song.id} arm IK error ${armErr}`);
      }
      // Verify closed hand skin topology updates cleanly with finite floats
      ViolinFingerSkin.update(skinL, S.handL);
      ViolinFingerSkin.update(skinR, S.handR);
      assert(skinL.data.every(Number.isFinite) && skinR.data.every(Number.isFinite));
      report.skinChecks += 2;
      report.samples++;
    }

    // Determinism across seek
    const s1 = WE.stateAt(P, song.duration * 0.42);
    const s2 = WE.stateAt(P, song.duration * 0.42);
    assert.deepEqual(s1.expression, s2.expression);
    assert.deepEqual(s1.keys, s2.keys);

    // Draw check with mock renderer (verifies setFaceDetail pairing and no runtime errors)
    let faceOn = 0, faceOff = 0, pieces = 0;
    const mockR = {
      setFaceDetail: v => { if (v) faceOn++; else faceOff++; },
      withTransform: (m, fn) => fn(),
      piece: () => { pieces++; },
      oriented: () => { pieces++; },
      segment: () => { pieces++; },
      ball: () => { pieces++; },
      bone: () => { pieces++; },
      dynamicMesh: () => { pieces++; },
    };
    const inst = kind === 'flute' ? FLUTE_INSTRUMENT : OBOE_INSTRUMENT;
    inst.draw(mockR, WE.stateAt(P, song.duration * 0.3));
    assert.equal(faceOn, 1, `${kind} draw must enable face detail once`);
    assert.equal(faceOff, 1, `${kind} draw must disable face detail once`);
    assert(pieces > 40, `${kind} draw emitted too few primitives (${pieces})`);
    report.drawChecks++;
  }
}

console.log(JSON.stringify(report, null, 2));

'use strict';
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
global.window = globalThis;
for (const n of [
  'bow-hand', 'hand-surface', 'violin-skin',
  'violin-fingering', 'violin-songs', 'violin-model', 'violin-hand', 'violin-hand-frames', 'violin-motion',
  'cello-fingering', 'cello-model', 'cello-motion', 'cello-songs', 'cello-poses',
  'guitar-fingering', 'guitar-motion', 'guitar-hands', 'guitar-hand-frames', 'guitar-skin', 'guitar-model',
  'woodwind-fingering', 'woodwind-songs', 'woodwind-model',
  'ensemble-songs', 'ensemble-model', 'ensemble-instrument'
]) {
  vm.runInThisContext(fs.readFileSync('dist/instruments/' + n + '.js', 'utf8'), { filename: n });
}

const report = { quartetSongs: 0, ensembleSongs: 0, maxPlayers: 0, drawPrimitives: {}, minSeatSpacingM: Infinity };

for (const [kind, inst, expectedPlayers] of [
  ['quartet', QUARTET_INSTRUMENT, 4],
  ['ensemble', ENSEMBLE_INSTRUMENT, 10],
]) {
  assert(inst.songs.length >= 2, `Expected >= 2 songs for ${kind}`);
  for (const song of inst.songs) {
    assert.equal(song.parts.length, expectedPlayers, `${song.id} should have ${expectedPlayers} players`);
    // Verify performers do not collide on stage
    for (let i = 0; i < song.parts.length; i++) {
      for (let j = i + 1; j < song.parts.length; j++) {
        const a = song.parts[i].seat, b = song.parts[j].seat;
        const d = Math.hypot(a.x - b.x, a.z - b.z);
        report.minSeatSpacingM = Math.min(report.minSeatSpacingM, d);
        assert(d >= 0.65, `${song.id} seats ${song.parts[i].id} & ${song.parts[j].id} too close (${d.toFixed(2)}m)`);
      }
    }
    const P = inst.plan(song);
    for (const frac of [0, 0.25, 0.5, 0.75, 1]) {
      const S = inst.stateAt(P, song.duration * frac);
      assert.equal(S.parts.length, expectedPlayers);
    }
    let prims = 0;
    const mockR = {
      setFaceDetail: () => {},
      withTransform: (m, fn) => fn(),
      box: () => { prims++; },
      ball: () => { prims++; },
      bone: () => { prims++; },
      piece: () => { prims++; },
      segment: () => { prims++; },
      oriented: () => { prims++; },
      mesh: () => { prims++; },
      dynamicMesh: () => { prims++; },
    };
    inst.draw(mockR, inst.stateAt(P, song.duration * 0.35));
    assert(prims > expectedPlayers * 25, `${song.id} emitted too few primitives (${prims})`);
    report.drawPrimitives[song.id] = prims;
    report.maxPlayers = Math.max(report.maxPlayers, expectedPlayers);
    if (kind === 'quartet') report.quartetSongs++; else report.ensembleSongs++;
  }
}

console.log(JSON.stringify(report, null, 2));

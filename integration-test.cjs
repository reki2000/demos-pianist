'use strict';
/* Integration test for the multi-instrument shell.
 *
 * Part 0: the module files under dist/instruments/ must be byte-
 * identical to their source repos, except documented renderer and pinned
 * audio lifecycle fixes (so each module's own test-suite
 * results carry over to the integrated copies).
 * Parts G/V/C: the modules' DRAWN-frame handedness audits, replicated
 * formulation-for-formulation (world frame via the renderer's own
 * toWorld, anatomical right = drawn-face-forward x up, sagittal plane
 * through the shoulder midpoint, front-view screen order) but run
 * against the INTEGRATED copies in dist/instruments/ and the HOST
 * renderer's math (dist/gl.js) — the exact trap that made standalone
 * modules render mirrored must fail here if it ever returns.
 *   G = guitarist posture-test.cjs handedness section
 *   V = violinist clearance-test.cjs section (d)
 *   C = cellist geometry-test.cjs section 7
 * Part D: load ALL dist scripts in index.html order into a VM with
 * DOM/WebGL stubs (the capture-scene.cjs pattern), drive the shell:
 * switch instruments, select every song, check the guitar plan cache
 * is what gets injected (and still validates), check front-view
 * screen order through the shell's own debug hook, and check the
 * piano song list is restored on switch-back.
 */
const fs = require('fs'), vm = require('vm'), assert = require('assert'), crypto = require('crypto'), path = require('path');
const H = process.env.HOME;
const sha = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const sub = (a, b) => a.map((v, i) => v - b[i]);
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = a => { const l = Math.hypot(...a) || 1; return a.map(v => v / l); };
function freshCtx(files) {
  const c = { window: null, console }; c.window = c; vm.createContext(c);
  for (const f of files) vm.runInContext(fs.readFileSync(f, 'utf8'), c, { filename: path.basename(f) });
  return c;
}
function projector(RG, eye, at) {
  const vp = RG.multiply(RG.perspective(1200 / 800), RG.look(RG.toWorld(eye), RG.toWorld(at), RG.toWorld([0, 1, 0])));
  return p => { const q = [...RG.toWorld(p), 1], v = [0, 0, 0, 0]; for (let i = 0; i < 4; i++) for (let k = 0; k < 4; k++) v[i] += vp[k * 4 + i] * q[k]; return (v[0] / v[3] + 1) / 2; };
}
const DI = f => path.join('dist', 'instruments', f);

// ---- Part 0: byte identity with the module repos -------------------
const PAIRS = [
  ['guitar-songs.js', H + '/workspace/demos-guitarist/guitar-songs.js'],
  ['guitar-fingering.js', H + '/workspace/demos-guitarist/guitar-fingering.js'],
  ['guitar-motion.js', H + '/workspace/demos-guitarist/guitar-motion.js'],
  ['guitar-model.js', H + '/workspace/demos-guitarist/guitar-model.js'],
  ['guitar-audio.js', H + '/workspace/demos-guitarist/guitar-audio.js'],
  ['guitar-score.js', H + '/workspace/demos-guitarist/guitar-score.js'],
  ['guitar-instrument.js', H + '/workspace/demos-guitarist/guitar-instrument.js'],
  ['violin-gl.js', H + '/workspace/demos-violinist/dist/gl.js'],
  ['violin-fingering.js', H + '/workspace/demos-violinist/dist/violin-fingering.js'],
  ['violin-songs.js', H + '/workspace/demos-violinist/dist/violin-songs.js'],
  ['violin-model.js', H + '/workspace/demos-violinist/dist/violin-model.js'],
  ['violin-motion.js', H + '/workspace/demos-violinist/dist/violin-motion.js'],
  ['violin-audio.js', H + '/workspace/demos-violinist/dist/violin-audio.js'],
  ['violin-instrument.js', H + '/workspace/demos-violinist/dist/violin-instrument.js'],
  ['cello-fingering.js', H + '/workspace/demos-cellist/dist/cello-fingering.js'],
  ['cello-model.js', H + '/workspace/demos-cellist/dist/cello-model.js'],
  ['cello-motion.js', H + '/workspace/demos-cellist/dist/cello-motion.js'],
  ['cello-audio.js', H + '/workspace/demos-cellist/dist/cello-audio.js'],
  ['cello-songs.js', H + '/workspace/demos-cellist/dist/cello-songs.js'],
  ['cello-instrument.js', H + '/workspace/demos-cellist/dist/cello-instrument.js'],
];
const geometryPatches = JSON.parse(fs.readFileSync('geometry-patches.json', 'utf8'));
const audioLifecyclePatches = JSON.parse(fs.readFileSync('audio-lifecycle-patches.json', 'utf8'));
for (const [name, src] of PAIRS) {
  const audioPatch = audioLifecyclePatches[name];
  if (audioPatch) {
    // Documented host fixes: source retirement and bounded debug history.
    assert.equal(sha(src), audioPatch.upstream, 'audio upstream changed: review lifecycle patch for ' + name);
    assert.equal(sha(DI(name)), audioPatch.integrated, 'audio lifecycle patch changed: review and update hashes for ' + name);
    continue;
  }
  const geometryPatch = geometryPatches[name];
  if (geometryPatch) {
    assert.equal(sha(src), geometryPatch.upstream, 'geometry upstream changed: review patch for ' + name);
    assert.equal(sha(DI(name)), geometryPatch.integrated, 'geometry patch changed: review and update hashes for ' + name);
    continue;
  }
  if (name === 'violin-gl.js') {
    // Deliberate, documented renderer divergence: the integrated
    // copy's begin() re-binds its shader program every frame
    // (gl.useProgram) because in the integrated app two RecitalGL
    // instances share one canvas and the program binding is
    // context-global — without it, the instance created last hijacks
    // the binding and the piano renders a black stage after any string
    // instrument is shown (uniform uploads fail INVALID_OPERATION).
    // Strip exactly that block and require byte-identity of the rest,
    // so any OTHER drift from the module repo still fails here.
    const integ = fs.readFileSync(DI(name), 'utf8');
    const stripped = integ.replace(/\n\/\/ INTEGRATION DIVERGENCE[\s\S]*?carries the same fix\.\ngl\.useProgram\(prog\);/, '');
    assert.notEqual(stripped, integ, 'violin-gl.js: documented divergence block not found');
    const hashText = s => crypto.createHash('sha256').update(s).digest('hex');
    assert.equal(hashText(stripped), hashText(fs.readFileSync(src, 'utf8')), 'integrated copy drifted from its module repo beyond the documented divergence: ' + name);
    continue;
  }
  assert.equal(sha(DI(name)), sha(src), 'integrated copy drifted from its module repo: ' + name);
}
// The guitar plan cache must have been generated from THESE engine/song
// files (stamps are embedded by precompute-guitar-plans.cjs), never a
// stale build from an older engine.
{
  const plansText = fs.readFileSync(DI('guitar-plans.js'), 'utf8');
  for (const f of ['guitar-fingering.js', 'guitar-songs.js'])
    assert(plansText.includes(f + ' ' + sha(DI(f)).slice(0, 16)), 'guitar-plans.js stamp mismatch for ' + f + ' — rerun precompute-guitar-plans.cjs');
}

// ---- Part 0b: shared-canvas renderer invariant ----------------------
// Both RecitalGL copies in the integrated app (host dist/gl.js and
// instruments/violin-gl.js) must re-bind their shader program inside
// begin(): two instances share the piano's canvas, the program binding
// is context-global, and without the re-bind the first-created instance
// (the piano) renders a black stage after any string instrument is
// shown. (Verified against a real GL context in headless Chrome:
// without the re-bind, begin() raises INVALID_OPERATION (1282) and the
// framebuffer stays at the clear colour.)
for (const f of ['dist/gl.js', DI('violin-gl.js')]) {
  const src = fs.readFileSync(f, 'utf8');
  const begin = src.slice(src.indexOf('function begin('), src.indexOf('function begin(') + 1200);
  assert(begin.includes('gl.useProgram(prog);'), f + ': begin() must re-bind its program (shared-canvas invariant)');
}

// ---- Part G: guitar drawn handedness (posture-test formulation) ----
let gReport;
{
  const c = freshCtx(['dist/gl.js', DI('guitar-songs.js'), DI('guitar-fingering.js'), DI('guitar-motion.js'), DI('guitar-model.js'), DI('guitar-plans.js')]);
  const RG = c.RecitalGL, GM = c.GuitarMotion, GMod = c.GuitarModel, W = RG.toWorld;
  const projFront = projector(RG, [0, 1.25, -3.4], [0, 0.95, -0.15]);
  let frames = 0, worstL = -1e9, worstR = 1e9, projFrames = 0, minScreenGap = 1e9;
  for (const song of c.GUITAR_SONGS) {
    if (!song.fingering && c.GUITAR_PLAN_CACHE[song.id]) song.fingering = c.GUITAR_PLAN_CACHE[song.id]; // the shell's injection
    const plan = GM.plan(song);
    const times = new Set();
    for (const ev of plan.events) if (ev.notes.some(nt => nt.lh >= 1 && nt.fret > 0)) times.add(ev.t + 0.001);
    for (let k = 0; k <= 8; k++) times.add(song.duration * k / 8);
    for (const t of times) {
      const pose = GM.pose(plan, t), hf = GMod.headFrame(pose);
      const fwd = unit(sub(W(hf.point([0, -0.012, 0.122])), W(hf.centre)));
      const right = unit(cross(fwd, [0, 1, 0]));
      const centre = W(pose.arms[0].shoulder.map((v, i) => (v + pose.arms[1].shoulder[i]) / 2));
      const side = p => dot(sub(W(p), centre), right);
      assert(side(pose.arms[0].shoulder) < -0.05 && side(pose.arms[1].shoulder) > 0.05, 'guitar shoulders on the wrong sides');
      worstL = Math.max(worstL, side(pose.wristL)); worstR = Math.min(worstR, side(pose.wristR));
      const pL = projFront(pose.wristL), pR = projFront(pose.wristR);
      minScreenGap = Math.min(minScreenGap, pL - pR); projFrames++; frames++;
    }
  }
  assert(frames > 4000, 'guitar: too few frames ' + frames);
  assert(worstL < -0.025, 'guitar fretting wrist not on anatomical left: ' + worstL.toFixed(4));
  assert(worstR > 0.035, 'guitar plucking wrist not on anatomical right: ' + worstR.toFixed(4));
  assert(minScreenGap > 0.03, 'guitar front-view hand order wrong: gap ' + minScreenGap.toFixed(3));
  gReport = { frames, worstFrettingSide: +worstL.toFixed(4), worstPluckingSide: +worstR.toFixed(4), minScreenGap: +minScreenGap.toFixed(3), projFrames };
}

// ---- Part V: violin drawn handedness (clearance-test (d)) ----------
let vReport;
{
  const c = freshCtx(['dist/gl.js', DI('violin-fingering.js'), DI('violin-songs.js'), DI('violin-model.js'), DI('violin-motion.js'), DI('violin-audio.js'), DI('violin-instrument.js')]);
  const RG = c.RecitalGL, I = c.VIOLIN_INSTRUMENT;
  const hp = (Hh, p) => {
    const cr = Math.cos(Hh.roll), sr = Math.sin(Hh.roll), px = p[0] * cr - p[1] * sr, py = p[0] * sr + p[1] * cr;
    const cc = Math.cos(Hh.pitch), s = Math.sin(Hh.pitch), cy = Math.cos(Hh.yaw), sy = Math.sin(Hh.yaw);
    const y = py * cc - p[2] * s, z = py * s + p[2] * cc;
    return [Hh.pos[0] + px * cy + z * sy, Hh.pos[1] + y, Hh.pos[2] + z * cy - px * sy];
  };
  const NOSE = [0, -0.012, 0.122];
  const projFrontX = projector(RG, [0.55, 1.62, -3.05], [0.05, 1.22, -0.15]);
  let states = 0, sndFrames = 0, screenBad = 0, minSideB = 1e9, maxSideF = -1e9;
  for (const song of I.songs) {
    const plan = I.plan(song);
    const times = new Set([0, song.duration - 0.01]);
    for (const n of song.notes) { times.add(n[0]); times.add(n[0] + n[1] / 2); times.add(Math.max(0, n[0] - 0.09)); }
    for (let t = 0; t < song.duration; t += 0.25) times.add(t);
    for (const t of [...times].sort((a, b) => a - b)) {
      const S = I.stateAt(plan, t); states++;
      const faceW = unit(sub(RG.toWorld(hp(S.head, NOSE)), RG.toWorld(S.head.pos)));
      const rW = unit(cross(faceW, [0, 1, 0]));
      const midW = RG.toWorld(S.armL.shoulder.map((v, j) => (v + S.armR.shoulder[j]) / 2));
      minSideB = Math.min(minSideB, dot(sub(RG.toWorld(S.armR.wrist), midW), rW));
      maxSideF = Math.max(maxSideF, dot(sub(RG.toWorld(S.armL.wrist), midW), rW));
      if (S.sounding.length) { sndFrames++; if (!(projFrontX(S.armR.wrist) < projFrontX(S.armL.wrist))) screenBad++; }
    }
  }
  assert(minSideB > 0.05, 'violin bow wrist not on anatomical right: ' + (minSideB * 1000).toFixed(1) + ' mm');
  assert(maxSideF < -0.03, 'violin fingering wrist not on anatomical left: ' + (maxSideF * 1000).toFixed(1) + ' mm');
  assert.equal(screenBad, 0, 'violin front-view hand order violations');
  vReport = { states, bowWristSideMinMm: +(minSideB * 1000).toFixed(1), fingeringWristSideMaxMm: +(maxSideF * 1000).toFixed(1), screenBad, sndFrames };
}

// ---- Part C: cello drawn handedness (geometry-test §7) -------------
let cReport;
{
  const c = freshCtx(['dist/gl.js', DI('cello-fingering.js'), DI('cello-model.js'), DI('cello-motion.js'), DI('cello-songs.js')]);
  const RG = c.RecitalGL, M = c.CelloModel, Mo = c.CelloMotion;
  const recorder = () => {
    const calls = [];
    return { calls, begin() {}, project: () => null, box: (...a) => calls.push({ k: 'box', a }), ball: (...a) => calls.push({ k: 'ball', a }), bone: (...a) => calls.push({ k: 'bone', a }), segment: (...a) => calls.push({ k: 'segment', a }), piece: (...a) => calls.push({ k: 'piece', a }) };
  };
  const R = recorder();
  Mo.plan(c.CELLO_SONGS[0]);
  Mo.draw(R, c.CELLO_SONGS[0], 20);
  const headC = R.calls.find(x => x.k === 'piece' && x.a[0] === 'head').a[1];
  const noseC = R.calls.find(x => x.k === 'piece' && x.a[0] === 'nose').a[1];
  const faceW = unit(sub(RG.toWorld(noseC), RG.toWorld(headC)));
  assert(dot(faceW, [0, 0, -1]) > 0.5, 'cello world face must point at the audience');
  const rW = unit(cross(faceW, [0, 1, 0]));
  const projPortrait = projector(RG, [-0.80, 1.50, -1.70], [0, 1.10, 0.0]);
  const projFront = projector(RG, [0, 1.25, -3.4], [0, 0.95, -0.15]);
  let handFrames = 0, screenFrames = 0, minBowSideW = 1, maxFinSideW = -1;
  for (const song of c.CELLO_SONGS) {
    Mo.plan(song);
    for (let i = 0; i < 40; i++) {
      const p = Mo.pose(song, song.duration * (i + 0.5) / 40);
      const midW = RG.toWorld(p.leftArm.shoulder.map((v, j) => (v + p.rightArm.shoulder[j]) / 2));
      minBowSideW = Math.min(minBowSideW, dot(sub(RG.toWorld(p.rightArm.wrist), midW), rW));
      maxFinSideW = Math.max(maxFinSideW, dot(sub(RG.toWorld(p.leftArm.wrist), midW), rW));
      handFrames++;
    }
    for (const frac of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      const p = Mo.pose(song, song.duration * frac);
      for (const pr of [projPortrait, projFront]) {
        assert(pr(p.rightArm.wrist) < pr(p.leftArm.wrist), song.id + ' @' + frac + ': bow hand must project left of the fingering hand');
        screenFrames++;
      }
    }
  }
  assert(minBowSideW > 0.05, 'cello bow wrist on the anatomical-right side (world): min ' + minBowSideW);
  assert(maxFinSideW < -0.03, 'cello fingering wrist on the anatomical-left side (world): max ' + maxFinSideW);
  cReport = { handednessFrames: handFrames, minBowSideWorldMm: +(minBowSideW * 1000).toFixed(1), maxFinSideWorldMm: +(maxFinSideW * 1000).toFixed(1), screenFrontFrames: screenFrames };
}

// ---- Part D: the shell itself, full bundle in a stubbed browser ----
let uid = 0; const draws = [];
const glStub = { VERTEX_SHADER: 35633, FRAGMENT_SHADER: 35632, COMPILE_STATUS: 35713, LINK_STATUS: 35714, ARRAY_BUFFER: 34962, STATIC_DRAW: 35044, FLOAT: 5126, TRIANGLES: 4, COLOR_BUFFER_BIT: 16384, DEPTH_BUFFER_BIT: 256, DEPTH_TEST: 2929, createShader: kind => ({ kind }), shaderSource() {}, compileShader() {}, getShaderParameter: () => true, createProgram: () => ({}), attachShader() {}, linkProgram() {}, getProgramParameter: () => true, useProgram() {}, getAttribLocation: (p, n) => n === 'aP' ? 0 : 1, getUniformLocation: (p, n) => n, createBuffer: () => ({ id: uid++ }), bindBuffer() {}, bufferData() {}, enableVertexAttribArray() {}, vertexAttribPointer() {}, uniformMatrix4fv() {}, uniformMatrix3fv() {}, uniform3fv() {}, uniform1f() {}, drawArrays: (m, s, count) => draws.push(count), viewport() {}, clearColor() {}, clear() {}, enable() {} };
const ctx2d = () => new Proxy({}, { get: (t, p) => p in t ? t[p] : (() => {}), set: (t, p, v) => { t[p] = v; return true; } });
function element(id = '', dataset = {}) {
  const kids = [];
  const el = {
    id, dataset, children: kids, style: {}, value: { volume: '0.7', speed: '1', seek: '0' }[id] || '',
    clientWidth: id === 'scene' ? 1440 : id === 'score' ? 900 : 300, clientHeight: id === 'scene' ? 700 : id === 'score' ? 190 : 100,
    textContent: '', _classes: new Set(),
    classList: { add: (...cs) => cs.forEach(x => el._classes.add(x)), remove: (...cs) => cs.forEach(x => el._classes.delete(x)), toggle: (cl, on) => on === undefined ? (el._classes.has(cl) ? el._classes.delete(cl) : el._classes.add(cl)) : (on ? el._classes.add(cl) : el._classes.delete(cl)), contains: cl => el._classes.has(cl) },
    setAttribute() {}, getAttribute: () => null, addEventListener() {}, removeEventListener() {},
    append: (...ks) => { kids.push(...ks); }, appendChild: k => { kids.push(k); },
    querySelector: () => element(),
    getContext: kind => kind === 'webgl' ? glStub : ctx2d(),
    setPointerCapture() {}, requestFullscreen: () => Promise.resolve(),
  };
  Object.defineProperty(el, 'innerHTML', { get: () => '', set: () => { kids.length = 0; } });
  return el;
}
const byId = new Map();
const getEl = id => { if (!byId.has(id)) byId.set(id, element(id)); return byId.get(id); };
const cameraBtns = ['auto', 'hands', 'portrait', 'pedal', 'wide', 'orbit'].map(cm => element('', { camera: cm }));
const instBtns = ['piano', 'guitar', 'violin', 'cello'].map(i => element('', { instrument: i }));
const caption = element(); caption.children.push(element(), element());
const edition = element(), collSpan = element(), viewer = element();
const documentStub = {
  activeElement: { tagName: 'BODY' }, title: '',
  getElementById: getEl,
  createElement: () => element(),
  querySelectorAll: sel => sel === '.instruments button' ? instBtns : sel === '[data-camera]' ? cameraBtns : [],
  querySelector: sel => sel === '.edition' ? edition : sel === '.collection-heading>span' ? collSpan : sel === '.score-caption' ? caption : sel === '.recital-viewer' ? viewer : element(),
  addEventListener() {},
};
let rafQ = [];
const c = { window: null, document: documentStub, performance: { now: () => 0 }, requestAnimationFrame: f => { rafQ.push(f); }, devicePixelRatio: 1, innerWidth: 1440, matchMedia: () => ({ matches: false }), addEventListener() {}, console, setInterval: () => 1, clearInterval() {}, AudioContext: undefined };
c.window = c; vm.createContext(c);
const SCRIPTS = ['songs.js', 'gl.js', 'motion.js', 'pedal.js', 'score.js', 'audio-manifest.js', 'audio.js', 'app.js',
  'instruments/guitar-songs.js', 'instruments/guitar-fingering.js', 'instruments/guitar-motion.js', 'instruments/guitar-model.js', 'instruments/guitar-audio.js', 'instruments/guitar-score.js', 'instruments/guitar-instrument.js', 'instruments/guitar-plans.js',
  'instruments/violin-gl.js', 'instruments/violin-fingering.js', 'instruments/violin-songs.js', 'instruments/violin-model.js', 'instruments/violin-motion.js', 'instruments/violin-audio.js', 'instruments/violin-instrument.js',
  'instruments/cello-fingering.js', 'instruments/cello-model.js', 'instruments/cello-motion.js', 'instruments/cello-audio.js', 'instruments/cello-songs.js', 'instruments/cello-instrument.js',
  'instruments/staff-score.js', 'instruments/shell.js'];
for (const f of SCRIPTS) vm.runInContext(fs.readFileSync(path.join('dist', f), 'utf8'), c, { filename: f });

assert(c.GUITAR_INSTRUMENT && c.VIOLIN_INSTRUMENT && c.CELLO_INSTRUMENT, 'instrument entries registered');
assert(c.multiShell && c.MULTI, 'shell registered');
assert.equal(c.multiShell.getState().instrument, 'piano', 'piano is the default instrument');
assert.equal(getEl('songs').children.length, 18, 'piano song list intact at load');
let nowMs = 0;
function tick(n) { for (let i = 0; i < n; i++) { nowMs += 16.7; const q = rafQ; rafQ = []; for (const f of q) f(nowMs); } }
tick(5);
const EXPECT = { guitar: 6, violin: 3, cello: 4 };
const shellReport = {};
for (const id of ['guitar', 'violin', 'cello']) {
  c.multiShell.chooseInstrument(id);
  assert.equal(c.multiShell.getState().instrument, id);
  assert.equal(getEl('songs').children.length, EXPECT[id], id + ' song list');
  tick(10);
  assert.equal(c.__multiDebug.instrument, id, id + ' debug hook live');
  let screenBad = 0, samples = 0;
  for (const b of [...getEl('songs').children]) {
    b.onclick();
    const songId = c.multiShell.getState().song;
    const src = id === 'guitar' ? c.GUITAR_INSTRUMENT.songs : id === 'violin' ? c.VIOLIN_INSTRUMENT.songs : c.CELLO_INSTRUMENT.songs;
    const sObj = src.find(x => x.id === songId);
    if (id === 'guitar') {
      assert(sObj.fingering && sObj.fingering.assignments.length === sObj.notes.length, 'guitar cache injected for ' + songId);
      assert(sObj.fingering === c.GUITAR_PLAN_CACHE[songId], 'guitar plan for ' + songId + ' IS the shipped cache object');
      const v = c.GuitarFingering.validate(sObj);
      assert(v === true || (v && v.ok !== false), 'guitar fingering validates for ' + songId + ': ' + JSON.stringify(v));
    }
    for (let k = 0; k <= 12; k++) {
      c.multiShell.seek(sObj.duration * k / 12);
      const d = c.multiShell.debugSides();
      samples++;
      if (!(d.bowScreenX < d.finScreenX)) screenBad++;
    }
    tick(3);
  }
  assert.equal(screenBad, 0, id + ': shell front-view screen order violations');
  shellReport[id] = { songs: EXPECT[id], screenSamples: samples, screenBad };
}
c.multiShell.chooseInstrument('piano');
assert.equal(c.multiShell.getState().instrument, 'piano');
assert.equal(getEl('songs').children.length, 18, 'piano song list restored');
tick(5);
console.log(JSON.stringify({ ok: true, modulesVerified: PAIRS.length, audioLifecyclePatches: Object.keys(audioLifecyclePatches).length, geometryPatches: Object.keys(geometryPatches).length, guitar: gReport, violin: vReport, cello: cReport, shell: shellReport }, null, 1));

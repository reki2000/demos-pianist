'use strict';
/* Multi-instrument shell: adds Classical Guitar / Violin / Cello to the
 * piano recital app as switchable instruments sharing the page's song
 * list, transport, cameras and score panel.
 *
 * Design rule: the piano path is untouched. app.js keeps owning the
 * piano; this shell activates only while a string instrument is
 * selected. Transport controls are intercepted in the capture phase
 * (before app.js's own handlers can see them), and the shell's render
 * loop is registered after app.js's, so in string mode the shell's
 * frame is the one presented. Piano playback is paused on switch-away
 * and its position/song are preserved.
 *
 * Renderer note: instruments/violin-gl.js (loaded before this file)
 * rebinds window.RecitalGL to the violin module's renderer, which is
 * the host renderer plus R.oriented() — the piano's own renderer
 * instance was already created from the host gl.js by app.js.
 *
 * Guitar fingering plans are expensive (beam search, seconds per
 * song): instruments/guitar-plans.js ships them precomputed and the
 * guitar adapter injects the cache into song.fingering before the
 * module's plan() runs, so song switches never stall. */
(() => {
const $ = id => document.getElementById(id);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const fmt = t => Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0');
const noteName = n => ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'][n % 12] + (Math.floor(n / 12) - 1);

// ------------------------------------------------------------------
// Adapters: normalize each module's INTERFACE entry point.
// ------------------------------------------------------------------
const plans = new Map();       // 'inst:song' -> motion plan
const planned = new Set();     // song objects whose plan() already ran
function getPlan(inst, song) {
  const key = inst.id + ':' + song.id;
  if (!plans.has(key)) { inst.beforePlan && inst.beforePlan(song); plans.set(key, inst.plan(song)); planned.add(song); }
  return plans.get(key);
}
const ADAPTERS = {
  guitar: {
    id: 'guitar', label: 'Guitar', performerLabel: 'GUITARIST', collection: 'THE GUITAR COLLECTION',
    detailLabel: 'SOUNDHOLE',
    scoreHint: 'Gold notes are sounding · LH finger and (string) below, RH finger above · written 8vb as printed guitar music',
    I: () => window.GUITAR_INSTRUMENT,
    songs: () => window.GUITAR_INSTRUMENT.songs,
    beforePlan(song) { // inject the precomputed fingering cache
      if (!song.fingering && window.GUITAR_PLAN_CACHE && window.GUITAR_PLAN_CACHE[song.id])
        song.fingering = window.GUITAR_PLAN_CACHE[song.id];
    },
    plan: song => window.GUITAR_INSTRUMENT.planMotion(song),
    pose: (plan, t) => window.GUITAR_INSTRUMENT.pose(plan, t),
    draw(R, plan, t) { const pose = window.GUITAR_INSTRUMENT.pose(plan, t); window.GUITAR_INSTRUMENT.buildPerformer(R, pose, t); return pose; },
    wrists: pose => ({ bow: pose.wristR, fin: pose.wristL, shB: pose.arms[1].shoulder, shF: pose.arms[0].shoulder }),
    createVoice: (ctx, vol) => window.GUITAR_INSTRUMENT.createVoice(ctx, { volume: vol }),
    startNote(voice, song, i, when) {
      const n = song.notes[i], a = song.fingering.assignments[i];
      voice.startNote({ pitch: n[2], velocity: n[3], string: a.string, fret: a.fret }, when);
    },
    stopVoice: v => v.stopAll(),
    setVolume: (v, x) => v.setVolume(x),
    drawScore(cv, song, plan, t) { window.GUITAR_INSTRUMENT.drawScore(cv.getContext('2d'), song, plan, t, cv.clientWidth, cv.clientHeight); },
    prepareScoreCanvas: true, // module expects the harness-style sized canvas
    shots: {
      auto: [
        { eye: [1.7, 1.9, -2.2], at: [0.1, 1.15, -0.3], label: '01 / Front' },
        { eye: [0.9, 1.75, -1.15], at: [0.28, 1.22, -0.24], label: '02 / Neck and left hand' },
        { eye: [-0.75, 1.5, -1.25], at: [0.02, 1.05, -0.28], label: '03 / Soundhole side' },
        { eye: [2.3, 2.4, 0.9], at: [0.05, 1.1, -0.2], label: '04 / From behind' },
      ],
      hands: pose => ({ eye: [pose.palm[0] - 0.18, pose.palm[1] + 0.34, pose.palm[2] - 0.52], at: pose.palm, label: 'Left hand on the neck' }),
      portrait: { eye: [1.15, 1.95, -1.5], at: [0.05, 1.35, -0.1], label: 'Head · torso · wrists' },
      detail: { eye: [-0.75, 1.5, -1.25], at: [0.02, 1.05, -0.28], label: 'Right hand over the soundhole' },
      wide: { eye: [-2.9, 2.3, -3.4], at: [0, 1.0, 0], label: '01 / Stage' },
    },
  },
  violin: {
    id: 'violin', label: 'Violin', performerLabel: 'VIOLINIST', collection: 'THE VIOLIN COLLECTION',
    detailLabel: 'BOW',
    scoreHint: 'Gold notes are sounding · string · finger below the note, bow mark above',
    I: () => window.VIOLIN_INSTRUMENT,
    songs: () => window.VIOLIN_INSTRUMENT.songs,
    plan: song => window.VIOLIN_INSTRUMENT.plan(song),
    pose: (plan, t) => window.VIOLIN_INSTRUMENT.stateAt(plan, t),
    draw(R, plan, t) { const st = window.VIOLIN_INSTRUMENT.stateAt(plan, t); window.VIOLIN_INSTRUMENT.draw(R, st); return st; },
    wrists: st => ({ bow: st.armR.wrist, fin: st.armL.wrist, shB: st.armR.shoulder, shF: st.armL.shoulder }),
    createVoice: (ctx, vol) => window.VIOLIN_INSTRUMENT.createVoice(ctx, { volume: vol }),
    startNote(voice, song, i, when, speed, plan) { voice.startNote(song, song.notes[i], when, speed, plan.notes[i]); },
    stopVoice: v => v.stopAll(),
    setVolume: (v, x) => v.master && v.master.gain.setTargetAtTime(x * 0.9, v.master.context.currentTime, 0.03),
    drawScore(cv, song, plan, t) {
      const cfg = window.VIOLIN_INSTRUMENT.scoreConfig;
      window.StringScore.render(cv, {
        song, t, beatAt: s => window.PianoScore.beatAt(song, s),
        signatureAt: b => window.PianoScore.signatureAt(song, b), fifthsAt: b => window.PianoScore.keyAt(song, b).fifths,
        clefFor: () => 'treble',
        annotation: i => cfg.annotation(plan.notes[i]), above: i => cfg.bowMark(plan.notes[i]),
      });
    },
    shots: {
      auto: [
        { eye: [0.55, 1.62, -3.05], at: [0.05, 1.22, -0.15], label: '01 / Front' },
        { eye: [1.00, 1.74, -1.02], at: [0.27, 1.42, -0.34], label: '02 / Hands' },
        { eye: [-1.30, 1.58, -1.20], at: [-0.12, 1.40, -0.28], label: '03 / Bow side' },
        { eye: [-0.80, 1.80, -1.30], at: [0.10, 1.46, -0.20], label: '04 / Portrait' },
        { eye: [2.6, 2.2, -3.4], at: [0, 1.05, 0], label: '05 / Stage' },
      ],
      hands: { eye: [1.00, 1.74, -1.02], at: [0.27, 1.42, -0.34], label: 'Hands on the fingerboard' },
      portrait: { eye: [-0.80, 1.80, -1.30], at: [0.10, 1.46, -0.20], label: 'Head · torso · wrists' },
      detail: { eye: [-1.30, 1.58, -1.20], at: [-0.12, 1.40, -0.28], label: 'Bow at the frog' },
      wide: { eye: [2.6, 2.2, -3.4], at: [0, 1.05, 0], label: '01 / Stage' },
    },
  },
  cello: {
    id: 'cello', label: 'Cello', performerLabel: 'CELLIST', collection: 'THE CELLO COLLECTION',
    detailLabel: 'BOW',
    scoreHint: 'Gold notes are sounding · string · finger below the note · the clef follows the register (bass / tenor / treble)',
    I: () => window.CELLO_INSTRUMENT,
    songs: () => window.CELLO_INSTRUMENT.songs,
    plan: song => window.CELLO_INSTRUMENT.planMotion(song),
    performer: null, // built lazily per renderer
    pose: (plan, t, song) => window.CelloMotion.pose(song, t),
    draw(R, plan, t, song) {
      if (!this.performer) this.performer = window.CELLO_INSTRUMENT.buildPerformer(R);
      return this.performer.draw(song, t);
    },
    wrists: pose => ({ bow: pose.rightArm.wrist, fin: pose.leftArm.wrist, shB: pose.rightArm.shoulder, shF: pose.leftArm.shoulder }),
    createVoice: (ctx, vol) => window.CELLO_INSTRUMENT.createVoice(ctx, ctx.destination),
    startNote(voice, song, i, when, speed) {
      const n = song.notes[i];
      voice.noteOn({ pitch: n[2], velocity: n[3], time: when, duration: n[1] / speed });
    },
    stopVoice: v => v.allNotesOff(),
    setVolume: (v, x) => v.setVolume(x),
    drawScore(cv, song, plan, t) {
      const cfg = window.CELLO_INSTRUMENT.scoreConfig;
      // Meters/keys of these specific editions (BWV 1007 movements are
      // in G major; the module's Swan is the D-major WIMA edition).
      const meta = {
        prelude: { fifths: 1, signature: { numerator: 4, denominator: 4 } },
        gigue: { fifths: 1, signature: { numerator: 6, denominator: 8 } },
        menuet: { fifths: 1, signature: { numerator: 3, denominator: 4 } },
        swan: { fifths: 2, signature: { numerator: 4, denominator: 4 } },
      }[song.id] || { fifths: 0, signature: { numerator: 4, denominator: 4 } };
      window.StringScore.render(cv, {
        song, t, beatAt: s => s / song.celloOptions.secPerBeat,
        signature: meta.signature, fifths: meta.fifths,
        clefFor: p => cfg.clefFor(p),
        annotation: i => cfg.fingeringLabel(song.cello.notes[i]),
      });
    },
    shots: {
      auto: [
        { eye: [-2.3, 1.65, -3.3], at: [0, 0.92, -0.10], label: '01 / Stage' },
        { eye: [-0.80, 1.50, -1.70], at: [0, 1.10, 0.0], label: '02 / Portrait' },
        { eye: [1.30, 1.60, -1.25], at: [0.30, 1.08, -0.20], label: '03 / Left hand' },
        { eye: [-1.50, 1.10, -1.50], at: [-0.02, 0.90, -0.30], label: '04 / Bow side' },
        { eye: [-3.4, 1.05, -0.25], at: [0, 0.92, -0.18], label: '05 / Side profile' },
      ],
      hands: { eye: [1.30, 1.60, -1.25], at: [0.30, 1.08, -0.20], label: 'Left hand on the fingerboard' },
      portrait: { eye: [-0.80, 1.50, -1.70], at: [0, 1.10, 0.0], label: 'Head · torso · wrists' },
      detail: { eye: [-1.50, 1.10, -1.50], at: [-0.02, 0.90, -0.30], label: 'Bow at the strings' },
      wide: { eye: [-2.3, 1.65, -3.3], at: [0, 0.92, -0.10], label: '01 / Stage' },
    },
  },
};

// ------------------------------------------------------------------
// Shell state
// ------------------------------------------------------------------
let active = null;             // adapter or null (piano)
let song = null, plan = null;  // current string song/plan
let playing = false, position = 0, speed = 1;
let ctx = null; const voices = {};   // one AudioContext, one voice per instrument
let anchor = 0, startPos = 0, next = 0, timer = null;
let renderer = null;
let camMode = 'auto', eye = [1.8, 2.25, -2.35], target = [0, 1.28, -0.74];
let orbitA = -0.8, orbitH = 2.2, orbitR = 4.2, drag = null;
const memory = {};             // per-instrument {songId, position}
let pianoButtons = null;       // stashed piano song buttons
const pianoDOM = {};           // original texts to restore
const hintSpan = document.querySelector('.score-caption').children[1];

const lowerBound = (arr, t) => { let a = 0, b = arr.length; while (a < b) { const m = (a + b) >> 1; if (arr[m][0] < t) a = m + 1; else b = m; } return a; };
function currentTime() { if (!playing || !ctx) return position; return clamp(startPos + (ctx.currentTime - anchor) * speed, 0, song.duration); }
function voice() { return voices[active.id]; }

// ------------------------------------------------------------------
// Transport (strings)
// ------------------------------------------------------------------
function schedule() {
  if (!playing || !ctx || !active) return;
  const t = startPos + (ctx.currentTime - anchor) * speed, horizon = t + 0.18 * speed;
  while (next < song.notes.length && song.notes[next][0] < horizon) {
    const i = next++, when = anchor + (song.notes[i][0] - startPos) / speed;
    if (when >= ctx.currentTime - 0.01) active.startNote(voice(), song, i, Math.max(ctx.currentTime, when), speed, plan);
  }
  if (currentTime() >= song.duration) { pauseStr(); position = song.duration; }
}
async function playStr() {
  if (!active || playing) return;
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 44100, latencyHint: 'interactive' });
    for (const a of Object.values(ADAPTERS)) voices[a.id] = null;
  }
  await ctx.resume();
  if (!voice()) { voices[active.id] = active.createVoice(ctx, Number($('volume').value)); if (voices[active.id]) active.setVolume(voices[active.id], Number($('volume').value)); }
  if (position >= song.duration - 0.1) position = 0;
  startPos = position; anchor = ctx.currentTime + 0.08; next = lowerBound(song.notes, position);
  playing = true; timer = setInterval(schedule, 25); schedule();
  $('play').textContent = 'Ⅱ'; $('play').setAttribute('aria-label', 'Pause');
}
function pauseStr() {
  if (playing) position = currentTime();
  playing = false; clearInterval(timer);
  if (active && voice()) active.stopVoice(voice());
  $('play').textContent = '▶'; $('play').setAttribute('aria-label', 'Play');
}
function seekStr(t) { const was = playing; pauseStr(); position = clamp(t, 0, song.duration); if (was) playStr().catch(e => console.error(e)); }
function toggleStr() { playing ? pauseStr() : playStr().catch(e => console.error(e)); }

// ------------------------------------------------------------------
// Song / instrument selection
// ------------------------------------------------------------------
function markSongs() {
  document.querySelectorAll('#songs .song').forEach(b => {
    const on = b.dataset.song === song.id;
    b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on));
    b.querySelector('.equalizer').textContent = on ? '▥' : '';
  });
}
function selectSong(id) {
  const s = active.songs().find(x => x.id === id); if (!s) return;
  pauseStr(); song = s; plan = getPlan(active, song);
  position = 0;
  $('title').textContent = song.title; $('composer').textContent = song.composer; $('opus').textContent = song.opus || '';
  $('duration').textContent = fmt(song.duration); $('seek').max = song.duration;
  document.title = song.title + ' — ' + active.id;
  markSongs();
}
function buildSongs() {
  const wrap = $('songs'); wrap.innerHTML = '';
  active.songs().forEach((s, i) => {
    const b = document.createElement('button');
    b.className = 'song'; b.dataset.song = s.id;
    b.innerHTML = '<span class="number">' + String(i + 1).padStart(2, '0') + '</span><span class="equalizer"></span><span class="song-title">' + s.title + '</span><span class="song-composer">' + s.composer + '</span><span class="song-time">' + fmt(s.duration) + '</span>';
    b.onclick = () => selectSong(s.id);
    wrap.append(b);
  });
}
function enterString(a) {
  if (active === a) return;
  if (active) { memory[active.id] = { songId: song.id, position }; pauseStr(); }
  else {
    window.recital.pause();
    if (!pianoButtons) { pianoButtons = [...$('songs').children]; pianoDOM.edition = document.querySelector('.edition').innerHTML; pianoDOM.count = document.querySelector('.collection-heading>span').textContent; pianoDOM.hint = hintSpan.textContent; pianoDOM.title = document.title; }
    pianoDOM.startHidden = $('start').classList.contains('hidden');
    $('pedalHUD').classList.add('hidden'); $('start').classList.add('hidden');
  }
  active = a;
  document.querySelector('.edition').innerHTML = a.collection + ' <b>' + String(a.songs().length).padStart(2, '0') + '</b>';
  document.querySelector('.collection-heading>span').textContent = 'Choose from ' + a.songs().length + ' pieces';
  hintSpan.textContent = a.scoreHint;
  document.querySelectorAll('.instruments button').forEach(b => { const on = b.dataset.instrument === a.id; b.classList.toggle('selected', on); b.setAttribute('aria-pressed', String(on)); });
  $('cameraLabel').textContent = camLabel();
  buildSongs();
  const mem = memory[a.id];
  selectSong(mem && a.songs().some(s => s.id === mem.songId) ? mem.songId : a.songs()[0].id);
  if (mem) position = mem.position || 0;
  $('play').disabled = false;
}
function enterPiano() {
  if (!active) return;
  memory[active.id] = { songId: song.id, position }; pauseStr();
  // Do not leave the shell's AudioContext running alongside the piano's:
  // two live contexts compete for the device audio path (and burn CPU).
  // playStr() resumes it on the next string playback.
  if (ctx && ctx.state === 'running') ctx.suspend();
  active = null; song = null; plan = null;
  if (pianoButtons) { const wrap = $('songs'); wrap.innerHTML = ''; for (const b of pianoButtons) wrap.append(b); }
  document.querySelector('.edition').innerHTML = pianoDOM.edition;
  document.querySelector('.collection-heading>span').textContent = pianoDOM.count;
  hintSpan.textContent = pianoDOM.hint;
  document.title = pianoDOM.title;
  document.querySelectorAll('.instruments button').forEach(b => { const on = b.dataset.instrument === 'piano'; b.classList.toggle('selected', on); b.setAttribute('aria-pressed', String(on)); });
  $('pedalHUD').classList.remove('hidden');
  $('start').classList.toggle('hidden', !!pianoDOM.startHidden);
  // Re-sync the piano-owned DOM from the piano's own state.
  const st = window.recital.getState(), ps = window.SONGS.find(s => s.id === st.song);
  if (ps) {
    $('title').textContent = ps.title; $('composer').textContent = ps.composer; $('opus').textContent = ps.opus;
    $('duration').textContent = fmt(ps.duration); $('seek').max = ps.duration;
    document.title = ps.title + ' — pianist';
    document.querySelectorAll('#songs .song').forEach(b => { const on = b.dataset.song === ps.id; b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on)); b.querySelector('.equalizer').textContent = on ? '▥' : ''; });
  }
  $('play').textContent = '▶'; $('play').setAttribute('aria-label', 'Play');
  $('cameraLabel').textContent = ({ auto: 'CINEMATIC', hands: 'PLAYER VIEW', portrait: 'PIANIST', pedal: 'PEDAL', wide: 'STAGE', orbit: 'FREE CAMERA' })[document.querySelector('[data-camera].selected')?.dataset.camera || 'auto'];
}

// ------------------------------------------------------------------
// Cameras + rendering
// ------------------------------------------------------------------
function camLabel() {
  if (!active) return '';
  return ({ auto: 'CINEMATIC', hands: 'HANDS', portrait: active.performerLabel, pedal: active.detailLabel, wide: 'STAGE', orbit: 'FREE CAMERA' })[camMode];
}
function drawStage(R) {
  const gold = [0.63, 0.46, 0.2];
  R.box([0, -0.065, 0.6], [24, 0.12, 24], [0.065, 0.055, 0.05]);
  R.ball([0, -0.025, 0.4], [4.3, 0.11, 4.3], [0.105, 0.088, 0.067]);
  for (let i = 0; i < 22; i++) R.box([0, 0.002, -3.5 + i * 0.35], [7.8, 0.005, 0.014], [0.048, 0.042, 0.036]);
  for (let i = -12; i <= 12; i++) { R.box([i * 0.48, 1.8, 5.2], [0.07, 3.6, 0.15], [0.105, 0.089, 0.064], 0.1); R.box([i * 0.48, 1.8, 5.31], [0.27, 3.6, 0.06], [0.035, 0.035, 0.04]); }
  for (let i = 0; i < 64; i++) { const a = i * Math.PI / 32, b = (i + 1) * Math.PI / 32; R.bone([4 * Math.sin(a), 0.006, 0.4 + 4 * Math.cos(a)], [4 * Math.sin(b), 0.006, 0.4 + 4 * Math.cos(b)], 0.008, gold); }
}
let lastNow = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - lastNow) / 1000); lastNow = now;
  if (!active) return;
  if (!renderer) { try { renderer = window.RecitalGL.create($('scene')); } catch (e) { return; } }
  const t = currentTime();
  const pose = active.id === 'cello' ? null : active.pose(plan, t);
  // Camera resolution.
  let shot = null, dynEye = null, dynAt = null;
  const S = active.shots;
  if (camMode === 'auto') { shot = S.auto[Math.floor(t / 11) % S.auto.length]; }
  else if (camMode === 'hands' && typeof S.hands === 'function') { const d = S.hands(pose); dynEye = d.eye; dynAt = d.at; shot = d; }
  else if (camMode === 'orbit') { dynEye = [Math.sin(orbitA) * orbitR, orbitH, Math.cos(orbitA) * orbitR]; dynAt = [0, 1.05, 0]; shot = { label: 'Drag to orbit · scroll to zoom' }; }
  else shot = S[camMode === 'pedal' ? 'detail' : camMode] || S.auto[0];
  if (dynEye) { eye = lerp(eye, dynEye, 1 - Math.exp(-dt * 3)); target = lerp(target, dynAt, 1 - Math.exp(-dt * 3)); }
  else if (shot) { const k = camMode === 'auto' ? 2 : 3; eye = lerp(eye, shot.eye, 1 - Math.exp(-dt * k)); target = lerp(target, shot.at, 1 - Math.exp(-dt * k)); }
  const narrow = $('scene').clientWidth < 650 && !['hands', 'pedal', 'portrait'].includes(camMode);
  const renderEye = narrow ? eye.map((v, i) => i === 1 ? v + 0.4 : v * 1.23) : eye;
  renderer.begin(renderEye, target);
  drawStage(renderer);
  if (active.id === 'cello') active.draw(renderer, plan, t, song); else active.draw(renderer, plan, t);
  // Score.
  const cv = $('score');
  if (active.prepareScoreCanvas) {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    if (cv.width !== Math.round(cv.clientWidth * dpr)) { cv.width = Math.round(cv.clientWidth * dpr); cv.height = Math.round(cv.clientHeight * dpr); }
    const c2 = cv.getContext('2d'); c2.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  active.drawScore(cv, song, plan, t);
  // HUD.
  $('shotText').textContent = shot ? shot.label : '';
  const act = [];
  for (let i = lowerBound(song.notes, t) - 1; i >= 0 && song.notes[i][0] > t - 8; i--) { const n = song.notes[i]; if (n[0] <= t && n[0] + n[1] > t) act.push(n[2]); }
  act.sort((a, b) => a - b);
  $('notes').textContent = playing || position > 0 ? (act.length ? [...new Set(act)].map(noteName).join(' · ') : 'Rest') : 'Waiting to play';
  $('time').textContent = fmt(t);
  if (document.activeElement !== $('seek')) $('seek').value = t;
  $('bassLabel').classList.add('hidden'); $('trebleLabel').classList.add('hidden');
  window.__multiDebug = { instrument: active.id, song: song.id, time: t, playing, camMode };
}
requestAnimationFrame(frame);

// ------------------------------------------------------------------
// Interception of the shared transport while a string instrument is
// active (capture phase: app.js's piano handlers never see these).
// ------------------------------------------------------------------
document.addEventListener('click', e => {
  if (!active) return;
  if (e.target.closest && e.target.closest('#play')) { e.stopPropagation(); e.preventDefault(); toggleStr(); }
  else if (e.target.closest && e.target.closest('#restart')) { e.stopPropagation(); seekStr(0); }
  else if (e.target.closest && e.target.closest('#startButton')) { e.stopPropagation(); playStr(); }
}, true);
document.addEventListener('input', e => {
  if (!active) return;
  if (e.target === $('seek')) { e.stopPropagation(); seekStr(Number(e.target.value)); }
  else if (e.target === $('volume')) { e.stopPropagation(); if (voice()) active.setVolume(voice(), Number(e.target.value)); }
}, true);
document.addEventListener('change', e => {
  if (!active) return;
  if (e.target === $('speed')) { e.stopPropagation(); const was = playing, t = currentTime(); pauseStr(); position = t; speed = Number(e.target.value); if (was) playStr(); }
}, true);
document.addEventListener('keydown', e => {
  if (!active) return;
  if (e.code === 'Space' && !['INPUT', 'SELECT', 'BUTTON', 'SUMMARY'].includes(document.activeElement.tagName)) { e.stopPropagation(); e.preventDefault(); toggleStr(); }
}, true);
// Camera buttons: app.js's handler also runs (harmless bookkeeping);
// the shell keeps the label and its own mode in sync afterwards.
document.addEventListener('click', e => {
  if (!active) return;
  const b = e.target.closest && e.target.closest('[data-camera]');
  if (b) { camMode = b.dataset.camera; $('cameraLabel').textContent = camLabel(); }
});
// Orbit controls for string mode.
$('scene').addEventListener('pointerdown', e => { if (active && camMode === 'orbit') { drag = [e.clientX, e.clientY]; e.target.setPointerCapture(e.pointerId); } });
$('scene').addEventListener('pointermove', e => { if (active && drag) { orbitA -= (e.clientX - drag[0]) * 0.008; orbitH = clamp(orbitH + (e.clientY - drag[1]) * 0.014, 0.6, 5); drag = [e.clientX, e.clientY]; } });
$('scene').addEventListener('pointerup', () => drag = null);
$('scene').addEventListener('pointercancel', () => drag = null);
$('scene').addEventListener('wheel', e => { if (active && camMode === 'orbit') { e.preventDefault(); orbitR = clamp(orbitR + e.deltaY * 0.007, 2.2, 9); } }, { passive: false });

// ------------------------------------------------------------------
// Switcher wiring + score panel collapse (works for every instrument)
// ------------------------------------------------------------------
document.querySelectorAll('.instruments button').forEach(b => b.addEventListener('click', () => {
  const id = b.dataset.instrument;
  if (id === 'piano') enterPiano();
  else enterString(ADAPTERS[id]);
}));
const scorePanel = document.querySelector('.score-panel');
const toggle = document.createElement('button');
toggle.className = 'score-toggle'; toggle.textContent = 'Hide score'; toggle.setAttribute('aria-expanded', 'true');
toggle.onclick = () => {
  const cv = $('score'), hide = cv.style.display !== 'none';
  cv.style.display = hide ? 'none' : '';
  toggle.textContent = hide ? 'Show score' : 'Hide score';
  toggle.setAttribute('aria-expanded', String(!hide));
};
document.querySelector('.score-caption').append(toggle);

// Debug/test surface (mirrors window.recital's shape). debugSides
// reports each wrist's side of the TORSO sagittal plane (a quick
// diagnostic) plus the front-view screen order — the formulation-
// independent invariant (bow/pluck hand on the viewer's left). The
// pinned face-derived handedness audits live in integration-test.cjs.
function debugSides() {
  if (!active) return null;
  const t = currentTime();
  const pose = active.id === 'cello' ? window.CelloMotion.pose(song, t) : active.pose(plan, t);
  const w = active.wrists(pose);
  const mid = w.shB.map((v, i) => (v + w.shF[i]) / 2);
  const right = [-1, 0, 0]; // planning coords: figures face -Z, so anatomical right = up x fwd = -X
  const side = p => (p[0] - mid[0]) * right[0] + (p[1] - mid[1]) * right[1] + (p[2] - mid[2]) * right[2];
  // Screen projection with a straight-front camera, using the
  // renderer's own exported math (same composition as project()).
  const G = window.RecitalGL, aspect = ($('scene').clientWidth || 1440) / ($('scene').clientHeight || 700);
  const vp = G.multiply(G.perspective(aspect), G.look(G.toWorld([0, 1.25, -3.1]), G.toWorld([0, 1.0, -0.1]), G.toWorld([0, 1, 0])));
  const proj = p => { const q = [...G.toWorld(p), 1], v = [0, 0, 0, 0]; for (let i = 0; i < 4; i++) for (let k = 0; k < 4; k++) v[i] += vp[k * 4 + i] * q[k]; return { x: (v[0] / v[3] + 1) / 2, y: (1 - v[1] / v[3]) / 2 }; };
  const sb = proj(w.bow), sf = proj(w.fin);
  return { bowSide: side(w.bow), finSide: side(w.fin), bowScreenX: sb.x, finScreenX: sf.x, t };
}
window.MULTI = { active: () => !!active, instrument: () => active && active.id };
window.multiShell = {
  chooseInstrument(id) { if (id === 'piano') enterPiano(); else enterString(ADAPTERS[id]); },
  chooseSong(id) { if (active) selectSong(id); },
  seek: t => { if (active) seekStr(t); },
  play: () => playStr(), pause: () => pauseStr(),
  getState: () => ({ instrument: active ? active.id : 'piano', song: song && song.id, time: active ? currentTime() : window.recital.getState().time, playing: active ? playing : window.recital.getState().playing }),
  debugSides,
};
})();

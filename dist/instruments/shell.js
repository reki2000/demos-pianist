'use strict';
/* Multi-instrument shell: adds Classical Guitar / Violin / Cello to the
 * piano recital app as switchable instruments sharing the page's song
 * list, transport, cameras and score panel.
 *
 * Design rule: app.js owns the piano selection and playback. The shell
 * observes piano song changes and activates rendering while a string instrument is
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
const cinematic = Object.fromEntries(['guitar','violin','viola','cello','flute','oboe','clarinet','trumpet','harp','bass','percussion','quartet','ensemble'].map(id=>[id,CinematicCamera.create(id)]));
const plans = new Map();       // 'inst:song' -> motion plan
const planned = new Set();     // song objects whose plan() already ran
function getPlan(inst, song) {
  const key = inst.id + ':' + song.id;
  if (!plans.has(key)) { inst.beforePlan && inst.beforePlan(song); plans.set(key, inst.plan(song)); planned.add(song); }
  return plans.get(key);
}
function makeAdapter(o) {
  const I = () => window[o.global];
  return {
    id: o.id, label: o.label, performerLabel: o.performerLabel, collection: o.collection,
    detailLabel: o.detailLabel, scoreHint: o.scoreHint, I,
    songs: () => I().songs, plan: s => I().plan(s), pose: (p, t) => I().stateAt(p, t),
    draw(R, p, t) { const st = I().stateAt(p, t); I().draw(R, st); return st; },
    wrists: o.wrists || (() => ({})),
    createVoice: (ctx, vol) => I().createVoice(ctx, { volume: vol }),
    startNote(v, song, i, when, speed) {
      if (o.noteOnly) v.startNote(song.notes[i], when, speed);
      else v.startNote(song, song.notes[i], when, speed);
    },
    stopVoice: v => v.stopAll(), setVolume: (v, x) => v.setVolume(x),
    drawScore(cv, song, plan, t) {
      const cfg = I().scoreConfig;
      window.StringScore.render(cv, {
        song: song.scoreNotes ? { ...song, notes: song.scoreNotes } : song, t,
        beatAt: s => s * song.bpm / 60,
        signature: song.signatures[0], fifths: song.keySignature.fifths,
        clefFor: o.clefFor ? (() => o.clefFor(song)) : () => (cfg?.clef || 'treble'),
        ...(cfg?.annotation ? { annotation: i => cfg.annotation(plan.notes[i]) } : {}),
      });
    },
    shots: o.shots,
  };
}
const windWrists = st => ({ bow: st.armR.wrist, fin: st.armL.wrist, shB: st.armR.shoulder, shF: st.armL.shoulder });
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
    prevPose: null, prevTime: null, prevPlan: null,
    draw(R, plan, t) {
      let pose = window.GUITAR_INSTRUMENT.pose(plan, t);
      if (this.prevPlan === plan && this.prevPose && this.prevTime != null) {
        const dt = t - this.prevTime;
        if (dt > 0 && dt < 0.12 && window.GuitarMotion?.soften) pose = window.GuitarMotion.soften(this.prevPose, pose, dt);
      }
      this.prevPose = pose; this.prevTime = t; this.prevPlan = plan;
      window.GUITAR_INSTRUMENT.buildPerformer(R, pose, t);
      return pose;
    },
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
  viola: makeAdapter({
    id: 'viola', label: 'Viola', performerLabel: 'VIOLIST', collection: 'THE VIOLA COLLECTION', detailLabel: 'BOW', global: 'VIOLA_INSTRUMENT', wrists: windWrists,
    clefFor: song => 'tenor',
    scoreHint: 'Gold notes are sounding · Solo Viola (C3–G3–D4–A4) · natural left hand & alternating bow',
    shots: {
      auto: [{ eye: [0.55, 1.56, -2.95], at: [0.05, 1.18, -0.15], label: '01 / Front' }],
      hands: { eye: [1.00, 1.74, -1.02], at: [0.27, 1.42, -0.34], label: 'Hands on the fingerboard' },
      portrait: { eye: [-0.80, 1.80, -1.30], at: [0.10, 1.46, -0.20], label: 'Head · torso · wrists' },
      detail: { eye: [-1.30, 1.58, -1.20], at: [-0.12, 1.40, -0.28], label: 'Bow at the frog' },
      wide: { eye: [2.6, 2.2, -3.4], at: [0, 1.05, 0], label: '01 / Stage' },
    },
  }),
  flute: makeAdapter({
    id: 'flute', label: 'Flute', performerLabel: 'FLUTIST', collection: 'THE FLUTE COLLECTION', detailLabel: 'KEYS', global: 'FLUTE_INSTRUMENT', noteOnly: true, wrists: windWrists,
    scoreHint: 'Gold notes are sounding · Boehm fingering below (T = thumb, 1–3 = fingers, + = G#, Eb/C/C# = footjoint)',
    shots: {
      auto: [{ eye: [-0.45, 1.56, -2.85], at: [-0.12, 1.18, -0.10], label: '01 / Front' }],
      hands: { eye: [-0.30, 1.72, -0.78], at: [-0.28, 1.46, -0.16], label: 'Both hands on the Boehm keys' },
      portrait: { eye: [-0.85, 1.66, -1.15], at: [-0.08, 1.48, -0.10], label: 'Head · embouchure · torso' },
      detail: { eye: [-0.35, 1.62, -0.62], at: [-0.32, 1.45, -0.17], label: 'Keywork close-up' },
      wide: { eye: [-2.1, 1.95, -3.2], at: [-0.05, 1.05, 0], label: '01 / Stage' },
    },
  }),
  oboe: makeAdapter({
    id: 'oboe', label: 'Oboe', performerLabel: 'OBOIST', collection: 'THE OBOE COLLECTION', detailLabel: 'KEYS', global: 'OBOE_INSTRUMENT', noteOnly: true, wrists: windWrists,
    scoreHint: 'Gold notes are sounding · Conservatoire fingering below (¹/² = octave keys, ½ = half-hole, 1–3 = fingers)',
    shots: {
      auto: [{ eye: [0.55, 1.54, -2.85], at: [0, 1.16, -0.15], label: '01 / Front' }],
      hands: { eye: [0.36, 1.50, -0.82], at: [0, 1.24, -0.32], label: 'Both hands on the oboe keys' },
      portrait: { eye: [-0.85, 1.62, -1.15], at: [0, 1.44, -0.14], label: 'Head · reed · torso' },
      detail: { eye: [0.22, 1.38, -0.74], at: [0, 1.22, -0.33], label: 'Keywork close-up' },
      wide: { eye: [2.2, 1.95, -3.2], at: [0, 1.05, 0], label: '01 / Stage' },
    },
  }),
  clarinet: makeAdapter({
    id: 'clarinet', label: 'Clarinet', performerLabel: 'CLARINETIST', collection: 'THE CLARINET COLLECTION', detailLabel: 'KEYS', global: 'CLARINET_INSTRUMENT', wrists: windWrists,
    scoreHint: 'Gold notes are sounding · Boehm clarinet fingering below (R = register key, T = thumb, 1–3 = fingers)',
    shots: {
      auto: [{ eye: [0.55, 1.20, -2.59], at: [0, 1.02, -0.24], label: '01 / Clarinet' }],
      hands: { eye: [0.36, 1.44, -0.95], at: [0, 1.22, -0.34], label: 'Clarinet keywork' },
      portrait: { eye: [-0.85, 1.56, -1.15], at: [0, 1.42, -0.14], label: 'Clarinetist portrait' },
      detail: { eye: [0.25, 1.32, -0.82], at: [0, 1.18, -0.36], label: 'Keys & bell' },
      wide: { eye: [1.8, 1.65, -2.8], at: [0, 1.02, -0.20], label: '01 / Stage' },
    },
  }),
  trumpet: makeAdapter({
    id: 'trumpet', label: 'Trumpet', performerLabel: 'TRUMPETER', collection: 'THE TRUMPET COLLECTION', detailLabel: 'VALVES', global: 'TRUMPET_INSTRUMENT', wrists: windWrists,
    scoreHint: 'Gold notes are sounding · 3-valve piston fingering below (0 = open, 1/2/3 = valves)',
    shots: {
      auto: [{ eye: [-0.68, 1.31, -2.56], at: [0, 1.15, -0.26], label: '01 / Trumpet' }],
      hands: { eye: [-0.55, 1.68, -0.88], at: [0, 1.48, -0.36], label: '3-Valve pistons' },
      portrait: { eye: [0.85, 1.56, -1.10], at: [0, 1.46, -0.24], label: 'Trumpeter portrait' },
      detail: { eye: [-0.48, 1.58, -0.95], at: [0, 1.48, -0.44], label: 'Bell & pistons' },
      wide: { eye: [-1.8, 1.65, -2.8], at: [0, 1.10, -0.24], label: '01 / Stage' },
    },
  }),
  harp: makeAdapter({
    id: 'harp', label: 'Harp', performerLabel: 'HARPIST', collection: 'THE HARP COLLECTION', detailLabel: 'STRINGS', global: 'HARP_INSTRUMENT',
    scoreHint: 'Gold notes are sounding · 47-string Concert Grand Harp (red = C, blue = F)',
    shots: {
      auto: [{ eye: [-1.15, 1.02, -3.03], at: [0, 0.82, -0.38], label: '01 / Concert Harp' }],
      hands: { eye: [-0.95, 1.20, -1.12], at: [-0.04, 1.02, -0.44], label: 'Hands on strings' },
      portrait: { eye: [-0.85, 1.42, -1.05], at: [0, 1.24, 0.02], label: 'Harpist portrait' },
      detail: { eye: [-0.85, 0.62, -1.45], at: [-0.04, 0.35, -0.35], label: '7 Pedals & base' },
      wide: { eye: [-1.8, 1.35, -3.3], at: [0, 0.86, -0.38], label: '01 / Stage' },
    },
  }),
  bass: makeAdapter({
    id: 'bass', label: 'Bass', performerLabel: 'BASSIST', collection: 'THE DOUBLE BASS COLLECTION', detailLabel: 'BOW', global: 'BASS_INSTRUMENT',
    scoreHint: 'Gold notes are sounding · Upright Double Bass (E1–A1–D2–G2) · alternating French bow',
    shots: {
      auto: [{ eye: [-0.65, 1.06, -3.05], at: [0.12, 0.88, -0.20], label: '01 / Double Bass' }],
      hands: { eye: [0.85, 1.60, -1.25], at: [0.19, 1.42, -0.24], label: 'Left hand shifts' },
      portrait: { eye: [-0.85, 1.72, -1.10], at: [0, 1.54, -0.05], label: 'Bassist portrait' },
      detail: { eye: [-0.65, 0.92, -1.55], at: [0.20, 0.74, -0.39], label: 'French bow' },
      wide: { eye: [-1.8, 1.45, -3.4], at: [0.10, 0.90, -0.20], label: '01 / Stage' },
    },
  }),
  percussion: makeAdapter({
    id: 'percussion', label: 'Percussion', performerLabel: 'PERCUSSIONIST', collection: 'CONCERT PERCUSSION', detailLabel: 'MALLETS', global: 'PERCUSSION_INSTRUMENT',
    clefFor: song => song.percKind === 'timpani' ? 'bass' : 'treble',
    scoreHint: 'Gold notes are sounding · Rosewood Marimba & 4 Copper Timpani',
    shots: {
      auto: [{ eye: [0, 1.24, -3.21], at: [0, 0.82, -0.46], label: '01 / Percussion' }],
      hands: { eye: [0.35, 2.05, -1.85], at: [0, 0.92, -0.50], label: 'Mallets overhead' },
      portrait: { eye: [0.85, 1.48, -1.70], at: [0, 1.22, -0.25], label: 'Percussionist' },
      detail: { eye: [-0.45, 1.32, -1.65], at: [0, 0.94, -0.48], label: 'Mallet detail' },
      wide: { eye: [-1.8, 1.65, -3.3], at: [0, 0.86, -0.46], label: '01 / Stage' },
    },
  }),
  quartet: makeAdapter({
    id: 'quartet', label: 'Quartet', performerLabel: 'QUARTET', collection: 'STRING QUARTET (4 PLAYERS)', detailLabel: 'STRINGS', global: 'QUARTET_INSTRUMENT',
    scoreHint: 'Gold notes are sounding · String Quartet (Vn I · Vn II · Viola · Cello) · lead voice shown',
    shots: {
      auto: [{ eye: [0, 1.14, -4.90], at: [0, 0.78, -0.05], label: '01 / Quartet' }],
      hands: { eye: [1.50, 1.50, -2.05], at: [0.75, 1.22, -0.10], label: 'Violin I & II bows' },
      portrait: { eye: [-1.45, 1.30, -2.15], at: [-0.82, 1.02, -0.05], label: 'Viola & Cello' },
      detail: { eye: [0.35, 2.55, -3.75], at: [0, 0.95, 0], label: 'Quartet semicircle' },
      wide: { eye: [0, 1.25, -5.05], at: [0, 0.82, -0.05], label: '01 / Hall' },
    },
  }),
  ensemble: makeAdapter({
    id: 'ensemble', label: 'Ensemble', performerLabel: 'DECET', collection: 'ALL-STAR DECET (10 PLAYERS)', detailLabel: 'WINDS', global: 'ENSEMBLE_INSTRUMENT',
    scoreHint: 'Gold notes are sounding · 10-Player All-Star Decet (Fl · Ob · Gt · Pf · 4 Vn · 2 Vc) · lead voice shown',
    shots: {
      auto: [{ eye: [0, 1.26, -6.80], at: [0, 0.68, 0.45], label: '01 / All-Star Decet' }],
      hands: { eye: [1.55, 1.60, -2.55], at: [1.05, 1.22, 0.15], label: '4-Violin section' },
      portrait: { eye: [0.25, 1.52, -0.75], at: [0, 1.28, 1.32], label: 'Flute & Oboe soloists' },
      detail: { eye: [-1.55, 1.35, -2.55], at: [-1.15, 0.95, -0.32], label: 'Cellos & Guitar' },
      wide: { eye: [0, 1.38, -7.00], at: [0, 0.72, 0.45], label: '01 / Grand Stage' },
    },
  }),
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
let orbitA = -0.8, orbitH = 2.2, orbitR = 4.2, manualCamera = null, lastCamera = null;
const memory = {};             // per-instrument {songId, position}
let pianoButtons = null;       // stashed piano song buttons
const pianoDOM = {};           // original texts to restore
const hintSpan = document.querySelector('.score-caption').children[1];

// The URL owns the shareable selection; playback time stays in memory.
// Preserve the hosting path, unrelated query parameters and fragment.
let restoringSelection = false;
const hasSelectionURL = typeof URL === 'function' && window.location && window.history;
function syncSelectionURL(replace = false) {
  if (!hasSelectionURL || restoringSelection) return;
  const url = new URL(window.location.href);
  url.searchParams.set('instrument', active ? active.id : 'piano');
  url.searchParams.set('song', active ? song.id : window.recital.getState().song);
  if (url.href !== window.location.href)
    window.history[replace ? 'replaceState' : 'pushState'](window.history.state, '', url.href);
}
function restoreSelectionURL() {
  if (!hasSelectionURL) return;
  const params = new URL(window.location.href).searchParams;
  const requested = params.get('instrument');
  const id = Object.hasOwn(ADAPTERS, requested) ? requested : 'piano';
  const songs = id === 'piano' ? window.SONGS : ADAPTERS[id].songs();
  const selected = songs.find(s => s.id === params.get('song')) || songs[0];
  const currentId = active ? active.id : 'piano';
  const currentSong = active ? song.id : window.recital.getState().song;
  restoringSelection = true;
  try {
    if (id !== currentId || selected.id !== currentSong) {
      if (id === 'piano') {
        enterPiano();
        window.recital.pause();
        if (window.recital.getState().song !== selected.id) window.recital.choose(selected.id);
      } else enterString(ADAPTERS[id], selected.id);
    }
  } finally { restoringSelection = false; }
  syncSelectionURL(true);
}

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
    ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 44100, latencyHint: 'playback' });
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
  syncSelectionURL();
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
function enterString(a, songId) {
  if (!a) return;
  if (active === a) { if (songId && songId !== song.id) selectSong(songId); return; }
  if (active) { memory[active.id] = { songId: song.id, position }; pauseStr(); }
  else {
    window.recital.pause();
    window.recital.setRenderEnabled(false);
    if (!pianoButtons) { pianoButtons = [...$('songs').children]; pianoDOM.edition = document.querySelector('.edition').innerHTML; pianoDOM.count = document.querySelector('.collection-heading>span').textContent; pianoDOM.hint = hintSpan.textContent; pianoDOM.title = document.title; }
    pianoDOM.startHidden = $('start').classList.contains('hidden');
    $('pedalHUD').classList.add('hidden'); $('start').classList.add('hidden');
  }
  cameraControl.cancel();
  active = a;
  document.querySelector('.edition').innerHTML = a.collection + ' <b>' + String(a.songs().length).padStart(2, '0') + '</b>';
  document.querySelector('.collection-heading>span').textContent = 'Choose from ' + a.songs().length + ' pieces';
  hintSpan.textContent = a.scoreHint;
  document.querySelectorAll('.instruments button').forEach(b => { const on = b.dataset.instrument === a.id; b.classList.toggle('selected', on); b.setAttribute('aria-pressed', String(on)); });
  syncCameraUI();
  buildSongs();
  const mem = memory[a.id];
  selectSong(songId || (mem && a.songs().some(s => s.id === mem.songId) ? mem.songId : a.songs()[0].id));
  if (mem && mem.songId === song.id) position = clamp(mem.position || 0, 0, song.duration);
  $('play').disabled = false;
  setScoreOpen(a.id !== 'quartet' && a.id !== 'ensemble');
}
function enterPiano() {
  if (!active) return;
  memory[active.id] = { songId: song.id, position }; pauseStr();
  // Do not leave the shell's AudioContext running alongside the piano's:
  // two live contexts compete for the device audio path (and burn CPU).
  // playStr() resumes it on the next string playback.
  if (ctx && ctx.state === 'running') ctx.suspend();
  cameraControl.cancel();
  active = null; song = null; plan = null;
  window.recital.setRenderEnabled(true);
  setScoreOpen(true);
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
  window.recital.syncCameraUI?.();
  syncSelectionURL();
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
// Adapter for the approved cello's immutable planning-space triangle mesh.
// Keep the vendored violin renderer byte-identical to its source module.
// The active RecitalGL program uses xyz/normal attributes and the same
// X-reflected model/normal matrices as piece(); cache uploads per renderer.
function attachCelloMesh(R) {
  const gl = R.gl;
  if (R.mesh || !gl || typeof gl.getParameter !== 'function') return;
  const program = gl.getParameter(gl.CURRENT_PROGRAM), buffers = new WeakMap();
  const begin = R.begin;
  R.begin = (...args) => { gl.useProgram(program); return begin(...args); };
  const attrs = ['aP', 'aN'].map(name => gl.getAttribLocation(program, name));
  const U = Object.fromEntries(['uM', 'uN', 'uC', 'uMetal'].map(name => [name, gl.getUniformLocation(program, name)]));
  const model = new Float32Array([-1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
  const normal = new Float32Array([-1,0,0, 0,1,0, 0,0,1]);
  R.mesh = (data, color) => {
    let buffer = buffers.get(data);
    if (!buffer) {
      buffer = gl.createBuffer(); buffers.set(data, buffer);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    } else gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    for (let i = 0; i < attrs.length; i++) {
      gl.enableVertexAttribArray(attrs[i]); gl.vertexAttribPointer(attrs[i], 3, gl.FLOAT, false, 24, i * 12);
    }
    gl.uniformMatrix4fv(U.uM, false, model); gl.uniformMatrix3fv(U.uN, false, normal);
    gl.uniform3fv(U.uC, color); gl.uniform1f(U.uMetal, 0);
    gl.drawArrays(gl.TRIANGLES, 0, data.length / 6);
  };
}
let lastNow = performance.now(), lastRenderSig = '';
function frame(now) {
  requestAnimationFrame(frame);
  if (!active || document.hidden || now - lastNow < 1000 / 30) return;
  const dt = Math.min(0.05, (now - lastNow) / 1000); lastNow = now;
  const sharedGL = $('scene').getContext('webgl');
  const previousProgram = sharedGL && typeof sharedGL.getParameter === 'function' ? sharedGL.getParameter(sharedGL.CURRENT_PROGRAM) : null;
  if (!renderer) { try { renderer = window.RecitalGL.create($('scene')); attachCelloMesh(renderer); } catch (e) { return; } }
  const t = currentTime();
  // Avoid redundant pose computation for modes whose camera does not track hands.
  const needsPose = active.id !== 'cello' && !['quartet', 'ensemble', 'harp', 'bass', 'percussion'].includes(active.id);
  const pose = active.id === 'cello' ? (camMode==='auto'?window.CelloMotion.poseCached(song,t):null) : (needsPose ? active.pose(plan, t) : null);
  // Camera resolution.
  let shot = null, dynEye = null, dynAt = null;
  const S = active.shots;
  if (camMode === 'auto') { shot = cinematic[active.id].at(t,CinematicCamera.subjects(active.id,pose),{key:song.id,aspect:$('scene').clientWidth/$('scene').clientHeight,reducedMotion:!!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches}); }
  else if (camMode === 'hands' && typeof S.hands === 'function') { const d = S.hands(pose); dynEye = d.eye; dynAt = d.at; shot = d; }
  else if (camMode === 'orbit') { dynEye = manualCamera?manualCamera.eye:[Math.sin(orbitA) * orbitR, orbitH, Math.cos(orbitA) * orbitR]; dynAt = manualCamera?manualCamera.at:[0, 1.05, 0]; shot = { label: 'Drag to rotate · pinch/scroll to zoom · two fingers to pan' }; }
  else shot = S[camMode === 'pedal' ? 'detail' : camMode] || S.auto[0];
  const manual=camMode==='orbit'&&manualCamera;
  if(manual){eye=manual.eye;target=manual.at;}
  else if(camMode==='auto'){eye=shot.eye;target=shot.at;}
  else if (dynEye) { eye = lerp(eye, dynEye, 1 - Math.exp(-dt * 3)); target = lerp(target, dynAt, 1 - Math.exp(-dt * 3)); }
  else if (shot) { const k = camMode === 'auto' ? 2 : 3; eye = lerp(eye, shot.eye, 1 - Math.exp(-dt * k)); target = lerp(target, shot.at, 1 - Math.exp(-dt * k)); }
  const narrow = !manual && camMode!=='auto' && $('scene').clientWidth < 650 && !['hands', 'pedal', 'portrait'].includes(camMode);
  const renderEye = narrow ? eye.map((v, i) => i === 1 ? v + 0.4 : v * 1.23) : eye;
  lastCamera={eye:renderEye.slice(),at:target.slice(),up:manual?manual.up.slice():camMode==='auto'?shot.up:[0,1,0]};
  const scCv = $('scene'), scoreVis = $('score').style.display !== 'none';
  const sig = playing ? '' : `${active.id}:${song.id}:${t.toFixed(3)}:${camMode}:${scoreVis}:${scCv.clientWidth}x${scCv.clientHeight}:${renderEye.map(v=>v.toFixed(3))}:${target.map(v=>v.toFixed(3))}`;
  if (!playing && sig === lastRenderSig) { if (previousProgram) sharedGL.useProgram(previousProgram); return; }
  lastRenderSig = sig;
  renderer.begin(renderEye, target,lastCamera.up);
  drawStage(renderer);
  if (active.id === 'cello') active.draw(renderer, plan, t, song);
  else if (pose && active.I && active.I().draw && active.id !== 'guitar') active.I().draw(renderer, pose);
  else active.draw(renderer, plan, t);
  // Score (skip drawing when accordion is collapsed; throttle to 30fps during playback).
  const cv = $('score');
  if (cv.style.display !== 'none' && (!playing || (frame._sc = ((frame._sc || 0) + 1) & 1) === 0)) {
    if (active.prepareScoreCanvas) {
      const dpr = Math.min(devicePixelRatio || 1, 1.5);
      if (cv.width !== Math.round(cv.clientWidth * dpr)) { cv.width = Math.round(cv.clientWidth * dpr); cv.height = Math.round(cv.clientHeight * dpr); }
      const c2 = cv.getContext('2d'); c2.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    active.drawScore(cv, song, plan, t);
  }
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
  if (previousProgram) sharedGL.useProgram(previousProgram);
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
  if (b) { cameraControl.cancel();manualCamera=null;camMode=b.dataset.camera;syncCameraUI(); }
});
// Orbit controls for string mode.
function syncCameraUI(){document.querySelectorAll('[data-camera]').forEach(b=>b.classList.toggle('selected',b.dataset.camera===camMode));$('cameraLabel').textContent=camLabel();}
const cameraControl=CameraGestures.bind($('scene'),{enabled:()=>!!active,isOrbit:()=>camMode==='orbit',camera:()=>camMode==='orbit'&&manualCamera||lastCamera,minDistance:.15,maxDistance:25,change:c=>{manualCamera=c;if(camMode!=='orbit'){camMode='orbit';syncCameraUI();}}});

// ------------------------------------------------------------------
// Switcher wiring + score panel collapse (works for every instrument)
// ------------------------------------------------------------------
document.querySelectorAll('.instruments button').forEach(b => b.addEventListener('click', () => {
  const id = b.dataset.instrument;
  if (id === 'piano') enterPiano();
  else enterString(ADAPTERS[id]);
}));
const scorePanel = document.querySelector('.score-panel');
const scoreCaption = document.querySelector('.score-caption');
const toggle = document.createElement('button');
toggle.className = 'score-toggle'; toggle.textContent = '▾ Hide score'; toggle.setAttribute('aria-expanded', 'true');
function setScoreOpen(open) {
  const cv = $('score');
  cv.style.display = open ? '' : 'none';
  scorePanel?.classList.toggle('collapsed', !open);
  toggle.textContent = open ? '▾ Hide score' : '▸ Show score';
  toggle.setAttribute('aria-expanded', String(!!open));
}
toggle.onclick = e => { e.stopPropagation(); setScoreOpen($('score').style.display === 'none'); };
scoreCaption.addEventListener('click', () => setScoreOpen($('score').style.display === 'none'));
scoreCaption.append(toggle);

// Debug/test surface (mirrors window.recital's shape). debugSides
// reports each wrist's side of the TORSO sagittal plane (a quick
// diagnostic) plus the front-view screen order — the formulation-
// independent invariant (bow/pluck hand on the viewer's left). The
// pinned face-derived handedness audits live in integration-test.cjs.
function debugSides() {
  if (!active) return null;
  const t = currentTime();
  const pose = active.id === 'cello' ? (window.CelloMotion.poseCached(song, t) || window.CelloMotion.pose(song, t)) : active.pose(plan, t);
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
  chooseSong(id) { if (active) selectSong(id); else window.recital.choose(id); },
  seek: t => { if (active) seekStr(t); },
  play: () => playStr(), pause: () => pauseStr(),
  getState: () => ({ instrument: active ? active.id : 'piano', song: active ? song.id : window.recital.getState().song, time: active ? currentTime() : window.recital.getState().time, playing: active ? playing : window.recital.getState().playing }),
  debugSides,
};
window.addEventListener('recital-song-change', () => { if (!active) syncSelectionURL(); });
window.addEventListener('popstate', restoreSelectionURL);
restoreSelectionURL();
})();

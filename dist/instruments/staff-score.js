'use strict';
/* Generic single-staff score strip for the string instruments whose
 * modules leave score drawing to the host (violin and cello — see their
 * INTERFACE.md). Guitar keeps its own engraved strip (guitar-score.js)
 * and the piano keeps PianoScore.
 *
 * One staff, scrolling with a fixed gold playhead, sounding notes in
 * gold — the same conventions as the piano score. Pitch spelling,
 * key signatures and flag counts reuse PianoScore's helpers so all
 * four instruments spell consistently. Clefs follow the module's
 * scoreConfig (violin: treble throughout; cello: bass/tenor/treble by
 * register, with clef-change glyphs inline). Fingering/bowing
 * annotations come from each module's scoreConfig.
 *
 * Like the piano score this is an automatic transcription from the
 * performance data, not a critical edition. */
window.StringScore = (() => {
const PS = window.PianoScore;
// Diatonic anchors (PianoScore.spellPitch: diatonic = octave*7+letter,
// C4 = 35). Bottom line of each clef:
const CLEFS = {
  treble: { bottom: 37, glyph: '𝄞', name: 'treble' },  // E4..F5
  tenor:  { bottom: 29, glyph: '𝄡', name: 'tenor' },   // D3..E4, C clef on 4th line (dia 35)
  bass:   { bottom: 25, glyph: '𝄢', name: 'bass' },    // G2..A3
};
const cache = new WeakMap();
// Precompute per-note spelling with barline accidental resets, exactly
// like PianoScore.model: an accidental lasts for the rest of its bar.
function prepare(song, cfg) {
  if (cache.has(song)) return cache.get(song);
  const sig0 = cfg.signature || { numerator: 4, denominator: 4 };
  const bar = sig0.numerator * 4 / sig0.denominator;
  const out = new Array(song.notes.length);
  let measure = null, barAlter = new Map();
  for (let i = 0; i < song.notes.length; i++) {
    const n = song.notes[i], beat = cfg.beatAt(n[0]);
    const sig = cfg.signatureAt ? cfg.signatureAt(beat) : sig0;
    const barLen = sig.numerator * 4 / sig.denominator;
    const id = Math.floor((beat + 1e-6) / barLen);
    if (measure !== id) { measure = id; barAlter = new Map(); }
    const fifths = cfg.fifthsAt ? cfg.fifthsAt(beat) : (cfg.fifths || 0);
    const sp = PS.spellPitch(n[2], fifths);
    const initial = PS.keyAccidentals(fifths)[sp.letter];
    const prev = barAlter.has(sp.diatonic) ? barAlter.get(sp.diatonic) : initial;
    const accidental = sp.alteration === prev ? null : sp.alteration === 0 ? '♮' : sp.alteration > 0 ? '♯' : '♭';
    barAlter.set(sp.diatonic, sp.alteration);
    out[i] = { beat, durBeats: Math.max(0.05, cfg.beatAt(n[0] + n[1]) - beat), dia: sp.diatonic, accidental };
    void bar;
  }
  cache.set(song, out);
  return out;
}
/* cfg: { song, t, beatAt(sec)->beat, clefFor(pitch)->clefName,
 * fifths | fifthsAt(beat), signature | signatureAt(beat),
 * annotation(i)->string (under the note), above(i)->string (over it) } */
function render(canvas, cfg) {
  const c = canvas.getContext('2d'); if (!c) return;
  const song = cfg.song, t = cfg.t;
  const w = canvas.clientWidth || 900, h = canvas.clientHeight || 180;
  const d = Math.min(window.devicePixelRatio || 1, 2);
  if (canvas.width !== Math.round(w * d) || canvas.height !== Math.round(h * d)) { canvas.width = Math.round(w * d); canvas.height = Math.round(h * d); }
  c.setTransform(d, 0, 0, d, 0, 0);
  c.clearRect(0, 0, w, h); c.fillStyle = '#17191c'; c.fillRect(0, 0, w, h);
  const notes = prepare(song, cfg);
  const beat = cfg.beatAt(t), pxBeat = w < 600 ? 40 : 46, headX = Math.max(70, Math.min(w * 0.30, 260));
  const gap = 8, top = Math.round(h / 2 - 2 * gap) - 6; // top staff line
  const yOf = (dia, clef) => top + (CLEFS[clef].bottom + 8 - dia) * gap / 2;
  const line = (x, y, x2, y2, color) => { c.strokeStyle = color; c.lineWidth = 1; c.beginPath(); c.moveTo(x, y); c.lineTo(x2, y2); c.stroke(); };
  for (let i = 0; i < 5; i++) line(8, top + i * gap, w, top + i * gap, '#6c655b');
  const clefAt = i => cfg.clefFor(song.notes[i][2]);
  // Key signature + current clef at the left, like the piano score.
  const fifths = cfg.fifthsAt ? cfg.fifthsAt(beat) : (cfg.fifths || 0);
  const curClef = (() => { let cl = clefAt(0); for (let i = 0; i < song.notes.length && song.notes[i][0] <= t; i++) cl = clefAt(i); return cl; })();
  c.fillStyle = '#dfbe83'; c.textBaseline = 'alphabetic';
  c.font = '34px Georgia,serif';
  if (curClef === 'tenor') { c.font = '30px Georgia,serif'; c.fillText('𝄡', 10, yOf(35, 'tenor') + 5); }
  else c.fillText(CLEFS[curClef].glyph, 10, top + (curClef === 'bass' ? 25 : 30));
  c.font = '15px Georgia,serif';
  for (const [i, g] of PS.keyGlyphs(fifths, curClef === 'bass').entries())
    c.fillText(g.symbol, 42 + i * 9, top + g.halfSteps * gap / 2 + 6);
  const sig = cfg.signatureAt ? cfg.signatureAt(beat) : (cfg.signature || { numerator: 4, denominator: 4 });
  c.font = '17px Georgia,serif';
  const timeX = 42 + Math.max(1, Math.abs(fifths)) * 9 + 5;
  c.fillText(String(sig.numerator), timeX, top + 12); c.fillText(String(sig.denominator), timeX, top + 29);
  // Barlines + numbers.
  const barLen = sig.numerator * 4 / sig.denominator;
  const startBeat = beat - headX / pxBeat, endBeat = beat + (w - headX) / pxBeat;
  c.font = '10px Arial';
  for (let b = Math.ceil(startBeat / barLen) * barLen; b < endBeat; b += barLen) {
    const x = headX + (b - beat) * pxBeat; if (x < timeX + 26) continue;
    line(x, top, x, top + 4 * gap, '#49453e');
    c.fillStyle = '#a39a8c'; c.fillText(String(Math.round(b / barLen) + 1), x + 4, top - 10);
  }
  // Visible note range.
  let lo = 0, hi = song.notes.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (notes[m].beat < startBeat - 0.5) lo = m + 1; else hi = m; }
  // Group simultaneous notes (same beat) into chord clusters.
  const groups = [];
  for (let i = lo; i < song.notes.length && notes[i].beat <= endBeat + 0.4; i++) {
    const g = groups[groups.length - 1];
    if (g && Math.abs(notes[i].beat - g.beat) < 0.045) g.items.push(i); else groups.push({ beat: notes[i].beat, items: [i] });
  }
  let prevClef = curClef;
  // Walk groups in order; clef changes are tracked from the piece start
  // so a change glyph is drawn exactly where the clef actually changes.
  let walkClef = clefAt(0);
  const groupClef = groups.map(g => { walkClef = clefAt(g.items[0]); return walkClef; });
  // Determine the clef in force just before the visible window:
  { let cl = clefAt(0); for (let i = 0; i < lo; i++) cl = clefAt(i); prevClef = cl; }
  groups.forEach((g, gi) => {
    const clef = groupClef[gi];
    const x = headX + (g.beat - beat) * pxBeat; if (x < timeX + 30) return;
    if (clef !== prevClef) { // clef change marker before the group
      c.fillStyle = '#a39a8c'; c.font = clef === 'tenor' ? '22px Georgia,serif' : '24px Georgia,serif';
      c.fillText(CLEFS[clef].glyph, x - 24, clef === 'tenor' ? yOf(35, clef) + 4 : top + (clef === 'bass' ? 19 : 22));
      prevClef = clef;
    }
    const items = g.items.map(i => ({ i, n: song.notes[i], e: notes[i], y: yOf(notes[i].dia, clef) }));
    const on = items.some(({ n }) => n[0] <= t && n[0] + n[1] > t);
    const meanDia = items.reduce((s, it) => s + it.e.dia, 0) / items.length;
    const up = meanDia < CLEFS[clef].bottom + 4;
    for (const it of items) {
      const color = (it.n[0] <= t && it.n[0] + it.n[1] > t) ? '#ffcc70' : '#d8d0c1';
      c.strokeStyle = '#8b8378'; c.lineWidth = 1;
      for (let dia = CLEFS[clef].bottom + 10; dia <= it.e.dia; dia += 2) line(x - 9, yOf(dia, clef), x + 9, yOf(dia, clef), color);
      for (let dia = CLEFS[clef].bottom - 2; dia >= it.e.dia; dia -= 2) line(x - 9, yOf(dia, clef), x + 9, yOf(dia, clef), color);
      if (it.e.accidental) { c.fillStyle = color; c.font = '15px Georgia,serif'; c.fillText(it.e.accidental, x - 18, it.y + 5); }
    }
    const far = up ? Math.min(...items.map(it => it.y)) : Math.max(...items.map(it => it.y));
    const stemX = x + (up ? 5 : -5), stemY = far + (up ? -27 : 27);
    const minDur = Math.min(...items.map(it => it.e.durBeats));
    line(stemX, far, stemX, stemY, on ? '#ffcc70' : '#d8d0c1');
    const flags = PS.flagCount(minDur);
    if (flags && minDur < 3.6) {
      c.strokeStyle = on ? '#ffcc70' : '#d8d0c1'; c.lineWidth = 1.1;
      for (let f = 0; f < flags; f++) {
        c.beginPath(); c.moveTo(stemX, stemY + (up ? f * 5 : -f * 5));
        c.quadraticCurveTo(stemX + 10, stemY + (up ? 10 : -10) + (up ? f * 5 : -f * 5), stemX + 6, stemY + (up ? 16 : -16) + (up ? f * 5 : -f * 5)); c.stroke();
      }
    }
    for (const it of items) {
      const color = (it.n[0] <= t && it.n[0] + it.n[1] > t) ? '#ffcc70' : '#d8d0c1';
      c.fillStyle = color; c.strokeStyle = color;
      c.beginPath(); c.ellipse(x, it.y, 5.7, 3.8, -0.35, 0, Math.PI * 2);
      if (it.e.durBeats >= 1.8) { c.lineWidth = 1.6; c.stroke(); } else c.fill();
    }
    // Annotations: fingering under the first note of the group, bow
    // marks above — skipped when groups are too dense to stay legible.
    const nextX = gi + 1 < groups.length ? headX + (groups[gi + 1].beat - beat) * pxBeat : Infinity;
    if (nextX - x > 13) {
      const i0 = g.items[0];
      const ann = cfg.annotation && cfg.annotation(i0);
      if (ann) { c.fillStyle = '#ffcc70'; c.font = '10px Arial'; c.fillText(ann, x - 5, top + 4 * gap + 16); }
      const abv = cfg.above && cfg.above(i0);
      if (abv) { c.fillStyle = '#a39a8c'; c.font = '11px Georgia,serif'; c.fillText(abv, x - 3, top - 16); }
    }
  });
  // Playhead.
  c.fillStyle = '#dfbe83';
  c.fillRect(headX - 0.75, 6, 1.5, h - 12);
  c.beginPath(); c.moveTo(headX - 5, 2); c.lineTo(headX + 5, 2); c.lineTo(headX, 9); c.fill();
  canvas.setAttribute('aria-label', song.title + ': automatic transcription. Clef ' + CLEFS[curClef].name + '.');
  return { beat, clef: curClef, groups: groups.length };
}
return { render, prepare, CLEFS };
})();

'use strict';
/* Simplified score strip for guitar: ONE treble staff, written an
 * octave above sounding pitch (the universal guitar convention — the
 * clef is a treble clef read 8vb). Pitch spelling follows the piece's
 * key signature; durations are quantised to the nearest standard value
 * on a quarter-beat grid; short notes are beamed within the beat;
 * sounding notes are gold. Fingering from the engine is printed as in
 * guitar editions: LH finger below the staff, string number in
 * parentheses, RH letter above for melody notes.
 * This is a reading aid, not a critical edition (see INTERFACE.md). */
window.GuitarScore = (() => {
const config = { clef: 'treble', writtenOctave: 1, staffLines: 5, label: 'treble clef, sounding 8vb' };
const NAT = [0, 2, 4, 5, 7, 9, 11], LETTERS = 'CDEFGAB';
const SHARP_ORDER = [3, 0, 4, 1, 5, 2, 6], FLAT_ORDER = [6, 2, 5, 1, 4, 0, 3]; // letter indices
/* Spelling: written pitch = sounding + 12. dia counts letter steps
 * with C4 (written middle C) = 35, so the treble staff spans dia
 * 37 (E4, bottom line) to 45 (F5, top line). */
function spellExact(writtenPitch, fifths) {
  const adj = {};
  for (let i = 0; i < Math.abs(fifths); i++) adj[fifths > 0 ? SHARP_ORDER[i] : FLAT_ORDER[i]] = fifths > 0 ? 1 : -1;
  const target = ((writtenPitch % 12) + 12) % 12;
  const order = fifths < 0 ? [0, -1, 1] : [0, 1, -1]; // prefer the key's own letters, then its accidental direction
  for (const alter of order) for (let L = 0; L < 7; L++) {
    const keyPc = (NAT[L] + (adj[L] || 0) + 12) % 12;
    if ((keyPc + alter + 12) % 12 === target) {
      const M = writtenPitch - alter - (adj[L] || 0); // the letter's natural pitch -> octave anchor
      return { letter: L, alter, dia: (Math.floor(M / 12) - 1) * 7 + L };
    }
  }
  return { letter: 0, alter: 0, dia: 28 };
}
function beatAt(song, t) {
  const T = song.tempos; if (!T || !T.length) return t * (song.bpm || 100) / 60;
  let lo = 0; for (let i = 0; i < T.length; i++) if (T[i].time <= t) lo = i;
  const a = T[lo], b = T[lo + 1];
  if (!b) return a.beat + (t - a.time) * a.bpm / 60;
  const span = b.time - a.time; return span > 0 ? a.beat + (b.beat - a.beat) * (t - a.time) / span : a.beat;
}
function timeAt(song, beat) {
  const T = song.tempos; if (!T || !T.length) return beat * 60 / (song.bpm || 100);
  let lo = 0; for (let i = 0; i < T.length; i++) if (T[i].beat <= beat) lo = i;
  const a = T[lo], b = T[lo + 1];
  if (!b) return a.time + (beat - a.beat) * 60 / a.bpm;
  const span = b.beat - a.beat; return span > 0 ? a.time + (b.time - a.time) * (beat - a.beat) / span : a.time;
}
const VALUES = [[4, 0], [3, 1], [2, 0], [1.5, 1], [1, 0], [0.75, 1], [0.5, 0], [0.375, 1], [0.25, 0], [0.1875, 1], [0.125, 0]];
function quantize(durBeats) {
  let best = VALUES[VALUES.length - 1];
  for (const v of VALUES) if (Math.abs(v[0] - durBeats) < Math.abs(best[0] - durBeats)) best = v;
  return { value: best[0], dotted: !!best[1] };
}
function drawStrip(c, song, plan, t, W, H) {
  const fifths = song.keyFifths || 0, A = song.fingering.assignments;
  const midY = H * 0.46, gap = Math.max(5, H * 0.055), top = midY - 2 * gap; // top line y
  const beat = beatAt(song, t), pxBeat = 46, headX = W * 0.30;
  c.clearRect(0, 0, W, H);
  c.fillStyle = '#12100d'; c.fillRect(0, 0, W, H);
  c.strokeStyle = '#6c655b'; c.lineWidth = 1; c.beginPath();
  for (let i = 0; i < 5; i++) { c.moveTo(0, top + i * gap); c.lineTo(W, top + i * gap); }
  c.stroke();
  const yOf = dia => top + (38 - dia) * gap / 2; // dia 38 = F5 top line, 30 = E4 bottom line, C4 = 28
  c.fillStyle = '#d8d0c1'; c.font = `${gap * 4.6}px serif`; c.textBaseline = 'middle';
  c.fillText('𝄞', 8, top + 2 * gap + 1);
  c.font = `${gap * 1.1}px serif`; c.fillText('8', 13, top + 4 * gap + gap * .8);
  // Barlines every bar (from signatures or 4/4 default).
  const sig = (song.signatures && song.signatures[0]) || { numerator: 4, denominator: 4 };
  const bar = sig.numerator * 4 / sig.denominator;
  const beamUnit = (sig.denominator === 8 && sig.numerator % 3 === 0) ? 1.5 : 4 / sig.denominator;
  c.strokeStyle = '#4c463f';
  for (let b = Math.floor(beat / bar) * bar; b < beat + W / pxBeat; b += bar) {
    const x = headX + (b - beat) * pxBeat; if (x < 34) continue;
    c.beginPath(); c.moveTo(x, top); c.lineTo(x, top + 4 * gap); c.stroke();
    c.fillStyle = '#8b8378'; c.font = `${gap * 1.05}px sans-serif`; c.fillText(String(Math.round(b / bar) + 1), x + 3, top - gap * .75); c.fillStyle = '#d8d0c1';
  }
  const span = W / pxBeat;
  const from = Math.max(0, beat - headX / pxBeat - 1.5), to = beat + span + 1.5;
  const evs = plan.events;
  let ei = evs.findIndex(e => beatAt(song, e.t) > from); if (ei < 0) ei = evs.length;
  const groups = [];
  for (let e = Math.max(0, ei - 1); e < evs.length; e++) {
    const ev = evs[e], eb = beatAt(song, ev.t); if (eb > to) break;
    const x = headX + (eb - beat) * pxBeat;
    const ds = [];
    for (const nt of ev.notes) {
      const wPitch = nt.pitch + 12, sp = spellExact(wPitch, fifths);
      const y = yOf(sp.dia), q = quantize(Math.max(0.09, beatAt(song, nt.end) - eb));
      const on = nt.t <= t && nt.end > t;
      ds.push({ x, y, dia: sp.dia, alter: sp.alter, q, on, nt, sp });
    }
    if (!ds.length) continue;
    const shortest = Math.min(...ds.map(d => d.q.value));
    const flags = shortest <= 0.125 ? 3 : shortest <= 0.25 ? 2 : shortest <= 0.5 ? 1 : 0;
    const cell = Math.floor((eb + 1e-5) / beamUnit);
    groups.push({ x, eb, ds, shortest, flags, cell, beam: null });
  }
  // Group consecutive beamable events within the same beat cell.
  const beams = [];
  let run = [];
  const finishBeam = () => {
    if (run.length > 1) {
      const all = run.flatMap(g => g.ds);
      const up = all.reduce((s, d) => s + d.dia, 0) / all.length < 34;
      const beam = { groups: run.slice(), up };
      beams.push(beam);
      for (const g of run) g.beam = beam;
    }
    run = [];
  };
  for (const g of groups) {
    if (!g.flags) { finishBeam(); continue; }
    const prev = run.at(-1);
    if (prev && (prev.cell !== g.cell || g.eb - prev.eb > Math.max(prev.shortest, 0.5) + 0.08)) finishBeam();
    run.push(g);
  }
  finishBeam();

  c.save();
  c.beginPath(); c.rect(34, 0, Math.max(0, W - 34), H); c.clip();
  // Draw beams (primary + secondary + fractional beamlets) and stems for beamed groups.
  for (const beam of beams) {
    const up = beam.up, stemOff = up ? 4.6 : -4.6, stemLen = gap * 3.4;
    const placed = beam.groups.map(g => ({
      g, sx: g.x + stemOff,
      ys: g.ds.map(d => d.y),
      far: up ? Math.min(...g.ds.map(d => d.y)) : Math.max(...g.ds.map(d => d.y)),
      near: up ? Math.max(...g.ds.map(d => d.y)) : Math.min(...g.ds.map(d => d.y)),
    }));
    const first = placed[0], last = placed.at(-1);
    if (last.sx < 30 || first.sx > W + 10) continue;
    const avg = p => p.ys.reduce((s, y) => s + y, 0) / p.ys.length;
    const slope = Math.max(-0.22, Math.min(0.22, (avg(last) - avg(first)) / Math.max(1, last.sx - first.sx)));
    const intercept = up
      ? Math.min(...placed.map(p => p.far - stemLen - slope * (p.sx - first.sx)))
      : Math.max(...placed.map(p => p.far + stemLen - slope * (p.sx - first.sx)));
    const beamY = x => intercept + slope * (x - first.sx);
    const drawBar = (x0, x1, level) => {
      const dy = (up ? 1 : -1) * level * Math.max(4.0, gap * 0.58);
      const thick = up ? Math.max(2.4, gap * 0.34) : -Math.max(2.4, gap * 0.34);
      c.fillStyle = '#c7bfa9';
      c.beginPath();
      c.moveTo(x0, beamY(x0) + dy);
      c.lineTo(x1, beamY(x1) + dy);
      c.lineTo(x1, beamY(x1) + dy + thick);
      c.lineTo(x0, beamY(x0) + dy + thick);
      c.closePath();
      c.fill();
    };
    for (const p of placed) {
      const on = p.g.ds.some(d => d.on);
      c.strokeStyle = on ? '#ffcc70' : '#c7bfa9'; c.lineWidth = 1.2;
      c.beginPath(); c.moveTo(p.sx, p.near); c.lineTo(p.sx, beamY(p.sx)); c.stroke();
    }
    drawBar(first.sx, last.sx, 0);
    const maxFlags = Math.max(...placed.map(p => p.g.flags));
    for (let level = 1; level < maxFlags; level++) {
      for (let i = 0; i < placed.length; i++) {
        const p = placed[i], next = placed[i + 1], prev = placed[i - 1];
        if (p.g.flags <= level) continue;
        if (next && next.g.flags > level) drawBar(p.sx, next.sx, level);
        else if (!prev || prev.g.flags <= level) {
          const dir = next ? 1 : -1;
          const len = Math.min(7, Math.abs((next || prev).sx - p.sx) * 0.42);
          drawBar(p.sx, p.sx + dir * len, level);
        }
      }
    }
  }
  // Ledger lines + accidentals + un-beamed stems/flags + noteheads + fingering.
  for (const g of groups) {
    const { x, ds } = g;
    if (x < 30 || x > W + 10) continue;
    const up = g.beam ? g.beam.up : ds.reduce((s, d) => s + d.dia, 0) / ds.length < 34;
    for (const d of ds) {
      c.strokeStyle = '#8b8378'; c.lineWidth = 1.1;
      for (let dia = 40; dia <= d.dia; dia += 2) if (d.dia >= 40) { c.beginPath(); c.moveTo(x - 7.5, yOf(dia)); c.lineTo(x + 7.5, yOf(dia)); c.stroke(); }
      for (let dia = 28; dia >= d.dia; dia -= 2) if (d.dia <= 28) { c.beginPath(); c.moveTo(x - 7.5, yOf(dia)); c.lineTo(x + 7.5, yOf(dia)); c.stroke(); }
      if (d.alter) { c.fillStyle = d.on ? '#ffcc70' : '#d8d0c1'; c.font = `${gap * 1.9}px serif`; c.fillText(d.alter > 0 ? '♯' : '♭', x - 15, d.y); }
    }
    if (!g.beam) {
      const far = up ? Math.min(...ds.map(d => d.y)) : Math.max(...ds.map(d => d.y));
      const near = up ? Math.max(...ds.map(d => d.y)) : Math.min(...ds.map(d => d.y));
      const stemEnd = up ? far - gap * 3.4 : far + gap * 3.4, sx = up ? x + 4.6 : x - 4.6;
      c.strokeStyle = ds.some(d => d.on) ? '#ffcc70' : '#c7bfa9'; c.lineWidth = 1.2;
      c.beginPath(); c.moveTo(sx, near); c.lineTo(sx, stemEnd); c.stroke();
      if (g.flags > 0) {
        c.beginPath();
        for (let f = 0; f < g.flags; f++) {
          const y0 = stemEnd + (up ? f * gap * .8 : -f * gap * .8);
          c.moveTo(sx, y0); c.quadraticCurveTo(sx + 7, y0 + (up ? gap * .9 : -gap * .9), sx + 8.5, y0 + (up ? gap * 1.7 : -gap * 1.7));
        }
        c.stroke();
      }
    }
    for (const d of ds) {
      c.save(); c.translate(x, d.y); c.rotate(-0.32);
      c.fillStyle = d.on ? '#ffcc70' : '#e3dccb';
      c.beginPath(); c.ellipse(0, 0, 4.9, 3.55, 0, 0, Math.PI * 2);
      if (d.q.value >= 2) { c.fillStyle = '#12100d'; c.fill(); c.fillStyle = d.on ? '#ffcc70' : '#e3dccb'; c.beginPath(); c.ellipse(0, 0, 3.1, 1.9, 0, 0, Math.PI * 2); }
      c.fill(); c.restore();
      if (d.q.dotted) { c.fillStyle = '#d8d0c1'; c.beginPath(); c.arc(x + 9.5, d.y - (d.dia % 2 === 0 ? gap / 2 : 0), 1.4, 0, Math.PI * 2); c.fill(); }
      // Fingering: LH finger + string below, RH letter above (as printed in guitar editions).
      const a = A[d.nt.i];
      c.fillStyle = '#9a917f'; c.font = `${gap * 1.02}px sans-serif`; c.textAlign = 'center';
      c.fillText(a.lh ? String(a.lh) : '0', x, top + 4 * gap + gap * 1.15);
      if (a.fret > 0) c.fillText('(' + a.string + ')', x, top + 4 * gap + gap * 2.1);
      c.fillStyle = '#7d7668'; c.fillText(a.rh, x, top - gap * 1.5);
      c.textAlign = 'left';
    }
  }
  c.restore();
  c.fillStyle = 'rgba(255,204,112,.85)'; c.fillRect(headX - .75, 6, 1.5, H - 12);
}
return { config, spell: spellExact, beatAt, timeAt, quantize, drawStrip };
})();

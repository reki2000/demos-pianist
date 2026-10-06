// Piano arrangements written for this project from public-domain melodies.
// Each returns events in beats ({beat, length, pitch, velocity, hand}; hand 0 = right),
// the base tempo, an expressive tempo factor and the score's time and key signatures.
'use strict';
const NAMES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const midi = (name) => {
  const m = /^([A-G])(#|b)?(-?\d)$/.exec(name);
  return 12 * (Number(m[3]) + 1) + NAMES[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// "When the Saints Go Marching In" (traditional), swing stride arrangement in C.
// Melody bars of one 16-bar chorus: [beat in bar, length, pitch].
const SAINTS_MELODY = [
  [[1, 1, 'C4'], [2, 1, 'E4'], [3, 1, 'F4']],
  [[0, 4, 'G4']],
  [[1, 1, 'C4'], [2, 1, 'E4'], [3, 1, 'F4']],
  [[0, 4, 'G4']],
  [[1, 1, 'C4'], [2, 1, 'E4'], [3, 1, 'F4']],
  [[0, 2, 'G4'], [2, 2, 'E4']],
  [[0, 2, 'C4'], [2, 2, 'E4']],
  [[0, 4, 'D4']],
  [[1, 1, 'E4'], [2, 1, 'E4'], [3, 1, 'D4']],
  [[0, 3, 'C4'], [3, 1, 'C4']],
  [[0, 2, 'E4'], [2, 1, 'G4'], [3, 1, 'G4']],
  [[0, 2, 'F4'], [2, 1, 'E4'], [3, 1, 'F4']],
  [[0, 2, 'G4'], [2, 2, 'E4']],
  [[0, 2, 'C4'], [2, 2, 'D4']],
  [[0, 4, 'C4']],
  [],
];
// Two chords per bar (first and second half).
const SAINTS_CHORDS = [
  ['C', 'C'], ['C', 'C'], ['C', 'C'], ['C', 'C7'], ['C', 'C'], ['C', 'C'], ['C', 'C'], ['G7', 'G7'],
  ['G7', 'G7'], ['C', 'C'], ['C', 'C7'], ['F', 'Fm'], ['C', 'C'], ['G7', 'G7'], ['C', 'C'], ['A7', 'G7'],
];
const CHORDS = {
  C: { root: 'C3', fifth: 'G2', tones: ['E3', 'G3', 'C4'] },
  C7: { root: 'C3', fifth: 'G2', tones: ['E3', 'G3', 'Bb3'] },
  F: { root: 'F2', fifth: 'C3', tones: ['F3', 'A3', 'C4'] },
  Fm: { root: 'F2', fifth: 'C3', tones: ['F3', 'Ab3', 'C4'] },
  G7: { root: 'G2', fifth: 'D3', tones: ['F3', 'G3', 'B3'] },
  A7: { root: 'A2', fifth: 'E3', tones: ['G3', 'C#4', 'E4'] },
};
// Blues fills over long melody notes in the second chorus.
const SAINTS_FILLS = {
  1: [[2, 0.5, 'A5'], [2.5, 0.5, 'G5'], [3, 0.5, 'Eb5'], [3.5, 0.5, 'E5']],
  3: [[2, 0.5, 'C6'], [2.5, 0.5, 'A5'], [3, 0.5, 'G5'], [3.5, 0.5, 'E5']],
  7: [[2, 0.5, 'F5'], [2.5, 0.5, 'E5'], [3, 0.5, 'D5'], [3.5, 0.5, 'B4']],
};

function saints() {
  const events = [], add = (beat, length, pitch, velocity, hand) => events.push({ beat, length, pitch, velocity: Math.round(clamp(velocity, 24, 112)), hand });
  const stride = (start, bar, base) => {
    SAINTS_CHORDS[bar].forEach((name, half) => {
      const c = CHORDS[name], b = start + half * 2, bass = midi(half ? c.fifth : c.root);
      add(b, 0.9, bass - 12, base + 4, 1);
      add(b, 0.9, bass, base, 1);
      for (const t of c.tones) add(b + 1, 0.42, midi(t), base - 12 + 4, 1);
    });
  };
  // Harmony a third to a sixth below the tune, taken from the current chord.
  const below = (pitch, chord) => {
    const pcs = CHORDS[chord].tones.map((t) => midi(t) % 12).concat(midi(CHORDS[chord].root) % 12);
    for (let d = 3; d <= 9; d++) if (pcs.includes((pitch - d + 120) % 12)) return pitch - d;
    return null;
  };
  let beat = 0;
  // Intro: the last line, in octaves.
  for (const bar of [11, 12, 13, 14]) {
    for (const [b, len, p] of SAINTS_MELODY[bar]) { add(beat + b, len, midi(p) + 12, 70, 0); add(beat + b, len, midi(p) + 24, 64, 0); }
    stride(beat, bar, 62);
    beat += 4;
  }
  for (const chorus of [0, 1]) {
    for (let bar = 0; bar < 16; bar++) {
      const start = beat + bar * 4;
      for (const [b, len, p] of SAINTS_MELODY[bar]) {
        const pitch = midi(p) + 12 + (chorus ? 0 : 0), chord = SAINTS_CHORDS[bar][b < 2 ? 0 : 1];
        const held = chorus && SAINTS_FILLS[bar] ? Math.min(len, 2) : len;
        add(start + b, held, pitch, chorus ? 80 : 70, 0);
        if (chorus) { const h = below(pitch, chord); if (h) add(start + b, held, h, 62, 0); }
      }
      if (chorus) for (const [b, len, p] of SAINTS_FILLS[bar] || []) add(start + b, len, midi(p), 74, 0);
      if (bar === 15) {
        // Turnaround pickup into the next chorus or the tag.
        for (const [b, len, p] of [[0, 1, 'C5'], [1, 0.5, 'E5'], [1.5, 0.5, 'G5'], [2, 1, 'A5'], [3, 1, 'G5']]) add(start + b, len, midi(p), 68, 0);
      }
      stride(start, bar, chorus ? 70 : 62);
    }
    beat += 64;
  }
  // Tag: "when the saints go marching in" once more, then a rolled C6/9 chord.
  for (const bar of [11, 12, 13]) {
    for (const [b, len, p] of SAINTS_MELODY[bar]) { add(beat + b, len, midi(p) + 12, 78, 0); add(beat + b, len, midi(p) + 24, 72, 0); }
    stride(beat, bar, 68);
    beat += 4;
  }
  ['C2', 'G2', 'E3', 'A3'].forEach((p, i) => add(beat + i * 0.06, 6, midi(p), 72, 1));
  ['D4', 'G4', 'C5', 'E5', 'A5'].forEach((p, i) => add(beat + 0.24 + i * 0.06, 6, midi(p), 70 + i * 2, 0));
  // Swung eighths: an offbeat eighth is played on the last third of the beat.
  for (const e of events) {
    const frac = e.beat - Math.floor(e.beat + 1e-9);
    if (Math.abs(frac - 0.5) < 1e-6) { e.beat += 1 / 6; e.length = Math.max(0.2, e.length - 1 / 6); }
    else if (Math.abs(frac) < 1e-6 && Math.abs(e.length - 0.5) < 1e-6) e.length = 2 / 3;
  }
  const last = beat;
  return {
    events,
    tempos: [{ beat: 0, bpm: 112 }],
    factor: (b) => (b < last - 12 ? 1 : b < last ? 1 - 0.32 * ((b - (last - 12)) / 12) : 0.6),
    timeSignatures: [{ beat: 0, numerator: 4, denominator: 4 }],
    keySignatures: [{ beat: 0, fifths: 0, minor: 0 }],
    pedal: { bassBelow: 50, catchAfter: 0.05 },
  };
}

// "Amazing Grace" to the hymn tune New Britain (Virginia Harmony, 1831) with
// E. O. Excell's harmony (public domain, typeset by the Mutopia Project).
// Three verses: the hymn as written, a flowing verse with left-hand arpeggios,
// and a full verse with octaves.
function grace(source) {
  const [upper, lower] = source.tracks.filter((t) => t.notes.length).map((t) => t.notes);
  const voices = (notes) => {
    const by = new Map();
    for (const n of notes) { if (!by.has(n.beat)) by.set(n.beat, []); by.get(n.beat).push(n); }
    return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([beat, ns]) => {
      ns.sort((a, b) => a.pitch - b.pitch);
      return { beat, high: ns.at(-1), low: ns[0] };
    });
  };
  const top = voices(upper), bottom = voices(lower), verse = 45, events = [];
  const add = (beat, length, pitch, velocity, hand) => events.push({ beat, length, pitch, velocity: Math.round(clamp(velocity, 24, 112)), hand });
  const metric = (beat) => { const inBar = (((beat - 1) % 3) + 3) % 3; return inBar < 1e-6 ? 5 : 0; };
  const lastBeat = Math.max(...upper.map((n) => n.beat + n.length));
  const tail = (n, base) => (n.beat + n.length >= lastBeat - 1e-6 ? n.length + 2 : n.length) + base * 0;
  // Verse 1: four-part hymn.
  for (const n of upper) add(n.beat, n.length * 0.98, n.pitch, (top.find((v) => v.beat === n.beat).high === n ? 58 : 46) + metric(n.beat), 0);
  for (const n of lower) add(n.beat, n.length * 0.98, n.pitch, (bottom.find((v) => v.beat === n.beat).low === n ? 50 : 42) + metric(n.beat), 1);
  // Verse 2: tune and alto an octave higher; left hand arpeggiates bass and tenor.
  let o = verse;
  for (const v of top) {
    add(o + v.beat, v.high.length * 0.98, v.high.pitch + 12, 66 + metric(v.beat), 0);
    if (v.low !== v.high) add(o + v.beat, v.low.length * 0.98, v.low.pitch + 12, 50 + metric(v.beat), 0);
  }
  const pedalBeats = [];
  for (const v of bottom) {
    const b = v.low.pitch, t = v.high.pitch, span = v.low.length;
    const pattern = [...new Set([b - 12 >= 31 ? b - 12 : b, b, b + 7 <= t - 2 ? b + 7 : null, t].filter((x) => x !== null))].sort((x, y) => x - y);
    const steps = Math.max(1, Math.round(span * 2)), order = pattern.concat(pattern.slice(1, -1).reverse());
    for (let i = 0; i < steps; i++) add(o + v.beat + i * 0.5, Math.max(0.45, span - i * 0.5), order[i % order.length], (i ? 44 : 56) + metric(v.beat + i * 0.5), 1);
    pedalBeats.push(o + v.beat);
  }
  // Verse 3: the tune in octaves with the alto inside, octave basses.
  o = verse * 2;
  for (const v of top) {
    const len = tail(v.high, 0) * 0.98;
    add(o + v.beat, len, v.high.pitch, 72 + metric(v.beat), 0);
    add(o + v.beat, len, v.high.pitch + 12, 78 + metric(v.beat), 0);
    if (v.low.pitch + 12 < v.high.pitch + 12 && v.low.pitch + 12 > v.high.pitch) add(o + v.beat, len, v.low.pitch + 12, 58, 0);
  }
  for (const v of bottom) {
    const len = tail(v.low, 0) * 0.98;
    add(o + v.beat, len, v.low.pitch - 12, 70 + metric(v.beat), 1);
    add(o + v.beat, len, v.low.pitch, 64 + metric(v.beat), 1);
    if (v.high.pitch - (v.low.pitch - 12) <= 14) add(o + v.beat, len, v.high.pitch, 52, 1);
    pedalBeats.push(o + v.beat);
  }
  for (const v of bottom) pedalBeats.push(v.beat);
  const end = verse * 2 + lastBeat;
  return {
    events,
    tempos: [{ beat: 0, bpm: 64 }],
    // A breath at the end of each verse and a broad final line.
    factor: (b) => {
      const inVerse = b % verse, verseEnd = inVerse > lastBeat - 3 ? 0.82 : 1;
      return b > end - 7 ? Math.min(verseEnd, 1 - 0.38 * clamp((b - (end - 7)) / 7, 0, 1)) : verseEnd;
    },
    timeSignatures: source.timeSignatures,
    keySignatures: source.keySignatures,
    pedal: { beats: [...new Set(pedalBeats)].sort((a, b) => a - b), catchAfter: 0.08 },
  };
}

module.exports = { saints, grace };

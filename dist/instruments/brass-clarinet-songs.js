'use strict';
/* Fingering charts & public-domain classical repertoire for:
 *  - Bb Concert Trumpet (3-valve piston system, E3–C6 written / D3–Bb5 sounding)
 *  - Bb Boehm Clarinet (chalumeau, throat, clarion with register key R, altissimo)
 */
window.BRASS_CLARINET_DATA = (() => {
  const NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  function midi(name) {
    const m = /^([A-G])([#b]?)(\d)$/.exec(name);
    return (Number(m[3]) + 1) * 12 + NOTE[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  }
  function seq(bpm, items, gate = 0.92) {
    const spb = 60 / bpm, notes = [];
    let beat = 0;
    for (const it of items) {
      const [n, dur, vel = 84] = it;
      if (n !== 'R') notes.push([+(beat * spb).toFixed(4), +(dur * spb * gate).toFixed(4), typeof n === 'number' ? n : midi(n), vel]);
      beat += dur;
    }
    return { notes, duration: +(beat * spb + 0.8).toFixed(3) };
  }

  // ---- Authentic Bb Trumpet 3-valve fingering (indexed by written pitch = concert + 2) ----
  const TV = {
    54: [1, 1, 1], 55: [1, 0, 1], 56: [0, 1, 1], 57: [1, 1, 0], 58: [1, 0, 0], 59: [0, 1, 0], 60: [0, 0, 0], // F#3..C4
    61: [1, 1, 1], 62: [1, 0, 1], 63: [0, 1, 1], 64: [1, 1, 0], 65: [1, 0, 0], 66: [0, 1, 0], 67: [0, 0, 0], // C#4..G4
    68: [0, 1, 1], 69: [1, 1, 0], 70: [1, 0, 0], 71: [0, 1, 0], 72: [0, 0, 0],                               // G#4..C5
    73: [1, 1, 0], 74: [1, 0, 0], 75: [0, 1, 0], 76: [0, 0, 0],                                              // C#5..E5
    77: [1, 0, 0], 78: [0, 1, 0], 79: [0, 0, 0], 80: [0, 1, 1], 81: [1, 1, 0], 82: [1, 0, 0], 83: [0, 1, 0], 84: [0, 0, 0], // F5..C6
  };
  function trumpetFingering(concertMidi) {
    let w = Math.round(concertMidi) + 2; // Bb transposition
    while (w < 54) w += 12;
    while (w > 84) w -= 12;
    const v = TV[w] || [0, 0, 0];
    return { v1: v[0], v2: v[1], v3: v[2] };
  }
  function trumpetLabel(concertMidi) {
    const f = trumpetFingering(concertMidi);
    const s = (f.v1 ? '1' : '') + (f.v2 ? '2' : '') + (f.v3 ? '3' : '');
    return s || '0';
  }

  // ---- Authentic Bb Boehm Clarinet fingering (indexed by written pitch = concert + 2) ----
  // reg: LH thumb register key (0|1), th: LH thumb tone hole (0|1), l1..l3, r1..r3, pk: pinky
  const cf = (reg, th, l1, l2, l3, r1, r2, r3, pk = 0) => ({ reg, th, l1, l2, l3, r1, r2, r3, pk });
  const CL = {
    // Chalumeau register (E3..F4)
    52: cf(0, 1, 1, 1, 1, 1, 1, 1, 1), // E3
    53: cf(0, 1, 1, 1, 1, 1, 1, 1, 1), // F3
    54: cf(0, 1, 1, 1, 1, 1, 1, 1, 1), // F#3
    55: cf(0, 1, 1, 1, 1, 1, 1, 1, 0), // G3
    56: cf(0, 1, 1, 1, 1, 1, 1, 1, 1), // G#3
    57: cf(0, 1, 1, 1, 1, 1, 1, 0, 0), // A3
    58: cf(0, 1, 1, 1, 1, 1, 0, 1, 0), // Bb3
    59: cf(0, 1, 1, 1, 1, 0, 1, 0, 0), // B3
    60: cf(0, 1, 1, 1, 1, 0, 0, 0, 0), // C4
    61: cf(0, 1, 1, 1, 1, 0, 0, 0, 1), // C#4
    62: cf(0, 1, 1, 1, 0, 0, 0, 0, 0), // D4
    63: cf(0, 1, 1, 1, 0, 1, 0, 0, 0), // Eb4
    64: cf(0, 1, 1, 0, 0, 0, 0, 0, 0), // E4
    65: cf(0, 1, 0, 0, 0, 0, 0, 0, 0), // F4
    // Throat tones (F#4..Bb4)
    66: cf(0, 0, 1, 0, 0, 0, 0, 0, 0), // F#4
    67: cf(0, 0, 0, 0, 0, 0, 0, 0, 0), // G4 (open)
    68: cf(0, 0, 1, 0, 0, 0, 0, 0, 0), // G#4 (side key)
    69: cf(0, 0, 1, 0, 0, 0, 0, 0, 0), // A4 (throat A)
    70: cf(1, 0, 1, 0, 0, 0, 0, 0, 0), // Bb4 (A + register)
    // Clarion register (B4..C6: +12th over chalumeau via register key!)
    71: cf(1, 1, 1, 1, 1, 1, 1, 1, 1), // B4
    72: cf(1, 1, 1, 1, 1, 1, 1, 1, 1), // C5
    73: cf(1, 1, 1, 1, 1, 1, 1, 1, 1), // C#5
    74: cf(1, 1, 1, 1, 1, 1, 1, 1, 0), // D5
    75: cf(1, 1, 1, 1, 1, 1, 1, 1, 1), // Eb5
    76: cf(1, 1, 1, 1, 1, 1, 1, 0, 0), // E5
    77: cf(1, 1, 1, 1, 1, 1, 0, 0, 0), // F5
    78: cf(1, 1, 1, 1, 1, 0, 1, 0, 0), // F#5
    79: cf(1, 1, 1, 1, 1, 0, 0, 0, 0), // G5
    80: cf(1, 1, 1, 1, 1, 0, 0, 0, 1), // G#5
    81: cf(1, 1, 1, 1, 0, 0, 0, 0, 0), // A5
    82: cf(1, 1, 1, 0, 1, 0, 0, 0, 0), // Bb5
    83: cf(1, 1, 1, 0, 0, 0, 0, 0, 0), // B5
    84: cf(1, 1, 0, 0, 0, 0, 0, 0, 0), // C6
    // Altissimo
    85: cf(1, 1, 0, 1, 1, 0, 0, 0, 0), // C#6
    86: cf(1, 1, 0, 1, 1, 1, 0, 0, 0), // D6
    87: cf(1, 1, 0, 1, 0, 1, 1, 0, 0), // Eb6
    88: cf(1, 1, 0, 1, 0, 0, 0, 0, 0), // E6
  };
  function clarinetFingering(concertMidi) {
    let w = Math.round(concertMidi) + 2;
    while (w < 52) w += 12;
    while (w > 88) w -= 12;
    return CL[w] || CL[67];
  }
  function clarinetLabel(concertMidi) {
    const f = clarinetFingering(concertMidi);
    const lh = (f.reg ? 'R' : '') + (f.th ? 'T' : '') + (f.l1 ? '1' : '') + (f.l2 ? '2' : '') + (f.l3 ? '3' : '');
    const rh = (f.r1 ? '1' : '') + (f.r2 ? '2' : '') + (f.r3 ? '3' : '') + (f.pk ? '+' : '');
    return (lh || '○') + '|' + (rh || '○');
  }

  const makeSong = (id, title, composer, opus, bpm, fifths, num, den, data) => ({
    id, title, composer, opus, bpm, duration: data.duration, notes: data.notes,
    signatures: [{ beat: 0, numerator: num, denominator: den }],
    keySignature: { fifths },
  });

  // ---- TRUMPET REPERTOIRE ----
  // 1. Jeremiah Clarke — Prince of Denmark's March (Trumpet Voluntary, D major)
  const voluntary = seq(108, [
    ['F#4', 1, 90], ['F#4', 0.5, 86], ['G4', 0.5, 88], ['A4', 1, 94], ['A4', 1, 92],
    ['B4', 0.5, 92], ['A4', 0.5, 88], ['G4', 0.5, 86], ['F#4', 0.5, 86], ['E4', 2, 90],
    ['F#4', 0.5, 88], ['G4', 0.5, 90], ['A4', 0.5, 92], ['B4', 0.5, 94], ['A4', 1, 92], ['F#4', 1, 90],
    ['E4', 1.5, 88], ['D4', 0.5, 86], ['D4', 2, 94],
    ['D5', 1, 98], ['D5', 0.5, 94], ['C#5', 0.5, 92], ['B4', 1, 94], ['B4', 1, 92],
    ['C#5', 0.5, 94], ['B4', 0.5, 90], ['A4', 0.5, 88], ['G4', 0.5, 88], ['F#4', 2, 92],
    ['B4', 0.5, 92], ['A4', 0.5, 90], ['G4', 0.5, 88], ['F#4', 0.5, 88], ['E4', 1, 90], ['A4', 1, 94],
    ['F#4', 1.5, 92], ['E4', 0.5, 88], ['D4', 2, 96],
  ]);
  // 2. Joseph Haydn — Trumpet Concerto in Eb (III. Finale theme)
  const haydn = seq(128, [
    ['Bb4', 0.5, 90], ['Eb5', 0.5, 94], ['Eb5', 0.5, 92], ['Eb5', 0.5, 94], ['Eb5', 1, 96], ['G5', 1, 98],
    ['F5', 0.5, 94], ['Eb5', 0.5, 92], ['D5', 0.5, 90], ['C5', 0.5, 88], ['Bb4', 1, 92], ['R', 1],
    ['Bb4', 0.5, 90], ['F5', 0.5, 94], ['F5', 0.5, 92], ['F5', 0.5, 94], ['F5', 1, 96], ['Ab5', 1, 98],
    ['G5', 0.5, 94], ['F5', 0.5, 92], ['Eb5', 0.5, 90], ['D5', 0.5, 88], ['Eb5', 1, 94], ['R', 1],
    ['G5', 0.5, 96], ['F5', 0.5, 94], ['Eb5', 0.5, 92], ['D5', 0.5, 90], ['C5', 0.5, 88], ['Bb4', 0.5, 88], ['Ab4', 0.5, 86], ['G4', 0.5, 86],
    ['Ab4', 0.5, 88], ['Bb4', 0.5, 90], ['C5', 0.5, 92], ['D5', 0.5, 94], ['Eb5', 2, 98],
  ]);

  // ---- CLARINET REPERTOIRE ----
  // 1. W. A. Mozart — Clarinet Concerto in A (K. 622, II. Adagio)
  const mozartCl = seq(58, [
    ['F#4', 1.5, 80], ['A4', 0.5, 82], ['D5', 1.0, 86],
    ['C#5', 0.5, 84], ['B4', 0.5, 82], ['A4', 1.0, 80], ['G4', 1.0, 78],
    ['F#4', 1.0, 78], ['E4', 0.5, 76], ['D4', 0.5, 76], ['E4', 1.0, 80],
    ['A4', 1.5, 84], ['G4', 0.5, 82], ['F#4', 1.0, 80],
    ['A4', 1.5, 84], ['D5', 0.5, 86], ['F#5', 1.0, 90],
    ['E5', 0.5, 88], ['D5', 0.5, 86], ['C#5', 0.5, 84], ['B4', 0.5, 82], ['A4', 1.0, 82],
    ['G4', 0.5, 80], ['F#4', 0.5, 78], ['E4', 0.5, 78], ['G4', 0.5, 80], ['F#4', 0.5, 80], ['E4', 0.5, 78],
    ['D4', 3.0, 86],
  ]);
  // 2. W. A. Mozart — Clarinet Quintet (K. 581, I. Allegro theme)
  const mozartQ = seq(108, [
    ['C5', 1, 84], ['E5', 1, 86], ['G5', 1.5, 90], ['F5', 0.5, 86],
    ['E5', 1, 86], ['D5', 1, 84], ['C5', 1, 82], ['R', 1],
    ['D5', 0.5, 84], ['E5', 0.5, 86], ['F5', 0.5, 88], ['G5', 0.5, 90], ['A5', 1, 92], ['F5', 1, 86],
    ['E5', 1, 86], ['D5', 1, 84], ['C5', 2, 86],
    ['G4', 0.5, 80], ['A4', 0.5, 82], ['B4', 0.5, 84], ['C5', 0.5, 86], ['D5', 0.5, 88], ['E5', 0.5, 90], ['F5', 0.5, 90], ['D5', 0.5, 86],
    ['E5', 0.5, 88], ['C5', 0.5, 84], ['G4', 0.5, 82], ['E5', 0.5, 88], ['D5', 1, 86], ['B4', 1, 84],
    ['C5', 2, 90],
  ]);

  return {
    trumpetFingering, trumpetLabel,
    clarinetFingering, clarinetLabel,
    trumpet: [
      makeSong('trumpet-voluntary', 'Prince of Denmark’s March', 'Jeremiah Clarke', 'Trumpet Voluntary in D', 108, 2, 4, 4, voluntary),
      makeSong('haydn-trumpet', 'Trumpet Concerto — Finale', 'Joseph Haydn', 'Hob. VIIe:1 in E♭', 128, -3, 2, 4, haydn),
    ],
    clarinet: [
      makeSong('mozart-clarinet-adagio', 'Clarinet Concerto — Adagio', 'Wolfgang Amadeus Mozart', 'K. 622', 58, 2, 3, 4, mozartCl),
      makeSong('mozart-clarinet-quintet', 'Clarinet Quintet — Allegro', 'Wolfgang Amadeus Mozart', 'K. 581', 108, 0, 4, 4, mozartQ),
    ],
  };
})();

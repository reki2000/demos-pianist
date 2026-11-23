'use strict';
/* Public-domain classical repertoire for:
 *  - Concert Grand Harp (47 strings)
 *  - Upright Double Bass (4 strings: E1, A1, D2, G2)
 *  - Concert Percussion (Rosewood Marimba & 4 Copper Timpani)
 */
window.HARP_BASS_PERC_SONGS = (() => {
  const NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  function midi(name) {
    const m = /^([A-G])([#b]?)(\d)$/.exec(name);
    return (Number(m[3]) + 1) * 12 + NOTE[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  }
  function seq(bpm, items, gate = 0.92) {
    const spb = 60 / bpm, notes = [];
    let beat = 0;
    for (const it of items) {
      const [n, dur, vel = 82] = it;
      if (n !== 'R') {
        const list = Array.isArray(n) ? n : [n];
        for (const p of list) notes.push([+(beat * spb).toFixed(4), +(dur * spb * gate).toFixed(4), typeof p === 'number' ? p : midi(p), vel]);
      }
      beat += dur;
    }
    return { notes, duration: +(beat * spb + 1.0).toFixed(3) };
  }
  const makeSong = (id, title, composer, opus, bpm, fifths, num, den, data, extra = {}) => ({
    id, title, composer, opus, bpm, duration: data.duration, notes: data.notes,
    signatures: [{ beat: 0, numerator: num, denominator: den }],
    keySignature: { fifths }, ...extra,
  });

  // ---- CONCERT HARP ----
  // 1. J. S. Bach — Prelude in C Major (BWV 846, flowing harp arpeggios)
  const arp = (b1, b2, n1, n2, n3) => [
    [b1, 0.25, 76], [b2, 0.25, 74], [n1, 0.25, 78], [n2, 0.25, 80], [n3, 0.25, 84], [n1, 0.25, 76], [n2, 0.25, 78], [n3, 0.25, 82],
    [b1, 0.25, 76], [b2, 0.25, 74], [n1, 0.25, 78], [n2, 0.25, 80], [n3, 0.25, 84], [n1, 0.25, 76], [n2, 0.25, 78], [n3, 0.25, 82],
  ];
  const harpBach = seq(88, [
    ...arp('C4', 'E4', 'G4', 'C5', 'E5'),
    ...arp('C4', 'D4', 'A4', 'D5', 'F5'),
    ...arp('B3', 'D4', 'G4', 'D5', 'F5'),
    ...arp('C4', 'E4', 'G4', 'C5', 'E5'),
    ...arp('C4', 'E4', 'A4', 'E5', 'A5'),
    ...arp('C4', 'D4', 'F#4', 'A4', 'D5'),
    ...arp('B3', 'D4', 'G4', 'D5', 'G5'),
    ...arp('B3', 'C4', 'E4', 'G4', 'C5'),
    ...arp('A3', 'C4', 'E4', 'G4', 'C5'),
    ...arp('D3', 'A3', 'D4', 'F#4', 'C5'),
    ...arp('G3', 'B3', 'D4', 'G4', 'B4'),
    [['C3', 'C4', 'E4', 'G4', 'C5', 'E5'], 4, 88],
  ]);
  // 2. Claude Debussy — Arabesque No. 1 (opening harp transcription)
  const harpDeb = seq(96, [
    ['C#4', 0.33, 74], ['E4', 0.33, 76], ['A4', 0.34, 80], ['E4', 0.33, 76], ['A4', 0.33, 80], ['C#5', 0.34, 84],
    ['A4', 0.33, 78], ['C#5', 0.33, 82], ['E5', 0.34, 86], ['C#5', 0.33, 82], ['E5', 0.33, 86], ['A5', 0.34, 90],
    ['G#5', 0.33, 86], ['E5', 0.33, 82], ['B4', 0.34, 78], ['E5', 0.33, 82], ['B4', 0.33, 78], ['G#4', 0.34, 76],
    ['F#4', 0.33, 76], ['A4', 0.33, 78], ['D5', 0.34, 82], ['A4', 0.33, 78], ['D5', 0.33, 82], ['F#5', 0.34, 86],
    ['E5', 0.33, 84], ['B4', 0.33, 80], ['G#4', 0.34, 78], ['B4', 0.33, 80], ['G#4', 0.33, 78], ['E4', 0.34, 76],
    [['E3', 'B3', 'E4', 'G#4', 'B4', 'E5'], 4, 88],
  ]);

  // ---- DOUBLE BASS ----
  // 1. Camille Saint-Saëns — The Elephant (Carnival of the Animals, Eb major, 3/8)
  const elephant = seq(124, [
    ['Eb2', 1.5, 92], ['G2', 0.5, 86], ['Bb2', 1.0, 90],
    ['Eb3', 1.0, 94], ['D3', 0.5, 88], ['C3', 0.5, 86], ['Bb2', 0.5, 86], ['Ab2', 0.5, 84],
    ['G2', 1.5, 90], ['Bb2', 0.5, 86], ['G2', 1.0, 88],
    ['F2', 1.5, 88], ['Ab2', 0.5, 84], ['F2', 1.0, 86],
    ['Eb2', 1.0, 90], ['G2', 0.5, 86], ['Bb2', 1.0, 90], ['Eb3', 0.5, 92],
    ['F3', 1.0, 96], ['Eb3', 0.5, 90], ['D3', 1.0, 90], ['C3', 0.5, 86],
    ['Bb2', 1.5, 92], ['F2', 1.5, 88], ['Eb2', 3.0, 96],
  ]);
  // 2. Ludwig van Beethoven — Symphony No. 9 (IV. Bass Recitative & Ode to Joy)
  const odeBass = seq(108, [
    ['F#2', 1, 88], ['F#2', 1, 88], ['G2', 1, 90], ['A2', 1, 92],
    ['A2', 1, 92], ['G2', 1, 90], ['F#2', 1, 88], ['E2', 1, 86],
    ['D2', 1, 88], ['D2', 1, 88], ['E2', 1, 88], ['F#2', 1, 90],
    ['F#2', 1.5, 92], ['E2', 0.5, 86], ['E2', 2, 90],
    ['F#2', 1, 88], ['F#2', 1, 88], ['G2', 1, 90], ['A2', 1, 92],
    ['A2', 1, 92], ['G2', 1, 90], ['F#2', 1, 88], ['E2', 1, 86],
    ['D2', 1, 88], ['D2', 1, 88], ['E2', 1, 88], ['F#2', 1, 90],
    ['E2', 1.5, 90], ['D2', 0.5, 86], ['D2', 2, 96],
  ]);

  // ---- CONCERT PERCUSSION (Marimba + Timpani) ----
  // 1. Marimba: J. S. Bach — Two-Part Invention No. 4 (D minor, sparkling rosewood mallets)
  const marimbaBach = seq(132, [
    ['D4', 0.25, 84], ['E4', 0.25, 82], ['F4', 0.25, 84], ['G4', 0.25, 86], ['A4', 0.25, 88], ['Bb4', 0.25, 90],
    ['C#4', 0.25, 84], ['Bb4', 0.25, 88], ['A4', 0.25, 86], ['G4', 0.25, 84], ['F4', 0.25, 84], ['E4', 0.25, 82],
    ['F4', 0.5, 86], ['A4', 0.5, 88], ['D5', 0.5, 92],
    ['G4', 0.5, 86], ['C#5', 0.5, 90], ['E5', 0.5, 94],
    ['D5', 0.25, 92], ['E5', 0.25, 90], ['F5', 0.25, 92], ['G5', 0.25, 94], ['A5', 0.25, 96], ['G5', 0.25, 92],
    ['F5', 0.25, 90], ['E5', 0.25, 88], ['D5', 0.25, 88], ['C#5', 0.25, 86], ['D5', 0.25, 88], ['A4', 0.25, 86],
    ['Bb4', 0.25, 88], ['G4', 0.25, 84], ['A4', 0.25, 86], ['F4', 0.25, 84], ['G4', 0.25, 84], ['E4', 0.25, 82],
    ['F4', 0.25, 84], ['D4', 0.25, 82], ['E4', 0.25, 82], ['C#4', 0.25, 82], ['D4', 1.5, 94],
  ], 0.85);
  // 2. Timpani: Beethoven Symphony No. 9 Scherzo & Concert Fanfare (4 drums: F2, A2, C3, F3)
  const timpaniFanfare = seq(126, [
    ['F3', 0.5, 100], ['R', 1.0], ['F2', 0.5, 98], ['R', 1.0],
    ['F3', 0.5, 96], ['C3', 0.5, 92], ['A2', 0.5, 90], ['F2', 1.5, 100],
    ['C3', 0.25, 88], ['C3', 0.25, 88], ['C3', 0.25, 90], ['C3', 0.25, 92], ['F3', 1.0, 100], ['R', 1.0],
    ['A2', 0.5, 90], ['C3', 0.5, 92], ['F3', 0.5, 96], ['C3', 0.5, 92], ['A2', 0.5, 90], ['F2', 0.5, 96],
    ['F2', 0.25, 86], ['F2', 0.25, 88], ['F2', 0.25, 90], ['F2', 0.25, 92], ['F2', 0.25, 94], ['F2', 0.25, 96], ['F2', 0.25, 98], ['F2', 0.25, 100],
    ['C3', 0.5, 96], ['A2', 0.5, 94], ['F2', 0.5, 98], ['C3', 0.5, 96], ['F3', 2.0, 104],
  ], 0.88);

  return {
    harp: [
      makeSong('harp-prelude', 'Prelude in C Major', 'Johann Sebastian Bach', 'BWV 846 — Harp Solo', 88, 0, 4, 4, harpBach),
      makeSong('harp-arabesque', 'Arabesque No. 1', 'Claude Debussy', 'L. 66 — Concert Harp', 96, 4, 4, 4, harpDeb),
    ],
    bass: [
      makeSong('bass-elephant', 'The Elephant', 'Camille Saint-Saëns', 'Carnival of the Animals', 124, -3, 3, 8, elephant),
      makeSong('bass-ode', 'Symphony No. 9 — Bass Theme', 'Ludwig van Beethoven', 'Op. 125 — Double Bass', 108, 2, 4, 4, odeBass),
    ],
    percussion: [
      makeSong('marimba-invention', 'Invention No. 4 (Marimba)', 'Johann Sebastian Bach', 'BWV 775 — Concert Marimba', 132, -1, 3, 8, marimbaBach, { percKind: 'marimba' }),
      makeSong('timpani-fanfare', 'Symphonic Timpani Fanfare', 'Ludwig van Beethoven', 'Op. 125 — 4 Copper Timpani', 126, -1, 3, 4, timpaniFanfare, { percKind: 'timpani' }),
    ],
  };
})();

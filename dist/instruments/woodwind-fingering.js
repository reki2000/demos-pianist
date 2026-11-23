'use strict';
/* Authentic Boehm Concert Flute (C4–C7) and Conservatoire Oboe (Bb3–G6)
 * fingering charts and compact score annotations.
 *
 * Flute keys:
 *   th: LH thumb (B/Bb key, 0|1)
 *   l1..l3: LH index/middle/ring (C/A/G keys, 0|1)
 *   l4: LH pinky (G# lever, 0|1)
 *   r1..r3: RH index/middle/ring (F/E/D keys, 0|1)
 *   r4: RH pinky ('' | 'eb' | 'c' | 'cs')
 *
 * Oboe keys:
 *   oct: 0 (none) | 1 (LH thumb 1st octave key) | 2 (LH side 2nd octave key)
 *   l1: 0 (open) | 0.5 (half-hole roll for D5/Eb5/C#5) | 1 (closed)
 *   l2..l3: LH middle/ring (0|1)
 *   l4: LH pinky ('' | 'ab' | 'eb' | 'b' | 'bb')
 *   r1..r3: RH index/middle/ring (0|1)
 *   r4: RH pinky ('' | 'eb' | 'c' | 'cs')
 */
window.WoodwindFingering = (() => {
  const f = (th, l1, l2, l3, l4, r1, r2, r3, r4 = '') => ({ th, l1, l2, l3, l4, r1, r2, r3, r4 });
  const FLUTE = {
    60: f(1, 1, 1, 1, 0, 1, 1, 1, 'c'),   // C4
    61: f(1, 1, 1, 1, 0, 1, 1, 1, 'cs'),  // C#4
    62: f(1, 1, 1, 1, 0, 1, 1, 1, ''),    // D4
    63: f(1, 1, 1, 1, 0, 1, 1, 1, 'eb'),  // Eb4
    64: f(1, 1, 1, 1, 0, 1, 1, 0, 'eb'),  // E4
    65: f(1, 1, 1, 1, 0, 1, 0, 0, 'eb'),  // F4
    66: f(1, 1, 1, 1, 0, 0, 0, 1, 'eb'),  // F#4
    67: f(1, 1, 1, 1, 0, 0, 0, 0, 'eb'),  // G4
    68: f(1, 1, 1, 1, 1, 0, 0, 0, 'eb'),  // G#4
    69: f(1, 1, 1, 0, 0, 0, 0, 0, 'eb'),  // A4
    70: f(1, 1, 0, 0, 0, 1, 0, 0, 'eb'),  // Bb4 (1-and-1)
    71: f(1, 1, 0, 0, 0, 0, 0, 0, 'eb'),  // B4
    72: f(0, 1, 0, 0, 0, 0, 0, 0, 'eb'),  // C5
    73: f(0, 0, 0, 0, 0, 0, 0, 0, 'eb'),  // C#5
    // 2nd octave (D5/Eb5 vent LH1)
    74: f(1, 0, 1, 1, 0, 1, 1, 1, ''),    // D5
    75: f(1, 0, 1, 1, 0, 1, 1, 1, 'eb'),  // Eb5
    76: f(1, 1, 1, 1, 0, 1, 1, 0, 'eb'),  // E5
    77: f(1, 1, 1, 1, 0, 1, 0, 0, 'eb'),  // F5
    78: f(1, 1, 1, 1, 0, 0, 0, 1, 'eb'),  // F#5
    79: f(1, 1, 1, 1, 0, 0, 0, 0, 'eb'),  // G5
    80: f(1, 1, 1, 1, 1, 0, 0, 0, 'eb'),  // G#5
    81: f(1, 1, 1, 0, 0, 0, 0, 0, 'eb'),  // A5
    82: f(1, 1, 0, 0, 0, 1, 0, 0, 'eb'),  // Bb5
    83: f(1, 1, 0, 0, 0, 0, 0, 0, 'eb'),  // B5
    84: f(0, 1, 0, 0, 0, 0, 0, 0, 'eb'),  // C6
    85: f(0, 0, 0, 0, 0, 0, 0, 0, 'eb'),  // C#6
    // 3rd octave (standard Boehm harmonic ventings)
    86: f(1, 0, 1, 1, 0, 0, 0, 0, 'eb'),  // D6
    87: f(1, 1, 1, 1, 1, 1, 1, 1, 'eb'),  // Eb6
    88: f(1, 1, 1, 0, 0, 1, 1, 0, 'eb'),  // E6
    89: f(1, 1, 0, 1, 0, 1, 0, 0, 'eb'),  // F6
    90: f(1, 1, 0, 1, 0, 0, 0, 1, 'eb'),  // F#6
    91: f(0, 1, 1, 1, 0, 0, 0, 0, 'eb'),  // G6
    92: f(0, 0, 1, 1, 1, 0, 0, 0, 'eb'),  // G#6
    93: f(1, 0, 1, 0, 0, 1, 0, 0, 'eb'),  // A6
    94: f(1, 0, 0, 0, 0, 1, 0, 0, ''),    // Bb6
    95: f(0, 1, 0, 1, 0, 0, 0, 1, ''),    // B6
    96: f(0, 1, 1, 1, 1, 1, 0, 0, ''),    // C7
  };

  const o = (oct, l1, l2, l3, l4, r1, r2, r3, r4 = '') => ({ oct, l1, l2, l3, l4, r1, r2, r3, r4 });
  const OBOE = {
    58: o(0, 1, 1, 1, 'bb', 1, 1, 1, 'c'),  // Bb3
    59: o(0, 1, 1, 1, 'b',  1, 1, 1, 'c'),  // B3
    60: o(0, 1, 1, 1, '',   1, 1, 1, 'c'),  // C4
    61: o(0, 1, 1, 1, '',   1, 1, 1, 'cs'), // C#4
    62: o(0, 1, 1, 1, '',   1, 1, 1, ''),   // D4
    63: o(0, 1, 1, 1, '',   1, 1, 1, 'eb'), // Eb4
    64: o(0, 1, 1, 1, '',   1, 1, 0, ''),   // E4
    65: o(0, 1, 1, 1, '',   1, 0, 1, ''),   // F4 (forked F)
    66: o(0, 1, 1, 1, '',   0, 1, 0, ''),   // F#4
    67: o(0, 1, 1, 1, '',   0, 0, 0, ''),   // G4
    68: o(0, 1, 1, 1, 'ab', 0, 0, 0, ''),   // G#4
    69: o(0, 1, 1, 0, '',   0, 0, 0, ''),   // A4
    70: o(0, 1, 1, 0, '',   1, 0, 0, ''),   // Bb4
    71: o(0, 1, 0, 0, '',   0, 0, 0, ''),   // B4
    72: o(0, 1, 0, 0, '',   1, 0, 0, ''),   // C5
    73: o(0, 0, 1, 0, '',   1, 0, 0, ''),   // C#5
    // Half-hole notes (LH1 rolled open to vent)
    74: o(0, 0.5, 1, 1, '', 1, 1, 1, ''),   // D5 (half-hole)
    75: o(0, 0.5, 1, 1, '', 1, 1, 1, 'eb'), // Eb5 (half-hole)
    // 1st octave key (LH thumb)
    76: o(1, 1, 1, 1, '',   1, 1, 0, ''),   // E5
    77: o(1, 1, 1, 1, '',   1, 0, 1, ''),   // F5
    78: o(1, 1, 1, 1, '',   0, 1, 0, ''),   // F#5
    79: o(1, 1, 1, 1, '',   0, 0, 0, ''),   // G5
    80: o(1, 1, 1, 1, 'ab', 0, 0, 0, ''),   // G#5
    // 2nd octave key (LH side)
    81: o(2, 1, 1, 0, '',   0, 0, 0, ''),   // A5
    82: o(2, 1, 1, 0, '',   1, 0, 0, ''),   // Bb5
    83: o(2, 1, 0, 0, '',   0, 0, 0, ''),   // B5
    84: o(2, 1, 0, 0, '',   1, 0, 0, ''),   // C6
    // Altissimo
    85: o(2, 0.5, 1, 1, '', 1, 1, 0, 'eb'), // C#6
    86: o(2, 0.5, 1, 1, '', 1, 0, 1, 'eb'), // D6
    87: o(1, 0.5, 1, 0, 'ab', 1, 1, 0, 'eb'), // Eb6
    88: o(1, 0.5, 1, 0, '', 1, 0, 1, ''),   // E6
    89: o(1, 0.5, 0, 1, '', 1, 1, 0, ''),   // F6
    90: o(1, 0.5, 0, 1, '', 0, 1, 0, ''),   // F#6
    91: o(1, 0.5, 0, 0, '', 1, 0, 0, ''),   // G6
  };

  function clampPitch(kind, pitch) {
    const lo = kind === 'flute' ? 60 : 58, hi = kind === 'flute' ? 96 : 91;
    let p = Math.round(pitch);
    while (p < lo) p += 12;
    while (p > hi) p -= 12;
    return p;
  }

  function lookup(kind, pitch) {
    const p = clampPitch(kind, pitch);
    return kind === 'flute' ? FLUTE[p] : OBOE[p];
  }

  function label(kind, pitch) {
    const g = lookup(kind, pitch);
    if (kind === 'flute') {
      const lh = (g.th ? 'T' : '') + (g.l1 ? '1' : '') + (g.l2 ? '2' : '') + (g.l3 ? '3' : '') + (g.l4 ? '+' : '');
      const rh = (g.r1 ? '1' : '') + (g.r2 ? '2' : '') + (g.r3 ? '3' : '') + (g.r4 ? g.r4 : '');
      return (lh || '○') + '|' + (rh || '○');
    }
    const oct = g.oct === 1 ? '¹' : g.oct === 2 ? '²' : '';
    const l1 = g.l1 === 0.5 ? '½' : g.l1 ? '1' : '';
    const lh = oct + l1 + (g.l2 ? '2' : '') + (g.l3 ? '3' : '') + (g.l4 ? '+' : '');
    const rh = (g.r1 ? '1' : '') + (g.r2 ? '2' : '') + (g.r3 ? '3' : '') + (g.r4 ? g.r4 : '');
    return (lh || '○') + '|' + (rh || '○');
  }

  return { FLUTE, OBOE, lookup, clampPitch, label };
})();

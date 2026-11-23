'use strict';
/* Multi-part public-domain chamber repertoire for:
 *  - String Quartet (4 players: Vn1, Vn2, Viola, Cello)
 *  - All-Star Decet (10 players: Fl, Ob, Gt, Pf, Vn1a, Vn1b, Vn2a, Vn2b, Vc1, Vc2)
 *
 * Each ensemble piece holds:
 *   parts: [{ id, role, kind, seat: { x, z, yaw, scale? }, pan, song }]
 *   notes: merged timeline [t, dur, pitch, vel, partIdx] for audio scheduling & live score
 *   scoreNotes: lead/melody notes [t, dur, pitch, vel] for clean single-staff Live Score
 */
window.ENSEMBLE_SONGS = (() => {
  const NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  function midi(name) {
    const m = /^([A-G])([#b]?)(\d)$/.exec(name);
    return (Number(m[3]) + 1) * 12 + NOTE[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  }
  function seq(bpm, items, gate = 0.92) {
    const spb = 60 / bpm, notes = [];
    let beat = 0;
    for (const it of items) {
      const [n, dur, vel = 80] = it;
      if (n !== 'R') {
        const list = Array.isArray(n) ? n : [n];
        for (const p of list) {
          notes.push([+(beat * spb).toFixed(4), +(dur * spb * gate).toFixed(4), typeof p === 'number' ? p : midi(p), vel]);
        }
      }
      beat += dur;
    }
    return { notes, duration: +(beat * spb + 0.8).toFixed(3) };
  }
  function shiftNotes(notes, delaySec, transpose = 0) {
    return notes.map(([t, d, p, v]) => [+(t + delaySec).toFixed(4), d, p + transpose, v]);
  }
  function makePartSong(id, bpm, fifths, num, den, notes, duration, extra = {}) {
    return {
      id, title: id, bpm, duration, notes,
      timeSignature: [num, den],
      keySignature: { fifths },
      signatures: [{ beat: 0, numerator: num, denominator: den }],
      tempos: [{ time: 0, beat: 0, bpm }],
      slurs: [], harmonics: [], maxPosition: 6,
      celloOptions: { secPerBeat: 60 / bpm },
      ...extra,
    };
  }
  function buildEnsemble(meta, partDefs) {
    const duration = Math.max(...partDefs.map(p => p.duration));
    const parts = partDefs.map(pd => {
      // Viola visual fingering transposes +7 semitones (exact 5th: C-G-D-A -> G-D-A-E)
      // while audio plays the true viola pitch!
      const visualNotes = pd.kind === 'viola' ? pd.notes.map(([t, d, p, v]) => [t, d, p + 7, v]) : pd.notes;
      return {
        id: pd.id, role: pd.role, kind: pd.kind, seat: pd.seat, pan: pd.pan,
        song: makePartSong(`${meta.id}-${pd.id}`, meta.bpm, meta.fifths, meta.num, meta.den, visualNotes, duration),
        audioNotes: pd.notes,
      };
    });
    // Merge all audio events sorted by time: [t, dur, pitch, vel, partIdx]
    const merged = [];
    parts.forEach((pt, idx) => {
      for (const n of pt.audioNotes) merged.push([n[0], n[1], n[2], n[3], idx]);
    });
    merged.sort((a, b) => a[0] - b[0] || a[4] - b[4]);
    const leadIdx = meta.leadPart || 0;
    return {
      id: meta.id, title: meta.title, composer: meta.composer, opus: meta.opus,
      bpm: meta.bpm, duration,
      signatures: [{ beat: 0, numerator: meta.num, denominator: meta.den }],
      keySignature: { fifths: meta.fifths },
      parts,
      notes: merged,
      scoreNotes: parts[leadIdx].audioNotes,
    };
  }

  // ---- Stage seat layouts (planning coords: +X = stage left, -X = stage right, -Z = audience) ----
  const QUARTET_SEATS = {
    vn1:   { x:  1.15, z: -0.35, yaw: -0.36, scale: 1.00, female: true,  gown: [.125, .040, .058] },
    vn2:   { x:  0.42, z:  0.22, yaw: -0.14, scale: 1.00, female: false },
    viola: { x: -0.46, z:  0.22, yaw:  0.16, scale: 1.04, female: true,  gown: [.048, .062, .112] },
    cello: { x: -1.18, z: -0.28, yaw:  0.38, scale: 1.00, female: false },
  };
  const DECET_SEATS = {
    vn1a:  { x:  1.88, z: -0.55, yaw: -0.40, scale: 1.00, female: true,  gown: [.125, .040, .058] },
    vn1b:  { x:  1.22, z:  0.05, yaw: -0.26, scale: 1.00, female: false },
    vn2a:  { x:  0.55, z:  0.48, yaw: -0.12, scale: 1.00, female: true,  gown: [.048, .068, .098] },
    vn2b:  { x: -0.20, z:  0.55, yaw:  0.04, scale: 1.00, female: false },
    vc1:   { x: -1.18, z: -0.18, yaw:  0.30, scale: 1.00, female: true,  gown: [.062, .045, .098] },
    vc2:   { x: -1.90, z: -0.52, yaw:  0.42, scale: 1.00, female: false },
    guitar:{ x: -0.32, z: -0.45, yaw:  0.14, scale: 1.00, female: false },
    flute: { x:  0.48, z:  1.32, yaw: -0.08, scale: 1.00, female: true,  gown: [.052, .058, .105] },
    oboe:  { x: -0.45, z:  1.32, yaw:  0.08, scale: 1.00, female: false },
    piano: { x:  2.05, z:  1.52, yaw: -0.55, scale: 1.00, female: true,  gown: [.115, .042, .055] },
  };

  // =========================================================================
  // 1. STRING QUARTET: Mozart — Eine kleine Nachtmusik (K. 525, I. Allegro)
  // =========================================================================
  const eknBpm = 134;
  const eknVn1 = seq(eknBpm, [
    // Opening rocket motif (mm. 1–4)
    ['G4', 0.75, 96], ['R', 0.25], ['D4', 0.5, 86], ['G4', 0.75, 96], ['R', 0.25], ['D4', 0.5, 86],
    ['G4', 0.5, 92], ['D4', 0.5, 88], ['G4', 0.5, 92], ['B4', 0.5, 96], ['D5', 1.5, 100], ['R', 0.5],
    ['C5', 0.75, 94], ['R', 0.25], ['A4', 0.5, 86], ['C5', 0.75, 94], ['R', 0.25], ['A4', 0.5, 86],
    ['C5', 0.5, 90], ['A4', 0.5, 86], ['F#4', 0.5, 88], ['A4', 0.5, 92], ['D4', 1.5, 96], ['R', 0.5],
    // Driving theme (mm. 5–10)
    ['G4', 1.0, 92], ['G4', 0.75, 90], ['B4', 0.25, 88], ['A4', 0.5, 88], ['G4', 0.5, 86], ['G4', 0.5, 84], ['F#4', 0.5, 86],
    ['F#4', 0.5, 86], ['A4', 0.5, 90], ['C5', 0.5, 92], ['F#4', 0.5, 86], ['A4', 0.5, 88], ['G4', 0.5, 86], ['G4', 0.5, 84], ['B4', 0.5, 88],
    ['D5', 0.5, 94], ['B4', 0.5, 90], ['G4', 0.5, 88], ['B4', 0.5, 90], ['A4', 0.5, 88], ['F#4', 0.5, 84], ['D4', 0.5, 82], ['F#4', 0.5, 86],
    ['G4', 0.5, 90], ['B4', 0.5, 92], ['D5', 0.5, 96], ['G5', 1.0, 100], ['F#5', 0.5, 94], ['E5', 0.5, 92], ['D5', 0.5, 90],
    // Lyrical second idea (mm. 11–14)
    ['D5', 1.0, 84], ['C5', 0.5, 82], ['B4', 0.5, 80], ['B4', 1.0, 82], ['A4', 0.5, 78], ['G4', 0.5, 76],
    ['A4', 0.5, 80], ['B4', 0.5, 82], ['C5', 0.5, 84], ['A4', 0.5, 82], ['B4', 1.0, 86], ['G4', 1.0, 84],
    // Closing cadence (mm. 15–18)
    ['G5', 0.5, 96], ['F#5', 0.5, 94], ['E5', 0.5, 92], ['D5', 0.5, 90], ['C5', 0.5, 88], ['B4', 0.5, 86], ['A4', 0.5, 86], ['G4', 0.5, 84],
    ['F#4', 0.5, 86], ['G4', 0.5, 88], ['A4', 0.5, 90], ['B4', 0.5, 92], ['C5', 0.5, 94], ['A4', 0.5, 90], ['B4', 0.5, 92], ['G4', 0.5, 90],
    ['A4', 0.5, 92], ['F#4', 0.5, 90], ['D4', 0.5, 88], ['F#4', 0.5, 90], ['G4', 2.0, 98],
  ]);
  const eknVn2 = seq(eknBpm, [
    ['G4', 0.75, 86], ['R', 0.25], ['D4', 0.5, 78], ['G4', 0.75, 86], ['R', 0.25], ['D4', 0.5, 78],
    ['G4', 0.5, 84], ['D4', 0.5, 80], ['G4', 0.5, 84], ['B4', 0.5, 86], ['B4', 1.5, 88], ['R', 0.5],
    ['A4', 0.75, 84], ['R', 0.25], ['F#4', 0.5, 78], ['A4', 0.75, 84], ['R', 0.25], ['F#4', 0.5, 78],
    ['A4', 0.5, 82], ['F#4', 0.5, 78], ['D4', 0.5, 80], ['F#4', 0.5, 82], ['D4', 1.5, 86], ['R', 0.5],
    ['B3', 0.5, 76], ['D4', 0.5, 76], ['B3', 0.5, 76], ['D4', 0.5, 76], ['C4', 0.5, 76], ['E4', 0.5, 76], ['D4', 0.5, 76], ['C4', 0.5, 76],
    ['D4', 0.5, 76], ['F#4', 0.5, 78], ['D4', 0.5, 76], ['F#4', 0.5, 78], ['D4', 0.5, 76], ['B3', 0.5, 76], ['D4', 0.5, 78], ['G4', 0.5, 80],
    ['B4', 0.5, 82], ['G4', 0.5, 80], ['D4', 0.5, 78], ['G4', 0.5, 80], ['F#4', 0.5, 78], ['D4', 0.5, 76], ['A3', 0.5, 74], ['D4', 0.5, 76],
    ['B3', 0.5, 78], ['G4', 0.5, 80], ['B4', 0.5, 84], ['B4', 1.0, 86], ['A4', 0.5, 82], ['G4', 0.5, 80], ['F#4', 0.5, 78],
    ['G4', 1.0, 76], ['A4', 0.5, 76], ['G4', 0.5, 74], ['G4', 1.0, 74], ['F#4', 0.5, 72], ['E4', 0.5, 72],
    ['F#4', 0.5, 74], ['G4', 0.5, 76], ['A4', 0.5, 78], ['F#4', 0.5, 76], ['G4', 1.0, 78], ['D4', 1.0, 76],
    ['B4', 0.5, 82], ['A4', 0.5, 80], ['G4', 0.5, 78], ['F#4', 0.5, 78], ['E4', 0.5, 76], ['G4', 0.5, 76], ['F#4', 0.5, 76], ['E4', 0.5, 74],
    ['D4', 0.5, 76], ['E4', 0.5, 78], ['F#4', 0.5, 80], ['G4', 0.5, 82], ['A4', 0.5, 84], ['F#4', 0.5, 80], ['G4', 0.5, 82], ['D4', 0.5, 80],
    ['F#4', 0.5, 82], ['D4', 0.5, 80], ['C4', 0.5, 78], ['D4', 0.5, 80], ['B3', 2.0, 88],
  ]);
  const eknVa = seq(eknBpm, [
    ['G3', 0.75, 84], ['R', 0.25], ['D3', 0.5, 78], ['G3', 0.75, 84], ['R', 0.25], ['D3', 0.5, 78],
    ['G3', 0.5, 82], ['D3', 0.5, 78], ['G3', 0.5, 82], ['B3', 0.5, 84], ['G3', 1.5, 86], ['R', 0.5],
    ['F#3', 0.75, 82], ['R', 0.25], ['D3', 0.5, 76], ['F#3', 0.75, 82], ['R', 0.25], ['D3', 0.5, 76],
    ['F#3', 0.5, 80], ['D3', 0.5, 76], ['D3', 0.5, 78], ['F#3', 0.5, 80], ['A3', 1.5, 84], ['R', 0.5],
    ['G3', 0.5, 74], ['G3', 0.5, 74], ['G3', 0.5, 74], ['G3', 0.5, 74], ['G3', 0.5, 74], ['G3', 0.5, 74], ['A3', 0.5, 74], ['A3', 0.5, 74],
    ['A3', 0.5, 74], ['A3', 0.5, 74], ['A3', 0.5, 74], ['A3', 0.5, 74], ['B3', 0.5, 76], ['B3', 0.5, 76], ['B3', 0.5, 76], ['B3', 0.5, 76],
    ['G3', 0.5, 76], ['B3', 0.5, 76], ['D4', 0.5, 78], ['B3', 0.5, 76], ['A3', 0.5, 76], ['A3', 0.5, 76], ['F#3', 0.5, 74], ['A3', 0.5, 76],
    ['G3', 0.5, 78], ['B3', 0.5, 78], ['D4', 0.5, 80], ['D4', 1.0, 82], ['D4', 0.5, 78], ['C4', 0.5, 76], ['A3', 0.5, 76],
    ['B3', 1.0, 74], ['E3', 1.0, 74], ['D3', 1.0, 74], ['C4', 1.0, 74],
    ['D4', 1.0, 76], ['D3', 1.0, 74], ['G3', 1.0, 76], ['B3', 1.0, 76],
    ['D4', 0.5, 78], ['D4', 0.5, 78], ['C4', 0.5, 76], ['B3', 0.5, 76], ['A3', 0.5, 76], ['G3', 0.5, 74], ['C4', 0.5, 76], ['B3', 0.5, 74],
    ['A3', 0.5, 76], ['B3', 0.5, 78], ['C4', 0.5, 80], ['D4', 0.5, 82], ['E4', 0.5, 82], ['C4', 0.5, 78], ['D4', 0.5, 80], ['B3', 0.5, 78],
    ['C4', 0.5, 80], ['A3', 0.5, 78], ['F#3', 0.5, 76], ['A3', 0.5, 78], ['G3', 2.0, 86],
  ]);
  const eknVc = seq(eknBpm, [
    ['G2', 0.75, 92], ['R', 0.25], ['D2', 0.5, 84], ['G2', 0.75, 92], ['R', 0.25], ['D2', 0.5, 84],
    ['G2', 0.5, 88], ['D2', 0.5, 84], ['G2', 0.5, 88], ['B2', 0.5, 90], ['G2', 1.5, 92], ['R', 0.5],
    ['D2', 0.75, 88], ['R', 0.25], ['D2', 0.5, 82], ['D2', 0.75, 88], ['R', 0.25], ['D2', 0.5, 82],
    ['D2', 0.5, 86], ['F#2', 0.5, 84], ['A2', 0.5, 86], ['C3', 0.5, 88], ['D3', 1.5, 90], ['R', 0.5],
    ['G2', 1.0, 84], ['B2', 1.0, 82], ['C3', 1.0, 84], ['D3', 1.0, 84],
    ['D2', 1.0, 84], ['F#2', 1.0, 82], ['G2', 1.0, 84], ['B2', 1.0, 84],
    ['G2', 1.0, 86], ['B2', 1.0, 84], ['D3', 1.0, 86], ['D2', 1.0, 84],
    ['G2', 1.0, 86], ['B2', 1.0, 86], ['G2', 1.0, 88], ['D2', 1.0, 84],
    ['G2', 1.0, 80], ['C3', 1.0, 80], ['B2', 1.0, 78], ['E2', 1.0, 78],
    ['D2', 1.0, 80], ['F#2', 1.0, 80], ['G2', 1.0, 82], ['G2', 1.0, 80],
    ['G2', 1.0, 84], ['B2', 1.0, 84], ['C3', 1.0, 86], ['C#3', 1.0, 86],
    ['D3', 1.0, 86], ['B2', 1.0, 84], ['C3', 1.0, 86], ['G2', 1.0, 84],
    ['D2', 1.0, 86], ['D2', 1.0, 88], ['G2', 2.0, 96],
  ]);
  const quartetMozart = buildEnsemble(
    { id: 'eine-kleine', title: 'Eine kleine Nachtmusik', composer: 'Wolfgang Amadeus Mozart', opus: 'K. 525 — String Quartet', bpm: eknBpm, fifths: 2 - 1, num: 4, den: 4, leadPart: 0 },
    [
      { id: 'vn1', role: 'Violin I', kind: 'violin', seat: QUARTET_SEATS.vn1, pan: -0.55, notes: eknVn1.notes, duration: eknVn1.duration },
      { id: 'vn2', role: 'Violin II', kind: 'violin', seat: QUARTET_SEATS.vn2, pan: -0.18, notes: eknVn2.notes, duration: eknVn2.duration },
      { id: 'viola', role: 'Viola', kind: 'viola', seat: QUARTET_SEATS.viola, pan: 0.22, notes: eknVa.notes, duration: eknVa.duration },
      { id: 'cello', role: 'Cello', kind: 'cello', seat: QUARTET_SEATS.cello, pan: 0.58, notes: eknVc.notes, duration: eknVc.duration },
    ]
  );

  // =========================================================================
  // 2. PACHELBEL CANON (shared melodic canon phrases for Quartet & 10-player Decet)
  // =========================================================================
  function buildCanon(bpm) {
    const spb = 60 / bpm;
    // 8-beat ground bass cycle (D A Bm F#m G D G A), repeated 5 times
    const bassCycle = [
      ['D3', 2, 84], ['A2', 2, 82], ['B2', 2, 82], ['F#2', 2, 80],
      ['G2', 2, 84], ['D2', 2, 82], ['G2', 2, 84], ['A2', 2, 86],
    ];
    const bassItems = [...bassCycle, ...bassCycle, ...bassCycle, ...bassCycle, ...bassCycle, ['D2', 4, 92]];
    const canonMelItems = [
      // Phrase 1: cantabile half notes (16 beats = 4 bars)
      ['F#5', 2, 80], ['E5', 2, 78], ['D5', 2, 78], ['C#5', 2, 76],
      ['B4', 2, 78], ['A4', 2, 76], ['B4', 2, 78], ['C#5', 2, 80],
      // Phrase 2: flowing quarters (16 beats)
      ['D5', 1, 82], ['F#5', 1, 84], ['A5', 1, 86], ['G5', 1, 84],
      ['F#5', 1, 82], ['D5', 1, 80], ['F#5', 1, 82], ['E5', 1, 80],
      ['D5', 1, 80], ['B4', 1, 78], ['D5', 1, 80], ['A5', 1, 84],
      ['G5', 1, 84], ['B5', 1, 88], ['A5', 1, 86], ['G5', 1, 84],
      // Phrase 3: sparkling eighths (16 beats)
      ['F#5', 0.5, 84], ['D5', 0.5, 82], ['E5', 0.5, 84], ['F#5', 0.5, 86],
      ['E5', 0.5, 82], ['C#5', 0.5, 80], ['D5', 0.5, 82], ['E5', 0.5, 84],
      ['D5', 0.5, 82], ['B4', 0.5, 80], ['C#5', 0.5, 82], ['D5', 0.5, 84],
      ['C#5', 0.5, 80], ['A4', 0.5, 78], ['B4', 0.5, 80], ['C#5', 0.5, 82],
      ['B4', 0.5, 82], ['G4', 0.5, 80], ['A4', 0.5, 82], ['B4', 0.5, 84],
      ['A4', 0.5, 80], ['F#4', 0.5, 78], ['G4', 0.5, 80], ['A4', 0.5, 82],
      ['B4', 0.5, 82], ['G4', 0.5, 80], ['B4', 0.5, 84], ['D5', 0.5, 86],
      ['C#5', 0.5, 84], ['A4', 0.5, 82], ['E5', 0.5, 86], ['C#5', 0.5, 84],
      // Final resolution
      ['D5', 4, 92],
    ];
    const bass = seq(bpm, bassItems);
    const mel1 = seq(bpm, canonMelItems);
    // Voice 2 enters 8 beats (2 bars) later, Voice 3 enters 16 beats (4 bars) later
    const trim = (ns, maxT) => ns.filter(n => n[0] < maxT - 0.1);
    const endT = bass.duration - 0.8;
    const v1 = trim(shiftNotes(mel1.notes, 0), endT);
    const v2 = trim(shiftNotes(mel1.notes, 8 * spb), endT);
    const v3 = trim(shiftNotes(mel1.notes, 16 * spb, -12), endT);
    // Add final tonic chord for v1/v2/v3
    const finT = +(80 * spb).toFixed(4), finD = +(3.8 * spb).toFixed(4);
    v1.push([finT, finD, midi('F#5'), 92]);
    v2.push([finT, finD, midi('D5'), 88]);
    v3.push([finT, finD, midi('A4'), 86]);
    return { bass, v1, v2, v3, spb, duration: bass.duration, finT, finD };
  }

  const qCan = buildCanon(76);
  const quartetCanon = buildEnsemble(
    { id: 'pachelbel-quartet', title: 'Canon in D', composer: 'Johann Pachelbel', opus: 'String Quartet Arrangement', bpm: 76, fifths: 2, num: 4, den: 4, leadPart: 0 },
    [
      { id: 'vn1', role: 'Violin I', kind: 'violin', seat: QUARTET_SEATS.vn1, pan: -0.55, notes: qCan.v1, duration: qCan.duration },
      { id: 'vn2', role: 'Violin II', kind: 'violin', seat: QUARTET_SEATS.vn2, pan: -0.18, notes: qCan.v2, duration: qCan.duration },
      { id: 'viola', role: 'Viola', kind: 'viola', seat: QUARTET_SEATS.viola, pan: 0.22, notes: qCan.v3, duration: qCan.duration },
      { id: 'cello', role: 'Cello', kind: 'cello', seat: QUARTET_SEATS.cello, pan: 0.58, notes: qCan.bass.notes, duration: qCan.duration },
    ]
  );

  // =========================================================================
  // 3. ALL-STAR DECET (10 PLAYERS): Pachelbel Canon — Grand Decet
  //    Fl ×1, Ob ×1, Gt ×1, Pf ×1, Vn ×4, Vc ×2
  // =========================================================================
  const dCan = buildCanon(82);
  // Classical guitar arpeggio continuo (Baroque broken chords over the 8-chord progression)
  const gtCycle = [
    ['D3', 0.5, 76], ['A3', 0.5, 72], ['D4', 0.5, 74], ['F#4', 0.5, 76],
    ['A2', 0.5, 76], ['E3', 0.5, 72], ['A3', 0.5, 74], ['C#4', 0.5, 76],
    ['B2', 0.5, 76], ['F#3', 0.5, 72], ['B3', 0.5, 74], ['D4', 0.5, 76],
    ['F#2', 0.5, 76], ['C#3', 0.5, 72], ['F#3', 0.5, 74], ['A3', 0.5, 76],
    ['G2', 0.5, 76], ['D3', 0.5, 72], ['G3', 0.5, 74], ['B3', 0.5, 76],
    ['D3', 0.5, 76], ['A3', 0.5, 72], ['D4', 0.5, 74], ['F#4', 0.5, 76],
    ['G2', 0.5, 76], ['D3', 0.5, 72], ['G3', 0.5, 74], ['B3', 0.5, 76],
    ['A2', 0.5, 76], ['E3', 0.5, 72], ['A3', 0.5, 74], ['C#4', 0.5, 76],
  ];
  const gtCanon = seq(82, [...gtCycle, ...gtCycle, ...gtCycle, ...gtCycle, ...gtCycle, ['D3', 4, 84]]);
  // Piano continuo chords (LH bass + RH chordal pulse)
  const pfCycle = [
    [['D3', 'F#4', 'A4'], 2, 74], [['A2', 'E4', 'A4'], 2, 72],
    [['B2', 'D4', 'F#4'], 2, 72], [['F#2', 'C#4', 'F#4'], 2, 70],
    [['G2', 'B3', 'D4'], 2, 74], [['D2', 'A3', 'D4'], 2, 72],
    [['G2', 'B3', 'G4'], 2, 74], [['A2', 'C#4', 'E4'], 2, 76],
  ];
  const pfCanon = seq(82, [...pfCycle, ...pfCycle, ...pfCycle, ...pfCycle, ...pfCycle, [['D2', 'D4', 'F#4', 'A4'], 4, 84]]);
  // Concert Flute soaring obbligato (enters bar 3)
  const flCanon = seq(82, [
    ['R', 8],
    ['A5', 2, 82], ['G5', 2, 80], ['F#5', 2, 80], ['E5', 2, 78],
    ['D5', 2, 80], ['D5', 2, 78], ['D5', 2, 80], ['E5', 2, 82],
    ['F#5', 1, 84], ['A5', 1, 86], ['C#6', 1, 88], ['A5', 1, 84],
    ['B5', 1, 86], ['F#5', 1, 82], ['A5', 1, 84], ['F#5', 1, 82],
    ['G5', 1, 84], ['D5', 1, 80], ['F#5', 1, 84], ['A5', 1, 86],
    ['B5', 1, 88], ['G5', 1, 84], ['A5', 2, 86],
    ['D6', 0.5, 90], ['C#6', 0.5, 88], ['B5', 0.5, 86], ['A5', 0.5, 84],
    ['A5', 0.5, 86], ['G5', 0.5, 84], ['F#5', 0.5, 82], ['E5', 0.5, 80],
    ['F#5', 0.5, 84], ['G5', 0.5, 86], ['A5', 0.5, 88], ['B5', 0.5, 88],
    ['A5', 0.5, 86], ['F#5', 0.5, 84], ['G5', 0.5, 84], ['A5', 0.5, 86],
    ['B5', 0.5, 88], ['A5', 0.5, 86], ['G5', 0.5, 84], ['F#5', 0.5, 82],
    ['F#5', 0.5, 84], ['E5', 0.5, 82], ['D5', 0.5, 82], ['F#5', 0.5, 84],
    ['G5', 0.5, 86], ['A5', 0.5, 88], ['B5', 0.5, 90], ['G5', 0.5, 86],
    ['A5', 1, 88], ['E5', 1, 86],
    ['F#5', 4, 92],
  ]);
  // Oboe expressive counter-melody (enters bar 5)
  const obCanon = seq(82, [
    ['R', 16],
    ['D5', 2, 82], ['C#5', 2, 80], ['B4', 2, 80], ['A4', 2, 78],
    ['G4', 2, 80], ['F#4', 2, 78], ['G4', 2, 80], ['A4', 2, 82],
    ['D5', 2, 84], ['E5', 2, 84], ['F#5', 2, 86], ['C#5', 2, 82],
    ['B4', 2, 84], ['A4', 2, 82], ['B4', 2, 84], ['C#5', 2, 86],
    ['D5', 1, 86], ['F#5', 1, 88], ['E5', 1, 86], ['C#5', 1, 84],
    ['D5', 1, 86], ['B4', 1, 82], ['C#5', 1, 84], ['A4', 1, 82],
    ['B4', 1, 84], ['D5', 1, 86], ['F#5', 1, 88], ['D5', 1, 84],
    ['G5', 1, 88], ['E5', 1, 86], ['C#5', 2, 86],
    ['D5', 4, 90],
  ]);

  const decetCanon = buildEnsemble(
    { id: 'decet-canon', title: 'Canon in D — Grand Decet', composer: 'Johann Pachelbel', opus: '10-Player All-Star Ensemble', bpm: 82, fifths: 2, num: 4, den: 4, leadPart: 0 },
    [
      { id: 'vn1a',   role: 'Violin Ia',  kind: 'violin', seat: DECET_SEATS.vn1a,   pan: -0.72, notes: dCan.v1, duration: dCan.duration },
      { id: 'vn1b',   role: 'Violin Ib',  kind: 'violin', seat: DECET_SEATS.vn1b,   pan: -0.48, notes: dCan.v1, duration: dCan.duration },
      { id: 'vn2a',   role: 'Violin IIa', kind: 'violin', seat: DECET_SEATS.vn2a,   pan: -0.22, notes: dCan.v2, duration: dCan.duration },
      { id: 'vn2b',   role: 'Violin IIb', kind: 'violin', seat: DECET_SEATS.vn2b,   pan:  0.08, notes: dCan.v2, duration: dCan.duration },
      { id: 'vc1',    role: 'Cello I',    kind: 'cello',  seat: DECET_SEATS.vc1,    pan:  0.46, notes: dCan.bass.notes, duration: dCan.duration },
      { id: 'vc2',    role: 'Cello II',   kind: 'cello',  seat: DECET_SEATS.vc2,    pan:  0.72, notes: dCan.bass.notes, duration: dCan.duration },
      { id: 'guitar', role: 'Guitar',     kind: 'guitar', seat: DECET_SEATS.guitar, pan:  0.22, notes: gtCanon.notes, duration: dCan.duration },
      { id: 'flute',  role: 'Flute',      kind: 'flute',  seat: DECET_SEATS.flute,  pan: -0.18, notes: flCanon.notes, duration: dCan.duration },
      { id: 'oboe',   role: 'Oboe',       kind: 'oboe',   seat: DECET_SEATS.oboe,   pan:  0.18, notes: obCanon.notes, duration: dCan.duration },
      { id: 'piano',  role: 'Piano',      kind: 'piano',  seat: DECET_SEATS.piano,  pan: -0.62, notes: pfCanon.notes, duration: dCan.duration },
    ]
  );

  // =========================================================================
  // 4. ALL-STAR DECET (10 PLAYERS): Bach — Brandenburg Concertino in G
  // =========================================================================
  const brBpm = 114;
  const brFl = seq(brBpm, [
    ['G5', 0.5, 88], ['B5', 0.5, 88], ['D6', 0.5, 92], ['B5', 0.5, 86], ['G5', 0.5, 84], ['A5', 0.5, 86], ['B5', 0.5, 88], ['G5', 0.5, 86],
    ['A5', 0.5, 86], ['C6', 0.5, 90], ['B5', 0.5, 88], ['A5', 0.5, 84], ['G5', 0.5, 84], ['F#5', 0.5, 82], ['E5', 0.5, 82], ['D5', 0.5, 80],
    ['G5', 0.5, 86], ['A5', 0.5, 88], ['B5', 0.5, 90], ['C6', 0.5, 92], ['D6', 1.0, 94], ['B5', 1.0, 88],
    ['C6', 0.5, 90], ['A5', 0.5, 86], ['F#5', 0.5, 84], ['A5', 0.5, 86], ['G5', 2.0, 92],
    // Concertino echo
    ['B5', 1.0, 86], ['A5', 0.5, 84], ['G5', 0.5, 82], ['F#5', 1.0, 84], ['G5', 0.5, 84], ['A5', 0.5, 86],
    ['B5', 0.5, 88], ['C6', 0.5, 90], ['D6', 0.5, 92], ['B5', 0.5, 88], ['A5', 2.0, 88],
    ['D6', 0.5, 92], ['C6', 0.5, 90], ['B5', 0.5, 88], ['A5', 0.5, 86], ['G5', 0.5, 86], ['A5', 0.5, 88], ['B5', 0.5, 90], ['G5', 0.5, 86],
    ['A5', 0.5, 88], ['F#5', 0.5, 86], ['D5', 0.5, 84], ['F#5', 0.5, 86], ['G5', 2.0, 96],
  ]);
  const brOb = seq(brBpm, [
    ['D5', 0.5, 84], ['G5', 0.5, 86], ['B5', 0.5, 88], ['G5', 0.5, 84], ['D5', 0.5, 82], ['F#5', 0.5, 84], ['G5', 0.5, 86], ['D5', 0.5, 82],
    ['F#5', 0.5, 84], ['A5', 0.5, 86], ['G5', 0.5, 84], ['F#5', 0.5, 82], ['E5', 0.5, 82], ['D5', 0.5, 80], ['C5', 0.5, 80], ['A4', 0.5, 78],
    ['B4', 0.5, 82], ['D5', 0.5, 84], ['G5', 0.5, 86], ['A5', 0.5, 88], ['B5', 1.0, 90], ['G5', 1.0, 84],
    ['A5', 0.5, 86], ['F#5', 0.5, 82], ['D5', 0.5, 80], ['F#5', 0.5, 84], ['D5', 2.0, 88],
    ['G5', 1.0, 84], ['F#5', 0.5, 82], ['E5', 0.5, 80], ['D5', 1.0, 82], ['E5', 0.5, 82], ['F#5', 0.5, 84],
    ['G5', 0.5, 86], ['A5', 0.5, 88], ['B5', 0.5, 90], ['G5', 0.5, 86], ['F#5', 2.0, 86],
    ['B5', 0.5, 88], ['A5', 0.5, 86], ['G5', 0.5, 84], ['F#5', 0.5, 82], ['E5', 0.5, 82], ['F#5', 0.5, 84], ['G5', 0.5, 86], ['E5', 0.5, 84],
    ['F#5', 0.5, 84], ['D5', 0.5, 82], ['A4', 0.5, 80], ['D5', 0.5, 82], ['B4', 2.0, 92],
  ]);
  const brVn1 = seq(brBpm, [
    ['G4', 0.5, 86], ['B4', 0.5, 86], ['D5', 0.5, 88], ['B4', 0.5, 84], ['G4', 0.5, 84], ['A4', 0.5, 84], ['B4', 0.5, 86], ['G4', 0.5, 84],
    ['A4', 0.5, 84], ['C5', 0.5, 86], ['B4', 0.5, 84], ['A4', 0.5, 82], ['G4', 0.5, 82], ['F#4', 0.5, 80], ['E4', 0.5, 80], ['D4', 0.5, 78],
    ['G4', 0.5, 84], ['A4', 0.5, 86], ['B4', 0.5, 88], ['C5', 0.5, 88], ['D5', 1.0, 90], ['B4', 1.0, 86],
    ['C5', 0.5, 88], ['A4', 0.5, 84], ['F#4', 0.5, 82], ['A4', 0.5, 84], ['G4', 2.0, 90],
    ['G4', 1.0, 82], ['A4', 1.0, 82], ['A4', 1.0, 82], ['B4', 1.0, 84],
    ['G4', 1.0, 84], ['B4', 1.0, 86], ['D5', 2.0, 88],
    ['B4', 0.5, 86], ['A4', 0.5, 84], ['G4', 0.5, 84], ['F#4', 0.5, 82], ['G4', 0.5, 84], ['A4', 0.5, 86], ['B4', 0.5, 88], ['G4', 0.5, 86],
    ['A4', 0.5, 86], ['F#4', 0.5, 84], ['D4', 0.5, 82], ['F#4', 0.5, 84], ['G4', 2.0, 94],
  ]);
  const brVn2 = seq(brBpm, [
    ['D4', 0.5, 78], ['G4', 0.5, 80], ['B4', 0.5, 82], ['G4', 0.5, 78], ['D4', 0.5, 78], ['F#4', 0.5, 80], ['G4', 0.5, 80], ['D4', 0.5, 78],
    ['F#4', 0.5, 80], ['A4', 0.5, 82], ['G4', 0.5, 80], ['F#4', 0.5, 78], ['E4', 0.5, 78], ['D4', 0.5, 76], ['C4', 0.5, 76], ['D4', 0.5, 76],
    ['D4', 0.5, 78], ['F#4', 0.5, 80], ['G4', 0.5, 82], ['A4', 0.5, 82], ['B4', 1.0, 84], ['G4', 1.0, 80],
    ['A4', 0.5, 82], ['F#4', 0.5, 78], ['D4', 0.5, 76], ['D4', 0.5, 78], ['B3', 2.0, 84],
    ['D4', 1.0, 76], ['E4', 1.0, 76], ['D4', 1.0, 76], ['F#4', 1.0, 78],
    ['D4', 1.0, 78], ['G4', 1.0, 80], ['F#4', 2.0, 82],
    ['G4', 0.5, 80], ['F#4', 0.5, 78], ['E4', 0.5, 78], ['D4', 0.5, 76], ['E4', 0.5, 78], ['F#4', 0.5, 80], ['G4', 0.5, 82], ['E4', 0.5, 80],
    ['F#4', 0.5, 80], ['D4', 0.5, 78], ['C4', 0.5, 76], ['D4', 0.5, 78], ['B3', 2.0, 88],
  ]);
  const brVc = seq(brBpm, [
    ['G2', 1.0, 86], ['B2', 1.0, 84], ['G2', 1.0, 84], ['B2', 1.0, 84],
    ['D3', 1.0, 86], ['C3', 1.0, 84], ['B2', 1.0, 84], ['A2', 1.0, 82],
    ['G2', 1.0, 86], ['A2', 1.0, 84], ['B2', 1.0, 86], ['G2', 1.0, 84],
    ['C3', 1.0, 86], ['D3', 1.0, 86], ['G2', 2.0, 90],
    ['G2', 1.0, 82], ['C3', 1.0, 82], ['D3', 1.0, 82], ['B2', 1.0, 82],
    ['G2', 1.0, 84], ['B2', 1.0, 84], ['D3', 2.0, 86],
    ['G2', 1.0, 86], ['B2', 1.0, 84], ['C3', 1.0, 86], ['E2', 1.0, 84],
    ['D2', 1.0, 86], ['D2', 1.0, 88], ['G2', 2.0, 94],
  ]);
  const brGt = seq(brBpm, [
    ['G2', 0.5, 76], ['D3', 0.5, 74], ['G3', 0.5, 76], ['B3', 0.5, 78], ['G2', 0.5, 76], ['D3', 0.5, 74], ['G3', 0.5, 76], ['B3', 0.5, 78],
    ['D3', 0.5, 76], ['A3', 0.5, 74], ['D4', 0.5, 76], ['F#4', 0.5, 78], ['G2', 0.5, 74], ['D3', 0.5, 74], ['A3', 0.5, 74], ['D4', 0.5, 76],
    ['G2', 0.5, 76], ['D3', 0.5, 74], ['G3', 0.5, 76], ['B3', 0.5, 78], ['B2', 0.5, 76], ['D3', 0.5, 74], ['G3', 0.5, 76], ['D4', 0.5, 78],
    ['C3', 0.5, 76], ['G3', 0.5, 74], ['D3', 0.5, 76], ['F#3', 0.5, 76], ['G2', 2.0, 84],
    ['G2', 0.5, 74], ['D3', 0.5, 72], ['C3', 0.5, 74], ['E3', 0.5, 74], ['D3', 0.5, 74], ['A3', 0.5, 74], ['B2', 0.5, 74], ['D3', 0.5, 74],
    ['G2', 0.5, 76], ['D3', 0.5, 74], ['B2', 0.5, 76], ['G3', 0.5, 76], ['D3', 2.0, 82],
    ['G2', 0.5, 76], ['D3', 0.5, 74], ['G3', 0.5, 76], ['B3', 0.5, 78], ['C3', 0.5, 76], ['E3', 0.5, 74], ['G3', 0.5, 76], ['E3', 0.5, 74],
    ['D3', 0.5, 76], ['A3', 0.5, 74], ['F#3', 0.5, 76], ['D3', 0.5, 74], ['G2', 2.0, 88],
  ]);
  const brPf = seq(brBpm, [
    [['G2', 'B3', 'D4'], 1.0, 76], [['B2', 'D4', 'G4'], 1.0, 74], [['G2', 'B3', 'D4'], 1.0, 76], [['B2', 'D4', 'G4'], 1.0, 74],
    [['D3', 'F#4', 'A4'], 1.0, 76], [['C3', 'E4', 'A4'], 1.0, 74], [['B2', 'D4', 'G4'], 1.0, 74], [['A2', 'C4', 'F#4'], 1.0, 74],
    [['G2', 'B3', 'D4'], 1.0, 76], [['A2', 'C4', 'F#4'], 1.0, 74], [['B2', 'D4', 'G4'], 1.0, 76], [['G2', 'B3', 'D4'], 1.0, 74],
    [['C3', 'E4', 'G4'], 1.0, 76], [['D3', 'F#4', 'A4'], 1.0, 76], [['G2', 'B3', 'D4', 'G4'], 2.0, 82],
    [['G2', 'B3', 'D4'], 1.0, 74], [['C3', 'E4', 'G4'], 1.0, 74], [['D3', 'F#4', 'A4'], 1.0, 74], [['B2', 'D4', 'G4'], 1.0, 74],
    [['G2', 'B3', 'D4'], 1.0, 76], [['B2', 'D4', 'G4'], 1.0, 76], [['D3', 'F#4', 'A4'], 2.0, 80],
    [['G2', 'B3', 'D4'], 1.0, 78], [['B2', 'D4', 'G4'], 1.0, 76], [['C3', 'E4', 'G4'], 1.0, 78], [['E2', 'B3', 'G4'], 1.0, 76],
    [['D2', 'A3', 'F#4'], 1.0, 78], [['D2', 'C4', 'F#4'], 1.0, 80], [['G2', 'B3', 'D4', 'G4'], 2.0, 88],
  ]);

  const decetBach = buildEnsemble(
    { id: 'decet-brandenburg', title: 'Brandenburg Concertino in G', composer: 'Johann Sebastian Bach', opus: '10-Player All-Star Ensemble', bpm: brBpm, fifths: 1, num: 4, den: 4, leadPart: 7 },
    [
      { id: 'vn1a',   role: 'Violin Ia',  kind: 'violin', seat: DECET_SEATS.vn1a,   pan: -0.72, notes: brVn1.notes, duration: brFl.duration },
      { id: 'vn1b',   role: 'Violin Ib',  kind: 'violin', seat: DECET_SEATS.vn1b,   pan: -0.48, notes: brVn1.notes, duration: brFl.duration },
      { id: 'vn2a',   role: 'Violin IIa', kind: 'violin', seat: DECET_SEATS.vn2a,   pan: -0.22, notes: brVn2.notes, duration: brFl.duration },
      { id: 'vn2b',   role: 'Violin IIb', kind: 'violin', seat: DECET_SEATS.vn2b,   pan:  0.08, notes: brVn2.notes, duration: brFl.duration },
      { id: 'vc1',    role: 'Cello I',    kind: 'cello',  seat: DECET_SEATS.vc1,    pan:  0.46, notes: brVc.notes,  duration: brFl.duration },
      { id: 'vc2',    role: 'Cello II',   kind: 'cello',  seat: DECET_SEATS.vc2,    pan:  0.72, notes: brVc.notes,  duration: brFl.duration },
      { id: 'guitar', role: 'Guitar',     kind: 'guitar', seat: DECET_SEATS.guitar, pan:  0.22, notes: brGt.notes,  duration: brFl.duration },
      { id: 'flute',  role: 'Flute',      kind: 'flute',  seat: DECET_SEATS.flute,  pan: -0.18, notes: brFl.notes,  duration: brFl.duration },
      { id: 'oboe',   role: 'Oboe',       kind: 'oboe',   seat: DECET_SEATS.oboe,   pan:  0.18, notes: brOb.notes,  duration: brFl.duration },
      { id: 'piano',  role: 'Piano',      kind: 'piano',  seat: DECET_SEATS.piano,  pan: -0.62, notes: brPf.notes,  duration: brFl.duration },
    ]
  );

  return {
    quartet: [quartetMozart, quartetCanon],
    ensemble: [decetCanon, decetBach],
  };
})();

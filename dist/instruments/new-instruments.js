'use strict';
/* Host shell adapters for Trumpet, Clarinet, Harp, Double Bass, and Percussion. */
(() => {
  const bc = (kind, label) => ({
    id: kind, label, songs: window.BRASS_CLARINET_DATA[kind],
    scoreConfig: { clef: 'treble', annotation: nt => nt?.label || '' },
    plan: song => window.BrassClarinetEngine.plan(kind, song),
    stateAt: (p, t) => window.BrassClarinetEngine.stateAt(p, t),
    draw: (R, st) => window.BrassClarinetEngine.draw(R, st),
    createVoice: (ctx, opts) => window.NewInstrumentsAudio.createVoice(kind, ctx, opts),
  });
  const hbp = (kind, label, clef) => ({
    id: kind, label, songs: window.HARP_BASS_PERC_SONGS[kind],
    scoreConfig: { clef },
    plan: song => window.HarpBassPercEngine.plan(kind, song),
    stateAt: (p, t) => window.HarpBassPercEngine.stateAt(p, t),
    draw: (R, st) => window.HarpBassPercEngine.draw(R, st),
    createVoice: (ctx, opts) => window.NewInstrumentsAudio.createVoice(kind, ctx, opts),
  });
  // Solo Viola: C-G-D-A tuning (visual fingering shifted +7 semitones onto ViolinModel at 1.05x scale,
  // reusing the zero-LM natural left-hand atlas and live 1-note alternating bowing).
  const NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const midi = s => { const m = /^([A-G])([#b]?)(\d)$/.exec(s); return (Number(m[3]) + 1) * 12 + NOTE[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0); };
  const vSeq = (bpm, items) => {
    const spb = 60 / bpm, notes = []; let beat = 0;
    for (const [n, dur, vel = 84] of items) { if (n !== 'R') notes.push([+(beat * spb).toFixed(4), +(dur * spb * 0.92).toFixed(4), midi(n), vel]); beat += dur; }
    return { notes, duration: +(beat * spb + 0.8).toFixed(3) };
  };
  const vMake = (id, title, composer, opus, bpm, fifths, num, den, d) => ({
    id, title, composer, opus, bpm, duration: d.duration, notes: d.notes,
    signatures: [{ beat: 0, numerator: num, denominator: den }], keySignature: { fifths },
  });
  const telemannVa = vSeq(76, [
    ['G3', 1, 84], ['B3', 1, 86], ['D4', 1.5, 90], ['C4', 0.5, 84],
    ['B3', 1, 84], ['A3', 0.5, 82], ['G3', 0.5, 80], ['F#3', 1, 82], ['D3', 1, 80],
    ['G3', 0.5, 84], ['A3', 0.5, 86], ['B3', 0.5, 88], ['C4', 0.5, 88], ['D4', 1, 92], ['B3', 1, 86],
    ['C4', 0.5, 88], ['B3', 0.5, 84], ['A3', 0.5, 82], ['G3', 0.5, 82], ['A3', 2, 86],
    ['D4', 1, 90], ['E4', 0.5, 92], ['F#4', 0.5, 94], ['G4', 1.5, 96], ['F#4', 0.5, 90],
    ['E4', 0.5, 88], ['D4', 0.5, 86], ['C4', 0.5, 84], ['B3', 0.5, 84], ['A3', 1, 84], ['D4', 1, 88],
    ['B3', 0.5, 86], ['C4', 0.5, 86], ['D4', 0.5, 88], ['B3', 0.5, 84], ['A3', 1, 84], ['F#3', 1, 82], ['G3', 2, 90],
  ]);
  const bachVa = vSeq(92, [
    ['G3', 0.25, 82], ['D4', 0.25, 84], ['B4', 0.25, 88], ['A4', 0.25, 86], ['B4', 0.25, 88], ['D4', 0.25, 84], ['B4', 0.25, 86], ['D4', 0.25, 82],
    ['G3', 0.25, 82], ['D4', 0.25, 84], ['B4', 0.25, 88], ['A4', 0.25, 86], ['B4', 0.25, 88], ['D4', 0.25, 84], ['B4', 0.25, 86], ['D4', 0.25, 82],
    ['G3', 0.25, 82], ['E4', 0.25, 86], ['C5', 0.25, 90], ['B4', 0.25, 88], ['C5', 0.25, 90], ['E4', 0.25, 86], ['C5', 0.25, 88], ['E4', 0.25, 84],
    ['G3', 0.25, 82], ['F#4', 0.25, 86], ['C5', 0.25, 90], ['B4', 0.25, 88], ['C5', 0.25, 90], ['F#4', 0.25, 86], ['C5', 0.25, 88], ['F#4', 0.25, 84],
    ['G3', 0.25, 84], ['G4', 0.25, 88], ['B4', 0.25, 92], ['A4', 0.25, 88], ['B4', 0.25, 90], ['G4', 0.25, 86], ['D4', 0.25, 84], ['B3', 0.25, 82],
    ['C3', 0.25, 86], ['G3', 0.25, 84], ['E4', 0.25, 88], ['D4', 0.25, 86], ['E4', 0.25, 88], ['C4', 0.25, 84], ['G3', 0.25, 82], ['E3', 0.25, 80],
    ['D3', 0.25, 84], ['A3', 0.25, 86], ['F#4', 0.25, 90], ['E4', 0.25, 88], ['D4', 0.25, 86], ['C4', 0.25, 84], ['B3', 0.25, 84], ['A3', 0.25, 82],
    ['G3', 2.0, 92],
  ]);
  const VIOLA_SCALE = { U: [0.97, 0, 0], V: [0, 0.97, 0], W: [0, 0, 0.97], O: [0, 0, 0] };
  const VIOLA_OPTS = { female: true, gown: [.048, .062, .112] };
  window.VIOLA_INSTRUMENT = {
    id: 'viola', label: 'Viola',
    songs: [
      vMake('telemann-viola', 'Viola Concerto in G', 'Georg Philipp Telemann', 'TWV 51:G9 — Solo Viola', 76, 1, 4, 4, telemannVa),
      vMake('bach-viola-prelude', 'Suite No. 1 — Prelude', 'Johann Sebastian Bach', 'BWV 1007 — Viola Transcription', 92, 1, 4, 4, bachVa),
    ],
    scoreConfig: { clef: 'tenor' },
    plan: song => window.ViolinMotion.plan({ ...song, notes: song.notes.map(([t, d, p, v]) => [t, d, p + 7, v]), slurs: [], harmonics: [], maxPosition: 6 }),
    stateAt(p, t) {
      const st = window.ViolinMotion.atLegacy(p, t);
      const act = st.sounding[0];
      const match = window.EnsembleEngine?.lookupViolinHand(act ? act.string : Math.round(st.bow.string), act ? act.finger : 1, st.debug.handDistMm || 60);
      if (match) { st.handL = match.handL; st.armL = match.armL; }
      return st;
    },
    draw: (R, st) => R.withTransform ? R.withTransform(VIOLA_SCALE, () => window.ViolinModel.draw(R, st, VIOLA_OPTS)) : window.ViolinModel.draw(R, st, VIOLA_OPTS),
    createVoice: (ctx, opts) => window.NewInstrumentsAudio.createVoice('viola', ctx, opts),
  };

  window.TRUMPET_INSTRUMENT = bc('trumpet', 'Trumpet');
  window.CLARINET_INSTRUMENT = bc('clarinet', 'Clarinet');
  window.HARP_INSTRUMENT = hbp('harp', 'Concert Harp', 'treble');
  window.BASS_INSTRUMENT = hbp('bass', 'Double Bass', 'bass');
  window.PERCUSSION_INSTRUMENT = hbp('percussion', 'Percussion', 'treble');
})();

'use strict';
/* Entry point for the violin instrument module. The host shell
 * (demos-pianist integration) loads, in order:
 *   violin-fingering.js, violin-songs.js, violin-model.js,
 *   violin-motion.js, violin-audio.js, violin-instrument.js
 * and drives everything through window.VIOLIN_INSTRUMENT (see INTERFACE.md).
 * This module touches no DOM and owns no page chrome.
 */
window.VIOLIN_INSTRUMENT = (() => {
  const plans = new WeakMap();
  function plan(song) {
    let p = plans.get(song);
    if (!p) { p = window.ViolinMotion.plan(song); plans.set(song, p); }
    return p;
  }
  return {
    id: 'violin',
    label: 'Violin',
    songs: window.VIOLIN_SONGS || [],
    fingering: window.ViolinFingering,
    model: window.ViolinModel,
    motion: window.ViolinMotion,
    plan,
    stateAt: (p, t) => window.ViolinMotion.at(p, t),
    stateAtCached: (p, t) => window.ViolinMotion.atCached(p, t),
    draw: (R, state) => window.ViolinModel.draw(R, state),
    createVoice: (ctx, opts) => window.ViolinAudio.createVoice(ctx, opts),
    // Single treble staff; under each note the host may print the string
    // name and finger (e.g. "G · 2"), mirroring the pianist's fingering row.
    scoreConfig: {
      staff: 'treble', clef: 'G', staves: 1,
      annotation: e => 'GDAE'[e.string] + (e.finger ? ' · ' + e.finger : ' · open'),
      bowMark: e => (e.bow === 'down' ? '⊓' : '⊔'),
    },
  };
})();

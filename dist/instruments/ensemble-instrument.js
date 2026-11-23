'use strict';
/* Host shell adapters for String Quartet (4 players) and All-Star Decet (10 players). */
(() => {
  function makeEnsembleInstrument(kind, label) {
    return {
      id: kind,
      label,
      songs: window.ENSEMBLE_SONGS[kind],
      scoreConfig: { clef: 'treble' },
      plan: song => window.EnsembleEngine.plan(kind, song),
      stateAt: (plan, t) => window.EnsembleEngine.stateAt(plan, t),
      draw: (R, state) => window.EnsembleEngine.draw(R, state),
      createVoice: (ctx, opts) => window.EnsembleAudio.createVoice(ctx, opts),
    };
  }
  window.QUARTET_INSTRUMENT = makeEnsembleInstrument('quartet', 'String Quartet');
  window.ENSEMBLE_INSTRUMENT = makeEnsembleInstrument('ensemble', 'Chamber Decet');
})();

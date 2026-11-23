'use strict';
/* Host shell adapters for Concert Flute and Oboe. */
(() => {
  function makeInstrument(kind, label) {
    return {
      id: kind,
      label,
      songs: window.WOODWIND_SONGS[kind],
      scoreConfig: {
        clef: 'treble',
        annotation: nt => nt?.label || '',
      },
      plan: song => window.WoodwindEngine.plan(kind, song),
      stateAt: (plan, t) => window.WoodwindEngine.stateAt(plan, t),
      draw: (R, state) => window.WoodwindEngine.draw(R, state),
      createVoice: (ctx, opts) => window.WoodwindAudio.createVoice(kind, ctx, opts),
    };
  }
  window.FLUTE_INSTRUMENT = makeInstrument('flute', 'Concert Flute');
  window.OBOE_INSTRUMENT = makeInstrument('oboe', 'Oboe');
})();

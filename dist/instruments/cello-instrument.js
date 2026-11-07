'use strict';
/* Cello instrument entry point for the integrated host app.
 * Load order: cello-fingering.js, cello-model.js, cello-motion.js,
 * cello-audio.js, cello-songs.js, then this file.
 * See INTERFACE.md for the full contract. */
window.CELLO_INSTRUMENT = (() => {
  const scoreConfig = {
    staff: 'single',
    transposing: false, // written pitch sounds as written
    defaultClef: 'bass',
    // Cello convention: bass clef for the low/middle register, tenor
    // clef for the upper-middle, treble for sustained high writing.
    clefFor(pitch) { return pitch >= 72 ? 'treble' : pitch >= 62 ? 'tenor' : 'bass'; },
    range: [36, 84],
    fingeringLabel(note) { // note = a CelloFingering result entry
      if (!note) return '';
      const finger = note.finger === 0 ? 'o' : String(note.finger);
      return window.CelloFingering.STRING_NAMES[note.string] + '·' + finger;
    }
  };
  return {
    id: 'cello',
    label: 'Cello',
    songs: window.CELLO_SONGS || [],
    fingering: window.CelloFingering,
    planMotion(song) { return window.CelloMotion.plan(song); },
    buildPerformer(renderer) {
      return {
        draw(song, t, opts) { return window.CelloMotion.draw(renderer, song, t, opts); },
        pose(song, t) { return window.CelloMotion.pose(song, t); }
      };
    },
    createVoice(ctx, destination) { return window.CelloAudio.createVoice(ctx, destination); },
    scoreConfig
  };
})();

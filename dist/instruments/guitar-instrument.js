'use strict';
/* Entry point for the host shell (demos-pianist integration).
 * Load order: guitar-songs.js, guitar-fingering.js, guitar-motion.js,
 * guitar-model.js, guitar-audio.js, guitar-score.js, then this file.
 * See INTERFACE.md for the full contract. */
window.GUITAR_INSTRUMENT = {
  id: 'guitar',
  label: 'Classical Guitar',
  songs: window.GUITAR_SONGS,
  fingering: window.GuitarFingering,
  motion: window.GuitarMotion,
  scoreConfig: window.GuitarScore.config,
  // plan(song) -> motion plan consumed by pose() and the score strip.
  planMotion: song => window.GuitarMotion.plan(song),
  pose: (plan, t) => window.GuitarMotion.pose(plan, t),
  // buildPerformer(renderer, pose, t): draws guitar + performer with
  // the host renderer's primitives (host owns begin/camera/stage).
  buildPerformer: (renderer, pose, t) => window.GuitarModel.drawGuitar(renderer, pose, t) || window.GuitarModel.drawPerformer(renderer, pose, t),
  drawScore: (ctx2d, song, plan, t, w, h) => window.GuitarScore.drawStrip(ctx2d, song, plan, t, w, h),
  beatAt: (song, t) => window.GuitarScore.beatAt(song, t),
  timeAt: (song, beat) => window.GuitarScore.timeAt(song, beat),
  createVoice: (audioCtx, opts) => window.GuitarAudio.createVoice(audioCtx, opts),
};

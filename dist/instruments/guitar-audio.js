'use strict';
/* Nylon-string guitar voice: Karplus-Strong plucked-string synthesis,
 * rendered per pitch into cached AudioBuffers (no samples needed, so
 * the voice is fully self-contained and lawful to redistribute).
 *
 * Per note: a noise burst (brightness follows velocity, like a harder
 * nail attack) excites a feedback delay line of length sr/freq. The
 * damping factor is string-aware: wound bass strings (5, 6 and the
 * wound 4th... classical sets wind 4-6) ring longer and darker; plain
 * trebles decay faster and brighter. A one-pole lowpass in the loop
 * models the string's loss; the body is suggested by a gentle presence
 * EQ on the master, not by convolution.
 *
 * Host contract (see INTERFACE.md): createVoice(ctx, {volume}) ->
 * { startNote(note, when), stopAll(), setVolume(v), stats }
 * note = { pitch, velocity, string, fret } (string/fret optional;
 * string selects the damping character). stats.attacks records
 * { when, pitch, string } for every started note (test/debug hook). */
window.GuitarAudio = (() => {
function createVoice(ctx, opts = {}) {
  const master = ctx.createGain(); master.gain.value = (opts.volume ?? 0.7) * 0.8;
  const comp = ctx.createDynamicsCompressor();
  const presence = ctx.createBiquadFilter(); presence.type = 'peaking'; presence.frequency.value = 2600; presence.gain.value = 2.5; presence.Q.value = 0.7;
  master.connect(presence); presence.connect(comp); comp.connect(ctx.destination);
  const cache = new Map(), live = new Set();
  const stats = { attacks: [] };
  function render(pitch, velocity, string) {
    const key = pitch + ':' + (string || 0) + ':' + Math.round(velocity / 32);
    if (cache.has(key)) return cache.get(key);
    const sr = ctx.sampleRate, freq = 440 * Math.pow(2, (pitch - 69) / 12);
    const dur = pitch < 50 ? 3.2 : 2.4, len = Math.floor(sr * dur);
    const buf = ctx.createBuffer(1, len, sr), out = buf.getChannelData(0);
    const N = Math.max(2, Math.round(sr / freq));
    // Exciter: short noise burst, lowpassed harder for soft attacks.
    const burst = new Float32Array(N);
    let lp = 0; const bright = 0.25 + 0.75 * (velocity / 127);
    for (let i = 0; i < N; i++) { const white = Math.random() * 2 - 1; lp += bright * (white - lp); burst[i] = lp; }
    // Damping: trebles (plain nylon) decay a little faster than wound basses.
    const wound = (string || (pitch < 55 ? 6 : 1)) >= 4;
    const t60 = (wound ? 3.4 : 2.6) * (pitch < 45 ? 1.25 : 1);
    const g = Math.pow(0.001, (N / sr) / t60); // per-period gain for -60 dB at t60
    const ring = new Float32Array(N); ring.set(burst);
    let idx = 0;
    const amp = 0.55 * (0.35 + 0.65 * (velocity / 127));
    for (let i = 0; i < len; i++) {
      const cur = ring[idx];
      const nxt = ring[(idx + 1) % N];
      const v = g * 0.5 * (cur + nxt);
      ring[idx] = v; out[i] = cur * amp;
      idx = (idx + 1) % N;
    }
    // 4 ms fade at the very end to avoid a click.
    const fade = Math.min(len, Math.floor(sr * 0.004));
    for (let i = 0; i < fade; i++) out[len - 1 - i] *= i / fade;
    if (cache.size > 240) cache.clear();
    cache.set(key, buf);
    return buf;
  }
  function startNote(note, when) {
    const src = ctx.createBufferSource();
    src.buffer = render(note.pitch, note.velocity ?? 80, note.string);
    src.connect(master); src.start(when);
    live.add(src); src.onended = () => live.delete(src);
    stats.attacks.push({ when, pitch: note.pitch, string: note.string || 0 });
    return src;
  }
  function stopAll() { for (const s of live) { try { s.stop(); } catch (e) { /* already stopped */ } } live.clear(); }
  return { startNote, stopAll, render, stats, master, setVolume: v => master.gain.setTargetAtTime(v * 0.8, ctx.currentTime, 0.03) };
}
return { createVoice };
})();

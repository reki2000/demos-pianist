'use strict';
/* Violin voice: self-contained WebAudio synthesis (no samples needed).
 * Two detuned sawtooths through a velocity-tracking lowpass give the bowed
 * string body; a short band-passed noise burst at the attack is the bow
 * bite; vibrato (5.6 Hz, delayed 0.22s, ramped over 0.35s — the same
 * constants as ViolinMotion.VIB, so the heard pitch wobble matches the
 * seen finger wobble) applies to notes of 0.55s or longer. Down-bows get
 * a marginally firmer attack than up-bows. stopAll silences every voice.
 */
window.ViolinAudio = (() => {
const VIB = { minDur: 0.55, delay: 0.22, ramp: 0.35, rate: 5.6 };
function createVoice(ctx, { volume = 0.7 } = {}) {
  const master = ctx.createGain();
  master.gain.value = volume * 0.9;
  master.connect(ctx.destination);
  const voices = new Set();
  const stats = { attacks: [], get activeVoices() { return voices.size; } };
  let noiseBuf = null;
  function noise() {
    if (noiseBuf) return noiseBuf;
    const len = Math.floor(ctx.sampleRate * 0.25);
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return noiseBuf;
  }
  function startNote(song, note, when, speed = 1, planNote = null) {
    const pitch = note[2], vel = note[3], dur = Math.max(0.05, note[1] / speed);
    const freq = 440 * Math.pow(2, (pitch - 69) / 12);
    const down = !planNote || planNote.bow !== 'up';
    const level = 0.15 * (0.25 + 0.75 * vel / 127) * (down ? 1.06 : 1.0);
    const g = ctx.createGain();
    const flt = ctx.createBiquadFilter();
    flt.type = 'lowpass'; flt.frequency.value = Math.min(3200, Math.max(800, 650 + vel * 17)); flt.Q.value = 0.8;
    flt.connect(g); g.connect(master);
    const oscs = [];
    for (const det of [-4, 5]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth'; o.frequency.value = freq; o.detune.value = det;
      o.connect(flt); oscs.push(o);
    }
    let lfo = null, lfoGain = null;
    if (dur >= VIB.minDur) {
      lfo = ctx.createOscillator(); lfo.frequency.value = VIB.rate;
      lfoGain = ctx.createGain(); lfoGain.gain.value = 0;
      lfo.connect(lfoGain);
      for (const o of oscs) lfoGain.connect(o.frequency);
      const depth = freq * 0.0105; // ~ +/-18 cents
      lfoGain.gain.setValueAtTime(0, when + VIB.delay);
      lfoGain.gain.linearRampToValueAtTime(depth, when + VIB.delay + VIB.ramp);
    }
    const atk = down ? 0.045 : 0.065;
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(level, when + atk);
    g.gain.setValueAtTime(level, Math.max(when + atk, when + dur - 0.02));
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur + 0.13);
    // Bow bite: a breath of noise at the attack.
    const ns = ctx.createBufferSource(); ns.buffer = noise();
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1900; bp.Q.value = 0.9;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.05 * (vel / 127), when);
    ng.gain.exponentialRampToValueAtTime(0.0001, when + 0.09);
    ns.connect(bp); bp.connect(ng); ng.connect(master);
    const stopAt = when + dur + 0.2;
    for (const o of oscs) { o.start(when); o.stop(stopAt); }
    if (lfo) { lfo.start(when); lfo.stop(stopAt); }
    ns.start(when); ns.stop(when + 0.1);
    const voice = { oscs, lfo, ns, g, stopAt };
    voices.add(voice);
    // Retire every node once all sources have actually ended. Clearing the
    // transport's Set alone leaves the filter/modulation graph connected.
    const sources = [...oscs, ns, ...(lfo ? [lfo] : [])];
    let remaining = sources.length;
    for (const source of sources) source.onended = () => {
      source.onended = null;
      source.disconnect();
      if (--remaining !== 0) return;
      voices.delete(voice);
      for (const node of [g, flt, bp, ng, lfoGain]) if (node) node.disconnect();
    };
    stats.attacks.push({ when, pitch, freq, bow: down ? 'down' : 'up' });
    if (stats.attacks.length > 512) stats.attacks.shift();
    return voice;
  }
  function stopAll() {
    const now = ctx.currentTime;
    for (const v of voices) {
      try {
        v.g.gain.cancelScheduledValues(now);
        v.g.gain.setTargetAtTime(0, now, 0.03);
        for (const o of v.oscs) o.stop(now + 0.15);
        if (v.lfo) v.lfo.stop(now + 0.15);
        v.ns.stop(now + 0.15);
      } catch (e) { /* already stopped */ }
    }
    voices.clear();
  }
  return { master, startNote, stopAll, stats, latency: 0 };
}
return { createVoice, VIB };
})();

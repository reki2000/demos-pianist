'use strict';
/*
 * CelloAudio — host-agnostic solo-cello voice engine (WebAudio, no samples, no DOM).
 *
 * API:
 *   window.CelloAudio = { createVoice(ctx, destination) -> voice }
 *   voice = {
 *     noteOn({ pitch, velocity, time, duration }),
 *       // pitch: MIDI number (36 = C2 .. ~81 = A5), velocity: 0..127,
 *       // time: AudioContext time (seconds) to start, duration: seconds until release begins
 *     noteOff({ pitch, time }),   // early release; safe to call twice / for a silent pitch
 *     allNotesOff(time),          // release every sounding pitch
 *     setVolume(v)                // 0..1 master volume for this voice
 *   }
 *
 * Synthesis: two detuned sawtooths (bowed-string harmonic stack) through a soft
 * waveshaper (bow grit / rosin edge) and a pitch+velocity-tracking lowpass,
 * with delayed vibrato, a bowed swell attack and a filter-closing release.
 * Each pitch gets its own chain, so double stops (up to 4+) are polyphonic;
 * all chains share one master gain -> gentle DynamicsCompressor -> destination.
 */
window.CelloAudio = (() => {
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const freqOf = pitch => 440 * 2 ** ((pitch - 69) / 12);
  const RELEASE = 0.18; // s, bow lift

  // AudioParams differ between real contexts and test doubles: prefer the
  // scheduling methods when present, fall back to a plain .value write.
  function setP(p, v, t) {
    if (!p) return;
    if (typeof p.setValueAtTime === 'function') p.setValueAtTime(v, t); else p.value = v;
  }
  function rampP(p, v, t) {
    if (!p) return;
    if (typeof p.linearRampToValueAtTime === 'function') p.linearRampToValueAtTime(v, t); else p.value = v;
  }
  function cancelP(p, t) { if (p && typeof p.cancelScheduledValues === 'function') p.cancelScheduledValues(t); }
  function decayP(p, v, t, tc) { // smooth fall from whatever value the param has reached
    if (!p) return;
    if (typeof p.setTargetAtTime === 'function') p.setTargetAtTime(v, t, tc); else rampP(p, v, t + RELEASE);
  }
  function stopNode(n, t) { try { n.stop(t); } catch { /* already stopped: a re-stop is harmless */ } }

  // Soft-clip curve: adds odd harmonics that read as bow pressure on the string.
  function gritCurve() {
    const n = 512, curve = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; curve[i] = Math.tanh(1.8 * x); }
    return curve;
  }

  function createVoice(ctx, destination) {
    const dest = destination || ctx.destination;
    const master = ctx.createGain();
    master.gain.value = 0.9;
    // Shared gentle limiter so double stops sum without harsh clipping.
    let tail = master;
    if (typeof ctx.createDynamicsCompressor === 'function') {
      const comp = ctx.createDynamicsCompressor();
      if (comp.threshold) comp.threshold.value = -14;
      if (comp.knee) comp.knee.value = 18;
      if (comp.ratio) comp.ratio.value = 4;
      if (comp.attack) comp.attack.value = 0.004;
      if (comp.release) comp.release.value = 0.18;
      master.connect(comp); tail = comp;
    }
    tail.connect(dest);

    const byPitch = new Map(); // pitch -> Set of note records (retriggers coexist)
    const all = new Set();

    function scheduleRelease(note, t) {
      if (note.releasedAt !== null && note.releasedAt <= t) return; // earlier release already set
      note.releasedAt = t;
      const stop = t + RELEASE + 0.07;
      cancelP(note.gain.gain, t);
      decayP(note.gain.gain, 0.0001, t, RELEASE / 3);
      cancelP(note.filter.frequency, t);
      decayP(note.filter.frequency, Math.max(300, note.cutoff * 0.35), t, RELEASE / 3);
      for (const src of note.sources) stopNode(src, stop);
    }

    function noteOn({ pitch, velocity = 100, time, duration } = {}) {
      if (!Number.isFinite(pitch)) return;
      const t = Number.isFinite(time) ? time : ctx.currentTime;
      const vel = clamp(Number.isFinite(velocity) ? velocity : 100, 0, 127) / 127;
      const f = freqOf(pitch);
      // Bowed attack: loud strokes bite faster (60 ms) than soft ones (120 ms).
      const attack = 0.12 - vel * 0.06;
      const amp = 0.55 * vel ** 1.2;
      // Filter tracks pitch and bow pressure, kept in the cello's vocal band.
      const cutoff = clamp(f * 4 + vel * 800, 600, 2400);

      const gain = ctx.createGain();
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      if (filter.Q) filter.Q.value = 0.7;
      filter.connect(gain); gain.connect(master);

      let head = filter; // oscillators feed `head`; a shaper, when available, sits before the filter
      let shaper = null;
      if (typeof ctx.createWaveShaper === 'function') {
        try { shaper = ctx.createWaveShaper(); shaper.curve = gritCurve(); shaper.oversample = '2x'; shaper.connect(filter); head = shaper; } catch { shaper = null; head = filter; }
      }

      // Two saws a few cents apart: chorus-like string width, no pitch error
      // (detune, not frequency, carries the offset, so frequency stays exact).
      const sources = [];
      const mkOsc = (detuneCents, level) => {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = f;
        if (osc.detune) osc.detune.value = detuneCents;
        const mix = ctx.createGain(); mix.gain.value = level;
        osc.connect(mix); mix.connect(head); sources.push(osc);
        return osc;
      };
      const oscA = mkOsc(0, 0.85), oscB = mkOsc(5, 0.4);

      // Delayed vibrato: LFO -> gain (depth in cents) -> detune of both saws.
      // Silent at onset, ramping to +-6 cents over ~0.35 s, as a cellist's left hand does.
      const lfo = ctx.createOscillator();
      lfo.type = 'sine'; lfo.frequency.value = 5.2;
      const lfoDepth = ctx.createGain();
      if (lfoDepth.gain) lfoDepth.gain.value = 0;
      setP(lfoDepth.gain, 0, t); rampP(lfoDepth.gain, 6, t + 0.35);
      lfo.connect(lfoDepth);
      if (oscA.detune) lfoDepth.connect(oscA.detune);
      if (oscB.detune) lfoDepth.connect(oscB.detune);
      sources.push(lfo);

      // Envelopes: gain swell, and the filter opening with the bow stroke.
      if (gain.gain) gain.gain.value = 0;
      setP(gain.gain, 0, t);
      rampP(gain.gain, Math.max(amp, 0.0001), t + attack);
      rampP(gain.gain, Math.max(amp * 0.85, 0.0001), t + attack + 0.15); // settle into sustain
      if (filter.frequency) filter.frequency.value = cutoff * 0.55;
      setP(filter.frequency, cutoff * 0.55, t);
      rampP(filter.frequency, cutoff, t + attack);

      const note = { pitch, gain, filter, cutoff, sources, releasedAt: null };
      if (!byPitch.has(pitch)) byPitch.set(pitch, new Set());
      byPitch.get(pitch).add(note); all.add(note);

      for (const src of sources) src.start(t); // exact onset: host schedules ahead on the audio clock
      if (Number.isFinite(duration)) scheduleRelease(note, t + Math.max(0, duration));
      return note;
    }

    function noteOff({ pitch, time } = {}) {
      const notes = byPitch.get(pitch);
      if (!notes) return;
      const t = Number.isFinite(time) ? time : ctx.currentTime;
      for (const note of notes) scheduleRelease(note, t);
    }

    function allNotesOff(time) {
      const t = Number.isFinite(time) ? time : ctx.currentTime;
      for (const note of all) scheduleRelease(note, t);
    }

    function setVolume(v) {
      const vol = clamp(Number.isFinite(v) ? v : 0, 0, 1);
      if (master.gain && typeof master.gain.setTargetAtTime === 'function') master.gain.setTargetAtTime(vol, ctx.currentTime, 0.02);
      else if (master.gain) master.gain.value = vol;
    }

    return { noteOn, noteOff, allNotesOff, setVolume };
  }

  return { createVoice };
})();

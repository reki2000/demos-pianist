'use strict';
/* Web Audio synthesizer for Concert Flute and Oboe.
 * Flute: warm fundamental + soft 2nd/3rd harmonics + breath chiff + vibrato.
 * Oboe: rich double-reed sawtooth/pulse through dual nasal formant filters + vibrato. */
window.WoodwindAudio = (() => {
  function makeNoiseBuffer(ctx) {
    const len = ctx.sampleRate * 0.5, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  function createVoice(kind, ctx, opts = {}) {
    const master = ctx.createGain();
    master.gain.value = (opts.volume ?? 0.7) * (kind === 'flute' ? 0.42 : 0.34);
    master.connect(ctx.destination);
    const noiseBuf = makeNoiseBuffer(ctx);
    const active = new Set();

    function startNote(note, when, speed = 1) {
      const freq = 440 * Math.pow(2, (note[2] - 69) / 12);
      const dur = Math.max(0.06, note[1] / speed);
      const vel = (note[3] || 80) / 127;
      const t0 = Math.max(ctx.currentTime, when), t1 = t0 + dur;

      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, t0);
      const atk = kind === 'flute' ? Math.min(0.065, dur * 0.3) : Math.min(0.045, dur * 0.25);
      const rel = Math.min(0.11, dur * 0.35);
      env.gain.linearRampToValueAtTime(vel, t0 + atk);
      env.gain.setValueAtTime(vel * 0.92, Math.max(t0 + atk, t1 - rel));
      env.gain.exponentialRampToValueAtTime(0.0001, t1 + 0.04);
      env.connect(master);

      // Vibrato LFO (delayed onset for expressive woodwind tone)
      const lfo = ctx.createOscillator(), lfoGain = ctx.createGain();
      lfo.frequency.value = kind === 'flute' ? 5.2 : 5.5;
      lfoGain.gain.setValueAtTime(0, t0);
      lfoGain.gain.linearRampToValueAtTime(freq * (kind === 'flute' ? 0.007 : 0.008), t0 + Math.min(0.32, dur * 0.6));
      lfo.connect(lfoGain);

      const nodes = [lfo];
      if (kind === 'flute') {
        const osc1 = ctx.createOscillator(), osc2 = ctx.createOscillator(), osc3 = ctx.createOscillator();
        const g1 = ctx.createGain(), g2 = ctx.createGain(), g3 = ctx.createGain();
        osc1.type = 'sine'; osc1.frequency.value = freq; g1.gain.value = 0.78;
        osc2.type = 'sine'; osc2.frequency.value = freq * 2; g2.gain.value = 0.18;
        osc3.type = 'sine'; osc3.frequency.value = freq * 3; g3.gain.value = 0.04;
        lfoGain.connect(osc1.frequency); lfoGain.connect(osc2.frequency);
        osc1.connect(g1); osc2.connect(g2); osc3.connect(g3);
        g1.connect(env); g2.connect(env); g3.connect(env);
        // Breath chiff
        const noise = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), ng = ctx.createGain();
        noise.buffer = noiseBuf; noise.loop = true;
        bp.type = 'bandpass'; bp.frequency.value = Math.min(5500, freq * 2.2); bp.Q.value = 2.4;
        ng.gain.setValueAtTime(0.0001, t0);
        ng.gain.linearRampToValueAtTime(0.08 * vel, t0 + 0.015);
        ng.gain.exponentialRampToValueAtTime(0.014 * vel, t0 + 0.10);
        noise.connect(bp); bp.connect(ng); ng.connect(env);
        for (const o of [osc1, osc2, osc3, noise]) { o.start(t0); o.stop(t1 + 0.06); nodes.push(o); }
      } else {
        // Oboe: double-reed sawtooth shaped by dual resonant formants (~1100 Hz & ~2600 Hz)
        const osc = ctx.createOscillator(), sub = ctx.createOscillator();
        osc.type = 'sawtooth'; osc.frequency.value = freq;
        sub.type = 'triangle'; sub.frequency.value = freq;
        lfoGain.connect(osc.frequency); lfoGain.connect(sub.frequency);
        const f1 = ctx.createBiquadFilter(), f2 = ctx.createBiquadFilter(), lp = ctx.createBiquadFilter();
        f1.type = 'bandpass'; f1.frequency.value = 1120; f1.Q.value = 2.6;
        f2.type = 'bandpass'; f2.frequency.value = 2650; f2.Q.value = 3.2;
        lp.type = 'lowpass'; lp.frequency.value = 4600;
        const g1 = ctx.createGain(), g2 = ctx.createGain(), gs = ctx.createGain();
        g1.gain.value = 0.72; g2.gain.value = 0.42; gs.gain.value = 0.28;
        osc.connect(f1); f1.connect(g1); g1.connect(lp);
        osc.connect(f2); f2.connect(g2); g2.connect(lp);
        sub.connect(gs); gs.connect(lp);
        lp.connect(env);
        for (const o of [osc, sub]) { o.start(t0); o.stop(t1 + 0.06); nodes.push(o); }
      }
      lfo.start(t0); lfo.stop(t1 + 0.06);
      const entry = { nodes, env };
      active.add(entry);
      lfo.onended = () => { active.delete(entry); env.disconnect(); };
    }

    function stopAll() {
      const now = ctx.currentTime;
      for (const e of active) {
        try { e.env.gain.cancelScheduledValues(now); e.env.gain.setTargetAtTime(0.0001, now, 0.015); } catch {}
        for (const n of e.nodes) { try { n.stop(now + 0.06); } catch {} }
      }
      active.clear();
    }

    function setVolume(v) {
      master.gain.setTargetAtTime(v * (kind === 'flute' ? 0.42 : 0.34), ctx.currentTime, 0.03);
    }

    return { startNote, stopAll, setVolume, master };
  }

  return { createVoice };
})();

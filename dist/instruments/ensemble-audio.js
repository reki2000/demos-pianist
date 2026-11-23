'use strict';
/* Spatialized multi-timbre Web Audio engine for String Quartet (4 players)
 * and All-Star Decet (10 players). Routes each part through a StereoPannerNode
 * matching its stage X position into a balanced concert master bus. */
window.EnsembleAudio = (() => {
  const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

  function createVoice(ctx, opts = {}) {
    const master = ctx.createGain();
    master.gain.value = (opts.volume ?? 0.7) * 0.55;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 3.5; comp.attack.value = 0.008; comp.release.value = 0.15;
    master.connect(comp);
    comp.connect(ctx.destination);
    const active = new Set();

    function track(node, stopAt) {
      active.add(node);
      try { node.stop(stopAt); } catch {}
      node.onended = () => active.delete(node);
    }

    function playNote(kind, panVal, pitch, vel, when, dur) {
      const f = mtof(pitch), now = Math.max(ctx.currentTime, when);
      const d = Math.max(0.05, dur), v = (vel / 127) * 0.32;
      const panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      const dest = panner || master;
      if (panner) { panner.pan.setValueAtTime(Math.max(-0.85, Math.min(0.85, panVal || 0)), now); panner.connect(master); }

      const env = ctx.createGain();
      env.connect(dest);

      if (kind === 'violin' || kind === 'viola' || kind === 'cello') {
        const osc = ctx.createOscillator(), osc2 = ctx.createOscillator();
        osc.type = 'sawtooth'; osc2.type = 'triangle';
        osc.frequency.setValueAtTime(f, now);
        osc2.frequency.setValueAtTime(f * 1.0018, now);
        const filt = ctx.createBiquadFilter();
        filt.type = 'lowpass';
        filt.frequency.setValueAtTime(kind === 'cello' ? Math.min(1800, f * 4.5) : kind === 'viola' ? Math.min(2600, f * 4.8) : Math.min(3400, f * 5.2), now);
        filt.Q.value = 1.6;
        const vib = ctx.createOscillator(), vg = ctx.createGain();
        vib.frequency.value = kind === 'cello' ? 4.8 : 5.4;
        vg.gain.value = f * 0.004;
        vib.connect(vg); vg.connect(osc.frequency);
        const g2 = ctx.createGain(); g2.gain.value = 0.45;
        osc.connect(filt); osc2.connect(g2); g2.connect(filt); filt.connect(env);
        const att = Math.min(0.055, d * 0.25), rel = Math.min(0.12, d * 0.3 + 0.05);
        const gainScale = kind === 'cello' ? 0.85 : 0.62;
        env.gain.setValueAtTime(0.0001, now);
        env.gain.linearRampToValueAtTime(v * gainScale, now + att);
        env.gain.setValueAtTime(v * gainScale * 0.88, now + Math.max(att, d - 0.02));
        env.gain.exponentialRampToValueAtTime(0.0001, now + d + rel);
        osc.start(now); osc2.start(now); vib.start(now);
        track(osc, now + d + rel + 0.02); track(osc2, now + d + rel + 0.02); track(vib, now + d + rel + 0.02);
      } else if (kind === 'flute') {
        const osc = ctx.createOscillator(), h2 = ctx.createOscillator();
        osc.type = 'sine'; h2.type = 'triangle';
        osc.frequency.setValueAtTime(f, now); h2.frequency.setValueAtTime(f * 2, now);
        const g2 = ctx.createGain(); g2.gain.value = 0.18;
        osc.connect(env); h2.connect(g2); g2.connect(env);
        const att = Math.min(0.05, d * 0.25), rel = 0.09;
        env.gain.setValueAtTime(0.0001, now);
        env.gain.linearRampToValueAtTime(v * 0.78, now + att);
        env.gain.exponentialRampToValueAtTime(0.0001, now + d + rel);
        osc.start(now); h2.start(now);
        track(osc, now + d + rel + 0.02); track(h2, now + d + rel + 0.02);
      } else if (kind === 'oboe') {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth'; osc.frequency.setValueAtTime(f, now);
        const f1 = ctx.createBiquadFilter(); f1.type = 'bandpass'; f1.frequency.value = 1120; f1.Q.value = 2.4;
        const f2 = ctx.createBiquadFilter(); f2.type = 'bandpass'; f2.frequency.value = 2650; f2.Q.value = 3.0;
        osc.connect(f1); osc.connect(f2); f1.connect(env); f2.connect(env);
        const att = Math.min(0.04, d * 0.2), rel = 0.08;
        env.gain.setValueAtTime(0.0001, now);
        env.gain.linearRampToValueAtTime(v * 1.15, now + att);
        env.gain.exponentialRampToValueAtTime(0.0001, now + d + rel);
        osc.start(now); track(osc, now + d + rel + 0.02);
      } else {
        // Guitar / Piano plucked/hammered harmonic decay
        const osc = ctx.createOscillator(), osc2 = ctx.createOscillator();
        osc.type = kind === 'guitar' ? 'triangle' : 'sawtooth';
        osc2.type = 'sine';
        osc.frequency.setValueAtTime(f, now); osc2.frequency.setValueAtTime(f * 2, now);
        const filt = ctx.createBiquadFilter(); filt.type = 'lowpass';
        filt.frequency.setValueAtTime(Math.min(4000, f * 6), now);
        filt.frequency.exponentialRampToValueAtTime(Math.max(350, f * 1.8), now + Math.min(0.9, d + 0.4));
        const g2 = ctx.createGain(); g2.gain.value = kind === 'piano' ? 0.30 : 0.16;
        osc.connect(filt); osc2.connect(g2); g2.connect(filt); filt.connect(env);
        const decay = kind === 'piano' ? Math.max(0.45, d + 0.35) : Math.max(0.35, d + 0.25);
        env.gain.setValueAtTime(0.0001, now);
        env.gain.linearRampToValueAtTime(v * 0.85, now + 0.008);
        env.gain.exponentialRampToValueAtTime(0.0001, now + decay);
        osc.start(now); osc2.start(now);
        track(osc, now + decay + 0.03); track(osc2, now + decay + 0.03);
      }
    }

    return {
      master,
      startNote(song, note, when, speed) {
        const pt = song.parts[note[4]];
        if (!pt) return;
        playNote(pt.kind, pt.pan, note[2], note[3], when, note[1] / (speed || 1));
      },
      setVolume(x) { master.gain.setTargetAtTime(x * 0.55, ctx.currentTime, 0.03); },
      stopAll() {
        const now = ctx.currentTime;
        for (const n of active) { try { n.stop(now + 0.01); } catch {} }
        active.clear();
      },
    };
  }

  return { createVoice };
})();

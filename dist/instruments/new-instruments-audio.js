'use strict';
/* Web Audio synthesizers for Trumpet, Clarinet, Concert Harp, Double Bass,
 * Rosewood Marimba, and Concert Timpani. */
window.NewInstrumentsAudio = (() => {
  const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

  function createVoice(kind, ctx, opts = {}) {
    const master = ctx.createGain();
    master.gain.value = (opts.volume ?? 0.7) * 0.75;
    master.connect(ctx.destination);
    const active = new Set();
    const track = (node, stopAt) => { active.add(node); try { node.stop(stopAt); } catch {} node.onended = () => active.delete(node); };

    function startNote(song, note, when, speed) {
      const f = mtof(note[2]), now = Math.max(ctx.currentTime, when);
      const d = Math.max(0.05, note[1] / (speed || 1)), v = (note[3] / 127) * 0.42;
      const effKind = kind === 'percussion' ? (song.percKind || 'marimba') : kind;
      const env = ctx.createGain();
      env.connect(master);

      if (effKind === 'viola') {
        const osc = ctx.createOscillator(), osc2 = ctx.createOscillator();
        osc.type = 'sawtooth'; osc2.type = 'triangle';
        osc.frequency.setValueAtTime(f, now); osc2.frequency.setValueAtTime(f * 1.0018, now);
        const filt = ctx.createBiquadFilter(); filt.type = 'lowpass';
        filt.frequency.setValueAtTime(Math.min(2400, f * 4.6), now); filt.Q.value = 1.7;
        const vib = ctx.createOscillator(), vg = ctx.createGain();
        vib.frequency.value = 5.2; vg.gain.value = f * 0.004;
        vib.connect(vg); vg.connect(osc.frequency);
        const g2 = ctx.createGain(); g2.gain.value = 0.45;
        osc.connect(filt); osc2.connect(g2); g2.connect(filt); filt.connect(env);
        env.gain.setValueAtTime(0.0001, now);
        env.gain.linearRampToValueAtTime(v * 0.82, now + 0.048);
        env.gain.setValueAtTime(v * 0.72, now + Math.max(0.05, d - 0.02));
        env.gain.exponentialRampToValueAtTime(0.0001, now + d + 0.12);
        osc.start(now); osc2.start(now); vib.start(now);
        track(osc, now + d + 0.14); track(osc2, now + d + 0.14); track(vib, now + d + 0.14);
      } else if (effKind === 'trumpet') {
        const osc = ctx.createOscillator(), osc2 = ctx.createOscillator();
        osc.type = 'sawtooth'; osc2.type = 'triangle';
        osc.frequency.setValueAtTime(f, now); osc2.frequency.setValueAtTime(f * 2, now);
        const filt = ctx.createBiquadFilter(); filt.type = 'lowpass';
        filt.frequency.setValueAtTime(f * 2.2, now);
        filt.frequency.linearRampToValueAtTime(Math.min(5200, f * 6.5), now + 0.045);
        filt.frequency.setValueAtTime(Math.min(4400, f * 5.2), now + d);
        filt.Q.value = 2.4;
        const g2 = ctx.createGain(); g2.gain.value = 0.22;
        osc.connect(filt); osc2.connect(g2); g2.connect(filt); filt.connect(env);
        env.gain.setValueAtTime(0.0001, now);
        env.gain.linearRampToValueAtTime(v * 0.9, now + 0.032);
        env.gain.setValueAtTime(v * 0.78, now + Math.max(0.04, d - 0.02));
        env.gain.exponentialRampToValueAtTime(0.0001, now + d + 0.09);
        osc.start(now); osc2.start(now); track(osc, now + d + 0.11); track(osc2, now + d + 0.11);
      } else if (effKind === 'clarinet') {
        const osc = ctx.createOscillator();
        osc.type = 'square'; osc.frequency.setValueAtTime(f, now);
        const filt = ctx.createBiquadFilter(); filt.type = 'lowpass';
        filt.frequency.setValueAtTime(Math.min(2800, f * 4.2), now); filt.Q.value = 1.4;
        osc.connect(filt); filt.connect(env);
        env.gain.setValueAtTime(0.0001, now);
        env.gain.linearRampToValueAtTime(v * 0.68, now + 0.04);
        env.gain.setValueAtTime(v * 0.62, now + Math.max(0.05, d - 0.02));
        env.gain.exponentialRampToValueAtTime(0.0001, now + d + 0.08);
        osc.start(now); track(osc, now + d + 0.10);
      } else if (effKind === 'harp') {
        const osc = ctx.createOscillator(), h2 = ctx.createOscillator();
        osc.type = 'triangle'; h2.type = 'sine';
        osc.frequency.setValueAtTime(f, now); h2.frequency.setValueAtTime(f * 2, now);
        const g2 = ctx.createGain(); g2.gain.value = 0.25;
        const filt = ctx.createBiquadFilter(); filt.type = 'lowpass';
        filt.frequency.setValueAtTime(Math.min(5500, f * 8), now);
        filt.frequency.exponentialRampToValueAtTime(Math.max(450, f * 2.2), now + 1.1);
        osc.connect(filt); h2.connect(g2); g2.connect(filt); filt.connect(env);
        const decay = Math.max(0.9, d + 0.8);
        env.gain.setValueAtTime(0.0001, now);
        env.gain.linearRampToValueAtTime(v * 0.95, now + 0.008);
        env.gain.exponentialRampToValueAtTime(0.0001, now + decay);
        osc.start(now); h2.start(now); track(osc, now + decay + 0.03); track(h2, now + decay + 0.03);
      } else if (effKind === 'bass') {
        const osc = ctx.createOscillator(), sub = ctx.createOscillator();
        osc.type = 'sawtooth'; sub.type = 'triangle';
        osc.frequency.setValueAtTime(f, now); sub.frequency.setValueAtTime(f, now);
        const filt = ctx.createBiquadFilter(); filt.type = 'lowpass';
        filt.frequency.setValueAtTime(Math.min(950, f * 5.0), now); filt.Q.value = 1.8;
        osc.connect(filt); sub.connect(filt); filt.connect(env);
        env.gain.setValueAtTime(0.0001, now);
        env.gain.linearRampToValueAtTime(v * 0.95, now + 0.055);
        env.gain.setValueAtTime(v * 0.85, now + Math.max(0.06, d - 0.02));
        env.gain.exponentialRampToValueAtTime(0.0001, now + d + 0.14);
        osc.start(now); sub.start(now); track(osc, now + d + 0.16); track(sub, now + d + 0.16);
      } else if (effKind === 'marimba') {
        const osc = ctx.createOscillator(), h4 = ctx.createOscillator();
        osc.type = 'sine'; h4.type = 'sine';
        osc.frequency.setValueAtTime(f, now); h4.frequency.setValueAtTime(f * 4, now);
        const g4 = ctx.createGain(); g4.gain.setValueAtTime(0.32, now); g4.gain.exponentialRampToValueAtTime(0.001, now + 0.07);
        osc.connect(env); h4.connect(g4); g4.connect(env);
        const decay = Math.max(0.38, Math.min(0.9, 1.4 - (note[2] - 48) * 0.02));
        env.gain.setValueAtTime(0.0001, now);
        env.gain.linearRampToValueAtTime(v * 1.1, now + 0.005);
        env.gain.exponentialRampToValueAtTime(0.0001, now + decay);
        osc.start(now); h4.start(now); track(osc, now + decay + 0.02); track(h4, now + 0.09);
      } else {
        // Timpani: pitched kettle fundamental + 1.5x overtone + quick pitch drop
        const osc = ctx.createOscillator(), ov = ctx.createOscillator();
        osc.type = 'sine'; ov.type = 'triangle';
        osc.frequency.setValueAtTime(f * 1.04, now); osc.frequency.exponentialRampToValueAtTime(f, now + 0.055);
        ov.frequency.setValueAtTime(f * 1.5, now);
        const go = ctx.createGain(); go.gain.setValueAtTime(0.35, now); go.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
        osc.connect(env); ov.connect(go); go.connect(env);
        const decay = Math.max(0.85, d + 0.6);
        env.gain.setValueAtTime(0.0001, now);
        env.gain.linearRampToValueAtTime(v * 1.35, now + 0.006);
        env.gain.exponentialRampToValueAtTime(0.0001, now + decay);
        osc.start(now); ov.start(now); track(osc, now + decay + 0.03); track(ov, now + 0.30);
      }
    }

    return {
      master,
      startNote,
      setVolume(x) { master.gain.setTargetAtTime(x * 0.75, ctx.currentTime, 0.03); },
      stopAll() { const now = ctx.currentTime; for (const n of active) { try { n.stop(now + 0.01); } catch {} } active.clear(); },
    };
  }
  return { createVoice };
})();

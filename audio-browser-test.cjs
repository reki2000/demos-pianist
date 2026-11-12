'use strict';
// Local Web Audio regression: requires Playwright and its Chromium, or CHROME.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}),
    headless: true, args: ['--no-sandbox'],
  });
  try {
    const page = await browser.newPage();
    for (const file of ['pedal', 'audio-manifest', 'audio'])
      await page.addScriptTag({ content: fs.readFileSync(`${__dirname}/dist/${file}.js`, 'utf8') });
    const results = await page.evaluate(async () => {
      const results = [], sr = 44100, fadeAt = .2;
      for (const fallback of [false, true]) for (const reason of ['repeat', 'polyphony']) for (const speed of [.5, 1, 2]) {
        const ctx = new OfflineAudioContext(1, sr, sr), engine = PianoAudio.create(ctx);
        engine.master.disconnect();
        // Silent sample sources; a constant signal exposes the actual gain
        // automation directly, without piano harmonics or compressor masking.
        const silence = ctx.createBuffer(1, 3 * sr, sr);
        for (const id of Object.keys(PIANO_AUDIO_MANIFEST.assets)) engine.buffers.set(id, silence);
        const song = { notes: [], pedals: [[0, 25]], duration: 4 };
        const first = engine.startNote(song, [0, .02 * speed, 60, 90, 0], 0, speed);
        if (fallback) first.gain.gain.cancelAndHoldAtTime = undefined;
        first.gain.disconnect(); first.gain.connect(ctx.destination);
        const constant = ctx.createConstantSource(); constant.connect(first.gain); constant.start(0);
        if (reason === 'repeat') {
          for (const t of [.1, fadeAt]) engine.startNote(song, [t * speed, .02 * speed, 60, 90, 0], t, speed);
        } else {
          // 128 live voices, then a new pitch steals the quietest (first) one.
          for (let i = 0; i < 127; i++) engine.startNote(song, [.1 * speed, 1, 61, 127, 0], .1, speed);
          engine.startNote(song, [fadeAt * speed, 1, 62, 127, 0], fadeAt, speed);
        }
        const data = (await ctx.startRendering()).getChannelData(0);
        let maxError = 0;
        const heldLevel = first.amp * PianoPedal.levelAt(first.profile, fadeAt * speed);
        for (let i = Math.ceil(.003 * sr); i <= Math.floor(.24 * sr); i++) {
          const t = i / sr, expected = t < fadeAt
            ? first.amp * PianoPedal.levelAt(first.profile, t * speed)
            : heldLevel * Math.max(0, 1 - (t - fadeAt) / .04);
          maxError = Math.max(maxError, Math.abs(data[i] - expected));
        }
        results.push({ fallback, reason, speed, maxError,
          jump: Math.abs(data[Math.round(fadeAt * sr)] - data[Math.round(fadeAt * sr) - 1]),
          stopped: data[Math.round(.25 * sr)] === 0, stopAt: first.stopAt,
          firstVoiceEnded: !engine.voices.has(first) });
      }
      return results;
    });
    for (const r of results) {
      const label = JSON.stringify(r);
      assert(r.maxError < .0001, 'Decay changed before fade: ' + label);
      assert(r.jump < .001, 'Discontinuous voice fade: ' + label);
      assert(r.stopped && Math.abs(r.stopAt - .245) < 1e-8, 'Voice did not stop: ' + label);
      assert(r.firstVoiceEnded, 'Ended voice retained: ' + label);
    }
    for (const name of ['guitar', 'violin', 'cello'])
      await page.addScriptTag({ content: fs.readFileSync(`${__dirname}/dist/instruments/${name}-audio.js`, 'utf8') });
    const stringLifetimes = await page.evaluate(async () => {
      const report = [];
      for (const name of ['guitar', 'violin', 'cello']) {
        const ctx = new OfflineAudioContext(2, 5 * 16000, 16000), nodes = [];
        for (const method of ['createGain', 'createBiquadFilter', 'createWaveShaper', 'createDynamicsCompressor', 'createOscillator', 'createBufferSource']) {
          const create = ctx[method].bind(ctx);
          ctx[method] = (...args) => {
            const node = create(...args), record = { disconnected: false }, disconnect = node.disconnect.bind(node);
            node.disconnect = (...args) => { record.disconnected = true; return disconnect(...args); };
            nodes.push(record); return node;
          };
        }
        const api = window[name[0].toUpperCase() + name.slice(1) + 'Audio'];
        const engine = api.createVoice(ctx), shared = nodes.length;
        for (let i = 0; i < 600; i++) {
          const when = i * .003;
          if (name === 'guitar') engine.startNote({ pitch: 60, velocity: 90, string: 1 }, when);
          else if (name === 'violin') engine.startNote({}, [when, i % 2 ? .1 : .6, 60, 90, 0], when);
          else engine.noteOn({ pitch: 60, velocity: 90, time: when, duration: .1 });
        }
        await ctx.startRendering();
        report.push({ instrument: name, activeVoices: engine.stats.activeVoices,
          activePitches: engine.stats.activePitches ?? 0,
          history: engine.stats.attacks?.length ?? 0,
          graphsDisconnected: nodes.slice(shared).every(n => n.disconnected) });
      }
      return report;
    });
    for (const r of stringLifetimes) {
      assert.equal(r.activeVoices, 0, JSON.stringify(r));
      assert.equal(r.activePitches, 0, JSON.stringify(r));
      assert(r.history <= 512 && r.graphsDisconnected, JSON.stringify(r));
    }
    console.log(JSON.stringify({ continuousVoiceFades: true, cases: results, stringLifetimes }, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

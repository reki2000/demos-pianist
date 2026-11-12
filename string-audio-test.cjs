'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const c = { window: {} }; vm.createContext(c);
for (const name of ['guitar', 'violin', 'cello']) vm.runInContext(fs.readFileSync(`dist/instruments/${name}-audio.js`, 'utf8'), c);
function context() {
  const nodes = [];
  const param = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, cancelScheduledValues() {}, setTargetAtTime() {} });
  function node(source = false) {
    const n = { source, ended: false, connections: [], stops: 0,
      gain: param(), frequency: param(), detune: param(), Q: param(), threshold: param(), knee: param(), ratio: param(), attack: param(), release: param(),
      connect(to) { this.connections.push(to); }, disconnect() { this.connections = []; },
      start() {}, stop() { this.stops++; },
      end() { if (!this.ended) { this.ended = true; this.onended?.(); } },
    }; nodes.push(n); return n;
  }
  return { nodes, currentTime: 0, sampleRate: 8000, destination: {},
    createGain: () => node(), createDynamicsCompressor: () => node(), createBiquadFilter: () => node(), createWaveShaper: () => node(),
    createOscillator: () => node(true), createBufferSource: () => node(true),
    createBuffer(ch, length, sr) { const channels = Array.from({ length: ch }, () => new Float32Array(length)); return { duration: length / sr, getChannelData: i => channels[i] }; },
  };
}
const report = [];
for (const instrument of ['guitar', 'violin', 'cello']) {
  const ctx = context(), api = c.window[instrument[0].toUpperCase() + instrument.slice(1) + 'Audio'];
  const engine = api.createVoice(ctx), sharedCount = ctx.nodes.length;
  const start = i => instrument === 'guitar'
    ? engine.startNote({ pitch: 60, velocity: 90, string: 1 }, i)
    : instrument === 'violin'
      ? engine.startNote({}, [i, i % 2 ? .1 : 1, 60, 90, 0], i)
      : engine.noteOn({ pitch: 60, velocity: 90, time: i, duration: .1 });
  const stop = () => instrument === 'cello' ? engine.allNotesOff() : engine.stopAll();
  for (let i = 0; i < 600; i++) {
    const before = ctx.nodes.length; start(i);
    assert.equal(engine.stats.activeVoices, 1, `${instrument}: old notes retained`);
    const noteNodes = ctx.nodes.slice(before), sources = noteNodes.filter(n => n.source);
    sources[0].end();
    if (sources.length > 1) assert.equal(engine.stats.activeVoices, 1, `${instrument}: cleaned before all sources ended`);
    for (const source of sources.slice(1)) source.end();
    assert.equal(engine.stats.activeVoices, 0, `${instrument}: ended voice retained`);
    assert(noteNodes.every(n => n.connections.length === 0), `${instrument}: ended graph connected`);
  }
  if (engine.stats.attacks) assert.equal(engine.stats.attacks.length, 512, 'Debug history grew without bound');
  if (instrument === 'cello') assert.equal(engine.stats.activePitches, 0);
  // Early stopping still leaves callbacks responsible for disconnecting nodes.
  for (let i = 0; i < 20; i++) start(i);
  ctx.currentTime = .01; stop();
  for (const n of ctx.nodes) if (n.source) n.end();
  assert.equal(engine.stats.activeVoices, 0);
  if (instrument === 'cello') assert.equal(engine.stats.activePitches, 0);
  assert(ctx.nodes.slice(sharedCount).every(n => n.connections.length === 0), `${instrument}: stopped graph connected`);
  report.push({ instrument, naturalEnds: 600, earlyStops: 20, retainedVoices: engine.stats.activeVoices, graphsDisconnected: true, boundedHistory: true });
}
console.log(JSON.stringify(report));

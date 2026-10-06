// Minimal Standard MIDI File reader shared by the song build scripts.
// Returns note events in beats (quarter notes) plus the tempo, time and key
// signature maps, so callers can re-time the music before converting to seconds.
'use strict';
function readMidi(bytes) {
  const b = Buffer.from(bytes);
  if (b.toString('latin1', 0, 4) !== 'MThd') throw new Error('Not a MIDI file');
  const ntr = b.readUInt16BE(10), ppq = b.readUInt16BE(12);
  if (ppq & 0x8000) throw new Error('SMPTE time division is not supported');
  let pos = 8 + b.readUInt32BE(4);
  const tracks = [], tempos = [], timeSignatures = [], keySignatures = [], pedals = [];
  for (let tr = 0; tr < ntr; tr++) {
    if (b.toString('latin1', pos, pos + 4) !== 'MTrk') throw new Error('Bad track header');
    const end = pos + 8 + b.readUInt32BE(pos + 4);
    let p = pos + 8, tick = 0, running = 0, name = '';
    const active = new Map(), notes = [];
    const vlq = () => { let v = 0, c; do { c = b[p++]; v = (v << 7) | (c & 127); } while (c & 128); return v; };
    while (p < end) {
      tick += vlq();
      let status = b[p];
      if (status & 128) p++; else status = running;
      if (status === 0xff) {
        const kind = b[p++], n = vlq(), data = b.subarray(p, p + n); p += n;
        if (kind === 0x51) tempos.push({ tick, usPerQuarter: data.readUIntBE(0, 3) });
        else if (kind === 0x58) timeSignatures.push({ tick, numerator: data[0], denominator: 2 ** data[1] });
        else if (kind === 0x59) keySignatures.push({ tick, fifths: data.readInt8(0), minor: data[1] });
        else if (kind === 0x03) name = data.toString('latin1');
        continue;
      }
      if (status === 0xf0 || status === 0xf7) { p += vlq(); continue; }
      running = status;
      const kind = status >> 4, ch = status & 15, a = b[p++], d = kind === 12 || kind === 13 ? 0 : b[p++];
      const key = ch * 128 + a;
      if (kind === 9 && d > 0) {
        if (active.has(key)) { const s = active.get(key); notes.push({ tick: s.tick, ticks: tick - s.tick, pitch: a, velocity: s.velocity, channel: ch }); }
        active.set(key, { tick, velocity: d });
      } else if ((kind === 8 || kind === 9) && active.has(key)) {
        const s = active.get(key); active.delete(key);
        notes.push({ tick: s.tick, ticks: tick - s.tick, pitch: a, velocity: s.velocity, channel: ch });
      } else if (kind === 11 && a === 64) pedals.push({ tick, value: d });
    }
    tracks.push({ name, notes });
    pos = end;
  }
  const beat = (tick) => tick / ppq;
  const uniq = (list, key) => [...new Map(list.sort((x, y) => x.tick - y.tick).map((e) => [e.tick, e])).values()].map(key);
  return {
    ppq,
    tracks: tracks.map((t) => ({ name: t.name, notes: t.notes.map((n) => ({ beat: beat(n.tick), length: beat(n.ticks), pitch: n.pitch, velocity: n.velocity, channel: n.channel })).sort((x, y) => x.beat - y.beat || x.pitch - y.pitch) })),
    tempos: uniq(tempos.length ? tempos : [{ tick: 0, usPerQuarter: 500000 }], (e) => ({ beat: beat(e.tick), bpm: 60e6 / e.usPerQuarter })),
    timeSignatures: uniq(timeSignatures.length ? timeSignatures : [{ tick: 0, numerator: 4, denominator: 4 }], (e) => ({ beat: beat(e.tick), numerator: e.numerator, denominator: e.denominator })),
    keySignatures: uniq(keySignatures.length ? keySignatures : [{ tick: 0, fifths: 0, minor: 0 }], (e) => ({ beat: beat(e.tick), fifths: e.fifths, minor: e.minor })),
    pedals: pedals.sort((x, y) => x.tick - y.tick).map((e) => ({ beat: beat(e.tick), value: e.value })),
  };
}
module.exports = { readMidi };

// Builds the extra repertoire into dist/songs.js and re-plans fingering/motion.
//   node add-songs.cjs            add or rebuild the pieces listed in CATALOG
//   node add-songs.cjs --replan   also re-plan every existing piece with dist/motion.js
// Sources are the raw-*.b64 MIDI files next to this script, except for the
// arrangements written out below (arrangements.cjs).
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path');
const { readMidi } = require('./midi.cjs');
const arrangements = require('./arrangements.cjs');
const root = __dirname;
global.window = global;
vm.runInThisContext(fs.readFileSync(path.join(root, 'dist/songs.js'), 'utf8'));
vm.runInThisContext(fs.readFileSync(path.join(root, 'dist/motion.js'), 'utf8'));

// performed: piano-midi.de recordings that already carry timing, dynamics and pedal.
// score: engraved public-domain scores (Mutopia) that are given dynamics, pedal and
// a closing ritardando here. arrangement: written for this project (arrangements.cjs).
const CATALOG = [
  { id: 'entertainer', title: 'The Entertainer', composer: 'Joplin', opus: 'Ragtime two-step, 1902', kind: 'score', file: 'raw-entertainer.b64', bpm: 76, style: 'rag' },
  { id: 'maple', title: 'Maple Leaf Rag', composer: 'Joplin', opus: 'Ragtime, 1899', kind: 'score', file: 'raw-maple.b64', bpm: 88, style: 'rag' },
  { id: 'saints', title: 'When the Saints Go Marching In', composer: 'Traditional', opus: 'Swing arrangement', kind: 'arrangement', arrange: 'saints' },
  { id: 'grace', title: 'Amazing Grace', composer: 'Traditional', opus: 'Hymn tune New Britain', kind: 'arrangement', arrange: 'grace', file: 'raw-grace.b64' },
  { id: 'gymnopedie', title: 'Gymnopédie No. 1', composer: 'Satie', opus: 'Lent et douloureux, 1888', kind: 'score', file: 'raw-gymnopedie.b64', bpm: 70, style: 'lent' },
  { id: 'traumerei', title: 'Träumerei', composer: 'Schumann', opus: 'Op.15 No.7', kind: 'performed', file: 'raw-traumerei.b64' },
  { id: 'liebestraum', title: 'Liebestraum No. 3', composer: 'Liszt', opus: 'S.541', kind: 'performed', file: 'raw-liebestraum.b64' },
  { id: 'cakewalk', title: "Golliwogg's Cakewalk", composer: 'Debussy', opus: "Children's Corner", kind: 'performed', file: 'raw-cakewalk.b64' },
];

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function random(seed) {
  let s = [...seed].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261) >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function midiFile(file) { return readMidi(Buffer.from(fs.readFileSync(path.join(root, file), 'utf8'), 'base64')); }

// Converts beats to seconds through a tempo map and an optional expressive factor.
function timeline(tempos, factor = () => 1, lastBeat) {
  const step = 1 / 8, marks = [{ beat: 0, time: 0 }];
  const bpmAt = (beat) => { let bpm = tempos[0].bpm; for (const t of tempos) if (t.beat <= beat) bpm = t.bpm; return bpm * factor(beat); };
  for (let b = 0; b <= lastBeat + 8; b += step) marks.push({ beat: b + step, time: marks.at(-1).time + (step * 60) / bpmAt(b + step / 2) });
  const sec = (beat) => { const i = clamp(Math.floor(beat / step), 0, marks.length - 2), a = marks[i], b = marks[i + 1]; return a.time + ((beat - a.beat) * (b.time - a.time)) / step; };
  const scoreTempos = [];
  for (let i = 0; i + 1 < marks.length; i++) {
    const bpm = (step * 60) / (marks[i + 1].time - marks[i].time);
    if (!scoreTempos.length || Math.abs(scoreTempos.at(-1).bpm - bpm) > 1e-6) scoreTempos.push({ time: marks[i].time, beat: marks[i].beat, bpm });
  }
  return { sec, scoreTempos };
}

// Pedal changes with each new bass note: up just before it, down just after it.
function bassPedal(events, sec, { lift = 0.012, catchAfter = 0.07, bassBelow = 56, beats } = {}) {
  const bass = beats || [...new Set(events.filter((e) => e.hand === 1 && e.pitch < bassBelow).map((e) => e.beat))].sort((a, b) => a - b), pedals = [];
  for (const beat of bass) { const t = sec(beat); if (pedals.length) pedals.push([Math.max(pedals.at(-1)[0] + 0.02, t - lift), 0]); pedals.push([t + catchAfter, 127]); }
  if (pedals.length) { const end = Math.max(...events.map((e) => sec(e.beat + e.length))); pedals.push([end + 0.4, 0]); }
  return pedals;
}

// Dynamics for engraved scores: metric weight, melody over inner voices, phrase swell.
function voice(events, { base, barBeats, seed, accentAbove = 100, swell = 5 }) {
  const rnd = random(seed), groups = new Map();
  for (const e of events) { const k = e.hand + ':' + e.beat; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(e); }
  for (const g of groups.values()) {
    g.sort((a, b) => a.pitch - b.pitch);
    const beat = g[0].beat, inBar = ((beat % barBeats) + barBeats) % barBeats, bar = Math.floor(beat / barBeats);
    const metric = inBar < 1e-6 ? 8 : Math.abs(inBar - Math.round(inBar)) < 1e-6 ? 3 : -2, phrase = swell * Math.sin((Math.PI * (bar % 8)) / 8), jitter = (rnd() - 0.5) * 6;
    g.forEach((e, i) => {
      const top = i === g.length - 1, low = i === 0;
      const role = e.hand === 0 ? (top ? 9 : -6) : low ? 2 : -9;
      e.velocity = Math.round(clamp(base + metric + phrase + role + jitter + (e.velocity > accentAbove ? 8 : 0), 22, 116));
    });
  }
}

function fromScore(entry) {
  const m = midiFile(entry.file), barBeats = (m.timeSignatures[0].numerator * 4) / m.timeSignatures[0].denominator;
  let events = [];
  m.tracks.filter((t) => t.notes.length).forEach((t, i) => { for (const n of t.notes) events.push({ ...n, hand: i ? 1 : 0 }); });
  const lastBeat = Math.max(...events.map((e) => e.beat + e.length));
  const styles = { rag: { base: 66, legato: 0.9, chord: 0.62 }, lent: { base: 48, legato: 1.0, chord: 1.0 } }, st = styles[entry.style];
  voice(events, { base: st.base, barBeats, seed: entry.id, swell: entry.style === 'lent' ? 7 : 4 });
  for (const e of events) {
    // Offbeat accompaniment chords in a rag are short; melody is nearly legato.
    const offbeatChord = entry.style === 'rag' && e.hand === 1 && e.pitch >= 52 && e.length <= 0.5;
    e.length *= offbeatChord ? st.chord : st.legato;
  }
  // Steady tempo, a breath at phrase ends for slow pieces, and a closing ritardando.
  const factor = (b) => {
    let f = 1;
    if (entry.style === 'lent') { const inPhrase = (b % (barBeats * 4)) / (barBeats * 4); f *= 1 - 0.07 * Math.max(0, inPhrase - 0.82) / 0.18; }
    const fromEnd = lastBeat - b;
    if (fromEnd < barBeats * 2) f *= 0.68 + 0.32 * (fromEnd / (barBeats * 2));
    return f;
  };
  const tempos = [{ beat: 0, bpm: entry.bpm }], tl = timeline(tempos, factor, lastBeat), rnd = random(entry.id + ':time');
  const onset = new Map();
  for (const e of events) { const k = e.hand + ':' + e.beat; if (!onset.has(k)) onset.set(k, (rnd() - 0.5) * 0.008); }
  const notes = events.map((e) => { const t = Math.max(0, tl.sec(e.beat) + onset.get(e.hand + ':' + e.beat)); return [t, Math.max(0.05, tl.sec(e.beat + e.length) - tl.sec(e.beat)), e.pitch, e.velocity, e.hand]; });
  return { notes, pedals: bassPedal(events, tl.sec, entry.style === 'rag' ? { catchAfter: 0.05, bassBelow: 50 } : {}), scoreMetadata: { tempos: tl.scoreTempos, timeSignatures: m.timeSignatures, keySignatures: m.keySignatures } };
}

function fromPerformance(entry) {
  const m = midiFile(entry.file);
  // Exact tempo map of the recording, as used by the score display.
  let time = 0, prev = m.tempos[0], tempos = [{ time: 0, beat: 0, bpm: prev.bpm }];
  for (const t of m.tempos.slice(1)) { time += ((t.beat - prev.beat) * 60) / prev.bpm; tempos.push({ time, beat: t.beat, bpm: t.bpm }); prev = t; }
  const sec = (beat) => { let p = tempos[0]; for (const t of tempos) { if (t.beat > beat) break; p = t; } return p.time + ((beat - p.beat) * 60) / p.bpm; };
  const notes = [];
  m.tracks.forEach((t) => { const left = /left/i.test(t.name); for (const n of t.notes) notes.push([sec(n.beat), Math.max(0.02, sec(n.beat + n.length) - sec(n.beat)), n.pitch, n.velocity, left ? 1 : 0]); });
  return { notes, pedals: m.pedals.map((p) => [sec(p.beat), p.value]), scoreMetadata: { tempos, timeSignatures: m.timeSignatures, keySignatures: m.keySignatures } };
}

function fromArrangement(entry) {
  const a = arrangements[entry.arrange](entry.file ? midiFile(entry.file) : null);
  const lastBeat = Math.max(...a.events.map((e) => e.beat + e.length)), tl = timeline(a.tempos, a.factor || (() => 1), lastBeat), rnd = random(entry.id + ':time');
  const onset = new Map();
  for (const e of a.events) { const k = e.hand + ':' + e.beat; if (!onset.has(k)) onset.set(k, (rnd() - 0.5) * 0.008); }
  const notes = a.events.map((e) => [Math.max(0, tl.sec(e.beat) + onset.get(e.hand + ':' + e.beat)), Math.max(0.05, tl.sec(e.beat + e.length) - tl.sec(e.beat)), e.pitch, e.velocity, e.hand]);
  return { notes, pedals: bassPedal(a.events, tl.sec, a.pedal), scoreMetadata: { tempos: tl.scoreTempos, timeSignatures: a.timeSignatures, keySignatures: a.keySignatures } };
}

function round(song) {
  // One key cannot sound twice at once: unison doublings between voices merge.
  const seen = new Map();
  for (const n of song.notes) { const k = n[2] + ':' + Math.round(n[0] * 200), o = seen.get(k); if (!o) seen.set(k, n); else { o[1] = Math.max(o[1], n[1]); o[3] = Math.max(o[3], n[3]); } }
  song.notes = [...seen.values()];
  song.notes = song.notes.map((n) => [Math.round(n[0] * 1e5) / 1e5, Math.round(n[1] * 1e5) / 1e5, n[2], n[3], n[4]]).sort((a, b) => a[0] - b[0] || a[2] - b[2]);
  song.pedals.sort((a, b) => a[0] - b[0]);
  song.duration = Math.round((Math.max(...song.notes.map((n) => n[0] + n[1])) + 2) * 1000) / 1000;
  song.sourceNoteCount = song.notes.length;
  return song;
}

const replan = process.argv.includes('--replan'), only = process.argv.filter((a) => !a.startsWith('--')).slice(2);
const songs = window.SONGS.filter((s) => !CATALOG.some((c) => c.id === s.id));
if (replan)
  for (const s of songs) {
    if (only.length && !only.includes(s.id)) continue;
    const started = Date.now();
    delete s.motion;
    // Keep the performed timing and hand split; choose fingers and motion again.
    s.originalNotes = s.notes.map((n) => n.slice(0, 5));
    s.notes = s.originalNotes.map((n) => n.slice());
    PianoMotion.build(s);
    delete s.originalNotes;
    console.log(s.id, s.notes.length, 'notes', ((Date.now() - started) / 1000).toFixed(1) + 's', JSON.stringify(s.motion.sharedPositions));
  }
for (const entry of CATALOG) {
  const old = window.SONGS.find((s) => s.id === entry.id);
  if (old && only.length && !only.includes(entry.id)) { songs.push(old); continue; }
  const started = Date.now();
  const made = entry.kind === 'performed' ? fromPerformance(entry) : entry.kind === 'score' ? fromScore(entry) : fromArrangement(entry);
  const song = round({ id: entry.id, title: entry.title, composer: entry.composer, opus: entry.opus, ...made });
  PianoMotion.build(song);
  delete song.originalNotes;
  // Keys of the stored object follow the existing pieces.
  const ordered = { id: song.id, title: song.title, composer: song.composer, opus: song.opus, notes: song.notes, pedals: song.pedals, duration: song.duration, reassignedNotes: song.reassignedNotes, rolledAttacks: song.rolledAttacks, sourceNoteCount: song.sourceNoteCount, scoreMetadata: song.scoreMetadata, motion: song.motion };
  songs.push(ordered);
  console.log(entry.id, song.notes.length, 'notes', song.duration + 's', ((Date.now() - started) / 1000).toFixed(1) + 's', JSON.stringify(song.motion.sharedPositions));
}
fs.writeFileSync(path.join(root, 'dist/songs.js'), 'window.SONGS=' + JSON.stringify(songs) + ';');

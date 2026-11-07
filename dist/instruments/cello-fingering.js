'use strict';
/* Cello fingering + bowing engine.
 *
 * Assigns every note a string, a hand position and a finger, and a bow
 * stroke (direction + bow travel), following the standard cello system:
 *
 * Strings (index 0..3): C2 G2 D3 A3 = MIDI 36, 43, 50, 57. A note's
 * "semitone" k on a string is pitch - openPitch; its stopping point is
 * SCALE * (1 - 2^(-k/12)) mm from the nut, SCALE = 690 mm.
 *
 * NECK POSITIONS. A position is named by its base b, the semitone of the
 * 1st finger above the open string. Fingers are semitone-spaced:
 *   finger 1,2,3,4 -> b, b+1, b+2, b+3.
 *   b=1 half position, b=2 1st, b=3/b=4 2nd, b=5 3rd, b=6 3rd (high form),
 *   b=7 4th. The thumb stays behind the neck.
 * Extensions (documented variants, flagged on the note):
 *   back: the 1st finger reaches back to b-1 (from b >= 2).
 *   fwd:  fingers 2,3,4 each reach one semitone further:
 *         offsets {1:0, 2:2, 3:3, 4:4} from b.
 *
 * THUMB POSITION (high register, roughly from the octave harmonic up).
 * The thumb lies across the strings as a movable nut at semitone t and
 * itself stops the string at t. Finger offsets from the thumb:
 *   1st +2, 2nd +3 (shape A) or +4 (shape B, chosen by context),
 *   3rd +5. There is no 4th finger in thumb position.
 *
 * Choice among feasible placements is by dynamic programming over the
 * note sequence: staying in position is free, shifting costs by anchor
 * distance plus a fixed event penalty, changing between neck and thumb
 * costs extra, string crossings cost a little, and open strings cost a
 * per-piece amount (cheap in Bach, where they are structural; costly in
 * The Swan, where a stopped string is preferred mid-phrase). Shifting
 * while an open string sounds is discounted, as in real playing.
 * Simultaneous notes are fingered jointly: strings ascend with pitch,
 * fingers must be distinct except for the thumb lying across two
 * strings in thumb position, or one finger stopping a fifth (same
 * semitone on adjacent strings) in a neck position.
 *
 * BOWING. Phrases break at gaps; strokes break at gaps and when a
 * stroke would exceed the piece's maxStrokeBeats. Directions alternate
 * stroke by stroke, the piece starts down-bow, and a long gap lets the
 * next phrase retake a down-bow. Within a stroke the bow travels a
 * fraction of its length proportional to the stroke's duration, frog
 * (0) to tip (1) on down-bows, tip to frog on up-bows, starting where
 * the previous stroke ended when there is room.
 *
 * plan(song, options) annotates and returns {notes, stats}; each note
 * result: {string, semitone, finger (0=open, 1-4, 'T'=thumb), mode
 * ('open'|'neck'|'thumb'), position (base b or thumb anchor t, or null),
 * positionName, ext (null|'back'|'fwd'), bow ('down'|'up'), bowFrom,
 * bowTo, stroke}. Input notes are [startSec, durSec, pitch, velocity].
 */
window.CelloFingering = (() => {
  const STRINGS = [36, 43, 50, 57];
  const STRING_NAMES = ['C', 'G', 'D', 'A'];
  const SCALE_MM = 690;
  const NECK_BASES = [1, 2, 3, 4, 5, 6, 7];
  const POSITION_NAMES = { 1: 'half', 2: '1st', 3: '2nd', 4: '2nd', 5: '3rd', 6: '3rd', 7: '4th' };
  const THUMB_ANCHORS = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
  const NECK_SHAPES = ['normal', 'fwd'];
  const THUMB_SHAPES = ['A', 'B'];

  const distFromNut = k => SCALE_MM * (1 - Math.pow(2, -k / 12));
  const semitoneOn = (pitch, s) => pitch - STRINGS[s];

  // All hand states the DP can be in. anchor = semitone that measures
  // shift distance between states (neck base or thumb anchor).
  const STATES = [];
  for (const b of NECK_BASES) for (const shape of NECK_SHAPES)
    STATES.push({ mode: 'neck', base: b, shape, anchor: b, id: `n${b}${shape === 'fwd' ? 'x' : ''}` });
  for (const t of THUMB_ANCHORS) for (const shape of THUMB_SHAPES)
    STATES.push({ mode: 'thumb', base: t, shape, anchor: t, id: `t${t}${shape}` });
  const OPEN = { mode: 'open', base: null, shape: null, anchor: null, id: 'open' };

  // Placements of one stopped note (semitone k) in one state; may be [].
  // Returns [{finger, ext}].
  function placementsIn(state, k) {
    const out = [];
    if (state.mode === 'neck') {
      const b = state.base, off = k - b;
      if (state.shape === 'normal') {
        if (off >= 0 && off <= 3) out.push({ finger: off + 1, ext: null });
        if (off === -1 && b >= 2) out.push({ finger: 1, ext: 'back' });
      } else { // fwd extension shape: offsets 0,2,3,4 for fingers 1..4
        const map = { 0: 1, 2: 2, 3: 3, 4: 4 };
        if (off in map) out.push({ finger: map[off], ext: off === 0 ? null : 'fwd' });
        if (off === -1 && b >= 2) out.push({ finger: 1, ext: 'back' });
      }
    } else if (state.mode === 'thumb') {
      if (k < 11) return out; // thumb position is for the high register
      const off = k - state.base;
      if (off === 0) out.push({ finger: 'T', ext: null });
      else if (off === 2) out.push({ finger: 1, ext: null });
      else if (off === 3 && state.shape === 'A') out.push({ finger: 2, ext: null });
      else if (off === 4 && state.shape === 'B') out.push({ finger: 2, ext: null });
      else if (off === 5) out.push({ finger: 3, ext: null });
    }
    return out;
  }

  // Candidate assignments for one onset group (1..4 notes sorted by
  // pitch) in one state. Returns [{assign:[{string,semitone,finger,ext}],
  // cost}] — feasibility enforced here.
  function groupCandidates(state, pitches) {
    // Per note: options across strings.
    const perNote = pitches.map(p => {
      const opts = [];
      for (let s = 0; s < 4; s++) {
        const k = semitoneOn(p, s);
        if (k < 0) continue;
        if (k === 0) { opts.push({ string: s, semitone: 0, finger: 0, ext: null, open: true }); continue; }
        for (const pl of placementsIn(state, k)) opts.push({ string: s, semitone: k, ...pl, open: false });
      }
      return opts;
    });
    if (perNote.some(o => !o.length)) return [];
    const out = [];
    const usedStrings = new Set(), assign = new Array(pitches.length);
    (function rec(i, lastString) {
      if (i === pitches.length) {
        // Finger feasibility across the group.
        let ok = true, extra = 0;
        for (let a = 0; a < assign.length && ok; a++) for (let b = a + 1; b < assign.length; b++) {
          const x = assign[a], y = assign[b];
          if (x.open || y.open || x.finger !== y.finger) continue;
          const adjacent = Math.abs(x.string - y.string) === 1;
          if (x.finger === 'T' && adjacent && x.semitone === y.semitone) { extra += 0.3; continue; }
          if (state.mode === 'neck' && adjacent && x.semitone === y.semitone) { extra += 0.35; continue; } // finger fifth
          ok = false;
        }
        if (ok) {
          let cost = extra;
          for (const a of assign) {
            if (a.ext) cost += 0.7;
            if (a.open) { cost += 0.05; continue; }
            // Prefer stopping a string close to the nut (smaller k): the
            // standard string/position choice follows from it. Thumb
            // position on a low-sounding note is penalized further —
            // it is a high-register technique, not a shortcut.
            cost += a.semitone * 0.05;
            if (state.mode === 'thumb') cost += Math.max(0, 66 - (STRINGS[a.string] + a.semitone)) * 0.45;
          }
          out.push({ assign: assign.map(a => ({ ...a })), cost });
        }
        return;
      }
      for (const o of perNote[i]) {
        if (o.string <= lastString || usedStrings.has(o.string)) continue;
        usedStrings.add(o.string); assign[i] = o;
        rec(i + 1, o.string);
        usedStrings.delete(o.string);
      }
    })(0, -1);
    out.sort((a, b) => a.cost - b.cost);
    return out.slice(0, 6);
  }

  function transitionCost(from, to, viaOpen) {
    if (!from || !to || from === to) return 0;
    if (from === OPEN || to === OPEN) return 0;
    let d = Math.abs(to.anchor - from.anchor);
    let c = 0.6 + d * 0.8;
    if (from.mode !== to.mode) c += 1.5;
    if (to.mode === 'thumb' && to.base !== 12) c += 0.2; // octave anchor is home
    return viaOpen ? c * 0.3 : c;
  }

  function plan(song, options = {}) {
    const openCost = options.openStringCost != null ? options.openStringCost : 0.1;
    const secPerBeat = options.secPerBeat || 0.5;
    const notes = song.notes.map((n, i) => ({ i, start: n[0], dur: n[1], pitch: n[2], vel: n[3] }));
    // Group by onset.
    const groups = [];
    for (const n of notes) {
      const g = groups[groups.length - 1];
      if (g && Math.abs(g.start - n.start) < 1e-4) g.notes.push(n); else groups.push({ start: n.start, notes: [n] });
    }
    for (const g of groups) g.notes.sort((a, b) => a.pitch - b.pitch);

    // DP over groups. A group's state is a hand state, or OPEN when the
    // whole group is open strings.
    const allStates = [...STATES, OPEN];
    let dp = new Map(); // stateId -> {cost, prevKey, groupAssign}
    const layers = [];
    groups.forEach((g, gi) => {
      const pitches = g.notes.map(n => n.pitch);
      const allOpen = pitches.every(p => STRINGS.includes(p));
      const layer = new Map();
      const candByState = new Map();
      for (const st of STATES) {
        const cands = groupCandidates(st, pitches);
        if (cands.length) candByState.set(st.id, { st, cand: cands[0] });
      }
      const consider = (stateObj, candCost) => {
        let best = null;
        if (gi === 0) best = { cost: candCost, prev: null };
        else for (const [pk, pv] of dp) {
          const prevState = pv.stateObj;
          const viaOpen = prevState === OPEN;
          let c = pv.cost + transitionCost(prevState === OPEN ? pv.lastHand : prevState, stateObj, viaOpen) + candCost;
          if (prevState === OPEN && pv.lastHand === stateObj) c = pv.cost + candCost; // hand never moved
          if (!best || c < best.cost) best = { cost: c, prev: pk };
        }
        if (best) layer.set(stateObj.id, { ...best, stateObj, groupIndex: gi });
      };
      for (const { st, cand } of candByState.values()) {
        // Prefer positions that keep the hand low: tiny tie-break cost.
        consider(st, cand.cost + st.anchor * 0.01);
      }
      if (allOpen) {
        // Whole group on open strings: hand may stay where it was.
        let best = null;
        if (gi === 0) best = { cost: openCost * pitches.length, prev: null };
        else for (const [pk, pv] of dp) {
          const c = pv.cost + openCost * pitches.length;
          if (!best || c < best.cost) best = { cost: c, prev: pk };
        }
        if (best) layer.set(OPEN.id, { ...best, stateObj: OPEN, groupIndex: gi, lastHand: null });
      }
      // Track, for OPEN entries, the last real hand state (for shift costs).
      if (gi > 0) for (const [k, v] of layer) {
        if (v.stateObj === OPEN) {
          const pv = dp.get(v.prev);
          v.lastHand = pv ? (pv.stateObj === OPEN ? pv.lastHand : pv.stateObj) : null;
        }
      }
      // Mixed groups (some open, some stopped) are already handled: the
      // open notes appear inside candByState assignments.
      layers.push(layer);
      dp = layer;
      if (!dp.size) throw new Error('No feasible fingering at onset ' + g.start);
    });

    // Backtrack.
    let key = null, bestCost = Infinity;
    for (const [k, v] of dp) if (v.cost < bestCost) { bestCost = v.cost; key = k; }
    const chosen = new Array(groups.length);
    for (let gi = groups.length - 1; gi >= 0; gi--) {
      const v = layers[gi].get(key);
      chosen[gi] = v;
      key = v.prev;
    }

    // Materialize per-note results.
    const results = new Array(notes.length);
    const stats = { notes: notes.length, open: 0, neck: 0, thumb: 0, extensions: 0, shifts: 0, groups: groups.length, strokes: 0 };
    let prevHand = null;
    groups.forEach((g, gi) => {
      const v = chosen[gi];
      const st = v.stateObj;
      if (st === OPEN) {
        g.notes.forEach((n, j) => {
          const s = STRINGS.indexOf(n.pitch);
          results[n.i] = { string: s, semitone: 0, finger: 0, mode: 'open', position: null, positionName: null, ext: null };
          stats.open++;
        });
        return;
      }
      const cand = groupCandidates(st, g.notes.map(n => n.pitch))[0];
      cand.assign.forEach((a, j) => {
        const n = g.notes[j];
        if (a.open) {
          results[n.i] = { string: a.string, semitone: 0, finger: 0, mode: 'open', position: null, positionName: null, ext: null };
          stats.open++;
        } else {
          results[n.i] = {
            string: a.string, semitone: a.semitone, finger: a.finger,
            mode: st.mode, position: st.base,
            positionName: st.mode === 'neck' ? POSITION_NAMES[st.base] : 'thumb',
            ext: a.ext
          };
          if (st.mode === 'neck') stats.neck++; else stats.thumb++;
          if (a.ext) stats.extensions++;
        }
      });
      if (prevHand && prevHand !== st) stats.shifts++;
      if (st !== OPEN) prevHand = st;
    });

    applyBowing(song, results, groups, { secPerBeat, maxStrokeBeats: options.maxStrokeBeats || 2 });
    stats.strokes = results.reduce((m, r) => Math.max(m, r.stroke + 1), 0);
    return { notes: results, stats };
  }

  function applyBowing(song, results, groups, { secPerBeat, maxStrokeBeats }) {
    const beat = t => t / secPerBeat;
    const FULL_BOW_SEC = 6; // seconds of sounding that spend a whole bow
    // Pass 1: segment groups into strokes, assign directions.
    const strokes = []; // {startBeat, durBeats, dir, groups:[]}
    let prevEnd = null;
    for (const g of groups) {
      const gStart = beat(g.start);
      const gDur = Math.max(...g.notes.map(n => beat(n.dur)));
      const gap = prevEnd == null ? Infinity : gStart - prevEnd;
      const cur = strokes[strokes.length - 1];
      const wouldExceed = cur && (gStart - cur.startBeat) + gDur > maxStrokeBeats && gStart > cur.startBeat;
      if (!cur || gap >= 0.5 || wouldExceed) {
        const retake = prevEnd == null || gap >= 2;
        const dir = !cur ? 'down' : retake ? 'down' : (cur.dir === 'down' ? 'up' : 'down');
        strokes.push({ startBeat: gStart, durBeats: gDur, dir, retake, groups: [g] });
      } else {
        cur.groups.push(g);
        cur.durBeats = Math.max(cur.durBeats, gStart - cur.startBeat + gDur);
      }
      prevEnd = Math.max(prevEnd == null ? 0 : prevEnd, gStart + gDur);
    }
    // Pass 2: walk the bow position through the strokes (frog=0, tip=1),
    // then interpolate each note's share of its stroke.
    let bowPos = 0.12;
    strokes.forEach((st, si) => {
      const travel = Math.min(0.9, Math.max(0.12, (st.durBeats * secPerBeat) / FULL_BOW_SEC));
      if (st.retake) bowPos = st.dir === 'down' ? Math.min(bowPos, 0.25) : Math.max(bowPos, 0.75);
      if (st.dir === 'down' && bowPos + travel > 1) bowPos = Math.max(0, 1 - travel);
      if (st.dir === 'up' && bowPos - travel < 0) bowPos = Math.min(1, travel);
      const start = bowPos, sgn = st.dir === 'down' ? 1 : -1;
      for (const g of st.groups) for (const n of g.notes) {
        const r = results[n.i];
        const f0 = (beat(n.start) - st.startBeat) / st.durBeats;
        const f1 = (beat(n.start) + beat(n.dur) - st.startBeat) / st.durBeats;
        r.bow = st.dir; r.stroke = si;
        r.bowFrom = start + sgn * travel * f0;
        r.bowTo = start + sgn * travel * f1;
      }
      bowPos = start + sgn * travel;
    });
  }

  return {
    STRINGS, STRING_NAMES, SCALE_MM, NECK_BASES, POSITION_NAMES, THUMB_ANCHORS,
    distFromNut, semitoneOn, placementsIn, plan,
    _states: STATES
  };
})();

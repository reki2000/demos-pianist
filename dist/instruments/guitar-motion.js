'use strict';
/* Guitar geometry + performer motion planning.
 *
 * Units are metres; the audience/camera sits toward -Z.
 *
 * HANDEDNESS: the host renderer (gl.js) mirrors X (its toWorld maps
 * planning [x,y,z] to world [-x,y,z], cameras included), so this
 * module builds the scene MIRRORED in planning X: the neck rises
 * toward planning +X and the fretting arm's shoulder sits at
 * planning +X, which the renderer flips to the player's anatomical
 * left on screen. Shoulders below are named for the ANATOMICAL hand
 * (shL frets, shR plucks), not for the planning side they sit on.
 *
 * The guitar is placed in the classical seated posture (Yepes):
 * body on the raised left leg, neck angled steeply up to the
 * player's left (~44 deg). Its frame is
 * built from the nut point N, the neck axis u (bridge -> headstock),
 * the across-strings axis w (string 1 side -> string 6 side) and the
 * fretboard normal n. Fret wire distance from the nut follows the
 * 650 mm scale: d(f) = L * (1 - 2^(-f/12)).
 *
 * plan(song) runs the fingering engine and turns it into events;
 * pose(plan, t) reconstructs the performer at time t: left-hand
 * fingers land on the exact string/fret points the engine chose
 * (just behind the fret wire), the hand slides between positions
 * using the whole gap (arriving ~180 ms early), free fingers keep a
 * natural light curl, and right-hand fingers pluck their assigned
 * string at the soundhole.
 */
window.GuitarMotion = (() => {
const clamp = (v, a, b) => Math.max(a, Math.min(b, v)), smooth = v => { v = clamp(v, 0, 1); return v * v * v * (v * (v * 6 - 15) + 10); };
const add = (a, b) => a.map((v, i) => v + b[i]), sub = (a, b) => a.map((v, i) => v - b[i]), mul = (a, s) => a.map(v => v * s), dot = (a, b) => a.reduce((r, v, i) => r + v * b[i], 0), unit = a => mul(a, 1 / (Math.hypot(...a) || 1));
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

const SCALE = 0.650;
const NUT = [0.454, 1.341, -0.376];
let u = unit([0.6291, 0.6946, -0.3488]); // neck rises steeply (44 deg elevation) toward planning +X = the player's anatomical left on screen, yawed 29 deg toward the audience so the headstock reaches forward-left (Yepes reference photos); pivoted at the waist so the seat on the left thigh is unchanged
/* w is built with the renderer's own segment-frame formula
 * (x = norm(cross([0,0,1], dir))) so a 'tail'-loft fretboard drawn
 * along -u lies exactly in the string plane: w across the strings
 * (string 1 side -> string 6 side), n = u x w out of the fretboard. */
let w = unit(cross([0, 0, 1], mul(u, -1)));
let n = unit(cross(u, w));
const fretDist = f => SCALE * (1 - Math.pow(2, -f / 12));
const NUT_SPACING = 0.0086, BRIDGE_SPACING = 0.0116; // per-string step across w
function stringPoint(string, d, lift = 0.005) {
  const frac = clamp(d / SCALE, 0, 1), step = NUT_SPACING + (BRIDGE_SPACING - NUT_SPACING) * frac;
  return add(add(NUT, mul(u, -d)), add(mul(w, (3.5 - string) * step), mul(n, lift))); // mirrored frame: string 6 on the -w (chin) edge, string 1 on the +w edge
}
const fretPoint = (string, fret, behind = 0.006, lift) => stringPoint(string, Math.max(0, fretDist(fret) - (fret ? behind : 0)), lift);
const PLUCK_D = SCALE - 0.115; // over the soundhole, 115 mm from the bridge
const pluckPoint = (string, lift = 0.006) => stringPoint(string, PLUCK_D, lift);
const bridgePoint = string => stringPoint(string, SCALE, 0.004);

/* Finger segment lengths (anatomical digits: thumb, index..little). */
const LENGTHS = [[.043, .032, .025], [.058, .034, .024], [.065, .040, .027], [.060, .037, .026], [.048, .028, .022]];
const REST_CURL = [0.5, 0.62, 0.68, 0.74, 0.8]; // PIP curl of a relaxed finger, thumb..little
/* Solve a 3-segment finger from base to target. Points are built from
 * angles (pianist's resultant construction), so segment lengths are
 * exact and the tip lands on the target whenever it is reachable.
 * extraCurl adds PIP bend (resting fingers), moving the tip off target. */
function resultant(ls, q) { return [ls[0] + ls[1] * Math.cos(q) + ls[2] * Math.cos(q * 1.65), -ls[1] * Math.sin(q) - ls[2] * Math.sin(q * 1.65)]; }
/* The finger bends in the plane spanned by (base->target) and bendHint:
 * e1 points at the target, e2 is the flexion direction inside that
 * plane. The 2D resultant construction then lands the tip exactly on
 * the target whenever the distance is within the finger's reach. */
function solveFinger(base, target, digit, bendHint, extraCurl = 0) {
  const ls = LENGTHS[digit];
  const v = sub(target, base), d = Math.hypot(...v);
  const maxD = ls[0] + ls[1] + ls[2] - 1e-6, minD = Math.hypot(...resultant(ls, 1.82));
  const reach = clamp(d, minD, maxD);
  let lo = 0, hi = 1.82;
  for (let i = 0; i < 18; i++) { const q = (lo + hi) / 2; if (Math.hypot(...resultant(ls, q)) > reach) lo = q; else hi = q; }
  const q = clamp((lo + hi) / 2 + extraCurl, 0, 1.82);
  const r = resultant(ls, q);
  const e1 = unit(v);
  let e2 = sub(bendHint, mul(e1, dot(bendHint, e1)));
  if (Math.hypot(...e2) < 1e-5) e2 = sub([0, -1, 0], mul(e1, -e1[1]));
  e2 = unit(e2);
  const ang = -Math.atan2(r[1], r[0]); // rotate the resultant onto e1
  const points = [base];
  for (let i = 0; i < 3; i++) {
    const a = ang - (i === 0 ? 0 : i === 1 ? q : q * 1.65);
    points.push(add(points[i], add(mul(e1, ls[i] * Math.cos(a)), mul(e2, ls[i] * Math.sin(a)))));
  }
  return { points, lengths: ls, angles: [ang, q, q * 0.65], error: Math.hypot(...sub(points[3], target)), target, contact: extraCurl === 0 };
}

function plan(song) {
  if (!song.fingering) window.GuitarFingering.build(song);
  const A = song.fingering.assignments, notes = song.notes;
  // Hand events come from the fingering engine's own grouping (same
  // strum window, same feasibility split) — one source of truth.
  const grouped = window.GuitarFingering.groupEvents(notes, window.GuitarFingering.windowOf(song), song.tuning || window.GuitarFingering.OPEN);
  const events = grouped.map(ev => ({ t: ev.t, notes: ev.notes.map(i => { const nn = notes[i], a = A[i];
    return { i, t: nn[0], end: nn[0] + nn[1], pitch: nn[2], vel: nn[3], string: a.string, fret: a.fret, lh: a.lh, barre: a.barre, rh: a.rh, pos: a.pos, sweep: !!a.sweep, brush: !!a.brush }; }) }));
  for (const ev of events) for (const nt of ev.notes) nt.ev = ev;
  // Per-LH-finger note lists (digits 1..4) and per-RH-finger lists.
  const lhByFinger = { 1: [], 2: [], 3: [], 4: [] }, rhByFinger = { p: [], i: [], m: [], a: [] };
  for (const ev of events) for (const nt of ev.notes) {
    if (nt.lh >= 1) lhByFinger[nt.lh].push(nt);
    rhByFinger[nt.rh].push(nt);
  }
  // String vibration: last pluck time per string.
  const plucks = []; for (const ev of events) for (const nt of ev.notes) plucks.push({ t: nt.t, string: nt.string, vel: nt.vel });
  // Sounding-pitch segments (sweep line over note starts/ends) so
  // pose().activeNotes is exact at any t, not just near an event.
  const crit = [...new Set(notes.flatMap(n => [n[0], n[0] + n[1]]))].sort((a, b) => a - b);
  const byEnd = notes.map(n => ({ end: n[0] + n[1], pitch: n[2] })).sort((a, b) => a.end - b.end);
  const sounding = new Map(); let si = 0, ei2 = 0;
  const segments = crit.map(ct => {
    while (si < notes.length && notes[si][0] <= ct) { sounding.set(notes[si][2], (sounding.get(notes[si][2]) || 0) + 1); si++; }
    while (ei2 < byEnd.length && byEnd[ei2].end <= ct) { const p = byEnd[ei2].pitch, c = (sounding.get(p) || 0) - 1; if (c <= 0) sounding.delete(p); else sounding.set(p, c); ei2++; }
    return { t: ct, pitches: [...sounding.keys()] };
  });
  return { song, events, lhByFinger, rhByFinger, plucks, segments, duration: song.duration };
}

function lowerBound(arr, t, key = 't') { let a = 0, b = arr.length; while (a < b) { const m = (a + b) >> 1; if (arr[m][key] < t) a = m + 1; else b = m; } return a; }
/* Hand anchor (distance from nut) at time t: the hand serves the current
 * event, then uses the gap to glide to the next position, arriving just
 * before the next onset. All-open events do not move the hand. */
/* Position keyframes for the palm anchor: (event time, fretDist of
 * the event's effective position), only where the value changes. */
function posKeys(plan) {
  if (plan._posKeys) return plan._posKeys;
  const posOf = ev => {
    const f = ev.notes.filter(x => x.fret > 0);
    if (!f.length) return -1;
    const p = ev.notes[0].pos;
    if (p > 0) {
      const lo = Math.min(...f.map(x => x.fret)), span = Math.max(...f.map(x => x.fret)) - lo;
      return span > 4 ? lo + (span - 4) / 2 : p;
    }
    return Math.max(1, Math.round(f.reduce((s2, x) => s2 + x.fret, 0) / f.length - 1));
  };
  const keys = [];
  for (const ev of plan.events) {
    const p = posOf(ev);
    if (p <= 0) continue;
    const d = fretDist(p);
    if (!keys.length || Math.abs(d - keys[keys.length - 1].d) > 1e-6) keys.push({ t: ev.t, d });
  }
  plan._posKeys = keys;
  return keys;
}
/* Hand anchor (distance from nut) at time t: glide between position
 * keyframes, arriving ~4 ms before each keyframe; the glide duration
 * scales with distance (max ~1.6 m/s along the neck) so the palm
 * never teleports, even between dense fallback-position events. */
function anchorAt(plan, t) {
  const keys = posKeys(plan);
  if (!keys.length) return fretDist(1);
  let k = -1;
  for (let i = 0; i < keys.length; i++) { if (keys[i].t <= t + 0.005) k = i; else break; }
  if (k < 0) return keys[0].d;
  const cur = keys[k], nxt = keys[k + 1];
  if (!nxt) return cur.d;
  const D = clamp(Math.abs(nxt.d - cur.d) / 1.6, 0.025, 0.22);
  const end = nxt.t - 0.004;
  let start = Math.max(cur.t - 0.004, end - D);
  if (start > end - 0.006) start = end - 0.006;
  if (t <= start) return cur.d;
  const s = smooth((t - start) / Math.max(1e-4, end - start));
  return cur.d + (nxt.d - cur.d) * s;
}

function pose(plan, t) {
  const { song, events } = plan;
  const anchorD = anchorAt(plan, t);
  const palm = add(add(NUT, mul(u, -anchorD)), add(mul(n, -0.034), mul(w, -0.006)));
  const lhFingers = [], lhTargets = [];
  const mixP = (a, b, s) => a.map((v, k) => v + (b[k] - v) * s);
  const REST_E = d => REST_CURL[d] * 0.55;
  /* A note's press point. A barre finger aims across the whole group it
   * covers in its event (tip past the far string), slightly flattened. */
  const notePoint = (nt, lift) => {
    if (nt.barre && nt.ev) {
      const far = Math.min(...nt.ev.notes.filter(x => x.lh === nt.lh && x.fret === nt.fret).map(x => x.string));
      return add(fretPoint(far, nt.fret, 0.002, lift), mul(w, 0.012)); // tip lands past the far string
    }
    return fretPoint(nt.string, nt.fret, 0.006, lift);
  };
  for (let digit = 1; digit <= 4; digit++) {
    /* Segment scheme per finger: HOLD the current note's press point,
     * TRAVEL to the next note over the gap (arcing off the board),
     * RELEASE to rest after the last note. Segment boundaries are
     * continuous by construction: travel starts and ends exactly on
     * the hold points, and the curl (extra) blends between the same
     * endpoint values the neighbouring segments use. */
    const list = plan.lhByFinger[digit];
    const ni = lowerBound(list, t + 1e-9);
    const A = ni > 0 ? list[ni - 1] : null;      // last started note
    const B = ni < list.length ? list[ni] : null; // next note
    const root = add(palm, add(mul(w, (digit - 1) * 0.0195 - 0.024), add(mul(n, -0.002), mul(u, -0.002 - (digit === 2 ? 0.003 : 0)))));
    const rest = add(palm, add(mul(w, (digit - 1) * 0.018 - 0.020), add(mul(n, 0.036), mul(u, -0.014))));
    const holdExtra = nt => nt ? (nt.barre ? -0.30 : 0) : REST_E(digit);
    let target = rest, extra = REST_E(digit), contact = false, barre = 0;
    if (A) {
      const pressRamp = smooth((t - (A.t - 0.035)) / 0.035);
      target = notePoint(A, 0.0042); extra = 0.25 + (holdExtra(A) - 0.25) * pressRamp; barre = A.barre;
      contact = t >= A.t - 0.005 && t <= A.end + 0.02;
    }
    // Travel window to B: starts after A has sounded (or 180 ms out
    // from rest), ends just before B's onset; at least 12 ms wide.
    let w0 = null, w1 = null;
    if (B) {
      w1 = B.t - 0.004;
      w0 = !A ? B.t - 0.18 : Math.max(A.t + 0.004, Math.min(A.end - 0.02, B.t - 0.05));
      if (w0 > w1 - 0.012) w0 = w1 - 0.012;
    }
    if (B && t >= w0) {
      const s = smooth((t - w0) / (w1 - w0));
      const from = A ? notePoint(A, 0.0042) : rest;
      target = mixP(from, notePoint(B, 0.0042), s);
      target = add(target, mul(n, Math.sin(Math.PI * s) * 0.006)); // arc off the board mid-travel
      extra = (A ? holdExtra(A) : REST_E(digit)) + (holdExtra(B) - (A ? holdExtra(A) : REST_E(digit))) * s;
      barre = s > 0.5 ? B.barre : barre; contact = false;
    } else if (A && t > A.end + 0.02) { // release toward rest
      const s = smooth((t - A.end - 0.02) / 0.12);
      target = mixP(notePoint(A, 0.0042), rest, s);
      extra = holdExtra(A) + (REST_E(digit) - holdExtra(A)) * s; contact = false;
    }
    const edgeHint = sub(stringPoint(6, anchorD, 0.0), root);
    const f = solveFinger(root, target, digit, edgeHint, extra);
    f.contact = contact && f.error < 0.006; f.digit = digit; f.barre = barre;
    lhFingers.push(f); lhTargets.push(target);
  }
  // Left thumb behind the neck, opposite the position.
  const thumbTarget = add(add(NUT, mul(u, -anchorD)), mul(n, -0.020));
  const thumbRoot = add(palm, add(mul(w, -0.020), mul(n, -0.010)));
  const thumb = solveFinger(thumbRoot, thumbTarget, 0, mul(w, 1), 0.3); thumb.digit = 0;
  // Right hand at the soundhole.
  const rhBase = add(stringPoint(3, PLUCK_D, 0.052), mul(w, 0.004));
  const rhDef = { p: { digit: 0, rootOff: [-0.046, -0.010, -0.014], rest: 5 }, i: { digit: 1, rootOff: [-0.010, 0.004, 0.006], rest: 3 }, m: { digit: 2, rootOff: [0.010, 0.006, 0.008], rest: 2 }, a: { digit: 3, rootOff: [0.028, 0.002, 0.006], rest: 1 } };
  const rhFingers = {};
  for (const name of ['p', 'i', 'm', 'a']) {
    const def = rhDef[name];
    const root = add(rhBase, add(mul(w, def.rootOff[0]), add(mul(n, def.rootOff[1]), mul(u, def.rootOff[2]))));
    const list = plan.rhByFinger[name];
    const ni = lowerBound(list, t + 1e-4);
    const cur = ni > 0 ? list[ni - 1] : null, nxt = ni < list.length ? list[ni] : null;
    let string = def.rest, env = 0;
    if (cur && t - cur.t < 0.10) { string = cur.string; env = Math.sin(Math.PI * clamp((t - cur.t + 0.012) / 0.085, 0, 1)); }
    else if (cur && t - cur.t < 0.35) string = cur.string;
    const lift = 0.011 - env * 0.009;
    let target = add(pluckPoint(string, lift), mul(u, -0.004 * env));
    if (cur && t - cur.t > 0.35 && string !== def.rest) { // fade the string memory out, never snap
      const s = smooth((t - cur.t - 0.35) / 0.2);
      target = target.map((v, k) => v + (pluckPoint(def.rest, 0.011)[k] - v) * s);
    }
    if (nxt && nxt.string !== string && nxt.t - t < 0.12) { // glide to the next string early
      const s = smooth((t - (nxt.t - 0.12)) / 0.11);
      target = target.map((v, k) => v + (pluckPoint(nxt.string, 0.008)[k] - v) * s);
    }
    const f = solveFinger(root, target, def.digit, name === 'p' ? add(mul(w, 0.6), mul(n, -0.4)) : add(mul(n, -1), mul(u, -0.35)), name === 'p' ? 0.25 : 0.35 - env * 0.3);
    f.contact = env > 0.45; f.digit = def.digit; f.string = string; f.env = env;
    rhFingers[name] = f;
  }
  // Arms: shoulders fixed to the torso, two-bone IK with exact lengths.
  const sway = 0.012 * Math.sin(t * 0.45), lean = 0.05 + 0.02 * Math.sin(t * 0.23 + 1.2);
  const shL = [0.205, 1.435 + sway * 0.3, -0.055], shR = [-0.205, 1.435 - sway * 0.3, -0.055]; // planning sides mirrored (see header): shL renders as the anatomical left shoulder
  const armIK = (S, W, out) => {
    const L1 = 0.315, L2 = 0.30, d = clamp(Math.hypot(...sub(W, S)), 0.1, L1 + L2 - 0.002);
    const dir = unit(sub(W, S));
    const a = Math.acos(clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1));
    const bend = unit(sub(out, mul(dir, dot(out, dir))));
    const E = add(add(S, mul(dir, L1 * Math.cos(a))), mul(bend, L1 * Math.sin(a)));
    return { shoulder: S, elbow: E, wrist: W, lengths: [L1, L2], error: Math.abs(Math.hypot(...sub(W, E)) - L2) };
  };
  const wristL = add(palm, mul(n, -0.012));
  const wristR = add(rhBase, add(mul(w, -0.016), mul(n, 0.014)));
  const arms = [armIK(shL, wristL, [1, -0.5, 0.25]), armIK(shR, wristR, [-1, -0.6, -0.1])];
  // String shimmer envelopes + active pitches.
  const vib = {};
  for (let s = 1; s <= 6; s++) vib[s] = 0;
  for (const p of plan.plucks) { if (p.t > t) break; const age = t - p.t; if (age < 0.5) vib[p.string] = Math.max(vib[p.string], (p.vel / 127) * Math.exp(-age * 10)); }
  const segi = lowerBound(plan.segments, t + 1e-9) - 1;
  const activeNotes = segi >= 0 ? plan.segments[segi].pitches : [];
  return { t, palm, anchorD, lhFingers, lhThumb: thumb, rhFingers, arms, vib, activeNotes, torso: { lean, sway, nod: 0 }, wristL, wristR };
}

return { SCALE, NUT, u, w, n, fretDist, stringPoint, fretPoint, pluckPoint, bridgePoint, PLUCK_D, LENGTHS, solveFinger, plan, pose, lowerBound };
})();

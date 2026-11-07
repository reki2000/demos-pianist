'use strict';
/* Violin performer motion: turns a song + fingering/bowing plan into a
 * per-frame performer state for ViolinModel.draw.
 *
 * Left hand: the hand's reference is the plan's position (finger 1's home
 * distance from the nut). Shifts are anticipated: the hand starts moving
 * up to ~180ms before the note that needs the new position and eases with
 * the same smootherstep the pianist uses. Fingers solve a 3-segment
 * planar IK to their exact contact points (string + distance from nut
 * from the plan); free fingers hover over their position-home spots with
 * a natural curl. Long notes get vibrato: the contact distance oscillates
 * a fraction of a millimetre-scale amount after a short delay, and the
 * whole hand rocks with it at reduced amplitude.
 *
 * Right arm / bow: the bow hair always passes through the played string's
 * contact point (48mm from the bridge). The bow translates along its own
 * axis; the position along the bow comes from the plan's bow track
 * (bowFrom/bowTo per note), so long notes travel far and short notes stay
 * local. String changes rotate the bow plane around the string axis and
 * blend over ~90ms just before the new note; the elbow follows.
 */
window.ViolinMotion = (() => {
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = v => { v = clamp(v, 0, 1); return v * v * v * (v * (v * 6 - 15) + 10); };
const mix = (a, b, u) => a + (b - a) * u;
const add = (a, b) => a.map((v, i) => v + b[i]);
const sub = (a, b) => a.map((v, i) => v - b[i]);
const mul = (a, s) => a.map(v => v * s);
const dot = (a, b) => a.reduce((r, v, i) => r + v * b[i], 0);
const unit = a => mul(a, 1 / (Math.hypot(...a) || 1));
const rotAxis = (v, axis, ang) => { // Rodrigues
  const c = Math.cos(ang), s = Math.sin(ang);
  return add(add(mul(v, c), mul(cross(axis, v), s)), mul(axis, dot(axis, v) * (1 - c)));
};
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

const FINGER_LENGTHS = [[.046, .028, .020], [.052, .032, .022], [.048, .030, .021], [.038, .024, .017]]; // fingers 1-4
const NOMINAL = [0, 2, 4, 5.5];               // hover semitone offset of fingers 1-4 inside a position
const SHIFT_LEAD = 0.18;                      // hand starts shifting this long before the target note
const VIB = { minDur: 0.55, delay: 0.22, ramp: 0.35, rate: 5.6, extentMm: 1.5 };
const BOW_LEN = 0.745;
const BOW_TILT = [-0.26, -0.09, 0.09, 0.26];  // bow-plane angle per string G D A E (rad about the string axis)
const A0 = unit([0.788, 0, 0.616]);           // bow axis at zero tilt (frog -> tip), perpendicular to U.
// Planning +X is the performer's anatomical LEFT (RecitalGL reflects X
// for display), so the frog end of the axis must point toward planning
// -X/+Z — the drawn right hand. The mirrored A0 put the frog at the
// scroll end and the right arm crossed the body to reach it.

function solveChain(root, target, ls, bendHint) {
  // Planar 3-segment IK in the plane spanned by the reach direction and
  // bendHint; PIP bends q, DIP 1.65q (the pianist's linked-curl model).
  const v = sub(target, root);
  const d0 = Math.hypot(...v);
  const X = unit(v);
  let Y = sub(bendHint, mul(X, dot(bendHint, X)));
  Y = unit(Math.hypot(...Y) < 1e-6 ? cross(X, [0, 0, 1]) : Y);
  const resultant = q => [ls[0] + ls[1] * Math.cos(q) + ls[2] * Math.cos(q * 1.65),
                          -ls[1] * Math.sin(q) - ls[2] * Math.sin(q * 1.65)];
  const maxD = ls[0] + ls[1] + ls[2] - 1e-6;
  const minD = Math.hypot(...resultant(1.82));
  const reach = clamp(d0, minD, maxD);
  let lo = 0, hi = 1.82;
  for (let i = 0; i < 18; i++) { const q = (lo + hi) / 2; if (Math.hypot(...resultant(q)) > reach) lo = q; else hi = q; }
  const q = (lo + hi) / 2, r = resultant(q);
  const a = -Math.atan2(r[1], r[0]);
  const pts = [root];
  const angs = [a, a - q, a - q * 1.65];
  for (let j = 0; j < 3; j++) {
    const dir = add(mul(X, Math.cos(angs[j])), mul(Y, Math.sin(angs[j])));
    pts.push(add(pts[j], mul(dir, ls[j])));
  }
  return { points: pts, error: Math.hypot(...sub(pts[3], target)), angles: [a, q, q * 0.65] };
}

function solveArm(shoulder, wrist, upper, lower, out) {
  const v = sub(wrist, shoulder), distance = Math.hypot(...v);
  const d = clamp(distance, Math.abs(upper - lower) + 0.001, upper + lower - 0.002);
  const dir = unit(v), end = add(shoulder, mul(dir, d));
  const along = (upper * upper - lower * lower + d * d) / (2 * d);
  const height = Math.sqrt(Math.max(0, upper * upper - along * along));
  const perp = unit(sub(out, mul(dir, dot(out, dir))));
  const elbow = add(add(shoulder, mul(dir, along)), mul(perp, height));
  return { shoulder, elbow, wrist: end, requestedWrist: wrist, lengths: [upper, lower], error: Math.abs(distance - d) };
}

function lowerBound(arr, t, get) { let a = 0, b = arr.length; while (a < b) { const m = (a + b) >> 1; if (get(arr[m]) < t) a = m + 1; else b = m; } return a; }

function plan(song) {
  const F = window.ViolinFingering;
  const fp = F.assign(song);
  const notes = song.notes.map((n, i) => {
    const p = fp.notes[i];
    return { i, t0: n[0], t1: n[0] + n[1], dur: n[1], pitch: n[2], vel: n[3],
             string: p.string, position: p.position, finger: p.finger, semi: p.semi,
             distMm: p.distMm, bow: p.bow, bowId: p.bowId, bowFrom: p.bowFrom, bowTo: p.bowTo };
  });
  // Hand-position keyframes from stopped notes (open strings keep the hand).
  const keys = [];
  for (const n of notes) {
    if (n.finger === 0 || n.position === 0) continue;
    const dist = F.distMm(F.POS_BASE[n.position - 1]);
    const last = keys[keys.length - 1];
    if (last && Math.abs(last.t - n.t0) < 0.03) { last.dist = Math.min(last.dist, dist); last.position = n.position; continue; }
    if (last && Math.abs(last.dist - dist) < 0.4 && last.position === n.position) continue;
    keys.push({ t: n.t0, dist, position: n.position });
  }
  // Bow strokes in order.
  const strokes = [];
  for (const n of notes) {
    const s = strokes[strokes.length - 1];
    if (s && s.id === n.bowId) { s.notes.push(n); s.t1 = Math.max(s.t1, n.t1); }
    else strokes.push({ id: n.bowId, dir: n.bow, notes: [n], t0: n.t0, t1: n.t1 });
  }
  const harmonics = new Set(song.harmonics || []);
  const fingerNotes = { 1: [], 2: [], 3: [], 4: [] };
  for (const n of notes) if (n.finger > 0) fingerNotes[n.finger].push(n);
  // Same-finger slide shifts: consecutive notes of one finger with no
  // gap and a target jump over 2mm cannot be re-placed in zero time —
  // a player slides the finger along the string, the slide mostly
  // inside the old note's tail, arriving just after the new onset
  // (worst honest deviation from either contact ~10% of the jump).
  const slides = new Map();
  {
    const F0 = window.ViolinModel.frame([0, 0, 0]);
    for (let f = 1; f <= 4; f++) {
      const seq = fingerNotes[f];
      for (let k = 1; k < seq.length; k++) {
        const prev = seq[k - 1], next = seq[k];
        if (next.t0 - prev.t1 > 0.02 || harmonics.has(prev.i) || harmonics.has(next.i)) continue;
        const a = F0.contactPoint(prev.string, prev.distMm), b = F0.contactPoint(next.string, next.distMm);
        const d = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
        if (d < 0.002) continue;
        // Late and fast: at most 60ms of the slide eats into the old
        // note's tail (verify's onset-90ms samples stay exact); the rest
        // completes just after the new onset.
        const W = clamp(d / 0.9, 0.04, 0.12);
        const s = { prev, next, tStart: next.t0 - Math.min(0.8 * W, 0.06), tEnd: next.t0 + 0.2 * W };
        slides.set(prev.i, s); slides.set(next.i, s);
      }
    }
  }
  // Energy envelope (10 Hz), as in the pianist.
  const envelope = [];
  for (let i = 0; i <= Math.ceil(song.duration * 10); i++) envelope.push({ power: 0, weight: 0 });
  for (const n of notes) {
    const c = Math.round(n.t0 * 10), st = (n.vel / 127) ** 2;
    for (let d = -12; d <= 18; d++) { const k = c + d; if (k >= 0 && k < envelope.length) { const w = Math.exp(-d * d / 60); envelope[k].power += st * w; envelope[k].weight += w; } }
  }
  for (const e of envelope) { const loud = e.weight ? e.power / e.weight : 0; e.energy = clamp(Math.sqrt(loud) * 0.64 + Math.min(e.weight / 12, 1) * 0.36, 0, 1); }
  return { song, notes, keys, strokes, envelope, stats: fp.stats, harmonics, fingerNotes, slides };
}

function handDistAt(P, t) {
  const keys = P.keys;
  if (!keys.length) return { dist: 24, position: 1, shifting: 0 };
  if (t < keys[0].t) {
    const u = smooth((t - (keys[0].t - 0.45)) / 0.45);
    return { dist: mix(70, keys[0].dist, u), position: keys[0].position, shifting: u > 0 && u < 1 ? 1 : 0 };
  }
  let i = lowerBound(keys, t + 1e-6, k => k.t) - 1;
  const cur = keys[Math.max(0, i)], next = keys[i + 1];
  if (!next) return { dist: cur.dist, position: cur.position, shifting: 0 };
  const gap = next.t - cur.t;
  const lead = clamp(gap * 0.4, 0.05, SHIFT_LEAD);
  const begin = next.t - lead;
  if (t < begin) return { dist: cur.dist, position: cur.position, shifting: 0 };
  const u = smooth((t - begin) / lead);
  return { dist: mix(cur.dist, next.dist, u), position: u < 0.5 ? cur.position : next.position, shifting: u };
}

function vibrato(note, t) {
  if (note.dur < VIB.minDur || note.finger === 0) return 0;
  const ph = t - note.t0 - VIB.delay;
  if (ph <= 0) return 0;
  const env = Math.min(1, ph / VIB.ramp) * clamp((note.t1 - t) / 0.08, 0, 1);
  return Math.sin(2 * Math.PI * VIB.rate * ph) * VIB.extentMm * env * (0.45 + 0.55 * note.vel / 127);
}

function bowAt(P, t) {
  const notes = P.notes;
  let i = lowerBound(notes, t + 1e-6, n => n.t0) - 1;
  const cur = notes[Math.max(0, i)], next = notes[i + 1];
  // Sounding note (or the gap inside a stroke): s from the plan's bow track.
  let sounding = null;
  for (let k = Math.max(0, i); k >= 0 && notes[k].t0 > t - 12; k--) if (t >= notes[k].t0 && t < notes[k].t1) { sounding = notes[k]; break; }
  let s, stringF, dir = 'down', bowId = -1;
  if (sounding) {
    const u = clamp((t - sounding.t0) / Math.max(0.03, sounding.dur), 0, 1);
    s = mix(sounding.bowFrom, sounding.bowTo, u);
    stringF = sounding.string; dir = sounding.bow; bowId = sounding.bowId;
  } else if (next && next.t0 - t < 0.12) { // anticipate the next stroke/string
    const u = smooth((t - (next.t0 - 0.12)) / 0.12);
    const prev = cur && t >= cur.t0 ? cur : null;
    s = prev ? mix(prev.bowTo, next.bowFrom, u) : next.bowFrom;
    stringF = prev ? mix(prev.string, next.string, u) : next.string;
    dir = next.bow; bowId = next.bowId;
  } else if (cur) {
    s = cur.bowTo; stringF = cur.string; dir = cur.bow; bowId = cur.bowId;
  } else if (next) { s = next.bowFrom; stringF = next.string; dir = next.bow; bowId = next.bowId; }
  else { s = 0.3; stringF = 2; }
  return { s: clamp(s, 0.01, 0.99), stringF, dir, bowId, sounding };
}

function at(P, t) {
  const G = window.ViolinModel.GEOM;
  const F = window.ViolinModel.frame([0, 0, 0]); // sway applied to the body only; the violin stays put
  const env = P.envelope[clamp(Math.round(t * 10), 0, P.envelope.length - 1)]?.energy || 0;
  let accent = 0;
  for (let k = P.notes.length - 1; k >= 0 && P.notes[k].t0 > t - 0.4; k--) {
    if (P.notes[k].t0 > t) continue;
    const age = t - P.notes[k].t0;
    accent = Math.max(accent, (P.notes[k].vel / 127) ** 2 * Math.exp(-age / 0.15));
  }
  const breath = Math.sin(t * Math.PI * 2 / 5.5) * 0.5 + 0.5;
  const sway = [Math.sin(t * 0.5) * 0.004 * (0.3 + env), breath * 0.003, Math.sin(t * 0.34) * 0.003];
  // --- left hand ---
  const hd = handDistAt(P, t);
  const bow = bowAt(P, t);
  const active = P.notes.filter(n => t >= n.t0 && t < n.t1);
  const byFinger = new Map();
  for (const n of active) if (n.finger > 0) byFinger.set(n.finger, n);
  // next note per finger (for approach)
  const nextByFinger = new Map();
  for (const n of P.notes) {
    if (n.t0 <= t || n.finger === 0) continue;
    if (!nextByFinger.has(n.finger)) nextByFinger.set(n.finger, n);
  }
  const uH = G.STRING_LENGTH - hd.dist / 1000;
  const semiHere = -12 * Math.log2(1 - hd.dist / (G.STRING_LENGTH * 1000));
  // Hover string as a continuous quantity (blends toward the next note's
  // string), so free fingers never jump sideways between strings.
  const prevNote = [...P.notes].reverse().find(n => n.t0 <= t);
  const nextNote = P.notes.find(n => n.t0 > t);
  let stringF = active[0]?.string ?? prevNote?.string ?? 2;
  if (!active.length && nextNote && nextNote.t0 - t < 0.35)
    stringF = (prevNote?.string ?? nextNote.string) + (nextNote.string - (prevNote?.string ?? nextNote.string)) * smooth((t - (nextNote.t0 - 0.35)) / 0.35);
  const strPointF = (sf, distMm, lift) => {
    const lo = Math.floor(clamp(sf, 0, 3)), hi = Math.ceil(clamp(sf, 0, 3)), fr = clamp(sf, 0, 3) - lo;
    const u = G.STRING_LENGTH - distMm / 1000;
    const v = G.vStr(lo, u) + (G.vStr(hi, u) - G.vStr(lo, u)) * fr;
    return F.point(u, v, G.wStr(u) + lift);
  };
  const fingers = [], contacts = [], roots = [];
  for (let f = 1; f <= 4; f++) {
    const homeDist = window.ViolinFingering.distMm(semiHere + NOMINAL[f - 1]);
    let target, contact = false;
    const an = byFinger.get(f);
    if (an) {
      // Harmonics are touched, not pressed: the fingertip hovers a hair
      // above the string at the node instead of pinning it to the board.
      target = P.harmonics.has(an.i)
        ? F.stringPoint(an.string, an.distMm, 0.0016)
        : F.contactPoint(an.string, an.distMm + vibrato(an, t));
      contact = true;
      // Slide shift in progress (this note is either side of one): the
      // fingertip travels between the two contact points on the slide's
      // window instead of teleporting at the boundary.
      const sl = P.slides.get(an.i);
      if (sl && t >= sl.tStart && t <= sl.tEnd) {
        const u = smooth((t - sl.tStart) / (sl.tEnd - sl.tStart));
        const from = F.contactPoint(sl.prev.string, sl.prev.distMm);
        const to = F.contactPoint(sl.next.string, sl.next.distMm + vibrato(sl.next, t));
        target = add(from, mul(sub(to, from), u));
      }
    } else {
      const nn = nextByFinger.get(f);
      let hov = strPointF(nn && nn.t0 - t < 0.35 ? nn.string : stringF, homeDist, 0.0075);
      // Base point: if this finger lifted off a note recently, the base is
      // still travelling from that contact to the hover point (release
      // curve, 0.25s, with a small arc). The approach to the next note
      // then blends FROM that base — composing the two is what keeps
      // fast re-articulation (same finger, new note) continuous.
      const seq = P.fingerNotes[f];
      let li = lowerBound(seq, t + 1e-6, n => n.t0) - 1;
      const last = seq[li];
      let base = hov;
      if (last && t >= last.t1 && t - last.t1 < 0.25) {
        const u = smooth((t - last.t1) / 0.25);
        const from = F.contactPoint(last.string, last.distMm);
        base = add(add(from, mul(sub(hov, from), u)), mul(G.W, Math.sin(Math.PI * u) * 0.010));
      }
      // Approach begins at the LATER of (note start - lead) and this
      // finger's last release: if it began during the previous note, its
      // progress would be invisible while that note sounds and the target
      // would snap at the release instant (the pianist's approachStart
      // rule). Short gaps compress the approach into the gap.
      const beginA = nn ? Math.max(nn.t0 - SHIFT_LEAD, last && last.t1 < nn.t0 ? last.t1 : -Infinity) : Infinity;
      if (nn && t >= beginA && t < nn.t0) {
        const u = smooth((t - beginA) / Math.max(0.01, nn.t0 - beginA));
        target = add(base, mul(sub(F.contactPoint(nn.string, nn.distMm), base), u));
      } else target = base;
    }
    // The knuckle rides a fixed offset behind/above its own fingertip
    // target, so the root->tip distance is constant and always inside
    // the finger's [minD, maxD] reach band (anchoring roots to the hand
    // position instead put close targets inside minD — an impossible fold).
    const root = add(target, add(mul(G.U, 0.050 - (f - 1) * 0.0025), add(mul(G.V, 0.006), mul(G.W, 0.030))));
    roots.push(root);
    // Bend hint +W: the chain arches AWAY from the fingerboard, so the
    // fingers curl over the top and the fingertips descend onto the
    // strings. -W dove the joints through the board plane and hooked
    // the fingertips back up from underneath (rk's reversed grip).
    const solved = solveChain(root, target, FINGER_LENGTHS[f - 1], G.W);
    fingers.push(solved);
    contacts.push({ finger: f, contact, error: solved.error, target });
  }
  const palmC = roots.reduce((a, r) => add(a, mul(r, 0.25)), [0, 0, 0]);
  // Thumb behind the neck (player side, -W of the neck axis), pointing
  // UP the neck: the tip sits scroll-side of the base, roughly under
  // fingers 1-2. The old polyline ran the other way — tip toward the
  // bridge, thumb lying down the neck.
  const thumb = [
    F.point(uH - 0.030, -0.013, G.wFB(uH) - 0.016),
    F.point(uH - 0.002, -0.019, G.wFB(uH) - 0.022),
    F.point(uH + 0.024, -0.014, G.wFB(uH) - 0.015),
  ];
  // Wrist just scroll-side of the knuckle centroid and behind the neck
  // line (-W), forearm rising from below. The old +0.075 U offset put
  // the wrist out at the scroll (u ~ 0.41 in first position). In high
  // positions there is no neck to sit behind: the hand comes over the
  // upper bout, so the wrist blends to the bout's E rim at knuckle
  // height (kb) instead of spearing the forearm through the body.
  const kb = clamp((hd.dist - 150) / 60, 0, 1);
  const wristL = add(palmC, add(mul(G.U, 0.030),
    add(mul(G.V, mix(0.004, -0.048, kb)), mul(G.W, mix(-0.052, 0.006, kb)))));
  // --- bow / right arm ---
  const tilt = mix(BOW_TILT[Math.floor(clamp(bow.stringF, 0, 3))], BOW_TILT[Math.ceil(clamp(bow.stringF, 0, 3))], clamp(bow.stringF, 0, 3) % 1);
  // The axis takes only 60% of the string tilt: the contact point already
  // selects the string, and the full tilt would swing the frog ~16cm
  // vertically between G and E — more than the arm + torso follow covers.
  const axis = rotAxis(A0, G.U, tilt * 0.6);
  // cross(A0, U), not cross(U, A0): with A0 negated (frog at the hand
  // end), this keeps `down` — the stick's offset from the hair, away
  // from the fingerboard — the identical vector it was before.
  const down = rotAxis(cross(A0, G.U), G.U, tilt * 0.6), side = unit(cross(down, axis));
  const sLo = Math.floor(clamp(bow.stringF, 0, 3)), sHi = Math.ceil(clamp(bow.stringF, 0, 3)), sFrac = clamp(bow.stringF, 0, 3) - sLo;
  const C = add(mul(F.bowPoint(sLo), 1 - sFrac), mul(F.bowPoint(sHi), sFrac));
  // Geometry softens the plan's bow extremes: with a straight bow held
  // perpendicular to the string, the frog at s > ~0.85 sits further from
  // the right shoulder than any arm + torso lean can reach (real players
  // drift the bow angle and sounding point there). The plan/audio keep
  // the true s; the drawn frog/tip use the clamped one. The low clamp
  // (0.16) also keeps the drawn frog far enough from the waist that
  // the right forearm clears the rim at the frog end.
  const gs = clamp(bow.s, 0.16, 0.82);
  const frogHair = sub(C, mul(axis, gs * BOW_LEN));
  const tipHair = add(C, mul(axis, (1 - gs) * BOW_LEN));
  const frogStick = add(frogHair, mul(down, 0.019));
  const tipStick = add(tipHair, mul(down, 0.0125));
  // The wrist sits behind the frog along the stick — further at the
  // frog end, where the forearm otherwise clips the waist rim, and
  // less toward the tip, where the arm is already near its reach.
  const wristR = add(add(frogStick, mul(down, 0.016)), mul(axis, -0.075 * (1 - bow.s)));
  // Torso follow: if the wrist is still out of comfortable reach, the
  // right shoulder leans toward it (capped), and the upper body follows
  // at reduced amplitude — the pianist's torso-follow trick.
  // The shoulder origin sits 30 mm toward the tail side (-U) of the
  // anatomical joint: with a neutral origin the upper arm's line to
  // the elbow passes through the lower bout's tail rim at high bow
  // fractions (see clearance-test.cjs).
  let SR = add(add([-0.205, 1.452, -0.055], mul(G.U, -0.03)), sway);
  const dR = Math.hypot(...sub(wristR, SR));
  const follow = mul(unit(sub(wristR, SR)), clamp(dR - 0.63, 0, 0.19));
  SR = add(SR, follow);
  const upperSway = add(sway, mul(follow, 0.7));
  const armR = solveArm(SR, wristR, 0.36, 0.34, [-0.30, -0.9, 0.50]);
  // In high positions the left elbow swings toward the scroll so the
  // forearm passes beside the upper bout instead of through it; the
  // blend follows the hand's distance along the string (continuous).
  const kbL = clamp((hd.dist - 190) / 70, 0, 1);
  const hintL = add(mul([0.30, -1, 0.35], 1 - kbL), mul([0.85, -0.55, 0.30], kbL));
  const armL = solveArm(add(add([0.205, 1.452, -0.03], sway), mul(follow, 0.45)), wristL, 0.36, 0.34, hintL);
  // Right-hand grip: four fingers curled over the stick near the frog.
  const gripRoot = add(frogStick, mul(down, 0.006));
  const rFingers = [];
  for (let f = 0; f < 4; f++) {
    const r0 = add(gripRoot, add(mul(axis, 0.004 + f * 0.011), mul(side, 0.013)));
    const r1 = add(r0, add(mul(down, -0.016), mul(axis, 0.002)));
    const r2 = add(r1, add(mul(side, -0.016), mul(down, -0.004)));
    const r3 = add(r2, add(mul(side, -0.010), mul(axis, -0.002)));
    rFingers.push({ points: [r0, r1, r2, r3] });
  }
  // The head is clamped to the violin by the chin, so it rides the
  // instrument's sway only — not the torso's bow follow (the neck
  // absorbs the difference, and the chin stays on the rest). The base
  // position puts the chin (head-local [0, -0.148, 0.0205]) exactly on
  // the chinrest top. yaw uses the pianist's head convention, measured
  // from +Z — but the performer faces -Z, so the turn toward the
  // scroll is PI - 0.40; plain 0.40 put the face on the back of the
  // head, mirrored away from the instrument.
  const headSway = sway;
  const head = {
    pos: add([0.067, 1.620, -0.080], headSway),
    pitch: 0.30 + accent * 0.05 + env * 0.03, yaw: Math.PI - 0.40, roll: 0.17,
  };
  return {
    time: t, frame: F, sway, upperSway, headSway, breath,
    lean: 0.05 + env * 0.035, torsoYaw: 0.05, torsoRoll: 0.02 * Math.sin(t * 0.4),
    head, armL, armR,
    handL: { palmPos: add(add(add(palmC, mul(G.W, mix(-0.076, -0.034, kb))), mul(G.U, -0.026)), mul(G.V, -0.004)), pitch: -0.45, yaw: Math.atan2(G.U[0], G.U[2]) + 0.5, roll: 0.35, fingers, thumb },
    handR: { palmPos: add(add(frogStick, mul(down, 0.028)), mul(axis, -0.030)), pitch: -0.3, yaw: Math.atan2(axis[0], axis[2]), roll: 0, fingers: rFingers },
    bow: { frogHair, tipHair, frogStick, tipStick, axis, down, side, contact: C, string: bow.stringF, s: bow.s, geoS: gs, dir: bow.dir, id: bow.bowId },
    activeStrings: [...new Set(active.map(n => n.string))],
    sounding: active.map(n => ({ string: n.string, finger: n.finger, distMm: n.distMm + vibrato(n, t), pitch: n.pitch })),
    debug: {
      handDistMm: hd.dist, position: hd.position, shifting: hd.shifting,
      bowString: bow.stringF, bowS: bow.s, bowDir: bow.dir, bowId: bow.bowId,
      contacts, arms: [armL, armR], energy: env,
      activeNotes: active.map(n => n.pitch),
    },
  };
}

return { plan, at, solveChain, solveArm, handDistAt, bowAt, vibrato, VIB, BOW_TILT, FINGER_LENGTHS };
})();

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

// Selected proportion B: shorten the four left fingers by 20%; palm/thumb stay unchanged.
const FINGER_LENGTH_SCALE = .8;
const FINGER_LENGTHS = [[.046, .028, .020], [.052, .032, .022], [.048, .030, .021], [.038, .024, .017]].map(finger=>finger.map(length=>length*FINGER_LENGTH_SCALE));
const NOMINAL = [0, 2, 4, 5.5];               // hover semitone offset of fingers 1-4 inside a position
const SHIFT_LEAD = 0.18;                      // hand starts shifting this long before the target note
const VIB = { minDur: 0.55, delay: 0.22, ramp: 0.35, rate: 5.6, extentMm: 1.5 };
const BOW_LEN = 0.745;
const BOW_TILT = [0.26, 0.09, -0.09, -0.26];  // bow-plane angle per string G D A E (rad about the string axis)
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

// Two-pole low-pass phrasing, compiled once per plan. Bow reach and string
// level lead the shoulder/chest together; fast tremolo does not shake the body.
function expressionAt(P,t){
  if(!P.expressionTrack){
    const keys=[],dt=1/30;let a=[.5,1.5,0],b=a.slice();
    for(let i=0;i<=Math.ceil(P.song.duration/dt);i++){
      const time=i*dt,bow=bowAt(P,time),energy=P.envelope[Math.min(P.envelope.length-1,Math.round(time*10))]?.energy||0;
      const target=[bow.s,bow.stringF,energy];
      for(let j=0;j<3;j++){a[j]+=(target[j]-a[j])*(1-Math.exp(-dt/.24));b[j]+=(a[j]-b[j])*(1-Math.exp(-dt/.24));}
      keys.push(b.slice());
    }P.expressionTrack=keys;
  }
  const x=clamp(t*30,0,P.expressionTrack.length-1),i=Math.floor(x),a=P.expressionTrack[i],b=P.expressionTrack[Math.min(i+1,P.expressionTrack.length-1)],v=a.map((q,k)=>mix(q,b[k],smooth(x-i)));
  const [reach,string,energy]=v,phrase=Math.sin(t*Math.PI*2/6.8),answer=Math.sin(t*Math.PI*2/11+.8);
  const yaw=(reach-.5)*.19+phrase*(.025+.025*energy);
  const roll=(reach-.5)*-.10+answer*(.016+.020*energy);
  const pitch=.018*phrase+energy*.025+(string-1.5)*.009;
  const rotate=p=>rotAxis(rotAxis(rotAxis(p,[0,0,1],roll),[1,0,0],pitch),[0,1,0],yaw);
  const pivot=[0,1.03,0],offset=[phrase*(.006+.009*energy),.004*Math.sin(t*Math.PI*2/3.4),-.006*energy+.006*answer];
  const frame={U:rotate([1,0,0]),V:rotate([0,1,0]),W:rotate([0,0,1]),O:sub(add(pivot,offset),rotate(pivot))};
  return {frame,yaw,pitch,roll,reach,energy};
}
// The upper arm opens sideways, while its height follows the string plane.
function bowArm(shoulder,wrist,string=1.5){
  return solveArm(shoulder,wrist,.36,.34,[-1.0,-.12+(string-1.5)*.08,.16]);
}

function atLegacy(P, t) {
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
  const kb = smooth((hd.dist - 90) / 60);
  const wristL = add(palmC, add(mul(G.U, 0.030),
    add(mul(G.V, mix(0.004, 0.110, kb)), mul(G.W, mix(-0.052, 0.020, kb)))));
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
  // Anchor the complete right hand to the frog; the arm meets its carpus.
  const handR = window.BowHand.create('violin', frogStick, axis, down);
  const wristR = handR.wrist;
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
  const armR = bowArm(SR,wristR,bow.stringF);
  // In high positions the left elbow swings toward the scroll so the
  // forearm passes beside the upper bout instead of through it; the
  // blend follows the hand's distance along the string (continuous).
  const kbL = clamp((hd.dist - 190) / 70, 0, 1);
  const hintL = add(mul([0.30, -1, 0.35], 1 - kbL), mul([0.85, -0.55, 0.30], kbL));
  // The left clavicle protracts as the hand travels toward the bridge. A
  // fixed rear shoulder forced the elbow around the bout and folded the wrist.
  const clavicle=add([-.020,-.015,-.085],mul([-.025,-.005,-.020],smooth((hd.dist-85)/80)));
  const armL = solveArm(add(add(add([0.205, 1.452, -0.03],clavicle), sway), mul(follow, 0.45)), wristL, 0.36, 0.34, hintL);
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
    time: t, expression:expressionAt(P,t), frame: F, sway, upperSway, headSway, breath,
    lean: 0.05 + env * 0.035, torsoYaw: 0.05, torsoRoll: 0.02 * Math.sin(t * 0.4),
    head, armL, armR,
    handL: { palmPos: add(add(add(palmC, mul(G.W, mix(-0.076, -0.034, kb))), mul(G.U, -0.026)), mul(G.V, -0.004)), pitch: -0.45, yaw: Math.atan2(G.U[0], G.U[2]) + 0.5, roll: 0.35, fingers, thumb },
    handR,
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

// One anatomical FK hand. Frames are solved once, not reconstructed from tips.
const NHPrototype = (() => {
  const D=.67, ROOT=[[.027,0,0],[.009,.004,0],[-.009,.002,0],[-.027,-.004,0]];
  const LIMIT=[[-.21,1.54],[-.85,.85],[.10,1.78]], cache=new Map();let solves=0;
  const G=window.ViolinModel.GEOM;
  const local=p=>{const d=sub(p,G.O0);return [dot(d,G.U),dot(d,G.V),dot(d,G.W)];};
  const world=p=>window.ViolinModel.frame().point(...p);
  function basis(tilt,yaw){const c=Math.cos(tilt),s=Math.sin(tilt),a=Math.cos(yaw),b=Math.sin(yaw);return [[a,b,0],[-b*c,a*c,s],[b*s,-a*s,c]];}
  const mv=(R,p)=>[0,1,2].map(i=>R[0][i]*p[0]+R[1][i]*p[1]+R[2][i]*p[2]);
  const inverse=(R,p)=>R.map(a=>dot(a,p));
  function fk(f,a){
    const L=FINGER_LENGTHS[f],m=[Math.sin(a[1]),Math.cos(a[1]),0],pts=[ROOT[f]];
    const angles=[a[0],a[0]+a[2],a[0]+(1+D)*a[2]];
    for(let j=0;j<3;j++)pts.push(add(pts[j],mul([m[0]*Math.cos(angles[j]),m[1]*Math.cos(angles[j]),-Math.sin(angles[j])],L[j])));
    return pts;
  }
  function linear(A,b){const n=b.length,A0=A.map((r,i)=>[...r,b[i]]);for(let j=0;j<n;j++){let k=j;for(let i=j+1;i<n;i++)if(Math.abs(A0[i][j])>Math.abs(A0[k][j]))k=i;[A0[j],A0[k]]=[A0[k],A0[j]];if(Math.abs(A0[j][j])<1e-15)return null;const v=A0[j][j];for(let c=j;c<=n;c++)A0[j][c]/=v;for(let i=0;i<n;i++)if(i!==j){const q=A0[i][j];for(let c=j;c<=n;c++)A0[i][c]-=q*A0[j][c];}}return A0.map(r=>r[n]);}
  function minimize(fn,x,max=24,lim=null){
    let r=fn(x),cost=dot(r,r),lambda=.001;
    for(let it=0;it<max;it++){
      const J=x.map((v,j)=>{const y=x.slice(),h=1e-5;y[j]+=h;return mul(sub(fn(y),r),1/h);});
      const A=J.map(a=>J.map(b=>dot(a,b))),g=J.map(a=>dot(a,r));let accepted=false;
      for(let trial=0;trial<7;trial++){
        const dx=linear(A.map((row,i)=>row.map((v,j)=>v+(i===j?lambda*(A[i][i]+1e-8):0))),g);if(!dx)break;
        const y=x.map((v,i)=>lim?clamp(v-dx[i],...lim[i]):v-dx[i]);
        if(lim)y[2]=clamp(y[2],Math.max(.10,(1.80-y[0])/1.67),Math.min(1.78,(3.0-y[0])/1.67));
        else if(y.length===5){y[3]=clamp(y[3],.25,1.35);y[4]=clamp(y[4],-.65,.65);}
        const rr=fn(y),cc=dot(rr,rr);
        if(cc<cost){const gain=cost-cc;x=y;r=rr;cost=cc;lambda=Math.max(1e-8,lambda*.25);accepted=gain>1e-12;break;}lambda*=8;
      }if(!accepted)break;
    }return x;
  }
  function ik(f,a,target){return minimize(x=>sub(fk(f,x)[3],target),a,16,LIMIT);}
  function build(q,f){return fk(f,q.a[f]).map(p=>add(q.c,mv(q.R,p)));}
  const box=(p,c,h)=>{const d=p.map((v,i)=>Math.abs(v-c[i])-h[i]);return Math.hypot(...d.map(v=>Math.max(0,v)))+Math.min(0,Math.max(...d));};
  function surface(p){
    const board=box(p,[.193,0,G.wFB(.193)-.0032],[.135,.0225,.0032]);
    const neck=box(p,[.263,0,G.wFB(.263)-.0115],[.065,.0115,.008]);
    const body=box(p,[.017,0,-.030],[.178,.104,.030]);
    const heel=Math.hypot((p[0]-.195)/.018,p[1]/.018,(p[2]+.018)/.024)-1;
    return Math.min(board,neck,body,heel*.018);
  }
  function frame(semi,sf,anchors=[]){
    const key=semi+':'+sf+':'+anchors.map(n=>[n.finger,n.string,n.semi].join('/')).join(',');if(cache.has(key))return cache.get(key);
    const F=window.ViolinModel.frame(),u=G.STRING_LENGTH-window.ViolinFingering.distMm(semi)/1000;
    const targets=NOMINAL.map((off,f)=>{const n=anchors.find(n=>n.finger===f+1);return local(F.contactPoint(n?n.string:sf,window.ViolinFingering.distMm(n?n.semi:semi+off)));});
    const high=smooth((.245-u)/.065),tilt=mix(1.15,.45,high),seed=[u-.028,-.071-high*.010,G.wFB(u)+.018+high*.040,tilt,-.05];
    const make=x=>{const R=basis(x[3],x[4]),c=x.slice(0,3),a=targets.map((t,f)=>ik(f,[.55,0,1.0],inverse(R,sub(t,c))));return {c,R,a};};
    const residual=x=>{
      const q=make(x),r=[];
      for(let f=0;f<4;f++){
        const pts=build(q,f);r.push(...mul(sub(pts[3],targets[f]),1/(anchors.some(n=>n.finger===f+1)?.00002:.002)));
        r.push((q.a[f][0]-.55)/.5,q.a[f][1]/.35,(q.a[f][2]-1.05)/.4);
        for(let j=0;j<3;j++)for(const t of [0,.5]){const p=add(pts[j],mul(sub(pts[j+1],pts[j]),t));r.push(Math.max(0,.011-surface(p))/.0015);}
      }
      const palm=add(q.c,mv(q.R,[0,-.035,0]));r.push(Math.max(0,.025-surface(palm))/.001);
      const wrist=world(add(q.c,mv(q.R,[0,-.070,0]))),arm=solveArm([.205,1.452,-.03],wrist,.36,.34,add(mul(G.V,-1),mul(G.W,-.5)));
      for(let j=0;j<=8;j++){const p=local(add(arm.wrist,mul(sub(arm.elbow,arm.wrist),j/8)));const sd=box(p,[.017,0,-.030],[.178,.104,.030]);r.push(Math.max(0,.052-sd)/.0008);}
      r.push((x[0]-seed[0])/.025,(x[1]-seed[1])/.020,(x[2]-seed[2])/.025,(x[3]-tilt)/.25,x[4]/.3);return r;
    };
    let x=minimize(residual,seed,40),cost=dot(residual(x),residual(x));
    if(cost>100&&anchors.length>1)for(const v of [-.35,.35]){const s=seed.slice();s[4]+=v;const xx=minimize(residual,s,40),cc=dot(residual(xx),residual(xx));if(cc<cost){x=xx;cost=cc;}}
    const q=make(x);q.key=key;cache.set(key,q);solves++;return q;
  }
  function blend(a,b,t){return {c:a.c.map((v,i)=>mix(v,b.c[i],t)),R:basis(mix(Math.atan2(a.R[1][2],a.R[2][2]),Math.atan2(b.R[1][2],b.R[2][2]),t),mix(Math.atan2(a.R[0][1],a.R[0][0]),Math.atan2(b.R[0][1],b.R[0][0]),t)),a:a.a.map((v,f)=>v.map((x,j)=>mix(x,b.a[f][j],t))),key:a.key+'>'+b.key};}
  function at(P,t,hd,tracks){
    if(!P.nhKeys){
      const keys=[];
      for(const n of P.notes){if(!n.finger)continue;
        const byFinger=new Map();for(const a of P.notes)if(a.finger&&a.t0<=n.t0&&a.t1>n.t0)byFinger.set(a.finger,a);
        const anchors=[...byFinger.values()],semi=window.ViolinFingering.POS_BASE[n.position-1];
        keys.push({t:n.t0,semi,sf:n.string,anchors});
      }P.nhKeys=keys;
    }
    const keys=P.nhKeys,k=Math.max(0,lowerBound(keys,t+1e-6,n=>n.t)-1),cur=keys[k],next=keys[k+1];
    const get=n=>frame(n.semi,n.sf,n.anchors),a=get(cur),b=next?get(next):a;
    const lead=next?Math.min(.12,Math.max(.025,(next.t-cur.t)*.45)):.12;
    const q=blend(a,b,next?smooth((t-next.t+lead)/lead):0);
    // While an old note is still held during an anticipated shift, the rigid
    // frame must remain reachable. Correct carriage, never individual roots.
    const held=tracks.map((c,f)=>{
      const seq=P.fingerNotes[f+1],k=lowerBound(seq,t+1e-6,n=>n.t0)-1,last=seq[k],next=seq[k+1];
      const weight=c.contact?1:Math.max(last?smooth(1-(t-last.t1)/.14):0,next?smooth(1-(next.t0-t)/.14):0);
      return {c,f,weight};
    }).filter(v=>v.weight>0);
    // Project the ONE rigid frame onto the active constraints; repeated FK/IK
    // keeps every metacarpal and phalanx length invariant during a shift.
    for(let iteration=0;iteration<12;iteration++){
      let delta=[0,0,0],sum=0;
      for(const {c,f,weight} of held){const target=local(c.target),a=ik(f,q.a[f],inverse(q.R,sub(target,q.c))),p=add(q.c,mv(q.R,fk(f,a)[3]));delta=add(delta,mul(sub(target,p),weight));sum+=weight;}
      if(!sum||Math.hypot(...delta)<1e-9)break;
      q.c=add(q.c,mul(delta,1/Math.max(1,sum)));
    }
    const activeHeld=held.filter(v=>v.c.contact);
    if(activeHeld.length>1){
      const seed=[...q.c,Math.atan2(q.R[1][2],q.R[2][2]),Math.atan2(q.R[0][1],q.R[0][0])];
      const fitted=minimize(x=>{const R=basis(x[3],x[4]),c=x.slice(0,3),r=mul(sub(x,seed),.005);for(const {c:track,f} of activeHeld){const target=local(track.target),a=ik(f,q.a[f],inverse(R,sub(target,c)));r.push(...mul(sub(add(c,mv(R,fk(f,a)[3])),target),1/.00001));}return r;},seed,32);
      q.c=fitted.slice(0,3);q.R=basis(fitted[3],fitted[4]);
    }
    for(let iteration=0;iteration<30&&activeHeld.length;iteration++){
      let delta=[0,0,0];for(const {c,f} of activeHeld){const target=local(c.target),a=ik(f,q.a[f],inverse(q.R,sub(target,q.c)));delta=add(delta,sub(target,add(q.c,mv(q.R,fk(f,a)[3]))));}
      delta=mul(delta,1/activeHeld.length);q.c=add(q.c,delta);if(Math.hypot(...delta)<1e-10)break;
    }
    // Project the dorsal joints out of the board while restoring active pins.
    for(let pass=0;pass<8;pass++){
      let lift=0;for(const {c,f} of activeHeld){const a=ik(f,q.a[f],inverse(q.R,sub(local(c.target),q.c))),pts=fk(f,a).map(p=>add(q.c,mv(q.R,p)));for(const j of [1,2])if(pts[j][0]>.06&&pts[j][0]<.335)lift=Math.max(lift,G.wFB(pts[j][0])+.006-pts[j][2]);}
      if(lift<1e-6)break;q.c[2]+=lift;
      for(let k=0;k<16;k++){let delta=[0,0,0];for(const {c,f} of activeHeld){const target=local(c.target),a=ik(f,q.a[f],inverse(q.R,sub(target,q.c)));delta=add(delta,sub(target,add(q.c,mv(q.R,fk(f,a)[3]))));}if(!activeHeld.length)break;delta=mul(delta,1/activeHeld.length);q.c=add(q.c,delta);if(Math.hypot(...delta)<1e-10)break;}
    }
    // Refit the rigid carriage against exposed neck capsules after a shift.
    const neckSD=p=>{
      const slope=-.0125/.328,du=p[0]-.263,dw=p[2]-(G.wFB(.263)-.01295),len=Math.hypot(1,slope);
      return box([(du+dw*slope)/len,p[1],(dw-du*slope)/len],[0,0,0],[.065,.0115,.00655]);
    };
    const poseAngles=(R,c,f)=>{
      const track=tracks[f],weight=held.find(v=>v.f===f)?.weight||0,pin=ik(f,q.a[f],inverse(R,sub(local(track.target),c))),hover=q.a[f].map((v,j)=>v-(j===0?.12:0));return hover.map((v,j)=>mix(v,pin[j],weight));
    };
    const collisionCost=x=>{const R=basis(x[3],x[4]),c=x.slice(0,3),r=[];
      for(let f=0;f<4;f++){const aa=poseAngles(R,c,f),pts=fk(f,aa).map(p=>add(c,mv(R,p)));
        if(tracks[f].contact)r.push(...mul(sub(pts[3],local(tracks[f].target)),1/.000005));
        for(let j=0;j<3;j++)for(const s of [0,.25,.5,.75,1])r.push(Math.max(0,(.0105-j*.0016)*.65+.0005-neckSD(add(pts[j],mul(sub(pts[j+1],pts[j]),s))))/.0001);
      }return r;};
    const placement=[...q.c,Math.atan2(q.R[1][2],q.R[2][2]),Math.atan2(q.R[0][1],q.R[0][0])];
    const r0=collisionCost(placement);
    if(dot(r0,r0)>1){const fit=minimize(x=>[...collisionCost(x),...mul(sub(x,placement),.1)],placement,24);q.c=fit.slice(0,3);q.R=basis(fit[3],fit[4]);}
    const fingers=[],contacts=[];
    for(let f=0;f<4;f++){
      const c=tracks[f],weight=held.find(v=>v.f===f)?.weight||0;
      const pinned=ik(f,q.a[f].slice(),inverse(q.R,sub(local(c.target),q.c))),hover=q.a[f].map((v,j)=>v-(j===0?.12:0));
      const a=hover.map((v,j)=>mix(v,pinned[j],weight));
      const points=fk(f,a).map(p=>world(add(q.c,mv(q.R,p)))),error=Math.hypot(...sub(points[3],c.target));
      fingers.push({points,angles:a,error});contacts.push({...c,error});
    }
    const palm=add(q.c,mv(q.R,[0,-.035,0])),wrist=add(q.c,mv(q.R,[0,-.070,0]));
    const u=q.c[0]+.020,back=G.wFB(u)-.033;
    const thumb=[world([u-.038,-.040,back-.012]),world([u-.012,-.014,back+.004]),world([u+.020,-.014,back])];
    return {hand:{palmPos:world(palm),basis:q.R.map(v=>add(add(mul(G.U,v[0]),mul(G.V,v[1])),mul(G.W,v[2]))),pitch:0,yaw:0,roll:0,fingers,thumb,model:'natural',frameKey:q.key},wrist:world(wrist),contacts};
  }
  return {at,frame,fk,ik,surface,ROOT,LIMIT,stats:()=>({frames:cache.size,solves}),source:()=>[basis,fk,linear,minimize,ik,build,surface,frame,blend,at].map(f=>f.toString()).join('\n')};
})();
const NH = window.ViolinHand?window.ViolinHand({atLegacy,solveArm,FINGER_LENGTHS,lowerBound,smooth,vibrato,handDistAt}):null;
// Natural hand playback uses precomputed joint tracks. Missing or stale
// tracks fall back to legacy instead of running nonlinear planning in a frame.
let HAND_SOLVER='natural';
const setHandSolver=s=>(HAND_SOLVER=s==='natural'&&NH?'natural':'legacy');
function at(P,t){
  const S=atLegacy(P,t);if(HAND_SOLVER==='legacy'||!NH||!NH.available(P))return S;
  const L=NH.at(P,t,handDistAt(P,t),S.debug.contacts);S.handL=L.hand;S.debug.contacts=L.contacts;
  S.armL=NH.armOf(L.q,S.armL.shoulder);
  S.debug.arms=[S.armL,S.armR];return S;
}
// Optional 30 Hz render stream. Exact at() remains the audit/reference API.
const CACHE_VERSION=1;
let POSE_CACHE=null;
function cacheSchema(v){
  if(typeof v==='number')return 'n';if(typeof v==='boolean')return 'b';if(typeof v==='string')return 's';if(v===null)return 'z';
  return Array.isArray(v)?['a',v.map(cacheSchema)]:['o',Object.keys(v),Object.values(v).map(cacheSchema)];
}
function cacheFlatten(schema,v,n,s){
  if(schema==='n'){n.push(Math.fround(v));return;}if(schema==='b'){n.push(v?1:0);return;}if(schema==='s'){s.push(v);return;}if(schema==='z')return;
  const array=schema[0]==='a',children=array?schema[1]:schema[2];children.forEach((c,i)=>cacheFlatten(c,v[array?i:schema[1][i]],n,s));
}
function cacheUnflatten(schema,n,s,cursor){
  if(schema==='n')return n[cursor.n++];if(schema==='b')return n[cursor.n++]>=.5;if(schema==='s')return s[cursor.s++];if(schema==='z')return null;
  const array=schema[0]==='a',children=array?schema[1]:schema[2],out=array?[]:{};children.forEach((c,i)=>out[array?i:schema[1][i]]=cacheUnflatten(c,n,s,cursor));return out;
}
function cacheView(S){
  const pad=(a,empty)=>Array.from({length:4},(_,i)=>a[i]??empty);
  const {frame,...v}=S;
  return {...v,activeStrings:{count:S.activeStrings.length,values:pad(S.activeStrings,0)},
    sounding:{count:S.sounding.length,values:pad(S.sounding,{string:0,finger:0,distMm:0,pitch:0})},
    debug:{...S.debug,activeNotes:{count:S.debug.activeNotes.length,values:pad(S.debug.activeNotes,0)}}};
}
function packPose(S){const v=cacheView(S),schema=cacheSchema(v),numbers=[],strings=[];cacheFlatten(schema,v,numbers,strings);return {schema,numbers,strings};}
const signatureCache=new WeakMap();
function songSignature(P){if(!signatureCache.has(P))signatureCache.set(P,JSON.stringify([P.song.id,P.song.duration,P.song.notes,P.notes,P.song.harmonics||[]]));return signatureCache.get(P);}
function cacheStamp(){
  const source=[atLegacy,at,expressionAt,bowArm,solveChain,solveArm,handDistAt,bowAt,vibrato,plan,clamp,smooth,mix,rotAxis,lowerBound].map(f=>f.toString()).join('\n')+(NH?NH.source():'')+window.BowHand.source()+JSON.stringify([FINGER_LENGTHS,NOMINAL,VIB,BOW_TILT,BOW_LEN,A0,SHIFT_LEAD,window.ViolinModel.GEOM],(k,v)=>typeof v==='function'?v.toString():v)+window.ViolinModel.frame.toString();
  let h=2166136261;for(let i=0;i<source.length;i++)h=Math.imul(h^source.charCodeAt(i),16777619);return (h>>>0).toString(16);
}
function setPoseCache(data){POSE_CACHE=data&&data.version===CACHE_VERSION&&data.stamp===cacheStamp()?data:null;return !!POSE_CACHE;}
function atCached(P,t){
  const entry=POSE_CACHE?.solvers?.[HAND_SOLVER]?.[P.song.id];
  if(!entry||t<0||t>P.song.duration||entry.signature!==songSignature(P))return at(P,t);
  if(!entry._floats){
    let bytes;if(typeof atob==='function'){const raw=atob(entry.data);bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));}
    else if(typeof Buffer!=='undefined')bytes=Uint8Array.from(Buffer.from(entry.data,'base64'));else return at(P,t);
    entry._floats=new Float32Array(bytes.buffer);
  }
  const x=t*30,i=Math.min(entry.frames-1,Math.floor(x)),j=Math.min(entry.frames-1,i+1),u=x-i,n=new Array(entry.width),data=entry._floats;
  // Fast transitions and ill-conditioned FK intervals are never interpolated.
  if(u>1e-7 && entry.guard?.[i])return at(P,t);
  for(let k=0;k<entry.width;k++)n[k]=data[i*entry.width+k]+(data[j*entry.width+k]-data[i*entry.width+k])*u;
  const S=cacheUnflatten(entry.schema,n,entry.strings[u<.5?i:j],{n:0,s:0});
  for(const key of ['activeStrings','sounding'])S[key]=S[key].values.slice(0,Math.round(S[key].count));
  S.debug.activeNotes=S.debug.activeNotes.values.slice(0,Math.round(S.debug.activeNotes.count));S.frame=window.ViolinModel.frame();S.time=t;S.expression=expressionAt(P,t);
  // Rebuild rigid contacts after cache interpolation instead of stretching fingers.
  S.handR=window.BowHand.create('violin',S.bow.frogStick,S.bow.axis,S.bow.down);
  S.armR=bowArm(S.armR.shoulder,S.handR.wrist,S.bow.string);S.debug.arms=[S.armL,S.armR];
  return S;
}
return { expressionAt,bowArm, plan, at, atCached, packPose, songSignature, cacheStamp, setPoseCache, atLegacy, setHandSolver, NH, solveChain, solveArm, handDistAt, bowAt, vibrato, VIB, BOW_TILT, FINGER_LENGTHS };
})();

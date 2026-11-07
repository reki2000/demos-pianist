'use strict';
/* Cello motion: turns a planned song (see cello-fingering.js) into a
 * posed performer at any time t, and draws it through a
 * RecitalGL-compatible renderer.
 *
 * plan(song) runs the fingering/bowing engine and caches the result on
 * song.cello. pose(song, t) is pure data (used by the tests):
 *   {leftArm:{shoulder,elbow,wrist}, rightArm:{...},
 *    fingers:{1..4:{points[4], contact, target}}, thumb:{points},
 *    bow:{frog,tip,contact,string}, hand:{anchor,mode}, sway}
 * draw(renderer, song, t) renders cello, bow and performer from pose().
 *
 * Motion follows the pianist app's lessons: the left hand starts moving
 * toward the next position ~180 ms before the note (using most of the
 * gap, easing in), fingers hover just above the fingerboard when free
 * and keep a natural curl, and the torso sways gently with the phrase.
 * Fingertips land on the planned string point: each finger is a
 * 3-segment chain posed by exact planar two-bone IK (the distal pair
 * keeps a fixed 0.35 rad curl), so contact error is ~0 by construction.
 */
window.CelloMotion = (() => {
  const M = window.CelloModel, F = window.CelloFingering;
  const { add, sub, mul, dot, norm, lerp } = M.vec;
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const slerp = (a, b, t) => a + (b - a) * t;
  const smooth = x => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };

  // ---- skeleton (planning coords, metres) ----
  // RecitalGL planning frame (the renderer reflects X): the performer's
  // LEFT shoulder sits at +X, the right (bow) shoulder at -X.
  const SHOULDER_L = [0.205, 1.13, 0.07], SHOULDER_R = [-0.205, 1.13, 0.07];
  const ARM = [0.30, 0.28]; // upper, forearm
  // Per-finger dimensions (metres) — a human hand is not four copies
  // of one finger. Totals follow standard hand anthropometry
  // (Garrett / ANSUR-style tables) with the middle finger as the
  // 1.00 reference at 100 mm: index 0.93, ring 0.97, little 0.76.
  // Segment splits sit near proximal:middle:distal = 1 : 0.65 : 0.5
  // with per-finger variation, and the segment radii follow the
  // same ordering (little thinnest, middle stoutest of the four).
  // The thumb is a metacarpal + two phalanges, shortest and
  // stoutest of the five digits.
  const FINGER_LEN = { 1: [0.043, 0.029, 0.021], 2: [0.046, 0.031, 0.023], 3: [0.045, 0.030, 0.022], 4: [0.036, 0.023, 0.017] };
  const FINGER_R = { 1: [0.0130, 0.0120, 0.0105], 2: [0.0140, 0.0130, 0.0110], 3: [0.0135, 0.0125, 0.0105], 4: [0.0115, 0.0105, 0.0090] };
  const THUMB_LEN = [0.044, 0.030, 0.022]; // metacarpal, proximal, distal
  const THUMB_R = [0.0160, 0.0145, 0.0125];
  // Knuckle-row arc: each root's setback from the row line along the
  // palm's proximal direction — the middle knuckle is the most
  // distal, the little finger's knuckle sits 9 mm back.
  const KNUCKLE_ARC = { 1: 0.0035, 2: 0, 3: 0.002, 4: 0.009 };
  const ROW_S = 0.022; // MCP spacing along the knuckle row
  const PALM_LEN = 0.093; // wrist joint -> middle knuckle; anatomical band 85-100 mm at this figure's ~1.0 scale (forearm 0.28, head height ~0.25)

  // ---- Joint range-of-motion table (rk's governing method) ----
  // Anatomical limits in radians, from standard goniometry
  // references (AAOS / Norkin joint-motion norms); where a tighter
  // "play" bound is listed, it is the range a cello posture
  // actually uses. The pose is solved BACKWARD from the contact
  // points (the four fingertips' string points, the thumb's rest
  // on the neck back / board anchor): fingertips -> finger joints
  // -> knuckle row -> wrist -> forearm -> elbow -> shoulder, with
  // every joint kept inside this table; if a contact cannot be
  // met in ROM the solution moves proximally, never past a limit.
  const ROM = {
    SHOULDER: { coneFromDown: 2.01 },       // upper arm within 115 deg of hanging straight down: anatomical flexion runs to ~150, and the cello left arm works high (the hand is at head height, so the elbow rides near shoulder height even in low positions -- a generic 78 deg cone measured ZERO feasible elbows)
    ELBOW: { flex: [0.09, 2.53] },          // hinge flexion 5..145 deg; hyperextension (< 0) impossible by construction
    FOREARM: { pronation: [-0.35, 0.61] },  // palm roll about the forearm axis, -20..+35 deg
    WRIST: { flex: [-0.035, 0.70], radial: 0.35, ulnar: 0.52 }, // SIGNED (rk): palmar flexion -2..+40 deg -- extension (cocking the wrist back) is ~0, it never happens in playing; radial deviation <= 20 deg, ulnar <= 30 deg (AAOS)
    FINGER: { MCP: [0, 1.57], PIP: [0, 1.57], DIP: [0, 1.22] }, // rk 2026-11-08, per joint, in the PALM frame: flexion (toward the palm) 0..90 deg, extension (backward) 0 -- never; lateral deviation: MCP <= 30 deg, PIP/DIP exactly 0 (the chain bends in the palm flexion plane). PIP's old 100 deg cap is superseded by the 90 deg line; DIP's 70 deg cap stands (inside the line).
    THUMB: { MCP: [0, 0.96], IP: [0, 1.48] }                    // flexion 0..55 / 0..85 deg, palmar only -- a dorsal bend is a failure, not a posture (functional grip values: AAOS nominal is 50/80, goniometry references run to 60/90; these caps bind only at the shortest spans)
  };

  // ---- Placement variants (rk picks the most natural) --------
  // All three pinch the neck from the back-left (wrist and palm on
  // the player's side of the neck axis and toward the A-string
  // side, thumb on the back-left ridge, fingers over the board);
  // they differ in elbow carriage, pinch depth and palm roll --
  // three legitimate in-ROM readings of "natural".
  //   wristU / wristSide / wristN: (u, v, n) components of the
  //     wrist->knuckle axis seed (n slerps to 0.72 over lam); a
  //     POSITIVE v component puts the wrist on the -v (player's
  //     left) side of the knuckles. RK ROUND 2: the axis is
  //     ALONG-NECK DOMINANT in every variant -- a real hand's
  //     wrist sits far down-neck of its knuckles with the palm
  //     lying along the neck's back-left; the phase-1 axis pointed
  //     mostly off-board (n ~ 0.96), which parked the wrist, and
  //     with it the thumb's base, beside the knuckles: the root
  //     cause of both the ~160 deg drawn base-joint bend rk
  //     measured in the renders and the thumb spans (28-65 mm
  //     for a 96 mm chain) too short to fold without a kink.
  //   wristBack: the wrist joint centre's front/back target vs
  //     the neck axis along the board normal (negative = behind
  //     the axis), used by the neck-frame wrist placement.
  //   stationBack / wristSideM: that placement's down-neck
  //     distance from the middle knuckle's station and its
  //     distance toward the player's left (-v) from the axis.
  //   elbowY: preferred elbow height (planning Y; shoulder is
  //     1.13).
  //   devW: score weight on the signed wrist posture (flexion vs
  //     the variant's flexPref, plus deviation) -- how much of
  //     the trade each variant spends on wrist posture vs the
  //     elbow carriage.
  //   palmRoll: hand twist about the knuckle-row axis (pronation).
  //   flexPref: the gentle palmar wrist flexion the elbow search
  //     prefers (the wrist itself never extends -- ROM.WRIST).
  const VARIANTS = {
    A: { name: 'A', wristU: 0.52, wristSide: 0.33, wristN: 0.78, wristBack: -0.006, stationBack: 0.038, wristSideM: 0.034, wristFloor: 0.037, elbowY: 1.205, devW: 0.10, palmRoll: 0, flexPref: 0.10 },
    B: { name: 'B', wristU: 0.60, wristSide: 0.38, wristN: 0.72, wristBack: -0.014, stationBack: 0.048, wristSideM: 0.042, wristFloor: 0.037, elbowY: 1.255, devW: 0.45, palmRoll: 0.21, flexPref: 0.22 },
    C: { name: 'C', wristU: 0.68, wristSide: 0.28, wristN: 0.66, wristBack: -0.018, stationBack: 0.052, wristSideM: 0.045, wristFloor: 0.037, elbowY: 1.28, devW: 1.20, palmRoll: -0.14, flexPref: 0.30 }
  };
  // SHIPPED DEFAULT: variant C (rk's pick, 2026-11-07 -- "most
  // natural" of the three round-2 readings: deepest pinch,
  // straightest wrist, most compact carriage). The app path
  // produces C with no variant flags; setVariant remains only
  // as a dev tool (tools/shot-variants.mjs) for re-checking the
  // other readings against a future change.
  let VARI = { ...VARIANTS.C };
  function setVariant(name) {
    const v = VARIANTS[name];
    if (!v) throw new Error('unknown cello variant: ' + name);
    VARI = { ...v };
    return VARI;
  }

  function solveElbow(S, W, pole) {
    const [L1, L2] = ARM;
    let d = sub(W, S), dist = clamp(Math.hypot(...d), 0.05, (L1 + L2) * 0.999);
    const dir = norm(d);
    const a = (L1 * L1 - L2 * L2 + dist * dist) / (2 * dist);
    const h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
    let perp = sub(pole, mul(dir, pole.reduce((s, v, i) => s + v * dir[i], 0)));
    perp = norm(perp);
    return add(add(S, mul(dir, a)), mul(perp, h));
  }

  // Raw 3-segment finger chain from base B to target T in the
  // bend plane whose normal is planeN: proximal segment two-bone-
  // IK'd onto the virtual distal bone, distal pair held at a
  // FIXED relative bend (curl). The tip lands on T exactly for
  // any curl.
  function fingerChainRaw(B, T, lens, planeN, curl) {
    const [l1, l2, l3] = lens;
    const L23 = Math.sqrt(l2 * l2 + l3 * l3 + 2 * l2 * l3 * Math.cos(curl));
    let d = sub(T, B), dist = clamp(Math.hypot(...d), 0.02, (l1 + L23) * 0.999);
    const dir = norm(d);
    let side = sub(planeN, mul(dir, planeN.reduce((s, v, i) => s + v * dir[i], 0)));
    side = Math.hypot(...side) < 1e-6 ? [0, 0, 1] : norm(side); // in-plane bend direction
    const a = (l1 * l1 - L23 * L23 + dist * dist) / (2 * dist);
    const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
    const J = add(add(B, mul(dir, a)), mul(side, h));
    // Virtual distal direction (J -> T), then rotate by psi around the
    // plane normal to get segment 2's true direction.
    const vd = norm(sub(T, J));
    const psi = Math.atan2(l3 * Math.sin(curl), l2 + l3 * Math.cos(curl));
    const ax = norm(M.vec.cross(vd, side)); // rotation axis ~ plane normal
    const rot = (vec, ang) => {
      const c = Math.cos(ang), s = Math.sin(ang);
      return add(add(mul(vec, c), mul(M.vec.cross(ax, vec), s)), mul(ax, M.vec.dot(ax, vec) * (1 - c)));
    };
    const d2 = rot(vd, psi);
    const J2 = add(J, mul(d2, l2));
    const tip = add(J2, mul(rot(d2, -curl), l3));
    return [B, J, J2, tip];
  }
  const chainBends = pts => [
    Math.acos(clamp(dot(norm(sub(pts[1], pts[0])), norm(sub(pts[2], pts[1]))), -1, 1)),
    Math.acos(clamp(dot(norm(sub(pts[2], pts[1])), norm(sub(pts[3], pts[2]))), -1, 1))
  ];
  // Signed PIP flexion in the chain's own frame (rk 2026-11-08:
  // a joint bends toward the palm only, never backward). The
  // chain bulges toward `side` (the plane normal's in-plane
  // direction, the back-of-hand side), so flexion -- the outgoing
  // segment rotating toward the palm side of the plane -- is the
  // negative rotation about cross(dir, side). Verified against
  // the palm-frame decomposition: pressing chains read +33..+84
  // deg, the one backward case (little finger at near-full span)
  // reads -8.5 deg in both frames.
  const pipFlexOf = (B, T, planeN, pts) => {
    const dir = norm(sub(T, B));
    const side = norm(sub(planeN, mul(dir, dot(planeN, dir))));
    const nb = norm(M.vec.cross(dir, side));
    const s1 = norm(sub(pts[1], pts[0])), s2 = norm(sub(pts[2], pts[1]));
    return -Math.atan2(dot(M.vec.cross(s1, s2), nb), dot(s1, s2));
  };
  // CHAIN-LEVEL ROM CLAMPING (phase 2): the raw chain dumps the
  // whole fold into the PIP joint whenever the span is short --
  // measured up to 117 deg against the 100 deg ROM cap, worst in
  // hover/transit frames where nobody was looking. The distal
  // bend (DIP) starts at the frame's rest curl (16-32 deg of its
  // 70 deg cap), so the chain itself now trades fold from PIP
  // into DIP: if the PIP bend at the rest curl exceeds its cap,
  // the curl is raised (bisected, smallest sufficient) until the
  // PIP is inside its cap -- both joints then satisfy the ROM
  // table BY CONSTRUCTION and the tip still lands exactly. If
  // even the DIP cap cannot bring the PIP inside its cap the
  // span itself is infeasible; the chain is returned flagged
  // (.infeasible) and the caller repairs the span proximally
  // (knuckle away from the target -- see pose()). The returned
  // array carries .pip/.dip/.curlUsed/.infeasible for the tests.
  function fingerChain(B, T, lens, planeN, curl = 0.35) {
    const PIPCAP = ROM.FINGER.PIP[1], DIPCAP = ROM.FINGER.DIP[1];
    let pts = fingerChainRaw(B, T, lens, planeN, curl);
    let [pip, dip] = chainBends(pts);
    let cUse = curl, infeasible = false;
    if (pip > PIPCAP) {
      const ptsHi = fingerChainRaw(B, T, lens, planeN, DIPCAP);
      if (chainBends(ptsHi)[0] > PIPCAP) {
        pts = ptsHi; cUse = DIPCAP; infeasible = true;
      } else {
        let lo = curl, hi = DIPCAP;
        for (let i = 0; i < 12; i++) {
          const mid = (lo + hi) / 2;
          if (chainBends(fingerChainRaw(B, T, lens, planeN, mid))[0] > PIPCAP) lo = mid; else hi = mid;
        }
        cUse = hi;
        pts = fingerChainRaw(B, T, lens, planeN, cUse);
      }
      [pip, dip] = chainBends(pts);
    }
    // PIP FLOOR (rk 2026-11-08, same rule): at near-full span the
    // fixed rest curl forces the PIP a few degrees BACKWARD (the
    // DIP holds 31.5 deg and the PIP compensates to still reach)
    // -- measured -8.6 deg on the little finger in neck-position
    // contact frames. A stretched finger flattens its DIP in
    // reality, so the chain trades the other way: bisect the
    // curl DOWN to the largest value whose PIP flexion is still
    // >= 0. The tip still lands exactly (the raw construction
    // reaches T at any curl). If even a straight distal segment
    // folds backward the span/placement is infeasible -- flagged,
    // never silently relaxed.
    if (pipFlexOf(B, T, planeN, pts) < 0) {
      const flat = fingerChainRaw(B, T, lens, planeN, 0);
      if (pipFlexOf(B, T, planeN, flat) < 0) {
        pts = flat; cUse = 0; infeasible = true;
      } else {
        let lo = 0, hi = cUse;
        for (let i = 0; i < 12; i++) {
          const mid = (lo + hi) / 2;
          if (pipFlexOf(B, T, planeN, fingerChainRaw(B, T, lens, planeN, mid)) < 0.001) hi = mid; else lo = mid;
        }
        cUse = lo;
        pts = fingerChainRaw(B, T, lens, planeN, cUse);
      }
      [pip, dip] = chainBends(pts);
    }
    pts.pip = pip; pts.dip = dip; pts.curlUsed = cUse; pts.infeasible = infeasible;
    return pts;
  }
  // Smallest knuckle->target span at which a finger's chain can
  // still meet BOTH caps (PIP at its cap with the DIP at its
  // own): the floor under the MCP guard's shrink lever and the
  // reference for the span repair. A pure function of the
  // segment lengths (the bends depend only on the span),
  // bisected once here.
  const MIN_SPAN = {};
  for (let f = 1; f <= 4; f++) {
    const lens = FINGER_LEN[f];
    let lo = 0.005, hi = lens[0] + lens[1] + lens[2];
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      const pts = fingerChainRaw([0, 0, 0], [mid, 0, 0], lens, [0, 0, 1], ROM.FINGER.DIP[1]);
      if (chainBends(pts)[0] > ROM.FINGER.PIP[1]) lo = mid; else hi = mid;
    }
    MIN_SPAN[f] = hi;
  }

  // Thumb chain (rk round 2): the finger solver above folds the
  // chain at ONE virtual joint with a fixed distal curl -- for
  // the thumb's short spans that dumped a 90-160 deg kink into
  // the MCP joint, bowed toward the back-of-hand side, which rk
  // flagged in every variant. This solver works in the thumb's
  // bend plane (root->tip direction x palmar side) and
  // DISTRIBUTES the fold: the IP bend grows coupled to the MCP
  // bend, the MCP bend is bisected so the resultant length
  // matches the span, both capped by ROM.THUMB; if the span is
  // shorter than the capped chain can fold to, the caller
  // retreats the root toward the wrist (proximal fix) before
  // this runs. Every bend is palmar-signed BY CONSTRUCTION (the
  // segment angles increase monotonically toward the palmar
  // side); the base angle gamma (the CMC joint) aligns the
  // resultant onto the root->tip line, which puts the first
  // joint on the dorsal side of the chord -- the knuckle side,
  // a smooth arc hugging toward the neck -- never a backward
  // kink. Returns the bend angles for the sweep report.
  function thumbChain(B, T, dorsalRef) {
    const [l1, l2, l3] = THUMB_LEN;
    const B1C = ROM.THUMB.MCP[1], B2C = ROM.THUMB.IP[1];
    let dirv = sub(T, B), dist = Math.hypot(...dirv);
    dirv = norm(dirv);
    let palmar = sub(mul(dorsalRef, -1), mul(dirv, -dot(dorsalRef, dirv)));
    palmar = Math.hypot(...palmar) < 1e-6 ? [0, 0, 1] : norm(palmar);
    const resLen = (b1, b2) => Math.hypot(
      l1 + l2 * Math.cos(b1) + l3 * Math.cos(b1 + b2),
      l2 * Math.sin(b1) + l3 * Math.sin(b1 + b2));
    const dT = clamp(dist, 0.03, (l1 + l2 + l3) * 0.999);
    // The fold is DISTRIBUTED like a real gripping thumb: the
    // IP bend grows with the MCP bend (b2 = 0.35 + 1.1*b1, so a
    // gentle MCP bend keeps a gentle tip curl and a deep one
    // curls the tip most), and b1 is bisected so the resultant
    // length matches the span. Only if the span is shorter than
    // even that distribution reaches at the MCP cap does the IP
    // bend rise alone to its own cap.
    const b2of = b1 => Math.min(B2C, 0.35 + 1.1 * b1);
    let b1 = 0, b2 = b2of(0);
    if (dT < resLen(B1C, b2of(B1C))) {
      b1 = B1C; // shorter than the distributed fold reaches
      if (dT >= resLen(b1, B2C)) {
        let lo = b2of(b1), hi = B2C;
        for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; if (resLen(b1, mid) > dT) lo = mid; else hi = mid; }
        b2 = (lo + hi) / 2;
      } else b2 = B2C;
    } else if (dT < resLen(0, b2)) {
      let lo = 0, hi = B1C;
      for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; if (resLen(mid, b2of(mid)) > dT) lo = mid; else hi = mid; }
      b1 = (lo + hi) / 2; b2 = b2of(b1);
    }
    const Vx = l1 + l2 * Math.cos(b1) + l3 * Math.cos(b1 + b2);
    const Vy = l2 * Math.sin(b1) + l3 * Math.sin(b1 + b2);
    const gamma = -Math.atan2(Vy, Vx);
    const e = a => add(mul(dirv, Math.cos(a)), mul(palmar, Math.sin(a)));
    const P1 = add(B, mul(e(gamma), l1));
    const P2 = add(P1, mul(e(gamma + b1), l2));
    const P3 = add(P2, mul(e(gamma + b1 + b2), l3));
    return { points: [B, P1, P2, P3], beta1: b1, beta2: b2, gamma, tipErr: Math.hypot(...sub(P3, T)) };
  }

  // Same solver as cello-model's eulerZYX: angles that put a piece()'s
  // local X/Y/Z onto the given orthonormal frame.
  function eulerZYX(xA, yA, zA) {
    const ry = Math.atan2(-xA[2], Math.hypot(xA[0], xA[1]));
    return [Math.atan2(yA[2], zA[2]), ry, Math.atan2(xA[1], xA[0])];
  }

  // Keyframe track with "arrive just before the event" easing.
  function track(keys) { // keys: [{t, v:[x,y,z]}] sorted
    return t => {
      if (!keys.length) return null;
      if (t <= keys[0].t) return keys[0].v;
      for (let i = 0; i < keys.length - 1; i++) {
        const a = keys[i], b = keys[i + 1];
        if (t < b.t) {
          const lead = Math.min(0.18, Math.max(0.03, (b.t - a.t) * 0.85));
          const p = smooth((t - (b.t - lead)) / lead);
          return lerp(a.v, b.v, p);
        }
      }
      return keys[keys.length - 1].v;
    };
  }
  const scalarTrack = keys => { // [{t, v:number}]
    const tr = track(keys.map(k => ({ t: k.t, v: [k.v, 0, 0] })));
    return t => tr(t)[0];
  };

  function plan(song) {
    const o = song.celloOptions || {};
    const res = F.plan(song, {
      secPerBeat: o.secPerBeat || 0.5,
      maxStrokeBeats: o.maxStrokeBeats || 2,
      openStringCost: o.openStringCost != null ? o.openStringCost : 0.1
    });
    song.cello = res;
    // Left-hand anchor keyframes: one per group with a stopped note.
    // The anchor is the knuckle reference of the group's primary finger.
    const keys = [], bowKeys = [], strKeys = [];
    let lastAnchor = null;
    song.notes.forEach((n, i) => {
      const r = res.notes[i];
      if (r.mode !== 'open') {
        const anchorK = r.mode === 'thumb' ? r.position : r.position;
        const pt = M.boardPoint(r.string, F.distFromNut(r.semitone) / 1000);
        keys.push({ t: n[0], v: pt, finger: r.finger, string: r.string, semitone: r.semitone, mode: r.mode, position: r.position });
        lastAnchor = pt;
      }
      bowKeys.push({ t: n[0], v: r.bowFrom }, { t: n[0] + n[1], v: r.bowTo });
      strKeys.push({ t: n[0], v: r.string });
    });
    song.cello.tracks = {
      anchor: track(keys), anchorKeys: keys,
      bow: scalarTrack(bowKeys), bowKeys,
      string: scalarTrack(strKeys)
    };
    return res;
  }

  // Which planned notes sound at time t (with a little anticipation for
  // finger preparation), and the current hand placement.
  function activeAt(song, t) {
    const res = song.cello;
    let current = null, sounding = [];
    song.notes.forEach((n, i) => {
      const r = res.notes[i];
      if (n[0] <= t && n[0] + n[1] > t) { sounding.push({ n, r }); if (r.mode !== 'open') current = r; }
    });
    if (!current) { // most recent stopped placement at or before t
      for (let i = song.notes.length - 1; i >= 0; i--) {
        if (song.notes[i][0] <= t && res.notes[i].mode !== 'open') { current = res.notes[i]; break; }
      }
    }
    if (!current) { // before the first stopped note of the song, the
      // hand waits AT the upcoming placement (the anchor track already
      // sits there) -- without this the free fingers hovered at a
      // default neck position while the wrist waited at the first
      // (e.g. thumb-position) anchor, tearing the hand apart by up to
      // ~0.29 m during an intro (The Swan enters at t = 6 s).
      for (let i = 0; i < song.notes.length; i++) {
        if (res.notes[i].mode !== 'open') { current = res.notes[i]; break; }
      }
    }
    return { sounding, current };
  }

  function pose(song, t) {
    if (!song.cello) plan(song);
    const res = song.cello, tr = res.tracks;
    const { sounding, current } = activeAt(song, t);
    const mode = current ? current.mode : 'neck';
    const anchorString = current ? current.string : 2;
    // Hand anchor point (on the board, under the hand).
    let anchorPt = tr.anchor(t);
    if (!anchorPt) anchorPt = M.boardPoint(2, F.distFromNut(2) / 1000);
    // Vibrato: long sounding notes, after a 0.3 s settle.
    let vib = 0;
    for (const { n } of sounding) if (n[1] >= 0.8 && t - n[0] > 0.3 && n[0] + n[1] - t > 0.1)
      vib = Math.max(vib, Math.min(1, (t - n[0] - 0.3) / 0.4) * Math.sin((t - n[0]) * 2 * Math.PI * 5.4) * 0.004);
    if (vib) anchorPt = add(anchorPt, mul(M.u, vib));
    // ---- Left-hand posture, rk's playing-form spec ----
    // A continuous posture parameter lam follows the hand's distance
    // from the nut (it rides the eased anchor track, so it never
    // snaps at the neck/thumb boundary):
    //   lam = 0 (neck root): the back of the hand faces the audience
    //     and the fingers stay comparatively straight at the base
    //     joint, reaching over the fingerboard nearly extended, the
    //     hook concentrated in the tip joints.
    //   lam = 1 (fingerboard end / thumb positions): the hand rolls
    //     ~100 deg about the neck axis so the back of the hand faces
    //     the player's left; the fingers bend FROM the base joint
    //     (short, hooked chains) and the fingertips point back toward
    //     the player.
    // The hand is built palm-frame first (rebuilt 2026-11). The
    // palm's distal axis (wrist -> middle knuckle), in (u, v, n)
    // components, is the PINCH direction (rk's correction): the
    // hand wraps the neck from its back-left -- the wrist sits
    // BEHIND the neck axis (the axis' -n side) and toward the
    // A-string side (-v, the player's left across the neck), the
    // thumb rests on the back-left ridge, and the fingers curl
    // over the board from that side, so the neck sits between
    // thumb and fingers. A POSITIVE v component here puts the
    // wrist on the -v side of the knuckles (wrist = knuckle -
    // axis * PALM_LEN). The pre-fix axis (v -0.52, n 0.70) put
    // the wrist in FRONT of the axis (+38 mm) and toward the
    // C side (+62 mm): measured over 116 neck frames, palm
    // centre +71 mm audience-side -- the hand draped over the
    // front-right and no test asserted the side. The wrist JOINT
    // is PALM_LEN proximal of the middle knuckle along this axis
    // (then pinched to the variant's back offset, below), the
    // palm plate spans wrist -> knuckle row, and the finger
    // chains run from roots ON the row. ROUND 2 (rk): the axis
    // seed is now along-neck dominant in every variant (see
    // VARIANTS) -- phase 1's off-board axis (u ~ 0.2, n ~ 0.96)
    // had put the wrist up beside the knuckles, which bent the
    // DRAWN base joints to ~160 deg and left the thumb a 28-65
    // mm span for its 96 mm chain.
    const dA = M.SCALE - dot(sub(anchorPt, M.AB), M.u); // hand distance from the nut
    const lam = smooth((dA - 0.20) / 0.14);
    const phi = lam * 1.745; // hand roll about the neck axis, 0 -> ~100 deg
    const backN = add(mul(M.n, Math.cos(phi)), mul(M.v, -Math.sin(phi))); // back-of-hand normal
    const sw = Math.sin(Math.PI * lam);
    const palmAxis = norm(add(
      mul(M.u, slerp(VARI.wristU, 0.55, lam)),
      add(mul(M.v, slerp(VARI.wristSide, 0.42, lam)),
        mul(M.n, slerp(VARI.wristN, 0.72, lam)))));
    // Finger approach: knuckle = target + appDir * (reach * rho).
    // Neck: rho ~ 0.98 (nearly straight chain, tip curl 0.55) with
    // the approach rotated toward the nut so the knuckle row rides
    // ~33 mm off the board surface, and tilted a touch toward the
    // player's left (-v): the fingers wrap over the board FROM
    // the back-left pinch, not squarely from the front. End:
    // rho ~ 0.58 (folded chain, tip curl 0.28) with the approach
    // swung toward the player's left, following the hand roll.
    // The chains always hook in the string's sagittal plane
    // (bulge reference M.n): in the end posture the knuckle sits
    // to the player's left of the target, so the finger travels
    // across and the folded tip ends pointing back toward the
    // player (-n).
    const curlF = slerp(0.55, 0.28, lam), rho = slerp(0.98, 0.58, lam);
    const appDir = norm(add(
      mul(M.u, slerp(0.88, 0.35, lam)),
      add(mul(M.v, slerp(-0.10, -0.62, lam)), mul(M.n, slerp(0.40, 0.70, lam)))));
    // Fingers. Targets first (stopping fingers on their planned
    // string point, free fingers hovering over their upcoming
    // notes), then the knuckles: with one shared approach direction
    // the roots were parallel translates of the targets and spanned
    // up to ~0.16 m along the board -- a rake, not a hand, and no
    // hand-shaped palm could cover them. Instead the roots sit on a
    // compact knuckle row (spacing 22 mm) through the primary
    // finger's root, each chain tilted to its row station at its
    // canonical length. Free fingers angle forward from the hand
    // to their hover points, as real fingers do.
    const fingers = {};
    const stopping = {};
    for (const { r } of sounding) if (r.mode !== 'open' && r.finger !== 'T') stopping[r.finger] = r;
    const targets = {}, contacts = {}, reaches = {};
    for (let f = 1; f <= 4; f++) {
      const st = stopping[f];
      let target, contact = false;
      if (st) {
        target = add(M.boardPoint(st.string, F.distFromNut(st.semitone) / 1000), mul(M.n, 0.001));
        contact = true;
      } else if (mode === 'thumb') {
        // In thumb position free fingers hover over the board nearby.
        const k = (current ? current.position : 12) + 2 + (f - 1);
        target = add(M.boardPoint(anchorString, F.distFromNut(Math.min(k, 24)) / 1000), mul(M.n, 0.016));
      } else {
        const base = current ? current.position : 2;
        const k = base + (f - 1);
        target = add(M.boardPoint(anchorString, F.distFromNut(k) / 1000), mul(M.n, 0.014));
      }
      if (vib && contact) target = add(target, mul(M.u, vib));
      targets[f] = target; contacts[f] = contact;
      const [l1, l2, l3] = FINGER_LEN[f];
      reaches[f] = (l1 + Math.sqrt(l2 * l2 + l3 * l3 + 2 * l2 * l3 * Math.cos(curlF))) * rho;
    }
    // Primary finger: the stopping finger whose target defines the
    // hand placement (nearest the anchor); if none stops, the
    // current placement's finger.
    let prim = 0, primD = Infinity;
    for (let f = 1; f <= 4; f++) if (contacts[f]) {
      const d = Math.hypot(...sub(targets[f], anchorPt));
      if (d < primD) { primD = d; prim = f; }
    }
    if (!prim) prim = (current && current.finger >= 1 && current.finger <= 4) ? current.finger : 1;
    // Free fingers hover near the hand, not stretched out over
    // their upcoming notes: pull each hover target 35% toward the
    // primary target (keeping its hover lift). A relaxed hand's
    // free fingertips stay within the hand's own span; the stretched
    // hovers were what forced the knuckle row (and the palm fitted
    // to it) up to ~0.16 m long in low positions.
    for (let f = 1; f <= 4; f++) if (!contacts[f] && f !== prim) {
      targets[f] = add(lerp(targets[prim], targets[f], 0.65), mul(M.n, 0.0046));
      // Cap the hover distance from the primary target at 55 mm:
      // a free fingertip hovers within the hand's own reach, it
      // does not stretch out over a note a hand-span away (the
      // uncapped hovers were what raked the knuckle row open).
      const hd = sub(targets[f], targets[prim]), hl = Math.hypot(...hd);
      if (hl > 0.055) targets[f] = add(targets[prim], mul(hd, 0.055 / hl));
    }
    const rowDir = norm(sub(M.BOARD.dir, mul(appDir, dot(M.BOARD.dir, appDir))));
    // Knuckle row: each root keeps its finger's canonical chain
    // length |root - target| = reach * rho (fingertip contact
    // exact by construction) while its station along the row --
    // dot(root - root_prim, rowDir) -- is (f - prim) * ROW_S: the
    // closed-form fan tilt in the {appDir, rowDir} plane that
    // lands the root on its station. The knuckle ARC is then
    // applied as a setback along the palm's proximal direction
    // and re-projected onto the reach sphere (two passes), which
    // moves the station by ~1 mm at most: the row the palm frame
    // is fitted to carries the arc (middle knuckle most distal,
    // little 9 mm back) with contact still exact.
    const primRoot = add(targets[prim], mul(appDir, reaches[prim]));
    const proxRaw = mul(palmAxis, -1);
    const proxDir = norm(sub(proxRaw, mul(rowDir, dot(proxRaw, rowDir))));
    const rootOf = f => {
      if (f === prim) return primRoot;
      const D = (f - prim) * ROW_S - dot(sub(targets[f], targets[prim]), rowDir);
      const g = clamp(D / reaches[f], -0.92, 0.92);
      const w = g / Math.sqrt(1 - g * g);
      let root = add(targets[f], mul(norm(add(appDir, mul(rowDir, w))), reaches[f]));
      for (let it = 0; it < 2; it++) {
        const shifted = add(root, mul(proxDir, -(KNUCKLE_ARC[f] - KNUCKLE_ARC[prim]) / 2));
        root = add(targets[f], mul(norm(sub(shifted, targets[f])), reaches[f]));
      }
      return root;
    };
    const knuckles = {};
    for (let f = 1; f <= 4; f++) knuckles[f] = rootOf(f);
    // ---- Wrist placement + drawn base-joint (MCP) guard -------
    // The wrist is placed at an ANATOMICAL TARGET in the neck
    // frame (rk round 2): down-neck of the middle knuckle's
    // station by the variant's stationBack, just behind the neck
    // axis along the board normal (wristBack), and toward the
    // player's left (wristSideM) -- where a real wrist joint
    // centre sits in neck positions, under the fingerboard's
    // left edge. As lam -> 1 (thumb positions) the placement
    // blends to the palm-axis seed (midRoot - palmAxis*PALM_LEN),
    // which measured correctly there. The earlier construction
    // (seed + a board-normal slide cap + a length clamp) was
    // over-constrained: the guards deformed the wrist to ~70 mm
    // radial from the axis with the palm axis ~0.9 off-board,
    // and no elbow on the hinge circle could then keep the
    // signed wrist flexion under ~39 deg in neck positions.
    // Two safety guards remain: a radial floor off the neck
    // cylinder, and the palm-length band, applied by scaling the
    // actual displacement. The second argument relaxes the
    // front/back target (the MCP guard's proximal lever).
    const neckAxisDir = norm(sub(M.NECK_B, M.NECK_A));
    const axisLen = Math.hypot(...sub(M.NECK_B, M.NECK_A));
    const placeWrist = (midR, fbOff, stOff = 0, sdOff = 0, axOff = 0, latOff = 0, rowOff = 0, rowDir = null) => {
      // axOff shifts the seed along the palm axis (the wrist
      // sits a few mm nearer/farther within the palm-length
      // band below): the only placement lever that still moves
      // the wrist at lam = 1, where the neck-frame target is
      // weighted out entirely. latOff shifts it sideways along
      // the across-strings direction (perpendicular to the
      // axis), which rotates the palm axis itself -- the lever
      // the thumb-position deviation needs (measured: at the
      // worst Swan frames the whole hinge circle is wedge-
      // infeasible until the palm axis turns a few degrees).
      // rowOff shifts it along the KNUCKLE ROW direction --
      // the in-palm-plane swing of the palm axis, which the
      // deviation floor answers to most strongly (measured at
      // the worst frame: -0.16 rad of swing takes the floor
      // from 26 deg to 16 deg; the same roll buys 1 deg).
      let latDir = sub(M.v, mul(palmAxis, dot(M.v, palmAxis)));
      latDir = Math.hypot(...latDir) > 1e-9 ? norm(latDir) : [1, 0, 0];
      let rowDirW = rowDir ? sub(rowDir, mul(palmAxis, dot(rowDir, palmAxis))) : null;
      rowDirW = rowDirW && Math.hypot(...rowDirW) > 1e-9 ? norm(rowDirW) : latDir;
      const seedW = add(add(sub(midR, mul(palmAxis, PALM_LEN + axOff)), mul(latDir, latOff)), mul(rowDirW, rowOff));
      const axPt = add(M.NECK_A, mul(neckAxisDir,
        clamp(dot(sub(midR, M.NECK_A), neckAxisDir), 0, axisLen)));
      const neckW = add(add(axPt, mul(neckAxisDir, -(VARI.stationBack + stOff))),
        add(mul(M.BOARD.normal, fbOff), mul(M.v, -(VARI.wristSideM + sdOff))));
      let w = add(mul(neckW, 1 - lam), mul(seedW, lam));
      const axPtOf = p => add(M.NECK_A, mul(neckAxisDir,
        clamp(dot(sub(p, M.NECK_A), neckAxisDir), 0, axisLen)));
      const axPtW = axPtOf(w);
      const radial = sub(w, axPtW), rd = Math.hypot(...radial);
      if (rd < VARI.wristFloor && rd > 1e-9) w = add(w, mul(radial, (VARI.wristFloor - rd) / rd));
      const stretched = Math.hypot(...sub(midR, w));
      if (stretched > 0.0995) w = add(midR, mul(sub(w, midR), 0.0995 / stretched));
      else if (stretched < 0.082) w = add(midR, mul(sub(w, midR), 0.082 / stretched));
      return w;
    };
    // DRAWN MCP (rk round 2): the angle a viewer measures -- the
    // metacarpal line (wrist -> knuckle) against the proximal
    // phalanx, projected into the finger's bend plane. Phase 1
    // reported the CHAIN-internal angle (proximal phalanx vs the
    // knuckle->tip chord, <= 61 deg) and certified the hand
    // "within ROM" while the drawn angle ran 111-143 deg: with
    // the old off-board palm axis the metacarpal pointed back
    // across the chord, so the visible base joint folded ~160 deg
    // in the worst renders. rk's cap: 90 deg, every finger, every
    // frame. The guard below enforces it against a provisional
    // wrist here and against the final wrist in the assembly,
    // with two levers, both proximal-safe: shrink the finger's
    // reach (knuckle toward its target -- the chain folds more
    // at PIP/DIP and segment 1 rotates toward the metacarpal
    // line) and rotate the knuckle around its target in the
    // wrist-knuckle-target plane toward the wrist side. Contact
    // is untouched: the chain always lands on its target.
    const MCP_CAP = 1.56; // 89.4 deg: margin under rk's 90 (at 1.54 the guard's whisker-thin excess over its own cap forced the wrist search into a dragged corner with a ~53 mm palm in finger-1-led neck frames; rk's rule is the 90 deg line itself)
    let mcpSync = null; // set by the post-coplanarity pass to keep roots[] in step
    const drawnMCPAngle = (w, K, T, f, planeZ) => {
      const pts = fingerChain(K, T, FINGER_LEN[f], M.n, curlF);
      const meta = sub(K, w), seg = sub(pts[1], pts[0]);
      let nrm = M.vec.cross(seg, sub(pts[3], pts[0]));
      nrm = Math.hypot(...nrm) < 1e-9 ? M.n : norm(nrm);
      const mp = sub(meta, mul(nrm, dot(meta, nrm)));
      if (Math.hypot(...mp) < 1e-9) return 0;
      return Math.acos(clamp(dot(norm(mp), norm(seg)), -1, 1));
    };
    const shrinkKnuckle = f => {
      const KT = sub(knuckles[f], targets[f]), dNow = Math.hypot(...KT);
      // The shrink floor is also the chain's PIP-feasibility
      // floor: shrinking a knuckle inside MIN_SPAN would fold
      // the finger past both caps no matter how the fold is
      // distributed (see fingerChain).
      const dMin = Math.max(reaches[f] * 0.68, MIN_SPAN[f] + 0.0005);
      if (dNow > dMin) {
        const nd = Math.max(dMin, dNow - Math.min(0.010, dNow - dMin));
        knuckles[f] = add(targets[f], mul(KT, nd / dNow));
        if (mcpSync) mcpSync(f);
      }
    };
    const rotateKnuckle = (f, w, step) => {
      const d2 = norm(sub(knuckles[f], targets[f]));
      const w2 = norm(sub(w, targets[f]));
      let axr = M.vec.cross(d2, w2);
      if (Math.hypot(...axr) < 1e-6) return;
      axr = norm(axr);
      const c = Math.cos(step), s = Math.sin(step);
      const rot = add(add(mul(d2, c), mul(M.vec.cross(axr, d2), s)),
        mul(axr, dot(axr, d2) * (1 - c)));
      knuckles[f] = add(targets[f],
        mul(rot, Math.hypot(...sub(knuckles[f], targets[f]))));
      if (mcpSync) mcpSync(f);
    };
    // Provisional palm frame from the CURRENT knuckles + a wrist,
    // for the MCP passes that run before finishHand builds the
    // real frame: the same recipe finishHand uses (row -> X,
    // wrist -> middle knuckle -> Y, Z = X x Y oriented to the
    // board back, variant roll about X; the trial loops'
    // rollAdj is 0 at those points by construction).
    const palmFrameOf = w => {
      const midRoot = knuckles[2];
      let pY = norm(sub(midRoot, w));
      const rowVec = sub(knuckles[4], knuckles[1]);
      let pX = sub(rowVec, mul(pY, dot(rowVec, pY)));
      if (Math.hypot(...pX) < 1e-4) pX = sub(rowDir, mul(pY, dot(rowDir, pY)));
      pX = norm(pX);
      let pZ = M.vec.cross(pX, pY);
      if (dot(pZ, backN) < 0) { pX = mul(pX, -1); pZ = mul(pZ, -1); }
      if (VARI.palmRoll) {
        const c = Math.cos(VARI.palmRoll), s = Math.sin(VARI.palmRoll);
        const y2 = add(mul(pY, c), mul(pZ, s));
        const z2 = add(mul(pZ, c), mul(pY, -s));
        pY = y2; pZ = z2;
      }
      return { x: pX, y: pY, z: pZ };
    };
    const correctMCP = (w, planeZ) => {
      let worstOut = 0;
      for (let iter = 0; iter < 5; iter++) {
        let worst = 0;
        for (let f = 1; f <= 4; f++) {
          const ang = drawnMCPAngle(w, knuckles[f], targets[f], f, planeZ);
          worst = Math.max(worst, ang);
          if (ang <= MCP_CAP) continue;
          // Rotate first: it closes the drawn angle on the
          // target sphere, preserving the chain's span. Shrink
          // (which eats span, and with it palm length) is the
          // fallback for fingers rotation alone cannot fix --
          // firing it unconditionally cost ~20 mm of palm in
          // ordinary neck frames.
          rotateKnuckle(f, w, Math.min(0.35, (ang - MCP_CAP) * 0.9));
          if (drawnMCPAngle(w, knuckles[f], targets[f], f, planeZ) > MCP_CAP) shrinkKnuckle(f);
        }
        worstOut = worst;
        if (worst <= MCP_CAP) break;
      }
      return worstOut;
    };
    { const wProv = placeWrist(knuckles[2], VARI.wristBack); correctMCP(wProv, palmFrameOf(wProv).z); }
    // Thumb rest point: one continuous target following the
    // posture parameter (no discrete mode switch, so nothing pops
    // at the neck/thumb boundary). In neck positions the pad rests
    // ON the back of the neck AT THE HAND'S OWN STATION -- the
    // neck-axis point nearest the middle knuckle, offset one thumb
    // radius behind the back surface. (The rest point used to
    // follow the anchor note, which jumps up to ~120 mm between
    // fingers inside one position; the thumb, rooted in the hand,
    // could not follow and floated stranded.) lam = 1: the thumb
    // lies across the fingerboard on the strings as the anchor
    // under the hand (rest point 3 mm in front of the anchor's
    // string point). In between, the rest point lerps across and
    // swings around the player's-left side (the -sin(pi*lam)
    // term) instead of dragging across the neck's back corner.
    const midRoot0 = knuckles[2];
    const axisPt = add(M.NECK_A, mul(neckAxisDir,
      clamp(dot(sub(midRoot0, M.NECK_A), neckAxisDir), 0, axisLen)));
    let backDir = sub(mul(M.n, -1), mul(neckAxisDir, dot(mul(M.n, -1), neckAxisDir)));
    backDir = norm(backDir); // board-back direction, perpendicular to the neck axis
    // The rest sits on the neck's back-LEFT ridge (0.62 back +
    // 0.62 toward the A-string side, -v: the player's left across
    // the neck, 45 mm from the axis, a station-step toward the
    // nut): the thumb lies along that ridge, opposing the fingers
    // that wrap over the board from the same side -- the pinch.
    // The nut-side step matters to the chain: it keeps the
    // wrist->rest distance ~60 mm, a span the 96 mm thumb chain
    // can fold to inside its caps (a bridge-side step collapsed
    // it to ~30 mm -- measured, round 2 -- and no in-cap fold
    // exists there).
    // (The pre-fix rest sat on the C-side ridge, +v, the player's
    // right: one more piece of the hand assembled from the right.)
    const neckRest = add(add(axisPt, mul(norm(add(mul(backDir, 0.62), mul(M.v, -0.62))), 0.045)),
      mul(neckAxisDir, 0.010));
    // Transition path: a cubic Bezier from the neck-ridge rest
    // to the on-board anchor, routed via the neck's A-side
    // (back-left) flank and an approach point above the board --
    // the thumb tip travels AROUND the neck and comes down onto
    // the board from above as the hand rolls over, never across
    // the neck's axis or through the board's top edge (a straight
    // lerp dragged it through both whenever the anchor sat far
    // down-board).
    const flankMid = add(add(axisPt, mul(M.v, -0.052)),
      add(mul(backDir, 0.008), mul(M.n, 0.030)));
    const boardRest = add(anchorPt, mul(M.n, 0.003));
    const approach = add(boardRest, mul(M.n, 0.045));
    // The thumb's swing LEADS the hand's roll slightly (phase
    // 2): the rest point is evaluated at lamT = lam * 1.12
    // (clamped), so mid-shift the thumb is already around the
    // flank while the hand is still arriving -- the root->rest
    // span stays nearer the chain's foldable range instead of
    // collapsing when the hand and the rest point pass each
    // other around the neck. Endpoints are unchanged (lamT = 0
    // at lam = 0, 1 at lam >= 0.9).
    const lamT = clamp(lam * 1.12, 0, 1);
    const restPt = add(add(mul(neckRest, (1 - lamT) ** 3),
      mul(flankMid, 3 * (1 - lamT) * (1 - lamT) * lamT)),
      add(mul(approach, 3 * (1 - lamT) * lamT * lamT), mul(boardRest, lamT ** 3)));
    // ---- The hand as one assembly: palm frame first ----
    // The palm frame is built from the knuckle row and the palm
    // axis: the wrist JOINT is placed PALM_LEN proximal of the
    // MIDDLE finger's root along the axis (plus the radial floor
    // push below) -- palm length is anatomical by construction,
    // not fitted afterwards. X is the
    // roots' principal axis (power iteration on their covariance,
    // seeded with the board direction), orthonormalised against
    // the axis; Z = X x Y, flipped (with X) so Z is the
    // back-of-hand side. The palm plate spans wrist -> row (its
    // distal face sits 7 mm past the middle knuckle, the knuckle
    // padding of a real palm), a carpus piece caps the wrist end,
    // and the thumb roots at its CMC joint beside the wrist.
    // There is no wrist ball and no heel rope: the wrist is the
    // palm's proximal end and the forearm's end.
    // Wrist: placed by placeWrist (defined with the knuckle row)
    // from the MCP-corrected middle knuckle, assembled by
    // finishHand below, and SEARCHED by the trial loops after it
    // (phase 2): a placement is accepted only when the whole
    // assembly -- drawn-MCP guard AND a ROM-feasible elbow --
    // succeeds from it; the offsets tried and the relaxation
    // used are recorded on the pose.
    const snapK = () => ({ 1: [...knuckles[1]], 2: [...knuckles[2]], 3: [...knuckles[3]], 4: [...knuckles[4]] });
    const restoreK = s => { for (let f = 1; f <= 4; f++) knuckles[f] = s[f]; };
    const snapT = () => ({ 1: [...targets[1]], 2: [...targets[2]], 3: [...targets[3]], 4: [...targets[4]] });
    const restoreT = s => { for (let f = 1; f <= 4; f++) targets[f] = s[f]; };
    const snap0 = snapK(), snapT0 = snapT();
    // Fibonacci-sphere samples for the palm plate's neck
    // clearance check inside finishHand.
    const SURF_P = [];
    { const NP = 80, ga = Math.PI * (3 - Math.sqrt(5));
      for (let i = 0; i < NP; i++) { const y = 1 - (i / (NP - 1)) * 2, rr = Math.sqrt(Math.max(0, 1 - y * y)), th = ga * i; SURF_P.push([Math.cos(th) * rr, y, Math.sin(th) * rr]); } }
    let rollAdj = 0; // trial loops' pronation adjustment (see the frame block)
    // finishHand(w): everything downstream of a chosen wrist --
    // palm frame, coplanarity, the final drawn-MCP pass, the
    // finger chains (with the span repair for chains the PIP/DIP
    // clamp flags infeasible), the palm/carpus pieces, and the
    // elbow search. Returns the assembly for the trial loops.
    const finishHand = w => {
      const roots = [1, 2, 3, 4].map(f => knuckles[f]);
      const K = roots.reduce((a, r) => add(a, mul(r, 0.25)), [0, 0, 0]);
      const midRoot = roots[1];
      let palmY = norm(sub(midRoot, w));
      const palmLen = Math.hypot(...sub(midRoot, w));
      // X is the knuckle row's own direction (index root ->
      // little root), orthonormalised against Y. (A principal-
      // axis fit of the roots went ambiguous in thumb position,
      // where the row runs diagonally across the palm frame.)
      const rowVec = sub(roots[3], roots[0]);
      let palmX = sub(rowVec, mul(palmY, dot(rowVec, palmY)));
      if (Math.hypot(...palmX) < 1e-4) palmX = sub(rowDir, mul(palmY, dot(rowDir, palmY)));
      palmX = norm(palmX);
      let palmZ = M.vec.cross(palmX, palmY);
      if (dot(palmZ, backN) < 0) { palmX = mul(palmX, -1); palmZ = mul(palmZ, -1); }
      // Variant palm roll (the forearm-pronation reading, bounded
      // by ROM.FOREARM): rotate the palm frame about the knuckle-
      // row axis. The skeleton points (wrist, roots) do not move.
      // rollAdj is the trial loops' last-resort pronation
      // adjustment (pose-scope, set before the attempt; the
      // effective pronation is exported for the ROM sweep).
      const rollNow = VARI.palmRoll + rollAdj;
      if (rollNow) {
        const th = rollNow, c = Math.cos(th), s = Math.sin(th);
        const y2 = add(mul(palmY, c), mul(palmZ, s));
        const z2 = add(mul(palmZ, c), mul(palmY, -s));
        palmY = y2; palmZ = z2;
      }
      // Board-box helpers (signed distance / escape direction),
      // shared by the hover-target clamp below and the root
      // clearance repair after the MCP pass.
      const boardFrame = q => { const rel = sub(q, M.BOARD.A); return [dot(rel, M.BOARD.dir), dot(rel, M.v), dot(rel, M.BOARD.normal)]; };
      const boardParts = q => {
        const [a, b, c] = boardFrame(q);
        const halfW = 0.023 + 0.008 * clamp(a / M.BOARD.END, 0, 1);
        const da = a < 0 ? -a : (a > M.BOARD.END ? a - M.BOARD.END : 0);
        const db = Math.max(Math.abs(b) - halfW, 0);
        const dc = c > 0.0008 ? c - 0.0008 : (c < -0.0062 ? -0.0062 - c : 0);
        return { a, b, c, halfW, da, db, dc };
      };
      const boardDistK = q => {
        const P = boardParts(q);
        if (P.da === 0 && P.db === 0 && P.dc === 0)
          return -Math.min(P.halfW - Math.abs(P.b), P.c + 0.0062, 0.0008 - P.c, P.a, M.BOARD.END - P.a);
        return Math.hypot(P.da, P.db, P.dc);
      };
      const boardEscape = q => {
        const P = boardParts(q);
        let e = add(add(mul(M.BOARD.dir, P.da * (P.a < 0 ? -1 : 1)), mul(M.v, P.db * Math.sign(P.b))),
          mul(M.BOARD.normal, P.dc));
        if (Math.hypot(...e) < 1e-9) e = M.BOARD.normal; // inside the box: exit through the face
        return norm(e);
      };
      // Keep the knuckles coplanar with the palm, as a real
      // hand's are. CONTACT fingers keep their targets -- their
      // roots are pulled toward the plane as far as the chain's
      // reach allows. HOVER fingers' targets are not musical
      // invariants, so the target shifts instead and the fan
      // re-solves.
      for (let f = 1; f <= 4; f++) {
        if (f === prim) continue;
        if (contacts[f]) {
          const off = dot(sub(knuckles[f], midRoot), palmZ);
          if (Math.abs(off) < 0.004) continue;
          const [l1, l2, l3] = FINGER_LEN[f];
          const maxChord = (l1 + Math.sqrt(l2 * l2 + l3 * l3 + 2 * l2 * l3 * Math.cos(curlF))) * 0.998;
          let pull = 0.8;
          while (pull > 0.05) {
            const cand = sub(knuckles[f], mul(palmZ, off * pull));
            if (Math.hypot(...sub(cand, targets[f])) <= maxChord) {
              knuckles[f] = cand; roots[f - 1] = cand; break;
            }
            pull *= 0.6;
          }
        } else {
          for (let it = 0; it < 2; it++) {
            const off = dot(sub(knuckles[f], midRoot), palmZ);
            if (Math.abs(off) <= 0.006) break;
            targets[f] = sub(targets[f], mul(palmZ, off * 0.65));
            knuckles[f] = rootOf(f); roots[f - 1] = knuckles[f];
          }
        }
      }
      // Hover targets keep their tips off the board: the
      // coplanarity shift above can push a hover target into
      // the slab (the palm-Z shift has a board-normal
      // component), leaving the fingertip capsule sunk through
      // the board. Lift any hover target whose tip capsule
      // would graze, and re-derive its root.
      for (let f = 1; f <= 4; f++) {
        if (contacts[f]) continue;
        const needT = FINGER_R[f][2] + 0.003, bd = boardDistK(targets[f]);
        if (bd < needT) {
          targets[f] = add(targets[f], mul(boardEscape(targets[f]), needT - bd + 0.0005));
          knuckles[f] = rootOf(f); roots[f - 1] = knuckles[f];
        }
      }
      // Drawn-MCP final pass: the coplanarity pulls above can
      // move a knuckle by ~20 mm and re-open the base-joint angle
      // past the cap, so the full guard loop runs once more
      // against the FINAL wrist, with roots[] kept in step,
      // before the chains are built.
      mcpSync = f => { roots[f - 1] = knuckles[f]; };
      let mcpWorst = correctMCP(w, palmZ);
      // ROOT CLEARANCE REPAIR: no knuckle may sit inside the
      // neck cylinder or within its capsule shell of the board
      // box. A hover root computed from a far target along the
      // approach direction can dive through the neck's board
      // side in low positions (menuet's finger-4-led frames put
      // the index root 12 mm inside the wood), or park 0.3 mm
      // off the board's face where its knuckle ball would sink
      // through the slab (gigue's opening). Push out to surface
      // + base radius + 2 mm; the chains below re-solve from
      // the moved root (contact tips stay exact). Re-run after
      // the span repair, whose retreats could in principle
      // re-enter. (The board helpers live above the coplanarity
      // pass; the hover-target clamp there uses them too.)
      const clearRoots = () => {
        let pushed = false;
        for (let f = 1; f <= 4; f++) {
          const need = 0.027 + FINGER_R[f][0] + 0.002;
          const ap = add(M.NECK_A, mul(neckAxisDir, clamp(dot(sub(knuckles[f], M.NECK_A), neckAxisDir), 0, axisLen)));
          const rad = sub(knuckles[f], ap), rl = Math.hypot(...rad);
          if (rl < need) {
            knuckles[f] = add(ap, mul(rl > 1e-6 ? mul(rad, 1 / rl) : backDir, need + 0.0005));
            roots[f - 1] = knuckles[f];
            pushed = true;
          }
          const needB = FINGER_R[f][0] + 0.002, bd = boardDistK(knuckles[f]);
          if (bd < needB) {
            knuckles[f] = add(knuckles[f], mul(boardEscape(knuckles[f]), needB - bd + 0.0005));
            roots[f - 1] = knuckles[f];
            pushed = true;
          }
        }
        return pushed;
      };
      const clearAll = () => { let any = false; for (let r = 0; r < 3; r++) { if (!clearRoots()) break; any = true; } return any; };
      // Finger chains from the final knuckles.
      const buildOne = f => {
        const target = targets[f], knuckle = knuckles[f];
        const pts = fingerChain(knuckle, target, FINGER_LEN[f], M.n, curlF);
        // BEND PLANE (rk 2026-11-08, measured outcome): the
        // chains fold in the board plane, as shipped -- NOT in
        // span(chord, palmZ). Folding them in the palm plane
        // (directly, or by twisting the solved joints about
        // the chord) was tried three ways and measurably
        // wrecks this placement: the MCP guard re-settles the
        // knuckles (palm length collapses to ~49-60 mm, row
        // span compresses), or, with the placement held, the
        // proximal segment ends up folded back across the
        // metacarpal (true MCP totals to ~145-172 deg). The
        // placement itself puts the chords ~70-90 deg out of
        // the palm plane, so palm-plane folding is a placement
        // redesign (rk's visual-variant call), not a chain
        // change. What the chain DOES enforce by construction
        // in its own frame: flexion only toward its bulge
        // side's opposite (the palm side of the chain plane),
        // PIP flexion clamped into [0, 90] deg (cap + floor
        // bisections in fingerChain), DIP the clamped curl in
        // [0, 70] deg, lateral exactly 0 in the chain plane.
        // Geometry section 9 measures the palm-frame
        // decomposition of the result and pins it explicitly.
        // Base-joint (MCP) bend of the chain: angle between the
        // first segment and the knuckle->target chord. (Chain-
        // internal -- NOT the drawn angle rk reads; see
        // drawnMCPAngle.)
        const mcp = Math.acos(clamp(dot(norm(sub(pts[1], knuckle)), norm(sub(target, knuckle))), -1, 1));
        return { points: pts, contact: contacts[f], target, mcpAngle: mcp, drawnMcp: drawnMCPAngle(w, knuckle, target, f, palmZ), tipDir: norm(sub(pts[3], pts[2])), pip: pts.pip, dip: pts.dip, curlUsed: pts.curlUsed, chainInfeasible: pts.infeasible };
      };
      for (let f = 1; f <= 4; f++) fingers[f] = buildOne(f);
      // SPAN REPAIR (proximal fix, rk's method): a chain the
      // PIP/DIP clamp still flags infeasible has a span shorter
      // than both caps allow (MIN_SPAN) -- the knuckle retreats
      // from its target in 2 mm steps (<= 20 mm) until the chain
      // folds legally. Contact is untouched (the chain always
      // lands on its target); the drawn-MCP guard then re-runs,
      // its shrink lever now floored at MIN_SPAN so it cannot
      // re-shorten a repaired span back into infeasibility.
      if ([1, 2, 3, 4].some(f => fingers[f].chainInfeasible)) {
        for (let f = 1; f <= 4; f++) {
          let guard = 0;
          while (fingers[f].chainInfeasible && guard < 10) {
            knuckles[f] = add(knuckles[f], mul(norm(sub(knuckles[f], targets[f])), 0.002));
            roots[f - 1] = knuckles[f];
            fingers[f] = buildOne(f);
            guard++;
          }
        }
        correctMCP(w, palmZ);
        for (let f = 1; f <= 4; f++) fingers[f] = buildOne(f);
      }
      // CHAIN BOARD CLEARANCE (safety net at section 7's
      // graze bound): a near-straight chain at its longest
      // spans can sag across the board box's edge (the worst
      // shipped frames graze at the -7 mm bound). When a
      // chain's interior crosses -6.5 mm the repair is the
      // MCP guard's own shrink lever applied for clearance:
      // the knuckle walks toward its target in 2 mm steps
      // (span floored at MIN_SPAN), which raises the first
      // joint off the chord; the alternation below re-runs
      // the guard afterwards. Points within 12 mm of a
      // contact target are exempt (the fingertip wraps the
      // string there), mirroring section 7's exclusion.
      {
        const chainBoardWorst = f => {
          const pts = fingers[f].points;
          let worst = Infinity;
          for (let j = 0; j < 3; j++) for (let kk = 1; kk < 8; kk++) {
            const pt = add(pts[j], mul(sub(pts[j + 1], pts[j]), kk / 8));
            if (contacts[f] && Math.hypot(...sub(pt, targets[f])) < 0.012) continue;
            worst = Math.min(worst, boardDistK(pt) - FINGER_R[f][j]);
          }
          return worst;
        };
        for (let round = 0; round < 6; round++) {
          let any = false;
          for (let f = 1; f <= 4; f++) {
            if (chainBoardWorst(f) < -0.0065 &&
                Math.hypot(...sub(knuckles[f], targets[f])) > MIN_SPAN[f] + 0.004 &&
                // The middle knuckle's wrist distance IS the
                // palm length (section 8's 60 mm floor): the
                // shrink must not eat the palm.
                (f !== 2 || Math.hypot(...sub(knuckles[f], w)) > 0.064)) {
              knuckles[f] = add(knuckles[f], mul(norm(sub(targets[f], knuckles[f])), 0.002));
              roots[f - 1] = knuckles[f];
              fingers[f] = buildOne(f);
              any = true;
            }
          }
          if (!any) break;
        }
      }
      // Clearance and the drawn-MCP guard fight: a clearance
      // push can re-open the drawn angle past the cap (one
      // first-position frame measured 93.7 deg after its board
      // push), and a guard rotation can swing a root back
      // toward the neck. Alternate them (bounded) until both
      // hold; the mcpWorst the trial search scores is the FINAL
      // one, so the search can prefer wrists where the
      // alternation converges under the cap.
      for (let round = 0; round < 3; round++) {
        const pushed = clearAll();
        if (pushed) for (let f = 1; f <= 4; f++) fingers[f] = buildOne(f);
        mcpWorst = correctMCP(w, palmZ);
        for (let f = 1; f <= 4; f++) fingers[f] = buildOne(f);
        if (!pushed && mcpWorst <= MCP_CAP) break;
      }
      mcpSync = null;
      // The plate's Z is fitted to the roots' stations too: when
      // the primary is a short finger its root sits closer along
      // the approach direction, which projects out of the middle
      // root's plane by up to ~19 mm; the plate thickens toward
      // that side instead of leaving the root outside.
      const zSt = roots.map(r => dot(sub(r, midRoot), palmZ));
      const zOff = clamp(zSt.reduce((a, z) => a + z, 0) / 4, -0.014, 0.014);
      const zRad = clamp(Math.max(...zSt.map(z => Math.abs(z - zOff))) + 0.006, 0.014, 0.020);
      const palmEuler = eulerZYX(palmX, palmY, palmZ);
      // The plate's X and Y spans are fitted to the actual
      // assembly (wrist at -palmLen along Y, roots at their
      // stations), centred on the span rather than on the middle
      // knuckle, so every root sits inside the drawn plate even
      // when the fan angles the row relative to the palm axis.
      const xSt = roots.map(r => dot(sub(r, midRoot), palmX));
      const xLo = Math.min(...xSt, 0), xHi = Math.max(...xSt, 0);
      const ySt = roots.map(r => dot(sub(r, midRoot), palmY));
      const yLo = Math.min(-palmLen, ...ySt), yHi = Math.max(...ySt, 0);
      const palm = {
        centre: add(add(add(midRoot, mul(palmX, (xLo + xHi) / 2)), mul(palmY, (yLo + yHi) / 2)), mul(palmZ, zOff)),
        radii: [(xHi - xLo) / 2 + 0.013, (yHi - yLo) / 2 + 0.014, zRad],
        basis: { x: palmX, y: palmY, z: palmZ },
        euler: palmEuler
      };
      const carpus = {
        centre: add(w, mul(palmY, 0.008)),
        radii: [0.026, 0.019, 0.015],
        basis: { x: palmX, y: palmY, z: palmZ },
        euler: palmEuler
      };
      // Plate clearance: the fitted ellipsoid's palm side can
      // press into the neck where the hand wraps it (worst
      // measured 6.6 mm, a finger-4-led low frame). Sample the
      // surface against the neck cylinder; if it enters, lift
      // the centre along the back-of-hand axis by the deficit
      // (capped 10 mm). Roots stay bridged: they sit inside the
      // plate's knuckle end, and a dorsal lift only buries them
      // deeper, which the root-ball bridging check allows.
      {
        let minD = Infinity;
        for (const sf of SURF_P) {
          const pt = add(palm.centre, add(mul(palmX, sf[0] * palm.radii[0]),
            add(mul(palmY, sf[1] * palm.radii[1]), mul(palmZ, sf[2] * palm.radii[2]))));
          const ap = add(M.NECK_A, mul(neckAxisDir,
            clamp(dot(sub(pt, M.NECK_A), neckAxisDir), 0, axisLen)));
          minD = Math.min(minD, Math.hypot(...sub(pt, ap)) - 0.027);
        }
        if (minD < 0.002) palm.centre = add(palm.centre, mul(palmZ, Math.min(0.002 - minD, 0.010)));
      }
      // Same lift for the carpus ellipsoid (its wrist-side
      // surface measured 3.0 mm into the neck at the closest
      // wrist stations); the shift is inside the wrist mass and
      // the ellipsoid still covers the wrist joint.
      {
        let minD = Infinity;
        for (const sf of SURF_P) {
          const pt = add(carpus.centre, add(mul(palmX, sf[0] * carpus.radii[0]),
            add(mul(palmY, sf[1] * carpus.radii[1]), mul(palmZ, sf[2] * carpus.radii[2]))));
          const ap = add(M.NECK_A, mul(neckAxisDir,
            clamp(dot(sub(pt, M.NECK_A), neckAxisDir), 0, axisLen)));
          minD = Math.min(minD, Math.hypot(...sub(pt, ap)) - 0.027);
        }
        if (minD < 0.002) carpus.centre = add(carpus.centre, mul(palmZ, Math.min(0.002 - minD, 0.008)));
      }
      // Elbow: chosen on its IK circle (the hinge locus for the
      // solved wrist) by ANATOMY, not by a pole. Every candidate
      // is filtered by the ROM table as a HARD constraint (phase
      // 2: these never relax -- the round-2 search let a least-
      // violation fallback pick elbows in ~35% of frames, with
      // wrist flexion to 42.7 deg, deviation to -41 deg and one
      // 154 deg shoulder cone): the SIGNED wrist posture of the
      // DRAWN palm frame against the forearm must stay inside
      // its wedge (palmar flexion only, capped deviation -- the
      // wrist is never cocked back), the upper arm inside the
      // shoulder's cone, the elbow on the player's-left half.
      // Only the forearm/neck CLEARANCE relaxes across levels.
      // If no candidate survives at any level the wrist itself
      // is wrong (rk's method: solve proximally) -- the trial
      // loops outside move the wrist placement and re-run the
      // whole assembly; the least-violation elbow is returned
      // flagged (fallback 3) only as the last resort, with its
      // violation recorded on the pose.
      const searchElbow = () => {
        const cC = add(w, mul(palmY, 0.008));
        const limbR = tau => {
          const x = 2 * tau - 1, SS = [[-1, 0.62], [-0.55, 1], [0.55, 1], [1, 0.62]];
          for (let i = 0; i < 3; i++) if (x <= SS[i + 1][0]) { const f = (x - SS[i][0]) / (SS[i + 1][0] - SS[i][0]); return 0.038 * (SS[i][1] + (SS[i + 1][1] - SS[i][1]) * f); }
          return 0.038 * 0.62;
        };
        const abN = sub(M.NECK_B, M.NECK_A), abL2 = dot(abN, abN);
        const foreScore = EL => {
          let m = Infinity;
          for (let i = 0; i <= 16; i++) {
            const tau = i / 16, q = add(EL, mul(sub(w, EL), tau));
            if (Math.hypot(...sub(q, cC)) < 0.030) continue;
            const tt = clamp(dot(sub(q, M.NECK_A), abN) / abL2, 0, 1);
            if (tt * Math.sqrt(abL2) < 0.09) continue;
            const qp = add(M.NECK_A, mul(abN, tt));
            m = Math.min(m, Math.hypot(...sub(q, qp)) - 0.027 - limbR(tau));
            if (m < -0.08) break; // below every level's floor: exact value no longer matters
          }
          return m;
        };
        const dSW = sub(w, SHOULDER_L), dLen = clamp(Math.hypot(...dSW), 0.05, (ARM[0] + ARM[1]) * 0.999);
        const dirSW = norm(dSW);
        const aSW = (ARM[0] * ARM[0] - ARM[1] * ARM[1] + dLen * dLen) / (2 * dLen);
        const hSW = Math.sqrt(Math.max(0, ARM[0] * ARM[0] - aSW * aSW));
        const C = add(SHOULDER_L, mul(dirSW, aSW));
        const seed = [0.35, -1, 0.45]; // down, toward the player's left, behind
        let perp0 = sub(seed, mul(dirSW, dot(seed, dirSW)));
        perp0 = Math.hypot(...perp0) > 1e-9 ? norm(perp0) : [0, -1, 0];
        const perp1 = M.vec.cross(dirSW, perp0);
        // SIGNED wrist model (rk round 2): the forearm -> palm-
        // axis angle decomposed in the hand's own frame --
        // flexion about the knuckle-row (radial) axis, signed
        // palmar positive, and radial/ulnar deviation about the
        // back-of-hand axis. Judged here on the FINAL drawn
        // frame (post-roll palmY/palmZ, final roots), so what
        // the search certifies is exactly what is drawn and
        // what the sweep measures; the chosen candidate's
        // flex/dev/cone are exported on the pose.
        const radRefW = norm(sub(roots[0], roots[3]));
        const wristFlexDev = E => {
          const fa = norm(sub(w, E));
          const t = sub(palmY, mul(fa, dot(fa, palmY)));
          const along = dot(fa, palmY);
          const proj = v => {
            const x = sub(v, mul(fa, dot(fa, v)));
            return Math.hypot(...x) < 1e-9 ? [0, 0, 0] : norm(x);
          };
          return {
            flex: -Math.atan2(dot(t, proj(palmZ)), along),
            dev: Math.atan2(dot(t, proj(radRefW)), along)
          };
        };
        const wedgeViol = (flex, dev) =>
          20 * Math.max(0, ROM.WRIST.flex[0] - flex) + Math.max(0, flex - ROM.WRIST.flex[1]) +
          Math.max(0, dev - ROM.WRIST.radial) + Math.max(0, -dev - ROM.WRIST.ulnar);
        const coneOf = cand => Math.acos(clamp(dot(norm(sub(cand, SHOULDER_L)), [0, -1, 0]), -1, 1));
        const scoreOf = (cand, wd, clr) => 1.6 * Math.abs(cand[1] - VARI.elbowY) +
          VARI.devW * (Math.abs(wd.flex - VARI.flexPref) + Math.abs(wd.dev)) -
          0.8 * clr - 0.25 * cand[0];
        // Evaluate every candidate ONCE (clearance + wrist wedge
        // + cone); the levels below only filter this table.
        const CANDS = [];
        for (let k = 0; k < 128; k++) {
          const th = k / 128 * 2 * Math.PI;
          const cand = add(C, add(mul(perp0, Math.cos(th) * hSW), mul(perp1, Math.sin(th) * hSW)));
          const wd = wristFlexDev(cand);
          CANDS.push({ cand, clr: foreScore(cand), flex: wd.flex, dev: wd.dev, cone: coneOf(cand), wv: wedgeViol(wd.flex, wd.dev) });
        }
        const LEVELS = [{ clr: -0.004 }, { clr: -0.015 }, { clr: -0.030 }];
        for (let lv = 0; lv < LEVELS.length; lv++) {
          let best = null;
          for (const c of CANDS) {
            if (c.clr < LEVELS[lv].clr || c.wv > 0 || c.cand[0] < 0.02 || c.cone > ROM.SHOULDER.coneFromDown) continue;
            const score = scoreOf(c.cand, c, c.clr);
            if (!best || score < best.score) best = { elbow: c.cand, score, flex: c.flex, dev: c.dev, cone: c.cone };
          }
          if (best) return { ...best, fallback: lv, viol: 0 };
        }
        // Last resort (the trial loops score this heavily and
        // move the wrist instead): least total violation --
        // wedge (extension weighted 20x inside wedgeViol), cone
        // excess, side shortfall, clearance shortfall.
        let best = null;
        for (const c of CANDS) {
          const viol = c.wv +
            2 * Math.max(0, c.cone - ROM.SHOULDER.coneFromDown) +
            2 * Math.max(0, 0.02 - c.cand[0]) +
            0.5 * Math.max(0, -0.030 - c.clr);
          const score = scoreOf(c.cand, c, c.clr);
          if (!best || viol < best.viol - 1e-9 || (Math.abs(viol - best.viol) <= 1e-9 && score < best.score))
            best = { elbow: c.cand, score, flex: c.flex, dev: c.dev, cone: c.cone, viol };
        }
        return { ...best, fallback: 3 };
      };
      const el = searchElbow();
      return {
        roots, K, midRoot, palmX, palmY, palmZ, palmLen, palm, carpus, xHalf: (xHi - xLo) / 2,
        elbow: el.elbow, elbowFallback: el.fallback, elbowFlex: el.flex,
        elbowDev: el.dev, elbowCone: el.cone, elbowViol: el.viol, mcpWorst,
        pronation: rollNow
      };
    };
    // One full assembly attempt from the snapshot state with a
    // given wrist (provisional drawn-MCP guard, then finishHand).
    const attempt = wTry => { correctMCP(wTry, palmFrameOf(wTry).z); return finishHand(wTry); };
    // WRIST TRIALS (phase 2): the wrist placement is searched,
    // not just relaxed along one axis. Inner ladder = the pinch-
    // depth relaxation (wristBack +0..24 mm, the round-2 MCP
    // lever); outer offsets move the placement's station along
    // the neck and its side offset as well. A trial wins when
    // the elbow search is feasible (fallback < 3: wedge, cone
    // and side all satisfied) AND the drawn-MCP guard is inside
    // its cap; otherwise the best-scoring assembly is kept and
    // its residual violation stays on the pose for the sweep.
    const OFFSETS = [
      // [wristBack, station, side, alongAxis, lateral, rollAdj, row]
      // (roughly ascending invasiveness; the loops stop at the
      // first fully feasible assembly)
      [0, 0, 0, 0, 0, 0, 0], [0, 0, 0, -0.006, 0, 0, 0], [0, 0, 0, 0.006, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0.008], [0, 0, 0, 0, 0, 0, -0.008], [0, 0, 0, 0, 0, 0, 0.016],
      [0, 0, 0, 0, 0, 0, -0.016], [0, 0, 0, 0, 0.008, 0, 0], [0, 0, 0, 0, -0.008, 0, 0],
      [0, 0, 0, 0, 0.014, 0, 0], [0, 0, 0, 0, -0.014, 0, 0], [0, 0, 0, 0, 0.020, 0, 0],
      [0, 0, 0, 0, -0.020, 0, 0], [0, 0, 0, 0, 0, 0.08, 0], [0, 0, 0, 0, 0, 0.16, 0],
      [0, 0, 0, 0, 0, 0.24, 0], [0.012, 0, 0, 0, 0, 0, 0], [0, 0, 0, -0.011, 0, 0, 0],
      [0, 0, 0, 0, 0, -0.08, 0], [0, 0, 0, 0, 0.008, 0.08, 0], [0, 0, 0, 0, 0.014, 0.16, 0],
      [0, 0, 0, 0, -0.014, 0.16, 0], [0, 0, 0, 0, 0.020, 0.24, 0], [0, 0, 0, 0, -0.020, 0.24, 0],
      [0.024, 0, 0, 0, 0, 0, 0], [0, -0.012, 0, 0, 0, 0, 0],
      [0, 0.012, 0, 0, 0, 0, 0], [0, 0, -0.010, 0, 0, 0, 0], [0, 0, 0, -0.006, 0.008, 0.08, 0],
      [0.012, -0.012, 0, -0.006, 0, 0, 0], [0.024, -0.012, -0.010, 0.006, 0, 0, 0],
      [-0.012, 0.012, 0.006, -0.006, 0, 0, 0]
    ];
    let bestTry = null;
    const seenTrial = new Set();
    const feasible = H => H.elbowFallback < 3 && H.mcpWorst <= MCP_CAP;
    // One scored assembly attempt at a placement offset tuple.
    // Offsets whose levers are weighted out at this lam (neck-
    // frame offsets at lam = 1, seed offsets at lam = 0, the MCP
    // ladder's fbOff at lam = 1) reproduce an earlier trial
    // exactly -- deduped for free on the effective (wrist, roll).
    const runTrial = (off, extra) => {
      const [wbOff, stOff, sdOff, axOff, latOff, rollOff, rowOff] = off;
      restoreK(snap0); restoreT(snapT0);
      rollAdj = rollOff;
      const rowDirW = norm(sub(knuckles[4], knuckles[1]));
      const wTry = placeWrist(knuckles[2], VARI.wristBack + wbOff + extra, stOff, sdOff, axOff, latOff, rowOff, rowDirW);
      const trialKey = rollOff + '|' + wTry.map(x => x.toFixed(6)).join(',');
      if (seenTrial.has(trialKey)) return null;
      seenTrial.add(trialKey);
      const H = attempt(wTry);
      const score = (H.elbowFallback >= 3 ? 100 + H.elbowViol * 57.3 : H.elbowFallback * 0.01) +
        (H.mcpWorst > MCP_CAP ? (H.mcpWorst - MCP_CAP) * 600 : 0) +
        (Math.abs(wbOff) + Math.abs(stOff) + Math.abs(sdOff) + Math.abs(axOff) + Math.abs(latOff) + Math.abs(rowOff) + Math.abs(rollOff) * 0.05 + extra) * 2;
      const rec = { score, wrist: wTry, relax: wbOff + extra, rollAdj: rollOff, off, extra, H };
      if (!bestTry || score < bestTry.score) bestTry = rec;
      return rec;
    };
    grid: for (const off of OFFSETS) {
      for (const extra of [0, 0.008, 0.016, 0.024]) {
        const rec = runTrial(off, extra);
        if (rec && feasible(rec.H)) break grid;
      }
    }
    // COORDINATE DESCENT (phase 2): if the grid found no fully
    // feasible assembly, walk the placement levers that rotate
    // the palm frame against the forearm (lateral offset,
    // pronation adjustment, along-axis shift) downhill on the
    // trial score from the grid's best point. This is what
    // closes the thumb-position deviation gap: at the worst
    // Swan frames the whole hinge circle sits ~10 deg of radial
    // deviation past the cap, and only turning the palm axis
    // itself (a placement property, not a ROM change) reaches
    // a legal elbow. Bounded and deterministic; the caps keep
    // the wrist a wrist (<= 30 mm lateral, pronation adjustment
    // inside ROM.FOREARM with margin).
    if (bestTry && !feasible(bestTry.H)) {
      let cur = bestTry;
      // step sizes by offset index: row 6, lat 4, roll 5, ax 3
      const stepOf = { 6: 0.005, 4: 0.006, 5: 0.06, 3: 0.004 };
      const inCaps = off => Math.abs(off[6]) <= 0.024 && Math.abs(off[4]) <= 0.036 && off[5] <= 0.44 && off[5] >= -0.10 && Math.abs(off[3]) <= 0.012;
      let budget = 30;
      while (budget > 0 && !feasible(cur.H)) {
        let improved = false;
        const tryStep = delta => {
          if (budget-- <= 0) return;
          const off = cur.off.map((v, i) => v + (delta[i] || 0));
          if (!inCaps(off)) return;
          const rec = runTrial(off, cur.extra);
          if (rec && rec.score < cur.score - 1e-9) { cur = rec; improved = true; }
        };
        for (const idx of [6, 4, 5, 3]) {
          for (const sgn of [1, -1]) {
            const delta = [0, 0, 0, 0, 0, 0, 0];
            delta[idx] = sgn * stepOf[idx];
            tryStep(delta);
            if (feasible(cur.H) || budget <= 0) break;
          }
          if (feasible(cur.H) || budget <= 0) break;
        }
        // Diagonal moves (row swing + pronation together) when
        // single-coordinate steps stall: the deviation frontier
        // in deep thumb position runs diagonally in (row, roll).
        if (!improved && !feasible(cur.H)) {
          for (const sl of [1, -1]) for (const sr of [1, -1]) {
            const delta = [0, 0, 0, 0, 0, 0, 0];
            delta[6] = sl * stepOf[6]; delta[5] = sr * stepOf[5];
            tryStep(delta);
            if (feasible(cur.H) || budget <= 0) break;
          }
        }
        if (!improved) {
          for (const k of Object.keys(stepOf)) stepOf[k] /= 2;
          if (stepOf[6] < 0.0012) break;
        }
      }
    }
    // Regenerate the winning assembly deterministically from the
    // snapshot state (finishHand's mutations are not idempotent,
    // so the end state cannot simply be restored).
    restoreK(snap0); restoreT(snapT0);
    rollAdj = bestTry.rollAdj;
    const wrist = bestTry.wrist;
    const wristBackRelax = bestTry.relax;
    const H = attempt(wrist);
    const { roots, K, palmX, palmY, palmZ, palm, carpus } = H;
    const elbowL = H.elbow, elbowFallback = H.elbowFallback, mcpWorst = H.mcpWorst;
    // Thumb: rooted at its CMC joint -- the wrist-end corner of
    // the palm on the index side, where the thumb's metacarpal
    // actually articulates -- and chained to the rest point as
    // part of the hand's own structure. When the rest point sits
    // near the chain's reach limit (the wrist rides radially out
    // for the forearm's sake), the thenar root slides toward the
    // rest point within the palm plane, up to 35 mm -- the
    // thenar mass rotating toward the neck, as a real hand's
    // does; the drawn thenar capsule bridges root and base so
    // the assembly stays connected.
    const idxSign = Math.sign(dot(sub(roots[0], K), palmX)) || 1;
    const thumbBase = add(add(add(wrist, mul(palmY, 0.020)),
      mul(palmX, idxSign * 0.022)), mul(palmZ, -0.008));
    const thumbMax = THUMB_LEN[0] + Math.sqrt(THUMB_LEN[1] ** 2 + THUMB_LEN[2] ** 2 +
      2 * THUMB_LEN[1] * THUMB_LEN[2] * Math.cos(0.35));
    let thumbRoot = thumbBase;
    {
      const toRest = sub(restPt, thumbBase), dRest = Math.hypot(...toRest);
      const slide = clamp(dRest - (thumbMax * 0.999 - 0.004), 0, 0.035);
      if (slide > 0) {
        let inDir = sub(toRest, mul(palmY, dot(toRest, palmY)));
        inDir = Math.hypot(...inDir) < 1e-6 ? toRest : norm(inDir);
        thumbRoot = add(thumbBase, mul(inDir, slide));
      }
    }
    // Short-span pullback (proximal fix, rk's method): if the
    // rest point is closer to the root than the capped thumb
    // chain can fold to, retreat the root toward the wrist
    // joint -- the CMC base sits at the palm's proximal corner
    // and the drawn thenar ball covers the retreat -- rather
    // than folding a joint past its cap. The retreat is
    // CONTINUOUS (phase 2): k is bisected so the span equals
    // the chain's true minimum resultant when that is reachable
    // short of the wrist, else the root goes all the way to the
    // wrist (k = 1). The minimum resultant uses the chain's
    // COUPLED caps (IP <= 0.35 + 1.1 * MCP, see thumbChain):
    // the uncoupled figure (58.9 mm) understated it by ~2 mm
    // and left that much tip error in every pulled frame. The
    // retreat used is recorded in thumbSolve.
    let thumbPullback = 0;
    {
      const [tl1, tl2, tl3] = THUMB_LEN;
      const b2c = Math.min(ROM.THUMB.IP[1], 0.35 + 1.1 * ROM.THUMB.MCP[1]);
      const minSpan = Math.hypot(
        tl1 + tl2 * Math.cos(ROM.THUMB.MCP[1]) + tl3 * Math.cos(ROM.THUMB.MCP[1] + b2c),
        tl2 * Math.sin(ROM.THUMB.MCP[1]) + tl3 * Math.sin(ROM.THUMB.MCP[1] + b2c));
      const root0 = thumbRoot;
      const spanAt = k => Math.hypot(...sub(restPt, add(root0, mul(sub(wrist, root0), k))));
      if (spanAt(0) < minSpan) {
        if (spanAt(1) <= minSpan) {
          thumbRoot = add(root0, sub(wrist, root0));
          thumbPullback = 1;
        } else {
          let lo = 0, hi = 1;
          for (let i = 0; i < 18; i++) {
            const mid = (lo + hi) / 2;
            if (spanAt(mid) < minSpan) lo = mid; else hi = mid;
          }
          thumbRoot = add(root0, mul(sub(wrist, root0), hi));
          thumbPullback = hi;
        }
      }
    }
    // Neck clearance for the metacarpal capsule (neck positions):
    // the root can sit close enough to the neck that its 16 mm
    // capsule would sink ~5 mm into the wood. Walk the root
    // further along the same pullback locus toward the wrist --
    // the span grows but stays inside the chain's reach -- until
    // the capsule clears. The root stays on the locus segment, so
    // the assembly's structure (and section 8's locus check) is
    // unchanged; where even the wrist end cannot clear within
    // reach, the root stays (best effort, measured in the test).
    if (lam < 0.5) {
      const need = 0.027 + THUMB_R[0] + 0.001;
      const axD = q => Math.hypot(...sub(q, add(M.NECK_A, mul(neckAxisDir,
        clamp(dot(sub(q, M.NECK_A), neckAxisDir), 0, axisLen)))));
      if (axD(thumbRoot) < need) {
        const root0 = thumbRoot, seg = sub(wrist, root0);
        const spanLim = thumbMax * 0.999 - 0.004;
        const spanAt = k => Math.hypot(...sub(restPt, add(root0, mul(seg, k))));
        let kReach = 1;
        if (spanAt(1) > spanLim) {
          let lo = 0, hi = 1;
          for (let i = 0; i < 18; i++) { const mid = (lo + hi) / 2; if (spanAt(mid) <= spanLim) lo = mid; else hi = mid; }
          kReach = lo;
        }
        let kFound = -1, kPrev = 0;
        for (let i = 1; i <= 24 && kFound < 0; i++) {
          const k = kReach * i / 24;
          if (axD(add(root0, mul(seg, k))) >= need) {
            let lo = kPrev, hi = k;
            for (let it = 0; it < 14; it++) { const mid = (lo + hi) / 2; if (axD(add(root0, mul(seg, mid))) >= need) hi = mid; else lo = mid; }
            kFound = hi;
          }
          kPrev = k;
        }
        if (kFound >= 0) thumbRoot = add(root0, mul(seg, kFound));
      }
    }
    // The thumb's dorsal reference (the way its nail faces):
    // outward from the neck's back-left ridge in neck positions,
    // rotating to a back-of-hand / board-outward blend as the
    // hand rolls onto the board. The chain flexes toward the
    // opposite (palmar) side -- pad toward the neck.
    const radialOutT = norm(add(mul(backDir, 0.62), mul(M.v, -0.62)));
    const dorsalRefT = norm(add(mul(radialOutT, 1 - lam),
      mul(norm(add(backN, M.n)), lam)));
    const thumbSol = thumbChain(thumbRoot, restPt, dorsalRefT);
    const thumbPts = thumbSol.points;
    const thumbSolve = { beta1: thumbSol.beta1, beta2: thumbSol.beta2, gamma: thumbSol.gamma, tipErr: thumbSol.tipErr, pullback: thumbPullback };
    // Bow + right arm. The stroke fraction is eased to 17%..83% of
    // the bow: at the extreme tip the frog lever (~0.72 m from a
    // contact already ~0.57 m from the shoulder) would over-extend
    // the arm's fixed bone lengths.
    const bowF = 0.5 + (tr.bow(t) - 0.5) * 0.66;
    const sFloat = tr.string(t);
    const s0 = clamp(Math.floor(sFloat), 0, 3), s1 = clamp(s0 + 1, 0, 3), sf = sFloat - s0;
    const contact = lerp(M.bowContact(s0), M.bowContact(s1), sf);
    const dir = norm(lerp(M.bowDir(s0), M.bowDir(s1), sf));
    const frog = sub(contact, mul(dir, bowF * M.BOW_LENGTH));
    const tip = add(contact, mul(dir, (1 - bowF) * M.BOW_LENGTH));
    // frog/tip are the HAIR line (through the contact); the hand
    // grips the STICK, 20 mm toward the audience from the hair.
    const stickFrog = add(frog, mul(M.n, 0.020)), stickTip = add(tip, mul(M.n, 0.020));
    const wristR = add(stickFrog, add(mul(dir, -0.010), [0, 0.012, 0]));
    const elbowR = solveElbow(SHOULDER_R, wristR, [-0.55, -1, 0.15]);
    const sway = {
      lean: 0.035 + 0.012 * Math.sin(t * 0.45),
      turn: 0.05 * Math.sin(t * 0.23 + 1.2),
      breath: 0.006 * Math.sin(t * 2 * Math.PI * 0.22)
    };
    return {
      leftArm: { shoulder: SHOULDER_L, elbow: elbowL, wrist },
      rightArm: { shoulder: SHOULDER_R, elbow: elbowR, wrist: wristR },
      fingers, thumb: { points: thumbPts },
      bow: { frog, tip, contact, string: sFloat, frac: bowF, stickFrog, stickTip },
      hand: { anchor: anchorPt, mode, lambda: lam, backNormal: palm.basis.z, palm, carpus, row: { centre: K, axis: palmX, half: H.xHalf }, thumbRoot, thumbBase, thumbRest: restPt, wrist, elbowFallback, variant: VARI.name, mcpWorst, wristBackRelax, thumbSolve, wristFlex: H.elbowFlex, wristDev: H.elbowDev, elbowCone: H.elbowCone, elbowViol: H.elbowViol, pronation: H.pronation }, sway,
      sounding: sounding.map(({ r }) => r.string)
    };
  }

  // ---- drawing ----
  const SKIN = [0.76, 0.57, 0.45], SKIN_L = [0.82, 0.64, 0.51], SUIT = [0.050, 0.052, 0.064],
    SHIRT = [0.85, 0.84, 0.81], HAIR = [0.075, 0.058, 0.05], WOOD = [0.16, 0.10, 0.06],
    LASH = [0.20, 0.12, 0.10], LIP1 = [0.62, 0.38, 0.33], LIP2 = [0.70, 0.48, 0.40];

  function drawFigure(R, p) {
    // Chair + legs (seated, knees spread around the cello).
    R.box([0, 0.445, 0.14], [0.47, 0.045, 0.44], WOOD);
    R.box([0, 0.70, 0.35], [0.47, 0.55, 0.04], WOOD);
    for (const sx of [-1, 1]) {
      R.segment([sx * 0.20, 0.44, 0.30], [sx * 0.20, 0.0, 0.30], 0.02, WOOD, 'limb');
      const hip = [sx * 0.105, 0.53, 0.10], knee = [sx * 0.225, 0.475, -0.315], ankle = [sx * 0.235, 0.045, -0.20];
      R.segment(hip, knee, 0.062, SUIT, 'limb');
      R.segment(knee, ankle, 0.047, SUIT, 'limb');
      R.piece('shoe', add(ankle, [0, -0.012, -0.045]), [0.075, 0.045, 0.145], [0.02, 0.02, 0.025]);
    }
    // Torso, head.
    const lean = p.sway.lean;
    R.piece('jacket', [0, 0.875, 0.085], [0.185, 0.30, 0.135], SUIT, lean, 0, -p.sway.turn); // z-turn negated: planning frame is X-mirrored
    // The head loft's face is its local +Z, and the player faces -Z
    // (toward the audience): without the PI yaw the face pointed at
    // the chair back. With it, the 0.38 X-tilt reads as a downward
    // glance toward the fingerboard.
    const headC = [-0.012, 1.315 + p.sway.breath, 0.045], HX = 0.38, HY = Math.PI, HZ = 0.06;
    R.piece('head', headC, [0.105, 0.125, 0.112], SKIN, HX, HY, HZ);
    R.piece('hair', [-0.016, 1.345 + p.sway.breath, 0.062], [0.108, 0.122, 0.115], HAIR, 0.30, Math.PI, 0.06);
    // Face, mirroring the pianist's construction (demos-pianist
    // app.js): the same nose loft piece, two-segment lowered-lid
    // lash lines, hair-colour brows, joint-loft ears and two lip
    // segments, at the pianist's head-local offsets scaled by the
    // head-radii ratio ([.105,.125,.112] / [.112,.148,.128]).
    // headPoint applies the head's own Rz*Ry*Rx frame, so the
    // features ride the animated head on its true front (+Z local).
    const headPoint = q => {
      const cx = Math.cos(HX), sx = Math.sin(HX), cy = Math.cos(HY), sy = Math.sin(HY), cz = Math.cos(HZ), sz = Math.sin(HZ);
      const y1 = q[1] * cx - q[2] * sx, z1 = q[1] * sx + q[2] * cx;
      const x2 = q[0] * cy + z1 * sy, z2 = -q[0] * sy + z1 * cy;
      return [headC[0] + x2 * cz - y1 * sz, headC[1] + x2 * sz + y1 * cz, headC[2] + z2];
    };
    R.piece('nose', headPoint([0, -0.0101, 0.1068]), [0.015, 0.0287, 0.0175], SKIN_L, HX, HY, HZ);
    for (const s of [-1, 1]) {
      const ex = s * 0.0375, lid = 0.0101;
      R.segment(headPoint([ex - 0.0159, lid + 0.0017, 0.0989]), headPoint([ex, lid - 0.0025, 0.105]), 0.002, LASH);
      R.segment(headPoint([ex, lid - 0.0025, 0.105]), headPoint([ex + 0.0159, lid + 0.0008, 0.0998]), 0.002, LASH);
      R.segment(headPoint([ex - 0.0188, 0.0338, 0.1033]), headPoint([ex + 0.0169, 0.0363, 0.1033]), 0.0028, HAIR);
      R.piece('joint', headPoint([s * 0.1022, -0.0068, -0.007]), [0.0113, 0.0253, 0.0193], SKIN, HX, HY, HZ);
    }
    R.segment(headPoint([-0.0188, -0.0625, 0.0989]), headPoint([0.0188, -0.0625, 0.0989]), 0.0037, LIP1);
    R.segment(headPoint([-0.0113, -0.0701, 0.0963]), headPoint([0.0113, -0.0701, 0.0963]), 0.0031, LIP2);
    // Arms. Both forearms end at their wrist joints; only the
    // right keeps a wrist ball (the bow hand's mass) -- the left
    // wrist is the palm assembly's proximal end, drawn below.
    // PART OVERLAP (rk, phase 2, DRAWING ONLY -- no pose data
    // changes): the loft profiles taper to 0.35-0.62 of the
    // segment radius at their ends, so bare end-to-end segments
    // neck visibly at every joint. Segments are therefore drawn
    // extended past their joint points into the neighbouring
    // part (10-12 mm on the arms), and a ball of ~the adjoining
    // radius sits on the joint itself, so the surface reads
    // continuous. The same treatment runs on the finger/thumb
    // chains below (extensions 0.22x segment length; joint balls
    // sized by the no-bulge rule there, see drawChain).
    for (const [arm, sleeve] of [[p.leftArm, SUIT], [p.rightArm, SUIT]]) {
      const dUE = norm(sub(arm.elbow, arm.shoulder)), dEF = norm(sub(arm.wrist, arm.elbow));
      R.segment(arm.shoulder, add(arm.elbow, mul(dUE, 0.012)), 0.047, sleeve, 'limb');
      R.segment(sub(arm.elbow, mul(dEF, 0.012)), add(arm.wrist, mul(dEF, 0.012)), 0.038, sleeve, 'limb');
      R.ball(arm.elbow, [0.046, 0.046, 0.046], sleeve);
      R.ball(arm.shoulder, [0.050, 0.050, 0.050], sleeve);
    }
    R.ball(p.rightArm.wrist, [0.042, 0.046, 0.042], SKIN);
    // Left hand, one assembly (see pose()): carpus at the wrist
    // joint, the palm plate spanning wrist -> knuckle row, a
    // thenar ball at the thumb's root, then the fingers and thumb
    // chained out of the row / thenar corner. Drawn before the
    // fingers so the chains emerge from the plate's knuckle edge.
    const pm = p.hand.palm, cp = p.hand.carpus;
    // The carpus is drawn 1.15x its pose radii so the wrist/palm
    // junction blends into the forearm's extended end (the pose
    // radii stay the anatomical ones the tests measure).
    R.piece('joint', cp.centre, cp.radii.map(r => r * 1.15), SKIN, cp.euler[0], cp.euler[1], cp.euler[2]);
    R.piece('joint', pm.centre, pm.radii, SKIN, pm.euler[0], pm.euler[1], pm.euler[2]);
    // Thenar mass: a capsule from the thumb's CMC base to its
    // (possibly slid) root, plus the ball on the root. (Capsule
    // radius 0.0185, up from 0.0165, so its ends sink into the
    // palm corner and the root ball instead of necking.)
    R.segment(p.hand.thumbBase, p.hand.thumbRoot, 0.0185, SKIN, 'limb');
    R.ball(p.hand.thumbRoot, [0.019, 0.023, 0.017], SKIN);
    // Left fingers + thumb, per-finger radii, with the part-
    // overlap treatment: each segment drawn extended past its
    // distal joint (0.22x its length; the fingertip segment is
    // NOT extended -- nothing may poke past the contact point)
    // and seated 0.18-0.22x into the proximal part. Continuity
    // comes from that overlap, NOT from ball size (rk: the 1.08x
    // joint balls / 1.05x knuckle balls of the first overlap
    // pass protruded past the segment capsules and read as
    // beads -- deko-boko). NO-BULGE RULE for every ball on a
    // chain: its radius stays at the local segment radius --
    // the plain mean of the two adjoining radii at an inner
    // joint -- so the joint width always lies BETWEEN its
    // neighbours' widths and the
    // silhouette tapers monotonically instead of beading. The
    // segments use the 'limb' loft, not 'joint': the 'joint'
    // profile pinches to 0.75x at its ends and 0.35x at the
    // tips, so each phalanx swelled mid-segment and pinched at
    // the joints (a pill shape) however the balls were sized,
    // while 'limb' holds the full radius across the middle 70%
    // of the drawn length -- with the 0.22x extensions, that
    // plateau covers the whole anatomical span and the taper
    // hides inside the neighbouring part. There is NO knuckle
    // ball: a sphere at a root reaches its full radius along
    // the palm's normal too, so it stood up to ~5 mm proud of
    // the flat palm plate as a marble on the back of the hand,
    // where the segment tube itself (a disc across the finger
    // axis) reaches only ~1-2 mm past the plate. Segment 0
    // instead seats into the plate, so the tube's own
    // plateau forms the knuckle as it emerges. Segment 0 is
    // drawn in two pieces for the fingers: a root piece at
    // 0.74x radius from an 0.18x seat inside the plate to
    // 0.45x along the segment, underneath the full-radius
    // piece. A full-diameter tube (26-28 mm) is as thick as
    // the palm plate itself (28 mm), so wherever a root sits
    // off the plate's mid-plane the plain tube crested the
    // plate's back as a round dome (measured worst: finger 3
    // in thumb position); the thinned root stays under the
    // plate surface while the full piece flares out of it
    // over ~2 mm, so the finger reads as emerging from the
    // hand rather than beaded onto it. (The thumb's root sits
    // in the thenar mass, not over the plate -- single piece.)
    const drawChain = (pts, radii, colOf, rootThin) => {
      for (let j = 0; j < 3; j++) {
        const a = pts[j], b = pts[j + 1], d = sub(b, a), L = Math.hypot(...d) || 1e-9, dir = mul(d, 1 / L);
        const extA = (j === 0 ? 0.18 : 0.22) * L, extB = j === 2 ? 0 : 0.22 * L;
        if (j === 0 && rootThin)
          R.segment(sub(a, mul(dir, extA)), add(a, mul(dir, 0.45 * L)), radii[0] * 0.74, colOf(0), 'limb');
        R.segment(sub(a, mul(dir, j === 0 && rootThin ? -0.15 * L : extA)), add(b, mul(dir, extB)), radii[j], colOf(j), 'limb');
        if (j < 2) { const rB = (radii[j] + radii[j + 1]) / 2; R.ball(b, [rB, rB, rB], colOf(j + 1)); }
      }
    };
    for (let f = 1; f <= 4; f++)
      drawChain(p.fingers[f].points, FINGER_R[f], j => j === 2 ? SKIN_L : SKIN, true);
    drawChain(p.thumb.points, THUMB_R, () => SKIN, false); // root ball already drawn above
    // Right hand curled on the bow frog: palm + four short fingers.
    const bw = p.rightArm.wrist, bd = norm(sub(p.bow.tip, p.bow.frog));
    R.ball(add(bw, mul(bd, 0.012)), [0.045, 0.038, 0.048], SKIN);
    for (let f = 0; f < 4; f++) {
      const b0 = add(bw, add(mul(bd, -0.008 + f * 0.013), mul(M.n, -0.018)));
      const b1 = add(b0, add(mul(bd, 0.010), mul(M.n, 0.020)));
      R.segment(b0, b1, 0.010, SKIN, 'joint');
    }
  }

  function draw(R, song, t, opts = {}) {
    const p = pose(song, t);
    M.drawCello(R, { hotString: p.sounding.length ? p.sounding[0] : -1 });
    M.drawBow(R, clamp(Math.round(p.bow.string), 0, 3), p.bow.frac);
    drawFigure(R, p);
    return p;
  }

  return { plan, pose, draw, setVariant, VARIANTS, ROM, _ik: { solveElbow, fingerChain, MIN_SPAN }, SKELETON: { SHOULDER_L, SHOULDER_R, ARM, FINGER_LEN, FINGER_R, THUMB_LEN, THUMB_R, HAND: { PALM_LEN, ROW_S, KNUCKLE_ARC } } };
})();

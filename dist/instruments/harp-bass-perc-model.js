'use strict';
/* 3D models, live kinematics, and performers for:
 *  - Concert Grand Harp (47 color-coded strings + 7 pedals + female harpist)
 *  - Upright Double Bass (1.95 m upright bass + alternating French bow + left-hand shifts)
 *  - Concert Percussion (Rosewood Marimba with mallets + 4 Copper Timpani)
 */
window.HarpBassPercEngine = (() => {
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
  const unit = a => mul(a, 1 / (Math.hypot(...a) || 1));
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

  function solveArm2(S, W, L1, L2, hint) {
    const v = sub(W, S), dist = Math.hypot(...v), dir = unit(v);
    const d = clamp(dist, 0.05, L1 + L2 - 1e-4);
    const a = (L1 * L1 - L2 * L2 + d * d) / (2 * d);
    let bend = sub(hint, mul(dir, dot(hint, dir)));
    if (Math.hypot(...bend) < 1e-6) bend = cross(dir, [0, 0, 1]);
    bend = unit(bend);
    const E = add(add(S, mul(dir, a)), mul(bend, Math.sqrt(Math.max(0, L1 * L1 - a * a))));
    return { shoulder: S, elbow: E, wrist: W };
  }

  const gold = [.82, .66, .28], goldBright = [.96, .80, .38], spruce = [.76, .58, .34], maple = [.52, .26, .11],
    rosewood = [.36, .16, .09], copper = [.76, .42, .22], drumHead = [.90, .86, .76],
    ebony = [.032, .034, .042], ivory = [.92, .90, .84], redStr = [.82, .18, .18], blueStr = [.18, .32, .78],
    skin = [.74, .55, .43], skinLight = [.80, .62, .50], suit = [.048, .050, .062], shirt = [.86, .85, .82],
    hairM = [.07, .055, .048], hairF = [.115, .068, .046], lash = [.20, .12, .10], pearl = [.94, .90, .82];

  function drawHead(R, pos, pitch, yaw, female) {
    const HS = female ? [.074, .105, .088] : [.078, .110, .092];
    const FS = [HS[0] / .112, HS[1] / .148, HS[2] / .128];
    const sc = p => [p[0] * FS[0], p[1] * FS[1], p[2] * FS[2]];
    const hp = p => {
      const q = sc(p), c = Math.cos(pitch), s = Math.sin(pitch), cy = Math.cos(yaw), sy = Math.sin(yaw);
      const y = q[1] * c - q[2] * s, z = q[1] * s + q[2] * c;
      return [pos[0] + q[0] * cy + z * sy, pos[1] + y, pos[2] + z * cy - q[0] * sy];
    };
    const hc = female ? hairF : hairM;
    R.setFaceDetail?.(true);
    R.piece('head', pos, HS, skinLight, pitch, yaw, 0);
    R.piece('hair', hp([0, 0.004, 0]), sc([.120, .150, .135]), hc, pitch, yaw, 0);
    if (female) {
      R.ball(hp([0, -0.022, -0.135]), sc([.054, .052, .048]), hc);
      for (const x of [-1, 1]) {
        R.segment(hp([x * 0.098, 0.025, -0.020]), hp([x * 0.096, -0.135, -0.025]), 0.020, hc);
        R.ball(hp([x * 0.112, -0.036, -0.005]), [.0055, .0055, .0055], pearl, 0.7);
      }
    }
    R.piece('nose', hp([0, -0.012, 0.122]), sc([.015, .032, .019]), skinLight, pitch, yaw, 0);
    for (const x of [-1, 1]) {
      const ex = x * 0.04;
      R.segment(hp([ex - 0.017, 0.010, 0.113]), hp([ex, 0.005, 0.120]), 0.0018, lash);
      R.segment(hp([ex, 0.005, 0.120]), hp([ex + 0.017, 0.009, 0.114]), 0.0018, lash);
    }
    R.segment(hp([-0.018, -0.074, 0.113]), hp([0.018, -0.074, 0.113]), 0.0032, female ? [.74, .34, .36] : [.62, .38, .33]);
    R.setFaceDetail?.(false);
  }

  function drawSimpleArm(R, arm, attire, female) {
    R.segment(arm.shoulder, arm.elbow, 0.048, attire);
    R.ball(arm.elbow, [.046, .046, .046], attire);
    R.segment(arm.elbow, arm.wrist, 0.040, attire);
    if (!female) R.ball(arm.wrist, [.024, .024, .024], shirt);
    R.ball(arm.wrist, [.028, .020, .038], skin);
  }

  const HARP_FL = [[.0368, .0224, .016], [.0416, .0256, .0176], [.0384, .024, .0168], [.0304, .0192, .0136]];
  const HARP_TL = [.034, .026, .018], HARP_TR = [.010, .0085, .0070];
  const HARP_FR = [[.0076, .0070, .0060], [.0082, .0076, .0064], [.0078, .0072, .0060], [.0067, .0061, .0052]];
  const HARP_ROOT = [[.027, .070, 0], [.009, .074, 0], [-.009, .072, 0], [-.027, .066, 0], [.020, .020, -.010]];
  const harpRes = (L, q) => [L[0] + L[1] * Math.cos(q) + L[2] * Math.cos(1.67 * q), L[1] * Math.sin(q) + L[2] * Math.sin(1.67 * q)];
  function solveHarpFinger(base, tgt, L, hint) {
    const v = sub(tgt, base), reach = clamp(Math.hypot(...v), Math.hypot(...harpRes(L, 2.0)), L[0] + L[1] + L[2] - 1e-6), ax = unit(v);
    let ay = sub(hint, mul(ax, dot(hint, ax))); if (Math.hypot(...ay) < 1e-6) ay = cross(ax, [0, 1, 0]); ay = unit(ay);
    let lo = 0, hi = 2.0; for (let k = 0; k < 14; k++) { const q = (lo + hi) / 2; if (Math.hypot(...harpRes(L, q)) > reach) lo = q; else hi = q; }
    const q = (lo + hi) / 2, [a, b] = harpRes(L, q), ang = Math.atan2(b, a), pts = [base];
    for (let j = 0; j < 3; j++) { const th = ang - (j === 0 ? 0 : j === 1 ? q : 1.67 * q); pts.push(add(pts[j], add(mul(ax, L[j] * Math.cos(th)), mul(ay, L[j] * Math.sin(th))))); }
    return pts;
  }
  const harpSkins = new WeakMap();
  const percSkins = new WeakMap();
  function getSkinPair(map, R) {
    let skins = map.get(R);
    if (!skins && window.ViolinFingerSkin) {
      skins = [window.ViolinFingerSkin.create(false, true, true, true), window.ViolinFingerSkin.create(false, true, false, true)];
      for (const sk of skins) { sk.thumb.radii = HARP_TR; sk.thumb.skinBaseT = 0.65; }
      map.set(R, skins);
    }
    return skins;
  }
  // Matched-grip 5-digit hand wrapping around a mallet shaft (wrist -> shaftDir).
  function buildMalletHand(isRight, wrist, tip) {
    const side = isRight ? -1 : 1;
    const Y = unit(sub(tip, wrist));                         // distal (+Y) along mallet shaft
    const X = unit(cross(Y, [0, 1, 0]));                     // radial across back of hand
    const rad = dot(X, [side, 0, 0]) < 0 ? mul(X, -1) : X;   // +X toward thumb/inner side
    let Z = unit(cross(rad, Y));
    if (!isRight && dot(cross(rad, Y), Z) > 0) Z = mul(Z, -1);
    if (isRight && dot(cross(rad, Y), Z) < 0) Z = mul(Z, -1);
    const basis = [rad, Y, Z];
    const hpt = p => add(wrist, add(mul(rad, p[0]), add(mul(Y, p[1]), mul(Z, p[2]))));
    // Shaft passes through palm center at [0, s, -0.014]; fingers curl underneath & around it
    const grip = (s, d) => hpt([0.002 * side, s, -0.014 - d]);
    const hint = add(mul(Z, -0.8), mul(rad, -0.4));
    const targets = [
      grip(0.088, 0.004), grip(0.072, 0.005), grip(0.056, 0.005), grip(0.042, 0.004),
    ];
    const thTgt = hpt([0.006, 0.092, -0.004]); // thumb along top/inner fulcrum of shaft
    const fingers = targets.map((pt, i) => ({ points: solveHarpFinger(hpt(HARP_ROOT[i]), pt, HARP_FL[i], hint), radii: HARP_FR[i] }));
    return { model: 'mallet', wrist, palmPos: hpt([0, 0.036, 0]), basis, fingers, thumb: solveHarpFinger(hpt(HARP_ROOT[4]), thTgt, HARP_TL, add(mul(Z, 0.7), mul(rad, 0.5))), gripPt: hpt([0, 0.055, -0.014]) };
  }
  function buildHarpHand(isRight, cy, cz, pluckPhase) {
    const side = isRight ? -1 : 1;
    const wrist = [side * 0.12 - 0.04, cy - 0.02, cz + 0.09];
    const X = [0, 1, 0], Y = unit([-side * 0.42, 0.05, -0.90]);
    let Z = unit(cross(X, Y));
    if (!isRight && dot(cross(X, Y), Z) > 0) Z = mul(Z, -1);
    if (isRight && dot(cross(X, Y), Z) < 0) Z = mul(Z, -1);
    const basis = [X, Y, Z], hpt = p => add(wrist, add(mul(X, p[0]), add(mul(Y, p[1]), mul(Z, p[2]))));
    const curl = Math.sin(pluckPhase) * 0.014, hint = [side * 0.85, 0.35, 0.35];
    const targets = [
      [-0.04 + side * (0.008 + curl), cy + 0.015, cz - 0.010],
      [-0.04 + side * (0.008 - curl * 0.5), cy - 0.008, cz - 0.028],
      [-0.04 + side * (0.010 + curl * 0.4), cy - 0.028, cz - 0.044],
      [-0.04 + side * 0.032, cy - 0.045, cz - 0.020],
    ];
    const thTgt = [-0.04 + side * (0.006 - curl * 0.6), cy + 0.042, cz + 0.012];
    const fingers = targets.map((pt, i) => ({ points: solveHarpFinger(hpt(HARP_ROOT[i]), pt, HARP_FL[i], hint), radii: HARP_FR[i] }));
    return { model: 'harp', wrist, palmPos: hpt([0, 0.035, 0]), basis, fingers, thumb: solveHarpFinger(hpt(HARP_ROOT[4]), thTgt, HARP_TL, [side * 0.5, 0.85, 0.2]) };
  }

  // ---- PLAN ----
  function plan(kind, song) {
    const notes = song.notes.map((n, i) => ({ i, t0: n[0], dur: n[1], t1: n[0] + n[1], pitch: n[2], vel: n[3] }));
    // For Double Bass: assign alternating down-bow / up-bow strokes per note
    if (kind === 'bass') {
      let prevEnd = null, prevFrac = 0.22, dir = 1;
      for (let i = 0; i < notes.length; i++) {
        const nt = notes[i];
        const longRest = prevEnd != null && nt.t0 - prevEnd >= 0.9;
        dir = (i === 0 || longRest) ? 1 : -dir;
        const travel = clamp(0.18 + 0.45 * Math.sqrt(Math.min(nt.dur / 1.8, 1)), 0.18, 0.62);
        const from = longRest ? 0.20 : prevFrac;
        const to = clamp(from + dir * travel, 0.16, 0.84);
        nt.bowFrom = from; nt.bowTo = to; nt.dir = dir;
        // Map E1(28), A1(33), D2(38), G2(43)
        const opens = [28, 33, 38, 43];
        let s = 0;
        for (let k = 0; k < 4; k++) if (nt.pitch >= opens[k]) s = k;
        nt.string = s; nt.semi = Math.max(0, nt.pitch - opens[s]);
        prevEnd = nt.t1; prevFrac = to;
      }
    }
    return { kind, song, notes, duration: song.duration, percKind: song.percKind || 'marimba' };
  }

  function stateAt(P, t) {
    const tc = Number.isFinite(t) ? t : 0;
    const active = P.notes.filter(n => tc >= n.t0 && tc <= n.t1);
    let last = P.notes[0] || null;
    for (const n of P.notes) { if (n.t0 <= tc) last = n; else break; }
    return { kind: P.kind, percKind: P.percKind, time: tc, active, last, notes: P.notes };
  }

  // ---- 1. CONCERT GRAND HARP ----
  function drawHarp(R, S) {
    const gown = [.085, .042, .088];
    // Harp sits directly in front of the seated female harpist, angled slightly toward right shoulder
    const pillarBot = [-0.04, 0.08, -0.78], pillarTop = [-0.04, 1.82, -0.82];
    const baseBack = [-0.04, 0.10, -0.14], neckBack = [-0.04, 1.32, -0.10];
    // Pedestal + 7 brass pedals
    R.box([-0.04, 0.05, -0.46], [0.34, 0.10, 0.72], gold, 0.6);
    for (let i = -3; i <= 3; i++) R.box([-0.04 + i * 0.042, 0.06, -0.08], [0.020, 0.012, 0.075], goldBright, 0.85);
    // Fluted golden pillar + crown
    R.segment(pillarBot, pillarTop, 0.036, gold, 'limb');
    R.ball(pillarTop, [.055, .070, .055], goldBright, 0.85);
    // Tapered spruce soundboard
    R.segment(baseBack, neckBack, 0.078, spruce, 'limb');
    R.segment(add(baseBack, [0, 0.02, -0.05]), add(neckBack, [0, 0.02, -0.03]), 0.055, maple, 'limb');
    // Curved harmonic neck (arch from pillarTop to neckBack)
    const neckPts = [];
    for (let i = 0; i <= 12; i++) {
      const u = i / 12;
      const z = -0.82 + u * 0.72;
      const y = 1.80 * (1 - u) + 1.32 * u - Math.sin(u * Math.PI) * 0.14;
      neckPts.push([-0.04, y, z]);
      if (i > 0) R.segment(neckPts[i - 1], neckPts[i], 0.026, gold, 'limb');
    }
    // 32 visible strings (diatonic C2..G6) with red C & blue F color coding + gold active pluck!
    const activeSet = new Set(S.active.map(n => n.pitch));
    let lhZ = -0.52, lhY = 0.96, rhZ = -0.32, rhY = 1.06;
    const lhPts = [], rhPts = [];
    for (let i = 0; i < 32; i++) {
      const u = (i + 1) / 33;
      const zTop = -0.80 + u * 0.68;
      const yTop = 1.78 * (1 - u) + 1.32 * u - Math.sin(u * Math.PI) * 0.14;
      const zBot = -0.70 + u * 0.56;
      const yBot = 0.16 + u * 1.12;
      const pitch = 36 + Math.round(i * 1.75);
      const hot = [...activeSet].some(p => Math.abs(p - pitch) <= 1);
      const pc = pitch % 12;
      const col = hot ? goldBright : pc === 0 ? redStr : pc === 5 ? blueStr : ivory;
      R.bone([-0.04, yBot, zBot], [-0.04, yTop, zTop], hot ? 0.0028 : 0.0014, col);
      if (hot) {
        const py = (yBot + yTop) * 0.48, pz = (zBot + zTop) * 0.50;
        if (pitch < 60) lhPts.push([py, pz]); else rhPts.push([py, pz]);
      }
    }
    if (lhPts.length) { lhY = lhPts.reduce((a, b) => a + b[0], 0) / lhPts.length; lhZ = lhPts.reduce((a, b) => a + b[1], 0) / lhPts.length; }
    if (rhPts.length) { rhY = rhPts.reduce((a, b) => a + b[0], 0) / rhPts.length; rhZ = rhPts.reduce((a, b) => a + b[1], 0) / rhPts.length; }

    // Seated female harpist in concert gown with articulated 5-digit hands!
    R.box([0, 0.47, 0.24], [0.44, 0.045, 0.36], ebony);
    for (const sx of [-0.18, 0.18]) for (const sz of [0.10, 0.38]) R.segment([sx, 0.45, sz], [sx, 0, sz], 0.018, ebony);
    for (const s of [-1, 1]) {
      R.segment([s * 0.11, 0.52, 0.20], [s * 0.15, 0.46, -0.14], 0.064, gown);
      R.segment([s * 0.15, 0.46, -0.14], [s * 0.14, 0.05, -0.10], 0.052, gown);
      R.piece('shoe', [s * 0.14, 0.032, -0.16], [.044, .030, .122], ebony, 0, Math.PI, 0);
    }
    const sway = Math.sin(S.time * 1.1) * 0.018;
    R.piece('torso', [sway * 0.5, 0.62, 0.20], [.156, .105, .114], gown);
    R.piece('jacket', [sway, 0.89, 0.16], [.174, .258, .122], gown, 0.10, 0, 0);
    const headC = [0.02 + sway, 1.29, 0.09];
    R.segment([sway, 1.13, 0.13], [headC[0], headC[1] - 0.04, headC[2]], 0.034, skin);
    drawHead(R, headC, 0.18, Math.PI - 0.08, true);

    // Full 5-digit closed-skin harp hands (hoisted solver, 0 per-frame allocations)
    const handL = buildHarpHand(false, lhY, lhZ, S.time * 7.5);
    const handR = buildHarpHand(true, rhY, rhZ, S.time * 7.5 + 1.8);
    const armL = solveArm2([0.170 + sway, 1.12, 0.12], handL.wrist, 0.275, 0.255, [0.85, -0.45, 0.2]);
    const armR = solveArm2([-0.170 + sway, 1.12, 0.12], handR.wrist, 0.275, 0.255, [-0.85, -0.45, 0.2]);
    window.BowHand.drawArm(R, armL, handL, { suit: gown, skin, shirt: gown });
    window.BowHand.drawArm(R, armR, handR, { suit: gown, skin, shirt: gown });
    const skins = getSkinPair(harpSkins, R);
    if (skins && R.dynamicMesh) {
      R.dynamicMesh('harp-hand-0', window.ViolinFingerSkin.update(skins[0], handL), skin);
      R.dynamicMesh('harp-hand-1', window.ViolinFingerSkin.update(skins[1], handR), skin);
    }
  }

  // ---- 2. UPRIGHT DOUBLE BASS ----
  function drawBass(R, S) {
    // Towering upright contrabass (~1.95 m tall) leaning against bassist's left hip
    const base = [0.22, 0.02, -0.26], top = [0.18, 1.92, -0.14];
    R.segment(base, [0.21, 0.24, -0.25], 0.008, [.78, .80, .82], 'limb'); // endpin
    // Carved spruce/maple body (lower bout, waist, upper bout)
    R.piece('torso', [0.21, 0.58, -0.24], [.33, .28, .13], maple);
    R.piece('torso', [0.20, 0.88, -0.22], [.24, .18, .12], maple);
    R.piece('torso', [0.19, 1.10, -0.20], [.28, .20, .12], maple);
    // Bridge, tailpiece, ebony fingerboard, scroll
    R.box([0.20, 0.68, -0.37], [0.16, 0.02, 0.05], spruce);
    R.segment([0.21, 0.28, -0.35], [0.20, 0.62, -0.37], 0.028, ebony, 'limb');
    R.segment([0.19, 0.82, -0.33], [0.18, 1.78, -0.22], 0.034, ebony, 'limb');
    R.ball(top, [.042, .055, .048], maple);
    const activeStr = S.active[0]?.string ?? -1;
    for (let i = 0; i < 4; i++) {
      const vx = (i - 1.5) * 0.018;
      const hot = i === activeStr;
      R.bone([0.20 + vx, 0.32, -0.37], [0.18 + vx * 0.7, 1.78, -0.25], hot ? 0.0038 : 0.0024, hot ? goldBright : [.76, .78, .80]);
    }
    // Bow (alternating down-bow / up-bow per note!)
    const nt = S.active[0] || S.last;
    let bowF = 0.45, semi = 2;
    if (nt) {
      const u = clamp((S.time - nt.t0) / Math.max(0.04, nt.dur), 0, 1);
      bowF = nt.bowFrom + (nt.bowTo - nt.bowFrom) * u;
      semi = nt.semi || 0;
    }
    const contact = [0.20, 0.74, -0.39], bowDir = [0.98, -0.14, 0.08], bowLen = 0.68;
    const frog = sub(contact, mul(bowDir, bowF * bowLen)), tip = add(contact, mul(bowDir, (1 - bowF) * bowLen));
    R.bone(frog, tip, 0.0045, rosewood);
    R.bone(add(frog, [0, -0.014, 0]), add(tip, [0, -0.008, 0]), 0.0022, ivory);
    // Standing bassist
    for (const s of [-1, 1]) {
      const hip = [s * 0.095 - 0.04, 0.96, 0.06], knee = [s * 0.11 - 0.04, 0.51, 0.02], ankle = [s * 0.12 - 0.04, 0.072, 0.04];
      R.segment(hip, knee, 0.064, suit); R.segment(knee, ankle, 0.046, suit);
      R.piece('shoe', [ankle[0], 0.036, -0.035], [.054, .038, .136], ebony, 0, Math.PI, 0);
    }
    R.piece('torso', [-0.04, 0.95, 0.06], [.166, .105, .114], suit);
    R.piece('jacket', [-0.04, 1.18, 0.05], [.196, .258, .134], suit, 0.05, -0.12, 0);
    const headC = [-0.02, 1.59, 0.00];
    R.segment([-0.04, 1.43, 0.03], [headC[0], headC[1] - 0.04, headC[2]], 0.038, skin);
    R.segment([-0.04, 1.43, 0.03], [-0.03, 1.46, 0.02], 0.042, shirt);
    drawHead(R, headC, 0.16, Math.PI - 0.18, false);
    const bassVib = nt && nt.dur >= 0.4 && semi > 0 ? Math.sin(S.time * Math.PI * 2 * 4.6) * 0.009 : 0;
    const stopY = clamp(1.66 - semi * 0.042 + bassVib, 1.12, 1.68);
    const armL = solveArm2([0.15, 1.39, 0.02], [0.22, stopY, -0.26], 0.285, 0.265, [0.9, -0.3, 0.2]);
    const armR = solveArm2([-0.20, 1.39, 0.02], frog, 0.295, 0.275, [-0.8, -0.5, 0.2]);
    drawSimpleArm(R, armL, suit, false);
    drawSimpleArm(R, armR, suit, false);
  }

  // ---- 3. CONCERT PERCUSSION (MARIMBA / TIMPANI) ----
  function drawPercussion(R, S) {
    const isTimp = S.percKind === 'timpani';
    let lhTgt = [0.24, 0.98, -0.46], rhTgt = [-0.24, 0.98, -0.46];
    let lhLift = 0.09, rhLift = 0.09;

    if (!isTimp) {
      // Concert Rosewood Marimba (frame + brass resonators + natural & accidental bars)
      R.box([0, 0.85, -0.50], [1.72, 0.06, 0.62], ebony);
      for (const sx of [-0.78, 0.78]) for (const sz of [-0.74, -0.26]) R.segment([sx, 0.84, sz], [sx, 0.02, sz], 0.022, ebony);
      const activeP = new Set(S.active.map(n => n.pitch));
      const barPos = p => [clamp(((66 - p) / 28) * 0.74, -0.76, 0.76), 0.90, [1, 3, 6, 8, 10].includes(p % 12) ? -0.60 : -0.42];
      for (let p = 48; p <= 84; p++) {
        const [bx, by, bz] = barPos(p);
        const isSharp = [1, 3, 6, 8, 10].includes(p % 12);
        const hot = activeP.has(p);
        R.box([bx, by + (isSharp ? 0.026 : 0), bz], [0.036, 0.018, isSharp ? 0.16 : 0.24], hot ? goldBright : rosewood);
        if (!isSharp) {
          const resLen = 0.18 + (84 - p) * 0.011;
          R.segment([bx, by - 0.03, bz], [bx, by - 0.03 - resLen, bz], 0.015, gold, 'limb');
        }
      }
      // Mallet strike trajectories
      const nt = S.active[0] || S.last;
      if (nt) {
        const bp = barPos(nt.pitch);
        const phase = clamp((S.time - nt.t0) / Math.max(0.05, Math.min(0.22, nt.dur)), 0, 1);
        const bounce = Math.sin(phase * Math.PI) * 0.10;
        if (nt.i % 2 === 0) { lhTgt = [bp[0], bp[1] + 0.02, bp[2]]; lhLift = 0.01 + bounce; }
        else { rhTgt = [bp[0], bp[1] + 0.02, bp[2]]; rhLift = 0.01 + bounce; }
      }
    } else {
      // 4 Gleaming Copper Concert Timpani arranged in a natural playable arc
      const drums = [
        { x:  0.64, z: -0.34, r: 0.28, p: 41 }, // F2 (32")
        { x:  0.22, z: -0.58, r: 0.26, p: 45 }, // A2 (29")
        { x: -0.22, z: -0.58, r: 0.24, p: 48 }, // C3 (26")
        { x: -0.64, z: -0.34, r: 0.22, p: 53 }, // F3 (23")
      ];
      const activeP = new Set(S.active.map(n => n.pitch));
      const drumFor = p => drums.reduce((best, d) => Math.abs(d.p - p) < Math.abs(best.p - p) ? d : best, drums[0]);
      for (const d of drums) {
        const hot = [...activeP].some(p => drumFor(p) === d);
        // Copper kettle bowl (top at y=0.85, strictly below the flat drumhead!)
        R.ball([d.x, 0.56, d.z], [d.r, 0.29, d.r], copper, 0.85);
        // Steel counterhoop rim + flat taut drumhead on top (y=0.865)
        R.oriented('sphere', [d.x, 0.855, d.z], [d.r * 1.03, 0.014, d.r * 1.03], [.22, .23, .26], 0.7, [1, 0, 0], [0, 1, 0], [0, 0, 1]);
        R.oriented('sphere', [d.x, 0.866, d.z], [d.r * 0.97, 0.007, d.r * 0.97], hot ? goldBright : drumHead, 0.08, [1, 0, 0], [0, 1, 0], [0, 0, 1]);
        for (let k = 0; k < 6; k++) {
          const a = k * Math.PI / 3;
          R.ball([d.x + Math.cos(a) * d.r * 1.04, 0.862, d.z + Math.sin(a) * d.r * 1.04], [.010, .016, .010], [.75, .77, .80], 0.8);
        }
        for (let k = 0; k < 3; k++) {
          const a = k * Math.PI * 2 / 3;
          R.segment([d.x + Math.cos(a) * d.r * 0.85, 0.72, d.z + Math.sin(a) * d.r * 0.85], [d.x + Math.cos(a) * d.r * 0.7, 0.02, d.z + Math.sin(a) * d.r * 0.7], 0.014, ebony);
        }
      }
      lhTgt = [0.24, 0.90, -0.50]; rhTgt = [-0.24, 0.90, -0.50];
      const nt = S.active[0] || S.last;
      if (nt) {
        const d = drumFor(nt.pitch);
        const phase = clamp((S.time - nt.t0) / Math.max(0.05, Math.min(0.24, nt.dur)), 0, 1);
        const bounce = Math.sin(phase * Math.PI) * 0.14;
        // Left hand strikes left drums (d.x >= 0), right hand strikes right drums (d.x < 0)
        if (d.x >= 0) { lhTgt = [d.x - 0.04, 0.88, d.z + 0.06]; lhLift = 0.01 + bounce; }
        else { rhTgt = [d.x + 0.04, 0.88, d.z + 0.06]; rhLift = 0.01 + bounce; }
      }
    }

    // Standing percussionist
    for (const s of [-1, 1]) {
      const hip = [s * 0.095, 0.96, 0.10], knee = [s * 0.105, 0.51, 0.08], ankle = [s * 0.11, 0.072, 0.10];
      R.segment(hip, knee, 0.064, suit); R.segment(knee, ankle, 0.046, suit);
      R.piece('shoe', [ankle[0], 0.036, 0.02], [.054, .038, .136], ebony, 0, Math.PI, 0);
    }
    R.piece('torso', [0, 0.95, 0.10], [.166, .105, .114], suit);
    R.piece('jacket', [0, 1.18, 0.09], [.196, .258, .134], suit, 0.08, 0, 0);
    const headC = [0, 1.57, 0.03];
    R.segment([0, 1.43, 0.07], [headC[0], headC[1] - 0.04, headC[2]], 0.038, skin);
    R.segment([0, 1.43, 0.07], [0, 1.46, 0.06], 0.042, shirt);
    drawHead(R, headC, 0.28, Math.PI, false);

    // Arms + articulated 5-digit closed-skin hands gripping the birch mallets
    const wristL = [lhTgt[0] + 0.04, lhTgt[1] + 0.12 + lhLift, lhTgt[2] + 0.28];
    const wristR = [rhTgt[0] - 0.04, rhTgt[1] + 0.12 + rhLift, rhTgt[2] + 0.28];
    const tipL = [lhTgt[0], lhTgt[1] + lhLift, lhTgt[2]];
    const tipR = [rhTgt[0], rhTgt[1] + rhLift, rhTgt[2]];
    const handL = buildMalletHand(false, wristL, tipL);
    const handR = buildMalletHand(true, wristR, tipR);
    const armL = solveArm2([0.185, 1.38, 0.06], wristL, 0.275, 0.255, [0.7, -0.8, 0.2]);
    const armR = solveArm2([-0.185, 1.38, 0.06], wristR, 0.275, 0.255, [-0.7, -0.8, 0.2]);
    window.BowHand.drawArm(R, armL, handL, { suit, skin, shirt });
    window.BowHand.drawArm(R, armR, handR, { suit, skin, shirt });
    const skins = getSkinPair(percSkins, R);
    if (skins && R.dynamicMesh) {
      R.dynamicMesh('perc-hand-0', window.ViolinFingerSkin.update(skins[0], handL), skin);
      R.dynamicMesh('perc-hand-1', window.ViolinFingerSkin.update(skins[1], handR), skin);
    }
    // Birch mallet shafts extending cleanly through the grip + yarn/felt mallet heads
    const buttL = sub(handL.gripPt, mul(unit(sub(tipL, handL.gripPt)), 0.09));
    const buttR = sub(handR.gripPt, mul(unit(sub(tipR, handR.gripPt)), 0.09));
    R.bone(buttL, tipL, 0.0042, spruce); R.ball(tipL, [.018, .018, .018], isTimp ? ivory : [.78, .22, .22]);
    R.bone(buttR, tipR, 0.0042, spruce); R.ball(tipR, [.018, .018, .018], isTimp ? ivory : [.78, .22, .22]);
  }

  function draw(R, S) {
    if (S.kind === 'harp') return drawHarp(R, S);
    if (S.kind === 'bass') return drawBass(R, S);
    return drawPercussion(R, S);
  }

  return { plan, stateAt, draw };
})();

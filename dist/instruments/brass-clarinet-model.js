'use strict';
/* 3D models, valve/keywork animations, articulated hands, and standing
 * performers for Bb Concert Trumpet and Bb Boehm Clarinet. */
window.BrassClarinetEngine = (() => {
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const smooth = v => { v = clamp(v, 0, 1); return v * v * v * (v * (v * 6 - 15) + 10); };
  const add = (a, b) => a.map((v, i) => v + b[i]);
  const sub = (a, b) => a.map((v, i) => v - b[i]);
  const mul = (a, s) => a.map(v => v * s);
  const dot = (a, b) => a.reduce((r, v, i) => r + v * b[i], 0);
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const unit = a => mul(a, 1 / (Math.hypot(...a) || 1));
  function rotAxis(v, k, a) {
    const c = Math.cos(a), s = Math.sin(a), d = dot(k, v), cr = cross(k, v);
    return [v[0] * c + cr[0] * s + k[0] * d * (1 - c), v[1] * c + cr[1] * s + k[1] * d * (1 - c), v[2] * c + cr[2] * s + k[2] * d * (1 - c)];
  }

  const FINGER_LEN = [[.0368, .0224, .016], [.0416, .0256, .0176], [.0384, .024, .0168], [.0304, .0192, .0136]];
  const THUMB_LEN = [.034, .026, .018];
  const FINGER_RADII = [[.0076, .0070, .0060], [.0082, .0076, .0064], [.0078, .0072, .0060], [.0067, .0061, .0052]];
  const THUMB_RADII = [.0100, .0085, .0070];
  const ROOT = [[.027, .070, 0], [.009, .074, 0], [-.009, .072, 0], [-.027, .066, 0], [.020, .020, -.010]];
  const ARM_LEN = [0.275, 0.255];

  const resultant = (L, q) => [L[0] + L[1] * Math.cos(q) + L[2] * Math.cos(1.67 * q), L[1] * Math.sin(q) + L[2] * Math.sin(1.67 * q)];
  function solveFinger(base, target, L, hint) {
    const v = sub(target, base), dist = Math.hypot(...v);
    const maxD = L[0] + L[1] + L[2] - 1e-6, minD = Math.hypot(...resultant(L, 2.0));
    const reach = clamp(dist, minD, maxD), X = unit(v);
    let Y = sub(hint, mul(X, dot(hint, X)));
    if (Math.hypot(...Y) < 1e-6) Y = cross(X, [0, 1, 0]);
    Y = unit(Y);
    let lo = 0, hi = 2.0;
    for (let i = 0; i < 18; i++) { const q = (lo + hi) / 2; if (Math.hypot(...resultant(L, q)) > reach) lo = q; else hi = q; }
    const q = (lo + hi) / 2, [a, b] = resultant(L, q), ang = Math.atan2(b, a), pts = [base];
    for (let j = 0; j < 3; j++) {
      const th = ang - (j === 0 ? 0 : j === 1 ? q : 1.67 * q);
      pts.push(add(pts[j], add(mul(X, L[j] * Math.cos(th)), mul(Y, L[j] * Math.sin(th)))));
    }
    return { points: pts, lengths: L, error: Math.hypot(...sub(pts[3], target)), target };
  }
  function solveArm(S, W, hint) {
    const [L1, L2] = ARM_LEN, v = sub(W, S), dist = Math.hypot(...v), dir = unit(v);
    const d = clamp(dist, 0.04, L1 + L2 - 1e-5);
    const a = (L1 * L1 - L2 * L2 + d * d) / (2 * d);
    let bend = sub(hint, mul(dir, dot(hint, dir)));
    if (Math.hypot(...bend) < 1e-6) bend = cross(dir, [0, 0, 1]);
    bend = unit(bend);
    const E = add(add(S, mul(dir, a)), mul(bend, Math.sqrt(Math.max(0, L1 * L1 - a * a))));
    return { shoulder: S, elbow: E, wrist: W, lengths: [L1, L2], error: Math.abs(dist - d) };
  }

  const LIPS = [0, 1.525, -0.120];
  function instrumentFrame(kind) {
    if (kind === 'trumpet') {
      // Extends straight forward toward audience (-Z) with slight downward angle (~8 deg)
      const U = unit([0, -0.14, -0.99]);
      const L = [1, 0, 0];
      const N = unit(cross(L, U)); // upward out of pistons
      return { kind, O: LIPS, U, F: L, N, pt: (s, l = 0, n = 0) => add(LIPS, add(mul(U, s), add(mul(L, l), mul(N, n)))) };
    }
    // Clarinet: ~42 deg downward-forward
    const U = unit([0, -0.743, -0.669]);
    const L = [1, 0, 0];
    const N = unit(cross(L, U));
    return { kind, O: LIPS, U, F: L, N, pt: (s, l = 0, n = 0) => add(LIPS, add(mul(U, s), add(mul(L, l), mul(N, n)))) };
  }

  const CLARINET_KEYS = {
    reg: [0.205, 0.000, -0.014],
    th:  [0.228, 0.000, -0.013],
    l1:  [0.232, 0.000,  0.013],
    l2:  [0.264, 0.000,  0.013],
    l3:  [0.296, 0.000,  0.013],
    l4:  [0.326, 0.013,  0.008],
    r1:  [0.390, 0.000,  0.014],
    r2:  [0.422, 0.000,  0.014],
    r3:  [0.454, 0.000,  0.014],
    pk:  [0.484, -0.014, 0.009],
    rth: [0.420, -0.002, -0.015],
  };

  function plan(kind, song) {
    const D = window.BRASS_CLARINET_DATA;
    const notes = song.notes.map((n, i) => ({
      i, t0: n[0], dur: n[1], t1: n[0] + n[1], pitch: n[2], vel: n[3],
      fingering: kind === 'trumpet' ? D.trumpetFingering(n[2]) : D.clarinetFingering(n[2]),
      label: kind === 'trumpet' ? D.trumpetLabel(n[2]) : D.clarinetLabel(n[2]),
    }));
    const dt = 1 / 30, count = Math.ceil((song.duration + 0.5) / dt) + 1;
    const exprTrack = [];
    let a = [0, 0], b = [0, 0];
    for (let k = 0; k < count; k++) {
      const t = k * dt;
      let energy = 0, pitchNorm = 0;
      for (const nt of notes) {
        if (t >= nt.t0 && t <= nt.t1) { energy = Math.max(energy, nt.vel / 127); pitchNorm = clamp((nt.pitch - 64) / 20, -1, 1); break; }
      }
      const target = [energy, pitchNorm];
      for (let j = 0; j < 2; j++) { a[j] += (target[j] - a[j]) * (1 - Math.exp(-dt / 0.25)); b[j] += (a[j] - b[j]) * (1 - Math.exp(-dt / 0.25)); }
      exprTrack.push(b.slice());
    }
    return { kind, song, notes, exprTrack, duration: song.duration };
  }

  function stateAt(P, t) {
    const tc = Number.isFinite(t) ? t : 0;
    const F = instrumentFrame(P.kind);
    const tr = P.exprTrack;
    const x = clamp(tc * 30, 0, Math.max(0, tr.length - 1)), idx = Math.floor(x), jdx = Math.min(idx + 1, tr.length - 1);
    const frac = smooth(x - idx), [energy, pitchNorm] = tr[idx].map((q, k) => q + (tr[jdx][k] - q) * frac);
    const phrase = Math.sin(tc * Math.PI * 2 / 6.4), breath = Math.sin(tc * Math.PI * 2 / 5.2);
    const yaw = phrase * (0.04 + 0.04 * energy), roll = Math.sin(tc * Math.PI * 2 / 10.5) * 0.028;
    const lean = 0.02 + energy * 0.03 - pitchNorm * 0.035;
    const rotate = p => rotAxis(rotAxis(rotAxis(p, [0, 0, 1], roll), [1, 0, 0], -lean), [0, 1, 0], yaw);
    const pivot = [0, 0.98, 0], offset = [phrase * 0.010, breath * 0.004, -energy * 0.008];
    const expression = { frame: { U: rotate([1, 0, 0]), V: rotate([0, 1, 0]), W: rotate([0, 0, 1]), O: sub(add(pivot, offset), rotate(pivot)) }, breath, energy };

    // Active fingering with smooth transition
    let cur = null, nxt = null;
    for (let i = 0; i < P.notes.length; i++) {
      if (P.notes[i].t0 <= tc) cur = P.notes[i];
      else { nxt = P.notes[i]; break; }
    }
    const keys = P.kind === 'trumpet' ? { v1: 0, v2: 0, v3: 0 } : { reg: 0, th: 0, l1: 0, l2: 0, l3: 0, r1: 0, r2: 0, r3: 0, pk: 0 };
    if (cur) Object.assign(keys, cur.fingering);
    if (nxt) {
      const lead = 0.045;
      if (tc >= nxt.t0 - lead && tc < nxt.t0) {
        const u = smooth((tc - (nxt.t0 - lead)) / lead);
        for (const k of Object.keys(keys)) keys[k] = keys[k] + (nxt.fingering[k] - keys[k]) * u;
      }
    }

    let handL, handR;
    if (P.kind === 'trumpet') {
      // Left hand grips valve casing from +L; Right hand fingers 1-3 sit atop pistons 1-3
      const buildH = isRight => {
        const wrist = isRight ? F.pt(0.245, -0.072, 0.018) : F.pt(0.235, 0.074, -0.055);
        const X = mul(F.U, -1);
        const Y = isRight ? unit(add(mul(F.F, 0.80), mul(F.N, 0.60))) : unit(add(mul(F.F, -0.82), mul(F.N, 0.57)));
        let Z = unit(cross(X, Y));
        if (!isRight && dot(cross(X, Y), Z) > 0) Z = mul(Z, -1);
        if (isRight && dot(cross(X, Y), Z) < 0) Z = mul(Z, -1);
        const basis = [X, Y, Z];
        const hpt = p => add(wrist, add(mul(X, p[0]), add(mul(Y, p[1]), mul(Z, p[2]))));
        const targets = isRight
          ? [F.pt(0.215, 0, 0.068 - keys.v1 * 0.014), F.pt(0.242, 0, 0.068 - keys.v2 * 0.014), F.pt(0.269, 0, 0.068 - keys.v3 * 0.014), F.pt(0.296, -0.012, 0.052)]
          : [F.pt(0.215, -0.016, -0.012), F.pt(0.242, -0.016, -0.016), F.pt(0.269, -0.016, -0.016), F.pt(0.292, -0.014, -0.014)];
        const thTgt = isRight ? F.pt(0.205, -0.016, 0.012) : F.pt(0.215, 0.018, 0.010);
        const bend = isRight ? add(F.N, mul(F.F, -0.4)) : add(mul(F.N, -0.7), mul(F.F, -0.7));
        const fingers = targets.map((pt, i) => ({ ...solveFinger(hpt(ROOT[i]), pt, FINGER_LEN[i], bend), radii: FINGER_RADII[i] }));
        const th = solveFinger(hpt(ROOT[4]), thTgt, THUMB_LEN, mul(F.N, -1));
        return { model: 'brass', wrist, palmPos: hpt([0, 0.035, 0]), basis, fingers, thumb: th.points };
      };
      handL = buildH(false); handR = buildH(true);
    } else {
      const K = CLARINET_KEYS;
      const keyPt = (spec, p) => F.pt(spec[0], spec[1], spec[2] + (1 - p) * 0.012 - p * 0.003);
      const buildH = isRight => {
        const wrist = isRight ? F.pt(0.432, -0.082, -0.030) : F.pt(0.268, 0.082, -0.028);
        const X = mul(F.U, -1);
        const Y = unit(add(mul(F.F, isRight ? 0.78 : -0.78), mul(F.N, 0.62)));
        let Z = unit(cross(X, Y));
        if (!isRight && dot(cross(X, Y), Z) > 0) Z = mul(Z, -1);
        if (isRight && dot(cross(X, Y), Z) < 0) Z = mul(Z, -1);
        const basis = [X, Y, Z];
        const hpt = p => add(wrist, add(mul(X, p[0]), add(mul(Y, p[1]), mul(Z, p[2]))));
        const targets = isRight
          ? [keyPt(K.r1, keys.r1), keyPt(K.r2, keys.r2), keyPt(K.r3, keys.r3), keyPt(K.pk, keys.pk)]
          : [keyPt(K.l1, keys.l1), keyPt(K.l2, keys.l2), keyPt(K.l3, keys.l3), keyPt(K.l4, 0)];
        const thTgt = isRight ? F.pt(K.rth[0], K.rth[1], K.rth[2]) : F.pt(K.th[0] - keys.reg * 0.014, K.th[1], K.th[2] - (1 - keys.th) * 0.006);
        const bend = add(F.N, mul(F.F, isRight ? -0.35 : 0.35));
        const fingers = targets.map((pt, i) => ({ ...solveFinger(hpt(ROOT[i]), pt, FINGER_LEN[i], bend), radii: FINGER_RADII[i] }));
        const th = solveFinger(hpt(ROOT[4]), thTgt, THUMB_LEN, add(mul(F.F, isRight ? -0.8 : 0.8), mul(F.N, -0.6)));
        return { model: 'clarinet', wrist, palmPos: hpt([0, 0.035, 0]), basis, fingers, thumb: th.points };
      };
      handL = buildH(false); handR = buildH(true);
    }

    const shL = [0.180, 1.39, -0.015], shR = [-0.180, 1.39, -0.015];
    const armL = solveArm(shL, handL.wrist, [0.55, -1.0, 0.15]);
    const armR = solveArm(shR, handR.wrist, [-0.55, -1.0, 0.15]);
    const head = { pos: [0, 1.592, -0.012], pitch: P.kind === 'trumpet' ? -0.04 : 0.14, yaw: Math.PI, roll: 0 };
    return { kind: P.kind, time: tc, frame: F, keys, expression, head, handL, handR, armL, armR };
  }

  const brass = [.86, .68, .28], brassBright = [.96, .80, .38], silver = [.84, .86, .90], ebony = [.032, .034, .042],
    skin = [.74, .55, .43], skinLight = [.80, .62, .50], suit = [.048, .050, .062], shirt = [.86, .85, .82], hairC = [.07, .055, .048], lash = [.20, .12, .10];

  const handSkins = new WeakMap();
  function drawHands(R, S) {
    let pair = handSkins.get(R);
    if (!pair) {
      pair = [window.ViolinFingerSkin.create(false, true, true, true), window.ViolinFingerSkin.create(false, true, false, true)];
      pair[0].thumb.radii = THUMB_RADII; pair[0].thumb.skinBaseT = 0.65;
      pair[1].thumb.radii = THUMB_RADII; pair[1].thumb.skinBaseT = 0.65;
      handSkins.set(R, pair);
    }
    R.dynamicMesh(S.kind + '-hand-0', window.ViolinFingerSkin.update(pair[0], S.handL), skin);
    R.dynamicMesh(S.kind + '-hand-1', window.ViolinFingerSkin.update(pair[1], S.handR), skin);
  }

  function drawTrumpet(R, S) {
    const F = S.frame, k = S.keys;
    // Mouthpiece + leadpipe + main tubing loop
    R.segment(F.pt(0.00), F.pt(0.055), 0.0085, silver, 'limb');
    R.segment(F.pt(0.055), F.pt(0.365), 0.0068, brass, 'limb');
    // Lower tuning slide loop
    R.segment(F.pt(0.115, 0, -0.058), F.pt(0.365, 0, -0.058), 0.0068, brass, 'limb');
    R.segment(F.pt(0.365, 0, 0), F.pt(0.365, 0, -0.058), 0.0068, brass, 'limb');
    R.segment(F.pt(0.115, 0, -0.058), F.pt(0.115, 0, 0.028), 0.0068, brass, 'limb');
    // Upper bell pipe & flared brass bell!
    R.segment(F.pt(0.115, 0, 0.028), F.pt(0.415, 0, 0.028), 0.0095, brass, 'limb');
    R.segment(F.pt(0.415, 0, 0.028), F.pt(0.495, 0, 0.028), 0.024, brassBright, 'limb');
    R.oriented('sphere', F.pt(0.502, 0, 0.028), [0.012, 0.058, 0.058], brassBright, 0.92, F.U, F.N, F.F);
    R.oriented('sphere', F.pt(0.506, 0, 0.028), [0.004, 0.048, 0.048], [.22, .16, .06], 0.3, F.U, F.N, F.F);
    // 3 valve casings + animated pistons & pearl buttons
    const vx = [0.215, 0.242, 0.269], vp = [k.v1, k.v2, k.v3];
    for (let i = 0; i < 3; i++) {
      R.segment(F.pt(vx[i], 0, -0.048), F.pt(vx[i], 0, 0.046), 0.0105, brass, 'limb');
      const top = 0.068 - vp[i] * 0.014;
      R.segment(F.pt(vx[i], 0, 0.044), F.pt(vx[i], 0, top), 0.0042, silver, 'limb');
      R.oriented('sphere', F.pt(vx[i], 0, top + 0.002), [0.0085, 0.0025, 0.0085], vp[i] > 0.5 ? [.98, .86, .52] : [.95, .93, .88], 0.85, F.U, F.N, F.F);
    }
  }

  function drawClarinet(R, S) {
    const F = S.frame, K = CLARINET_KEYS, k = S.keys;
    // Mouthpiece + ligature + barrel + upper/lower grenadilla joints + flared bell
    R.segment(F.pt(0.00), F.pt(0.075), 0.0105, ebony, 'limb');
    R.oriented('sphere', F.pt(0.055), [0.008, 0.0125, 0.0125], silver, 0.9, F.U, F.N, F.F);
    R.segment(F.pt(0.075), F.pt(0.575), 0.0125, ebony, 'limb');
    R.segment(F.pt(0.575), F.pt(0.665), 0.024, ebony, 'limb');
    for (const [s, r] of [[0.080, 0.014], [0.145, 0.0145], [0.355, 0.0145], [0.575, 0.0165], [0.664, 0.032]]) {
      R.oriented('sphere', F.pt(s), [0.004, r, r], silver, 0.9, F.U, F.N, F.F);
    }
    R.bone(F.pt(0.18, 0.014, 0.005), F.pt(0.52, 0.015, 0.005), 0.0018, silver);
    R.bone(F.pt(0.18, -0.014, 0.005), F.pt(0.52, -0.015, 0.005), 0.0018, silver);
    for (const [name, spec] of Object.entries(K)) {
      if (name === 'rth') continue;
      const press = k[name] || 0;
      const pos = F.pt(spec[0], spec[1], spec[2] - press * 0.003);
      R.oriented('sphere', pos, [0.0072, 0.0022, 0.0072], press > 0.5 ? [.96, .84, .52] : silver, 0.85, F.U, F.N, F.F);
    }
  }

  function drawUpperBody(R, S, opts) {
    const female = opts?.female !== undefined ? !!opts.female : (S.kind === 'clarinet');
    const gown = opts?.gown || [.048, .072, .085];
    const attire = female ? gown : suit;
    const hairCol = female ? [.115, .068, .046] : hairC;
    const pearl = [.94, .90, .82];
    const br = 1 + S.expression.breath * 0.012;
    R.piece('torso', [0, 0.95, 0.010], [female ? .154 : .166, .105, .114], attire);
    R.piece('jacket', [0, 1.18, 0.012], [(female ? .174 : .196) * br, .258, (female ? .122 : .134) * br], attire, -0.02, 0, 0);
    const H = S.head, neckBase = [0, 1.430, -0.006], neckTop = [H.pos[0], H.pos[1] - 0.045, H.pos[2]];
    if (female) R.segment(neckBase, neckTop, 0.034, skin);
    else { R.segment(neckBase, add(neckBase, mul(sub(neckTop, neckBase), 0.30)), 0.042, shirt); R.segment(neckBase, neckTop, 0.037, skin); }
    const HS = female ? [.074, .105, .088] : [.078, .110, .092], FS = [HS[0] / .112, HS[1] / .148, HS[2] / .128];
    const sc = p => [p[0] * FS[0], p[1] * FS[1], p[2] * FS[2]];
    const hp = p => {
      const q = sc(p), c = Math.cos(H.pitch), s = Math.sin(H.pitch), cy = Math.cos(H.yaw), sy = Math.sin(H.yaw);
      const y = q[1] * c - q[2] * s, z = q[1] * s + q[2] * c;
      return [H.pos[0] + q[0] * cy + z * sy, H.pos[1] + y, H.pos[2] + z * cy - q[0] * sy];
    };
    R.setFaceDetail?.(true);
    R.piece('head', H.pos, HS, skinLight, H.pitch, H.yaw, H.roll);
    R.piece('hair', hp([0, 0.004, 0]), sc([.120, .150, .135]), hairCol, H.pitch, H.yaw, H.roll);
    if (female) {
      R.ball(hp([0, -0.022, -0.135]), sc([.054, .052, .048]), hairCol);
      for (const x of [-1, 1]) {
        R.segment(hp([x * 0.098, 0.025, -0.020]), hp([x * 0.096, -0.135, -0.025]), 0.020, hairCol);
        R.ball(hp([x * 0.112, -0.036, -0.005]), [.0055, .0055, .0055], pearl, 0.7);
      }
    }
    R.piece('nose', hp([0, -0.012, 0.122]), sc([.015, .032, .019]), skinLight, H.pitch, H.yaw, H.roll);
    for (const x of [-1, 1]) {
      const ex = x * 0.04;
      R.segment(hp([ex - 0.017, 0.010, 0.113]), hp([ex, 0.005, 0.120]), 0.0018, lash);
      R.segment(hp([ex, 0.005, 0.120]), hp([ex + 0.017, 0.009, 0.114]), 0.0018, lash);
      R.segment(hp([ex - 0.020, 0.042, 0.118]), hp([ex + 0.018, 0.045, 0.118]), 0.0022, hairCol);
    }
    R.segment(hp([-0.018, -0.074, 0.113]), hp([0.018, -0.074, 0.113]), 0.0032, female ? [.74, .34, .36] : [.62, .38, .33]);
    R.setFaceDetail?.(false);
    window.BowHand.drawArm(R, S.armL, S.handL, { suit: attire, skin, shirt: female ? attire : shirt });
    window.BowHand.drawArm(R, S.armR, S.handR, { suit: attire, skin, shirt: female ? attire : shirt });
    drawHands(R, S);
    if (S.kind === 'trumpet') drawTrumpet(R, S); else drawClarinet(R, S);
  }

  function draw(R, S, opts) {
    const female = opts?.female !== undefined ? !!opts.female : (S.kind === 'clarinet');
    const gown = opts?.gown || [.048, .072, .085];
    if (female) {
      R.piece('torso', [0, 0.52, 0.006], [.225, .44, .185], gown);
      R.piece('torso', [0, 0.16, 0.004], [.275, .14, .225], gown);
      for (const s of [-1, 1]) R.piece('shoe', [s * 0.095, 0.032, -0.068], [.046, .032, .126], ebony, 0, Math.PI, 0);
    } else {
      for (const s of [-1, 1]) {
        const hip = [s * 0.092, 0.96, 0], knee = [s * 0.100, 0.51, -0.012], ankle = [s * 0.105, 0.072, 0.008];
        R.segment(hip, knee, 0.064, suit); R.segment(knee, ankle, 0.046, suit);
        R.piece('joint', knee, [.052, .052, .052], suit);
        R.piece('shoe', [s * 0.105, 0.036, -0.070], [.054, .038, .136], ebony, 0, Math.PI, 0);
      }
    }
    if (S.expression && R.withTransform) return R.withTransform(S.expression.frame, () => drawUpperBody(R, S, opts));
    return drawUpperBody(R, S, opts);
  }

  return { plan, stateAt, draw };
})();

'use strict';
/* 3D geometry, motion planning, Boehm flute / Conservatoire oboe keywork,
 * articulated 5-digit closed-skin hands, and expressive standing performer
 * for Concert Flute and Oboe.
 *
 * Coordinate conventions match the host renderer (RecitalGL mirrors X):
 * planning +X = anatomical LEFT, planning -X = anatomical RIGHT, -Z = audience. */
window.WoodwindEngine = (() => {
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

  // Compact realistic adult hand bones + sleeker female/male finger radii.
  const FINGER_LEN = [[.0368, .0224, .016], [.0416, .0256, .0176], [.0384, .024, .0168], [.0304, .0192, .0136]];
  const THUMB_LEN = [.034, .026, .018];
  const FINGER_RADII = [[.0070, .0064, .0055], [.0075, .0070, .0059], [.0072, .0066, .0055], [.0062, .0056, .0048]];
  const FINGER_RADII_F = [[.0065, .0060, .0051], [.0070, .0065, .0055], [.0067, .0062, .0051], [.0058, .0052, .0045]];
  const THUMB_RADII = [.0092, .0078, .0064];
  const THUMB_RADII_F = [.0086, .0073, .0060];
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

  // ---- Instrument frames anchored at the performer's lips ----
  const LIPS = [0, 1.525, -0.120];
  function instrumentFrame(kind) {
    if (kind === 'flute') {
      // Extends horizontally to player's anatomical right (planning -X), slight natural droop.
      const U = unit([-0.986, -0.115, -0.118]);
      const F = unit(cross([0, 1, 0], U)); // toward audience (-Z)
      const N = unit(cross(U, F));         // upward out of keys (+Y)
      const pt = (s, f = 0, n = 0) => add(LIPS, add(mul(U, s), add(mul(F, f), mul(N, n))));
      return { kind, O: LIPS, U, F, N, pt };
    }
    // Oboe: extends downward & forward (~38 deg from vertical).
    const U = unit([0, -0.788, -0.616]);
    const L = [1, 0, 0];                   // anatomical left (+X)
    const N = unit(cross(L, U));           // front normal out of keywork
    const pt = (s, l = 0, n = 0) => add(LIPS, add(mul(U, s), add(mul(L, l), mul(N, n))));
    return { kind, O: LIPS, U, F: L, N, pt };
  }

  // Key cup positions in instrument-local (s along bore, lateral, normal).
  const FLUTE_KEYS = {
    th: [0.200, -0.011, -0.005],
    l1: [0.195, 0.000, 0.013],
    l2: [0.228, 0.000, 0.013],
    l3: [0.258, 0.000, 0.013],
    l4: [0.285, 0.014, 0.009],
    r1: [0.345, 0.000, 0.013],
    r2: [0.375, 0.000, 0.013],
    r3: [0.405, 0.000, 0.013],
    r4eb: [0.435, 0.008, 0.011],
    r4cs: [0.452, 0.009, 0.010],
    r4c:  [0.464, 0.009, 0.010],
    rth: [0.365, 0.002, -0.012],
  };
  const OBOE_KEYS = {
    oct1: [0.205, 0.000, -0.012],
    oct2: [0.202, 0.012, 0.004],
    l1: [0.215, 0.000, 0.012],
    l2: [0.245, 0.000, 0.012],
    l3: [0.275, 0.000, 0.012],
    l4: [0.305, 0.013, 0.008],
    r1: [0.365, 0.000, 0.013],
    r2: [0.395, 0.000, 0.013],
    r3: [0.425, 0.000, 0.013],
    r4eb: [0.455, -0.013, 0.009],
    r4c:  [0.468, -0.013, 0.009],
    r4cs: [0.478, -0.013, 0.009],
    rth: [0.395, -0.002, -0.014],
  };

  function keyVector(kind, fingering) {
    if (!fingering) return { th: 0, l1: 0, l2: 0, l3: 0, l4: 0, r1: 0, r2: 0, r3: 0, r4eb: 0, r4c: 0, r4cs: 0, oct1: 0, oct2: 0, halfHole: 0 };
    if (kind === 'flute') {
      return {
        th: fingering.th ? 1 : 0, l1: fingering.l1 ? 1 : 0, l2: fingering.l2 ? 1 : 0, l3: fingering.l3 ? 1 : 0, l4: fingering.l4 ? 1 : 0,
        r1: fingering.r1 ? 1 : 0, r2: fingering.r2 ? 1 : 0, r3: fingering.r3 ? 1 : 0,
        r4eb: fingering.r4 === 'eb' ? 1 : 0, r4c: fingering.r4 === 'c' ? 1 : 0, r4cs: fingering.r4 === 'cs' ? 1 : 0,
        oct1: 0, oct2: 0, halfHole: 0,
      };
    }
    return {
      th: fingering.oct === 1 ? 1 : 0,
      oct1: fingering.oct === 1 ? 1 : 0, oct2: fingering.oct === 2 ? 1 : 0,
      l1: fingering.l1 > 0 ? 1 : 0, halfHole: fingering.l1 === 0.5 ? 1 : 0,
      l2: fingering.l2 ? 1 : 0, l3: fingering.l3 ? 1 : 0, l4: fingering.l4 ? 1 : 0,
      r1: fingering.r1 ? 1 : 0, r2: fingering.r2 ? 1 : 0, r3: fingering.r3 ? 1 : 0,
      r4eb: fingering.r4 === 'eb' ? 1 : 0, r4c: fingering.r4 === 'c' ? 1 : 0, r4cs: fingering.r4 === 'cs' ? 1 : 0,
    };
  }

  function plan(kind, song) {
    const notes = song.notes.map((n, i) => ({
      i, t0: n[0], t1: n[0] + n[1], dur: n[1], pitch: n[2], vel: n[3] || 80,
      fingering: window.WoodwindFingering.lookup(kind, n[2]),
      label: window.WoodwindFingering.label(kind, n[2]),
    }));
    // Precompute 30 Hz two-pole low-pass phrasing track (deterministic seeking).
    const dt = 1 / 30, count = Math.ceil(song.duration / dt) + 1;
    let a = [0.2, 0, 0], b = a.slice(), hi = 0;
    const exprTrack = [];
    for (let i = 0; i < count; i++) {
      const time = i * dt;
      while (hi < notes.length && notes[hi].t0 <= time + 0.04) hi++;
      let energy = 0, accent = 0, pitch = 0;
      for (let j = hi - 1; j >= 0 && notes[j].t0 >= time - 1.5; j--) {
        const nt = notes[j];
        if (time >= nt.t0 && time <= nt.t1 + 0.08) {
          const v = nt.vel / 127;
          energy = Math.max(energy, v);
          pitch = clamp((nt.pitch - 72) / 14, -1, 1);
          const age = Math.max(0, time - nt.t0);
          accent = Math.max(accent, v * v * Math.exp(-age / 0.14));
        }
      }
      const tgt = [energy, accent, pitch];
      const taus = [0.26, 0.12, 0.30];
      for (let k = 0; k < 3; k++) {
        const al = 1 - Math.exp(-dt / taus[k]);
        a[k] += (tgt[k] - a[k]) * al;
        b[k] += (a[k] - b[k]) * al;
      }
      exprTrack.push(b.slice());
    }
    return { kind, song, notes, exprTrack, duration: song.duration };
  }

  function lowerBound(arr, t) {
    let lo = 0, hi = arr.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m].t0 < t) lo = m + 1; else hi = m; }
    return lo;
  }

  function expressionAt(P, t) {
    const tr = P.exprTrack;
    const tc = Number.isFinite(t) ? t : 0;
    const x = clamp(tc * 30, 0, Math.max(0, tr.length - 1)), i = Math.floor(x), j = Math.min(i + 1, tr.length - 1);
    const f = smooth(x - i), [energy, accent, pitch] = tr[i].map((q, k) => q + (tr[j][k] - q) * f);
    const phrase = Math.sin(t * Math.PI * 2 / 6.6), answer = Math.sin(t * Math.PI * 2 / 11.2 + 0.7), breath = Math.sin(t * Math.PI * 2 / 5.4);
    const yaw = phrase * (0.045 + 0.045 * energy) + answer * 0.025;
    const roll = answer * (0.032 + 0.030 * energy) + pitch * 0.025;
    const lean = 0.02 + energy * 0.035 + accent * 0.020 - pitch * 0.035 + phrase * 0.018;
    const rotate = p => rotAxis(rotAxis(rotAxis(p, [0, 0, 1], roll), [1, 0, 0], -lean), [0, 1, 0], yaw);
    const pivot = [0, 0.98, 0], offset = [phrase * (0.008 + 0.010 * energy), breath * 0.004 + pitch * 0.005, -energy * 0.008];
    const frame = { U: rotate([1, 0, 0]), V: rotate([0, 1, 0]), W: rotate([0, 0, 1]), O: sub(add(pivot, offset), rotate(pivot)) };
    return { frame, yaw, lean, roll, breath, energy, accent, pitch };
  }

  function keysAt(P, t) {
    const idx = lowerBound(P.notes, t + 1e-6) - 1;
    const cur = idx >= 0 ? P.notes[idx] : null;
    const nxt = idx + 1 < P.notes.length ? P.notes[idx + 1] : null;
    const sounding = cur && t >= cur.t0 && t <= cur.t1 ? cur : null;
    const base = keyVector(P.kind, (sounding || cur || nxt)?.fingering);
    // Smooth finger transitions over ~55 ms (or compressed for rapid 16th-note runs).
    let out = { ...base };
    if (nxt) {
      const gap = cur ? Math.max(0.01, nxt.t0 - cur.t0) : 0.25;
      const lead = Math.min(0.055, gap * 0.35);
      if (t >= nxt.t0 - lead && t < nxt.t0) {
        const u = smooth((t - (nxt.t0 - lead)) / Math.max(1e-4, lead));
        const dst = keyVector(P.kind, nxt.fingering);
        for (const k of Object.keys(out)) out[k] = out[k] + (dst[k] - out[k]) * u;
      }
    }
    return { keys: out, sounding, activeNote: sounding };
  }

  function buildHand(F, isRight, keys) {
    const kind = F.kind;
    let wrist, X, Y, Z;
    if (kind === 'flute') {
      if (!isRight) {
        // Left hand: wrist below/player-side of tube, palm facing tube & audience, fingers arching over keys l1..l4.
        wrist = F.pt(0.235, -0.082, -0.044);
        X = mul(F.U, -1); // radial (+X) toward headjoint (index = l1)
        Y = unit(add(mul(F.N, 0.68), mul(F.F, 0.73)));
        Z = unit(cross(X, Y));
        // Left hand mirrored parity: ensure det = -1 so HandSurface mirrors cleanly
        if (dot(cross(X, Y), Z) > 0) Z = mul(Z, -1);
      } else {
        // Right hand: wrist on audience-side & below tube, fingers arching back onto r1..r4.
        wrist = F.pt(0.392, 0.082, -0.046);
        X = mul(F.U, -1); // radial (+X) toward headjoint (index = r1)
        Y = unit(add(mul(F.N, 0.68), mul(F.F, -0.73)));
        Z = unit(cross(X, Y));
        if (dot(cross(X, Y), Z) < 0) Z = mul(Z, -1);
      }
    } else {
      // Oboe: left hand approaches from +L (anatomical left), right hand from -L (anatomical right).
      if (!isRight) {
        wrist = F.pt(0.254, 0.082, -0.028);
        X = mul(F.U, -1); // radial (+X) up toward reed (index = l1)
        Y = unit(add(mul(F.F, -0.78), mul(F.N, 0.62)));
        Z = unit(cross(X, Y));
        if (dot(cross(X, Y), Z) > 0) Z = mul(Z, -1);
      } else {
        wrist = F.pt(0.406, -0.082, -0.030);
        X = mul(F.U, -1); // radial (+X) up toward reed (index = r1)
        Y = unit(add(mul(F.F, 0.78), mul(F.N, 0.62)));
        Z = unit(cross(X, Y));
        if (dot(cross(X, Y), Z) < 0) Z = mul(Z, -1);
      }
    }
    const basis = [X, Y, Z];
    const hpt = p => add(wrist, add(mul(X, p[0]), add(mul(Y, p[1]), mul(Z, p[2]))));
    const palmPos = hpt([0, 0.035, 0]);
    const K = kind === 'flute' ? FLUTE_KEYS : OBOE_KEYS;
    const liftN = 0.013, pressDepth = 0.0032;

    const keyPt = (spec, press, extraU = 0) => F.pt(spec[0] + extraU, spec[1], spec[2] + (1 - press) * liftN - press * pressDepth);
    let fingerTargets, thumbTarget, bendHint, thumbHint;
    if (kind === 'flute') {
      if (!isRight) {
        fingerTargets = [
          { pt: keyPt(K.l1, keys.l1), p: keys.l1 },
          { pt: keyPt(K.l2, keys.l2), p: keys.l2 },
          { pt: keyPt(K.l3, keys.l3), p: keys.l3 },
          { pt: keyPt(K.l4, keys.l4), p: keys.l4 },
        ];
        thumbTarget = F.pt(K.th[0], K.th[1] - (1 - keys.th) * 0.008, K.th[2] - (1 - keys.th) * 0.004);
        bendHint = add(mul(F.N, 1.0), mul(F.F, -0.4));
        thumbHint = add(mul(F.F, -1), mul(F.N, -0.5));
      } else {
        const r4spec = keys.r4c > 0.5 ? K.r4c : keys.r4cs > 0.5 ? K.r4cs : K.r4eb;
        const r4p = Math.max(keys.r4eb, keys.r4c, keys.r4cs);
        fingerTargets = [
          { pt: keyPt(K.r1, keys.r1), p: keys.r1 },
          { pt: keyPt(K.r2, keys.r2), p: keys.r2 },
          { pt: keyPt(K.r3, keys.r3), p: keys.r3 },
          { pt: keyPt(r4spec, r4p), p: r4p },
        ];
        thumbTarget = F.pt(K.rth[0], K.rth[1], K.rth[2]);
        bendHint = add(mul(F.N, 1.0), mul(F.F, 0.4));
        thumbHint = add(mul(F.F, 0.7), mul(F.N, -0.7));
      }
    } else {
      if (!isRight) {
        // Half-hole: roll LH1 downward (+0.0055 along U) to uncover top vent.
        const l1Shift = keys.halfHole * 0.0055 - keys.oct2 * 0.006;
        fingerTargets = [
          { pt: keyPt(K.l1, keys.l1, l1Shift), p: keys.l1 },
          { pt: keyPt(K.l2, keys.l2), p: keys.l2 },
          { pt: keyPt(K.l3, keys.l3), p: keys.l3 },
          { pt: keyPt(K.l4, keys.l4), p: keys.l4 },
        ];
        thumbTarget = F.pt(K.oct1[0], K.oct1[1] + (1 - keys.oct1) * 0.004, K.oct1[2] - (1 - keys.oct1) * 0.006);
        bendHint = add(mul(F.N, 1.0), mul(F.F, 0.35));
        thumbHint = add(mul(F.F, 0.8), mul(F.N, -0.6));
      } else {
        const r4spec = keys.r4c > 0.5 ? K.r4c : keys.r4cs > 0.5 ? K.r4cs : K.r4eb;
        const r4p = Math.max(keys.r4eb, keys.r4c, keys.r4cs);
        fingerTargets = [
          { pt: keyPt(K.r1, keys.r1), p: keys.r1 },
          { pt: keyPt(K.r2, keys.r2), p: keys.r2 },
          { pt: keyPt(K.r3, keys.r3), p: keys.r3 },
          { pt: keyPt(r4spec, r4p), p: r4p },
        ];
        thumbTarget = F.pt(K.rth[0], K.rth[1], K.rth[2]);
        bendHint = add(mul(F.N, 1.0), mul(F.F, -0.35));
        thumbHint = add(mul(F.F, -0.8), mul(F.N, -0.6));
      }
    }

    const fr = kind === 'flute' ? FINGER_RADII_F : FINGER_RADII;
    const fingers = fingerTargets.map((t, i) => {
      const f = solveFinger(hpt(ROOT[i]), t.pt, FINGER_LEN[i], bendHint);
      return { ...f, radii: fr[i], press: t.p, contact: t.p > 0.5 };
    });
    const th = solveFinger(hpt(ROOT[4]), thumbTarget, THUMB_LEN, thumbHint);
    return { model: 'woodwind', wrist, palmPos, basis, fingers, thumb: th.points, thumbInfo: th };
  }

  function stateAt(P, t) {
    const F = instrumentFrame(P.kind);
    const expr = expressionAt(P, t);
    const { keys, sounding, activeNote } = keysAt(P, t);
    const handL = buildHand(F, false, keys);
    const handR = buildHand(F, true, keys);

    // Shoulders (anatomical left = +X, anatomical right = -X)
    const shL = [0.180, 1.39, -0.015], shR = [-0.180, 1.39, -0.015];
    const hintL = P.kind === 'flute' ? [0.35, -1.0, -0.15] : [0.55, -1.0, 0.10];
    const hintR = P.kind === 'flute' ? [-0.95, -0.65, 0.20] : [-0.55, -1.0, 0.10];
    const armL = solveArm(shL, handL.wrist, hintL);
    const armR = solveArm(shR, handR.wrist, hintR);

    // Head pose (balanced adult head, embouchure aligned to lips)
    const head = P.kind === 'flute'
      ? { pos: [0.008, 1.595, -0.020], pitch: 0.08 + expr.accent * 0.04, yaw: Math.PI + 0.16, roll: -0.09 + expr.roll * 0.35 }
      : { pos: [0.000, 1.595, -0.020], pitch: 0.16 + expr.accent * 0.05 - expr.pitch * 0.04, yaw: Math.PI, roll: expr.roll * 0.35 };

    return {
      kind: P.kind, time: t, frame: F, expression: expr, keys,
      sounding: sounding ? [sounding] : [],
      activeNotes: activeNote ? [activeNote.pitch] : [],
      handL, handR, armL, armR, head,
    };
  }

  // ---- Drawing ----
  const silver = [.86, .88, .92], silverBright = [.93, .94, .97], ebony = [.038, .038, .045],
    cane = [.78, .64, .38], cork = [.52, .36, .20],
    skin = [.74, .55, .43], skinLight = [.80, .62, .50], suit = [.048, .050, .062],
    shirt = [.86, .85, .82], hairC = [.07, .055, .048], lash = [.20, .12, .10];

  function drawFlute(R, S) {
    const F = S.frame, K = FLUTE_KEYS, k = S.keys;
    // Main silver tube: crown -> headjoint -> body -> footjoint
    R.segment(F.pt(-0.155), F.pt(0.515), 0.0095, silver, 'limb');
    R.ball(F.pt(-0.160), [0.010, 0.010, 0.010], silverBright, 0.9);
    // Embouchure lip plate & tone hole
    R.oriented('box', F.pt(0, 0, 0.010), [0.032, 0.004, 0.018], silverBright, 0.9, F.U, F.N, F.F);
    R.oriented('sphere', F.pt(0, 0, 0.0122), [0.006, 0.001, 0.0045], [0.02, 0.02, 0.025], 0, F.U, F.N, F.F);
    // Key rod along audience side
    R.bone(F.pt(0.165, 0.011, 0.006), F.pt(0.475, 0.011, 0.006), 0.0018, silverBright);
    // Animated key cups
    for (const [name, spec] of Object.entries(K)) {
      if (name === 'rth') continue;
      const press = k[name] || 0;
      const pos = F.pt(spec[0], spec[1], spec[2] - press * 0.0032);
      const rad = name.startsWith('r4') || name === 'l4' ? 0.0062 : 0.0085;
      R.oriented('sphere', pos, [rad, 0.0025, rad], press > 0.5 ? [.96, .84, .52] : silverBright, 0.85, F.U, F.N, F.F);
    }
  }

  function drawOboe(R, S) {
    const F = S.frame, K = OBOE_KEYS, k = S.keys;
    // Double reed + metal staple + cork
    R.segment(F.pt(0.000), F.pt(0.045), 0.0032, cane, 'limb');
    R.segment(F.pt(0.045), F.pt(0.072), 0.0038, cork, 'limb');
    // Conical grenadilla wood bore (upper joint, lower joint, bell)
    R.segment(F.pt(0.072), F.pt(0.285), 0.0095, ebony, 'limb');
    R.segment(F.pt(0.285), F.pt(0.515), 0.0125, ebony, 'limb');
    R.segment(F.pt(0.515), F.pt(0.615), 0.0175, ebony, 'limb');
    // Silver joint rings + bell ring
    for (const [s, r] of [[0.074, 0.0085], [0.285, 0.0115], [0.515, 0.0145], [0.614, 0.0205]]) {
      R.oriented('sphere', F.pt(s), [0.004, r, r], silverBright, 0.9, F.U, F.N, F.F);
    }
    // Silver side key rods
    R.bone(F.pt(0.165, 0.012, 0.004), F.pt(0.495, 0.014, 0.004), 0.0016, silverBright);
    R.bone(F.pt(0.165, -0.012, 0.004), F.pt(0.495, -0.014, 0.004), 0.0016, silverBright);
    // Animated key cups
    for (const [name, spec] of Object.entries(K)) {
      if (name === 'rth') continue;
      const press = k[name] || 0;
      const pos = F.pt(spec[0], spec[1], spec[2] - press * 0.0030);
      const rad = name.startsWith('r4') || name === 'l4' || name.startsWith('oct') ? 0.0055 : 0.0075;
      const col = (name === 'l1' && k.halfHole > 0.5) ? [.98, .75, .42] : press > 0.5 ? [.96, .84, .52] : silverBright;
      R.oriented('sphere', pos, [rad, 0.0022, rad], col, 0.85, F.U, F.N, F.F);
    }
  }

  const handSkins = new WeakMap();
  function drawHands(R, S, female) {
    let pair = handSkins.get(R);
    if (!pair) {
      pair = [
        window.ViolinFingerSkin.create(false, true, true, true),
        window.ViolinFingerSkin.create(false, true, false, true),
      ];
      pair[0].thumb.skinBaseT = 0.65;
      pair[1].thumb.skinBaseT = 0.65;
      handSkins.set(R, pair);
    }
    const tr = female ? THUMB_RADII_F : THUMB_RADII;
    pair[0].thumb.radii = tr; pair[1].thumb.radii = tr;
    R.dynamicMesh(S.kind + '-hand-0', window.ViolinFingerSkin.update(pair[0], S.handL), skin);
    R.dynamicMesh(S.kind + '-hand-1', window.ViolinFingerSkin.update(pair[1], S.handR), skin);
  }

  function drawUpperBody(R, S, opts) {
    const female = opts?.female !== undefined ? !!opts.female : (S.kind === 'flute');
    const gown = opts?.gown || (S.kind === 'flute' ? [.052, .058, .105] : [.115, .042, .058]);
    const attire = female ? gown : suit;
    const hairCol = female ? [.115, .068, .046] : hairC;
    const lipCol = female ? [.74, .34, .36] : [.62, .38, .33];
    const pearl = [.94, .90, .82];
    const br = 1 + S.expression.breath * 0.012;
    R.piece('torso', [0, 0.95, 0.010], [female ? .146 : .164, .102, female ? .106 : .114], attire);
    R.piece('jacket', [0, 1.18, 0.012], [(female ? .166 : .194) * br, .254, (female ? .114 : .132) * br], attire, -0.02, 0, 0);
    // Clavicle-to-shoulder bridge so shoulders connect smoothly to the bodice/jacket
    R.segment([0.082, 1.385, 0.002], S.armL.shoulder, female ? 0.040 : 0.046, attire);
    R.segment([-0.082, 1.385, 0.002], S.armR.shoulder, female ? 0.040 : 0.046, attire);
    // Neck + white dress-shirt collar (or pearl necklace for female concert gown)
    const H = S.head;
    const neckBase = [0, 1.430, -0.006], neckTop = [H.pos[0], H.pos[1] - 0.045, H.pos[2]];
    if (female) {
      R.segment(neckBase, neckTop, 0.030, skin);
      for (let i = -3; i <= 3; i++) {
        const a = i * 0.28;
        R.ball([Math.sin(a) * 0.048, 1.422 - Math.cos(a) * 0.012, -0.046 * Math.cos(a)], [.0048, .0048, .0048], pearl, 0.6);
      }
    } else {
      const collarTop = neckBase.map((v, i) => v + (neckTop[i] - v) * 0.30);
      R.segment(neckBase, collarTop, 0.040, shirt);
      R.segment(neckBase, neckTop, 0.035, skin);
    }
    // Refined adult head & face
    const HS = female ? [.069, .099, .083] : [.076, .107, .090];
    const FS = [HS[0] / .112, HS[1] / .148, HS[2] / .128];
    const sc = p => [p[0] * FS[0], p[1] * FS[1], p[2] * FS[2]];
    const hp = p => {
      const q = sc(p);
      const cr = Math.cos(H.roll), sr = Math.sin(H.roll), px = q[0] * cr - q[1] * sr, py = q[0] * sr + q[1] * cr;
      const c = Math.cos(H.pitch), s = Math.sin(H.pitch), cy = Math.cos(H.yaw), sy = Math.sin(H.yaw);
      const y = py * c - q[2] * s, z = py * s + q[2] * c;
      return [H.pos[0] + px * cy + z * sy, H.pos[1] + y, H.pos[2] + z * cy - px * sy];
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
      R.piece('joint', hp([x * 0.109, -0.008, -0.008]), sc([.012, .03, .022]), skin, H.pitch, H.yaw, H.roll);
    }
    R.segment(hp([-0.018, -0.074, 0.113]), hp([0.018, -0.074, 0.113]), 0.0032, lipCol);
    R.setFaceDetail?.(false);

    // Arms (shared BowHand.drawArm with unified .044 forearm!)
    window.BowHand.drawArm(R, S.armL, S.handL, { suit: attire, skin, shirt: female ? attire : shirt });
    window.BowHand.drawArm(R, S.armR, S.handR, { suit: attire, skin, shirt: female ? attire : shirt });
    drawHands(R, S, female);
    if (S.kind === 'flute') drawFlute(R, S); else drawOboe(R, S);
  }

  function draw(R, S, opts) {
    const female = opts?.female !== undefined ? !!opts.female : (S.kind === 'flute');
    const gown = opts?.gown || (S.kind === 'flute' ? [.052, .058, .105] : [.115, .042, .058]);
    if (female) {
      R.piece('torso', [0, 0.52, 0.006], [.225, .44, .185], gown);
      R.piece('torso', [0, 0.16, 0.004], [.275, .14, .225], gown);
      for (const s of [-1, 1]) R.piece('shoe', [s * 0.095, 0.032, -0.068], [.046, .032, .126], ebony, 0, Math.PI, 0);
    } else {
      for (const s of [-1, 1]) {
        const hip = [s * 0.092, 0.96, 0], knee = [s * 0.100, 0.51, -0.012], ankle = [s * 0.105, 0.072, 0.008];
        R.segment(hip, knee, 0.064, suit);
        R.segment(knee, ankle, 0.046, suit);
        R.piece('joint', knee, [.052, .052, .052], suit);
        R.piece('shoe', [s * 0.105, 0.036, -0.070], [.054, .038, .136], ebony, 0, Math.PI, 0);
      }
    }
    if (S.expression && R.withTransform) return R.withTransform(S.expression.frame, () => drawUpperBody(R, S, opts));
    return drawUpperBody(R, S, opts);
  }

  return { plan, stateAt, draw, instrumentFrame, FLUTE_KEYS, OBOE_KEYS, FINGER_LEN, THUMB_LEN, ARM_LEN };
})();

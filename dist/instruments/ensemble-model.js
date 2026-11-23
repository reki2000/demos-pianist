'use strict';
/* Multi-performer 3D stage renderer for String Quartet (4 players) and
 * All-Star Decet (10 players). Reuses the real Violin, Cello, Guitar,
 * Flute, and Oboe engines via composed seat transforms (R.withTransform)
 * plus a stage Grand Piano & animated Pianist for the decet. */
window.EnsembleEngine = (() => {
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
  const lerp3 = (a, b, u) => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
  const norm3 = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function makeSeat(seat) {
    const c = Math.cos(seat.yaw || 0), s = Math.sin(seat.yaw || 0), sc = seat.scale || 1;
    return {
      U: [c * sc, 0, -s * sc],
      V: [0, sc, 0],
      W: [s * sc, 0, c * sc],
      O: [seat.x || 0, 0, seat.z || 0],
    };
  }

  function composeFrame(A, B) {
    const xformVec = v => [
      A.U[0] * v[0] + A.V[0] * v[1] + A.W[0] * v[2],
      A.U[1] * v[0] + A.V[1] * v[1] + A.W[1] * v[2],
      A.U[2] * v[0] + A.V[2] * v[1] + A.W[2] * v[2],
    ];
    return {
      U: xformVec(B.U),
      V: xformVec(B.V),
      W: xformVec(B.W),
      O: add(A.O, xformVec(B.O)),
    };
  }

  // Proxy renderer that composes any inner withTransform (e.g. upper-body expression)
  // onto the performer's stage seat frame without mutating violin-gl.js.
  // Cached per (R, partId) so WeakMap hand-skin caches hit 100% every frame (0 allocations!).
  const proxyCache = new WeakMap();
  function placedRenderer(R, partId, seatFrame) {
    let byId = proxyCache.get(R);
    if (!byId) { byId = new Map(); proxyCache.set(R, byId); }
    let R2 = byId.get(partId);
    if (!R2) {
      R2 = {
        box: R.box, ball: R.ball, bone: R.bone, piece: R.piece, segment: R.segment,
        oriented: R.oriented, mesh: R.mesh, dynamicMesh: R.dynamicMesh,
        setFaceDetail: R.setFaceDetail,
        withTransform(inner, fn) {
          return R.withTransform(inner ? composeFrame(R2._seat, inner) : R2._seat, fn);
        },
      };
      byId.set(partId, R2);
    }
    R2._seat = seatFrame;
    return R2;
  }

  // ---- Stage Grand Piano + Animated Pianist (for the 10-player Decet) ----
  const ebony = [.032, .034, .042], ivory = [.92, .90, .84], gold = [.76, .60, .28],
    suit = [.048, .050, .062], skin = [.74, .55, .43], skinLight = [.80, .62, .50],
    shirt = [.86, .85, .82], hair = [.07, .055, .048];

  function drawStagePiano(R, activePitches, t, opts) {
    const female = !!opts?.female;
    const attire = female ? (opts?.gown || [.115, .042, .055]) : suit;
    const hairCol = female ? [.115, .068, .046] : hair;
    // Concert grand case & legs (facing -Z toward pianist, lid opening toward +X audience)
    R.box([0, 0.78, -0.58], [1.46, 0.14, 0.42], ebony);         // keybed & front
    R.box([0.10, 0.80, -1.18], [1.22, 0.24, 0.92], ebony);      // main soundboard case
    R.ball([0.12, 0.80, -1.68], [0.56, 0.13, 0.46], ebony);     // curved tail
    // Propped grand lid
    R.piece('box', [0.02, 1.15, -1.12], [1.20, 0.03, 1.25], ebony, 0.02, 0, -0.44);
    R.bone([-0.46, 0.92, -0.98], [-0.46, 1.38, -0.98], 0.010, gold); // lid prop stick
    // Three grand legs + pedal lyre
    for (const [lx, lz] of [[-0.60, -0.52], [0.60, -0.52], [0.12, -1.78]]) {
      R.segment([lx, 0.72, lz], [lx, 0.02, lz], 0.036, ebony);
    }
    R.segment([0, 0.70, -0.68], [0, 0.08, -0.68], 0.022, ebony);
    for (const px of [-0.07, 0, 0.07]) R.box([px, 0.09, -0.60], [0.028, 0.015, 0.11], gold, 0.85);
    // Keyboard bed (88-key span ~1.22 m)
    R.box([0, 0.735, -0.34], [1.24, 0.022, 0.16], ivory);
    for (let k = 0; k < 36; k++) {
      const kx = -0.56 + k * 0.032;
      if ([2, 6].includes(k % 7)) continue;
      R.box([kx, 0.752, -0.37], [0.014, 0.014, 0.095], ebony);
    }
    // Highlight sounding keys in gold
    let lhX = 0.20, rhX = -0.18;
    const lh = [], rh = [];
    for (const p of activePitches) {
      const kx = clamp(((60 - p) / 44) * 0.56, -0.58, 0.58); // planning +X = bass (left)
      R.box([kx, 0.742, -0.30], [0.022, 0.016, 0.11], gold, 0.6);
      if (p < 60) lh.push(kx); else rh.push(kx);
    }
    if (lh.length) lhX = lh.reduce((a, b) => a + b, 0) / lh.length;
    if (rh.length) rhX = rh.reduce((a, b) => a + b, 0) / rh.length;

    // Piano bench + seated pianist (facing -Z toward keyboard)
    R.box([0, 0.48, 0.24], [0.68, 0.05, 0.34], ebony);
    for (const sx of [-0.28, 0.28]) for (const sz of [0.12, 0.36]) R.segment([sx, 0.46, sz], [sx, 0.0, sz], 0.018, ebony);
    const swayX = Math.sin(t * 1.1) * 0.025, nod = 0.24 + Math.sin(t * 1.6) * 0.035;
    for (const s of [-1, 1]) {
      const hip = [s * 0.10, 0.54, 0.20], knee = [s * 0.12, 0.50, -0.18], ankle = [s * 0.11, 0.06, -0.26];
      R.segment(hip, knee, female ? 0.065 : 0.058, attire);
      R.segment(knee, ankle, female ? 0.054 : 0.044, attire);
      R.piece('shoe', [s * 0.11, 0.035, -0.34], [.050, .034, .128], ebony, 0, Math.PI, 0);
    }
    R.piece('torso', [swayX * 0.5, 0.62, 0.20], [female ? .158 : .168, .105, .115], attire);
    R.piece('jacket', [swayX, 0.89, 0.16], [female ? .175 : .196, .255, female ? .122 : .132], attire, 0.12, 0, -swayX * 0.8);
    const headC = [swayX * 1.2, 1.28, 0.08];
    R.segment([swayX, 1.13, 0.13], [headC[0], headC[1] - 0.04, headC[2] + 0.01], female ? 0.034 : 0.038, skin);
    if (!female) R.segment([swayX, 1.13, 0.13], [swayX, 1.16, 0.12], 0.042, shirt);
    R.setFaceDetail?.(true);
    R.piece('head', headC, [.074, .106, .088], skinLight, nod, Math.PI, 0);
    R.piece('hair', add(headC, [0, 0.004, 0]), [.080, .108, .094], hairCol, nod, Math.PI, 0);
    if (female) R.ball(add(headC, [0, -0.02, 0.095]), [.040, .038, .034], hairCol);
    R.setFaceDetail?.(false);
    // Arms + articulated 5-digit hands reaching the active piano keys
    const drawArm = (sh, wr, side) => {
      const el = [(sh[0] + wr[0]) * 0.5 + side * 0.10, 0.85, 0.04];
      R.segment(sh, el, female ? 0.040 : 0.044, attire);
      R.ball(el, [female ? .038 : .042, female ? .038 : .042, female ? .038 : .042], attire);
      R.segment(el, wr, female ? 0.034 : 0.038, attire);
      R.piece('palm', add(wr, [0, -0.006, -0.030]), [.032, .012, .036], skin);
      // 5 articulated fingers arching onto the keys
      for (let f = 0; f < 5; f++) {
        const fx = wr[0] + side * (0.024 - f * 0.012);
        const kn = [fx, wr[1] - 0.004, wr[2] - (f === 0 ? 0.022 : 0.052)];
        const tip = [fx, 0.748, kn[2] - (f === 0 ? 0.028 : 0.036)];
        const mid = [(kn[0] + tip[0]) * 0.5, kn[1] + 0.010, (kn[2] + tip[2]) * 0.5];
        R.segment(kn, mid, 0.0062, skin);
        R.segment(mid, tip, 0.0052, skinLight);
      }
    };
    drawArm([0.18 + swayX, 1.12, 0.12], [lhX, 0.785, -0.22], 1);
    drawArm([-0.18 + swayX, 1.12, 0.12], [rhX, 0.785, -0.22], -1);
  }

  // Concert music stand placed in front of a performer
  function drawStand(R, x, z, yaw) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const px = x - s * 0.72, pz = z - c * 0.72;
    R.segment([px, 0.02, pz], [px, 1.02, pz], 0.010, ebony);
    R.ball([px, 0.02, pz], [0.14, 0.018, 0.14], ebony);
    R.piece('box', [px, 1.04, pz], [0.42, 0.28, 0.014], ebony, -0.42, yaw, 0);
    R.piece('box', [px + s * 0.012, 1.05, pz + c * 0.012], [0.36, 0.23, 0.006], ivory, -0.42, yaw, 0);
  }

  function plan(kind, song) {
    const parts = song.parts.map(pt => {
      let partPlan = null;
      if (pt.kind === 'violin' || pt.kind === 'viola') partPlan = window.ViolinMotion.plan(pt.song);
      else if (pt.kind === 'cello') { window.CelloMotion.plan(pt.song); partPlan = pt.song; }
      else if (pt.kind === 'guitar') partPlan = window.GuitarMotion.plan(pt.song);
      else if (pt.kind === 'flute' || pt.kind === 'oboe') partPlan = window.WoodwindEngine.plan(pt.kind, pt.song);
      else if (pt.kind === 'piano') partPlan = pt.song;
      return { ...pt, plan: partPlan, seatFrame: makeSeat(pt.seat) };
    });
    return { kind, song, parts, duration: song.duration };
  }

  // ---- Natural Left-Hand Atlases (zero-LM reuse of precompiled solo hands!) ----
  // Ensemble songs use the EXACT SAME anatomical ViolinFingerSkin left hands
  // as solo Violin & solo Cello, matched by (string, finger/semitone) at 0 ms!
  let violinAtlas = null, celloAtlas = null, guitarAtlas = null;
  function getGuitarAtlas() {
    if (guitarAtlas) return guitarAtlas;
    guitarAtlas = [];
    if (!window.GUITAR_SONGS || !window.GuitarMotion || !window.GuitarHands) return guitarAtlas;
    const s = window.GUITAR_SONGS[0];
    if (!s) return guitarAtlas;
    const P = window.GuitarMotion.plan(s);
    for (let i = 0; i < 40; i++) {
      const p = window.GuitarMotion.pose(P, (s.duration * 0.85 * i) / 40 + 0.5);
      if (p?.hands?.[0] && p?.hands?.[1]) {
        guitarAtlas.push({ palmX: p.palm[0], hands: p.hands, wristL: p.wristL, elbowL: p.elbowL, wristR: p.wristR, elbowR: p.elbowR });
      }
    }
    return guitarAtlas;
  }
  function lookupGuitarHand(palmX) {
    const atlas = getGuitarAtlas();
    if (!atlas.length) return null;
    let best = atlas[0], bestD = Infinity;
    for (const e of atlas) { const d = Math.abs(e.palmX - palmX); if (d < bestD) { bestD = d; best = e; } }
    return best;
  }
  function getViolinAtlas() {
    if (violinAtlas) return violinAtlas;
    violinAtlas = [];
    if (!window.VIOLIN_SONGS || !window.ViolinMotion) return violinAtlas;
    for (const songId of ['air', 'bach-preludio']) {
      const s = window.VIOLIN_SONGS.find(x => x.id === songId);
      if (!s) continue;
      const P = window.ViolinMotion.plan(s);
      if (!window.ViolinMotion.NH?.available(P)) continue;
      const seen = new Set();
      for (const nt of P.notes) {
        const key = `${nt.string}:${nt.finger}:${Math.round(nt.distMm / 12)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const st = window.ViolinMotion.at(P, nt.t0 + Math.min(0.08, nt.dur * 0.5));
        if (st?.handL?.model === 'natural') {
          violinAtlas.push({ string: nt.string, finger: nt.finger, distMm: nt.distMm, handL: st.handL, armL: st.armL });
        }
        if (violinAtlas.length >= 64) break;
      }
    }
    return violinAtlas;
  }
  function lookupViolinHand(string, finger, distMm) {
    const atlas = getViolinAtlas();
    if (!atlas.length) return null;
    let best = atlas[0], bestScore = Infinity;
    for (const e of atlas) {
      const sc = Math.abs(e.string - string) * 40 + (e.finger === finger ? 0 : 25) + Math.abs(e.distMm - distMm);
      if (sc < bestScore) { bestScore = sc; best = e; }
    }
    return best;
  }
  function getCelloAtlas() {
    if (celloAtlas) return celloAtlas;
    celloAtlas = [];
    if (!window.CELLO_SONGS || !window.CelloMotion) return celloAtlas;
    const s = window.CELLO_SONGS[0];
    if (!s) return celloAtlas;
    if (!s.cello) window.CelloMotion.plan(s);
    const seen = new Set();
    for (let i = 0; i < s.notes.length; i++) {
      const n = s.notes[i], r = s.cello.notes[i];
      const key = `${r.string}:${r.semitone}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const p = window.CelloMotion.poseCached(s, n[0] + Math.min(0.06, n[1] * 0.5));
      if (p?.hand?.model === 'natural') {
        celloAtlas.push({ string: r.string, semitone: r.semitone, fingers: p.fingers, thumb: p.thumb, hand: p.hand, leftArm: p.leftArm });
      }
      if (celloAtlas.length >= 48) break;
    }
    return celloAtlas;
  }
  function lookupCelloHand(string, semitone) {
    const atlas = getCelloAtlas();
    if (!atlas.length) return null;
    let best = atlas[0], bestScore = Infinity;
    for (const e of atlas) {
      const sc = Math.abs(e.string - string) * 12 + Math.abs(e.semitone - semitone) * 3;
      if (sc < bestScore) { bestScore = sc; best = e; }
    }
    return best;
  }

  function stateAt(P, t) {
    const partStates = P.parts.map(pt => {
      let st = null;
      if (pt.kind === 'violin' || pt.kind === 'viola') {
        st = window.ViolinMotion.atLegacy(pt.plan, t);
        const active = st.sounding[0];
        const match = lookupViolinHand(active ? active.string : Math.round(st.bow.string), active ? active.finger : 1, st.debug.handDistMm || 60);
        if (match) { st.handL = match.handL; st.armL = match.armL; }
      } else if (pt.kind === 'cello') {
        const song = pt.song, tr = song.cello?.tracks, M = window.CelloModel, CM = window.CelloMotion;
        const bowF = tr ? 0.5 + (tr.bow(t) - 0.5) * 0.66 : 0.45;
        const sFloat = tr ? tr.string(t) : 1;
        const s0 = clamp(Math.floor(sFloat), 0, 3), s1 = clamp(s0 + 1, 0, 3), sf = sFloat - s0;
        const contact = lerp3(M.bowContact(s0), M.bowContact(s1), sf);
        const dir = norm3(lerp3(M.bowDir(s0), M.bowDir(s1), sf));
        const frog = sub(contact, mul(dir, bowF * M.BOW_LENGTH));
        const tip = add(contact, mul(dir, (1 - bowF) * M.BOW_LENGTH));
        const stickFrog = add(frog, mul(M.n, 0.020)), stickTip = add(tip, mul(M.n, 0.020));
        const wristR = add(stickFrog, add(mul(dir, -0.010), [0, 0.012, 0]));
        const shR = CM.SKELETON.SHOULDER_R;
        const elbowR = CM._ik.solveElbow(shR, wristR, [-0.55, -1, 0.15]);
        let actStr = Math.round(sFloat), actSemi = 2, sounding = [];
        for (let i = 0; i < song.notes.length; i++) {
          const n = song.notes[i];
          if (n[0] <= t && n[0] + n[1] > t) { const r = song.cello.notes[i]; actStr = r.string; actSemi = r.semitone; sounding.push(r.string); break; }
        }
        const nat = lookupCelloHand(actStr, actSemi);
        const sway = { lean: 0.035 + 0.012 * Math.sin(t * 0.45), turn: 0.05 * Math.sin(t * 0.23 + 1.2), breath: 0.006 * Math.sin(t * 2 * Math.PI * 0.22) };
        st = CM.withBowHand({
          leftArm: nat.leftArm, rightArm: { shoulder: shR, elbow: elbowR, wrist: wristR },
          fingers: nat.fingers, thumb: nat.thumb, hand: nat.hand,
          bow: { frog, tip, contact, string: sFloat, frac: bowF, stickFrog, stickTip },
          sway, sounding,
        });
      } else if (pt.kind === 'guitar') {
        // Full pose() + precompiled solo GuitarHandSkin atlas so ensemble guitar hands match solo!
        st = window.GuitarMotion.pose(pt.plan, t);
        if (!st.hands) {
          const gm = lookupGuitarHand(st.palm[0]);
          if (gm) { st.hands = gm.hands; st.wristL = gm.wristL; st.elbowL = gm.elbowL; st.wristR = gm.wristR; st.elbowR = gm.elbowR; }
        }
      } else if (pt.kind === 'flute' || pt.kind === 'oboe') {
        st = window.WoodwindEngine.stateAt(pt.plan, t);
      } else if (pt.kind === 'piano') {
        const active = [];
        for (const n of pt.song.notes) if (t >= n[0] && t <= n[0] + n[1]) active.push(n[2]);
        st = { active };
      }
      return { part: pt, state: st };
    });
    return { kind: P.kind, time: t, parts: partStates };
  }

  function draw(R, S) {
    for (const { part, state } of S.parts) {
      const F = part.seatFrame;
      const R2 = placedRenderer(R, part.id, F);
      const opts = { female: !!part.seat.female, gown: part.seat.gown, time: S.time };
      R.withTransform(F, () => {
        if (part.kind === 'violin' || part.kind === 'viola') {
          window.ViolinModel.draw(R2, state, opts);
        } else if (part.kind === 'cello') {
          window.CelloMotion.drawPose(R2, state, opts);
        } else if (part.kind === 'guitar') {
          window.GuitarModel.drawGuitar(R2, state, S.time);
          window.GuitarModel.drawPerformer(R2, state, S.time);
        } else if (part.kind === 'flute' || part.kind === 'oboe') {
          window.WoodwindEngine.draw(R2, state, opts);
        } else if (part.kind === 'piano') {
          drawStagePiano(R2, state.active, S.time, opts);
        }
      });
      // Music stands for strings & woodwinds (skip piano/guitar to keep sightlines clear)
      if (part.kind !== 'piano' && part.kind !== 'guitar') {
        drawStand(R, part.seat.x, part.seat.z, part.seat.yaw || 0);
      }
    }
  }

  return { plan, stateAt, draw, makeSeat, composeFrame, lookupViolinHand };
})();

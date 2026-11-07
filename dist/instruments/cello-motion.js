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
  const FINGER_LEN = { 1: [0.044, 0.030, 0.021], 2: [0.048, 0.033, 0.022], 3: [0.044, 0.030, 0.021], 4: [0.036, 0.024, 0.017] };
  const THUMB_LEN = [0.046, 0.034, 0.024];

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

  // 3-segment finger chain from base B to target T in the bend plane
  // whose normal is planeN. Distal curl fixed: exact by construction.
  function fingerChain(B, T, lens, planeN, curl = 0.35) {
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
    // Knuckles ride in FRONT of the board on the approach line; the
    // old placement put them 48 mm behind the contact along -n,
    // inside the neck volume, and the wrist ball clipped the neck's
    // back, so the wrist path now swings around the neck (the
    // -sin(pi*lam) bulge) as the posture rolls over.
    const dA = M.SCALE - dot(sub(anchorPt, M.AB), M.u); // hand distance from the nut
    const lam = smooth((dA - 0.20) / 0.14);
    const phi = lam * 1.745; // hand roll about the neck axis, 0 -> ~100 deg
    const backN = add(mul(M.n, Math.cos(phi)), mul(M.v, -Math.sin(phi))); // back-of-hand normal
    const sw = Math.sin(Math.PI * lam);
    const wrist = add(anchorPt, add(
      mul(M.u, slerp(-0.045, 0.050, lam)),
      add(mul(M.v, slerp(0.012, -0.075, lam) - 0.05 * sw),
        mul(M.n, slerp(-0.115, 0.006, lam) - 0.03 * sw))));
    const elbowL = solveElbow(SHOULDER_L, wrist, [0.45, -1, 0.30]);
    // Finger approach: knuckle = target + appDir * (reach * rho).
    // Neck: rho ~ 0.98 (nearly straight chain, tip curl 0.55). End:
    // rho ~ 0.58 (folded chain, tip curl 0.28) with the approach
    // swung toward the player's left, following the hand roll. The
    // chains always hook in the string's sagittal plane (bulge
    // reference M.n): in the end posture the knuckle sits to the
    // player's left of the target, so the finger travels across and
    // the folded tip ends pointing back toward the player (-n).
    const curlF = slerp(0.55, 0.28, lam), rho = slerp(0.98, 0.58, lam);
    const appDir = norm(add(
      mul(M.u, slerp(0.60, 0.35, lam)),
      add(mul(M.v, slerp(0, -0.62, lam)), mul(M.n, slerp(0.80, 0.70, lam)))));
    // Fingers.
    const fingers = {};
    const stopping = {};
    for (const { r } of sounding) if (r.mode !== 'open' && r.finger !== 'T') stopping[r.finger] = r;
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
      const [l1, l2, l3] = FINGER_LEN[f];
      const reach = l1 + Math.sqrt(l2 * l2 + l3 * l3 + 2 * l2 * l3 * Math.cos(curlF));
      const knuckle = add(target, mul(appDir, reach * rho));
      const pts = fingerChain(knuckle, target, FINGER_LEN[f], M.n, curlF);
      // Base-joint (MCP) bend of the chain: angle between the first
      // segment and the knuckle->target chord.
      const mcp = Math.acos(clamp(dot(norm(sub(pts[1], knuckle)), norm(sub(target, knuckle))), -1, 1));
      fingers[f] = { points: pts, contact, target, mcpAngle: mcp, tipDir: norm(sub(pts[3], pts[2])) };
    }
    // Thumb: one continuous rest point following the posture
    // parameter (no discrete mode switch, so nothing pops at the
    // neck/thumb boundary). lam = 0: the pad rests ON the back of
    // the neck -- the rest point sits one thumb radius behind the
    // neck's back surface (axis 34 mm behind the board, radius 27
    // -> surface at 61 mm; 77 mm puts the segment surface just
    // touching it; at the original 52 mm the tip was inside the
    // neck volume). lam = 1: the thumb lies across the fingerboard
    // on the strings as the anchor under the hand (rest point 3 mm
    // in front of the anchor's string point). In between, the rest
    // point swings around the player's-left side of the neck (the
    // -sin(pi*lam) term, mirroring the wrist path) instead of
    // dragging across the neck's back corner, and the chain's base
    // and bulge plane rotate with it.
    const restPt = add(anchorPt, add(
      mul(M.n, slerp(-0.077, 0.003, lam)),
      mul(M.v, -0.075 * sw)));
    const thumbBase = add(wrist, add(mul(M.u, 0.010 * (1 - lam)), mul(M.n, 0.015 * lam)));
    const thumbPlane = norm(add(mul(M.v, 1 - lam), mul(M.n, lam)));
    const thumbPts = fingerChain(thumbBase, restPt, THUMB_LEN, thumbPlane);
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
      hand: { anchor: anchorPt, mode, lambda: lam, backNormal: backN }, sway,
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
    // Arms.
    for (const [arm, sleeve] of [[p.leftArm, SUIT], [p.rightArm, SUIT]]) {
      R.segment(arm.shoulder, arm.elbow, 0.047, sleeve, 'limb');
      R.segment(arm.elbow, arm.wrist, 0.038, sleeve, 'limb');
      R.ball(arm.wrist, [0.042, 0.046, 0.042], SKIN);
    }
    // Left fingers + thumb.
    for (let f = 1; f <= 4; f++) {
      const pts = p.fingers[f].points;
      for (let j = 0; j < 3; j++) R.segment(pts[j], pts[j + 1], [0.0135, 0.0125, 0.011][j], j === 2 ? SKIN_L : SKIN, 'joint');
    }
    { const pts = p.thumb.points; for (let j = 0; j < 3; j++) R.segment(pts[j], pts[j + 1], 0.014, SKIN, 'joint'); }
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

  return { plan, pose, draw, _ik: { solveElbow, fingerChain }, SKELETON: { SHOULDER_L, SHOULDER_R, ARM, FINGER_LEN, THUMB_LEN } };
})();

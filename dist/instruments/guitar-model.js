'use strict';
/* Scene drawing for the classical guitarist, using the host renderer's
 * primitives (the demos-pianist RecitalGL API: box/ball/bone/piece/
 * segment). All positions come from GuitarMotion's frame, so the drawn
 * strings, frets and fingertips agree with the fingering engine.
 * drawScene draws stage + guitar + performer (local harness);
 * drawGuitar / drawPerformer are the separable pieces for the host. */
window.GuitarModel = (() => {
const GM = window.GuitarMotion;
const { u, w, n, NUT } = GM;
const add = (a, b) => a.map((v, i) => v + b[i]), mul = (a, s) => a.map(v => v * s);
const spruce = [.72, .55, .32], spruceLight = [.80, .63, .38], mahogany = [.30, .15, .08], darkWood = [.16, .09, .05],
  fretboardC = [.09, .06, .045], steel = [.75, .76, .78], brass = [.63, .46, .2], boneC = [.88, .85, .78],
  skin = [.74, .55, .43], skinLight = [.80, .62, .50], suit = [.05, .05, .065], shirt = [.84, .83, .80], hair = [.07, .055, .048], lash = [.20, .12, .10];

function drawGuitar(R, pose, t) {
  const sp = (s, d, lift) => GM.stringPoint(s, d, lift);
  // Body: oriented ellipsoids (piece() ZYX Euler puts the sphere's
  // axes on the guitar frame: X->w width, Y->-u along the body,
  // Z->-n thickness) at stations along the body outline — joint at
  // the 12th fret (d=0.325), bridge at d=0.650, tail at d=0.81.
  const RX = Math.atan2(-u[2], -n[2]), RZ = Math.atan2(w[1], w[0]);
  const profile = [[0.325, 0.092], [0.36, 0.112], [0.42, 0.133], [0.475, 0.1415], [0.53, 0.131],
    [0.585, 0.1215], [0.64, 0.133], [0.70, 0.163], [0.745, 0.1805], [0.785, 0.172], [0.808, 0.138]];
  const halfW = d => {
    for (let i = 1; i < profile.length; i++) if (d <= profile[i][0]) {
      const [d0, w0] = profile[i - 1], [d1, w1] = profile[i];
      return w0 + (w1 - w0) * (d - d0) / (d1 - d0);
    }
    return profile.at(-1)[1];
  };
  for (let d = 0.33; d <= 0.802; d += 0.013) R.piece('sphere', sp(3.5, d, -0.047), [halfW(d), 0.011, 0.049], mahogany, RX, 0, RZ);
  for (let d = 0.33; d <= 0.802; d += 0.013) R.piece('sphere', sp(3.5, d, -0.0465), [halfW(d) - 0.004, 0.0105, 0.0495], spruce, RX, 0, RZ);
  // Soundhole + rosette (hole centre ~105 mm into the body; the disc
  // sits just above the top plate, below the strings).
  const SH = sp(3.5, 0.435, 0.0035);
  R.piece('sphere', SH, [.042, .042, .004], [.02, .015, .012], RX, 0, RZ);
  for (let k = 0; k < 28; k++) {
    const a0 = k / 28 * Math.PI * 2, a1 = (k + 1) / 28 * Math.PI * 2;
    const p0 = add(SH, add(mul(u, Math.cos(a0) * .050), mul(w, Math.sin(a0) * .050)));
    const p1 = add(SH, add(mul(u, Math.cos(a1) * .050), mul(w, Math.sin(a1) * .050)));
    R.bone(p0, p1, .0016, k % 2 ? [.55, .30, .16] : [.85, .68, .45]);
  }
  // Fretboard (tail loft = flat strip in the renderer's segment frame,
  // which GuitarMotion's w/n were built to match) + neck behind it.
  const fbA = add(NUT, mul(n, -0.004)), fbB = sp(3.5, 0.485, -0.004);
  R.segment(add(fbA, mul(u, 0.012)), sp(3.5, 0.325, -0.004), .0275, fretboardC, 'tail');
  R.segment(sp(3.5, 0.325, -0.004), fbB, .0305, fretboardC, 'tail');
  R.segment(add(NUT, add(mul(n, -0.020), mul(u, 0.05))), add(sp(3.5, 0.485, -0.020), mul(u, -0.05)), .017, darkWood, 'limb');
  // Headstock + tuners.
  const hsA = add(NUT, add(mul(u, 0.004), mul(n, -0.008))), hsB = add(NUT, add(mul(u, 0.185), mul(n, -0.010)));
  R.segment(hsA, hsB, .031, darkWood, 'tail');
  for (let k = 0; k < 3; k++) for (const side of [-1, 1]) {
    const c = add(NUT, add(mul(u, 0.045 + k * 0.052), add(mul(w, side * 0.036), mul(n, -0.010))));
    R.ball(c, [.007, .007, .007], brass, .7);
    R.segment(add(c, mul(w, -side * 0.006)), add(c, mul(w, side * 0.004)), .0028, steel, 'limb');
  }
  // Frets, markers, nut.
  for (let f = 1; f <= 19; f++) {
    const d = GM.fretDist(f);
    R.bone(sp(1, d, 0.0012), sp(6, d, 0.0012), .0009, steel, .8);
    if ([5, 7, 9, 15, 17].includes(f)) R.ball(sp(3.5, (GM.fretDist(f) + GM.fretDist(f - 1)) / 2, 0.0012), [.0028, .0028, .0028], boneC);
    if (f === 12) for (const s of [2.5, 4.5]) R.ball(sp(s, (GM.fretDist(f) + GM.fretDist(f - 1)) / 2, 0.0012), [.0028, .0028, .0028], boneC);
  }
  R.bone(sp(1, 0, 0.002), sp(6, 0, 0.002), .0018, boneC);
  // Bridge + saddle.
  R.bone(sp(6, GM.SCALE, -0.002), sp(1, GM.SCALE, -0.002), .0055, darkWood);
  R.bone(sp(6, GM.SCALE, 0.004), sp(1, GM.SCALE, 0.004), .0016, boneC);
  // Strings, with a shimmer offset while a plucked string rings.
  for (let s = 1; s <= 6; s++) {
    const a = sp(s, -0.002, 0.005), b = GM.bridgePoint(s), vib = pose ? pose.vib[s] : 0;
    const cc = s >= 5 ? [.62, .50, .30] : [.82, .83, .85], r = s >= 5 ? .0011 : .0007;
    if (vib > 0.03) {
      const mid = a.map((v, i) => (v + b[i]) / 2);
      const off = add(mul(n, Math.sin(t * 88 + s * 1.7) * 0.0045 * vib), mul(w, Math.cos(t * 71 + s) * 0.0022 * vib));
      const m2 = add(mid, off);
      R.bone(a, m2, r, cc, .6); R.bone(m2, b, r, cc, .6);
    } else R.bone(a, b, r, cc, .6);
  }
}

/* Head frame + face anchors. The head loft's face front is its local
 * +Z (jaw forward, crown swept back — the dz profile in the renderer),
 * and piece() orients a shape by Rz*Ry*Rx, so point() applies the same
 * composition to pianist-style local face coordinates. The audience
 * sits toward -Z in planning coords, hence the pi yaw: without it the
 * skull faced the back of the stage and the old 'nose hint' ball sat
 * behind the head. The yaw is pi - 0.32, not pi: the extra 18 deg
 * turns the face toward planning +X, which the renderer's X mirror
 * shows as the player's anatomical left — a guitarist's glance
 * toward the fretboard. FS scales the demos-pianist head
 * [.112,.148,.128] down to this head [.082,.112,.092]. */
const HEAD_C = [0.008, 1.615, -0.005], HEAD_S = [.082, .112, .092];
const FS = [HEAD_S[0] / .112, HEAD_S[1] / .148, HEAD_S[2] / .128];
function headFrame(pose) {
  const rx = pose.torso.lean * .6, ry = Math.PI - 0.785, rz = pose.torso.sway * .5; // 45 deg glance toward the fretboard, whose bearing from the head is now forward-left
  const rot = p => {
    let [x, y, z] = p, c = Math.cos(rx), s = Math.sin(rx);
    [y, z] = [y * c - z * s, y * s + z * c];
    c = Math.cos(ry); s = Math.sin(ry); [x, z] = [x * c + z * s, z * c - x * s];
    c = Math.cos(rz); s = Math.sin(rz); [x, y] = [x * c - y * s, x * s + y * c];
    return [x, y, z];
  };
  const scale = p => [p[0] * FS[0], p[1] * FS[1], p[2] * FS[2]];
  const point = p => add(HEAD_C, rot(scale(p)));
  const fwd = rot([0, 0, 1]), right = rot([1, 0, 0]);
  const nose = point([0, -.012, .122]);
  return { centre: HEAD_C, rx, ry, rz, point, scale, fwd, right,
    eyePlus: point([.04, .009, .12]), eyeMinus: point([-.04, .009, .12]),
    nose, noseTip: add(nose, mul(fwd, .02 * FS[2] * 1.3)) };
}

/* Seated posture (planning coords; the renderer mirrors X, so the
 * anatomical LEFT leg — raised on the footstool, carrying the
 * guitar's waist — is the one at planning +X). The left shoe's sole
 * rests exactly on the stool top (0.14) and the right shoe's sole on
 * the floor (0). Exported for posture-test.cjs. */
const POSTURE = {
  hipL: [0.115, .88, .03], kneeL: [0.215, .80, -0.315], ankleL: [0.185, .19, -0.325],
  hipR: [-0.115, .88, .03], kneeR: [-0.185, .60, -0.30], ankleR: [-0.20, .06, -0.44],
  shoeL: [0.185, .185, -0.36], shoeR: [-0.205, .045, -0.475], shoeHalfH: .045,
  stool: [0.175, .070, -0.315], stoolTop: .14,
};

function fingerDraw(R, f, rad) {
  for (let j = 0; j < 3; j++) R.segment(f.points[j], f.points[j + 1], rad[j], skin);
  R.ball(f.points[3], [rad[2] * .95, rad[2] * .95, rad[2] * .95], skinLight);
}
const RADII = [[.0095, .0085, .0075], [.0088, .0078, .0068], [.0092, .0082, .0072], [.0088, .0078, .0068], [.0078, .0068, .0058]];

function drawPerformer(R, pose, t) {
  const { lean, sway } = pose.torso;
  // Bench + footstool (classical posture: anatomical left foot
  // raised on the stool — planning +X, see POSTURE).
  R.piece('cushion', [0.02, .565, 0.04], [.36, .05, .24], [.03, .019, .017]);
  R.box([0.02, .515, 0.04], [.68, .05, .44], [.02, .02, .026], .7);
  for (const x of [0.30, -0.26]) for (const z of [-0.13, 0.21]) R.segment([x, .49, z], [x * .96, .03, z], .020, [.02, .02, .026]);
  R.box(POSTURE.stool, [.27, .14, .30], [.10, .08, .06], .2); // footstool
  // Legs: left thigh raised toward the guitar, right leg down.
  const { hipL, kneeL, hipR, kneeR } = POSTURE;
  R.segment(hipL, kneeL, .058, suit); R.segment(hipR, kneeR, .058, suit);
  R.segment(kneeL, POSTURE.ankleL, .044, suit); R.segment(kneeR, POSTURE.ankleR, .044, suit);
  R.piece('shoe', POSTURE.shoeL, [.055, .045, .11], [.015, .012, .014], 0, 0, 0);
  R.piece('shoe', POSTURE.shoeR, [.055, .045, .11], [.015, .012, .014], 0, 0, 0);
  // Torso + head (gentle lean and sway from the pose).
  R.piece('jacket', [0, 1.165, 0.03], [.205, .295, .148], suit, lean, 0, sway);
  const hf = headFrame(pose), hp = hf.point, hs = hf.scale;
  R.piece('head', HEAD_C, HEAD_S, skin, hf.rx, hf.ry, hf.rz);
  R.piece('hair', [0.008, 1.645, 0.012], [.086, .105, .096], hair, hf.rx, hf.ry, hf.rz);
  // Face, mirrored from the demos-pianist performer: serene lowered
  // eyes (lash segments), soft brows, ears, a nose piece and lips, at
  // the pianist's local coordinates scaled by FS (see headFrame).
  R.piece('nose', hp([0, -.012, .122]), hs([.016, .034, .02]), skinLight, hf.rx, hf.ry, hf.rz);
  for (const sx of [-1, 1]) {
    const ex = sx * .04, lid = .012;
    R.segment(hp([ex - .017, lid + .002, .113]), hp([ex, lid - .003, .12]), .0016, lash);
    R.segment(hp([ex, lid - .003, .12]), hp([ex + .017, lid + .001, .114]), .0016, lash);
    R.segment(hp([ex - .02, .04, .118]), hp([ex + .018, .043, .118]), .0023, hair);
    R.piece('joint', hp([sx * .109, -.008, -.008]), hs([.012, .03, .022]), skin, hf.rx, hf.ry, hf.rz);
  }
  R.segment(hp([-.02, -.074, .113]), hp([.02, -.074, .113]), .0031, [.62, .38, .33]);
  R.segment(hp([-.012, -.083, .11]), hp([.012, -.083, .11]), .0026, [.70, .48, .40]);
  // Arms (exact two-bone chains from the pose).
  for (const arm of pose.arms) {
    R.segment(arm.shoulder, arm.elbow, .047, suit);
    R.segment(arm.elbow, arm.wrist, .038, suit);
    R.ball(arm.elbow, [.042, .042, .042], suit);
  }
  // Left hand: palm behind the neck, fingers + thumb from the pose.
  R.ball(pose.palm, [.046, .030, .052], skin);
  for (const f of pose.lhFingers) fingerDraw(R, f, RADII[f.digit]);
  fingerDraw(R, pose.lhThumb, RADII[0]);
  // Right hand over the soundhole.
  const rhPalm = add(GM.stringPoint(3, GM.PLUCK_D, 0.058), mul(w, 0.002));
  R.ball(rhPalm, [.044, .028, .050], skin);
  for (const name of ['p', 'i', 'm', 'a']) fingerDraw(R, pose.rhFingers[name], RADII[pose.rhFingers[name].digit]);
}

function drawStage(R) {
  R.box([0, -.065, .6], [24, .12, 24], [.065, .055, .05]);
  R.ball([0, -.025, .4], [4.3, .11, 4.3], [.105, .088, .067]);
  for (let i = 0; i < 22; i++) R.box([0, .002, -3.5 + i * .35], [7.8, .005, .014], [.048, .042, .036]);
  for (let i = -12; i <= 12; i++) { R.box([i * .48, 1.8, 5.2], [.07, 3.6, .15], [.105, .089, .064], .1); R.box([i * .48, 1.8, 5.31], [.27, 3.6, .06], [.035, .035, .04]); }
  for (let i = 0; i < 64; i++) { const a = i * Math.PI / 32, b = (i + 1) * Math.PI / 32; R.bone([4 * Math.sin(a), .006, .4 + 4 * Math.cos(a)], [4 * Math.sin(b), .006, .4 + 4 * Math.cos(b)], .008, brass); }
}

function drawScene(R, pose, t) { drawStage(R); drawGuitar(R, pose, t); drawPerformer(R, pose, t); }
return { drawGuitar, drawPerformer, drawStage, drawScene, headFrame, POSTURE, colors: { spruce, mahogany, skin, suit } };
})();

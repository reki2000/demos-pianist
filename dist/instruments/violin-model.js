'use strict';
/* Violin geometry + performer drawing for the violin instrument module.
 *
 * Coordinate conventions are the host's (shared with demos-pianist):
 * meters, +Y up, planning +X is the performer's anatomical left
 * (RecitalGL flips X for display). The performer stands at the origin
 * facing -Z; the violin neck points toward +X (performer's left).
 *
 * Violin local frame: point(u, v, w) = O + U*u + V*v + W*w, where
 *   u = meters along the strings from the bridge toward the scroll
 *       (nut at u = 0.328, body from u = -0.208 to u = +0.148),
 *   v = meters across the strings (G side positive at the bridge),
 *   w = meters out of the top plate (bridge top at w = 0.033).
 * A stopped note at distance d mm from the nut sits at u = 0.328 - d/1000.
 */
window.ViolinModel = (() => {
const norm = a => { const l = Math.hypot(...a) || 1; return a.map(v => v / l); };
const add = (a, b) => a.map((v, i) => v + b[i]);
const mul = (a, s) => a.map(v => v * s);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const sub = (a, b) => a.map((v, i) => v - b[i]);

const STRING_LENGTH = 0.328;
const O0 = [0.105, 1.438, -0.205];                    // top plate under the bridge
const U = norm([0.616, -0.03, -0.788]);               // bridge -> scroll
const Wraw = [0.18, 0.95, -0.25];
const W = norm(sub(Wraw, mul(U, Wraw.reduce((s, v, i) => s + v * U[i], 0)))); // plate normal, orthogonalized
const V = cross(W, U);                                // across the strings
const STRING_V_BRIDGE = [0.0165, 0.0055, -0.0055, -0.0165]; // G D A E
const STRING_V_NUT = [0.00825, 0.00275, -0.00275, -0.00825];
const STRING_V_TAIL = [0.012, 0.004, -0.004, -0.012];
const STRING_R = [0.0012, 0.0010, 0.0009, 0.0008];
const BRIDGE_W = 0.0333;
const wFB = u => 0.0235 - 0.0125 * (u / STRING_LENGTH);          // fingerboard top surface
const wStr = u => BRIDGE_W + (0.0155 - BRIDGE_W) * (u / STRING_LENGTH); // string line, bridge -> nut
const vStr = (i, u) => STRING_V_BRIDGE[i] + (STRING_V_NUT[i] - STRING_V_BRIDGE[i]) * (u / STRING_LENGTH);
const BOW_CONTACT_U = 0.048; // bow hair meets the string ~48mm from the bridge

function frame(sway = [0, 0, 0]) {
  const O = add(O0, sway);
  const point = (u, v, w) => [O[0] + U[0] * u + V[0] * v + W[0] * w,
                              O[1] + U[1] * u + V[1] * v + W[1] * w,
                              O[2] + U[2] * u + V[2] * v + W[2] * w];
  // Point on string i: distMm from the nut (328 = open), lift = extra w (hover).
  const stringPoint = (i, distMm, lift = 0) => {
    const u = STRING_LENGTH - distMm / 1000;
    return point(u, vStr(i, u), wStr(u) + lift);
  };
  // Where a fingertip presses string i down to the fingerboard.
  const contactPoint = (i, distMm) => {
    const u = STRING_LENGTH - distMm / 1000;
    return point(u, vStr(i, u), wFB(u) + 0.0012);
  };
  // Where the bow hair touches string i.
  const bowPoint = i => point(BOW_CONTACT_U, vStr(i, BOW_CONTACT_U), wStr(BOW_CONTACT_U) + 0.001);
  return { O, U, V, W, point, stringPoint, contactPoint, bowPoint };
}

const skin = [.74, .55, .43], skinLight = [.80, .62, .50], suit = [.045, .047, .058],
  satin = [.075, .075, .085], shirt = [.84, .83, .80], hairC = [.07, .055, .048],
  lash = [.20, .12, .10], ebony = [.025, .029, .035],
  varnish = [.50, .19, .055], varnishDark = [.34, .115, .035], maple = [.72, .55, .33],
  fbWood = [.05, .04, .035], steel = [.72, .73, .76], steelHot = [.98, .85, .55],
  bowWood = [.23, .12, .06], bowHair = [.92, .90, .82];

function drawViolin(R, F, activeStrings) {
  const { point } = F;
  const bout = (u, hw, hl, ht, w, c) => {
    R.oriented('sphere', point(u, 0, w), [hl, ht, hw], c, 0, F.U, F.W, F.V);
    R.oriented('sphere', point(u, 0, w - 0.007), [hl * 1.01, ht, hw * 1.02], varnishDark, 0, F.U, F.W, F.V);
  };
  bout(-0.098, 0.104, 0.088, 0.0205, 0, varnish);   // lower bout
  bout(-0.008, 0.0575, 0.058, 0.020, 0, varnish);   // waist
  bout(0.072, 0.083, 0.068, 0.0195, 0, varnish);    // upper bout
  // f-holes: thin dark slots flanking the bridge, angled in the plate plane.
  for (const s of [-1, 1]) {
    const a = s * 0.38, ca = Math.cos(a), sa = Math.sin(a);
    const Ux = F.U.map((v, i) => v * ca + F.V[i] * sa), Vx = F.V.map((v, i) => v * ca - F.U[i] * sa);
    R.oriented('box', point(0.018, s * 0.0345, 0.0208), [0.034, 0.0012, 0.0038], [.04, .018, .008], 0, Ux, F.W, Vx);
  }
  // Fingerboard: two boxes along its sloped axis (wFB falls as u grows,
  // so the board's long axis is U tilted by dw/du along W).
  const slope = -0.0125 / STRING_LENGTH;
  const Ufb = norm(add(F.U, mul(F.W, slope)));
  const Wfb = cross(F.V, Ufb);
  const fbSeg = (u0, u1, hw) => {
    const um = (u0 + u1) / 2;
    const base = point(um, 0, wFB(um) - 0.0032);
    R.oriented('box', base, [(u1 - u0) / 2, 0.0032, hw], fbWood, 0, Ufb, Wfb, F.V);
  };
  fbSeg(0.085, 0.21, 0.0225); fbSeg(0.21, 0.335, 0.0165);
  // Neck under the fingerboard + heel.
  R.oriented('box', point(0.235, 0, wFB(0.235) - 0.0115), [0.088, 0.008, 0.0115], varnishDark, 0, Ufb, Wfb, F.V);
  R.ball(point(0.148, 0, -0.002), [0.030, 0.026, 0.020], varnishDark);
  // Nut, pegbox, scroll, pegs.
  R.oriented('box', point(0.330, 0, wFB(0.328) + 0.002), [0.003, 0.003, 0.013], maple, 0, F.U, F.W, F.V);
  R.oriented('box', point(0.368, 0, wFB(0.328) - 0.004), [0.036, 0.009, 0.011], fbWood, 0, F.U, F.W, F.V);
  R.ball(point(0.412, 0, wFB(0.328) - 0.002), [0.017, 0.016, 0.014], varnishDark);
  R.ball(point(0.438, 0, wFB(0.328) - 0.001), [0.0125, 0.012, 0.011], varnishDark);
  R.ball(point(0.458, 0, wFB(0.328)), [0.008, 0.008, 0.007], varnishDark);
  for (let i = 0; i < 4; i++) {
    const p = point(0.345 + i * 0.016, 0, wFB(0.328) - 0.004), s = i % 2 ? 1 : -1;
    R.bone(add(p, mul(F.V, s * 0.004)), add(p, mul(F.V, s * 0.026)), 0.0035, ebony);
    R.ball(add(p, mul(F.V, s * 0.028)), [0.006, 0.009, 0.005], ebony);
  }
  // Bridge + tailpiece + chin rest.
  R.oriented('box', point(0, 0, 0.0165), [0.0042, 0.0165, 0.026], maple, 0, F.U, F.W, F.V);
  R.oriented('box', point(-0.004, 0.020, 0.0015), [0.010, 0.0015, 0.006], maple, 0, F.U, F.W, F.V);
  R.oriented('box', point(-0.004, -0.020, 0.0015), [0.010, 0.0015, 0.006], maple, 0, F.U, F.W, F.V);
  const Utp = norm(add(F.U, mul(F.W, 0.10))), Wtp = cross(F.V, Utp);
  R.oriented('box', point(-0.137, 0, 0.0155), [0.052, 0.0038, 0.0205], ebony, 0, Utp, Wtp, F.V);
  R.bone(point(-0.19, 0, 0.012), point(-0.207, 0, 0.004), 0.0028, ebony);
  R.oriented('sphere', point(-0.152, -0.030, 0.0245), [0.046, 0.0055, 0.031], ebony, 0, F.U, F.W, F.V);
  // Strings: tailpiece -> bridge -> nut -> pegbox. The sounding length of an
  // active string is drawn hot from its stop point (or the nut) to the bridge.
  for (let i = 0; i < 4; i++) {
    const hot = activeStrings.includes(i);
    R.bone(point(-0.175, STRING_V_TAIL[i], 0.021), point(0, STRING_V_BRIDGE[i], BRIDGE_W + 0.0004), STRING_R[i], steel, 0.55);
    R.bone(point(0.330, STRING_V_NUT[i], wStr(0.328)), point(0.352 + i * 0.013, STRING_V_NUT[i] * 0.6, wStr(0.328) - 0.004), STRING_R[i], steel, 0.55);
    if (!hot) R.bone(point(0, STRING_V_BRIDGE[i], BRIDGE_W + 0.0004), point(0.328, STRING_V_NUT[i], wStr(0.328)), STRING_R[i], steel, 0.55);
  }
}

function drawBow(R, bow) {
  R.bone(bow.frogStick, bow.tipStick, 0.0029, bowWood, 0.25);
  R.bone(bow.frogHair, bow.tipHair, 0.0013, bowHair, 0);
  R.ball(bow.tipStick, [0.0045, 0.006, 0.004], [.85, .80, .70], 0.3);
  const mid = bow.frogStick.map((v, i) => v + bow.axis[i] * 0.012);
  R.oriented('box', mid, [0.013, 0.0075, 0.0105], ebony, 0, bow.axis, bow.down, bow.side);
  R.ball(bow.frogStick.map((v, i) => v - bow.axis[i] * 0.018), [0.005, 0.005, 0.005], [.6, .6, .62], 0.8);
}

function drawPerformer(R, S) {
  const sw = S.sway, up = S.upperSway || sw;
  const P = p => [p[0] + sw[0], p[1] + sw[1], p[2] + sw[2]];
  const P2 = p => [p[0] + up[0], p[1] + up[1], p[2] + up[2]];
  // Legs and shoes (standing).
  for (const s of [-1, 1]) {
    const hip = P([s * 0.095, 0.99, 0]), knee = P([s * 0.105, 0.52, -0.012]), ankle = P([s * 0.11, 0.075, 0.008]);
    R.segment(hip, knee, 0.074, suit); R.segment(knee, ankle, 0.052, suit);
    R.piece('joint', knee, [.058, .058, .058], suit);
    // The shoe loft's toe is its local +Z end; the performer faces -Z,
    // so the shoe is yawed PI (the pianist's unrotated call, kept in an
    // earlier port, pointed the toes at the back of the stage) and the
    // centre sits 80mm toward the facing from the ankle, as there.
    R.piece('shoe', P([s * 0.11, 0.038, -0.072]), [.058, .040, .140], ebony, 0, Math.PI, 0);
  }
  // Torso: jacket loft, slight forward lean and breath.
  const root = P2([0, 1.17, 0.012]);
  R.piece('jacket', root, [.265 * (1 + S.breath * 0.01), .40, .180 * (1 + S.breath * 0.01)], suit, S.lean, S.torsoYaw, S.torsoRoll);
  R.piece('palm', P2([0, 1.335, -0.155]), [.055, .15, .018], satin, S.lean + 0.06, S.torsoYaw, S.torsoRoll);
  // Neck + head, tilted down toward the violin, chin over the chin rest.
  const H = S.head;
  // The neck bridges the jacket (torso follow) and the head (which
  // rides the instrument's sway with the chin on the rest).
  const hs = S.headSway || up;
  R.segment([0.012 + hs[0], 1.47 + hs[1], -0.01 + hs[2]], H.pos, 0.048, skin);
  R.piece('head', H.pos, [.112, .148, .128], skinLight, H.pitch, H.yaw, H.roll);
  const hp = (p) => { // head-local point, same rotation convention as the pianist
    const cr = Math.cos(H.roll), sr = Math.sin(H.roll), px = p[0] * cr - p[1] * sr, py = p[0] * sr + p[1] * cr;
    const c = Math.cos(H.pitch), s = Math.sin(H.pitch), cy = Math.cos(H.yaw), sy = Math.sin(H.yaw);
    const y = py * c - p[2] * s, z = py * s + p[2] * c;
    return [H.pos[0] + px * cy + z * sy, H.pos[1] + y, H.pos[2] + z * cy - px * sy];
  };
  R.piece('hair', hp([0, 0.004, 0]), [.117, .148, .133], hairC, H.pitch, H.yaw, H.roll);
  R.piece('nose', hp([0, -0.012, 0.122]), [.016, .034, .02], skinLight, H.pitch, H.yaw, H.roll);
  for (const x of [-1, 1]) {
    const ex = x * 0.04;
    R.segment(hp([ex - 0.017, 0.010, 0.113]), hp([ex, 0.005, 0.120]), 0.0022, lash);
    R.segment(hp([ex, 0.005, 0.120]), hp([ex + 0.017, 0.009, 0.114]), 0.0022, lash);
    R.segment(hp([ex - 0.020, 0.042, 0.118]), hp([ex + 0.018, 0.045, 0.118]), 0.0032, hairC);
    R.piece('joint', hp([x * 0.109, -0.008, -0.008]), [.012, .03, .022], skin, H.pitch, H.yaw, H.roll);
  }
  R.segment(hp([-0.02, -0.074, 0.113]), hp([0.02, -0.072, 0.113]), 0.0042, [.62, .38, .33]);
  // Arms (joints solved by motion): suit sleeves, white cuff, skin hands.
  for (const arm of [S.armL, S.armR]) {
    R.piece('joint', arm.shoulder, [.062, .066, .062], suit);
    // Capsule radii asserted against the body by clearance-test.cjs.
    R.segment(arm.shoulder, arm.elbow, 0.055, suit);
    R.segment(arm.elbow, arm.wrist, 0.042, suit);
    R.piece('joint', arm.elbow, [.050, .050, .050], suit);
    const fl = Math.hypot(...arm.elbow.map((v, i) => v - arm.wrist[i])) || 1;
    const cuff = arm.wrist.map((v, i) => v + (arm.elbow[i] - v) * 0.05 / fl);
    R.segment(arm.wrist, cuff, 0.034, shirt);
  }
  // Left hand: palm block + solved fingers + thumb.
  R.piece('palm', S.handL.palmPos, [.042, .013, .038], skin, S.handL.pitch, S.handL.yaw, S.handL.roll);
  for (const f of S.handL.fingers) {
    for (let j = 0; j < 3; j++) {
      R.segment(f.points[j], f.points[j + 1], 0.0105 - j * 0.0016, skinLight);
      if (j > 0) R.piece('joint', f.points[j], [.010, .009, .010], skinLight);
    }
    R.ball(f.points[3], [0.0075, 0.0075, 0.0095], skinLight);
  }
  for (let j = 0; j < 2; j++) R.segment(S.handL.thumb[j], S.handL.thumb[j + 1], 0.012, skin);
  // Right hand grips the frog.
  R.piece('palm', S.handR.palmPos, [.052, .015, .048], skin, S.handR.pitch, S.handR.yaw, S.handR.roll);
  for (const f of S.handR.fingers) for (let j = 0; j < 3; j++) R.segment(f.points[j], f.points[j + 1], 0.0095 - j * 0.0015, skinLight);
}

function draw(R, S) {
  drawViolin(R, S.frame, S.activeStrings);
  // Hot speaking lengths for sounding strings (stop point -> bridge).
  for (const a of S.sounding) {
    const from = a.finger > 0 ? S.frame.stringPoint(a.string, a.distMm) : S.frame.point(0.328, STRING_V_NUT[a.string], wStr(0.328));
    R.bone(from, S.frame.point(0, STRING_V_BRIDGE[a.string], BRIDGE_W + 0.0004), STRING_R[a.string] + 0.0004, steelHot, 0.35);
  }
  drawBow(R, S.bow);
  drawPerformer(R, S);
}

return {
  GEOM: { STRING_LENGTH, O0, U, V, W, STRING_V_BRIDGE, STRING_V_NUT, STRING_R, BRIDGE_W, BOW_CONTACT_U, wFB, wStr, vStr },
  frame, draw,
  palette: { skin, skinLight, suit, varnish },
};
})();

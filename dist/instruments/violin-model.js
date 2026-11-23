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
 *       (nut at u = 0.328, body from u = -0.161 to u = +0.195),
 *   v = meters across the strings (E side positive at the bridge),
 *   w = meters out of the top plate (bridge top at w = 0.033).
 * A stopped note at distance d mm from the nut sits at u = 0.328 - d/1000.
 */
window.ViolinModel = (() => {
const norm = a => { const l = Math.hypot(...a) || 1; return a.map(v => v / l); };
const add = (a, b) => a.map((v, i) => v + b[i]);
const mul = (a, s) => a.map(v => v * s);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const sub = (a, b) => a.map((v, i) => v - b[i]);
const dot = (a, b) => a.reduce((s,v,i)=>s+v*b[i],0);

const STRING_LENGTH = 0.328;
const O0 = [0.105, 1.438, -0.205];                    // top plate under the bridge
const U = norm([0.616, -0.03, -0.788]);               // bridge -> scroll
const Wraw = [0.18, 0.95, -0.25];
const Wflat = norm(sub(Wraw, mul(U, Wraw.reduce((s, v, i) => s + v * U[i], 0))));
const Vflat = cross(Wflat, U), plateRoll = Math.PI / 6;
// A violin rests with the E-string edge lower, leaving room underneath
// for the left forearm as the hand moves around the neck heel.
const W = add(mul(Wflat, Math.cos(plateRoll)), mul(Vflat, Math.sin(plateRoll)));
const V = cross(W, U);                                // across the strings
const STRING_V_BRIDGE = [-0.0165, -0.0055, 0.0055, 0.0165]; // G D A E
const STRING_V_NUT = [-0.00825, -0.00275, 0.00275, 0.00825];
const STRING_V_TAIL = [-0.012, -0.004, 0.004, 0.012];
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

// Measured bout/waist stations, tail -> neck. Shape-preserving C1 Hermite
// continuation of the arc-derived stations: only true extrema have zero
// tangents. Flattening every intermediate arc joint caused the wavy outline.
const BODY_SPEC = { length:.356, upper:.1675, middle:.1083, lower:.208,
  rib:.030, topArch:.0155, backArch:.0145, stop:.195, neck:.130,
  board:.270, string:.328, fHole:.075 };
const OUTLINE = [[-.161,.029],[-.072,.104],[-.009,.066],
  [.030,.05415],[.064,.070],[.100,.08375],[.195,.017]];
function bodyWidth(u) {
  let i=0; while(i<OUTLINE.length-2 && u>OUTLINE[i+1][0]) i++;
  const [a,x]=OUTLINE[i], [b,y]=OUTLINE[i+1];
  const secant=j=>(OUTLINE[j+1][1]-OUTLINE[j][1])/(OUTLINE[j+1][0]-OUTLINE[j][0]);
  const tangent=j=>{
    if(j===0)return secant(0);
    if(j===OUTLINE.length-1)return secant(j-1);
    const p=secant(j-1),q=secant(j);if(p*q<=0)return 0;
    const hp=OUTLINE[j][0]-OUTLINE[j-1][0],hq=OUTLINE[j+1][0]-OUTLINE[j][0];
    const wp=2*hq+hp,wq=hq+2*hp;return (wp+wq)/(wp/p+wq/q);
  };
  const h=b-a,t=Math.max(0,Math.min(1,(u-a)/h));
  return (2*t*t*t-3*t*t+1)*x+(t*t*t-2*t*t+t)*h*tangent(i)
    +(-2*t*t*t+3*t*t)*y+(t*t*t-t*t)*h*tangent(i+1);
}
function bodyTop(u,v) {
  const t=Math.max(0,Math.min(1,(u+.161)/.356));
  return -.0155+.0155*Math.sin(Math.PI*t)**.8 * Math.sqrt(Math.max(0,1-(v/bodyWidth(u))**2));
}
// Shared-ring surface and area-weighted normals, following the final cello.
// Coordinates remain local; renderer uploads once and transforms the rigid mesh.
const BODY_MESH = (() => {
  const stations=[...new Set([...Array.from({length:41},(_,i)=>-.161+.356*i/40),...OUTLINE.map(p=>p[0])])].sort((a,b)=>a-b);
  const vertices=[], normals=[], faces=[], samples=[], across=12;
  for(let j=0;j<=across;j++) samples.push(['top',j/across]);
  samples.push(['side',1/3],['side',2/3]);
  for(let j=across;j>=0;j--) samples.push(['back',j/across]);
  samples.push(['left',2/3],['left',1/3]);
  const sides=samples.length;
  for(const u of stations) for(const [kind,s] of samples) {
    const v=bodyWidth(u)*(kind==='side'?1:kind==='left'?-1:2*s-1);
    const arch=(bodyTop(u,v)+.0155)/.0155;
    const w=kind==='top'?-.0155+.0155*arch:kind==='back'?-.0455-.0145*arch:-.0155-.030*s;
    vertices.push([u,v,w]); normals.push([0,0,0]);
  }
  const triangle=(a,b,c)=>{const n=cross(sub(vertices[b],vertices[a]),sub(vertices[c],vertices[a]));faces.push([a,b,c]);for(const k of [a,b,c]) normals[k]=add(normals[k],n);};
  for(let i=0;i<stations.length-1;i++) for(let j=0;j<sides;j++) {
    const a=i*sides+j,b=i*sides+(j+1)%sides,c=b+sides,d=a+sides;
    triangle(a,c,b);triangle(a,d,c);
  }
  const data=[];
  for(const face of faces) for(const k of face) data.push(...vertices[k],...norm(normals[k]));
  for(const i of [0,stations.length-1]) {
    const first=i*sides, centre=[stations[i],0,-.0305], n=[i===0?-1:1,0,0];
    for(let j=0;j<sides;j++) for(const p of [centre,vertices[first+j],vertices[first+(j+1)%sides]]) data.push(...p,...n);
  }
  return new Float32Array(data);
})();
function drawViolin(R, F, activeStrings) {
  const { point } = F;
  if (R.mesh) R.mesh(BODY_MESH, varnish, F);
  else R.oriented('box',point(.017,0,-.0305),[.356,.030,.1083],varnish,0,F.U,F.W,F.V); // diagnostic only
  // 75 mm projected f-hole paths follow the arch (dark inlay, not cutouts).
  for (const s of [-1, 1]) {
    const q=(u,v)=>point(u,s*v,bodyTop(u,s*v)+.0006);
    const pts=[q(-.0375,.044),q(-.030,.037),q(0,.0345),q(.030,.033),q(.0375,.026)];
    for(let i=0;i<4;i++) R.bone(pts[i],pts[i+1],.0018,[.04,.018,.008]);
  }
  // Fingerboard: two boxes along its sloped axis (wFB falls as u grows,
  // so the board's long axis is U tilted by dw/du along W).
  const slope = -0.0125 / STRING_LENGTH;
  const Ufb = norm(add(F.U, mul(F.W, slope)));
  const Wfb = cross(F.V, Ufb);
  const fbSeg = (u0, u1, hw) => {
    const um = (u0 + u1) / 2;
    const base = point(um, 0, wFB(um) - 0.0032);
    R.oriented('box', base, [u1 - u0, 0.0064, hw * 2], fbWood, 0, Ufb, Wfb, F.V);
  };
  fbSeg(0.058, 0.21, 0.0225); fbSeg(0.21, 0.328, 0.0165);
  // Neck under the fingerboard + heel.
  R.oriented('box', point(0.263, 0, wFB(0.263) - 0.0115), [0.130, 0.016, 0.023], varnishDark, 0, Ufb, Wfb, F.V);
  R.oriented('sphere', point(0.195, 0, -0.018), [0.018, 0.024, 0.018], varnishDark, 0, F.U, F.W, F.V);
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
  R.oriented('box', point(0, 0, 0.0165), [0.0042, 0.033, 0.041], maple, 0, F.U, F.W, F.V);
  R.oriented('box', point(-0.004, 0.020, 0.0015), [0.010, 0.0015, 0.006], maple, 0, F.U, F.W, F.V);
  R.oriented('box', point(-0.004, -0.020, 0.0015), [0.010, 0.0015, 0.006], maple, 0, F.U, F.W, F.V);
  const Utp = norm(add(F.U, mul(F.W, 0.10))), Wtp = cross(F.V, Utp);
  R.oriented('box', point(-0.106, 0, 0.0155), [0.085, 0.0076, 0.030], ebony, 0, Utp, Wtp, F.V);
  R.bone(point(-0.1485, 0, 0.012), point(-0.161, 0, -0.0155), 0.0028, ebony);
  R.oriented('sphere', point(-0.152, -0.030, 0.0245), [0.046, 0.0055, 0.031], ebony, 0, F.U, F.W, F.V);
  // Strings: tailpiece -> bridge -> nut -> pegbox. The sounding length of an
  // active string is drawn hot from its stop point (or the nut) to the bridge.
  for (let i = 0; i < 4; i++) {
    const hot = activeStrings.includes(i);
    R.bone(point(-0.145, STRING_V_TAIL[i], 0.021), point(0, STRING_V_BRIDGE[i], BRIDGE_W + 0.0004), STRING_R[i], steel, 0.55);
    R.bone(point(0.330, STRING_V_NUT[i], wStr(0.328)), point(0.352 + i * 0.013, STRING_V_NUT[i] * 0.6, wStr(0.328) - 0.004), STRING_R[i], steel, 0.55);
    if (!hot) R.bone(point(0, STRING_V_BRIDGE[i], BRIDGE_W + 0.0004), point(0.328, STRING_V_NUT[i], wStr(0.328)), STRING_R[i], steel, 0.55);
  }
}

function drawBow(R, bow) {
  R.bone(bow.frogStick, bow.tipStick, 0.0029, bowWood, 0.25);
  R.bone(bow.frogHair, bow.tipHair, 0.0013, bowHair, 0);
  R.ball(bow.tipStick, [0.0045, 0.006, 0.004], [.85, .80, .70], 0.3);
  const frog = window.BowHand.frog('violin', bow.frogStick, bow.axis, bow.down);
  window.BowHand.drawFrog(R, frog, ebony, [.7,.7,.72]);
  R.bone(bow.frogStick.map((v,i)=>v-bow.axis[i]*.025), bow.frogStick.map((v,i)=>v-bow.axis[i]*.037), .0029, [.6,.6,.62]);
  R.ball(bow.frogStick.map((v, i) => v - bow.axis[i] * 0.037), [0.005, 0.005, 0.005], [.6, .6, .62], 0.8);
}

function drawPerformer(R, S, opts) {
  const sw = S.sway, up = S.upperSway || sw;
  const P = p => [p[0] + sw[0], p[1] + sw[1], p[2] + sw[2]];
  const P2 = p => [p[0] + up[0], p[1] + up[1], p[2] + up[2]];
  const female = !!opts?.female;
  const gown = opts?.gown || [.125, .040, .058];
  if (female) {
    R.piece('torso', P([0, 0.52, 0.006]), [.225, .44, .185], gown);
    R.piece('torso', P([0, 0.16, 0.004]), [.275, .14, .225], gown);
    for (const s of [-1, 1]) R.piece('shoe', P([s * 0.095, 0.032, -0.068]), [.046, .032, .126], ebony, 0, Math.PI, 0);
  } else {
    // Legs and shoes (standing — realistic ~7.8-head adult proportions).
    for (const s of [-1, 1]) {
      const hip = P([s * 0.088, 0.94, 0]), knee = P([s * 0.095, 0.49, -0.012]), ankle = P([s * 0.100, 0.068, 0.008]);
      R.segment(hip, knee, 0.056, suit); R.segment(knee, ankle, 0.041, suit);
      R.piece('joint', knee, [.046, .046, .046], suit);
      R.piece('shoe', P([s * 0.100, 0.034, -0.068]), [.050, .036, .132], ebony, 0, Math.PI, 0);
    }
  }
  if(S.expression&&R.withTransform)return R.withTransform(S.expression.frame,()=>drawUpperBody(R,S,P2,up,opts));
  return drawUpperBody(R,S,P2,up,opts);
}
function drawUpperBody(R,S,P2,up,opts){
  const female = !!opts?.female;
  const attire = female ? (opts?.gown || [.125, .040, .058]) : suit;
  const hairCol = female ? [.115, .068, .046] : hairC;
  const pearl = [.94, .90, .82];
  // Torso: realistic proportions + clavicle/shoulder bridges so shoulders never detach.
  const root = P2([0, 1.19, 0.012]);
  R.piece('torso', P2([0, 0.95, 0.010]), [female ? .148 : .164, .105, female ? .108 : .116], attire);
  R.piece('jacket', root, [(female ? .174 : .198) * (1 + S.breath * 0.01), .272, (female ? .116 : .130) * (1 + S.breath * 0.01)], attire, S.lean, S.torsoYaw, S.torsoRoll);
  // Clavicle-to-shoulder bridges seamlessly connect torso to both shoulder sockets at any bow reach
  R.segment(P2([ 0.085, 1.385, 0.002]), S.armL.shoulder, female ? 0.042 : 0.047, attire);
  R.segment(P2([-0.085, 1.385, 0.002]), S.armR.shoulder, female ? 0.042 : 0.047, attire);
  if (!female) R.piece('palm', P2([0, 1.315, -0.118]), [.038, .10, .012], satin, S.lean + 0.06, S.torsoYaw, S.torsoRoll);
  else {
    for (let i = -3; i <= 3; i++) {
      const a = i * 0.28;
      R.ball(P2([Math.sin(a) * 0.048, 1.415 - Math.cos(a) * 0.012, -0.046 * Math.cos(a)]), [.0046, .0046, .0046], pearl, 0.6);
    }
  }
  // Neck + head, tilted down toward the violin, chin over the chin rest.
  const H = S.head;
  const hs = S.headSway || up;
  R.segment([0.012 + hs[0], 1.425 + hs[1], -0.01 + hs[2]], H.pos, female ? 0.030 : 0.037, skin);
  const VHS = female ? [.069, .099, .083] : [.076, .107, .090], VFS = [VHS[0] / .112, VHS[1] / .148, VHS[2] / .128];
  const vs = p => [p[0] * VFS[0], p[1] * VFS[1], p[2] * VFS[2]];
  R.setFaceDetail?.(true);
R.piece('head', H.pos, VHS, skinLight, H.pitch, H.yaw, H.roll);
  const hp = (p) => { // head-local point, same rotation convention as the pianist
    const q = vs(p);
    const cr = Math.cos(H.roll), sr = Math.sin(H.roll), px = q[0] * cr - q[1] * sr, py = q[0] * sr + q[1] * cr;
    const c = Math.cos(H.pitch), s = Math.sin(H.pitch), cy = Math.cos(H.yaw), sy = Math.sin(H.yaw);
    const y = py * c - q[2] * s, z = py * s + q[2] * c;
    return [H.pos[0] + px * cy + z * sy, H.pos[1] + y, H.pos[2] + z * cy - px * sy];
  };
  R.piece('hair', hp([0, 0.004, 0]), vs([.117, .148, .133]), hairCol, H.pitch, H.yaw, H.roll);
  if (female) {
    R.ball(hp([0, -0.022, -0.135]), vs([.054, .052, .048]), hairCol);
    for (const x of [-1, 1]) {
      R.segment(hp([x * 0.098, 0.025, -0.020]), hp([x * 0.096, -0.135, -0.025]), 0.020, hairCol);
      R.ball(hp([x * 0.112, -0.036, -0.005]), [.0055, .0055, .0055], pearl, 0.7);
    }
  }
  R.piece('nose', hp([0, -0.012, 0.122]), vs([.016, .034, .02]), skinLight, H.pitch, H.yaw, H.roll);
  for (const x of [-1, 1]) {
    const ex = x * 0.04;
    R.segment(hp([ex - 0.017, 0.010, 0.113]), hp([ex, 0.005, 0.120]), 0.0018, lash);
    R.segment(hp([ex, 0.005, 0.120]), hp([ex + 0.017, 0.009, 0.114]), 0.0018, lash);
    R.segment(hp([ex - 0.020, 0.042, 0.118]), hp([ex + 0.018, 0.045, 0.118]), 0.0024, hairCol);
    R.piece('joint', hp([x * 0.109, -0.008, -0.008]), vs([.012, .03, .022]), skin, H.pitch, H.yaw, H.roll);
  }
  R.segment(hp([-0.02, -0.074, 0.113]), hp([0.02, -0.072, 0.113]), 0.0034, female ? [.74, .34, .36] : [.62, .38, .33]);
R.setFaceDetail?.(false);
  // Wrist vibrato on sustained stopped notes: rock the whole left hand & wrist
  // smoothly along the string axis U while keeping the fingertip planted!
  const stopNote = S.sounding && S.sounding.find(a => a.finger > 0);
  let vibFrame = null;
  if (stopNote && R.withTransform) {
    const vibAng = Math.sin(S.time * Math.PI * 2 * 5.8) * 0.036;
    const pivot = S.frame.stringPoint(stopNote.string, stopNote.distMm);
    // Rotate about V (across fingerboard) so the palm & wrist rock along U (string axis)
    const c = Math.cos(vibAng), s = Math.sin(vibAng);
    const rotV = v => {
      const d = v[0] * V[0] + v[1] * V[1] + v[2] * V[2];
      const cr = [V[1] * v[2] - V[2] * v[1], V[2] * v[0] - V[0] * v[2], V[0] * v[1] - V[1] * v[0]];
      return [v[0] * c + cr[0] * s + V[0] * d * (1 - c), v[1] * c + cr[1] * s + V[1] * d * (1 - c), v[2] * c + cr[2] * s + V[2] * d * (1 - c)];
    };
    const rP = rotV(pivot);
    const vf = { U: rotV([1, 0, 0]), V: rotV([0, 1, 0]), W: rotV([0, 0, 1]), O: [pivot[0] - rP[0], pivot[1] - rP[1], pivot[2] - rP[2]] };
    if (S.expression && S.expression.frame) {
      const A = S.expression.frame;
      const xv = q => [A.U[0]*q[0]+A.V[0]*q[1]+A.W[0]*q[2], A.U[1]*q[0]+A.V[1]*q[1]+A.W[1]*q[2], A.U[2]*q[0]+A.V[2]*q[1]+A.W[2]*q[2]];
      vibFrame = { U: xv(vf.U), V: xv(vf.V), W: xv(vf.W), O: add(A.O, xv(vf.O)) };
    } else vibFrame = vf;
    vibFrame._local = vf;
  }
  // Right (bowing) arm + hand
  window.BowHand.drawArm(R, S.armR, S.handR, { suit: attire, skin, shirt: female ? attire : shirt });
  window.BowHand.draw(R, S.handR, skin, skinLight);
  // Left (fingering) arm + hand with whole-wrist vibrato rock
  if (vibFrame) {
    const lf = vibFrame._local;
    const rW = [lf.U[0] * S.armL.wrist[0] + lf.V[0] * S.armL.wrist[1] + lf.W[0] * S.armL.wrist[2] + lf.O[0],
                lf.U[1] * S.armL.wrist[0] + lf.V[1] * S.armL.wrist[1] + lf.W[1] * S.armL.wrist[2] + lf.O[1],
                lf.U[2] * S.armL.wrist[0] + lf.V[2] * S.armL.wrist[1] + lf.W[2] * S.armL.wrist[2] + lf.O[2]];
    window.BowHand.drawArm(R, { ...S.armL, wrist: rW }, S.handL, { suit: attire, skin, shirt: female ? attire : shirt });
    R.withTransform(vibFrame, () => drawLeftHand(R, S.handL));
  } else {
    window.BowHand.drawArm(R, S.armL, S.handL, { suit: attire, skin, shirt: female ? attire : shirt });
    drawLeftHand(R, S.handL);
  }
}

// The wrist is oval, with its broad axis across the palm. Circular sleeve
// and wrist bridges made the arm thicker than the hand and forced false
// collision-avoidance bends near the violin's upper bout.
function drawForearm(R,arm,hand){window.BowHand.drawForearm(R,arm,hand,{suit,skin,shirt});}

// Shared by the scene renderer and the actual-triangle clearance audit.
const fingerSkins=new WeakMap(),fingerBoard={O:O0,U,V,W,top:wFB,neck:true};
function drawLeftHand(R,H) {
  const natural=H.model==='natural';
  if(natural&&window.HandSurface&&R.dynamicMesh){
    let state=fingerSkins.get(R);if(!state){state=window.ViolinFingerSkin.create(false,true,true,true);state.thumb.radii=window.BowHand.dimensions.thumbRadii;state.thumb.skinBaseT=.95;fingerSkins.set(R,state);}
    R.dynamicMesh('violin-left-fingers',window.ViolinFingerSkin.update(state,H,fingerBoard),skin);return;
  }
  if(natural&&H.wrist)R.oriented('joint',H.wrist,[.022,.018,.016],skin,0,...H.basis);
  if(H.basis)R.oriented('palm',H.palmPos,[.038,.035,.013],skin,0,...H.basis);
  else R.piece('palm',H.palmPos,[.042,.013,.038],skin,H.pitch,H.yaw,H.roll);
  if(natural&&window.ViolinFingerSkin&&R.dynamicMesh){
    let state=fingerSkins.get(R);if(!state){state=window.ViolinFingerSkin.create();fingerSkins.set(R,state);}
    R.dynamicMesh('violin-left-fingers',window.ViolinFingerSkin.update(state,H,fingerBoard),skinLight);
  }else for(const f of H.fingers){
    for(let j=0;j<3;j++){
      R.segment(f.points[j],f.points[j+1],(natural?(j===2?.004:.65*(.0105-j*.0016)):(.0105-j*.0016)),skinLight,natural?(j===2?'fingertip':'bodyLimb'):'limb');
      if(natural)R.oriented('rod',f.points[j],j?[.0065,.00585,.0065]:[.008,.008,.0045],skinLight,0,...H.basis);
      else if(j>0)R.piece('joint',f.points[j],[.010,.009,.010],skinLight);
    }
    if(natural){
      const d=norm(sub(f.points[3],f.points[2])),pad=sub(f.points[3],mul(d,.0038)),delta=sub(pad,O0);
      const u=dot(delta,U),v=dot(delta,V),w=dot(delta,W),width=u<.210?.0225:.0165;
      // The soft pad flattens against the board while the fingertip's bone
      // and contact coordinates remain those of the shared FK skeleton.
      if(u>=.058&&u<=.328&&Math.abs(v)<width+.0038&&dot(sub(f.points[3],O0),W)>=wFB(u)-.0001){const floor=wFB(u)+.0021;if(w<floor){const lift=mul(W,floor-w);for(let i=0;i<3;i++)pad[i]+=lift[i];}}
      R.oriented('rod',pad,[.0038,.0038,.0020],skinLight,0,U,V,W);
    }
    else R.ball(f.points[3],[.0075,.0075,.0095],skinLight);
  }
  for(let j=0;j<H.thumb.length-1;j++)R.segment(H.thumb[j],H.thumb[j+1],natural?[.009,.007,.007][j]:.012,skin);
  if(natural)for(let j=0;j<4;j++){const r=[.010,.009,H.thumbPadRadius||.008,.007][j];R.oriented('rod',H.thumb[j],[r,r,r],skin,0,...H.basis);}
}

function draw(R, S, opts) {
  const instrument=()=>{
  drawViolin(R, S.frame, S.activeStrings);
  // Hot speaking lengths for sounding strings (stop point -> bridge).
  for (const a of S.sounding) {
    const from = a.finger > 0 ? S.frame.stringPoint(a.string, a.distMm) : S.frame.point(0.328, STRING_V_NUT[a.string], wStr(0.328));
    R.bone(from, S.frame.point(0, STRING_V_BRIDGE[a.string], BRIDGE_W + 0.0004), STRING_R[a.string] + 0.0004, steelHot, 0.35);
  }
  drawBow(R, S.bow);
  };
  if(S.expression&&R.withTransform)R.withTransform(S.expression.frame,instrument);else instrument();
  drawPerformer(R, S, opts);
}

return {
  GEOM: { STRING_LENGTH, O0, U, V, W, STRING_V_BRIDGE, STRING_V_NUT, STRING_R, BRIDGE_W, BOW_CONTACT_U, wFB, wStr, vStr },
  frame, draw, drawViolin, drawLeftHand, drawForearm, BODY_SPEC, OUTLINE, BODY_MESH, bodyWidth, bodyTop,
  palette: { skin, skinLight, suit, varnish },
};
})();

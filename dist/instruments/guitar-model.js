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

// A continuous top/back/rib surface replaces overlapping ellipsoid slices.
// Dimensions follow a 650 mm full-size classical guitar (Yamaha CG reference).
const BODY_SPEC=GM.BODY_SPEC,OUTLINE=GM.BODY_OUTLINE,bodyWidth=GM.bodyWidth;
const BODY_MESH=(()=>{
 const stations=[...new Set([...Array.from({length:57},(_,i)=>.325+.490*i/56),...OUTLINE.map(p=>p[0])])].sort((a,b)=>a-b),edge=stations.map(d=>[d,bodyWidth(d)]).concat(stations.slice(1,-1).reverse().map(d=>[d,-bodyWidth(d)]));
 const top=[],back=[],ribs=[],P=(v,z)=>add(NUT,add(mul(u,-v[0]),add(mul(w,v[1]),mul(n,z)))),C=P([.56,0],-.006),B=P([.56,0],-.105);
 const sub=(a,b)=>a.map((v,i)=>v-b[i]),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
 const tri=(out,a,b,c,N)=>{if(dot(cross(sub(b,a),sub(c,a)),N)<0)[b,c]=[c,b];for(const p of [a,b,c])out.push(...p,...N);};
 const normals=edge.map((a,i)=>{const prev=edge[(i+edge.length-1)%edge.length],next=edge[(i+1)%edge.length],t=sub(P(next,0),P(prev,0));let N=cross(t,n),outside=sub(P(a,0),P([.56,0],0));if(dot(N,outside)<0)N=N.map(v=>-v);return N.map(v=>v/Math.hypot(...N));});
 for(let i=0;i<edge.length;i++){
  const j=(i+1)%edge.length,a=P(edge[i],-.006),b=P(edge[j],-.006),c=P(edge[j],-.105),d=P(edge[i],-.105);tri(top,C,a,b,n);tri(back,B,d,c,n.map(v=>-v));
  let order=[0,1,2,0,2,3],ps=[a,b,c,d];if(dot(cross(sub(b,a),sub(c,a)),normals[i])<0)order=[0,2,1,0,3,2];for(const k of order)ribs.push(...ps[k],...normals[k===0||k===3?i:j]);
 }return {top:new Float32Array(top),back:new Float32Array(back),ribs:new Float32Array(ribs)};
})();

// True tapered fingerboard: 52 mm at the nut, 62 mm at fret 12,
// 64 mm at its body end. The old tail loft narrowed its nut to about 30 mm.
const FRETBOARD_MESH=(()=>{
 const data=[],point=(d,s,z)=>add(NUT,add(mul(u,-d),add(mul(w,s*GM.fretboardHalfWidth(d)),mul(n,z)))),centre=point(GM.BOARD_END/2,0,-.003);
 const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],sub=(a,b)=>a.map((v,i)=>v-b[i]);
 const face=(a,b,c,d)=>{let N=cross(sub(b,a),sub(c,a));if(N.reduce((s,v,i)=>s+v*(a[i]-centre[i]),0)<0){[b,d]=[d,b];N=N.map(v=>-v);}const l=Math.hypot(...N);N=N.map(v=>v/l);for(const p of [a,b,c,a,c,d])data.push(...p,...N);};
 const stations=[0,.325,GM.BOARD_END];for(let i=0;i<2;i++){
  const a=stations[i],b=stations[i+1],p=[point(a,-1,-.006),point(a,1,-.006),point(b,1,-.006),point(b,-1,-.006),point(a,-1,0),point(a,1,0),point(b,1,0),point(b,-1,0)];
  for(const f of [[4,5,6,7],[0,1,2,3],[0,3,7,4],[1,2,6,5],...(i===0?[[0,1,5,4]]:[]),...(i===1?[[3,2,6,7]]:[])])face(...f.map(j=>p[j]));
 }return new Float32Array(data);
})();

// Elliptical shaft: 21 mm total depth at the nut, 23 mm at fret 12,
// including the 6 mm ebony board. A short heel joins it to the body.
const NECK_MESH=(()=>{
 const sections=[-.05,0,.10,.20,.325,GM.NECK_END],sides=16,pts=[],normals=[],data=[],sub=(a,b)=>a.map((v,i)=>v-b[i]),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
 for(const d of sections){const q=GM.neckSection(d);for(let j=0;j<sides;j++){const a=j*Math.PI*2/sides,c=Math.cos(a),s=Math.sin(a);pts.push(add(NUT,add(mul(u,-d),add(mul(w,q.width*c),mul(n,q.centre+q.depth*s)))));let N=add(mul(w,c/q.width),mul(n,s/q.depth));const l=Math.hypot(...N);normals.push(N.map(v=>v/l));}}
 const tri=(ids,N)=>{const ps=ids.map(i=>pts[i]);if(dot(cross(sub(ps[1],ps[0]),sub(ps[2],ps[0])),N||normals[ids[0]])<0)[ids[1],ids[2]]=[ids[2],ids[1]];for(const i of ids)data.push(...pts[i],...(N||normals[i]));};
 for(let r=0;r<sections.length-1;r++)for(let j=0;j<sides;j++){const a=r*sides+j,b=a+sides,c=r*sides+(j+1)%sides,d=c+sides;tri([a,b,d]);tri([a,d,c]);}
 for(const [r,N] of [[0,u],[sections.length-1,mul(u,-1)]]){const d=sections[r],q=GM.neckSection(d),c=pts.length;pts.push(add(NUT,add(mul(u,-d),mul(n,q.centre))));for(let j=0;j<sides;j++)tri([c,r*sides+j,r*sides+(j+1)%sides],N);}
 return new Float32Array(data);
})();

function drawGuitar(R, pose, t) {
  const sp = (s, d, lift) => GM.stringPoint(s, d, lift);
  // Physical body frame, joined at fret 12 with the bridge at 650 mm.
  const RX = Math.atan2(u[2], -n[2]), RZ = Math.atan2(w[1], w[0]);
  if(R.mesh){R.mesh(BODY_MESH.top,spruce);R.mesh(BODY_MESH.back,mahogany);R.mesh(BODY_MESH.ribs,mahogany);}
  else for(const [part,color] of [['top',spruce],['back',mahogany],['ribs',mahogany]])R.dynamicMesh('guitar-body-'+part,BODY_MESH[part],color);
  // Soundhole + rosette (hole above the waist, clear of the 20th-fret extension; the disc
  // sits just above the top plate, below the strings).
  const SH = sp(3.5,.495,BODY_SPEC.top+.0005);
  R.piece('sphere', SH, [.042, .042, .0003], [.02, .015, .012], RX, 0, RZ);
  for (let k = 0; k < 28; k++) {
    const a0 = k / 28 * Math.PI * 2, a1 = (k + 1) / 28 * Math.PI * 2;
    const p0 = add(SH, add(mul(u, Math.cos(a0) * .050), mul(w, Math.sin(a0) * .050)));
    const p1 = add(SH, add(mul(u, Math.cos(a1) * .050), mul(w, Math.sin(a1) * .050)));
    R.bone(p0, p1, .0016, k % 2 ? [.55, .30, .16] : [.85, .68, .45]);
  }
  // Fretboard (tail loft = flat strip in the renderer's segment frame,
  // which GuitarMotion's w/n were built to match) + neck behind it.
  if(R.mesh)R.mesh(FRETBOARD_MESH,fretboardC);
  else R.dynamicMesh('guitar-fretboard',FRETBOARD_MESH,fretboardC);
  if(R.mesh)R.mesh(NECK_MESH,darkWood);else R.dynamicMesh('guitar-neck',NECK_MESH,darkWood);
  // Headstock + tuners.
  const hsA = add(NUT, add(mul(u, 0.004), mul(n, -0.008))), hsB = add(NUT, add(mul(u, 0.185), mul(n, -0.010)));
  R.segment(hsA, hsB, .031, darkWood, 'tail');
  for (let k = 0; k < 3; k++) for (const side of [-1, 1]) {
    const c = add(NUT, add(mul(u, 0.045 + k * 0.052), add(mul(w, side * 0.036), mul(n, -0.010))));
    R.ball(c, [.007, .007, .007], brass, .7);
    R.segment(add(c, mul(w, -side * 0.006)), add(c, mul(w, side * 0.004)), .0028, steel, 'limb');
  }
  // Frets, markers, nut.
  for (let f = 1; f <= GM.FRETS; f++) {
    const d = GM.fretDist(f);
    R.bone(sp(1, d, 0.0012), sp(6, d, 0.0012), .0009, steel, .8);
    if ([5, 7, 9, 15, 17].includes(f)) R.ball(sp(3.5, (GM.fretDist(f) + GM.fretDist(f - 1)) / 2, 0.0012), [.0028, .0028, .0028], boneC);
    if (f === 12) for (const s of [2.5, 4.5]) R.ball(sp(s, (GM.fretDist(f) + GM.fretDist(f - 1)) / 2, 0.0012), [.0028, .0028, .0028], boneC);
  }
  R.bone(add(NUT,add(mul(w,-.026),mul(n,.002))),add(NUT,add(mul(w,.026),mul(n,.002))),.0018,boneC);
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
  R.setFaceDetail?.(true);
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
R.setFaceDetail?.(false);
  // Arms (exact two-bone chains from the pose).
  for (const arm of pose.arms) {
    R.segment(arm.shoulder, arm.elbow, .047, suit);
    const v=arm.elbow.map((v,i)=>v-arm.wrist[i]),l=Math.hypot(...v),cuff=arm.wrist.map((v,i)=>v+0.040* (arm.elbow[i]-v)/l);
    R.segment(arm.elbow,cuff,.031,suit);R.segment(cuff,arm.wrist,.021,shirt);
    R.ball(arm.elbow, [.042, .042, .042], suit);
  }
  if(pose.hands){window.GuitarHandSkin.draw(R,pose.hands,skin);}
  else {
    R.ball(pose.palm,[.046,.030,.052],skin);
    for(const f of pose.lhFingers)fingerDraw(R,f,RADII[f.digit]);fingerDraw(R,pose.lhThumb,RADII[0]);
    const rhPalm=add(GM.stringPoint(3,GM.PLUCK_D,.058),mul(w,.002));R.ball(rhPalm,[.044,.028,.050],skin);
    for(const name of ['p','i','m','a'])fingerDraw(R,pose.rhFingers[name],RADII[pose.rhFingers[name].digit]);
  }
}

function drawStage(R) {
  R.box([0, -.065, .6], [24, .12, 24], [.065, .055, .05]);
  R.ball([0, -.025, .4], [4.3, .11, 4.3], [.105, .088, .067]);
  for (let i = 0; i < 22; i++) R.box([0, .002, -3.5 + i * .35], [7.8, .005, .014], [.048, .042, .036]);
  for (let i = -12; i <= 12; i++) { R.box([i * .48, 1.8, 5.2], [.07, 3.6, .15], [.105, .089, .064], .1); R.box([i * .48, 1.8, 5.31], [.27, 3.6, .06], [.035, .035, .04]); }
  for (let i = 0; i < 64; i++) { const a = i * Math.PI / 32, b = (i + 1) * Math.PI / 32; R.bone([4 * Math.sin(a), .006, .4 + 4 * Math.cos(a)], [4 * Math.sin(b), .006, .4 + 4 * Math.cos(b)], .008, brass); }
}

function drawScene(R, pose, t) { drawStage(R); drawGuitar(R, pose, t); drawPerformer(R, pose, t); }
return { NECK_MESH,BODY_SPEC,BODY_MESH,bodyWidth,FRETBOARD_MESH, drawGuitar, drawPerformer, drawStage, drawScene, headFrame, POSTURE, colors: { spruce, mahogany, skin, suit } };
})();

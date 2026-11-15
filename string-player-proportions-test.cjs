'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');global.window=globalThis;
for(const n of ['bow-hand','hand-surface','violin-skin','violin-fingering','violin-songs','violin-model','violin-hand','violin-hand-frames','violin-motion','cello-fingering','cello-model','cello-motion','cello-songs','cello-poses'])vm.runInThisContext(fs.readFileSync('dist/instruments/'+n+'.js','utf8'),{filename:n});
assert.deepEqual(BowHand.dimensions.thumb,[.046,.034,.027*.6],'Thumb distal must retain 60% of its former length');
const D=BowHand.dimensions,dist=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
assert.deepEqual(ViolinMotion.FINGER_LENGTHS,D.fingers);assert.deepEqual(ViolinMotion.NH.THUMB_LEN,D.thumb);assert.deepEqual(CelloMotion.NH.THUMB_LEN,D.thumb);assert.deepEqual(CelloMotion.SKELETON.THUMB_LEN,D.thumb);
for(let f=0;f<4;f++){assert.deepEqual(CelloMotion.SKELETON.FINGER_LEN[f+1],D.fingers[f]);for(let j=0;j<3;j++)assert(Math.abs(CelloMotion.SKELETON.FINGER_R[f+1][j]-D.radii[f][j])<1e-12);}
const report={fingerLengthsMm:D.fingers.map(a=>a.reduce((n,v)=>n+v,0)*1000),fingerRadiiMm:D.radii.map(a=>a.map(v=>v*1000)),thumbBonesMm:D.thumb.map(v=>v*1000),thumbRadiiMm:D.thumbRadii.map(v=>v*1000),armReductionPercent:8,samples:0,maxBoneError:0,maxShoulderReach:0,maxSkinRadiusError:0,arms:{},skinVerticesTested:0,maxCelloSkinWoodDepth:0,celloClearancePoses:0};
const celloSkin=ViolinFingerSkin.create(false,true,true,true);let celloVertices;
function bones(points,lengths){for(let j=0;j<3;j++){const e=Math.abs(dist(points[j],points[j+1])-lengths[j]);report.maxBoneError=Math.max(report.maxBoneError,e);assert(e<1e-6,'Finger/thumb bone length differs from cello reference');}}
function skinRadii(H,bow){const state=ViolinFingerSkin.create(bow,true,!bow,true);ViolinFingerSkin.update(state,H);for(let f=0;f<4;f++){
 const index=(bow?f+1:f)*98+16,centre=[0,1,2].map(k=>Array.from({length:8},(_,j)=>state.positions[(index+j)*3+k]).reduce((a,b)=>a+b,0)/8);
 const expected=D.radii[f][0]+.45*(D.radii[f][1]-D.radii[f][0]);for(let j=0;j<8;j++){const e=Math.abs(dist(Array.from(state.positions.subarray((index+j)*3,(index+j)*3+3)),centre)-expected);report.maxSkinRadiusError=Math.max(report.maxSkinRadiusError,e);assert(e<1e-6,'Rendered finger thickness differs from cello reference');report.skinVerticesTested++;}
}assert(state.data.every(Number.isFinite));}
for(const type of ['violin','cello']){
 const lengths=BowHand.armLengths(type);report.arms[type]=lengths.map(v=>v*1000);
 for(const song of type==='violin'?VIOLIN_SONGS:CELLO_SONGS){const plan=type==='violin'?ViolinMotion.plan(song):song;
 for(let i=0;i<=100;i++){
 const S=type==='violin'?ViolinMotion.at(plan,song.duration*i/100):CelloMotion.poseCached(song,song.duration*i/100),L=type==='violin'?S.handL:null,R=type==='violin'?S.handR:S.bowHand;
 for(let f=0;f<4;f++){bones(type==='violin'?L.fingers[f].points:S.fingers[f+1].points,D.fingers[f]);bones(R.fingers[f].points,D.fingers[f]);}
 bones(type==='violin'?L.thumb:S.thumb.points,D.thumb);bones(R.thumb.points,D.thumb);
 for(const A of type==='violin'?[S.armL,S.armR]:[S.leftArm,S.rightArm]){assert(Math.abs(dist(A.shoulder,A.elbow)-lengths[0])<1e-8);assert(Math.abs(dist(A.elbow,A.wrist)-lengths[1])<1e-8);report.maxShoulderReach=Math.max(report.maxShoulderReach,A.shoulderReach||0);}
 if(type==='cello'){
 ViolinFingerSkin.update(celloSkin,CelloMotion.surfaceHand(S),undefined,CelloMotion.conformHandSurface);if(!celloVertices)celloVertices=[...new Set(celloSkin.indices)];
 for(const v of celloVertices){const p=Array.from(celloSkin.positions.subarray(v*3,v*3+3)),depth=-Math.min(CelloMotion.NH.sdInst(CelloMotion.NH.toNeck(p)),CelloMotion.NH.sdBody(p));report.maxCelloSkinWoodDepth=Math.max(report.maxCelloSkinWoodDepth,depth);assert(depth<.001,'Cello surface intersects wood');}report.celloClearancePoses++;
 }
 if(i%25===0){skinRadii(type==='violin'?L:CelloMotion.surfaceHand(S),false);skinRadii(R,true);}report.samples++;
 }}
}
assert(report.maxShoulderReach<.07,'Short arms require excessive shoulder displacement');
// Both arms use identical meshes, sleeve sections and cuff dimensions.
const A={shoulder:[.2,1.4,0],elbow:[.3,1.15,-.1],wrist:[.3,1,-.3]},H={basis:[[1,0,0],[0,1,0],[0,0,1]]},styles=[];
for(const sign of [-1,1]){const calls=[],mirror=p=>[sign*p[0],p[1],p[2]],R={oriented:(shape,p,size)=>calls.push([shape,size]),segment:(a,b,r,c,shape)=>calls.push([shape,r,dist(a,b)])};BowHand.drawArm(R,Object.fromEntries(Object.entries(A).map(([k,p])=>[k,mirror(p)])),{basis:H.basis.map(mirror)},{suit:[0,0,0],skin:[1,1,1],shirt:[1,1,1]});styles.push(calls);}
assert.deepEqual(styles[0],styles[1]);report.symmetricSleeves=true;assert.equal(ViolinMotion.NH.stats().solves,0);assert.equal(CelloMotion.NH.stats().solves,0);report.runtimeFits={violin:0,cello:0};console.log(JSON.stringify(report,null,2));

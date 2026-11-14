'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),crypto=require('node:crypto');global.window=globalThis;
for(const n of ['bow-hand','violin-fingering','violin-songs','hand-surface','violin-skin','violin-model','violin-hand','violin-hand-frames','violin-motion','violin-gl'])vm.runInThisContext(fs.readFileSync('dist/instruments/'+n+'.js','utf8'),{filename:n});
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),sub=(a,b)=>a.map((v,i)=>v-b[i]),dist=(a,b)=>Math.hypot(...sub(a,b));
const transform=(F,p)=>F.O.map((v,i)=>v+F.U[i]*p[0]+F.V[i]*p[1]+F.W[i]*p[2]);
const sourceHashes=JSON.parse(fs.readFileSync('docs/verification/violin-expression/source-notes.json'));
for(const song of VIOLIN_SONGS)assert.equal(crypto.createHash('sha256').update(JSON.stringify(song.notes)).digest('hex'),sourceHashes[song.id],'Source performance changed: '+song.id);
const air=VIOLIN_SONGS.find(s=>s.id==='air'),airPlan=ViolinMotion.plan(air);assert.equal(air.keySignature.fifths,2);assert.equal(air.forceString,undefined,'The D-major original must not use the transposed G-string arrangement constraint');assert(Math.max(...airPlan.notes.map(n=>n.position))<=5,'Air takes unnecessary very high positions');
const report={sourcePerformancesPreserved:4,air:{strings:[...new Set(airPlan.notes.map(n=>n.string))],maxPosition:Math.max(...airPlan.notes.map(n=>n.position))},samples:0,maxWristAngleDegrees:0,minRightElbowOutward:Infinity,minLeftElbowSide:Infinity,maxArmError:0,maxWorldContactError:0,maxExpressionStep:0,runtimeFits:0,songs:[]};
for(const song of VIOLIN_SONGS){
 const P=ViolinMotion.plan(song);assert(ViolinMotion.NH.available(P),'Missing precompiled hand: '+song.id);let previous=null;const origins=[];
 const times=new Set([0,song.duration]);for(let t=0;t<song.duration;t+=1/30)times.add(t);
 for(const n of P.notes)for(const dt of [-.001,0,.001])times.add(Math.max(0,Math.min(song.duration,n.t0+dt)));
 for(const key of VIOLIN_HAND_FRAMES.songs[song.id].keys)for(const dt of [-.000001,0,.000001])times.add(Math.max(0,Math.min(song.duration,key.t+dt)));
 for(const t of [...times].sort((a,b)=>a-b)){
  const S=ViolinMotion.at(P,t),F=S.expression.frame,L=S.handL,B=L.basis,A=S.armL,fore=sub(A.wrist,A.elbow),angle=Math.acos(Math.max(-1,Math.min(1,dot(fore,B[1])/Math.hypot(...fore))))*180/Math.PI;
  report.maxWristAngleDegrees=Math.max(report.maxWristAngleDegrees,angle);
  assert(angle<85,`${song.id} ${t}: folded-back left wrist (${angle})`);
  assert(dot(B[0],ViolinModel.GEOM.U)>0,'Thumb/index side turned away from scroll');
  const leftOut=S.armL.elbow[0];report.minLeftElbowSide=Math.min(report.minLeftElbowSide,leftOut);assert(leftOut>.075,'Left elbow crosses the torso');
  const elbow=S.armR.shoulder[0]-S.armR.elbow[0];report.minRightElbowOutward=Math.min(report.minRightElbowOutward,elbow);assert(elbow>.075,'Bow elbow points inward');
  for(const arm of [S.armL,S.armR]){report.maxArmError=Math.max(report.maxArmError,arm.error);assert(arm.error<1e-6);assert(Math.abs(dist(arm.shoulder,arm.elbow)-.36)<1e-8);assert(Math.abs(dist(arm.wrist,arm.elbow)-.34)<1e-8);}
  for(const axis of [F.U,F.V,F.W])assert(Math.abs(Math.hypot(...axis)-1)<1e-10);assert(Math.abs(dot(F.U,F.V))+Math.abs(dot(F.U,F.W))+Math.abs(dot(F.V,F.W))<1e-10);
  // The parent hierarchy must preserve musical contact and bone distances.
  for(let f=0;f<4;f++)if(S.debug.contacts[f].contact){const e=dist(transform(F,L.fingers[f].points[3]),transform(F,S.debug.contacts[f].target));report.maxWorldContactError=Math.max(report.maxWorldContactError,e);assert(e<.00005,`${song.id} ${t} finger ${f}: contact error ${e}`);}
  const axis=S.bow.axis,delta=sub(S.bow.contact,S.bow.frogHair),projected=S.bow.frogHair.map((v,i)=>v+axis[i]*dot(delta,axis));assert(dist(transform(F,projected),transform(F,S.bow.contact))<1e-9,'Body motion separates bow from strings');
  origins.push(transform(F,ViolinModel.GEOM.O0));
  if(previous)report.maxExpressionStep=Math.max(report.maxExpressionStep,dist(F.O,previous.O));previous=F;report.samples++;
 }
 assert.equal(P.expressionTrack.length,Math.ceil(song.duration/(1/30))+1,'Seeking appended expression history');
 const range=Math.max(...origins.map(p=>dist(p,origins[0])));assert(range>.012,'Upper body remains static');report.songs.push({id:song.id,instrumentTravelMetres:range,expressionKeys:P.expressionTrack.length});
}
assert(report.maxExpressionStep<.01,'Body motion jumps between frames');assert.equal(ViolinMotion.NH.stats().solves,0);
// Photo reference: the G-string bow arm is higher than the E-string arm.
// Compare identical bow reach and energy so repertoire differences cannot hide
// an inverted string-level mapping.
report.bowLevelHeights=[];
for(let string=0;string<4;string++){
 const P={song:{duration:10},notes:[{i:0,t0:0,t1:10,dur:10,pitch:69,vel:80,string,finger:0,distMm:0,position:1,bow:'down',bowId:0,bowFrom:.5,bowTo:.5}],keys:[],envelope:Array.from({length:101},()=>({energy:.5})),fingerNotes:{1:[],2:[],3:[],4:[]},harmonics:new Set(),slides:new Map()};
 report.bowLevelHeights.push(ViolinMotion.atLegacy(P,5).armR.elbow[1]);
}
for(let i=1;i<4;i++)assert(report.bowLevelHeights[i-1]>report.bowLevelHeights[i],'Bow elbow string levels are reversed');
// Exercise real draw matrices for static geometry and dynamic skin, then ensure
// the parent is restored even when a draw callback throws.
let matrix;const gl={VERTEX_SHADER:1,FRAGMENT_SHADER:2,COMPILE_STATUS:3,LINK_STATUS:4,ARRAY_BUFFER:5,STATIC_DRAW:6,DYNAMIC_DRAW:9,FLOAT:7,TRIANGLES:8,createShader:()=>({}),shaderSource(){},compileShader(){},getShaderParameter:()=>true,createProgram:()=>({}),attachShader(){},linkProgram(){},getProgramParameter:()=>true,useProgram(){},getAttribLocation:()=>0,getUniformLocation:(_,n)=>n,createBuffer:()=>({}),bindBuffer(){},bufferData(){},bufferSubData(){},enableVertexAttribArray(){},vertexAttribPointer(){},uniformMatrix4fv(n,_,m){if(n==='uM')matrix=Array.from(m);},uniformMatrix3fv(){},uniform3fv(){},uniform1f(){},drawArrays(){}};
const R=RecitalGL.create({getContext:()=>gl}),P=ViolinMotion.plan(VIOLIN_SONGS[0]),F=ViolinMotion.at(P,13.75).expression.frame,p=[.2,1.3,-.1];
R.withTransform(F,()=>R.oriented('rod',p,[1,1,1],[0,0,0],0,[1,0,0],[0,1,0],[0,0,1]));
const expected=transform(F,p);assert(dist([-matrix[12],matrix[13],matrix[14]],expected)<1e-6);
R.withTransform(F,()=>R.dynamicMesh('test',new Float32Array([0,0,0,0,1,0]),[0,0,0]));assert(dist([-matrix[12],matrix[13],matrix[14]],F.O)<1e-6);
assert.throws(()=>R.withTransform(F,()=>{throw Error('restore');}));R.oriented('rod',p,[1,1,1],[0,0,0],0,[1,0,0],[0,1,0],[0,0,1]);assert(dist([-matrix[12],matrix[13],matrix[14]],p)<1e-6);
report.parentTransformVerified=true;console.log(JSON.stringify(report,null,2));

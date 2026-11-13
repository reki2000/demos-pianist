'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');global.window=globalThis;
for(const n of ['bow-hand','violin-fingering','violin-songs','hand-surface','violin-skin','violin-model','violin-hand','violin-hand-frames','violin-motion'])vm.runInThisContext(fs.readFileSync(`dist/instruments/${n}.js`,'utf8'),{filename:n});
const N=ViolinMotion.NH,dist=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i])),report={fingerLengthScale:.8,fingerLengthsMm:ViolinMotion.FINGER_LENGTHS.map(f=>f.reduce((a,b)=>a+b,0)*1000),thumbLengthsMm:N.THUMB_LEN.map(v=>v*1000),samples:0,maxContactError:0,maxBoneError:0,maxRootError:0,maxWristAngle:0};
// The selected B proportion is a persistent product requirement.
for(const [f,total] of [.0752,.0848,.0792,.0632].entries())assert(Math.abs(ViolinMotion.FINGER_LENGTHS[f].reduce((a,b)=>a+b,0)-total)<1e-10,'Selected 20% shortening changed');
assert.deepEqual(N.THUMB_LEN,[.042,.032,.026],'Thumb length changed');
// Planning X is reflected by RecitalGL. A left radial/distal/dorsal
// frame must therefore have negative planning determinant and positive drawn
// determinant; the former rig incorrectly had the right hand's chirality.
const dot=(a,b)=>a.reduce((v,x,i)=>v+x*b[i],0),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],drawn=p=>[-p[0],p[1],p[2]];
const G=ViolinModel.GEOM,F=ViolinModel.frame(),E=F.contactPoint(3,0),Gstring=F.contactPoint(0,0);
assert(dot(drawn(E.map((v,i)=>v-Gstring[i])),cross(drawn(G.U),drawn(G.W)))>0,'E string must be on the player right of G');
report.minDrawnLeftDeterminant=1;
for(const song of VIOLIN_SONGS){
 const P=ViolinMotion.plan(song);assert(N.available(P),'Missing compiled left hand: '+song.id);
 const times=new Set([0,song.duration]);for(let t=0;t<song.duration;t+=.1)times.add(t);for(const n of P.notes)for(const dt of [-.001,0,.001])times.add(Math.max(0,Math.min(song.duration,n.t0+dt)));
 for(const t of [...times].sort((a,b)=>a-b)){
  const S=ViolinMotion.at(P,t),L=S.handL,old=ViolinMotion.atLegacy(P,t);assert.equal(L.model,'natural');assert(L.fingers.flatMap(f=>f.points.flat()).every(Number.isFinite));
  assert.deepEqual(S.handR,old.handR,'Left hand changed bow hold');assert.deepEqual(S.armR,old.armR);assert.deepEqual(S.head,old.head);
  assert(dist(L.wrist,S.armL.wrist)<1e-9,'Wrist disconnected');
  assert(Math.abs(dist(S.armL.shoulder,S.armL.elbow)-.36)<1e-7&&Math.abs(dist(S.armL.elbow,S.armL.wrist)-.34)<1e-7,'Left arm stretched');
  const determinant=dot(cross(L.basis[0],L.basis[1]),L.basis[2]);
  assert(determinant<-.999999,'Left hand has right hand chirality');
  const B=L.basis.map(drawn),drawnDet=dot(cross(B[0],B[1]),B[2]);
  report.minDrawnLeftDeterminant=Math.min(report.minDrawnLeftDeterminant,drawnDet);
  assert(drawnDet>.999999,'Rendered hand is mirrored');
  assert(dot(L.basis[0],G.U)>0,'Index/thumb side must point toward scroll');
  for(let f=0;f<4;f++){
   const points=L.fingers[f].points,root=L.wrist.map((v,i)=>v+L.basis.reduce((s,axis,j)=>s+axis[i]*N.ROOT[f][j],0));
   const re=dist(points[0],root);report.maxRootError=Math.max(report.maxRootError,re);assert(re<1e-9,'Finger root moved on palm');
   for(let j=0;j<3;j++){const e=Math.abs(dist(points[j],points[j+1])-ViolinMotion.FINGER_LENGTHS[f][j]);report.maxBoneError=Math.max(report.maxBoneError,e);assert(e<1e-9,'Finger stretched');}
   if(S.debug.contacts[f].contact){const e=dist(points[3],S.debug.contacts[f].target);report.maxContactError=Math.max(report.maxContactError,e);assert(e<.00005,`${song.id} ${t}: fingertip missed string (${e})`);}
  }
  for(let j=0;j<3;j++)assert(Math.abs(dist(L.thumb[j],L.thumb[j+1])-N.THUMB_LEN[j])<1e-9,'Thumb stretched');
  const fore=S.armL.wrist.map((v,i)=>v-S.armL.elbow[i]),foreDot=fore.reduce((s,v,i)=>s+v*L.basis[1][i],0)/Math.hypot(...fore);report.maxWristAngle=Math.max(report.maxWristAngle,Math.acos(Math.max(-1,Math.min(1,foreDot)))*180/Math.PI);
  report.samples++;
 }
}
report.maxWristStep=0;report.maxFingertipStep=0;
for(const song of VIOLIN_SONGS){const P=ViolinMotion.plan(song);let previous=null;
 for(let t=0;t<song.duration;t+=1/30){const S=ViolinMotion.at(P,t);if(previous){report.maxWristStep=Math.max(report.maxWristStep,dist(S.handL.wrist,previous.handL.wrist));for(let f=0;f<4;f++)report.maxFingertipStep=Math.max(report.maxFingertipStep,dist(S.handL.fingers[f].points[3],previous.handL.fingers[f].points[3]));}previous=S;}
}
// Fast musical shifts can cover centimetres in a render frame. Probe both
// sides of every knot to distinguish continuous motion from a pose jump.
report.maxKnotWristJump=0;report.maxKnotElbowJump=0;
for(const song of VIOLIN_SONGS){const P=ViolinMotion.plan(song),keys=VIOLIN_HAND_FRAMES.songs[song.id].keys;
 for(const key of keys){const t=key.t;if(t<.000001||t>song.duration-.000001)continue;const a=ViolinMotion.at(P,t-.000001),b=ViolinMotion.at(P,t+.000001);report.maxKnotWristJump=Math.max(report.maxKnotWristJump,dist(a.handL.wrist,b.handL.wrist));report.maxKnotElbowJump=Math.max(report.maxKnotElbowJump,dist(a.armL.elbow,b.armL.elbow));}
}
assert(report.maxKnotWristJump<.0001,'Wrist pose is discontinuous at a knot');
assert(report.maxKnotElbowJump<.0001,'Elbow pose is discontinuous at a knot');
assert.equal(N.stats().solves,0,'Playback ran nonlinear fitting');
// Inspect the actual low-poly skin vertices against the rendered body triangles.
function meshAudit(){
 let bound,matrix;const vertices=[];function upload(data){const seen=new Set();bound.points=[];for(let j=0;j<data.length;j+=6){const p=Array.from(data.slice(j,j+3)),key=p.map(v=>Math.round(v*1e8)).join(':');if(!seen.has(key)){seen.add(key);bound.points.push(p);}}}const gl={VERTEX_SHADER:1,FRAGMENT_SHADER:2,COMPILE_STATUS:3,LINK_STATUS:4,ARRAY_BUFFER:5,STATIC_DRAW:6,DYNAMIC_DRAW:9,FLOAT:7,TRIANGLES:8,
 createShader:()=>({}),shaderSource(){},compileShader(){},getShaderParameter:()=>true,createProgram:()=>({}),attachShader(){},linkProgram(){},getProgramParameter:()=>true,useProgram(){},getAttribLocation:(_,n)=>n==='aP'?0:1,getUniformLocation:(_,n)=>n,createBuffer:()=>({}),bindBuffer:(_,b)=>{bound=b},bufferData:(_,data)=>upload(data),bufferSubData:(_,__,data)=>upload(data),enableVertexAttribArray(){},vertexAttribPointer(){},uniformMatrix4fv:(n,_,m)=>{if(n==='uM')matrix=Array.from(m)},uniformMatrix3fv(){},uniform3fv(){},uniform1f(){},drawArrays:(_,__,count)=>{for(const a of bound.points){vertices.push([0,1,2].map(i=>matrix[i]*a[0]+matrix[4+i]*a[1]+matrix[8+i]*a[2]+matrix[12+i]));}}};
 vm.runInThisContext(fs.readFileSync('dist/instruments/violin-gl.js','utf8'));
 const R=RecitalGL.create({getContext:()=>gl}),grid=new Map(),size=.012,mesh=ViolinModel.BODY_MESH;
 for(let j=0;j<mesh.length;j+=18){const [a,b,c]=[0,6,12].map(k=>Array.from(mesh.slice(j+k,j+k+3)));const den=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);if(Math.abs(den)<1e-12)continue;
  for(let x=Math.floor(Math.min(a[0],b[0],c[0])/size);x<=Math.floor(Math.max(a[0],b[0],c[0])/size);x++)for(let y=Math.floor(Math.min(a[1],b[1],c[1])/size);y<=Math.floor(Math.max(a[1],b[1],c[1])/size);y++){const key=x+':'+y;if(!grid.has(key))grid.set(key,[]);grid.get(key).push({a,b,c,den});}
 }
 function bodyDepth(p){let lo=Infinity,hi=-Infinity;for(const {a,b,c,den} of grid.get(Math.floor(p[0]/size)+':'+Math.floor(p[1]/size))||[]){const u=((b[1]-c[1])*(p[0]-c[0])+(c[0]-b[0])*(p[1]-c[1]))/den,v=((c[1]-a[1])*(p[0]-c[0])+(a[0]-c[0])*(p[1]-c[1]))/den;if(u<0||v<0||u+v>1)continue;const w=u*a[2]+v*b[2]+(1-u-v)*c[2];lo=Math.min(lo,w);hi=Math.max(hi,w);}return Math.max(0,Math.min(p[2]-lo,hi-p[2]));}
 const result={body:0,board:0,neck:0,forearm:0};
 for(const song of VIOLIN_SONGS){const P=ViolinMotion.plan(song),times=new Set([0,song.duration]);for(let t=0;t<song.duration;t+=1)times.add(t);for(const n of P.notes)for(const t of [n.t0,n.t0+n.dur/2,n.t1])times.add(t);
  for(const t of [...times].sort((a,b)=>a-b)){const S=ViolinMotion.at(P,t);vertices.length=0;ViolinModel.drawLeftHand(R,S.handL);for(const point of vertices){const p=N.local([-point[0],point[1],point[2]]);result.body=Math.max(result.body,bodyDepth(p));result.board=Math.max(result.board,-N.board(p));result.neck=Math.max(result.neck,-N.neck(p,true));}
   vertices.length=0;const arm=S.armL,fl=dist(arm.elbow,arm.wrist),cuff=arm.wrist.map((v,i)=>v+(arm.elbow[i]-v)*.05/fl);
   R.segment(arm.elbow,cuff,.042,[0,0,0],'forearm');R.segment(arm.wrist,cuff,.024,[0,0,0],'bodyLimb');
   for(const point of vertices)result.forearm=Math.max(result.forearm,bodyDepth(N.local([-point[0],point[1],point[2]])));
  }}
 return result;
}
report.renderedSkinPenetration=meshAudit();
for(const [part,depth] of Object.entries(report.renderedSkinPenetration))assert(depth<.001,part+': rendered skin intersects wood by '+(depth*1000).toFixed(3)+' mm (limit 1 mm)');
window.VIOLIN_HAND_FRAMES={stamp:'stale',songs:{}};const P=ViolinMotion.plan(VIOLIN_SONGS[0]);assert.notEqual(ViolinMotion.at(P,0).handL.model,'natural');assert.equal(N.stats().solves,0,'Stale cache triggered planning');
console.log(JSON.stringify(report,null,2));

'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),crypto=require('node:crypto');global.window=globalThis;
for(const f of ['hand-surface','violin-skin','guitar-songs','guitar-fingering','guitar-motion','guitar-hands','guitar-hand-frames','guitar-skin','guitar-model','guitar-plans'])vm.runInThisContext(fs.readFileSync('dist/instruments/'+f+'.js','utf8'),{filename:f});
const G=GuitarMotion,N=GuitarHands,dist=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i])),dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const sourceHashes=JSON.parse(fs.readFileSync('guitar-note-hashes.json'));
const expected=[[.030,.023,.018],[.0368,.0224,.016],[.0416,.0256,.0176],[.0384,.024,.0168],[.0304,.0192,.0136]],states=[GuitarHandSkin.create(0),GuitarHandSkin.create(1)];assert.deepEqual(G.LENGTHS,expected);
const report={songs:6,sourceNotes:0,poses:0,maxBoneError:0,maxRootError:0,maxLeftContactError:0,maxBarreCentrelineDistance:0,maxRightContactError:0,maxArmError:0,trianglesPerHand:1688,handSurfaceClosed:true,sourceNotesHash:{},runtimeFits:0},renderSamples=[];
function topology(S){const edges=new Map(),adj=new Map(),V=new Set();for(let i=0;i<S.indices.length;i+=3)for(let j=0;j<3;j++){const a=S.indices[i+j],b=S.indices[i+(j+1)%3],key=Math.min(a,b)+':'+Math.max(a,b),e=edges.get(key)||[0,0];e[0]++;e[1]+=a<b?1:-1;edges.set(key,e);V.add(a);if(!adj.has(a))adj.set(a,new Set());adj.get(a).add(b);}for(const [count,wind] of edges.values()){assert.equal(count,2,'Open/overlapping edge');assert.equal(wind,0,'Inconsistent winding');}const seen=new Set([S.indices[0]]),q=[S.indices[0]];for(const a of q)for(const b of adj.get(a))if(!seen.has(b)){seen.add(b);q.push(b);}assert.equal(seen.size,V.size);assert.equal(V.size-edges.size+S.indices.length/3,2);return V;}
let vertices,lastPlan;
for(const song of GUITAR_SONGS){
 const original=JSON.stringify(song.notes);song.fingering=GUITAR_PLAN_CACHE[song.id];const P=G.plan(song);lastPlan=P;assert(N.available(P),'Missing/stale hand frames: '+song.id);
 report.sourceNotes+=song.notes.length;report.sourceNotesHash[song.id]=crypto.createHash('sha256').update(original).digest('hex');assert.equal(report.sourceNotesHash[song.id],sourceHashes[song.id],'Source notes changed');
 for(let i=0;i<song.notes.length;i++){const a=song.fingering.assignments[i],open=(song.tuning||GuitarFingering.OPEN)[a.string];assert.equal(open+a.fret,song.notes[i][2],'Fingering changed pitch');assert(a.fret>=0&&a.fret<=G.FRETS);assert(a.fret?a.lh>=1&&a.lh<=4:a.lh===0);assert(['p','i','m','a'].includes(a.rh));}
 const atTime=new Map();for(const e of P.events)for(const n of e.notes){if(!atTime.has(n.t))atTime.set(n.t,[]);atTime.get(n.t).push(n);}
 for(const notes of atTime.values()){const strings=new Set(),fingers=new Map();for(const n of notes){assert(!strings.has(n.string),'Two simultaneous pitches share a string');strings.add(n.string);if(n.lh){assert(n.lh===1||!fingers.has(n.lh),'A curved finger cannot press two strings');assert(!fingers.has(n.lh)||fingers.get(n.lh)===n.fret,'One finger is assigned simultaneous frets');fingers.set(n.lh,n.fret);}}}
 const times=new Set([0,song.duration]);for(let t=0;t<song.duration;t+=.20)times.add(t);for(const note of song.notes)for(const dt of [0,.025,note[1]/2])times.add(Math.min(song.duration,note[0]+dt));
 for(const t of [...times].sort((a,b)=>a-b)){
  const S=G.pose(P,t),T=N.leftTargets(P,t,S);assert(S.hands?.every(h=>h.model==='guitar-B'));
  for(let h=0;h<2;h++){
   const H=S.hands[h],B=H.basis;assert(Math.abs(dot(cross(B[0],B[1]),B[2])-(h?1:-1))<1e-10,'Mirrored anatomical hand');
   const digits=[...H.fingers,{points:H.thumb,digit:0}];for(let f=0;f<5;f++){
    const F=digits[f],e=dist(F.points[0],N.point(H,N.ROOT[f]));report.maxRootError=Math.max(report.maxRootError,e);assert(e<1e-10,'MCP/CMC moved on palm');
    for(let j=0;j<3;j++){const e=Math.abs(dist(F.points[j],F.points[j+1])-expected[F.digit][j]);report.maxBoneError=Math.max(report.maxBoneError,e);assert(e<1e-9,'Finger stretched');}
   }
   assert(dist(H.wrist,S.arms[h].wrist)<1e-10);report.maxArmError=Math.max(report.maxArmError,S.arms[h].error);assert(S.arms[h].error<1e-6,'Wrist beyond arm reach');
  }
  for(let f=0;f<4;f++)if(T[f].contact){const F=S.hands[0].fingers[f];report.maxLeftContactError=Math.max(report.maxLeftContactError,F.error);assert(F.contact,`${song.id} ${t} finger ${f+1}: Required fretting contact was silently dropped, error ${F.error}`);assert(F.error<.001,`${song.id} ${t}: finger ${f+1} misses fret by ${F.error}`);if(T[f].barre)for(const p of N.barrePoints(P,t,f)){const d=Math.min(...F.points.slice(0,3).map((a,j)=>N.segmentDistance(p,a,F.points[j+1])));report.maxBarreCentrelineDistance=Math.max(report.maxBarreCentrelineDistance,d);assert(d<.0045,'Barre does not cover its assigned strings');}}
  const right=S.hands[1];for(const F of right.fingers.slice(0,3))if(F.contact){report.maxRightContactError=Math.max(report.maxRightContactError,F.error);assert(F.error<.001,'Right finger misses string');}if(S.rhFingers.p.contact){report.maxRightThumbContactError=Math.max(report.maxRightThumbContactError||0,right.thumbInfo.error);assert(right.thumbInfo.error<.001,'Right thumb misses accompaniment string');}assert(!right.fingers[3].contact,'Little finger was planted or used to pluck');
  if(report.poses%150===0){for(let h=0;h<2;h++){const H=S.hands[h],before=JSON.stringify(H),state=states[h],refs=Object.values(state);GuitarHandSkin.update(state,H);Object.values(state).forEach((v,i)=>assert.equal(v,refs[i]));assert.equal(JSON.stringify(H),before,'Skin moved bones');assert(state.data.every(Number.isFinite));assert.equal(state.data.length/18,1688);const used=topology(state);vertices=used.size;for(const v of used)assert(Math.abs(Math.hypot(...state.normals.subarray(v*3,v*3+3))-1)<1e-8);if(renderSamples.length<120)renderSamples.push({H,h});}}
  report.poses++;
 }
 assert.equal(JSON.stringify(song.notes),original,'Source MIDI notes were edited');
}
report.surfaceVertices=vertices;report.runtimeFits=N.stats().fits;assert.equal(report.runtimeFits,0,'Nonlinear fitting ran during playback');
let bound,buffers=0,allocations=0,updates=0,draws=0;const renderer={dynamicMesh:(key,data)=>{if(!uploads.has(key)){uploads.set(key,data);buffers++;allocations++;}else{assert.equal(uploads.get(key),data,'Upload array was reallocated');updates++;}draws++;}},uploads=new Map();
for(let i=0;i<4500;i++){const a=renderSamples[(i*2)%renderSamples.length],b=renderSamples[(i*2+1)%renderSamples.length];GuitarHandSkin.draw(renderer,[a.h===0?a.H:b.H,a.h===1?a.H:b.H],[.7,.5,.4]);}
assert.equal(buffers,2);assert.equal(allocations,2);assert.equal(updates,8998);Object.assign(report,{frames:4500,skinBuffers:buffers,skinAllocations:allocations,skinUpdates:updates});
window.GUITAR_HAND_FRAMES={stamp:'stale',songs:{}};assert(!N.available(lastPlan));assert.equal(N.stats().fits,0);console.log(JSON.stringify(report,null,2));

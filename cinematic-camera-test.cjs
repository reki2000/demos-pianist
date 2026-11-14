'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');global.window=globalThis;
for(const file of ['gl','cinematic-camera'])vm.runInThisContext(fs.readFileSync('dist/'+file+'.js','utf8'));
const C=CinematicCamera,dist=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
const subjects={left:[.35,1.25,-.3],right:[-.25,1.05,-.3],hands:[.05,1.15,-.3]},before=JSON.stringify(subjects),report={};
for(const kind of Object.keys(C.catalog)){
 const shots=C.catalog[kind];assert.equal(shots.length,12);assert(shots.some(s=>s.offset[0]<-.4)&&shots.some(s=>s.offset[0]>.4));assert(shots.some(s=>s.offset[2]>0));
 let start=0,frames=0;
 for(let i=0;i<shots.length;i++){
  const s=shots[i];assert(s.duration>=5&&s.duration<=7);
  for(const aspect of [.55,.9,1.5,2.4])for(const p of [.001,.5,.999]){
   const q=C.sample(kind,start+s.duration*p,subjects,{aspect});assert.equal(q.index,i);assert([...q.eye,...q.at,...q.up].every(Number.isFinite));assert(dist(q.eye,q.at)>=.55-1e-9);
   const direction=q.eye.map((v,j)=>(v-q.at[j])/dist(q.eye,q.at));assert(Math.abs(direction.reduce((v,x,j)=>v+x*q.up[j],0))<.999,'Degenerate camera up vector');
   const vp=RecitalGL.multiply(RecitalGL.perspective(aspect),RecitalGL.look(RecitalGL.toWorld(q.eye),RecitalGL.toWorld(q.at),RecitalGL.toWorld(q.up)));
   for(const point of s.subject==='hands'?[subjects.left,subjects.right]:[q.at]){
    const a=[...RecitalGL.toWorld(point),1],v=[0,0,0,0];for(let r=0;r<4;r++)for(let c=0;c<4;c++)v[r]+=vp[c*4+r]*a[c];
    assert(v[3]>0&&Math.abs(v[0]/v[3])<1&&Math.abs(v[1]/v[3])<1,'Cinematic subject is outside the viewport');
   }frames++;
  }
  const a=C.sample(kind,start+.2,subjects),b=C.sample(kind,start+s.duration-.2,subjects);assert(dist(a.eye,b.eye)>.015,'Shot has no camera movement');
  const r=C.sample(kind,start+.2,subjects,{reducedMotion:true}),r2=C.sample(kind,start+s.duration-.2,subjects,{reducedMotion:true});assert.deepEqual(r.eye,r2.eye);assert.deepEqual(r.at,r2.at);
  start+=s.duration;
 }
 assert.equal(C.sample(kind,start,subjects).index,0,'Shot cycle does not repeat');
 report[kind]={shots:shots.length,cycleSeconds:start,projectedFrames:frames};
}
assert.equal(JSON.stringify(subjects),before,'Camera moved input hand points');
const tracker=C.create('guitar'),a=tracker.at(8,subjects,{key:'one'}),moved={...subjects,left:[1.35,1.25,-.3]},b=tracker.at(8.01,moved,{key:'one'});assert(dist(a.at,b.at)<.04,'Camera snaps on fast hand motion');
assert.deepEqual(tracker.at(8.01,moved,{key:'one'}).eye,b.eye,'Paused camera moves');
assert.deepEqual(tracker.at(8.01,moved,{key:'two'}).at,moved.left,'New song retained former hand target');
assert.deepEqual(tracker.at(8,subjects,{key:'two'}).at,subjects.left,'Seek retained former hand target');
console.log(JSON.stringify({instruments:report,handTracking:true,pauseAndSeek:true,reducedMotion:true,inputUnchanged:true},null,2));

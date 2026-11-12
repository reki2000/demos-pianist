'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const c={console,atob,Uint8Array,Buffer};c.window=c;vm.createContext(c);
for(const name of ['bow-hand','violin-fingering','violin-songs','violin-model','violin-hand','violin-hand-frames','violin-motion','cello-fingering','cello-model','cello-motion','cello-songs','cello-poses'])
  vm.runInContext(fs.readFileSync(`dist/instruments/${name}.js`,'utf8'),c);
const sub=(a,b)=>a.map((v,i)=>v-b[i]),dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),length=a=>Math.hypot(...a),dist=(a,b)=>length(sub(a,b));
const local=(H,p)=>H.basis.map(axis=>dot(sub(p,H.origin),axis));
const report={violin:{samples:0,maxContactError:0,maxBoneError:0},cello:{samples:0,maxContactError:0,maxBoneError:0}};
const originalLengths={};
function check(H,arm,type){
  const r=report[type],digits=[H.thumb,...H.fingers],stick=type==='violin'?.0029:.006;
  assert.deepEqual(Array.from(digits,d=>d.name),['thumb','index','middle','ring','pinky']);
  assert(dist(H.wrist,arm.wrist)<1e-7,'Hand separated from wrist');
  let segments=0,boxes=[];
  const R={segment(){segments++},ball(){},oriented(shape,p,size,color,metal,...basis){if(shape==='box')boxes.push({p,size,basis})}};
  c.BowHand.draw(R,H,[.7,.5,.4],[.8,.6,.5]);
  assert.equal(segments,15,'Five fingers need three articulated segments each');
  c.BowHand.drawFrog(R,c.BowHand.frog(type,H.origin,H.basis[0],H.basis[2]),[0,0,0],[1,1,1]);
  for(const d of digits){
    assert.equal(d.points.length,4);assert(d.points.flat().every(Number.isFinite));
    for(let j=0;j<3;j++){
      const key=type+'/'+d.name+'/'+j,L=dist(d.points[j],d.points[j+1]);
      if(!(key in originalLengths))originalLengths[key]=L;
      const error=Math.abs(L-originalLengths[key]);r.maxBoneError=Math.max(r.maxBoneError,error);assert(error<1e-7,'Finger stretched');
      assert(L>.010&&L<.040,'Implausible phalanx length');
    }
    const centre=d.points[d.contactIndex];let error;
    if(d.contact.kind==='frog'){
      const distances=boxes.map(box=>{const p=box.basis.map(axis=>dot(sub(centre,box.p),axis));const q=p.map((v,i)=>Math.abs(v)-box.size[i]/2);return length(q.map(v=>Math.max(0,v)))+Math.min(0,Math.max(...q));});
      error=Math.abs(Math.min(...distances)-d.contact.radius);
    }else{const p=local(H,centre);error=Math.abs(Math.hypot(p[1],p[2])-stick-d.contact.radius);}
    r.maxContactError=Math.max(r.maxContactError,error);assert(error<.001,'Finger misses actual stick/frog surface');
  }
  const thumb=local(H,H.thumb.points[3]),pinky=local(H,H.fingers[3].points[3]);
  assert(thumb[2]<0,'Bent thumb must support the underside');
  assert(type==='violin'?pinky[2]>0&&Math.abs(pinky[1])<1e-6:pinky[2]<0&&pinky[1]<0,'Wrong instrument-specific pinky position');
  for(let i=1;i<4;i++)assert(local(H,H.fingers[i-1].points[0])[0]>local(H,H.fingers[i].points[0])[0],'Finger order reversed');
  r.samples++;
}
for(const song of c.VIOLIN_SONGS){const P=c.ViolinMotion.plan(song);for(let i=0;i<=100;i++){const S=c.ViolinMotion.at(P,song.duration*i/100);check(S.handR,S.armR,'violin');assert(S.armR.error<1e-6,'Violin wrist is beyond arm reach');}}
c.CelloMotion.setHandSolver('natural');
  for(const song of c.CELLO_SONGS)for(let i=0;i<=100;i++){
    const p=c.CelloMotion.poseCached(song,song.duration*i/100);assert(p,'Cello natural render cache missing');check(p.bowHand,p.rightArm,'cello');
    const a=p.rightArm,L=c.CelloMotion.SKELETON.ARM;
    assert(Math.abs(dist(a.shoulder,a.elbow)-L[0])<1e-6&&Math.abs(dist(a.elbow,a.wrist)-L[1])<1e-6,'Cello arm stretched');
  }
console.log(JSON.stringify(report));

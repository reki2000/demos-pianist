'use strict';
// Offline elbow fitting on the compiled left-hand track. No musical data,
// phalanx lengths or fingertip targets change; only cached elbow swivels fit.
const fs=require('node:fs'),vm=require('node:vm');global.window=globalThis;
for(const n of ['bow-hand','violin-fingering','violin-songs','hand-surface','violin-skin','violin-model','violin-hand','violin-hand-frames','violin-motion'])vm.runInThisContext(fs.readFileSync(`dist/instruments/${n}.js`,'utf8'));
const N=ViolinMotion.NH;
const sourceIndex=process.argv.indexOf('--from');
const selected=process.argv.slice(2).filter((s,i,a)=>s!=='--from'&&a[i-1]!=='--from');
if(sourceIndex>=0){vm.runInThisContext(fs.readFileSync(process.argv[sourceIndex+1],'utf8'));for(const song of Object.values(VIOLIN_HAND_FRAMES.songs))for(const key of song.keys){key.x[1]=-key.x[1];key.x[11]=-key.x[11];}}
const {measure}=require('./violin-arm-clearance.cjs')(N);
function fit(P,key,reference=key.x[11]){
 const S=ViolinMotion.atLegacy(P,key.t),q=N.jointsAt(P,key.t,[key],S.debug.contacts);let best=null;const initial=measure(q,S.armL.shoulder);if(initial.depth<.0005&&initial.bend<70*Math.PI/180&&initial.outward>.08)return {angle:key.x[11],depth:initial.depth};
 function probe(angle){angle=reference+Math.atan2(Math.sin(angle-reference),Math.cos(angle-reference));q.x[11]=angle;const m=measure(q,S.armL.shoulder),cost=m.cost+.03*(angle-reference)**2;if(!best||cost<best.cost)best={angle,cost,depth:m.depth};}
 for(let j=-24;j<=24;j++)probe(j*Math.PI/24);
 for(let h=Math.PI/48;h>.0005;h/=2){const a=best.angle;probe(a-h);probe(a+h);}
 key.x[11]=best.angle;return best;
}
for(const song of VIOLIN_SONGS){
 if(selected.length&&!selected.includes(song.id))continue;
 const P=ViolinMotion.plan(song),entry=VIOLIN_HAND_FRAMES.songs[song.id],keys=entry.keys;
 if(entry.signature!==JSON.stringify(P.notes))throw Error('Notes changed: '+song.id);
 let previous=0;for(let i=0;i<keys.length;i++){const b=fit(P,keys[i],previous);previous=b.angle;if(i%250===0)console.error(song.id,i,'/',keys.length,'depth',b.depth);}
 for(let pass=0;pass<12;pass++){
  const times=new Set([0,song.duration]);for(let t=0;t<song.duration;t+=1/30)times.add(t);for(const n of P.notes)for(const t of [n.t0,n.t0+n.dur/2,n.t1])times.add(t);
  const bad=[];for(const t of times){const S=ViolinMotion.atLegacy(P,t),q=N.jointsAt(P,t,keys,S.debug.contacts),m=measure(q,S.armL.shoulder);if(m.depth>.00095||m.outward<0)bad.push({...q,t});}
  console.error(song.id,'arm repair',pass,bad.length);if(!bad.length)break;if(pass===11)throw Error('Unresolved forearm clearance: '+song.id);
  for(const key of bad){fit(P,key);const old=keys.findIndex(k=>Math.abs(k.t-key.t)<1e-7);if(old>=0)keys[old].x[11]=key.x[11];else keys.push({t:key.t,u:key.u,x:key.x.slice(0,12),a:key.a});}keys.sort((a,b)=>a.t-b.t);
 }
}
VIOLIN_HAND_FRAMES.stamp=N.stamp();
fs.writeFileSync('dist/instruments/violin-hand-frames.js',"'use strict';\n// Generated hand trajectories; anatomical left grip and offline elbow fitting.\nwindow.VIOLIN_HAND_FRAMES="+JSON.stringify(VIOLIN_HAND_FRAMES,(k,v)=>typeof v==='number'?Math.round(v*1e7)/1e7:v)+';\n');

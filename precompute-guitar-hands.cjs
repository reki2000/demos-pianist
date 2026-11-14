'use strict';
process.chdir(__dirname);
// Offline carriage fitting. The browser only interpolates these coordinates
// and applies bounded analytic finger IK; no search runs on the animation clock.
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');global.window=globalThis;
for(const f of ['guitar-songs','guitar-fingering','guitar-motion','guitar-hands','guitar-plans'])vm.runInThisContext(fs.readFileSync('dist/instruments/'+f+'.js','utf8'),{filename:f});
const N=GuitarHands,G=GuitarMotion,folder=process.env.GUITAR_HAND_WORK||'/tmp/guitar-hand-build',selected=process.argv.slice(2);fs.mkdirSync(folder,{recursive:true});
const plans=GUITAR_SONGS.map(song=>{song.fingering=GUITAR_PLAN_CACHE[song.id];return G.plan(song);});
const rightSeed=[G.PLUCK_D,-.055,.075,.25,0,0],rightBase=N.rightTargets(G.poseLegacy(plans[0],0,false));
const fn=x=>{
 const r=N.constraints(x,1,rightBase,[],rightSeed);
 const H=N.frame(x,1),strings={p:[4,5,6],i:[1,2,3,4,5],m:[1,2,3,4,5],a:[1,2,3,4]};
 for(const [name,ss] of Object.entries(strings))for(const s of ss){const f=name==='p'?4:['i','m','a'].indexOf(name),root=N.point(H,N.ROOT[f]),target=G.pluckPoint(s,.005).map((v,k)=>v+(f===4?G.u[k]*.025:0)),F=N.finger(root,target,f===4?0:f+1,f===4?G.u:G.w);r.push(F.error/.00003);}
 return r;
};
let right=N.minimize(fn,rightSeed,45,N.rightLimits);console.error('right',right);
const summary=[];
for(const P of plans){
 if(selected.length&&!selected.includes(P.song.id))continue;
 const file=path.join(folder,P.song.id+'.json'),stamp=N.stamp(),signature=N.signature(P);let state=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)):null;
 if(state?.stamp!==stamp||state?.signature!==signature)state=null;
 let keys=state?.keys||[];
 if(!keys.length&&process.env.GUITAR_HAND_SEED){const f=path.join(process.env.GUITAR_HAND_SEED,P.song.id+'.json');if(fs.existsSync(f)){const seed=JSON.parse(fs.readFileSync(f));if(JSON.stringify(JSON.parse(seed.signature)[0])===JSON.stringify(P.song.notes))keys=seed.keys.map(q=>({t:q.t,x:N.buildHand(q.x,0,N.leftTargets(P,q.t,G.poseLegacy(P,q.t,false))).carriage}));}}
 if(!keys.length){
  const times=[...new Set([0,P.song.duration,...P.song.notes.map(n=>n[0])])].sort((a,b)=>a-b);let previous=null,anchor=null;
  for(let i=0;i<times.length;i++){
   const t=times[i],old=G.poseLegacy(P,t,false),seed=previous?.x.slice();if(seed)seed[0]+=old.anchorD-anchor;
   const key=N.fitLeft(P,t,seed);keys.push({t,x:key.x});previous=key;anchor=old.anchorD;
   if(i%100===0)console.error(P.song.id,i,'/',times.length,'cost',key.cost);
  }
  fs.writeFileSync(file,JSON.stringify({stamp,signature,phase:'initial',keys}));
 }
 for(const key of keys)while(key.x.length<10)key.x.push(0);
 keys.sort((a,b)=>a.t-b.t);keys=keys.filter((k,i,a)=>!i||k.t-a[i-1].t>.0001);
 // Finish a barre carriage before its attack; avoid a last-4-ms pose snap.
 for(const nt of P.lhByFinger[1])if(nt.barre&&nt.t>.004){const t=nt.t-.004;if(!keys.some(k=>Math.abs(k.t-t)<1e-7)){const x=N.carriage(keys,nt.t);keys.push({t,x});keys.sort((a,b)=>a.t-b.t);}}
 N.normalizeBoundaries(P,keys);
 for(let pass=0;pass<12;pass++){
  const times=new Set([0,P.song.duration]);for(let t=0;t<P.song.duration;t+=1/60)times.add(t);
  for(const n of P.song.notes)for(const dt of [-.004,0,.001,.025,n[1]/2,n[1]-.001])times.add(Math.max(0,n[0]+dt));
  const intervals=new Map();let worst=0;
  for(const t of [...times].sort((a,b)=>a-b)){
   const S=G.poseLegacy(P,t,false),T=N.leftTargets(P,t,S),H=N.buildHand(N.carriage(keys,t),0,T);let e=Math.max(0,.00525-N.fingerClearance(H));
   for(let f=0;f<4;f++)if(T[f].contact){e=Math.max(e,H.fingers[f].error);if(T[f].barre)for(const p of N.barrePoints(P,t,f))e=Math.max(e,Math.max(0,Math.min(...H.fingers[f].points.slice(0,3).map((a,j)=>N.segmentDistance(p,a,H.fingers[f].points[j+1])))-.003));}
   worst=Math.max(worst,e);if(e>.0007){const k=G.lowerBound(keys,t+1e-8)-1,old=intervals.get(k);if(!old||e>old.e)intervals.set(k,{t,x:H.carriage,e});}
  }
  const bad=[...intervals.values()];console.error(P.song.id,'repair',pass,bad.length,'max',worst);if(!bad.length){summary.push({id:P.song.id,keys:keys.length,maxConstraintError:worst});break;}
  if(pass===11)throw Error('Unresolved guitar contacts: '+P.song.id);
  for(const b of bad){const T=N.leftTargets(P,b.t,G.poseLegacy(P,b.t,false)),H=N.buildHand(b.x,0,T),contact=Math.max(0,...H.fingers.map((f,i)=>T[i].contact?f.error:0));let q;
   if(contact<.0005){const barres=T.map((q,f)=>q.contact&&q.barre?N.barrePoints(P,b.t,f):[]),fn=angles=>N.constraints([...b.x.slice(0,6),...angles],0,T,barres,b.x),fit=N.minimize(fn,b.x.slice(6),25,Array.from({length:4},()=>[-1.25,1.25])),x=[...b.x.slice(0,6),...fit.x];q={x};if(N.fingerClearance(N.buildHand(x,0,T))<.00485){const fn=x=>N.constraints(x,0,T,barres,b.x),fit=N.minimize(fn,x,40),h=N.buildHand(fit.x,0,T);q={x:h.carriage};if(N.fingerClearance(h)<.0048||h.fingers.some((f,i)=>T[i].contact&&f.error>.0005))q=N.fitLeft(P,b.t,q.x);}}
   else {const barres=T.map((q,f)=>q.contact&&q.barre?N.barrePoints(P,b.t,f):[]),fn=x=>N.constraints(x,0,T,barres,b.x),fit=N.minimize(fn,b.x,40),h=N.buildHand(fit.x,0,T);q={x:h.carriage};if(h.fingers.some((f,i)=>T[i].contact&&f.error>.0005)||N.fingerClearance(h)<.0048)q=N.fitLeft(P,b.t,q.x);}const i=keys.findIndex(k=>Math.abs(k.t-b.t)<1e-7);if(i>=0)keys[i]={t:b.t,x:q.x};else keys.push({t:b.t,x:q.x});}keys.sort((a,b)=>a.t-b.t);N.normalizeBoundaries(P,keys);
  fs.writeFileSync(file,JSON.stringify({stamp,signature,phase:'repair',keys}));
 }
 for(let i=keys.length-1;i>0;i--)if(keys[i].t-keys[i-1].t<.0001)keys.splice(i,1);
 N.normalizeBoundaries(P,keys);
 fs.writeFileSync(file,JSON.stringify({stamp,signature,phase:'complete',keys}));
}
if(plans.every(P=>{const f=path.join(folder,P.song.id+'.json');if(!fs.existsSync(f))return false;const s=JSON.parse(fs.readFileSync(f));return s.stamp===N.stamp()&&s.phase==='complete';})){
 const songs={};for(const P of plans){const data=JSON.parse(fs.readFileSync(path.join(folder,P.song.id+'.json')));songs[P.song.id]={signature:data.signature,keys:data.keys};}
 fs.writeFileSync('dist/instruments/guitar-hand-frames.js',"'use strict';\n// Generated by precompute-guitar-hands.cjs; no runtime optimization.\nwindow.GUITAR_HAND_FRAMES="+JSON.stringify({stamp:N.stamp(),right:right.x,songs},(k,v)=>typeof v==='number'?Math.round(v*1e8)/1e8:v)+';\n');
}
console.log(JSON.stringify({right,summary},null,2));

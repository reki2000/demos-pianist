'use strict';
// Offline common-carriage fitting: keep a chord shape through its repeated
// plucks, and change the wrist only when the next region needs another shape.
const fs=require('node:fs'),vm=require('node:vm');process.chdir(__dirname);global.window=globalThis;
for(const f of ['guitar-songs','guitar-fingering','guitar-motion','guitar-hands','guitar-hand-frames','guitar-plans'])vm.runInThisContext(fs.readFileSync('dist/instruments/'+f+'.js','utf8'),{filename:f});
const G=GuitarMotion,N=GuitarHands,D=GUITAR_HAND_FRAMES,song=GUITAR_SONGS.find(s=>s.id==='recuerdos');song.fingering=GUITAR_PLAN_CACHE.recuerdos;const P=G.plan(song),phases=song.leftHandPhrases;
const folder=process.env.ALHAMBRA_GRIP_WORK||'/tmp/alhambra-grip-build';fs.mkdirSync(folder,{recursive:true});const results=[];let previous=null;
function error(x,t){const T=N.leftTargets(P,t),H=N.buildHand(x,0,T);return Math.max(0,...H.fingers.map((f,i)=>T[i].contact?f.error:0),.0051-N.fingerClearance(H));}
for(let i=0;i<phases.length;i++){
 const p=phases[i],margin=Math.min(.18,(p.endTime-p.startTime)/5),start=p.startTime+margin,end=p.endTime-margin,mid=(start+end)/2;
 const times=new Set([start,mid,end]);for(const list of Object.values(P.lhByFinger))for(const n of list)for(const t of [n.t,n.end,n.t-.025,n.t+.025,n.end+.025])if(t>=start&&t<=end)times.add(t);
 const seen=new Set(),samples=[];for(const t of [...times].sort((a,b)=>a-b)){const T=N.leftTargets(P,t),key=JSON.stringify(T,(k,v)=>typeof v==='number'?Math.round(v*1e5)/1e5:v);if(!seen.has(key)){seen.add(key);samples.push({t,T,barres:T.map((q,f)=>q.contact&&q.barre?N.barrePoints(P,t,f):[])});}}
 const file=folder+'/'+i+'.json',signature=JSON.stringify([N.stamp(),N.signature(P),p]);let data=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)):null;
 if(data?.signature!==signature)data=null;
 let x=data?.x;
 if(!x){let seed=previous?.x.slice();if(seed)seed[0]+=G.fretDist(p.position)-G.fretDist(phases[i-1].position);
  const first=N.fitLeft(P,mid,seed);seed=first.x;
  const fn=x=>samples.flatMap(q=>N.constraints(x,0,q.T,q.barres,seed));
  let best=N.minimize(fn,seed,35);
  for(const offset of [0,-.035,.035]){if(best.cost<.01)break;const alt=seed.slice();alt[1]+=offset;const fit=N.minimize(fn,alt,35);if(fit.cost<best.cost)best=fit;}
  x=best.x;
  // Reuse the preceding wrist when it already serves the new harmony.
  if(previous&&Math.max(...samples.map(q=>error(previous.x,q.t)))<.00065)x=previous.x.slice();
  data={signature,x,cost:best.cost};fs.writeFileSync(file,JSON.stringify(data));
 }
 const max=Math.max(...samples.map(q=>error(x,q.t)));console.error('region',i,p.bars.join('/'),p.position,'configs',samples.length,'error',max);
 results.push({i,p,start,end,x,max});previous={x};
}
// Dense interpolation is only needed at actual shape changes. Repeated note
// attacks inside a region share the same solved wrist and finger swivels.
const keys=[];for(const q of results){keys.push({t:Math.max(0,q.p.startTime-.004),x:q.x},{t:q.p.endTime-.050,x:q.x});}
if(keys[0].t>0)keys.unshift({t:0,x:keys[0].x});
const tailStart=phases.at(-1).endTime;
for(const q of D.songs.recuerdos.keys)if(q.t>tailStart+.15)keys.push(q);
keys.sort((a,b)=>a.t-b.t);N.normalizeBoundaries(P,keys);
for(const s of GUITAR_SONGS)if(s.id!=='recuerdos'){s.fingering=GUITAR_PLAN_CACHE[s.id];const other=G.plan(s);if(D.songs[s.id].signature!==N.signature(other))throw Error('Unrelated fingering changed: '+s.id);}
D.stamp=N.stamp();D.songs.recuerdos={signature:N.signature(P),keys};
fs.writeFileSync('dist/instruments/guitar-hand-frames.js',"'use strict';\n// Offline common chord shapes and continuous transitions.\nwindow.GUITAR_HAND_FRAMES="+JSON.stringify(D,(k,v)=>typeof v==='number'?Math.round(v*1e8)/1e8:v)+';\n');
console.log(JSON.stringify({regions:results.map(({i,p,max})=>({i,bars:p.bars,position:p.position,maxConstraintError:max})),keys:keys.length},null,2));

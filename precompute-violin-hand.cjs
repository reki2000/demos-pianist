'use strict';
// Offline only: nonlinear fitting must never run on the animation clock.
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
process.chdir(__dirname);global.window=globalThis;
for(const n of ['bow-hand','violin-fingering','violin-songs','violin-model','violin-hand','violin-motion'])
  vm.runInThisContext(fs.readFileSync(`dist/instruments/${n}.js`,'utf8'),{filename:n});
const args=process.argv.slice(2),retargetIndex=args.indexOf('--retarget-from');
let template=null;
if(retargetIndex>=0){const file=args[retargetIndex+1];if(!file)throw Error('--retarget-from needs a frame file');vm.runInThisContext(fs.readFileSync(file,'utf8'),{filename:file});template=window.VIOLIN_HAND_FRAMES;args.splice(retargetIndex,2);}
const N=ViolinMotion.NH,resumeAngles=args.includes('--resume-angles'),reuseCarriages=args.includes('--reuse-carriages'),ids=args.filter(s=>!['--resume-angles','--reuse-carriages'].includes(s)),selected=VIOLIN_SONGS.filter(s=>!ids.length||ids.includes(s.id));
if(!selected.length)throw Error('Unknown violin piece');
const directory=process.env.VIOLIN_HAND_WORK||'/tmp/violin-hand-build';fs.mkdirSync(directory,{recursive:true});
const compact=keys=>keys.map(({t,x,a,u})=>({t,x,a,u}));
function repairContacts(P,keys){
 const times=new Set([0,P.song.duration]);for(let t=0;t<P.song.duration;t+=1/30)times.add(t);for(const n of P.notes)for(const dt of [-.001,0,.001])times.add(Math.max(0,Math.min(P.song.duration,n.t0+dt)));
 const samples=[...times].sort((a,b)=>a-b).map(t=>{const S=ViolinMotion.atLegacy(P,t);return {t,S:{debug:{contacts:S.debug.contacts},armL:{shoulder:S.armL.shoulder}}};});
 const error=(q,S)=>Math.max(0,...S.debug.contacts.map((c,f)=>c.contact?Math.hypot(...N.world(N.H2N(q,N.fk(f,q.a[f])[3])).map((v,i)=>v-c.target[i])):0));
 for(let pass=0;pass<8;pass++){
  const bad=new Map();for(const sample of samples){const q=N.jointsAt(P,sample.t,keys,sample.S.debug.contacts),e=error(q,sample.S);if(e>.00001&&(!bad.has(q.key)||bad.get(q.key).e<e))bad.set(q.key,{...sample,q,e});}
  console.error(P.song.id,'contact repairs',pass,bad.size);if(!bad.size)return;
  let changed=0;for(const b of [...bad.values()].sort((a,b)=>b.e-a.e)){
   let best=b.q,bestError=b.e,bestCost=100*b.e+N.safety(b.q,b.S.debug.contacts,b.S.armL.shoulder,false).score;
   for(const seed of [b.q,null]){const q=N.solveKey(P,b.t,seed,N.nearbyGoals(P,b.t)),e=error(q,b.S),cost=100*e+N.safety(q,b.S.debug.contacts,b.S.armL.shoulder,false).score;if(e<bestError&&cost<bestCost){best=q;bestError=e;bestCost=cost;}if(bestError<.000005)break;}
   if(bestError>=b.e-1e-7)continue;
   N.correctCarriage(P,keys,b.t,best);changed++;
  }
  if(!changed)throw Error('Unresolved fingertip contact: '+P.song.id);
 }
 throw Error('Contact refinement did not converge: '+P.song.id);
}
// Refit the existing carriage poses when changing finger proportions. This
// preserves the established pose family while recomputing every sounding grip.
function retarget(P,entry,save){
 if(entry.signature!==JSON.stringify(P.notes))throw Error('Retarget notes changed: '+P.song.id);
 const previousKeys=entry.keys.map(q=>({...q,x:[...q.x.slice(0,12),...q.a.flat()],R:N.rotation(q.x.slice(3,6)),w:q.x.slice(0,3),th:q.x.slice(6,11)}));
 if(reuseCarriages){let previous=null;for(const q of previousKeys){N.fitJointKey(P,q.t,q,previous);previous=q;}save('angles',previousKeys);if(!resumeAngles)N.refine(P,previousKeys);return previousKeys;}
 const groups=[];for(const n of P.notes){if(!n.finger)continue;const last=groups.at(-1);if(last&&last.position===n.position&&last.string===n.string)last.notes.push(n);else groups.push({t:n.t0,position:n.position,string:n.string,notes:[n]});}
 const keys=[];let previous=null;
 for(let i=0;i<groups.length;i++){
  const group=groups[i],goals=[],seen=new Set();for(const n of group.notes){const key=n.finger+':'+n.string+':'+n.semi;if(!seen.has(key)){seen.add(key);goals.push({f:n.finger-1,p:N.local(ViolinModel.frame().contactPoint(n.string,n.distMm))});}}
  const seed=N.jointsAt(P,group.t,previousKeys,Array.from({length:4},()=>({contact:false}))),q=N.solveKey(P,group.t,seed,goals);
  const lead=previous?Math.min(.12,Math.max(.025,(group.t-previous.t)*.45)):0;
  if(previous&&group.t-lead>previous.t+1e-5)keys.push({...previous,t:group.t-lead});keys.push(q);previous=q;
  if(i%10===0)console.error(P.song.id,'retarget',i+1,'/',groups.length,q.cost);
 }
 if(!keys.length)keys.push(N.solveKey(P,0,null));if(keys[0].t>0)keys.unshift({...keys[0],t:0});keys.push({...keys.at(-1),t:P.song.duration});save('carriages',keys);
 const angles=N.planAngles(P,keys);save('angles',angles);if(!resumeAngles)N.refine(P,angles);return angles;
}
for(const song of selected){
 const P=ViolinMotion.plan(song),stamp=N.stamp(),signature=JSON.stringify(P.notes),file=path.join(directory,song.id+'.json');
 let state=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)):null;
 if(state?.stamp!==stamp||state?.signature!==signature)state=null;
 const save=(phase,keys)=>fs.writeFileSync(file,JSON.stringify({stamp,signature,phase,keys:compact(keys)}));
 const hydrate=keys=>keys.map(q=>({...q,R:N.rotation(q.x.slice(3,6)),w:q.x.slice(0,3),th:q.x.slice(6,11)}));
 let keys;
 if(state?.phase==='complete')keys=hydrate(state.keys);
 else if(state&&['carriages','angles'].includes(state.phase)){
   keys=state.phase==='carriages'?N.planAngles(P,hydrate(state.keys)):hydrate(state.keys);save('angles',keys);if(!resumeAngles)N.refine(P,keys);
 }else if(template?.songs[P.song.id])keys=retarget(P,template.songs[P.song.id],save);
 else keys=N.prepare(P,event=>{if(event.phase==='carriage')console.error(song.id,event.i+1,'/',event.total);else save(event.phase,event.keys);});
 repairContacts(P,keys);save('complete',keys);
 let worst={score:0},bad=0;
 for(let t=0;t<song.duration;t+=1/30){const S=ViolinMotion.atLegacy(P,t),q=N.jointsAt(P,t,keys,S.debug.contacts),v=N.safety(q,S.debug.contacts,S.armL.shoulder);if(v.score>worst.score)worst={...v,t};if(v.score>.0005)bad++;}
 console.log(JSON.stringify({id:song.id,keys:keys.length,guideViolationsOverHalfMm:bad,worstGuideDeviation:worst}));
}
if(VIOLIN_SONGS.every(s=>{const file=path.join(directory,s.id+'.json');if(!fs.existsSync(file))return false;const data=JSON.parse(fs.readFileSync(file));return data.stamp===N.stamp()&&data.phase==='complete';})){
 const songs={};for(const song of VIOLIN_SONGS){const d=JSON.parse(fs.readFileSync(path.join(directory,song.id+'.json')));if(d.stamp!==N.stamp()||d.phase!=='complete')throw Error('Incomplete/stale '+song.id);songs[song.id]={signature:d.signature,keys:d.keys.map(q=>({t:q.t,u:q.u,x:q.x.slice(0,12),a:q.a}))};}
 fs.writeFileSync('dist/instruments/violin-hand-frames.js',"'use strict';\n// Generated by precompute-violin-hand.cjs; joint coordinates, no runtime fitting.\nwindow.VIOLIN_HAND_FRAMES="+JSON.stringify({stamp:N.stamp(),songs},(k,v)=>typeof v==='number'?Math.round(v*1e7)/1e7:v)+';\n');
}

'use strict';
// Offline rendered-skin pass for the new Preludio. Playback only reads the cache.
process.chdir(__dirname);
(function refine(iteration=0){
const fs=require('fs'),vm=require('vm');global.window=globalThis;for(const n of ['guitar-motion','guitar-hands','bow-hand','violin-fingering','violin-songs','hand-surface','violin-skin','violin-model','violin-hand','violin-hand-frames','violin-motion'])vm.runInThisContext(fs.readFileSync('dist/instruments/'+n+'.js','utf8'));
const N=ViolinMotion.NH,song=VIOLIN_SONGS.find(s=>s.id==='bach-preludio'),P=ViolinMotion.plan(song),keys=N.prepare(P),original=keys.map(q=>q.a.map(a=>a.slice())),skin=ViolinFingerSkin.create(false,true,true),G=ViolinModel.GEOM,board={O:G.O0,U:G.U,V:G.V,W:G.W,top:G.wFB},used=[...new Set(skin.indices)],samples=[];
const times=new Set([0,song.duration]);for(let t=0;t<song.duration;t+=1/30)times.add(t);for(const n of P.notes)for(const t of [n.t0,n.t0+n.dur/2,n.t1])times.add(t);for(const t of [...times].sort((a,b)=>a-b)){const S=ViolinMotion.atLegacy(P,t);samples.push({t,contacts:S.debug.contacts});}
const flags=keys.map(q=>ViolinMotion.atLegacy(P,q.t).debug.contacts.map(c=>c.contact)),runs=keys.map(()=>Array(4)),all=[];
for(let f=0;f<4;f++)for(let i=0;i<keys.length;){if(flags[i][f]){i++;continue;}const start=i;while(i<keys.length&&!flags[i][f])i++;const end=i-1,run={f,start,end,lo:keys[Math.max(0,start-1)].t,hi:keys[Math.min(keys.length-1,end+1)].t,drop:0};all.push(run);for(let j=start;j<=end;j++)runs[j][f]=run;}
function handOf(q){
 const wrist=N.world(q.w),basis=q.R.map(axis=>N.world(q.w.map((v,i)=>v+axis[i])).map((v,i)=>v-wrist[i]));
 return {model:'natural',wrist,palmPos:N.world(N.H2N(q,[0,.035,0])),basis,fingers:q.a.map((a,f)=>({points:N.fk(f,a).map(p=>N.world(N.H2N(q,p)))})),thumb:N.thumbData(q).points.map(N.world),thumbPadRadius:N.thumbData(q).padRadius};
}
function skinResidual(q,r){
 ViolinFingerSkin.update(skin,handOf(q),board);let max=0;
 for(const i of used){const p=N.local(Array.from(skin.positions.subarray(i*3,i*3+3))),e=Math.max(-N.board(p),-N.neck(p,true));max=Math.max(max,e);if(r)r.push(Math.max(0,e+.0001)/.00005);}return max;
}
function repairContact(t){
 const contacts=ViolinMotion.atLegacy(P,t).debug.contacts,q=N.jointsAt(P,t,keys,contacts),spec=N.track(P,t),original=[...q.x.slice(0,12),...q.a.flat()];
 if(skinResidual(q)<.00085)return;
 const bounds=original.slice(0,6).map((v,i)=>[v-(i<3?.015:.15),v+(i<3?.015:.15)]);
 const fn=six=>{const fitted=N.decode([...six,...original.slice(6)],spec.targets,q.u),r=N.residual(fitted,spec,original);skinResidual(fitted,r);return r;};
 const fit=GuitarHands.minimize(fn,original.slice(0,6),35,bounds),fitted=N.decode([...fit.x,...original.slice(6)],spec.targets,q.u);
 if(!Number.isFinite(fit.cost)||!fitted.x.every(Number.isFinite)||skinResidual(fitted)>=skinResidual(q))throw Error('Unable to repair active skin at '+t);
 N.correctCarriage(P,keys,t,fitted);
}
function save(){const e=VIOLIN_HAND_FRAMES.songs[song.id];e.keys=keys.map(q=>({t:q.t,u:q.u,x:q.x.slice(0,12),a:q.a}));if(keys.some(q=>!q.x.every(Number.isFinite)||!q.a.flat().every(Number.isFinite)))throw Error('Nonfinite hand key');fs.writeFileSync('dist/instruments/violin-hand-frames.js',"'use strict';\n// Generated offline; fitted hand trajectories and rendered-skin clearance.\nwindow.VIOLIN_HAND_FRAMES="+JSON.stringify(VIOLIN_HAND_FRAMES,(k,v)=>typeof v==='number'?Math.round(v*1e7)/1e7:v)+';\n');}
for(let pass=0;pass<14;pass++){
 const bad=new Set();let worst=0,active=0,activeWorst=null;
 for(const {t,contacts}of samples){const value=N.at(P,t,0,contacts),H=value.hand;ViolinFingerSkin.update(skin,H,board);for(const i of used){const p=N.local(Array.from(skin.positions.subarray(i*3,i*3+3))),e=Math.max(-N.board(p),-N.neck(p,true));worst=Math.max(worst,e);if(e>.00085){const f=Math.floor(i/98);if(f>=4||contacts[f].contact){active++;if(!activeWorst||e>activeWorst.e)activeWorst={t,e,f};continue;}const k=value.q.key,run=runs[k]?.[f]||runs[k+1]?.[f];if(run)bad.add(run);}}
 }
 console.error('pass',pass,'worst',worst,'badRuns',bad.size,'active',active,activeWorst);if(!bad.size){
   // A final carriage correction keeps active fingertip IK exact while moving
   // the knuckle skin clear. Correct both the approach and the attack limit.
   if(activeWorst){for(const t of [activeWorst.t-.001,activeWorst.t])repairContact(t);}
   save();
   if(activeWorst){
    if(iteration>=5)throw Error('Active skin refinement did not converge');
    refine(iteration+1);
   }else console.log(JSON.stringify({sampledPeak:worst,activeVertices:active,correctedFreeIntervals:all.filter(r=>r.drop).length,contactRepairPasses:iteration}));
   break;
  }if(pass===13)throw Error('Did not converge');
 for(const run of bad){run.drop+=.12;for(let i=run.start;i<=run.end;i++){const phase=Math.min(1,Math.max(0,(keys[i].t-run.lo)/.02),Math.max(0,(run.hi-keys[i].t)/.02)),smooth=phase*phase*(3-2*phase);keys[i].a[run.f][0]=Math.max(-.7,original[i][run.f][0]-run.drop*smooth);keys[i].x[12+run.f*3]=keys[i].a[run.f][0];}}
}
})();

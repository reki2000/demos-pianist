'use strict';
// Independent segment test: compare the four endpoints with the interior
// stationary point of the two infinite lines when it lies on both segments.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');global.window=globalThis;
for(const f of ['guitar-songs','guitar-fingering','guitar-motion','guitar-hands','guitar-hand-frames','guitar-plans'])vm.runInThisContext(fs.readFileSync('dist/instruments/'+f+'.js','utf8'),{filename:f});
const G=GuitarMotion,N=GuitarHands,sub=(a,b)=>a.map((v,i)=>v-b[i]),dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),clamp=x=>Math.max(0,Math.min(1,x));
function pointSegment(p,a,b){const d=sub(b,a),t=clamp(dot(sub(p,a),d)/dot(d,d));return Math.hypot(...p.map((v,i)=>v-a[i]-t*d[i]));}
function gap(a,b,c,d){const u=sub(b,a),v=sub(d,c),w=sub(a,c),A=dot(u,u),B=dot(u,v),C=dot(v,v),D=dot(u,w),E=dot(v,w),den=A*C-B*B;let r=Math.min(pointSegment(a,c,d),pointSegment(b,c,d),pointSegment(c,a,b),pointSegment(d,a,b));if(den>1e-16){const s=(B*E-C*D)/den,t=(A*E-B*D)/den;if(s>=0&&s<=1&&t>=0&&t<=1)r=Math.min(r,Math.hypot(...w.map((x,i)=>x+s*u[i]-t*v[i])));}return r;}
let poses=0,min=Infinity,worst;
for(const song of GUITAR_SONGS){song.fingering=GUITAR_PLAN_CACHE[song.id];const P=G.plan(song);assert(N.available(P),'Missing/stale trajectories');const keys=GUITAR_HAND_FRAMES.songs[song.id].keys;for(let i=0;i<keys.length;i++){assert.equal(keys[i].x.length,10);if(i)assert(keys[i].t>keys[i-1].t,'Duplicate or unsorted hand keys');}const times=new Set([0,song.duration,...N.boundaries(P)]);for(let t=0;t<song.duration;t+=1/60)times.add(t);for(const n of song.notes)for(const dt of [0,.001,.025,n[1]/2])times.add(n[0]+dt);
 for(const t of times){const T=N.leftTargets(P,t),H=N.buildHand(N.carriage(GUITAR_HAND_FRAMES.songs[song.id].keys,t),0,T);for(let f=0;f<4;f++)for(let g=f+1;g<4;g++)for(let j=0;j<3;j++)for(let k=0;k<3;k++){const a=H.fingers[f].points,b=H.fingers[g].points,d=gap(a[j],a[j+1],b[k],b[k+1]);if(d<min){min=d;worst={song:song.id,t,fingers:[f+1,g+1],bones:[j,k]};}assert(d>=.0045,`${song.id} ${t}: fingers ${f+1}/${g+1} approach within ${d*1000} mm`);}poses++;}
}
assert.equal(N.stats().fits,0);console.log(JSON.stringify({poses,minBoneDistanceMm:min*1000,requiredBoneDistanceMm:4.5,worst,runtimeFits:0},null,2));

'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),crypto=require('node:crypto');global.window=globalThis;
for(const f of ['guitar-songs','guitar-fingering','guitar-motion','guitar-hands','guitar-hand-frames','guitar-plans'])vm.runInThisContext(fs.readFileSync('dist/instruments/'+f+'.js','utf8'));
const G=GuitarMotion,N=GuitarHands,hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const expected=JSON.parse(fs.readFileSync('docs/verification/string-notation-grips/unchanged-poses.json'));
for(const s of GUITAR_SONGS)if(s.id!=='recuerdos'){s.fingering=GUITAR_PLAN_CACHE[s.id];const P=G.plan(s);assert(N.available(P));assert.equal(hash(Array.from({length:17},(_,i)=>G.pose(P,s.duration*i/16))),expected[s.id],'Unrelated performer pose changed: '+s.id);}
const song=GUITAR_SONGS.find(s=>s.id==='recuerdos');song.fingering=GUITAR_PLAN_CACHE.recuerdos;const P=G.plan(song);assert(N.available(P));
let attacks=0;
for(let i=0;i<song.notes.length;i++){
 const n=song.notes[i],a=song.fingering.assignments[i],t=n[0]+.001,T=N.leftTargets(P,t);
 let highest=0;
 for(let f=0;f<4;f++)if(T[f].contact){const held=P.lhByFinger[f+1].findLast(q=>q.t<=t+1e-9);if(held&&(held.barreGroup?.strings||[held.string]).includes(a.string))highest=Math.max(highest,held.fret);}
 assert.equal(highest,a.fret,`Note ${i} at ${t}: an open/lower string is muted or its fretting finger is absent`);attacks++;
}
const stationary={};
for(const bar of [3,7,8,23,24]){
 const states=[];for(let t=(bar-1)*180/74+.2;t<bar*180/74-.2;t+=.05)states.push(G.pose(P,t).hands[0]);
 const span=points=>1000*Math.max(...points.flatMap(a=>points.map(b=>Math.hypot(...a.map((v,i)=>v-b[i])))));
 const wrist=span(states.map(h=>h.wrist));assert(wrist<.01,'A repeated chord still moves the wrist in bar '+bar);
 const fingers=[0,2,3].map(f=>span(states.map(h=>h.fingers[f].points[3])));
 if(bar===3||bar===7||bar===8)assert(fingers.every(d=>d<.01),'A held chord still lifts its fingers in bar '+bar);
 stationary[bar]={wristRangeMm:wrist,fingertipRangeMm:fingers};
}
const c=song.leftHandPhrases.find(p=>p.bars.includes(7));assert.deepEqual(c.barre,[1,5]);
for(const [pitch,role,string,fret,finger]of [[48,'p',5,3,1],[55,'p',4,5,3],[64,'p',2,5,4],[67,'m',1,3,1]])assert(c.stops.some(q=>q.pitch===pitch&&q.role===role&&q.string===string&&q.fret===fret&&q.finger===finger),'C-major barre shape is wrong');
assert.equal(N.stats().fits,0);
console.log(JSON.stringify({attacksChecked:attacks,openAndLowerStringsUnmuted:true,regions:song.leftHandPhrases.length,heldFingerIntervals:Object.values(P.lhByFinger).reduce((n,a)=>n+a.length,0),stationary,unchangedOtherSongs:5,runtimeFits:0},null,2));

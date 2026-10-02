const fs=require('fs'),vm=require('vm'),assert=require('assert');let c={window:null};c.window=c;vm.createContext(c);vm.runInContext(fs.readFileSync('dist/pedal.js','utf8'),c);const P=c.PianoPedal,n=[0,.3,60,100,0,2],song=pedals=>({pedals,duration:12}),profile=s=>P.envelope(s,n),at=(s,t)=>P.levelAt(profile(s),t);
const dry=song([]),sustained=song([[.2,127],[4.1,0]]);
assert(Math.abs(at(dry,.15)-at(sustained,.15))<1e-9,'Pedal should not damp a held key');
assert(at(dry,1)===0,'Released unpedalled note should stop');
assert(at(sustained,3)>.3,'Sustain must survive past the old 2.5-second cap');
assert(at(sustained,4.05)>.2&&at(sustained,4.5)===0,'Pedal-up damps the released strings');
const heldNote=[0,5,60,100,0,2],upWhileHeld=song([[0,127],[.6,0]]);
const a=P.envelope(upWhileHeld,heldNote),b=P.envelope(dry,heldNote);assert(Math.abs(P.levelAt(a,1)-P.levelAt(b,1))<1e-9,'Pedal-up must not cut a physically held note');
const caught=song([[.34,127],[2,0]]);assert(at(caught,.7)>.01&&at(caught,.7)>at(dry,.7),'Re-pedalling catches an undamped tail');assert(at(caught,.7)<at(sustained,.7),'Re-pedalling does not restore lost energy');
const partial=song([[0,47],[3,0]]);assert(at(partial,.7)>at(dry,.7)&&at(partial,.7)<at(sustained,.7),'Partial pedal has partial damping');
for(let speed of [.5,1,1.25]){let e=P.envelope(sustained,n,speed);assert(e.points.some(p=>p.t===4.1),'Pedal release retains its score timestamp at every speed');for(let i=1;i<e.points.length;i++){assert(e.points[i].t>e.points[i-1].t);assert(e.points[i].level>0)}}
for(let [t,down] of [[.19,false],[.2,true],[4.09,true],[4.1,false]]){assert.equal(P.state(sustained,t).down,down);assert.equal(P.state(sustained,t).position,t===.2?1:t===4.1?0:P.state(sustained,t).position)}
let last=P.state(sustained,.14).position;for(let t=.14;t<=.2;t+=.001){let p=P.state(sustained,t).position;assert(p>=last-1e-9&&p>=0&&p<=1);last=p}
const songsContext={window:null};songsContext.window=songsContext;vm.createContext(songsContext);vm.runInContext(fs.readFileSync('dist/songs.js','utf8'),songsContext);let checks=0;
for(let s of songsContext.SONGS){for(let [t,v] of s.pedals){assert.equal(P.state(s,t+.00000001).down,v>=64);assert(Math.abs(P.state(s,t).position-v/127)<1e-8);checks++}for(let i=0;i<s.notes.length;i+=120){let e=P.envelope(s,s.notes[i]);for(let point of e.points)assert(Number.isFinite(point.t)&&Number.isFinite(point.level));}}
console.log(JSON.stringify({pedalEvents:checks,noteOffPedalState:true,longSustain:true,pedalUpDamping:true,heldKeyUnaffected:true,repedalling:true,partialPedal:true,speedSynchronization:true,footPedalTimeline:true}));

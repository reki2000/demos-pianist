'use strict';
// Offline retargeting to the violin B skeleton. Unreachable chords are rolled
// with synchronized notes, contacts and short damper-pedal bridges.
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');global.window=globalThis;
vm.runInThisContext(fs.readFileSync('dist/songs.js','utf8'));vm.runInThisContext(fs.readFileSync('dist/motion.js','utf8'));
const template=JSON.parse(fs.readFileSync('piano-hand-template.json'));
const stamp=crypto.createHash('sha256').update(fs.readFileSync(__filename)).update(fs.readFileSync('dist/motion.js')).update(fs.readFileSync('piano-hand-template.json')).digest('hex');
const dir=process.env.PIANO_HAND_WORK||'/tmp/piano-shared-hand-build';fs.mkdirSync(dir,{recursive:true});
let totalRolls=0,maxError=0;
for(const song of SONGS){const source=template.songs[song.id];assert.equal(crypto.createHash('sha256').update(JSON.stringify(source.notes)).digest('hex'),source.audioHash,'Template audio events differ');song.notes=source.notes.map(n=>n.slice());song.pedals=source.pedals;const file=path.join(dir,song.id+'.json');if(fs.existsSync(file)&&JSON.parse(fs.readFileSync(file)).stamp===stamp){const saved=JSON.parse(fs.readFileSync(file));song.motion=saved.motion;totalRolls+=saved.rolls;maxError=Math.max(maxError,saved.maxError);console.error(song.id+' cached');continue;}
 const audio=JSON.stringify(song.notes),keyEvents=source.hands.flatMap(h=>h.frames.flatMap(fr=>fr.notes.map(n=>({t:n.t,end:n.end,pitch:n.pitch})))).sort((a,b)=>a.t-b.t),cache=new Map();let rolls=0,localError=0,retained=0,rejected=0;
 for(let h=0;h<2;h++){
  const old=source.hands[h],frames=[],kept=new Set(),dropped=new Set();
  const fit=(notes,reference)=>{const key=h+':'+notes.map(n=>n.pitch+'/'+n.f).join(','),cached=cache.get(key);if(cached)return cached;
   let best=PianoMotion.fitHangingPalm(notes,h,reference),error=p=>Math.max(...notes.map(n=>PianoMotion.pressFinger(p,h,n.f,n.pitch).error)),e=error(best);
   if(e>.002)for(const yaw of [0,-.3,.3]){const x=notes.reduce((v,n)=>v+PianoMotion.keyboard.map.get(n.pitch).x,0)/notes.length,p=PianoMotion.fitHangingPalm(notes,h,{x,y:1.068,z:-.56,yaw,pitch:0}),ee=error(p);if(ee<e){best=p;e=ee;}}
   const result={palm:best,error:e};cache.set(key,result);return result;};
  const divide=(notes,reference)=>{const solved=fit(notes,reference);if(solved.error<.0045||notes.length===1){assert(solved.error<.006,'Unreachable single key: '+song.id+' '+solved.error);return[{notes,solved}];}const mid=Math.ceil(notes.length/2);return[...divide(notes.slice(0,mid),reference),...divide(notes.slice(mid),reference)];};
  for(let i=0;i<old.frames.length;i++){
   const fr=old.frames[i],shared=fr.prepared?fit(fr.prepared,fr.palm):null;let preserve=shared&&shared.error<.0035;if(preserve){const solved=fr.prepared.map(n=>PianoMotion.pressFinger(shared.palm,h,n.f,n.pitch));for(let a=0;a<solved.length;a++)for(let b=a+1;b<solved.length;b++)if(PianoMotion.fingerGap(solved[a],solved[b])<.015)preserve=false;}if(fr.position!==undefined)(preserve?kept:dropped).add(fr.position);const groups=preserve?[{notes:fr.notes,solved:shared}]:divide(fr.notes,fr.palm),gap=(old.frames[i+1]?.t??fr.t+.3)-fr.t,step=Math.min(.040,gap/(groups.length+1));if(groups.length>1)rolls++;
   for(let j=0;j<groups.length;j++){const g=groups[j],t=fr.t+j*step,palm={...g.solved.palm};localError=Math.max(localError,g.solved.error);const notes=g.notes.map(n=>({...n,t,z:PianoMotion.pressFinger(palm,h,n.f,n.pitch).contactZ}));frames.push({t,palm,notes,crossing:!!fr.crossing,passing:fr.passing,visualRoll:groups.length>1,position:preserve?fr.position:undefined,prepared:preserve?fr.prepared:undefined});}
  }
  for(let i=0;i<frames.length;i++){const fr=frames[i],next=frames[i+1];for(const n of fr.notes){if(next){const d=Math.abs(next.palm.x-fr.palm.x),lead=Math.min(.14,.025+d*.6);n.end=Math.max(n.t+.003,Math.min(n.end,next.t-lead));}n.releaseEnd=Math.min(n.end+.12,next?.t??Infinity);n.approachStart=Math.max(n.t-.10,frames[i-1]?Math.max(...frames[i-1].notes.map(n=>n.end)):0);delete n.independentEnd;}}
  retained+=kept.size;rejected+=dropped.size;song.motion.hands[h]={frames,fingers:Array.from({length:5},(_,f)=>frames.flatMap(fr=>fr.notes.filter(n=>n.f===f)))};
 }
 song.motion.sharedPositions={retained,rejected};song.motion.keyEvents=keyEvents;song.motion.maxKeyEventDuration=Math.max(...keyEvents.map(n=>n.end-n.t));song.motion.version=14;song.motion.handStamp=stamp;song.motion.handProportions='violin-B-20';song.motion.visualRolledChords=rolls;
 assert.equal(JSON.stringify(song.notes),audio,'Audio events changed');maxError=Math.max(maxError,localError);totalRolls+=rolls;fs.writeFileSync(file,JSON.stringify({stamp,motion:song.motion,rolls,maxError:localError}));console.error(song.id+' rolls='+rolls+' error='+localError);
}
// Apply the same rolled contacts to sound and keys. Never discard a pitch.
let movedNotes=0,maxDelay=0,bridgeCount=0;
for(const S of SONGS){const source=template.songs[S.id],events=new Map(),keyEvents=[],bridges=[];
 for(let h=0;h<2;h++){
  const originals=source.hands[h].frames;let i=0;
  for(const fr of S.motion.hands[h].frames){while(i+1<originals.length&&originals[i+1].t<=fr.t+1e-9)i++;const original=originals[i];
   for(const n of fr.notes){const old=original.notes.find(o=>o.f===n.f&&o.pitch===n.pitch);assert(old,'Lost source contact');n.t=fr.visualRoll?Math.max(old.t,fr.t):old.t;n.end=Math.max(n.t+.003,n.end);n.sourceTime=old.t;events.set(h+'/'+old.t+'/'+n.pitch+'/'+n.f,{n,old,rolled:fr.visualRoll});}
  }
  S.motion.hands[h].fingers=Array.from({length:5},(_,f)=>S.motion.hands[h].frames.flatMap(fr=>fr.notes.filter(n=>n.f===f)));
  for(let j=0;j<originals.length;j++){const original=originals[j],first=events.get(h+'/'+original.notes[0].t+'/'+original.notes[0].pitch+'/'+original.notes[0].f);if(!first?.rolled)continue;
   const last=Math.max(...original.notes.map(n=>events.get(h+'/'+n.t+'/'+n.pitch+'/'+n.f).n.t)),end=Math.min(originals[j+1]?.t??S.duration,Math.max(...original.notes.map(n=>n.end)));
   if(end>last+.004)bridges.push([original.t+.001,end-.001]);
  }
 }
 S.notes=source.notes.map(note=>{const out=note.slice(),e=events.get(note[4]+'/'+note[0]+'/'+note[2]+'/'+note[5]);assert(e,'Missing performed note');if(e.rolled){out[6]=note[0];out[7]=note[1];out[0]=e.n.t;out[1]=Math.max(.003,Math.min(note[0]+note[1],e.n.end)-out[0]);if(out[0]>note[0]+1e-9)movedNotes++;maxDelay=Math.max(maxDelay,out[0]-note[0]);}keyEvents.push({t:out[0],end:e.rolled?out[0]+out[1]:e.old.end,pitch:out[2]});return out;}).sort((a,b)=>a[0]-b[0]||a[2]-b[2]);
 const timeline=new Map();for(const [t,value] of source.pedals){const row=timeline.get(t)||{delta:0};row.value=value;timeline.set(t,row);}for(const [start,end] of bridges){for(const [t,d] of [[start,1],[end,-1]]){const row=timeline.get(t)||{delta:0};row.delta+=d;timeline.set(t,row);}}
 let level=0,held=0,lastValue=-1;S.pedals=[];for(const [t,row] of [...timeline].sort((a,b)=>a[0]-b[0])){if(row.value!==undefined)level=row.value;held+=row.delta;const value=held>0?127:level;if(value!==lastValue){S.pedals.push([t,value]);lastValue=value;}}
 keyEvents.sort((a,b)=>a.t-b.t);S.motion.keyEvents=keyEvents;S.motion.maxKeyEventDuration=Math.max(...keyEvents.map(n=>n.end-n.t));S.performance={mode:'compact-hand-rolled-chords',sourceHash:source.audioHash,rolledChords:S.motion.visualRolledChords,pedalBridges:bridges.length};bridgeCount+=bridges.length;S.motion.handStamp=stamp;
}
fs.writeFileSync('dist/songs.js','window.SONGS='+JSON.stringify(SONGS)+';');console.log(JSON.stringify({songs:SONGS.length,visualRolledChords:totalRolls,maxFrameContactError:maxError,pitchesAndFingeringsPreserved:true,movedNotes,maxOnsetDelay:maxDelay,pedalBridges:bridgeCount}));

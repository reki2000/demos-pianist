'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),crypto=require('node:crypto');
process.chdir(__dirname);global.window=globalThis;
for(const f of ['guitar-songs','guitar-fingering','guitar-motion','guitar-hands','guitar-hand-frames','guitar-plans','bow-hand','violin-fingering','violin-songs','violin-model','violin-hand','violin-hand-frames','violin-motion'])
 vm.runInThisContext(fs.readFileSync(`dist/instruments/${f}.js`,'utf8'),{filename:f});
const sha=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const noteHashes=JSON.parse(fs.readFileSync('guitar-note-hashes.json'));
const planHashes=JSON.parse(fs.readFileSync('docs/verification/repertoire/unchanged-guitar-plans.json'));
for(const song of GUITAR_SONGS){assert.equal(sha(song.notes),noteHashes[song.id],'Guitar note data changed');if(song.id!=='recuerdos')assert.equal(sha(GUITAR_PLAN_CACHE[song.id]),planHashes[song.id],'Unrelated guitar plan changed');}
const song=GUITAR_SONGS.find(s=>s.id==='recuerdos');song.fingering=GUITAR_PLAN_CACHE[song.id];
const A=song.fingering.assignments,opening=[[5,0,0],[2,5,4],[2,5,4],[2,5,4],[4,2,1],[2,5,4],[2,5,4],[2,5,4],[3,5,3],[2,5,4],[2,5,4],[2,5,4],[4,2,1],[2,5,4],[2,5,4],[2,5,4],[3,4,3],[2,3,2],[2,3,2],[2,3,2],[4,2,1],[2,3,2],[2,3,2],[2,3,2]];
assert.deepEqual(A.slice(0,24).map(a=>[a.string,a.fret,a.lh]),opening,'Opening TAB/source fingering regressed');
let melody=0,thumb=0,equivalentBarres=0;
for(let i=0;i<song.notes.length;i++){
 const role=song.fingeringHints[i]?.role;if(!role)continue;
 const a=A[i];if(role==='p'){assert.equal(a.rh,'p','Accompaniment must use thumb');thumb++;}
 else assert.equal(a.rh,['a','m','i'][melody++%3],'Tremolo must rotate a-m-i');
}
for(const [i,h]of Object.entries(song.fingeringHints)){
 const a=A[i];if(h.string!=null)assert.equal(a.string,h.string,'Explicit source string changed');
 if(h.lh!=null&&a.lh!==h.lh){assert(a.lh===1&&a.barre,'Only equivalent held index barre may replace source finger');equivalentBarres++;}
}
const validation=GuitarFingering.validate(song);
for(const k of ['pitchErrors','unplayable','stringConflicts','fingerConflicts','rhSameFingerMelody','rhThumbOnTreble','barreErrors'])assert.equal(validation[k],0,k);
const guitarPlan=GuitarMotion.plan(song);assert(GuitarHands.available(guitarPlan),'Missing rebuilt Alhambra hand trajectories');
// Real position changes use the next region's shape rather than extending an
// old full-bar barre under the next note. Stationary shapes are audited by
// guitar-chord-grip-test.cjs against every actual note attack.
assert(song.leftHandPhrases.some(p=>p.bars.includes(7)&&p.bars.includes(8)));

const violin=VIOLIN_SONGS.find(s=>s.id==='bach-preludio');assert(violin);assert.equal(VIOLIN_SONGS.length,4);
const midi=require('./midi.cjs').readMidi(fs.readFileSync('repertoire-sources/preludio.mid'));
const raw=midi.tracks.flatMap(t=>t.notes).sort((a,b)=>a.beat-b.beat||a.pitch-b.pitch);
assert.equal(raw.length,1635);assert.equal(violin.notes.length,raw.length);
for(let i=0;i<raw.length;i++){const n=violin.notes[i],o=raw[i];assert.equal(n[2],o.pitch);assert.equal(n[3],o.velocity);assert(Math.abs(n[0]-o.beat/2)<.000006);assert(Math.abs(n[1]-o.length/2)<.000006);}
assert.equal(violin.scoreMetadata.tempos[0].bpm,120);
const P=ViolinMotion.plan(violin);assert(ViolinMotion.NH.available(P),'Missing precomputed fast violin hand');
const fp=ViolinFingering.assign(violin);assert.equal(fp.stats.collisionsLeft,0,'Unplayable violin overlap');
const groups=new Map();for(const n of P.notes){assert.equal(ViolinFingering.STRINGS[n.string].open+n.semi,n.pitch);assert(n.finger>=0&&n.finger<=4);if(!groups.has(n.t0))groups.set(n.t0,n);}
let previous=null;for(const n of groups.values()){if(previous){assert.notEqual(n.bowId,previous.bowId,'Fast notes merged into long bow stroke');assert.notEqual(n.bow,previous.bow);}previous=n;}
for(const n of P.notes){const S=ViolinMotion.at(P,n.t0);assert.equal(S.handL.model,'natural');assert(S.handL.fingers.every(f=>f.points.flat().every(Number.isFinite)));}
assert.equal(ViolinMotion.NH.stats().solves,0);assert.equal(GuitarHands.stats().fits,0);
console.log(JSON.stringify({guitar:{unchangedSourceNotes:true,unchangedOtherPlans:5,sourceHints:Object.keys(song.fingeringHints).length,equivalentBarres,melody,thumb,validation},violin:{id:violin.id,notes:raw.length,bpm:120,duration:violin.duration,strokes:fp.stats.strokes,stats:fp.stats},runtimeFits:0},null,2));

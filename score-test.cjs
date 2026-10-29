const fs=require('fs'),vm=require('vm'),assert=require('assert');global.window=global;vm.runInThisContext(fs.readFileSync('dist/songs.js','utf8'));vm.runInThisContext(fs.readFileSync('dist/score.js','utf8'));
const song=(notes,n=4,d=4)=>({notes,scoreMetadata:{tempos:[{time:0,beat:0,bpm:60}],timeSignatures:[{beat:0,numerator:n,denominator:d}],keySignatures:[]}}),notes=(times,dur=.4)=>times.map((t,i)=>[t,dur,64+i%4,80,0,1]);
let simple=PianoScore.model(song(notes([0,.5,1,1.5,2,2.5,3,3.5])));assert.equal(simple.beams.length,4);assert(simple.beams.every(b=>b.clusters.length===2));
let compound=PianoScore.model(song(notes([0,.5,1,1.5,2,2.5]),6,8));assert.equal(compound.beams.length,2);assert(compound.beams.every(b=>b.clusters.length===3));
assert.equal(PianoScore.model(song(notes([0,.75]))).beams.length,0,'Rest must break beam');assert.equal(PianoScore.model(song(notes([0,1],.95))).beams.length,0,'Quarters cannot be beamed');
let chord=song([...notes([0,.5]),[0,.4,72,80,0,3],[.5,.4,74,80,0,4]].sort((a,b)=>a[0]-b[0]));let m=PianoScore.model(chord);assert.equal(m.beams.length,1);assert.equal(m.beams[0].clusters.length,2);assert.equal(m.beams[0].clusters[0].notes.length,2);
let mixed=PianoScore.model(song([[0,.22,64,80,0,1],[.25,.22,65,80,0,2],[.5,.44,67,80,0,3]]));assert.equal(mixed.beams.length,1);assert.deepEqual(mixed.beams[0].clusters.map(c=>c.flags),[2,2,1]);
let groups=0;for(const s of SONGS){for(const b of PianoScore.model(s).beams){assert(b.clusters.length>1);assert(b.clusters.every(c=>c.flags>0));assert(b.clusters.every(c=>c.lane===b.clusters[0].lane));assert(b.clusters.every(c=>c.cell===b.clusters[0].cell));groups++}}
// Written pitches follow the key signature; accidentals last for one measure.
const keyed=(ns,fifths)=>({notes:ns,scoreMetadata:{tempos:[{time:0,beat:0,bpm:60}],timeSignatures:[{beat:0,numerator:4,denominator:4}],keySignatures:[{beat:0,fifths}]}});
const ks=PianoScore.keyGlyphs(3),kf=PianoScore.keyGlyphs(-2);
assert.equal(ks.map(x=>x.symbol).join(''),'♯♯♯');assert.equal(kf.map(x=>x.symbol).join(''),'♭♭');
assert.deepEqual(PianoScore.keyAccidentals(2),[1,0,0,1,0,0,0]);
assert.deepEqual(PianoScore.keyAccidentals(-2),[0,0,-1,0,0,0,-1]);
let sharpScore=keyed([[0,.3,66,80,0,1],[.5,.3,61,80,0,1],[1,.3,65,80,0,1],[1.5,.3,65,80,0,1],[2,.3,66,80,0,1],[4,.3,65,80,0,1]],2);
assert.deepEqual(PianoScore.model(sharpScore).map(x=>x.spelling.accidental),[null,null,'♮',null,'♯','♮']);
let flatScore=keyed([[0,.3,70,80,0,1],[.5,.3,63,80,0,1],[1,.3,71,80,0,1]],-2);
assert.deepEqual(PianoScore.model(flatScore).map(x=>x.spelling.accidental),[null,null,'♮']);
let unusual=keyed([[0,.3,60,80,0,1],[.5,.3,65,80,0,1]],7);
assert.equal(PianoScore.model(unusual)[0].spelling.accidental,null,'B-sharp belongs to C-sharp major');
assert.equal(PianoScore.model(unusual)[1].spelling.accidental,null,'E-sharp belongs to C-sharp major');
let keyChange=keyed([[0,.3,66,80,0,1],[4,.3,66,80,0,1]],1);
keyChange.scoreMetadata.keySignatures.push({beat:4,fifths:0});
assert.deepEqual(PianoScore.model(keyChange).map(e=>e.spelling.accidental),[null,'♯'],'Key changes reset the accidental state');
// Lower-staff clef changes: a left-hand cluster whose top tone needs a
// fourth ledger line in bass clef is written in a temporary treble clef,
// and the staff is back in bass clef once the top tone fits again.
let clefChanges=0;
for(const s of SONGS){let {clefOf,starts}=PianoScore.clefsOf(s);clefChanges+=starts.size;
 for(const cl of PianoScore.model(s).clusters){if(!cl.notes[0].n[4])continue;
  let mx=Math.max(...cl.notes.map(e=>e.spelling.diatonic)),clef=clefOf.get(cl);
  if(mx>40)assert.equal(clef,'treble',s.id+' beat '+cl.beat+': high LH cluster must be in treble clef');
  if(mx<=36)assert.equal(clef,'bass',s.id+' beat '+cl.beat+': settled LH cluster must be in bass clef');}}
let heroSong=SONGS.find(s=>s.id==='hero'),heroClefs=PianoScore.clefsOf(heroSong),heroLH=PianoScore.model(heroSong).clusters.filter(cl=>cl.notes[0].n[4]===1);
let heroStart=heroLH.find(cl=>Math.abs(cl.beat-130.75)<.06),heroHigh=heroLH.find(cl=>Math.abs(cl.beat-131.13)<.06),heroBack=heroLH.find(cl=>Math.abs(cl.beat-131.56)<.06);
assert.equal(heroClefs.clefOf.get(heroHigh),'treble','hero beats 131: LH chord group takes the temporary treble clef');
assert.equal(heroClefs.clefOf.get(heroBack),'bass','hero beats 131.5: LH scale is back in bass clef');
assert(heroClefs.starts.has(heroStart)&&heroClefs.clefOf.get(heroStart)==='treble'&&heroClefs.starts.has(heroBack),'clef changes are announced at the first cluster of each run');
// Chord folding: no two clusters of one hand may sit within the fold
// tolerance across the lane split with their nearest tones an octave
// or less apart -- such pairs are one broken-chord figure and must
// have been folded into a single chord (grace notes excepted).
let graceTotal=0;
for(const s of SONGS){const m=PianoScore.model(s);graceTotal+=m.clusters.filter(c=>c.grace).length;
 for(const hand of [0,1]){const arr=m.clusters.filter(c=>c.notes[0].n[4]===hand).sort((a,b)=>a.beat-b.beat);
  for(let i=0;i<arr.length;i++)for(let j=i+1;j<arr.length&&arr[j].beat-arr[i].beat<.045;j++){
   const a=arr[i],b=arr[j];if(a.lane===b.lane||a.grace||b.grace)continue;
   const A=a.notes.map(e=>e.n[2]),B=b.notes.map(e=>e.n[2]);
   const gap=Math.max(...A)<Math.min(...B)?Math.min(...B)-Math.max(...A):Math.max(...B)<Math.min(...A)?Math.min(...A)-Math.max(...B):0;
   assert(gap>12,'unfolded split chord in '+s.id+' @'+a.beat)}}}
// Grace notes are rare ornaments, not a texture: the conservative
// rule (a lone note crushed just before a lone main note) must keep
// the total tiny, and liebestraum's acciaccatura must be one of them.
assert(graceTotal>=1&&graceTotal<=2,'grace cluster total '+graceTotal);
assert(PianoScore.model(SONGS.find(s=>s.id==='liebestraum')).clusters.some(c=>c.grace),'liebestraum grace note');
console.log(JSON.stringify({beamGroups:groups,simpleMeter:true,compoundMeter:true,restsBreakBeams:true,quarterNotesUnbeamed:true,chordStems:true,mixedSecondaryBeams:true,keySignatures:true,measureAccidentals:true,lowerStaffClefChanges:clefChanges}));

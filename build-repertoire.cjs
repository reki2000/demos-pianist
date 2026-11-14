'use strict';
// Rebuild the two host repertoire adaptations without changing existing notes.
// Inputs and licences: repertoire-sources/README.md. Then regenerate the offline
// guitar plans and guitar/violin hand trajectories before shipping.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {readMidi}=require('./midi.cjs');
process.chdir(__dirname);global.window=globalThis;
for(const name of ['guitar-songs','violin-songs'])vm.runInThisContext(fs.readFileSync(`dist/instruments/${name}.js`,'utf8'));
const round=x=>Math.round(x*1e5)/1e5;
const source=fs.readFileSync('repertoire-sources/recuerdos.ly','utf8');

// This is a deliberately small reader for this pinned LilyPond edition, not a
// general LilyPond interpreter. Top pitches are aligned by sequence; bottom
// accompaniment has a regular eighth-note grid. Repeats are not unfolded, to
// retain the application's existing note data. Chord-voice differences at the
// coda are left to the regular engine rather than inventing source fingerings.
function voice(name,next){
 return source.split(`${name} = \\relative c`)[1].split(`${next} =`)[0]
  .replace(/##[tf]/g,'').replace(/%[^\n]*/g,'')
  .replace(/\\key\s+[a-g](?:is|es)?\s+\\(?:major|minor)/g,'')
  .replace(/#?'?\([^)]*\)/g,'').replace(/"[^"\n]*"/g,'')
  .replace(/\\[A-Za-z][A-Za-z-]*/g,'');
}
function parse(text,rests=false){
 const re=/(?<![A-Za-z])([a-gs])(is|es)?([',]*)(\d+)?(\.*)(?:-(\d))?(?:\\([1-6]))?(?![A-Za-z])/g;
 const diat={c:0,d:1,e:2,f:3,g:4,a:5,b:6},semitone={c:0,d:2,e:4,f:5,g:7,a:9,b:11};
 let previous=21,beat=0,length=.5;const out=[];
 for(const m of text.matchAll(re)){
  if(m[4])length=4/Number(m[4])*(m[5]?2-2**(-m[5].length):1);
  if(m[1]==='s'){if(rests)beat+=length;continue;}
  let step=7*Math.floor(previous/7)+diat[m[1]];
  while(step-previous>3)step-=7;while(step-previous< -3)step+=7;
  step+=7*([...m[3]].filter(c=>c==="'").length-[...m[3]].filter(c=>c===',').length);previous=step;
  const pitch=12*(Math.floor(step/7)+1)+semitone[m[1]]+(m[2]==='is'?1:m[2]==='es'?-1:0);
  const hint={};if(m[6]!=null)hint.lh=Number(m[6]);if(m[7]!=null)hint.string=Number(m[7]);
  out.push({pitch,beat,hint});if(rests)beat+=length;
 }
 return out;
}
const guitar=GUITAR_SONGS.find(s=>s.id==='recuerdos'),top=parse(voice('top','pedal')),bottom=parse(voice('bottom','dynamics'),true);
// LCS tolerates the source's independent final chord voices and three MIDI
// notes that have no separate counterpart in the top voice. No pitches move.
const a=top.map(n=>n.pitch),b=guitar.notes.map(n=>n[2]);
const dp=Array.from({length:a.length+1},()=>new Uint16Array(b.length+1));
for(let i=a.length-1;i>=0;i--)for(let j=b.length-1;j>=0;j--)
 dp[i][j]=a[i]===b[j]?1+dp[i+1][j+1]:Math.max(dp[i+1][j],dp[i][j+1]);
const pairs=[];let i=0,j=0;
while(i<a.length&&j<b.length){if(a[i]===b[j]){pairs.push([i++,j++]);}else if(dp[i+1][j]>=dp[i][j+1])i++;else j++;}
assert.equal(top.length,1335,'Review the pinned source parser');assert.equal(pairs.length,1332,'Review source/MIDI alignment');
const hints={},melodyState=new Map(),innerState=new Map();
for(const [i,j]of pairs){
 const n=top[i],beat=guitar.notes[j][0]*74/60,trem=beat<162&&Math.abs(beat*2-Math.round(beat*2))>.001;
 if(Object.keys(n.hint).length){hints[j]={...n.hint};if(trem)melodyState.set(n.pitch,n.hint);}
 else if(trem&&melodyState.has(n.pitch))hints[j]={...melodyState.get(n.pitch)};
}
let innerMatches=0;
for(const n of bottom){
 const j=guitar.notes.findIndex(v=>Math.abs(v[0]*74/60-n.beat)<.001&&v[2]===n.pitch);
 if(j<0)continue;innerMatches++;
 if(Object.keys(n.hint).length)innerState.set(n.pitch,n.hint);
 const hint=innerState.get(n.pitch);if(hint)hints[j]={...hints[j],...hint};
}
assert.equal(innerMatches,272,'Review accompaniment alignment');
for(let j=0;j<guitar.notes.length;j++){
 const beat=guitar.notes[j][0]*74/60;
 if(beat<12&&Math.abs(beat*2-Math.round(beat*2))>.001)hints[j]={...hints[j],string:2};
 if(beat>=162)delete hints[j];
}
guitar.fingeringHints=hints;guitar.rightHandTremolo={bpm:74,endBeat:162};
// Bar 9: lift the eighth-fret barre before finger 2 takes string 2/fret 8;
// the index then moves to string 1/fret 7. Bar 52 similarly releases the
// second-fret barre before finger 2 takes over, freeing open string 1.
// Long MIDI holds must not keep a redundant barre under another finger.
for(let j=0;j<guitar.notes.length;j++){
 const beat=guitar.notes[j][0]*74/60;
 for(const [start,end]of [[24,26],[153,154]])if(beat>=start-1e-4&&beat<end-1e-4)
  hints[j]={...hints[j],releaseAt:round(end*60/74-.045)};
}
fs.writeFileSync('dist/instruments/guitar-songs.js',"'use strict';\n// Alhambra fingering references: build-repertoire.cjs and repertoire-sources/.\nwindow.GUITAR_SONGS="+JSON.stringify(GUITAR_SONGS)+';\n');

const midi=readMidi(fs.readFileSync('repertoire-sources/preludio.mid'));
const raw=midi.tracks.flatMap(t=>t.notes).sort((a,b)=>a.beat-b.beat||a.pitch-b.pitch),quarter=.5;
const notes=raw.map(n=>[round(n.beat*quarter),round(n.length*quarter),n.pitch,n.velocity]);
const end=Math.max(...raw.map(n=>n.beat+n.length));
const violin={id:'bach-preludio',title:'Preludio (Partita No. 3)',composer:'Johann Sebastian Bach',opus:'BWV 1006 · Allegro',
 timeSignature:[3,4],keySignature:{fifths:4},notes,
 beats:Array.from({length:Math.ceil(end)+1},(_,b)=>[round(b*quarter),1]),duration:round(end*quarter+1.2),
 // An explicit separate-stroke realization avoids the default long legato
 // merge on this continuous fast passage. These are our bowings, not encoded
 // slur information from the MIDI. Simultaneous notes form one stroke.
 slurs:notes.map(n=>[n[0],round(n[0]+Math.min(.01,n[1]))]),harmonics:[],maxPosition:10,
 scoreMetadata:{tempos:[{beat:0,time:0,bpm:120}],timeSignatures:midi.timeSignatures,keySignatures:midi.keySignatures},sourceNoteCount:notes.length};
const songs=VIOLIN_SONGS.filter(s=>s.id!==violin.id);songs.push(violin);
fs.writeFileSync('dist/instruments/violin-songs.js',"'use strict';\n// Includes Bach BWV 1006 Preludio; regenerate with build-repertoire.cjs.\nwindow.VIOLIN_SONGS="+JSON.stringify(songs)+';\n');
console.log(JSON.stringify({alhambra:{topMatches:pairs.length,innerMatches,hints:Object.keys(hints).length},violin:{id:violin.id,notes:notes.length,bpm:120,duration:violin.duration}},null,2));

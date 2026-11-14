'use strict';
// Rebuild the two host repertoire adaptations without changing existing notes.
// Inputs and licences: repertoire-sources/README.md. Then regenerate the offline
// guitar plans and guitar/violin hand trajectories before shipping.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {readMidi}=require('./midi.cjs');
process.chdir(__dirname);global.window=globalThis;
for(const name of ['guitar-songs','violin-songs'])vm.runInThisContext(fs.readFileSync(`dist/instruments/${name}.js`,'utf8'));
// The shipped Air is Bach’s original D-major register, not Wilhelmj’s
// transposed C-major G-string arrangement. Let the normal planner use A/E.
delete VIOLIN_SONGS.find(s=>s.id==='air').forceString;
const round=x=>Math.round(x*1e5)/1e5;
const guitar=GUITAR_SONGS.find(s=>s.id==='recuerdos');
const {phrases,locations,barStarts}=require('./alhambra-grips.cjs').build(guitar);
const hints={};
for(const [i,loc]of Object.entries(locations)){
 if(loc.bar>=54)continue;
 const p=phrases.find(p=>guitar.notes[i][0]>=p.startTime-1e-5&&guitar.notes[i][0]<p.endTime-1e-5);
 if(!p)throw Error('No hand shape for note '+i);
 const stop=p.stops.find(q=>q.pitch===guitar.notes[i][2]&&q.role===loc.role);
 if(!stop)throw Error('No stop for note '+i);
 hints[i]={string:stop.string,lh:stop.finger,pos:p.position,barre:stop.finger===1&&p.barre?1:0,role:loc.role,phrase:phrases.indexOf(p)};
}
for(let i=0;i<guitar.notes.length&&guitar.notes[i][0]<barStarts[54]-1e-5;i++)assert(hints[i],'Unmapped source note '+i);
guitar.fingeringHints=hints;guitar.leftHandPhrases=phrases;
guitar.rightHandTremolo={bpm:74,endBeat:162,endTime:barStarts[54]};
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
console.log(JSON.stringify({alhambra:{phrases:phrases.length,hints:Object.keys(hints).length},violin:{id:violin.id,notes:notes.length,bpm:120,duration:violin.duration}},null,2));

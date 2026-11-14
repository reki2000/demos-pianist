'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict');
function annotations(song){
const source=fs.readFileSync('repertoire-sources/recuerdos.ly','utf8');

// This reader is restricted to the pinned LilyPond edition: durations, tuplets
// and barlines are retained. Top pitches are aligned by sequence, and inner
// voices by written bar, offset and pitch. Repeats are not unfolded, to
// retain the application's existing note data. Chord-voice differences at the
// coda are left to the regular engine rather than inventing source fingerings.
function voice(name,next){
 return source.split(`${name} = \\relative c`)[1].split(`${next} =`)[0]
  .replace(/##[tf]/g,'').replace(/%[^\n]*/g,'')
  .replace(/\\key\s+[a-g](?:is|es)?\s+\\(?:major|minor)/g,'')
  .replace(/#?'?\([^)]*\)/g,'').replace(/"[^"\n]*"/g,'')
  .replace(/\\[A-Za-z][A-Za-z-]*/g,'');
}
function parse(text){
 const re=/(?<ratio>\d+\/\d+)|(?<control>[{}|])|(?<![A-Za-z])(?<note>[a-gs])(?<alter>is|es)?(?<octave>[',]*)(?<duration>\d+)?(?<dots>\.*)(?:-(?<finger>\d))?(?:\\(?<string>[1-6]))?(?![A-Za-z])/g;
 const diat={c:0,d:1,e:2,f:3,g:4,a:5,b:6},semitone={c:0,d:2,e:4,f:5,g:7,a:9,b:11};
 let previous=21,bar=0,withinBeat=0,length=.5,factor=1,pending=1;const stack=[],out=[];
 for(const match of text.matchAll(re)){
  const m=match.groups;if(m.ratio){const [a,b]=m.ratio.split('/').map(Number);pending=a/b;continue;}
  if(m.control){if(m.control==='|'){bar++;withinBeat=0;}else if(m.control==='{'){stack.push(factor);factor*=pending;pending=1;}else factor=stack.pop()??1;continue;}
  if(m.duration)length=4/Number(m.duration)*(m.dots?2-2**(-m.dots.length):1);
  if(m.note==='s'){withinBeat+=length*factor;continue;}
  let step=7*Math.floor(previous/7)+diat[m.note];while(step-previous>3)step-=7;while(step-previous< -3)step+=7;
  step+=7*([...m.octave].filter(c=>c==="'").length-[...m.octave].filter(c=>c===',').length);previous=step;
  const pitch=12*(Math.floor(step/7)+1)+semitone[m.note]+(m.alter==='is'?1:m.alter==='es'?-1:0),hint={};
  if(m.finger!=null)hint.lh=Number(m.finger);if(m.string!=null)hint.string=Number(m.string);
  out.push({pitch,bar,withinBeat,beat:bar*3+withinBeat,hint});withinBeat+=length*factor;
 }
 return out;
}
const guitar=song,top=parse(voice('top','pedal')),bottom=parse(voice('bottom','dynamics'));
// LCS tolerates the source's independent final chord voices and three MIDI
// notes that have no separate counterpart in the top voice. No pitches move.
const a=top.map(n=>n.pitch),b=guitar.notes.map(n=>n[2]);
const dp=Array.from({length:a.length+1},()=>new Uint16Array(b.length+1));
for(let i=a.length-1;i>=0;i--)for(let j=b.length-1;j>=0;j--)
 dp[i][j]=a[i]===b[j]?1+dp[i+1][j+1]:Math.max(dp[i+1][j],dp[i][j+1]);
const pairs=[];let i=0,j=0;
while(i<a.length&&j<b.length){if(a[i]===b[j]){pairs.push([i++,j++]);}else if(dp[i+1][j]>=dp[i][j+1])i++;else j++;}
assert.equal(top.length,1335,'Review the pinned source parser');assert.equal(pairs.length,1332,'Review source/MIDI alignment');
const hints={},locations={},barStarts=[];
for(const [i,j]of pairs){const n=top[i];locations[j]={bar:n.bar,withinBeat:n.withinBeat,role:roleAt(n.withinBeat)};if(Object.keys(n.hint).length)hints[j]={...n.hint};if(n.withinBeat<1e-5)barStarts[n.bar]=song.notes[j][0];}
for(const n of [...parse(voice('pedal','bottom')),...bottom]){
 const j=Object.keys(locations).find(j=>locations[j].bar===n.bar&&Math.abs(locations[j].withinBeat-n.withinBeat)<1e-4&&song.notes[j][2]===n.pitch);
 if(j!=null&&Object.keys(n.hint).length)hints[j]={...hints[j],...n.hint};
}
for(let j=0;j<song.notes.length;j++)if(!locations[j]){
 const same=Object.keys(locations).find(i=>Math.abs(song.notes[i][0]-song.notes[j][0])<1e-4);
 if(same)locations[j]={...locations[same],role:'p'};
}
return {hints,locations,barStarts};
}
// Index-fret regions follow the score's position changes, with explicit
// partial/full barre spans. A region is a hand shape, not a pluck event.
const POSITIONS=[2,1,2,2,3,3,3,3,8,3,4,4,5,2,3,1,2,1,1,1,2,2,2,2,2,10,2,2,2,4,4,4,2,2,2,2,1,1,1,1,2,2,1,2,2,2,1,1,2,2,2,2,2,2];
POSITIONS[36]=2;
const SPLITS={2:[[2,2]],4:[[2,5]],5:[[2,5]],6:[[2,5]],9:[[2,7]],10:[[2,5]],26:[[2,2]],14:[[2,5]],15:[[1,1]],37:[[1.5,1]],44:[[2,2]]};
const BARRES={5:[1,5],6:[1,5],7:[1,5],8:[1,5],9:[1,5],13:[1,2],18:[1,6],21:[2,4],22:[2,4],23:[2,4],24:[2,4],29:[1,6],30:[1,6],31:[2,5],32:[2,5],35:[3,4],36:[2,4],37:[3,4],41:[2,4],42:[2,4],44:[2,4],45:[3,4],46:[3,4],49:[2,4],50:[2,4],53:[2,4],54:[2,4]};
const OPEN=[0,64,59,55,50,45,40],roleAt=beat=>Math.abs(beat*2-Math.round(beat*2))<.001?'p':'m';
function build(song){
 const {hints,locations,barStarts}=annotations(song),phrases=[];let previous=null;
 for(let bar=1;bar<=POSITIONS.length;bar++){
  const marks=[[0,POSITIONS[bar-1]],...(SPLITS[bar]||[]),[3,0]];
  for(let region=0;region<marks.length-1;region++){
   const p={startBeat:(bar-1)*3+marks[region][0],endBeat:(bar-1)*3+marks[region+1][0],position:marks[region][1],bars:[bar]};
   if(BARRES[bar]&&region===0)p.barre=BARRES[bar];
   const timeAt=offset=>{if(!offset)return barStarts[bar-1];if(offset===3)return barStarts[bar];const id=Object.keys(locations).find(i=>locations[i].bar===bar-1&&Math.abs(locations[i].withinBeat-offset)<1e-4);if(id==null)throw Error('Missing source boundary '+bar+':'+offset);return song.notes[id][0];};
   p.startTime=timeAt(marks[region][0]);p.endTime=timeAt(marks[region+1][0]);
   const vars=new Map();
   for(let i=0;i<song.notes.length;i++){
    const n=song.notes[i],loc=locations[i];if(!loc||loc.bar!==bar-1||loc.withinBeat<marks[region][0]-1e-5||loc.withinBeat>=marks[region+1][0]-1e-5)continue;
    const role=loc.role,key=n[2]+role;if(!vars.has(key))vars.set(key,{key,pitch:n[2],role,ids:[]});vars.get(key).ids.push(i);
   }
   for(const v of vars.values()){
    const explicit=v.ids.map(i=>hints[i]).filter(Boolean);v.opts=[];
    for(let string=1;string<=6;string++){
     const fret=v.pitch-OPEN[string];if(fret<0||fret>p.position+4||fret>0&&fret<Math.max(1,p.position-1))continue;
     if(bar<=4&&v.role==='m'&&string!==2)continue;
     if(explicit.some(h=>h.string!=null&&h.string!==string)||explicit.some(h=>h.lh===0)&&fret)continue;
     if(p.barre&&string>=p.barre[0]&&string<=p.barre[1]&&fret<p.position)continue;
     for(const lh of fret?[1,2,3,4]:[0]){
      if(p.barre&&fret===p.position&&string>=p.barre[0]&&string<=p.barre[1]&&lh!==1)continue;
      let cost=fret?Math.abs(fret-(p.position+lh-1))**2*(lh===1?2:.4):-.8;
      cost+=explicit.filter(h=>h.lh!=null&&h.lh!==lh).length*2.5;
      if(v.role==='p'&&string===1)cost+=4;
      if(previous?.position===p.position&&previous.stops.some(q=>q.pitch===v.pitch&&q.role===v.role&&q.string===string&&q.finger===lh))cost-=2;
      v.opts.push({string,fret,finger:lh,cost});
     }
    }
    if(!v.opts.length)throw Error('No playable source region: bar '+bar+' '+v.key);
   }
   const arr=[...vars.values()].sort((a,b)=>a.opts.length-b.opts.length||b.ids.length-a.ids.length);let beam=[{cost:0,stops:[]}];
   for(const v of arr){const next=[];
    for(const state of beam)for(const o of v.opts){let cost=state.cost+o.cost;
     for(const q of state.stops){
      if(o.string===q.string&&o.fret!==q.fret&&v.role!==q.role){const old=vars.get(q.pitch+q.role);if(v.ids.some(i=>old.ids.some(j=>song.notes[i][0]<song.notes[j][0]+song.notes[j][1]-.005&&song.notes[j][0]<song.notes[i][0]+song.notes[i][1]-.005)))cost+=30;}
      if(o.finger&&o.finger===q.finger&&(o.fret!==q.fret||o.string!==q.string)){
       if(o.finger===1&&o.fret===q.fret)cost+=.2*Math.abs(o.string-q.string);
       else cost+=o.string===q.string?2+2*Math.abs(o.fret-q.fret):15+8*Math.abs(o.fret-q.fret);
      }
     }
     const stops=[...state.stops,{...o,pitch:v.pitch,role:v.role}];
     next.push({cost,stops});
    }
    next.sort((a,b)=>a.cost-b.cost);beam=next.slice(0,300);
   }
   p.stops=beam[0].stops.map(({cost,...q})=>q).sort((a,b)=>a.pitch-b.pitch||a.role.localeCompare(b.role));
   const last=phrases.at(-1);if(last&&last.position===p.position&&JSON.stringify(last.barre)===JSON.stringify(p.barre)&&JSON.stringify(last.stops)===JSON.stringify(p.stops)){last.endBeat=p.endBeat;last.endTime=p.endTime;last.bars.push(bar);previous=last;}
   else{phrases.push(p);previous=p;}
  }
 }
 return {phrases,annotations:hints,locations,barStarts,roleAt};
}
module.exports={build,roleAt};

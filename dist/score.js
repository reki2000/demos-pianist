(()=>{'use strict';
function tempoAt(s,t){let a=s.scoreMetadata.tempos,l=0,r=a.length;while(l<r){let m=(l+r)>>1;if(a[m].time<=t)l=m+1;else r=m}return a[Math.max(0,l-1)]}
function beatAt(s,t){let p=tempoAt(s,t);return p.beat+(t-p.time)*p.bpm/60}
function timeAt(s,b){let a=s.scoreMetadata.tempos,p=a[0];for(const q of a){if(q.beat>b)break;p=q}return p.time+(b-p.beat)*60/p.bpm}
const cache=new WeakMap(),sharpSteps=[0,0,1,1,2,3,3,4,4,5,5,6],flatSteps=[0,1,1,2,2,3,4,4,5,5,6,6];
function signatureAt(s,beat){let sig={beat:0,numerator:4,denominator:4};for(let q of s.scoreMetadata.timeSignatures)if(q.beat<=beat) sig=q;return sig}
function keyAt(s,beat){let key={beat:0,fifths:0};for(const q of s.scoreMetadata.keySignatures||[])if(q.beat<=beat)key=q;return key}
const sharpOrder=[3,0,4,1,5,2,6],flatOrder=[6,2,5,1,4,0,3]; // F C G D A E B / B E A D G C F
function keyAccidentals(fifths=0){
 const altered=Array(7).fill(0),order=fifths<0?flatOrder:sharpOrder;
 for(let i=0;i<Math.min(7,Math.abs(fifths));i++)altered[order[i]]=fifths<0?-1:1;
 return altered;
}
function spellPitch(p,fifths=0){
 const pc=((p%12)+12)%12,naturals=[0,2,4,5,7,9,11],defaults=keyAccidentals(fifths),
  preferred=(fifths<0?flatSteps:sharpSteps)[pc];
 let best=null;
 for(let letter=0;letter<7;letter++){
  let alteration=pc-naturals[letter];if(alteration>6)alteration-=12;if(alteration< -6)alteration+=12;
  if(Math.abs(alteration)>1)continue;
  const octave=(p-naturals[letter]-alteration)/12,
   cost=(alteration===defaults[letter]?0:10)+(alteration===0?0:.02)+
    ((fifths<0?alteration>0:alteration<0)?.2:0)+(letter===preferred?0:.1);
  if(!best||cost<best.cost)best={diatonic:octave*7+letter,letter,octave,alteration,cost};
 }
 return{diatonic:best.diatonic,letter:best.letter,octave:best.octave,alteration:best.alteration};
}
function keyGlyphs(fifths,bass=false){
 const sharpTreble=[0,3,-1,2,5,1,4],flatTreble=[4,1,5,2,6,3,7];
 const sharpBass=[2,5,1,4,7,3,6],flatBass=[6,3,7,4,8,5,9];
 const offsets=fifths<0?(bass?flatBass:flatTreble):(bass?sharpBass:sharpTreble);
 return Array.from({length:Math.min(7,Math.abs(fifths||0))},(_,i)=>({symbol:fifths<0?'♭':'♯',halfSteps:offsets[i]}));
}
function flagCount(duration){return duration<.21?3:duration<.42?2:duration<.85?1:0}
function model(s){if(cache.has(s))return cache.get(s);let m=s.notes.map(n=>({n,beat:beatAt(s,n[0]),duration:Math.max(.125,beatAt(s,n[0]+n[1])-beatAt(s,n[0]))})),lanes=Array.from({length:4},()=>[]),beams=[],clusters=[];
 for(const e of m){let lane=(e.n[2]<60?0:2)+e.n[4],arr=lanes[lane],last=arr.at(-1);if(last&&Math.abs(e.beat-last.beat)<.045)last.notes.push(e);else{last={beat:e.beat,notes:[e],lane};arr.push(last);clusters.push(last)}e.cluster=last;}
 // A chord whose tones straddle the middle-C lane split is still one chord:
 // fold the smaller same-hand cluster at the same beat into its partner so
 // the tones share a stem, flags and any beam. Only fold when the two
 // clusters last about as long as each other (not two real voices) and
 // their nearest tones are within an octave: distant high and low notes
 // keep separate flags (the same rule breaks beams below).
 for(let hand=0;hand<2;hand++){const pair=[lanes[hand],lanes[hand+2]];
  for(let li=0;li<2;li++){const arr=pair[li],other=pair[1-li];
   for(let i=arr.length-1;i>=0;i--){const cl=arr[i],partner=other.find(o=>Math.abs(o.beat-cl.beat)<.045);if(!partner)continue;
    const dA=Math.max(...cl.notes.map(e=>e.duration)),dB=Math.max(...partner.notes.map(e=>e.duration));
    if(Math.max(dA,dB)/Math.min(dA,dB)>1.6)continue;
    const psA=cl.notes.map(e=>e.n[2]),psB=partner.notes.map(e=>e.n[2]),gapAB=Math.max(...psA)<Math.min(...psB)?Math.min(...psB)-Math.max(...psA):Math.max(...psB)<Math.min(...psA)?Math.min(...psA)-Math.max(...psB):0;
    if(gapAB>12)continue;
    const home=(hand===0)===(li===0),winner=cl.notes.length!==partner.notes.length?(cl.notes.length>partner.notes.length?cl:partner):(home?cl:partner),loser=winner===cl?partner:cl;
    winner.notes.push(...loser.notes);for(const e of loser.notes)e.cluster=winner;
    const la=loser===cl?arr:other;la.splice(la.indexOf(loser),1);clusters.splice(clusters.indexOf(loser),1);
   }
  }
 }
 for(const lane of lanes){let group=[];const finish=()=>{if(group.length>1){let beam={clusters:group.slice()};beams.push(beam);for(const cl of group){cl.beam=beam;for(const e of cl.notes)e.beam=beam}}group=[]};
  for(let i=0;i<lane.length;i++){let cl=lane[i],next=lane[i+1],duration=Math.max(...cl.notes.map(e=>e.duration)),delta=next?next.beat-cl.beat:Infinity;
   // MIDI note-offs are often shorter than the written rhythmic value.
   if(delta<1.6&&duration>=delta*.64&&duration<=delta*1.10)duration=delta;
   cl.value=duration;cl.flags=flagCount(duration);for(const e of cl.notes)e.flags=cl.flags;cl.lo=Math.min(...cl.notes.map(e=>e.n[2]));cl.hi=Math.max(...cl.notes.map(e=>e.n[2]));
   let sig=signatureAt(s,cl.beat),unit=sig.denominator===8&&sig.numerator%3===0?1.5:4/sig.denominator,cell=Math.floor((cl.beat-sig.beat+.035)/unit),key=sig.beat+':'+cell,prev=group.at(-1);
   if(!cl.flags){finish();continue}if(prev&&(prev.cell!==key||cl.beat-prev.beat>Math.max(.62,prev.rhythm*1.4)||(cl.lo>prev.hi?cl.lo-prev.hi:prev.lo>cl.hi?prev.lo-cl.hi:0)>12))finish();cl.cell=key;cl.rhythm=duration;group.push(cl);
  }finish();
 }
 // A key signature applies to every octave; a bar's accidentals override it
 // for the same written pitch only until the next barline or key change.
 let measure=null,barAlterations=new Map();
 for(const e of m){
  const key=keyAt(s,e.beat),sig=signatureAt(s,e.beat),bar=sig.numerator*4/sig.denominator,
   measureId=sig.beat+':'+Math.floor((e.beat-sig.beat+1e-6)/bar)+':'+key.beat+':'+key.fifths;
  if(measure!==measureId){measure=measureId;barAlterations=new Map();}
  const written=spellPitch(e.n[2],key.fifths),id=written.diatonic;
  const initial=keyAccidentals(key.fifths)[written.letter],previous=barAlterations.has(id)?barAlterations.get(id):initial;
  e.spelling={...written,accidental:written.alteration===previous?null:written.alteration===0?'♮':written.alteration>0?'♯':'♭'};
  barAlterations.set(id,written.alteration);
 }
 m.beams=beams;m.clusters=clusters;cache.set(s,m);return m}
function render(canvas,s,t){let c=canvas.getContext('2d');if(!c)return;let w=canvas.clientWidth||900,h=canvas.clientHeight||180,d=Math.min(window.devicePixelRatio||1,2);if(canvas.width!==w*d||canvas.height!==h*d){canvas.width=w*d;canvas.height=h*d}c.setTransform(d,0,0,d,0,0);c.clearRect(0,0,w,h);c.fillStyle='#17191c';c.fillRect(0,0,w,h);let current=beatAt(s,t),px=w<600?49:66,key=keyAt(s,current),keyCount=Math.min(7,Math.abs(key.fifths||0)),
 keyStart=40,timeX=keyStart+Math.max(1,keyCount)*9+5,left=timeX+23,
 cursor=Math.max(left+20,Math.min(w*.32,260)),top=42,gap=7,staff2=top+72;
let line=(x,y,x2,y2,color='#6c655b',lw=1)=>{c.strokeStyle=color;c.lineWidth=lw;c.beginPath();c.moveTo(x,y);c.lineTo(x2,y2);c.stroke()};
for(let base of [top,staff2])for(let i=0;i<5;i++)line(8,base+i*gap,w,base+i*gap);c.fillStyle='#dfbe83';c.font='34px Georgia,serif';c.fillText('𝄞',10,top+30);c.fillText('𝄢',10,staff2+25);
let signature=signatureAt(s,current);
c.font='21px Georgia,serif';for(const [bass,base] of [[false,top],[true,staff2]])
 for(const [i,g] of keyGlyphs(key.fifths,bass).entries())c.fillText(g.symbol,keyStart+i*9,base+g.halfSteps*gap/2+6);
c.font='17px Georgia,serif';for(let base of [top,staff2]){c.fillText(signature.numerator,timeX,base+12);c.fillText(signature.denominator,timeX,base+29)}
let bar=signature.numerator*4/signature.denominator,start=Math.max(0,current-(cursor-left)/px),end=current+(w-cursor)/px;
for(let b=signature.beat+Math.ceil((start-signature.beat)/bar)*bar;b<end;b+=bar){let x=cursor+(b-current)*px;line(x,top,x,staff2+28,'#49453e');c.font='10px Arial';c.fillStyle='#a39a8c';c.fillText(String(Math.round((b-signature.beat)/bar)+1),x+4,top-10)}
let list=model(s),l=0,r=list.length;while(l<r){let m=(l+r)>>1;if(list[m].beat<start-.5)l=m+1;else r=m}
let active=s.notes.filter(n=>n[0]<=t&&n[0]+n[1]>t).map(n=>n[2]),glyphs=new Map();c.save();c.beginPath();c.rect(left,20,w-left,h-20);c.clip();
// Note geometry. Ledger lines carry a note up to five lines out; only
// beyond that does an 8va/8vb shift apply, and a shift is one diatonic
// octave (7 staff steps = 24.5px), so the head lands on the right line.
let geom=e=>{let p=e.n[2],bass=p<60,base=bass?staff2:top,y=base+28-(e.spelling.diatonic-(bass?25:37))*gap/2,shift=0;if(y<base-38){y+=24.5;shift=1}else if(y>base+66){y-=24.5;shift=-1}return{ax:cursor+(e.beat-current)*px,y,base,shift,dia:e.spelling.diatonic-shift*7,on:e.n[0]<=t&&e.n[0]+e.n[1]>t}};
let vis=[];for(let i=l;i<list.length&&list[i].beat<=end+.4;i++)vis.push(list[i]);
let G=new Map();for(const e of vis){let g=geom(e);g.color=g.on?'#ffcc70':'#d8d0c1';g.hx=g.ax;G.set(e,g)}
let groups=[];for(const e of vis){let lastG=groups.at(-1);if(lastG&&lastG.cl===e.cluster)lastG.items.push(e);else groups.push({cl:e.cluster,items:[e]})}
// Stem direction: a beamed group goes by majority, then by the note
// farthest from the middle line; a single cluster by its farthest note.
// Equidistant ties go down.
let dirOf=tones=>{let above=tones.filter(g=>g.y<g.base+14).length,below=tones.length-above;
 if(below>above)return true;if(above>below)return false;
 let far=tones.reduce((a,g)=>Math.abs(g.y-g.base-14)>Math.abs(a.y-a.base-14)?g:a);return far.y>far.base+14};
let beamUp=new Map();
for(const beam of list.beams){let tones=[];for(const cl of beam.clusters)for(const e of cl.notes){let g=G.get(e);if(g)tones.push(g)}if(tones.length)beamUp.set(beam,dirOf(tones))}
let layout=new Map();
for(const grp of groups){let cl=grp.cl,up=cl.beam&&beamUp.has(cl.beam)?beamUp.get(cl.beam):dirOf(grp.items.map(e=>G.get(e)));layout.set(cl,up);
 let subs=new Map();for(const e of grp.items){let g=G.get(e);if(!subs.has(g.base))subs.set(g.base,[]);subs.get(g.base).push(e)}
 for(const [base,items] of subs){
  // Seconds in a chord: heads alternate sides of the stem, displaced by a
  // head width, phased so the note on the stem's own side stays put (the
  // bottom note for stem-up, the top note for stem-down).
  let sorted=[...items].sort((a,b)=>G.get(a).dia-G.get(b).dia),chain=[];
  let flush=()=>{chain.forEach((e,i)=>{let side=up?i%2:(chain.length-1-i)%2;if(side)G.get(e).hx=G.get(e).ax+(up?8.5:-8.5)});chain=[]};
  for(const e of sorted){if(chain.length&&G.get(e).dia-G.get(chain.at(-1)).dia!==1)flush();chain.push(e)}flush();
  // Accidentals zig-zag into columns: the highest accidental sits closest
  // to the heads, then the lowest, then the next-highest; a column is
  // reused only for an accidental a seventh or more away.
  let accs=items.filter(e=>e.spelling.accidental);
  if(accs.length){let asc=[...accs].sort((a,b)=>a.spelling.diatonic-b.spelling.diatonic),order=[],i0=0,i1=asc.length-1,hi=true;
   while(i0<=i1){order.push(hi?asc[i1--]:asc[i0++]);hi=!hi}
   let cols=[],minLeft=Math.min(...items.map(e=>G.get(e).hx))-4.8;
   for(const e of order){let dia=e.spelling.diatonic,ci=cols.findIndex(col=>col.every(d2=>Math.abs(d2-dia)>=6));if(ci<0){cols.push([]);ci=cols.length-1}cols[ci].push(dia);
    G.get(e).accX=minLeft-1.5-ci*10-(e.spelling.accidental==='♯'?8.5:6.5)}}
 }}
// Rests: where a whole staff is silent for whole beats, draw the rest the
// beat calls for (never across the half-bar; a full silent bar takes a
// whole rest centred in the bar).
for(const [bass,base] of [[false,top],[true,staff2]]){
 let spans=[];for(const cl of list.clusters){let es=cl.notes.filter(e=>(e.n[2]<60)===bass);if(es.length)spans.push([cl.beat,cl.beat+Math.max(...es.map(e=>e.duration))])}
 spans.sort((a,b)=>a[0]-b[0]);let merged=[];for(const sp of spans){let lastM=merged.at(-1);if(lastM&&sp[0]<=lastM[1]+.02)lastM[1]=Math.max(lastM[1],sp[1]);else merged.push([...sp])}
 c.fillStyle='#a39a8c';
 let restHalf=cx=>{c.fillRect(cx-4,base+9.5,8,4.5)},restWhole=cx=>{c.fillRect(cx-4,base+7,8,4.5)},
  restBeat=(u,unit)=>{let cx=cursor+(u+unit/2-current)*px;if(cx<left+8||cx>w-4)return;
   if(unit===2)restHalf(cx);else{c.font='20px Georgia,serif';c.fillText(unit===.5?'𝄾':'𝄽',cx-5,base+20);if(unit===1.5){c.beginPath();c.ellipse(cx+6.5,base+10.5,1.6,1.6,0,0,Math.PI*2);c.fill()}}};
 for(let i=1;i<merged.length;i++){let g0=merged[i-1][1],g1=merged[i][0];if(g1-g0<.95)continue;
  let sig=signatureAt(s,g0+.01),barLen=sig.numerator*4/sig.denominator,unit=sig.denominator===8&&sig.numerator%3===0?1.5:4/sig.denominator,pos=g0;
  while(pos<g1-.05){let barStart=sig.beat+Math.floor((pos-sig.beat+1e-6)/barLen)*barLen;
   if(Math.abs(pos-barStart)<.08&&g1-pos>=barLen-.08){let cx=cursor+(barStart+barLen/2-current)*px;if(cx>=left+8&&cx<=w-4)restWhole(cx);pos+=barLen;continue}
   let u=sig.beat+Math.ceil((pos-sig.beat-.08)/unit)*unit;
   if(u+unit>g1+.08)break;
   if(unit===1&&barLen>=3){let idx=Math.round(((u-sig.beat)%barLen+barLen)%barLen);if((idx===0||(barLen===4&&idx===2))&&u+2<=g1+.08){let cx=cursor+(u+1-current)*px;if(cx>=left+8&&cx<=w-4)restHalf(cx);u+=2;pos=u;continue}}
   restBeat(u,unit);pos=u+unit}
 }}
// Heads, ledger lines, accidentals, octave labels and augmentation dots,
// cluster by cluster (a chord's parts are laid out together, above).
let dotted=v=>[3,1.5,.75].some(dv=>Math.abs(v-dv)<.06);
for(const grp of groups){let cl=grp.cl,subs=new Map();for(const e of grp.items){let g=G.get(e);if(!subs.has(g.base))subs.set(g.base,[]);subs.get(g.base).push(e)}
 for(const [base,items] of subs){let color=items.some(e=>G.get(e).on)?'#ffcc70':'#d8d0c1',xs=items.map(e=>G.get(e).hx),xLo=Math.min(...xs)-7.1,xHi=Math.max(...xs)+7.1,
   minY=Math.min(...items.map(e=>G.get(e).y)),maxY=Math.max(...items.map(e=>G.get(e).y));
  // Ledger lines are a little heavier than staff lines and reach a third
  // of a space past the outermost heads, displaced ones included.
  for(let yy=base-7;yy>=minY-1;yy-=7)line(xLo,yy,xHi,yy,color,1.3);for(let yy=base+35;yy<=maxY+1;yy+=7)line(xLo,yy,xHi,yy,color,1.3);
  for(const e of items){let g=G.get(e);
   if(g.accX!==undefined){c.fillStyle=g.color;c.font='15px Georgia,serif';c.fillText(e.spelling.accidental,g.accX,g.y+5)}
   c.fillStyle=g.color;c.strokeStyle=g.color;c.beginPath();c.ellipse(g.hx,g.y,4.8,3.5,-.35,0,Math.PI*2);if(e.duration>=1.8){c.lineWidth=1.6;c.stroke()}else c.fill();
   glyphs.set(e,{x:g.hx,ax:g.ax,y:g.y,base:g.base,color:g.color,on:g.on,dia:g.dia})}
  let shifted=items.filter(e=>G.get(e).shift);
  if(shifted.length){let g0=G.get(shifted[0]);c.fillStyle=g0.color;c.font='9px Arial';
   if(g0.shift>0)c.fillText('8va',g0.ax-8,Math.max(31,Math.min(...shifted.map(e=>G.get(e).y))-9));
   else c.fillText('8vb',g0.ax-8,Math.min(h-8,Math.max(...shifted.map(e=>G.get(e).y))+15))}
  // A dot goes in the space to the right of the head -- for a head on a
  // line, the space above that line -- and tones sharing a space (a
  // second apart) share one dot.
  if(dotted(cl.value)){let dotYs=new Set(),maxRight=Math.max(...xs)+4.8;
   for(const e of items){let g=G.get(e),onLine=(((g.dia-(base===staff2?25:37))%2)+2)%2===0;dotYs.add(onLine?g.y-3.5:g.y)}
   c.fillStyle=color;for(const dy of dotYs){c.beginPath();c.ellipse(maxRight+4.5,dy,1.6,1.6,0,0,Math.PI*2);c.fill()}}
 }}
let beamCount=0;
for(const beam of list.beams){let visible=beam.clusters.some(cl=>cl.notes.some(e=>glyphs.has(e)));if(!visible)continue;
 const positions=beam.clusters.map(cl=>{let tones=cl.notes.map(e=>glyphs.get(e)||(()=>{let g=geom(e);return{x:g.ax,ax:g.ax,y:g.y,base:g.base,dia:g.dia}})());
  return{cl,x:tones[0].ax,base:tones[0].base,ys:tones.map(g=>g.y),centre:tones.reduce((a,g)=>a+g.dia,0)/tones.length}}),
 // Beam slope follows the pitch interval between the first and last
 // clusters, quantised to quarter spaces (a second earns 0.25, up to 1.5
 // for a seventh or more; an even contour stays flat).
 up=beamUp.get(beam)??(positions.reduce((sum,g)=>sum+g.ys[0]-g.base,0)/positions.length>14),first=positions[0],last=positions.at(-1),
 dSteps=Math.round(last.centre-first.centre),rise=[0,.25,.5,.75,1,1.25,1.5][Math.min(6,Math.abs(dSteps))]*gap,
 slope=dSteps===0?0:-Math.sign(dSteps)*rise/Math.max(1,last.x-first.x),stemOffset=up?4:-4;
 let intercept=up?Infinity:-Infinity;for(const g of positions){let edge=up?Math.min(...g.ys):Math.max(...g.ys),candidate=edge+(up?-28:28)-slope*(g.x-first.x);intercept=up?Math.min(intercept,candidate):Math.max(intercept,candidate)}
 // No stem in a beam is shorter than 2.5 spaces, and the beam's ends snap
 // to a quarter-space grid so they sit cleanly against the staff lines.
 for(const g of positions){let edge=up?Math.min(...g.ys):Math.max(...g.ys),len=up?edge-(intercept+slope*(g.x-first.x)):intercept+slope*(g.x-first.x)-edge;if(len<17.5)intercept+=up?len-17.5:17.5-len}
 intercept=(up?Math.floor(intercept/1.75):Math.ceil(intercept/1.75))*1.75;
 let beamY=x=>intercept+slope*(x-first.x-stemOffset),drawBeam=(a,b,level)=>{let offset=(up?1:-1)*level*5.25;c.fillStyle='#d8d0c1';c.beginPath();c.moveTo(a,beamY(a)+offset);c.lineTo(b,beamY(b)+offset);c.lineTo(b,beamY(b)+offset+(up?3.5:-3.5));c.lineTo(a,beamY(a)+offset+(up?3.5:-3.5));c.fill()};
 for(const g of positions){let x=g.x+stemOffset;for(const y of g.ys)line(x,y,x,beamY(x),g.cl.notes.some(e=>glyphs.get(e)?.on)?'#ffcc70':'#d8d0c1')}
 drawBeam(first.x+stemOffset,last.x+stemOffset,0);
 for(let level=1;level<3;level++)for(let i=0;i<positions.length;i++){let g=positions[i];if(g.cl.flags<=level)continue;let next=positions[i+1],prev=positions[i-1];if(next&&next.cl.flags>level)drawBeam(g.x+stemOffset,next.x+stemOffset,level);else if(!prev||prev.cl.flags<=level){let direction=next?1:-1,length=Math.min(9,Math.abs((next||prev)?.x-g.x||20)*.4);drawBeam(g.x+stemOffset,g.x+stemOffset+direction*length,level)}}beamCount++;
}
// Unbeamed clusters get one shared stem and one set of flags per cluster.
// The stem runs 3.5 spaces from the tip-side head, extended so its tip
// still reaches the middle line when the chord sits far outside the
// staff, and flags always sweep to the right of the stem.
for(const cl of list.clusters){if(cl.beam||!(cl.value<3.6))continue;let gs=cl.notes.map(e=>glyphs.get(e)).filter(Boolean);if(!gs.length)continue;let base=gs[0].base,x=gs[0].ax,ys=gs.map(g=>g.y),up=layout.get(cl)??(ys.reduce((a,b)=>a+b,0)/ys.length>base+14),stemX=x+(up?4:-4),edge=up?Math.min(...ys):Math.max(...ys),tip=edge+(up?-24.5:24.5);
if(up&&edge>base+14)tip=Math.min(tip,base+14);if(!up&&edge<base+14)tip=Math.max(tip,base+14);
let color=cl.notes.some(e=>glyphs.get(e)?.on)?'#ffcc70':'#d8d0c1';
for(const y of ys)line(stemX,y,stemX,tip,color);
if(cl.flags){c.strokeStyle=color;for(let f=0;f<cl.flags;f++){c.beginPath();c.moveTo(stemX,tip+(up?f*5:-f*5));c.quadraticCurveTo(stemX+10,tip+(up?10:-10)+(up?f*5:-f*5),stemX+6,tip+(up?16:-16)+(up?f*5:-f*5));c.stroke()}}}
let activeFingerings=[];c.font='10px Arial';c.fillStyle='#ffcc70';
for(const cl of list.clusters){let sounding=cl.notes.filter(e=>glyphs.get(e)?.on);if(!sounding.length)continue;let g=glyphs.get(sounding[0]),hand=sounding[0].n[4],digits=sounding.map(e=>hand?5-e.n[5]:e.n[5]+1);c.fillText((hand?'L':'R')+digits.join('·'),(g.ax??g.x)-5,g.base+45+hand*12);for(let j=0;j<sounding.length;j++)activeFingerings.push({hand,pitch:sounding[j].n[2],digit:digits[j]});}
c.restore();line(cursor,23,cursor,staff2+38,'#dfbe83');c.fillStyle='#dfbe83';c.beginPath();c.moveTo(cursor-5,20);c.lineTo(cursor+5,20);c.lineTo(cursor,27);c.fill();canvas.setAttribute('aria-label',s.title+': automatic transcription. Sounding MIDI pitches '+active.join(', ')+'. Fingering '+activeFingerings.map(f=>(f.hand?'L':'R')+f.digit).join(', '));window.recitalScoreDebug={time:t,beat:current,activeNotes:active,activeFingerings,beamGroups:beamCount};
}
window.PianoScore={beatAt,timeAt,model,render,flagCount,signatureAt,keyAt,keyAccidentals,keyGlyphs,spellPitch};})();

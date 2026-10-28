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
let line=(x,y,x2,y2,color='#6c655b')=>{c.strokeStyle=color;c.lineWidth=1;c.beginPath();c.moveTo(x,y);c.lineTo(x2,y2);c.stroke()};
for(let base of [top,staff2])for(let i=0;i<5;i++)line(8,base+i*gap,w,base+i*gap);c.fillStyle='#dfbe83';c.font='34px Georgia,serif';c.fillText('𝄞',10,top+30);c.fillText('𝄢',10,staff2+25);
let signature=signatureAt(s,current);
c.font='21px Georgia,serif';for(const [bass,base] of [[false,top],[true,staff2]])
 for(const [i,g] of keyGlyphs(key.fifths,bass).entries())c.fillText(g.symbol,keyStart+i*9,base+g.halfSteps*gap/2+6);
c.font='17px Georgia,serif';for(let base of [top,staff2]){c.fillText(signature.numerator,timeX,base+12);c.fillText(signature.denominator,timeX,base+29)}
let bar=signature.numerator*4/signature.denominator,start=Math.max(0,current-(cursor-left)/px),end=current+(w-cursor)/px;
for(let b=signature.beat+Math.ceil((start-signature.beat)/bar)*bar;b<end;b+=bar){let x=cursor+(b-current)*px;line(x,top,x,staff2+28,'#49453e');c.font='10px Arial';c.fillStyle='#a39a8c';c.fillText(String(Math.round((b-signature.beat)/bar)+1),x+4,top-10)}
let list=model(s),l=0,r=list.length;while(l<r){let m=(l+r)>>1;if(list[m].beat<start-.5)l=m+1;else r=m}
let active=s.notes.filter(n=>n[0]<=t&&n[0]+n[1]>t).map(n=>n[2]),glyphs=new Map();c.save();c.beginPath();c.rect(left,20,w-left,h-20);c.clip();
for(let i=l;i<list.length&&list[i].beat<=end+.4;i++){let e=list[i],n=e.n,p=n[2],bass=p<60,base=bass?staff2:top,diatonic=e.spelling.diatonic,bottom=bass?25:37,y=base+28-(diatonic-bottom)*gap/2,x=cursor+(e.beat-current)*px,on=n[0]<=t&&n[0]+n[1]>t,color=on?'#ffcc70':'#d8d0c1';let shift=0;if(y<base-24){y+=28;shift=1}else if(y>base+52){y-=28;shift=-1}c.fillStyle=color;c.strokeStyle=color;
if(shift){c.font='9px Arial';c.fillText(shift>0?'8va':'8vb',x-8,shift>0?base-30:base+64)}
for(let yy=base-7;yy>=y-1;yy-=7)line(x-9,yy,x+9,yy,color);for(let yy=base+35;yy<=y+1;yy+=7)line(x-9,yy,x+9,yy,color);
if(e.spelling.accidental){c.fillStyle=color;c.font='15px Georgia,serif';c.fillText(e.spelling.accidental,x-18,y+5)}
c.beginPath();c.ellipse(x,y,5.7,3.8,-.35,0,Math.PI*2);if(e.duration>=1.8){c.strokeStyle=color;c.lineWidth=1.6;c.stroke()}else c.fill();glyphs.set(e,{x,y,base,color,on});
}
let beamCount=0;
for(const beam of list.beams){let visible=beam.clusters.some(cl=>cl.notes.some(e=>glyphs.has(e)));if(!visible)continue;
 const positions=beam.clusters.map(cl=>{let e=cl.notes[0],g=glyphs.get(e);if(!g){let bass=e.n[2]<60,base=bass?staff2:top,diatonic=e.spelling.diatonic;let y=base+28-(diatonic-(bass?25:37))*gap/2;if(y<base-24)y+=28;else if(y>base+52)y-=28;g={x:cursor+(e.beat-current)*px,y,base}}let ys=cl.notes.map(n=>glyphs.get(n)?.y??g.y);return{cl,x:g.x,y:g.y,base:g.base,ys}}),mean=positions.reduce((sum,g)=>sum+g.y-g.base,0)/positions.length,up=mean>14,first=positions[0],last=positions.at(-1),slope=Math.max(-.22,Math.min(.22,(last.y-first.y)/Math.max(1,last.x-first.x))),stemOffset=up?5:-5;
 let intercept=up?Infinity:-Infinity;for(const g of positions){let edge=up?Math.min(...g.ys):Math.max(...g.ys),candidate=edge+(up?-28:28)-slope*(g.x-first.x);intercept=up?Math.min(intercept,candidate):Math.max(intercept,candidate)}
 let beamY=x=>intercept+slope*(x-first.x-stemOffset),drawBeam=(a,b,level)=>{let offset=(up?1:-1)*level*6;c.fillStyle='#d8d0c1';c.beginPath();c.moveTo(a,beamY(a)+offset);c.lineTo(b,beamY(b)+offset);c.lineTo(b,beamY(b)+offset+(up?4:-4));c.lineTo(a,beamY(a)+offset+(up?4:-4));c.fill()};
 for(const g of positions){let x=g.x+stemOffset;for(const y of g.ys)line(x,y,x,beamY(x),g.cl.notes.some(e=>glyphs.get(e)?.on)?'#ffcc70':'#d8d0c1')}
 drawBeam(first.x+stemOffset,last.x+stemOffset,0);
 for(let level=1;level<3;level++)for(let i=0;i<positions.length;i++){let g=positions[i];if(g.cl.flags<=level)continue;let next=positions[i+1],prev=positions[i-1];if(next&&next.cl.flags>level)drawBeam(g.x+stemOffset,next.x+stemOffset,level);else if(!prev||prev.cl.flags<=level){let direction=next?1:-1,length=Math.min(10,Math.abs((next||prev)?.x-g.x||20)*.4);drawBeam(g.x+stemOffset,g.x+stemOffset+direction*length,level)}}beamCount++;
}
// Unbeamed clusters get one shared stem and one set of flags per cluster,
// however many noteheads the chord has.
for(const cl of list.clusters){if(cl.beam||!(cl.value<3.6))continue;let gs=cl.notes.map(e=>glyphs.get(e)).filter(Boolean);if(!gs.length)continue;let base=gs[0].base,x=gs[0].x,ys=gs.map(g=>g.y),up=ys.reduce((a,b)=>a+b,0)/ys.length>base+14,stemX=x+(up?5:-5),tip=up?Math.min(...ys)-25:Math.max(...ys)+25,color=cl.notes.some(e=>glyphs.get(e)?.on)?'#ffcc70':'#d8d0c1';
for(const y of ys)line(stemX,y,stemX,tip,color);
if(cl.flags){c.strokeStyle=color;for(let f=0;f<cl.flags;f++){c.beginPath();c.moveTo(stemX,tip+(up?f*5:-f*5));c.quadraticCurveTo(stemX+(up?10:-10),tip+(up?10:-10)+(up?f*5:-f*5),stemX+(up?6:-6),tip+(up?16:-16)+(up?f*5:-f*5));c.stroke()}}}
let activeFingerings=[];c.font='10px Arial';c.fillStyle='#ffcc70';
for(const cl of list.clusters){let sounding=cl.notes.filter(e=>glyphs.get(e)?.on);if(!sounding.length)continue;let g=glyphs.get(sounding[0]),hand=sounding[0].n[4],digits=sounding.map(e=>hand?5-e.n[5]:e.n[5]+1);c.fillText((hand?'L':'R')+digits.join('·'),g.x-5,g.base+45+hand*12);for(let j=0;j<sounding.length;j++)activeFingerings.push({hand,pitch:sounding[j].n[2],digit:digits[j]});}
c.restore();line(cursor,23,cursor,staff2+38,'#dfbe83');c.fillStyle='#dfbe83';c.beginPath();c.moveTo(cursor-5,20);c.lineTo(cursor+5,20);c.lineTo(cursor,27);c.fill();canvas.setAttribute('aria-label',s.title+': automatic transcription. Sounding MIDI pitches '+active.join(', ')+'. Fingering '+activeFingerings.map(f=>(f.hand?'L':'R')+f.digit).join(', '));window.recitalScoreDebug={time:t,beat:current,activeNotes:active,activeFingerings,beamGroups:beamCount};
}
window.PianoScore={beatAt,timeAt,model,render,flagCount,signatureAt,keyAt,keyAccidentals,keyGlyphs,spellPitch};})();

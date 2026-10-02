(()=>{'use strict';
function tempoAt(s,t){let a=s.scoreMetadata.tempos,l=0,r=a.length;while(l<r){let m=(l+r)>>1;if(a[m].time<=t)l=m+1;else r=m}return a[Math.max(0,l-1)]}
function beatAt(s,t){let p=tempoAt(s,t);return p.beat+(t-p.time)*p.bpm/60}
function timeAt(s,b){let a=s.scoreMetadata.tempos,p=a[0];for(const q of a){if(q.beat>b)break;p=q}return p.time+(b-p.beat)*60/p.bpm}
const cache=new WeakMap(),sharpSteps=[0,0,1,1,2,3,3,4,4,5,5,6],flatSteps=[0,1,1,2,2,3,4,4,5,5,6,6];
function signatureAt(s,beat){let sig={beat:0,numerator:4,denominator:4};for(let q of s.scoreMetadata.timeSignatures)if(q.beat<=beat) sig=q;return sig}
function flagCount(duration){return duration<.21?3:duration<.42?2:duration<.85?1:0}
function model(s){if(cache.has(s))return cache.get(s);let m=s.notes.map(n=>({n,beat:beatAt(s,n[0]),duration:Math.max(.125,beatAt(s,n[0]+n[1])-beatAt(s,n[0]))})),lanes=Array.from({length:4},()=>[]),beams=[],clusters=[];
 for(const e of m){let lane=(e.n[2]<60?0:2)+e.n[4],arr=lanes[lane],last=arr.at(-1);if(last&&Math.abs(e.beat-last.beat)<.045)last.notes.push(e);else{last={beat:e.beat,notes:[e],lane};arr.push(last);clusters.push(last)}e.cluster=last;}
 for(const lane of lanes){let group=[];const finish=()=>{if(group.length>1){let beam={clusters:group.slice()};beams.push(beam);for(const cl of group){cl.beam=beam;for(const e of cl.notes)e.beam=beam}}group=[]};
  for(let i=0;i<lane.length;i++){let cl=lane[i],next=lane[i+1],duration=Math.max(...cl.notes.map(e=>e.duration)),delta=next?next.beat-cl.beat:Infinity;
   // MIDI note-offs are often shorter than the written rhythmic value.
   if(delta<1.6&&duration>=delta*.64&&duration<=delta*1.10)duration=delta;
   cl.flags=flagCount(duration);for(const e of cl.notes)e.flags=cl.flags;
   let sig=signatureAt(s,cl.beat),unit=sig.denominator===8&&sig.numerator%3===0&&sig.numerator>3?1.5:4/sig.denominator,cell=Math.floor((cl.beat-sig.beat+.035)/unit),key=sig.beat+':'+cell,prev=group.at(-1);
   if(!cl.flags){finish();continue}if(prev&&(prev.cell!==key||cl.beat-prev.beat>Math.max(.26,prev.rhythm*1.4)))finish();cl.cell=key;cl.rhythm=duration;group.push(cl);
  }finish();
 }
 m.beams=beams;m.clusters=clusters;cache.set(s,m);return m}
function render(canvas,s,t){let c=canvas.getContext('2d');if(!c)return;let w=canvas.clientWidth||900,h=canvas.clientHeight||180,d=Math.min(window.devicePixelRatio||1,2);if(canvas.width!==w*d||canvas.height!==h*d){canvas.width=w*d;canvas.height=h*d}c.setTransform(d,0,0,d,0,0);c.clearRect(0,0,w,h);c.fillStyle='#17191c';c.fillRect(0,0,w,h);let current=beatAt(s,t),px=w<600?49:66,cursor=Math.min(w*.32,260),left=88,top=42,gap=7,staff2=top+72;
let line=(x,y,x2,y2,color='#6c655b')=>{c.strokeStyle=color;c.lineWidth=1;c.beginPath();c.moveTo(x,y);c.lineTo(x2,y2);c.stroke()};
for(let base of [top,staff2])for(let i=0;i<5;i++)line(left,base+i*gap,w,base+i*gap);c.fillStyle='#dfbe83';c.font='34px Georgia,serif';c.fillText('𝄞',10,top+30);c.fillText('𝄢',10,staff2+25);
let signatures=s.scoreMetadata.timeSignatures,signature=signatures[0]||{beat:0,numerator:4,denominator:4};for(let q of signatures)if(q.beat<=current)signature=q;let keys=s.scoreMetadata.keySignatures,key={fifths:0};for(let q of keys)if(q.beat<=current)key=q;
c.font='12px Georgia,serif';c.fillText(key.fifths?Math.abs(key.fifths)+(key.fifths<0?'♭':'♯'):'C',43,top+12);c.font='17px Georgia,serif';for(let base of [top,staff2]){c.fillText(signature.numerator,63,base+12);c.fillText(signature.denominator,63,base+29)}
let bar=signature.numerator*4/signature.denominator,start=Math.max(0,current-(cursor-left)/px),end=current+(w-cursor)/px;
for(let b=signature.beat+Math.ceil((start-signature.beat)/bar)*bar;b<end;b+=bar){let x=cursor+(b-current)*px;line(x,top,x,staff2+28,'#49453e');c.font='10px Arial';c.fillStyle='#a39a8c';c.fillText(String(Math.round((b-signature.beat)/bar)+1),x+4,top-10)}
let list=model(s),l=0,r=list.length;while(l<r){let m=(l+r)>>1;if(list[m].beat<start-.5)l=m+1;else r=m}
let active=[],glyphs=new Map();c.save();c.beginPath();c.rect(left,20,w-left,h-20);c.clip();
for(let i=l;i<list.length&&list[i].beat<=end+.4;i++){let e=list[i],n=e.n,p=n[2],bass=p<60,base=bass?staff2:top,pc=p%12,steps=key.fifths<0?flatSteps:sharpSteps,diatonic=Math.floor(p/12)*7+steps[pc],bottom=bass?25:37,y=base+28-(diatonic-bottom)*gap/2,x=cursor+(e.beat-current)*px,on=n[0]<=t&&n[0]+n[1]>t,color=on?'#ffcc70':'#d8d0c1';if(on)active.push(p);let shift=0;if(y<base-24){y+=28;shift=1}else if(y>base+52){y-=28;shift=-1}c.fillStyle=color;c.strokeStyle=color;
if(shift){c.font='9px Arial';c.fillText(shift>0?'8va':'8vb',x-8,shift>0?base-30:base+64)}
for(let yy=base-7;yy>=y-1;yy-=7)line(x-9,yy,x+9,yy,color);for(let yy=base+35;yy<=y+1;yy+=7)line(x-9,yy,x+9,yy,color);
if([1,3,6,8,10].includes(pc)){c.fillStyle=color;c.font='15px Georgia,serif';c.fillText(key.fifths<0?'♭':'♯',x-18,y+5)}
c.beginPath();c.ellipse(x,y,5.7,3.8,-.35,0,Math.PI*2);if(e.duration>=1.8){c.strokeStyle=color;c.lineWidth=1.6;c.stroke()}else c.fill();glyphs.set(e,{x,y,base,color,on});let up=y>base+14,stemX=x+(up?5:-5),stemY=y+(up?-25:25);if(e.duration<3.6&&!e.beam){line(stemX,y,stemX,stemY,color);if(e.flags){let flags=e.flags;for(let f=0;f<flags;f++){c.strokeStyle=color;c.beginPath();c.moveTo(stemX,stemY+(up?f*5:-f*5));c.quadraticCurveTo(stemX+(up?10:-10),stemY+(up?10:-10)+(up?f*5:-f*5),stemX+(up?6:-6),stemY+(up?16:-16)+(up?f*5:-f*5));c.stroke()}}}
}
let beamCount=0;
for(const beam of list.beams){let visible=beam.clusters.some(cl=>cl.notes.some(e=>glyphs.has(e)));if(!visible)continue;
 const positions=beam.clusters.map(cl=>{let e=cl.notes[0],g=glyphs.get(e);if(!g){let bass=e.n[2]<60,base=bass?staff2:top,pc=e.n[2]%12,steps=key.fifths<0?flatSteps:sharpSteps,diatonic=Math.floor(e.n[2]/12)*7+steps[pc];let y=base+28-(diatonic-(bass?25:37))*gap/2;if(y<base-24)y+=28;else if(y>base+52)y-=28;g={x:cursor+(e.beat-current)*px,y,base}}let ys=cl.notes.map(n=>glyphs.get(n)?.y??g.y);return{cl,x:g.x,y:g.y,base:g.base,ys}}),mean=positions.reduce((sum,g)=>sum+g.y-g.base,0)/positions.length,up=mean>14,first=positions[0],last=positions.at(-1),slope=Math.max(-.22,Math.min(.22,(last.y-first.y)/Math.max(1,last.x-first.x))),stemOffset=up?5:-5;
 let intercept=up?Infinity:-Infinity;for(const g of positions){let edge=up?Math.min(...g.ys):Math.max(...g.ys),candidate=edge+(up?-28:28)-slope*(g.x-first.x);intercept=up?Math.min(intercept,candidate):Math.max(intercept,candidate)}
 let beamY=x=>intercept+slope*(x-first.x-stemOffset),drawBeam=(a,b,level)=>{let offset=(up?1:-1)*level*6;c.fillStyle='#d8d0c1';c.beginPath();c.moveTo(a,beamY(a)+offset);c.lineTo(b,beamY(b)+offset);c.lineTo(b,beamY(b)+offset+(up?4:-4));c.lineTo(a,beamY(a)+offset+(up?4:-4));c.fill()};
 for(const g of positions){let x=g.x+stemOffset;for(const y of g.ys)line(x,y,x,beamY(x),g.cl.notes.some(e=>glyphs.get(e)?.on)?'#ffcc70':'#d8d0c1')}
 drawBeam(first.x+stemOffset,last.x+stemOffset,0);
 for(let level=1;level<3;level++)for(let i=0;i<positions.length;i++){let g=positions[i];if(g.cl.flags<=level)continue;let next=positions[i+1],prev=positions[i-1];if(next&&next.cl.flags>level)drawBeam(g.x+stemOffset,next.x+stemOffset,level);else if(!prev||prev.cl.flags<=level){let direction=next?1:-1,length=Math.min(10,Math.abs((next||prev)?.x-g.x||20)*.4);drawBeam(g.x+stemOffset,g.x+stemOffset+direction*length,level)}}beamCount++;
}
let activeFingerings=[];c.font='10px Arial';c.fillStyle='#ffcc70';
for(const cl of list.clusters){let sounding=cl.notes.filter(e=>glyphs.get(e)?.on);if(!sounding.length)continue;let g=glyphs.get(sounding[0]),hand=sounding[0].n[4],digits=sounding.map(e=>hand?5-e.n[5]:e.n[5]+1);c.fillText((hand?'L':'R')+digits.join('·'),g.x-5,g.base+45+hand*12);for(let j=0;j<sounding.length;j++)activeFingerings.push({hand,pitch:sounding[j].n[2],digit:digits[j]});}
c.restore();line(cursor,23,cursor,staff2+38,'#dfbe83');c.fillStyle='#dfbe83';c.beginPath();c.moveTo(cursor-5,20);c.lineTo(cursor+5,20);c.lineTo(cursor,27);c.fill();canvas.setAttribute('aria-label',s.title+': automatic transcription. Sounding MIDI pitches '+active.join(', ')+'. Fingering '+activeFingerings.map(f=>(f.hand?'L':'R')+f.digit).join(', '));window.recitalScoreDebug={time:t,beat:current,activeNotes:active,activeFingerings,beamGroups:beamCount};
}
window.PianoScore={beatAt,timeAt,model,render,flagCount,signatureAt};})();

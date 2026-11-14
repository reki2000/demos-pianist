'use strict';
// Concert coverage: deliberate cuts between subjects, with a slow arc and dolly
// within each shot. All motion follows the playback clock, including seeks.
window.CinematicCamera=(()=>{
 const Y=[0,1,0],Z=[0,0,1],add=(a,b)=>a.map((v,i)=>v+b[i]),sub=(a,b)=>a.map((v,i)=>v-b[i]),mul=(a,s)=>a.map(v=>v*s);
 const shot=(label,duration,at,offset,subject=null,width=.4,height=.4,arc=.24,push=.10,up=Y)=>({label,duration,at,offset,subject,width,height,arc,push,up});
 const C={
  piano:[
   shot('Stage · opening arc',7,[0,1.16,-.45],[2.5,1.2,-3.0],null,2.5,2),
   shot('Keyboard · above both hands',6,[0,1.05,-.55],[.10,1.85,.12],'hands',1.25,.6,.18,.10,Z),
   shot('Left hand · bass-side close-up',6,[-.35,1.10,-.55],[-.50,.48,-.62],'left',.33,.35,-.25,.12),
   shot('Expression · left profile',5,[0,1.62,-1.08],[-1.12,.28,.85],null,.65,.65,.20,-.08),
   shot('Right hand · treble-side close-up',6,[.35,1.10,-.55],[.52,.42,-.60],'right',.33,.35,.25,.12),
   shot('Over the pianist’s shoulder',7,[0,1.05,-.55],[.55,1.20,-1.40],'hands',1.15,.65,-.20,.08),
   shot('Keyboard · low bass-side angle',5,[0,1.06,-.52],[-1.75,.45,-.48],'hands',1.15,.55,.24,-.08),
   shot('Performer · right profile',6,[0,1.37,-.88],[1.80,.35,.50],null,1.1,1.15,-.26,.10),
   shot('Hands · high treble-side angle',6,[0,1.05,-.55],[1.05,1.40,.12],'hands',1.15,.65,.20,.08),
   shot('Expression · from the keyboard',5,[0,1.60,-1.08],[.80,.20,.95],null,.65,.65,-.22,.08),
   shot('Grand piano · wide reverse angle',7,[0,1.05,.4],[-3.2,1.6,3.4],null,3.0,2.0,.28,-.10),
   shot('Hands and wrists · frontal detail',6,[0,1.10,-.55],[.12,.72,-1.40],'hands',1.15,.65,-.20,.12),
  ],
  guitar:[
   shot('Stage · opening arc',7,[.08,1.12,-.2],[1.7,.85,-2.6],null,1.5,1.8),
   shot('Fretting hand · treble-side detail',6,[.35,1.28,-.3],[.48,.35,-.58],'left',.3,.35,-.26,.12),
   shot('Plucking hand · soundhole detail',6,[.02,1.02,-.3],[-.40,.30,-.56],'right',.3,.35,.26,.12),
   shot('Expression · left profile',5,[.02,1.58,-.08],[-.95,.20,-.95],null,.65,.65,-.22,-.08),
   shot('Both hands · high angle',7,[.2,1.15,-.3],[.25,1.25,-.75],'hands',.9,.6,.22,.08),
   shot('Fretting hand · opposite side',6,[.35,1.28,-.3],[-.42,.42,-.58],'left',.3,.35,.26,-.08),
   shot('Performer · right profile',6,[.08,1.3,-.15],[1.9,.30,-.3],null,1.1,1.2,-.25,.10),
   shot('Plucking hand · low string angle',5,[.02,1.02,-.3],[.45,.12,-.56],'right',.3,.35,-.20,.10),
   shot('Over the fretting shoulder',7,[.22,1.15,-.3],[.65,.90,.65],'hands',.9,.7,.24,.08),
   shot('Expression · right three-quarter',5,[.02,1.58,-.08],[.85,.22,-1.0],null,.65,.65,.22,.08),
   shot('Stage · reverse angle',7,[.05,1.1,-.2],[-2.4,1.1,.9],null,1.6,1.8,-.26,-.10),
   shot('Hands · front three-quarter',6,[.2,1.15,-.3],[-.8,.50,-1.15],'hands',.9,.7,.22,.10),
  ],
  violin:[
   shot('Stage · opening arc',7,[.05,1.15,-.15],[1.8,.65,-3.0],null,1.6,2.0),
   shot('Left hand · fingerboard detail',6,[.30,1.43,-.35],[.52,.34,-.65],'left',.3,.35,-.26,.12),
   shot('Right hand · bow grip detail',6,[-.12,1.30,-.30],[-.55,.30,-.62],'right',.3,.35,.26,.10),
   shot('Expression · left three-quarter',5,[.10,1.61,-.18],[-.95,.22,-1.0],null,.7,.7,.22,-.08),
   shot('Violin and both hands · high angle',7,[.15,1.42,-.3],[.3,1.0,-.85],'hands',1.05,.6,-.22,.08),
   shot('Left hand · opposite fingerboard angle',6,[.30,1.43,-.35],[-.45,.38,-.62],'left',.3,.35,.25,-.08),
   shot('Performer · bow-side profile',6,[.02,1.35,-.15],[-1.9,.30,-.35],null,1.1,1.35,.25,.10),
   shot('Right hand · low bow-side angle',5,[-.12,1.30,-.30],[-.50,.12,-.68],'right',.3,.35,-.24,.10),
   shot('Over the violinist’s shoulder',7,[.15,1.42,-.3],[.65,.65,.80],'hands',1.05,.65,.22,.08),
   shot('Expression · right profile',5,[.10,1.61,-.18],[1.05,.2,-.75],null,.7,.7,-.22,.10),
   shot('Stage · high reverse angle',7,[.05,1.15,-.15],[2.4,1.2,1.1],null,1.6,2.0,-.25,-.10),
   shot('Hands and instrument · front detail',6,[.15,1.42,-.3],[.25,.45,-1.40],'hands',1.05,.65,.22,.10),
  ],
  cello:[
   shot('Stage · opening arc',7,[0,.95,-.1],[-2.0,.85,-2.8],null,1.5,1.9),
   shot('Left hand · fingerboard detail',6,[.30,1.1,-.2],[.50,.38,-.65],'left',.3,.35,-.26,.12),
   shot('Right hand · bow grip detail',6,[-.05,.85,-.3],[-.55,.28,-.60],'right',.3,.35,.26,.10),
   shot('Expression · left three-quarter',5,[0,1.4,.0],[-.9,.2,-1.1],null,.7,.7,.22,-.08),
   shot('Both hands · high string angle',7,[.12,1.0,-.2],[.35,1.1,-.8],'hands',.9,.7,-.22,.08),
   shot('Left hand · opposite fingerboard angle',6,[.30,1.1,-.2],[-.45,.42,-.62],'left',.3,.35,.26,-.08),
   shot('Performer · bow-side profile',6,[0,1.0,-.1],[-2.0,.35,-.3],null,1.0,1.5,.25,.10),
   shot('Right hand · low bow-side angle',5,[-.05,.85,-.3],[-.55,.1,-.64],'right',.3,.35,-.22,.10),
   shot('Over the cellist’s shoulder',7,[.12,1.0,-.2],[.65,.9,.75],'hands',.9,.7,.22,.08),
   shot('Expression · right profile',5,[0,1.4,.0],[1.0,.22,-.8],null,.7,.7,-.22,.10),
   shot('Stage · high reverse angle',7,[0,.95,-.1],[2.4,1.3,.9],null,1.5,1.9,-.25,-.10),
   shot('Hands and bow · frontal detail',6,[.12,1.0,-.2],[.2,.48,-1.4],'hands',.9,.7,.22,.10),
  ],
 };
 function subjects(kind,pose){
  const point=p=>Array.isArray(p)?p:p&&[p.x,p.y,p.z];
  const centre=h=>point(h?.palmPos||h?.palm||h?.wrist);
  let left,right;
  if(kind==='piano'){left=centre(pose?.hands?.[1]);right=centre(pose?.hands?.[0]);}
  else if(kind==='guitar'){left=centre(pose?.hands?.[0])||point(pose?.wristL);right=centre(pose?.hands?.[1])||point(pose?.wristR);}
  else if(kind==='violin'){left=centre(pose?.handL);right=centre(pose?.handR);}
  else if(kind==='cello'){left=point(pose?.hand?.masses?.palm?.centre||pose?.leftArm?.wrist);right=centre(pose?.bowHand)||point(pose?.rightArm?.wrist);}
  const result={};if(left?.every(Number.isFinite))result.left=left;if(right?.every(Number.isFinite))result.right=right;
  if(result.left&&result.right)result.hands=mul(add(left,right),.5);return result;
 }
 function sample(kind,t,subjects={},options={}){
  const shots=C[kind];if(!shots)throw Error('Unknown cinematic instrument: '+kind);
  const total=shots.reduce((v,s)=>v+s.duration,0);let clock=Math.max(0,Number.isFinite(t)?t:0)%total,index=0;
  while(clock>=shots[index].duration){clock-=shots[index++].duration;}
  const s=shots[index],phase=clock/s.duration,ease=phase*phase*(3-2*phase),motion=!options.reducedMotion;
  const at=(subjects[s.subject]||s.at).slice(),angle=motion?(ease-.5)*s.arc:0,dolly=motion?1+s.push*(.5-ease):1;
  const [x,y,z]=s.offset;let offset=[x*Math.cos(angle)-z*Math.sin(angle),y+(motion?.035*Math.sin(phase*Math.PI):0),x*Math.sin(angle)+z*Math.cos(angle)];
  offset=mul(offset,dolly);
  const aspect=Math.max(.25,options.aspect||1.5),span=s.subject==='hands'&&subjects.left&&subjects.right?Math.max(s.width,Math.hypot(...sub(subjects.left,subjects.right))+.22):s.width;
  const distance=Math.hypot(...offset),minimum=Math.max(span/(2*Math.tan(.57/2)*aspect),s.height/(2*Math.tan(.57/2)),.55);
  if(distance<minimum)offset=mul(offset,minimum/distance);
  return {eye:add(at,offset),at,up:s.up.slice(),label:String(index+1).padStart(2,'0')+' / '+s.label,index,phase,duration:s.duration};
 }
 function create(kind){let key=null,lastTime=null,filtered={};return {reset(){key=null;lastTime=null;filtered={};},at(t,subjects={},options={}){
  const dt=t-lastTime,reset=key!==options.key||lastTime==null||dt<0||dt>.5;key=options.key;lastTime=t;if(reset)filtered={};
  for(const [name,p]of Object.entries(subjects))if(p?.length===3&&p.every(Number.isFinite))filtered[name]=reset||!filtered[name]?p.slice():add(filtered[name],mul(sub(p,filtered[name]),1-Math.exp(-Math.max(0,dt)*3)));
  return sample(kind,t,filtered,options);
 }};}
 return {sample,create,subjects,catalog:C};
})();

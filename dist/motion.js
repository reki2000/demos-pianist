'use strict';
window.PianoMotion=(()=>{
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),smooth=v=>{v=clamp(v,0,1);return v*v*v*(v*(v*6-15)+10)},mix=(a,b,u)=>a+(b-a)*u;
const add=(a,b)=>a.map((v,i)=>v+b[i]),sub=(a,b)=>a.map((v,i)=>v-b[i]),mul=(a,s)=>a.map(v=>v*s),dot=(a,b)=>a.reduce((r,v,i)=>r+v*b[i],0),unit=a=>mul(a,1/(Math.hypot(...a)||1));
// Nominal acoustic-piano dimensions: 23.5 mm white pitch, 148/95 mm
// exposed white/black lengths, 14 mm black width, 12 mm black height.
const scale=.038/.0235;
const keyboard={pitch:.038,whiteWidth:.0372,whiteLength:.148*scale,blackWidth:.014*scale,blackLength:.095*scale,blackHeight:.012*scale,rear:-.36,whiteTop:1.035,travel:.010*scale,keys:[],map:new Map()};
let white=0;for(let midi=21;midi<=108;midi++){let black=[1,3,6,8,10].includes(midi%12),x=black?(white-26)*keyboard.pitch:(white++-25.5)*keyboard.pitch;let k={midi,black,x};keyboard.keys.push(k);keyboard.map.set(midi,k)}
// Thumb, index, middle, ring, little. These lengths never vary with pitch.
const lengths=[[.043,.032,.025],[.058,.034,.024],[.065,.040,.027],[.060,.037,.026],[.048,.028,.022]];
const rootX=[-.066,-.037,-.011,.016,.048],rootZ=[-.022,.045,.052,.046,.034];
// Lateral MCP range: the full reach used only to press a key, and the narrower
// range a finger keeps when it is free, so idle fingers never splay.
const abduction=[1.45,.62,.48,.58,1.0],relaxedAbduction=[1.30,.40,.28,.34,.60];
function physical(hand,f){return hand?4-f:f}
// CMC is at the proximal radial edge; the four MCPs form the distal knuckle arc.
function handPoint(palm,p){let cp=Math.cos(palm.pitch||0),sp=Math.sin(palm.pitch||0),c=Math.cos(palm.yaw||0),s=Math.sin(palm.yaw||0),y=p[1]-.004,z=p[2]+.069,ry=y*cp-z*sp,rz=y*sp+z*cp-.069;return[palm.x+p[0]*c+rz*s,palm.y+.004+ry,palm.z+rz*c-p[0]*s]}
function root(palm,hand,f){let i=physical(hand,f),sign=hand?-1:1;return handPoint(palm,[rootX[i]*sign,i===0?-.008:0,rootZ[i]])}
function segmentGap(a,b,c,d){let ux=b[0]-a[0],uy=b[1]-a[1],uz=b[2]-a[2],vx=d[0]-c[0],vy=d[1]-c[1],vz=d[2]-c[2],wx=a[0]-c[0],wy=a[1]-c[1],wz=a[2]-c[2],aa=ux*ux+uy*uy+uz*uz,bb=ux*vx+uy*vy+uz*vz,cc=vx*vx+vy*vy+vz*vz,dd=ux*wx+uy*wy+uz*wz,ee=vx*wx+vy*wy+vz*wz,den=aa*cc-bb*bb,s=den>1e-12?clamp((bb*ee-cc*dd)/den,0,1):0,t=clamp((bb*s+ee)/(cc||1),0,1);s=clamp((bb*t-dd)/(aa||1),0,1);t=clamp((bb*s+ee)/(cc||1),0,1);return Math.hypot(wx+s*ux-t*vx,wy+s*uy-t*vy,wz+s*uz-t*vz)}
function fingerGap(a,b){let gap=Infinity;for(let i=0;i<3;i++)for(let j=0;j<3;j++)gap=Math.min(gap,segmentGap(a.points[i],a.points[i+1],b.points[j],b.points[j+1]));return gap}
function lower(arr,t){let a=0,b=arr.length;while(a<b){let m=(a+b)>>1;if(arr[m].t<t)a=m+1;else b=m}return a}
function contactZ(pitch,hand,f,mixed){let i=physical(hand,f);return keyboard.map.get(pitch).black?[-.505,-.461,-.448,-.457,-.502][i]:(mixed?[-.535,-.475,-.479,-.485,-.530]:[-.562,-.535,-.521,-.529,-.551])[i]}
function keyPoint(pitch,press=1,zOverride){let k=keyboard.map.get(pitch);return[k.x,keyboard.whiteTop+(k.black?keyboard.blackHeight:0)+.008-keyboard.travel*press,zOverride??(k.black?-.480:-.542)]}
function resultant(ls,q){return[ls[0]+ls[1]*Math.cos(q)+ls[2]*Math.cos(q*1.65),-ls[1]*Math.sin(q)-ls[2]*Math.sin(q*1.65)]}
function bounds(ls){return[Math.hypot(...resultant(ls,1.82)),ls.reduce((a,b)=>a+b,0)]}
function solveFinger(base,target,hand,f,yaw=0){
 let ls=lengths[physical(hand,f)],v=sub(target,base),horizontal=Math.hypot(v[0],v[2]),d=Math.hypot(...v),[minD,maxD]=bounds(ls),reach=clamp(d,minD,maxD-.000001),lo=0,hi=1.82;
 for(let i=0;i<18;i++){let q=(lo+hi)/2;if(Math.hypot(...resultant(ls,q))>reach)lo=q;else hi=q}
 let q=(lo+hi)/2,r=resultant(ls,q),angle=Math.atan2(v[1],horizontal)-Math.atan2(r[1],r[0]),azimuth=Math.atan2(v[0],v[2]),limit=abduction[physical(hand,f)];
 azimuth=clamp(azimuth-yaw,-limit,limit)+yaw;
 // MCP extension/flexion bound and linked PIP/DIP flexion; no backward PIP bends.
 angle=clamp(angle,-.55,1.05);let dir=[Math.sin(azimuth),0,Math.cos(azimuth)],points=[base];
 for(let i=0;i<3;i++){let a=angle-(i===0?0:i===1?q:q*1.65),step=[dir[0]*ls[i]*Math.cos(a),ls[i]*Math.sin(a),dir[2]*ls[i]*Math.cos(a)];points.push(add(points.at(-1),step))}
 return{points,lengths:ls,angles:[angle,q,q*.65],abduction:azimuth-yaw,error:Math.hypot(...sub(points[3],target)),target};
}
function bendFinger(base,hand,f,a,q,az,yaw,target){let ls=lengths[physical(hand,f)],dir=[Math.sin(az),0,Math.cos(az)],points=[base];for(let j=0;j<3;j++){let angle=a-(j===0?0:j===1?q:q*1.65);points.push(add(points.at(-1),[dir[0]*ls[j]*Math.cos(angle),ls[j]*Math.sin(angle),dir[2]*ls[j]*Math.cos(angle)]))}return{points,lengths:ls,angles:[a,q,q*.65],abduction:az-yaw,target,error:Math.hypot(...sub(points[3],target)),avoided:true}}
// All idle MCPs share a small relaxed angle. A strike FLEXES it downward;
// PIP/DIP flexion supplies the remaining key travel, never a lifted knuckle.
function pressFinger(palm,hand,f,pitch,press=1){let base=root(palm,hand,f),ls=lengths[physical(hand,f)],k=keyboard.map.get(pitch),a=-(palm.pitch||0)-(physical(hand,f)===0?.22:.38)*(k.black?.68:1)*press,targetY=keyPoint(pitch,press)[1],height=q=>ls[0]*Math.sin(a)+ls[1]*Math.sin(a-q)+ls[2]*Math.sin(a-1.65*q),lo=0,hi=1.35;let dl=0,dh=1.35;for(let j=0;j<14;j++){let q=(dl+dh)/2,derivative=-ls[1]*Math.cos(a-q)-1.65*ls[2]*Math.cos(a-1.65*q);if(derivative<0)dl=q;else dh=q;}hi=(dl+dh)/2;
 for(let i=0;i<16;i++){let q=(lo+hi)/2;if(base[1]+height(q)>targetY)lo=q;else hi=q;}let q=(lo+hi)/2,R=ls[0]*Math.cos(a)+ls[1]*Math.cos(a-q)+ls[2]*Math.cos(a-1.65*q),dx=k.x-base[0],limit=abduction[physical(hand,f)],az=clamp(Math.asin(clamp(dx/Math.max(.001,R),-.999999,.999999))-(palm.yaw||0),-limit,limit)+(palm.yaw||0),z=base[2]+R*Math.cos(az),front=keyboard.rear-(k.black?keyboard.blackLength:keyboard.whiteLength)+.007,target=[k.x,targetY,clamp(z,front,keyboard.rear-.013)],finger=bendFinger(base,hand,f,a,q,az,palm.yaw||0,target);finger.contactZ=target[2];finger.restMCP=0;return finger;
}
function hangingCost(palm,notes,hand,reference){let solved=notes.map(n=>pressFinger(palm,hand,n.f,n.pitch)),cost=0;for(const f of solved)cost+=f.error*f.error*100000+f.abduction*f.abduction*1.4+Math.max(0,f.angles[1]-.95)**2*.04;for(let a=0;a<solved.length;a++)for(let b=a+1;b<solved.length;b++)cost+=Math.max(0,.016-fingerGap(solved[a],solved[b]))**2*50000;cost+=(palm.x-reference.x)**2*.015+(palm.y-1.092)**2*.1+Math.max(0,1.085-palm.y)**2*500+(palm.z-reference.z)**2*.02+palm.yaw**2*.0003;return cost;}
function fitHangingPalm(notes,hand,reference){let span=Math.max(...notes.map(n=>keyboard.map.get(n.pitch).x))-Math.min(...notes.map(n=>keyboard.map.get(n.pitch).x)),minY=1.057,p={...reference,pitch:0,y:Math.max(minY,reference.y)},step=[.055,.045,.020,.15];for(let pass=0;pass<14;pass++){for(let[j,key]of ['x','z','y','yaw'].entries()){let cost=hangingCost(p,notes,hand,reference),best=p;for(const sign of [-1,1]){let alt={...p,[key]:p[key]+sign*step[j]};alt.y=clamp(alt.y,minY,1.14);alt.z=clamp(alt.z,-.72,-.50);alt.yaw=clamp(alt.yaw,-.35,.35);let c=hangingCost(alt,notes,hand,reference);if(c<cost){cost=c;best=alt}}p=best;}step=step.map(v=>v*.64);}return p;}
function prepareHangingPlan(song){let retained=0,rejected=0,cache=new Map();
 for(let hand=0;hand<2;hand++){let hp=song.motion.hands[hand],positions=new Map();for(const fr of hp.frames)if(fr.position!==undefined){let a=positions.get(fr.position)||[];a.push(fr);positions.set(fr.position,a);}
  const fit=(ns,ref)=>{let key=hand+':'+ns.map(n=>n.pitch+'/'+n.f).join(','),p=cache.get(key);if(p)return{...p};p=fitHangingPalm(ns,hand,ref);if(ns.some(n=>pressFinger(p,hand,n.f,n.pitch).error>.0035)){let center=ns.reduce((v,n)=>v+keyboard.map.get(n.pitch).x,0)/ns.length,black=ns.filter(n=>blackKey(n.pitch)).length/ns.length;for(const yaw of [0,-.18,.18]){let alt=fitHangingPalm(ns,hand,{x:center,y:1.080,z:mix(-.636,-.565,black),yaw,pitch:0});if(hangingCost(alt,ns,hand,ref)<hangingCost(p,ns,hand,ref))p=alt;}}cache.set(key,p);return{...p};};
  for(const [id,frames]of positions){let ns=frames[0].prepared,p=fit(ns,frames[0].palm),solved=ns.map(n=>pressFinger(p,hand,n.f,n.pitch)),clear=solved.every(f=>f.error<.0035);for(let a=0;a<solved.length;a++)for(let b=a+1;b<solved.length;b++)if(fingerGap(solved[a],solved[b])<.015)clear=false;if(clear){for(const fr of frames)fr.palm={...p};retained++;}else{for(const fr of frames){delete fr.position;delete fr.prepared;}rejected++;}}
  for(const fr of hp.frames){if(fr.position===undefined)fr.palm=fit(fr.notes,fr.palm);for(const n of fr.notes)n.z=pressFinger(fr.palm,hand,n.f,n.pitch).contactZ;frameAngles.delete(fr);}hp.fingers=Array.from({length:5},()=>[]);for(const fr of hp.frames)for(const n of fr.notes)hp.fingers[n.f].push(n);
 }song.motion.sharedPositions={retained,rejected};song.motion.version=13;
}
function keySurface(point,depressions){let top=-Infinity;for(const k of keyboard.keys){let len=k.black?keyboard.blackLength:keyboard.whiteLength,width=k.black?keyboard.blackWidth:keyboard.whiteWidth;if(Math.abs(point[0]-k.x)<width*.5+.001&&point[2]>keyboard.rear-len&&point[2]<keyboard.rear)top=Math.max(top,keyboard.whiteTop+(k.black?keyboard.blackHeight:0)-keyboard.travel*(depressions?.get(k.midi)||0));}return top;}
// Free fingers keep their neighbours' left-to-right order (the thumb may pass
// under). The correction grows with the finger's freedom, so it is continuous.
function orderFingers(fingers,hand,yaw){const margin=.05;
 for(let pass=0;pass<2;pass++)for(let f=0;f<5;f++){let F=fingers[f],w=F.contact?0:F.freedom??0;if(w<=0||physical(hand,f)===0)continue;let lo=-Infinity,hi=Infinity;
  for(const j of [f-1,f+1]){let N=fingers[j];if(!N||physical(hand,j)===0)continue;if(j<f)lo=N.abduction-margin;else hi=N.abduction+margin;}
  let limit=abduction[physical(hand,f)],want=clamp(clamp(F.abduction,lo,Math.max(lo,hi)),-limit,limit),az=mix(F.abduction,want,w);if(Math.abs(az-F.abduction)<1e-9)continue;
  fingers[f]={...F,...bendFinger(F.points[0],hand,f,F.angles[0],F.angles[1],yaw+az,yaw,F.target),avoided:F.avoided};}
}
function separateFingers(fingers,hand,yaw,pitch=0,depressions){const goal=.014;
 // A free MCP may flex DOWN a little; it can never extend above its resting
 // angle. Distal straightening and lateral spacing keep the fingertip clear.
 for(let pass=0;pass<4;pass++)for(let f=0;f<5;f++){let original=fingers[f];if(original.contact)continue;const clearance=c=>{let g=Infinity;for(let j=0;j<5;j++)if(j!==f)g=Math.min(g,fingerGap(c,fingers[j]));return g};if(clearance(original)>=goal)continue;let base=original.points[0],limit=Math.max(relaxedAbduction[physical(hand,f)],Math.abs(original.abduction)),a=original.angles[0],q=original.angles[1],az=original.abduction,minA=Math.min(original.angles[0],-.14-pitch),maxA=-pitch,make=(a,q,az)=>bendFinger(base,hand,f,a,q,yaw+az,yaw,original.target),cost=(a,q,az)=>{let c=make(a,q,az),v=(q-original.angles[1])**2*.025+(az-original.abduction)**2*.035+(a-original.angles[0])**2*.04,tip=c.points[3],floor=keySurface(tip,depressions)+.008;v+=Math.max(0,floor-tip[1])**2*180000*(original.floorWeight??1);for(let j=0;j<5;j++)if(j!==f)v+=Math.max(0,goal+.0005-fingerGap(c,fingers[j]))**2*150000;return v},step=[.08,.13,.13];
  for(let k=0;k<16;k++){for(let v=0;v<3;v++){let best=cost(a,q,az),na=a,nq=q,naz=az;for(const sign of [-1,1]){let ta=v===0?clamp(a+step[v]*sign,minA,maxA):a,tq=v===1?clamp(q+step[v]*sign,0,1.35):q,taz=v===2?clamp(az+step[v]*sign,-limit,limit):az,c=cost(ta,tq,taz);if(c<best){best=c;na=ta;nq=tq;naz=taz}}a=na;q=nq;az=naz;}step=step.map(x=>x*.76);}
  let result=make(a,q,az);if(clearance(result)<goal){let best=cost(a,q,az);for(let ia=0;ia<3;ia++)for(let iq=0;iq<7;iq++)for(let iz=0;iz<15;iz++){let ta=mix(minA,maxA,ia/2),tq=iq*.20,taz=mix(-limit,limit,iz/14),c=cost(ta,tq,taz);if(c<best){best=c;a=ta;q=tq;az=taz;}}let st=[.03,.06,.08];for(let k=0;k<12;k++){for(let v=0;v<3;v++){let best=cost(a,q,az),na=a,nq=q,naz=az;for(const sign of [-1,1]){let ta=v===0?clamp(a+st[v]*sign,minA,maxA):a,tq=v===1?clamp(q+st[v]*sign,0,1.35):q,taz=v===2?clamp(az+st[v]*sign,-limit,limit):az,c=cost(ta,tq,taz);if(c<best){best=c;na=ta;nq=tq;naz=taz}}a=na;q=nq;az=naz;}st=st.map(x=>x*.73);}result=make(a,q,az);}if(clearance(result)>=goal){let lo=0,hi=1;for(let k=0;k<12;k++){let u=(lo+hi)/2,c=make(mix(original.angles[0],a,u),mix(original.angles[1],q,u),mix(original.abduction,az,u));if(clearance(c)>=goal&&c.points[3][1]>=keySurface(c.points[3],depressions)+.007)hi=u;else lo=u;}result=make(mix(original.angles[0],a,hi),mix(original.angles[1],q,hi),mix(original.abduction,az,hi));}fingers[f]={...original,...result};
 }
 return fingers;
}
function palmCost(palm,targets,hand,reference,collision=true){let cost=0,solved=[];for(let n of targets){let base=root(palm,hand,n.f),ls=lengths[physical(hand,n.f)],d=Math.hypot(...sub(n.point,base)),finger=solveFinger(base,n.point,hand,n.f,palm.yaw||0);solved[n.f]=finger;cost+=finger.error**2*50000;let [mn,mx]=bounds(ls);cost+=(d-(mn+mx)*.55)**2*.15;}if(collision){for(let f=0;f<5;f++)if(!solved[f]){let base=root(palm,hand,f);solved[f]=solveFinger(base,planningTip(base,hand,f,palm.yaw),hand,f,palm.yaw)}for(let i=0;i<solved.length;i++)for(let j=i+1;j<solved.length;j++){let gap=fingerGap(solved[i],solved[j]);cost+=Math.max(0,.015-gap)**2*(targets.some(t=>t.f===i)&&targets.some(t=>t.f===j)?22000:2500);}}cost+=(palm.x-reference.x)**2*.008+(palm.z-reference.z)**2*.02+(palm.y-reference.y)**2*.025+(palm.yaw-reference.yaw)**2*.0004;return cost}
function fitPalm(targets,hand,reference,iterations=7){let p={...reference};if(!targets.length)return p;let step=[.06,.045,.028,.18];for(let pass=0;pass<iterations;pass++){for(let [j,k] of ['x','z','y','yaw'].entries()){let best=p,bestCost=palmCost(p,targets,hand,reference,false);for(let sign of [-1,1]){let test={...p,[k]:p[k]+step[j]*sign};test.y=clamp(test.y,1.050,1.14);test.z=clamp(test.z,-.72,-.56);test.yaw=clamp(test.yaw,-.38,.38);let c=palmCost(test,targets,hand,reference,false);if(c<bestCost){best=test;bestCost=c}}p=best;}step=step.map(v=>v*.58)}return p}
function combinations(n,k,start=0,prefix=[],out=[]){if(prefix.length===k){out.push(prefix.slice());return out}for(let i=start;i<n;i++)combinations(n,k,i+1,[...prefix,i],out);return out}
function pedalAt(song,t){let lo=0,hi=song.pedals.length;while(lo<hi){let m=(lo+hi)>>1;if(song.pedals[m][0]<=t)lo=m+1;else hi=m}return lo>0&&song.pedals[lo-1][1]>=64}
// Fingering numbers are anatomical (1 = thumb), unlike ascending key slots f.
const digit=(hand,f)=>physical(hand,f)+1;
const blackKey=p=>keyboard.map.get(p).black;
// Standard one-octave major scales. These are preferences, never overrides of IK.
const majorDigits={
  0:[[1,2,3,1,2,3,4,5],[5,4,3,2,1,3,2,1]],
  2:[[1,2,3,1,2,3,4,5],[5,4,3,2,1,3,2,1]],
  4:[[1,2,3,1,2,3,4,5],[5,4,3,2,1,3,2,1]],
  7:[[1,2,3,1,2,3,4,5],[5,4,3,2,1,3,2,1]],
  9:[[1,2,3,1,2,3,4,5],[5,4,3,2,1,3,2,1]],
  11:[[1,2,3,1,2,3,4,5],[4,3,2,1,4,3,2,1]],
  5:[[1,2,3,4,1,2,3,4],[5,4,3,2,1,3,2,1]],
  10:[[2,1,2,3,1,2,3,4],[3,2,1,4,3,2,1,3]],
  3:[[3,1,2,3,4,1,2,3],[3,2,1,4,3,2,1,3]],
  8:[[3,4,1,2,3,1,2,3],[3,2,1,4,3,2,1,3]],
  1:[[2,3,1,2,3,4,1,2],[3,2,1,4,3,2,1,3]],
  6:[[2,3,4,1,2,3,1,2],[4,3,2,1,3,2,1,4]]
};
function fingeringHints(groups,hand){let hints=new Map(),scale=[0,2,4,5,7,9,11,12];
 for(let i=0;i+7<groups.length;i++){let run=groups.slice(i,i+8);if(run.some(g=>g.notes.length!==1)||run.some((g,j)=>j&&g.t-run[j-1].t>.65))continue;let pitches=run.map(g=>g.notes[0][2]),up=pitches[7]>pitches[0],asc=up?pitches:pitches.slice().reverse(),base=asc[0];if(!asc.every((p,j)=>p-base===scale[j]))continue;let ds=majorDigits[base%12][hand].slice();
  // Continuing scales use the octave's normal passing finger, not an end finger.
  const after=groups[i+8],before=groups[i-1],continues=p=>[before,after].some(g=>g?.notes.length===1&&Math.min(Math.abs(g.t-run[0].t),Math.abs(g.t-run[7].t))<.65&&g.notes[0][2]===p);
  if(!hand&&continues(base+14)&&[0,2,4,5,7,9,11].includes(base%12))ds[7]=1;
  if(hand&&continues(base-1)&&[0,2,4,5,7,9,11].includes(base%12))ds[0]=1;
  if(!up)ds.reverse();for(let j=0;j<8;j++)if(!hints.has(i+j))hints.set(i+j,ds[j]);
 }
 return hints;
}
// Comfortable and practical maximum spans between two digits, in semitones
// (Parncutt et al. 1997). Beyond them the hand visibly splays.
const spanLimits={12:[8,10],13:[10,12],14:[12,14],15:[13,15],23:[3,5],24:[5,7],25:[8,10],34:[2,4],35:[5,7],45:[3,5]};
function stretchCost(d,e,semitones){if(d===e)return 0;let [comf,prac]=spanLimits[Math.min(d,e)*10+Math.max(d,e)];return Math.max(0,semitones-comf)*.38+Math.max(0,semitones-prac)**2*1.6+(semitones>prac?2:0);}
function fingeringLocal(g,c,hand,hint,prev,next){let cost=(c.splay||0)*.9,ns=g.notes;
 for(let j=0;j<ns.length;j++){let d=digit(hand,c.fs[j]),p=ns[j][2];if(ns.length===1){if(hint&&d!==hint)cost+=2.5;if(blackKey(p)){if(d===1)cost+=.18+((prev?.notes.some(n=>!blackKey(n[2]))?1:0)+(next?.notes.some(n=>!blackKey(n[2]))?1:0))*.22;if(d===5)cost+=.12;}if(d===4)cost+=.035;}
 }
 // Wide chords need outer digits; short digits on black octaves remain legal.
 if(ns.length>1){let span=ns.at(-1)[2]-ns[0][2];if(span>=7){if(c.fs[0]!==0)cost+=.30;if(c.fs.at(-1)!==4)cost+=.30;}for(let j=1;j<ns.length;j++){let sem=ns[j][2]-ns[j-1][2],df=c.fs[j]-c.fs[j-1];if(sem>=4&&df===1&&digit(hand,c.fs[j])!==1&&digit(hand,c.fs[j-1])!==1)cost+=.22;}for(let j=0;j<ns.length;j++)for(let k=j+1;k<ns.length;k++)cost+=stretchCost(digit(hand,c.fs[j]),digit(hand,c.fs[k]),ns[k][2]-ns[j][2]);}
 return cost;
}
function fingeringTransition(a,ac,b,bc,hand){let dt=b.t-a.t,detached=dt>Math.max(.5,Math.max(...a.notes.map(n=>n[1]))+.22),move=Math.abs(bc.palm.x-ac.palm.x),cost=move*move*14+Math.max(0,move/Math.max(.06,dt)-1.1)*.45;
 if(detached)return cost*.35;
 if(a.notes.length===1&&b.notes.length===1){let p=a.notes[0][2],q=b.notes[0][2],f=ac.fs[0],g=bc.fs[0],d=digit(hand,f),e=digit(hand,g),semitones=Math.abs(q-p),direction=Math.sign(q-p),fd=Math.sign(g-f),cross=direction*fd<0;
  if(!semitones){if(dt<.22){if(d===e)cost+=.55;else{cost+=Math.max(0,Math.abs(e-d)-1)*.12;if(d<=3&&e<=3)cost+=e===d-1?0:e===3&&d===1?.025:.11;else cost+=.22;}}else if(d!==e)cost+=.26;}
  else if(d===e)cost+=semitones<=7?.75:.12;
  else if(cross){if(d!==1&&e!==1)cost+=2.2;else{let other=d===1?e:d,thumbPitch=d===1?p:q,fingerPitch=d===1?q:p;cost+=other===3?.12:other===4?.15:other===2?.35:.95;cost+=blackKey(thumbPitch)?(blackKey(fingerPitch)?.18:.65):blackKey(fingerPitch)?0:.08;if(semitones>4)cost+=(semitones-4)*.12;}}
  else{let thumb=d===1||e===1,comfortable=thumb?Math.abs(e-d)*2.4+2:Math.abs(e-d)*2.2+1;cost+=Math.max(0,semitones-comfortable)**2*.06+stretchCost(d,e,semitones)*(dt<.3?1:.55);if(semitones<=2)cost+=Math.max(0,Math.abs(e-d)-1)*.12;}
 }
 // A repeated chord is a stable hand shape, rather than new random fingers.
 if(a.notes.length===b.notes.length&&a.notes.every((n,j)=>n[2]===b.notes[j][2]))for(let j=0;j<ac.fs.length;j++)if(ac.fs[j]!==bc.fs[j])cost+=.16;
 return cost;
}
function fingeringTrigram(a,ac,b,bc,c,cc,hand){if(!a||a.notes.length!==1||b.notes.length!==1||c.notes.length!==1||c.t-a.t>1.3)return 0;let p=a.notes[0][2],q=b.notes[0][2],r=c.notes[0][2],f=ac.fs[0],g=bc.fs[0],h=cc.fs[0],d=digit(hand,f),e=digit(hand,g),k=digit(hand,h),cost=0;
 if(p===r&&p!==q&&f!==h)cost+=.30;
 if(p!==r&&f===h&&(q-p)*(r-q)>0)cost+=.42;
 if((p-q)*(q-r)>0&&d>=3&&e>=3&&k>=3&&new Set([d,e,k]).size===3)cost+=.06;
 return cost;
}
// A shortest path through all attack groups, retaining the last TWO shapes.
// Future chords and phrase endings can therefore change an earlier finger.
function chooseFingerings(groups,candidates,hand){let hints=fingeringHints(groups,hand),layers=[];
 for(let i=0;i<groups.length;i++){let layer=[],prior=layers[i-1];for(let j=0;j<candidates[i].length;j++){let c=candidates[i][j],local=c.cost+fingeringLocal(groups[i],c,hand,hints.get(i),groups[i-1],groups[i+1]);if(!prior){layer.push({cost:local,index:j,prevIndex:-1,parent:null});continue;}
   const bestByPrevious=new Map();for(const state of prior){let pc=candidates[i-1][state.index],v=state.cost+local+fingeringTransition(groups[i-1],pc,groups[i],c,hand);if(i>1)v+=fingeringTrigram(groups[i-2],candidates[i-2][state.prevIndex],groups[i-1],pc,groups[i],c,hand);let old=bestByPrevious.get(state.index);if(!old||v<old.cost)bestByPrevious.set(state.index,{cost:v,index:j,prevIndex:state.index,parent:state});}layer.push(...bestByPrevious.values());
  }layers.push(layer);}
 if(!layers.length)return[];let s=layers.at(-1).reduce((a,b)=>a.cost<b.cost?a:b),chosen=Array(groups.length);for(let i=groups.length-1;i>=0;i--){chosen[i]=candidates[i][s.index];s=s.parent;}return chosen;
}
function settleHandPositions(groups,choices,hand){let position=0;
 // A five-finger position should not move sideways separately for every note.
 // Try a shared palm only when all its fixed fingers reach and remain separated.
 for(let i=0;i<groups.length;){let run=[],used=new Set(),ordered=[];
  for(let j=i;j<Math.min(groups.length,i+5);j++){let g=groups[j],c=choices[j];if(g.notes.length!==1||(j>i&&g.t-groups[j-1].t>.65)||used.has(c.fs[0]))break;let pair={pitch:g.notes[0][2],f:c.fs[0]};let sorted=[...ordered,pair].sort((a,b)=>a.pitch-b.pitch);if(sorted.some((p,k)=>k&&p.f<=sorted[k-1].f))break;used.add(pair.f);ordered=sorted;run.push(j);}
  if(run.length<2){i++;continue;}let targets=run.map(j=>{let n=groups[j].notes[0],f=choices[j].fs[0];return{f,point:keyPoint(n[2],1,contactZ(n[2],hand,f,blackKey(n[2])))}}),ref={...choices[i].palm};for(const k of ['x','y','z','yaw','pitch'])ref[k]=run.reduce((v,j)=>v+choices[j].palm[k],0)/run.length;let palm=fitPalm(targets,hand,ref,16),solved=targets.map(n=>solveFinger(root(palm,hand,n.f),n.point,hand,n.f,palm.yaw)),clear=solved.every(f=>f.error<.0025);for(let a=0;a<solved.length;a++)for(let b=a+1;b<solved.length;b++)if(fingerGap(solved[a],solved[b])<.015)clear=false;
  if(clear){let prepared=run.map(j=>{let n=groups[j].notes[0],f=choices[j].fs[0];return{pitch:n[2],f,z:contactZ(n[2],hand,f,blackKey(n[2]))}});for(const j of run){choices[j]={...choices[j],independentPalm:choices[j].palm,palm:{...palm},position,prepared};}position++;i+=run.length;}else i++;
 }
}
function build(song){
 if(song.motion)return song.motion;let hands=[],crossings=0,rolledAttacks=0;
 if(!song.originalNotes){song.originalNotes=song.notes;let working=song.notes.map(n=>n.slice()),ci=0,lastCenters=[.3,-.3],reassigned=0;
 // MIDI staves are voices, not always physically playable hand divisions.
 // Redistribute simultaneous voices to two comfortable, noncrossing hands.
 while(ci<working.length){let t=working[ci][0],group=[];while(ci<working.length&&working[ci][0]<t+.04)group.push(working[ci++]);group.sort((a,b)=>a[2]-b[2]);let best=null;
  for(let cut=0;cut<=group.length;cut++){let left=group.slice(0,cut),right=group.slice(cut);if(left.length>5||right.length>5)continue;let span=a=>a.length?keyboard.map.get(a.at(-1)[2]).x-keyboard.map.get(a[0][2]).x:0;if(span(left)>.285||span(right)>.285)continue;let cost=0,centers=lastCenters.slice();for(let [hand,notes] of [[1,left],[0,right]]){if(notes.length){let x=notes.reduce((s,n)=>s+keyboard.map.get(n[2]).x,0)/notes.length;cost+=(x-lastCenters[hand])**2*.5;centers[hand]=x;}for(let n of notes)if(n[4]!==hand)cost+=.025;}if(!best||cost<best.cost)best={cost,left,right,centers};}
  if(best){for(let n of best.left){if(n[4]!==1)reassigned++;n[4]=1}for(let n of best.right){if(n[4]!==0)reassigned++;n[4]=0}lastCenters=best.centers;}
 }
 song.reassignedNotes=reassigned;let performed=[];for(let hand=0;hand<2;hand++){let seq=working.filter(n=>n[4]===hand),i=0;while(i<seq.length){let t=seq[i][0],g=[];while(i<seq.length&&seq[i][0]<t+.04)g.push(seq[i++].slice());g.sort((a,b)=>a[2]-b[2]);let chunk=0,first=0,count=0;for(let n of g){let x=keyboard.map.get(n[2]).x;if(count&&((x-first)>.285||count>=5)){chunk++;count=0}if(!count)first=x;count++;let offset=chunk*.12;if(offset)rolledAttacks++;n[0]+=offset;n[1]=Math.max(.025,n[1]-offset);performed.push(n)}}}song.notes=performed.sort((a,b)=>a[0]-b[0]||a[2]-b[2]);song.rolledAttacks=rolledAttacks;}
 for(let hand=0;hand<2;hand++){
  let seq=song.notes.filter(n=>n[4]===hand),groups=[],i=0;
  while(i<seq.length){let t=seq[i][0],notes=[];while(i<seq.length&&seq[i][0]<t+.04)notes.push(seq[i++]);notes.sort((a,b)=>a[2]-b[2]);groups.push({t,notes})}
  let candidates=groups.map(g=>{
   let notes=g.notes.slice(0,5),center=notes.reduce((s,n)=>s+keyboard.map.get(n[2]).x,0)/notes.length,black=notes.filter(n=>blackKey(n[2])).length/notes.length,options=combinations(5,notes.length),all=[];
   for(let fs of options){let targets=notes.map((n,j)=>({f:fs[j],point:keyPoint(n[2],1,contactZ(n[2],hand,fs[j],!!black))})),ref={x:center,z:mix(-.65,-.605,black),y:1.102,pitch:.055*(Math.max(...notes.map(n=>n[3]))/127)**2,yaw:0},palm=fitPalm(targets,hand,ref,10);
    if(targets.some(n=>solveFinger(root(palm,hand,n.f),n.point,hand,n.f,palm.yaw).error>.003)){for(const yaw of [0,-.20,.20]){let alt=fitPalm(targets,hand,{...ref,z:-.607,y:1.076,yaw},14);if(palmCost(alt,targets,hand,ref)<palmCost(palm,targets,hand,ref))palm=alt;}}
    const solved=targets.map(n=>solveFinger(root(palm,hand,n.f),n.point,hand,n.f,palm.yaw)),error=Math.max(...solved.map(f=>f.error));let gap=Infinity;for(let a=0;a<solved.length;a++)for(let b=a+1;b<solved.length;b++)gap=Math.min(gap,fingerGap(solved[a],solved[b]));let splay=0;for(let j=0;j<solved.length;j++){if(physical(hand,fs[j]))splay+=solved[j].abduction**2;if(j&&physical(hand,fs[j-1])&&physical(hand,fs[j]))splay+=Math.max(0,Math.abs(solved[j].abduction-solved[j-1].abduction)-.18)**2*4;}all.push({cost:palmCost(palm,targets,hand,ref)*100,palm,fs,error,gap,splay});
   }
   // Technique preferences cannot choose a finger that misses the keyboard.
   const clear=all.filter(c=>c.error<.0058&&c.gap>.015);if(clear.length)return clear;const min=Math.min(...all.map(c=>c.error));return all.filter(c=>c.error<=min+.0001&&c.gap>.014).length?all.filter(c=>c.error<=min+.0001&&c.gap>.014):[all.reduce((a,b)=>a.cost<b.cost?a:b)];
  });
  let choices=chooseFingerings(groups,candidates,hand);settleHandPositions(groups,choices,hand);let frames=[],fingers=Array.from({length:5},()=>[]),occupied=Array(5).fill(null);
  for(let gi=0;gi<groups.length;gi++){
   let g=groups[gi],notes=g.notes.slice(0,5),best=choices[gi],black=notes.some(n=>blackKey(n[2])),prev=groups[gi-1],pc=choices[gi-1],crossing=prev?.notes.length===1&&notes.length===1&&((notes[0][2]-prev.notes[0][2])*(best.fs[0]-pc.fs[0])<0),thumbCross=crossing&&(digit(hand,best.fs[0])===1||digit(hand,pc.fs[0])===1);
   if(thumbCross)crossings++;
   let frame={t:g.t,palm:best.palm,notes:[],crossing:thumbCross,position:best.position,prepared:best.prepared,independentPalm:best.independentPalm};
   if(thumbCross)frame.passing={kind:digit(hand,best.fs[0])===1?'thumb-under':'finger-over',fromDigit:digit(hand,pc.fs[0]),toDigit:digit(hand,best.fs[0]),direction:Math.sign(notes[0][2]-prev.notes[0][2])};
   for(let j=0;j<g.notes.length;j++){let n=g.notes[j],f=best.fs[Math.min(j,4)];n[5]=f;let nextGroup=groups[gi+1],end=n[0]+n[1];
    // Sustain is carried by the pedal, freeing the hand for its next position.
    if(nextGroup){let nextCenter=nextGroup.notes.reduce((s,k)=>s+keyboard.map.get(k[2]).x,0)/nextGroup.notes.length,shift=Math.abs(nextCenter-best.palm.x),samePosition=best.position!==undefined&&choices[gi+1].position===best.position,lead=samePosition?.024:clamp(shift*.75+.10,.07,.50);end=Math.min(end,Math.max(n[0]+.003,Math.min(nextGroup.t-.016,nextGroup.t-lead)));}
    if(occupied[f]&&occupied[f].end>n[0]-.03)occupied[f].end=Math.max(occupied[f].t+.012,n[0]-.035);
    let event={t:n[0],end,pitch:n[2],velocity:n[3],f,z:contactZ(n[2],hand,f,!!black),crossing:thumbCross};if(best.independentPalm&&nextGroup){let nextCenter=nextGroup.notes.reduce((s,k)=>s+keyboard.map.get(k[2]).x,0)/nextGroup.notes.length,lead=clamp(Math.abs(nextCenter-best.independentPalm.x)*.75+.10,.07,.50);event.independentEnd=Math.min(n[0]+n[1],Math.max(n[0]+.003,Math.min(nextGroup.t-.016,nextGroup.t-lead)));}fingers[f].push(event);occupied[f]=event;frame.notes.push(event);
   }
   frames.push(frame);
  }
  for(let i=0;i<frames.length;i++)for(const n of frames[i].notes){n.releaseEnd=Math.min(n.end+.18,frames[i+1]?.t??Infinity);n.approachStart=Math.max(n.t-.18,i?Math.max(...frames[i-1].notes.map(e=>e.end)):0);}
  hands.push({frames,fingers});
 }
 // A smoothed score-derived envelope, rather than a perpetual unrelated sine sway.
 const envelope=[];for(let i=0;i<=Math.ceil(song.duration*10);i++)envelope.push({power:0,weight:0});
 for(let n of song.notes){let center=Math.round(n[0]*10),strength=(n[3]/127)**2;for(let d=-12;d<=18;d++){let k=center+d;if(k>=0&&k<envelope.length){let w=Math.exp(-d*d/60);envelope[k].power+=strength*w;envelope[k].weight+=w}}}
 for(let e of envelope){let loud=e.weight?e.power/e.weight:0;e.energy=clamp(Math.sqrt(loud)*.64+Math.min(e.weight/12,1)*.36,0,1)}
 song.motion={hands,envelope,crossings,version:13};prepareHangingPlan(song);return song.motion;
}
function independentFramePalm(frame,hand){let ns=frame.notes,black=ns.filter(n=>blackKey(n.pitch)).length/ns.length,center=ns.reduce((v,n)=>v+keyboard.map.get(n.pitch).x,0)/ns.length,ref={x:center,z:mix(-.65,-.605,black),y:1.102,pitch:.055*(Math.max(...ns.map(n=>n.velocity))/127)**2,yaw:0},targets=ns.map(n=>({f:n.f,point:keyPoint(n.pitch,1,n.z)})),p=fitPalm(targets,hand,ref,10);if(targets.some(n=>pressFinger(p,hand,n.f,n.pitch,n.press).error>.003))for(const yaw of [0,-.20,.20]){let alt=fitPalm(targets,hand,{...ref,z:-.607,y:1.076,yaw},14);if(palmCost(alt,targets,hand,ref)<palmCost(p,targets,hand,ref))p=alt;}return p;}
function validatePreparedPositions(song){let retained=0,rejected=0;
 for(let hand=0;hand<2;hand++){let hp=song.motion.hands[hand],ids=new Set(hp.frames.filter(f=>f.position!==undefined).map(f=>f.position));hp.fingers=Array.from({length:5},()=>[]);for(const fr of hp.frames)for(const n of fr.notes)hp.fingers[n.f].push(n);
  for(let pass=0;pass<12;pass++){let bad=new Set();for(let i=0;i<hp.frames.length;i++){let fr=hp.frames[i],neighbors=hp.frames.slice(Math.max(0,i-1),i+2),positions=neighbors.filter(f=>f.position!==undefined).map(f=>f.position);if(!positions.length)continue;let times=new Set([fr.t+.0001]);if(hp.frames[i+1])for(let t=Math.max(fr.t,hp.frames[i+1].t-1.2);t<=hp.frames[i+1].t;t+=1/240)times.add(t);for(const n of fr.notes)for(const anchor of [n.t,n.end])for(let j=-7;j<=7;j++)times.add(anchor+j/240);let last=null,lastT=-Infinity;for(const t of [...times].sort((a,b)=>a-b)){if(t<0)continue;let h=pose(song,t).hands[hand],unsafe=h.fingers.some(f=>f.contact&&f.error>.0078);for(let a=0;a<5;a++)for(let b=a+1;b<5;b++)if(fingerGap(h.fingers[a],h.fingers[b])<.0138)unsafe=true;if(last&&t-lastT<.0043)for(let f=0;f<5;f++)if(Math.hypot(...sub(h.fingers[f].points[3],last.fingers[f].points[3]))>.024)unsafe=true;if(unsafe){for(const id of positions)bad.add(id);break;}last=h;lastT=t;}}
   if(!bad.size)break;for(const fr of hp.frames)if(bad.has(fr.position)){fr.palm=fr.independentPalm||independentFramePalm(fr,hand);delete fr.position;delete fr.prepared;frameAngles.delete(fr);for(const n of fr.notes)if(n.independentEnd!==undefined)n.end=n.independentEnd;else{let source=song.notes.find(k=>k[4]===hand&&Math.abs(k[0]-n.t)<.000001&&k[2]===n.pitch),next=hp.frames[hp.frames.indexOf(fr)+1];if(source&&next){let center=next.notes.reduce((v,k)=>v+keyboard.map.get(k.pitch).x,0)/next.notes.length,lead=clamp(Math.abs(center-fr.palm.x)*.75+.10,.07,.50);n.end=Math.min(n.t+source[1],Math.max(n.t+.003,Math.min(next.t-.016,next.t-lead)));}}}for(const id of bad){ids.delete(id);rejected++;}for(let i=0;i<hp.frames.length;i++)for(const n of hp.frames[i].notes){n.releaseEnd=Math.min(n.end+.18,hp.frames[i+1]?.t??Infinity);n.approachStart=Math.max(n.t-.18,i?Math.max(...hp.frames[i-1].notes.map(e=>e.end)):0);}
  }retained+=ids.size;for(const fr of hp.frames){delete fr.independentPalm;for(const n of fr.notes)delete n.independentEnd;}
 }song.motion.sharedPositions={retained,rejected};song.motion.version=11;
}
// The hand may start a small shift while keys are still held, but only when every
// held finger can stay on its key from the moving palm.
const earlyShift=new WeakMap();
function shiftOverlap(prev,next,hand){let cached=earlyShift.get(prev);if(cached!==undefined)return cached;let dx=Math.abs(next.palm.x-prev.palm.x),travel=clamp(dx*.8+.18,.18,.62),overlap=Math.max(0,.2-dx*2.5),hold=Math.max(...prev.notes.map(n=>n.end)),begin=Math.max(prev.t+.005,hold-overlap,next.t-travel);
 if(hand!==undefined&&hold>begin){let u=smooth((hold-begin)/(next.t-begin)),p={...prev.palm};for(const k of ['x','y','z','yaw'])p[k]=mix(prev.palm[k],next.palm[k],u);if(prev.notes.some(n=>n.end>begin&&pressFinger(p,hand,n.f,n.pitch).error>.0025))overlap=0;}
 if(hand!==undefined)earlyShift.set(prev,overlap);return overlap;}
function palmAt(handPlan,t,hand){let frames=handPlan.frames,i=lower(frames,t+.000001)-1,prev=frames[i],next=frames[i+1];if(!prev){let p=next?.palm||{x:0,z:-.65,y:1.1,yaw:0};return{...p,y:p.y+.02*(1-smooth((t-(next?.t||0)+.4)/.4))}}
 let p={...prev.palm};if(next){let gap=next.t-prev.t,dx=Math.abs(next.palm.x-p.x),travel=clamp(dx*.8+.18,.18,.62),overlap=shiftOverlap(prev,next,hand),hold=Math.max(...prev.notes.map(n=>n.end)),begin=Math.min(next.t-.001,Math.max(prev.t+.005,hold-overlap,next.t-travel)),u=smooth((t-begin)/(next.t-begin));for(let k of ['x','y','z','yaw'])p[k]=mix(p[k],next.palm[k],u);p.blend=u;let free=Math.max(begin,Math.min(hold,next.t-.001)),w=smooth((t-free)/(next.t-free));p.y+=Math.sin(Math.PI*w)*Math.min(.02,gap*.02);if(next.crossing){let arc=Math.sin(Math.PI*w);p.y+=arc*(next.passing?.kind==='finger-over'?.013:.007);p.yaw+=arc*.07*(next.passing?.direction||1)}}
 return p;
}
const frameAngles=new WeakMap();
function relaxedAngles(palm,hand,f,az){let phys=physical(hand,f),sign=hand?-1:1;if(az===undefined)az=(phys===0?-.42:(phys-2)*.06)*sign;let a=-(palm.pitch||0),ls=lengths[phys],base=root(palm,hand,f),floor=keyboard.whiteTop+keyboard.blackHeight+.010,lo=0,hi=.36;for(let j=0;j<16;j++){let q=(lo+hi)/2,y=base[1]+ls[0]*Math.sin(a)+ls[1]*Math.sin(a-q)+ls[2]*Math.sin(a-1.65*q);if(y>=floor)lo=q;else hi=q;}return{a,q:lo,az:clamp(az,-relaxedAbduction[phys],relaxedAbduction[phys])}}
function anglesAtFrame(frame,hand){if(!frame)return null;let cached=frameAngles.get(frame);if(cached)return cached;let contacts=frame.notes.map(n=>({...n,solved:pressFinger(frame.palm,hand,n.f,n.pitch)})),result=[];
 for(let f=0;f<5;f++){let n=contacts.find(n=>n.f===f),prepared=frame.prepared?.find(n=>n.f===f),fingers=contacts.filter(n=>physical(hand,n.f)!==0),below=fingers.filter(n=>n.f<f).sort((a,b)=>b.f-a.f)[0],above=fingers.filter(n=>n.f>f).sort((a,b)=>a.f-b.f)[0],nearAz=below&&above?mix(below.solved.abduction,above.solved.abduction,(f-below.f)/(above.f-below.f)):(below||above)?.solved.abduction,solved=n?.solved||(prepared?pressFinger(frame.palm,hand,f,prepared.pitch,0):null),rest=relaxedAngles(frame.palm,hand,f,physical(hand,f)===0?undefined:nearAz);result.push(solved?{a:solved.angles[0],q:solved.angles[1],az:solved.abduction,restAz:n?rest.az:solved.abduction}:{...rest,restAz:rest.az});}frameAngles.set(frame,result);return result;
}
const releasePoses=new WeakMap();
function releaseAngles(hp,n,hand){let cached=releasePoses.get(n);if(cached)return cached;let t=Math.max(n.t,n.end-.000002),p=palmAt(hp,t,hand),targets=[];for(let f=0;f<5;f++){let seq=hp.fingers[f],i=lower(seq,t+.000001)-1,e=seq[i];if(e&&t<e.end)targets.push({f,pitch:e.pitch,press:1,point:keyPoint(e.pitch,1,e.z)});}p=articulatePalm(p,targets,hand,wristGesture(hp,t));let F=pressFinger(p,hand,n.f,n.pitch);cached={a:F.angles[0]+p.pitch,q:F.angles[1],az:F.abduction};releasePoses.set(n,cached);return cached;}
function transitFinger(hp,t,palm,hand,state,spread){let f=state.f,phys=physical(hand,f),sign=hand?-1:1,base=root(palm,hand,f),rest=relaxedAngles(palm,hand,f),seq=hp.fingers[f],ni=lower(seq,t+.000001)-1,old=seq[ni],next=seq[ni+1],a=rest.a,q=rest.q,az=rest.az;
 if(phys!==0){let i=lower(hp.frames,t+.000001)-1,from=anglesAtFrame(hp.frames[Math.max(0,i)],hand)?.[f],to=anglesAtFrame(hp.frames[i+1],hand)?.[f];if(from){rest.az=mix(from.restAz,to?.restAz??from.restAz,palm.blend||0);az=rest.az;}}
 // A released finger follows the hand in its own joint pose. It does not
 // continue reaching back across its neighbours toward the previous key.
 if(old&&t>=old.end&&t<old.end+.13){let played=releaseAngles(hp,old,hand);var r=smooth((t-old.end)/Math.min(.13,Math.max(.016,(next?.t??old.end+.2)-old.end)*.7));a=mix(played.a-(palm.pitch||0),a,r);q=mix(played.q,q,r);az=mix(played.az,az,r);}
 let freedom=old&&t>=old.end&&t<old.end+.13?r:1;let fan=(spread?.phase||0)*(spread?.amount||0)*.04*(phys===0?-.7:(phys-2)/2)*sign;az+=fan;
 if(next&&t<next.t){let begin=Math.max(old?.end??0,next.t-.14),v=smooth((t-begin)/Math.max(.008,next.t-begin)),played=pressFinger(palm,hand,f,next.pitch,smooth((t-next.t+.018)/.018));freedom*=1-v;a=mix(a,played.angles[0],v);q=mix(q,played.angles[1],v);az=mix(az,played.abduction,v);}
 az=clamp(az,-abduction[phys],abduction[phys]);let solved=bendFinger(base,hand,f,a,q,palm.yaw+az,palm.yaw,state.point||defaultTip(base,hand,f,palm.yaw,palm.pitch));return{...solved,avoided:false,restMCP:0,freedom,approaching:!!next&&next.t-t<.05};
}
function wristGesture(hp,t){let release=0,nextTime=Infinity,velocity=0;
 for(const seq of hp.fingers){let i=lower(seq,t+.000001)-1;if(i>=0)release=Math.max(release,seq[i].end);if(seq[i+1]&&seq[i+1].t<nextTime){nextTime=seq[i+1].t;velocity=seq[i+1].velocity/127;}}
 let lift=0,force=velocity*velocity;
 if(t>=release&&t<nextTime){let begin=Math.max(release,nextTime-.28),span=nextTime-begin,u=(t-begin)/span;if(span>0&&u>0&&u<1)lift=(.012+.05*force)*Math.min(1,span/.16)*Math.sin(Math.PI*u)**2;}
 let prep=0,impact=0,i=lower(hp.frames,t+.26)-1;
 for(;i>=0&&hp.frames[i].t>t-.32;i--){let n=hp.frames[i],age=t-n.t,v=Math.max(...n.notes.map(k=>k.velocity))/127,q=v*v;force=Math.max(force,q*Math.exp(-Math.abs(age)/.15));
  if(age<0&&age>-.26)prep=Math.max(prep,(.06+.16*q)*Math.sin(Math.PI*(age+.26)/.26)**2);
  if(age>-.05&&age<.32){let u=age<0?smooth((age+.05)/.05):1-smooth(age/.32);impact=Math.max(impact,(.04+.10*q)*u);}
 }
 return{lift,force,prep,impact,pitch:clamp(impact-prep,-.26,.16)};
}
function spreadAt(hp,t){let i=lower(hp.frames,t+.000001)-1,prev=hp.frames[i],next=hp.frames[i+1];if(!next)return{amount:0,lead:0,speed:0,fan:0};let span=next.notes.length?Math.max(...next.notes.map(n=>keyboard.map.get(n.pitch).x))-Math.min(...next.notes.map(n=>keyboard.map.get(n.pitch).x)):0,travel=Math.abs(next.palm.x-(prev?.palm.x??next.palm.x)),speed=travel/Math.max(.055,next.t-(prev?.t??next.t-.3)),amount=clamp(speed*.42+Math.max(0,span-.085)*3.5,0,1),lead=clamp(.16+travel*.35+amount*.10,.16,.36),phase=smooth((t-next.t+lead)/lead),activation=prev?smooth((t-prev.t)/Math.min(.060,Math.max(.008,(next.t-prev.t)*.25))):1;
 return{amount:amount*activation,phase,lead,speed,span};
}
function articulatePalm(nominal,targets,hand,gesture){let original={...nominal},referencePitch=original.pitch||0,weight=targets.reduce((v,n)=>Math.max(v,n.weight??1),0),pitch=gesture.pitch*(1-.96*weight),sp=Math.sin(pitch)-Math.sin(referencePitch),cp=Math.cos(pitch)-Math.cos(referencePitch);gesture.applied=1-.96*weight;return{...original,pitch,y:original.y+.108*sp+.004*cp+gesture.lift*(1-weight),z:original.z-.108*cp+.004*sp};}
function pose(song,t){let plan=build(song),hands=[],depressions=new Map();
 for(let hand=0;hand<2;hand++){
  let hp=plan.hands[hand],palm=palmAt(hp,t,hand),gesture=wristGesture(hp,t),spread=spreadAt(hp,t),targets=[],states=[];
  for(let f=0;f<5;f++){
   let seq=hp.fingers[f],i=lower(seq,t+.000001)-1,n=seq[i],next=seq[i+1],state={f,contact:false,press:0,event:null};
   if(n&&t>=n.t&&t<n.end+.055){let press=1-smooth((t-n.end)/.055);depressions.set(n.pitch,Math.max(depressions.get(n.pitch)||0,press));}
   if(next&&t>=next.t-.018&&t<next.t){let press=smooth((t-next.t+.018)/.018);depressions.set(next.pitch,Math.max(depressions.get(next.pitch)||0,press));}
   if(n&&t<=n.end+.18){let releaseEnd=n.releaseEnd??(n.end+.18),release=smooth((t-n.end)/Math.max(.015,releaseEnd-n.end)),press=1-smooth((t-n.end)/.055),rest=defaultTip(root(palm,hand,f),hand,f,palm.yaw),point=keyPoint(n.pitch,press,n.z);state={f,contact:t<n.end,press,event:n,point:point.map((v,j)=>mix(v,rest[j],release))};state.point[1]+=Math.sin(Math.PI*release)*.025;}
   if(next){let begin=Math.max(n?n.end:next.t-.18,next.approachStart??(next.t-.18)),u=smooth((t-begin)/Math.max(.025,next.t-begin));if(t>=begin&&t<next.t){let base=root(palm,hand,f),rest=defaultTip(base,hand,f,palm.yaw),from=state.point||rest,to=keyPoint(next.pitch,1,next.z),v=sub(to,from);state.point=from.map((x,j)=>x+v[j]*u);state.point[1]+=Math.sin(Math.PI*u)*.04;state.event=next;state.contact=false;state.press=0;state.crossing=next.crossing;}}
   if(state.point&&state.contact)targets.push({f,point:state.point,pitch:state.event.pitch,press:state.press,weight:1});else if(n&&t>=n.end&&t<n.end+.07)targets.push({f,pitch:n.pitch,press:0,weight:1-smooth((t-n.end)/.07)});if(next&&t<next.t&&t>next.t-.055)targets.push({f,pitch:next.pitch,press:smooth((t-next.t+.018)/.018),weight:smooth((t-next.t+.055)/.055)});states.push(state);
  }
  // Fine adjustment is shared by the palm; fingers cannot stretch to reach keys.
  // The preplanned palm follows a continuous trajectory, without per-frame snaps.
  palm=articulatePalm(palm,targets,hand,gesture);
  let fingers=states.map(state=>{let base=root(palm,hand,state.f),want=state.point||defaultTip(base,hand,state.f,palm.yaw),solved=state.contact?pressFinger(palm,hand,state.f,state.event.pitch,state.press):transitFinger(hp,t,palm,hand,state,spread);if(state.press>0&&state.event&&t>=state.event.t)depressions.set(state.event.pitch,Math.max(depressions.get(state.event.pitch)||0,state.press));return{...state,...solved,floorWeight:state.event&&t>=state.event.t? smooth((t-state.event.end)/.09):1}});
  orderFingers(fingers,hand,palm.yaw);separateFingers(fingers,hand,palm.yaw,palm.pitch,depressions);hands.push({palm,fingers,gesture,spread});
 }
 let k=clamp(t*10,0,plan.envelope.length-1),a=Math.floor(k),b=Math.min(a+1,plan.envelope.length-1),energy=mix(plan.envelope[a].energy,plan.envelope[b].energy,k-a),accent=0;
 // Find recent attacks only, to keep deterministic seeking and bounded work.
 let idx=0,hi=song.notes.length;while(idx<hi){let m=(idx+hi)>>1;if(song.notes[m][0]<=t)idx=m+1;else hi=m}for(let i=idx-1;i>=0&&song.notes[i][0]>t-.4;i--){let age=t-song.notes[i][0];accent=Math.max(accent,(song.notes[i][3]/127)**2*(1-Math.exp(-age/.026))*Math.exp(-age/.15)*1.65);}
 let handCenter=(hands[0].palm.x+hands[1].palm.x)/2,nextNote=song.notes[idx],gaze=nextNote?keyboard.map.get(nextNote[2]).x:handCenter,prior=plan.envelope[Math.max(0,a-10)].energy,rise=clamp((energy-prior)*2.5,-.5,.5),breath=Math.sin((t%6)/6*Math.PI*2)*energy*.006,body={x:clamp(handCenter*.34,-.18,.18),y:.79+accent*.018+breath,z:-1.20+energy*.04+accent*.055,lean:.04+energy*.11,pitch:.025+energy*.17+accent*.11+rise*.065,yaw:clamp(handCenter*.21,-.18,.18),roll:clamp((hands[0].palm.x-hands[1].palm.x-.55)*.05,-.065,.065),headPitch:.08+energy*.14+accent*.25+rise*.07,headYaw:clamp(gaze*.30,-.30,.30),energy,accent,rise};
 return{hands,depressions,body};
}
// Geometric seed for the established fingering search, never a rendered pose.
function planningTip(base,hand,f,yaw,pitch=0){let i=physical(hand,f),q=.85,a=.65,ls=lengths[i],sign=hand?-1:1,az=yaw+(i===0?-.42*sign:(i-2)*.06*sign),p=base.slice();for(let j=0;j<3;j++){let angle=a-(j===0?0:j===1?q:1.65*q);p=add(p,[Math.sin(az)*ls[j]*Math.cos(angle),ls[j]*Math.sin(angle),Math.cos(az)*ls[j]*Math.cos(angle)])}return p}
function defaultTip(base,hand,f,yaw,pitch=0){let i=physical(hand,f),q=i===0?.36:.36,a=-pitch,ls=lengths[i],sign=hand?-1:1,az=yaw+(i===0?-.42*sign:(i-2)*.06*sign),p=base.slice();for(let j=0;j<3;j++){let angle=a-(j===0?0:j===1?q:1.65*q);p=add(p,[Math.sin(az)*ls[j]*Math.cos(angle),ls[j]*Math.sin(angle),Math.cos(az)*ls[j]*Math.cos(angle)])}return p}
function arm(shoulder,wrist,hand,force=0){let upper=.49,lower=.435,v=sub(wrist,shoulder),distance=Math.hypot(...v),d=clamp(distance,Math.abs(upper-lower)+.001,upper+lower-.002),dir=unit(v),end=add(shoulder,mul(dir,d)),along=(upper*upper-lower*lower+d*d)/(2*d),height=Math.sqrt(Math.max(0,upper*upper-along*along)),out=[hand?-.7:.7,-1+.18*force,-.45-.15*force],perp=unit(sub(out,mul(dir,dot(out,dir)))),elbow=add(add(shoulder,mul(dir,along)),mul(perp,height));return{shoulder,elbow,wrist:end,requestedWrist:wrist,lengths:[upper,lower],error:Math.abs(distance-d)}}
// Display-only easing of free fingers between rendered frames. Sounding and
// approaching fingers are never delayed, and every bone keeps its fixed length.
function soften(previous,current,dt,tau=.035){if(!previous||!(dt>0)||dt>.1)return current;let k=1-Math.exp(-dt/tau);
 for(let h=0;h<2;h++)for(let f=0;f<5;f++){let F=current.hands[h].fingers[f],P=previous.hands[h].fingers[f];if(F.contact||F.approaching||F.press>0)continue;let base=F.points[0],points=[base];
  for(let j=1;j<4;j++){let want=add(base,sub(F.points[j],base).map((v,i)=>mix(P.points[j][i]-P.points[0][i],v,k))),dir=unit(sub(want,points[j-1]));points.push(add(points[j-1],mul(dir,F.lengths[j-1])));}
  current.hands[h].fingers[f]={...F,points};}
 return current;}
return{keyboard,lengths,build,pose,soften,solveFinger,root,arm,physical,digit,validatePreparedPositions,chooseFingerings,fingeringHints,wristGesture,handPoint,segmentGap,fingerGap,spreadAt,articulatePalm,pressFinger,fitHangingPalm,prepareHangingPlan};
})();

'use strict';
// Bow-local overhand grips. X: frog -> tip; Y: toward the wrist;
// Z: away from the hair. Cello pinky drapes; violin pinky balances on top.
window.BowHand = (() => {
  const add=(a,b)=>a.map((v,i)=>v+b[i]), sub=(a,b)=>a.map((v,i)=>v-b[i]), mul=(a,s)=>a.map(v=>v*s);
  const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0), cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const unit=a=>mul(a,1/(Math.hypot(...a)||1)), clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const spec={violin:{stick:.0029,halfWidth:.006,depth:.018,front:.022,back:-.026},cello:{stick:.006,halfWidth:.008,depth:.022,front:.025,back:-.030}};
  function two(root,end,l1,l2,hint){
    const delta=sub(end,root),d=Math.hypot(...delta),x=unit(delta),y=unit(sub(hint,mul(x,dot(hint,x))));
    const a=(l1*l1-l2*l2+d*d)/(2*d),h=Math.sqrt(Math.max(0,l1*l1-a*a));
    return add(root,add(mul(x,a),mul(y,h)));
  }
  function chain(root,end,lengths,hint){
    const delta=sub(end,root),distance=Math.hypot(...delta),x=unit(delta),y=unit(sub(hint,mul(x,dot(hint,x))));
    const sum=q=>[lengths[0]+lengths[1]*Math.cos(q)+lengths[2]*Math.cos(1.65*q),-lengths[1]*Math.sin(q)-lengths[2]*Math.sin(1.65*q)];
    let lo=0,hi=1.82;for(let i=0;i<32;i++){const q=(lo+hi)/2;if(Math.hypot(...sum(q))>distance)lo=q;else hi=q;}
    const q=(lo+hi)/2,r=sum(q),a=-Math.atan2(r[1],r[0]),points=[root];
    for(let j=0;j<3;j++){const angle=a-(j===0?0:j===1?q:1.65*q);points.push(add(points.at(-1),mul(add(mul(x,Math.cos(angle)),mul(y,Math.sin(angle))),lengths[j])));}
    return points;
  }
  function canonical(type){
    const s=spec[type],contact=(kind,centre,target,radius)=>({kind,centre,target,radius});
    const digits=[];
    const thumbRadius=.006,thumbEnd=[s.front+.004,0,-s.stick-thumbRadius];
    digits.push({name:'thumb',points:chain([.043,.057,.023],thumbEnd,[.030,.023,.018],[1,0,-.2]),radii:[.009,.0075,thumbRadius],contactIndex:3,
      contact:contact('underside',thumbEnd,[thumbEnd[0],0,-s.stick],thumbRadius)});
    // The index bears on its middle phalanx, rather than poking the stick.
    const r=.0065,angle=.25,indexSeat=[.057,-(s.stick+r)*Math.cos(angle),(s.stick+r)*Math.sin(angle)],indexRoot=[.048,.020,.040];
    const indexEnd=add(indexSeat,[0,-.003,-.016]);
    digits.push({name:'index',points:[indexRoot,two(indexRoot,indexSeat,.033,.025,[0,-1,.3]),indexSeat,indexEnd],radii:[.008,.007,.0065],contactIndex:2,
      contact:contact('stick',indexSeat,[indexSeat[0],-s.stick*Math.cos(angle),s.stick*Math.sin(angle)],r)});
    for(const [name,a,z,lengths,radii] of [
      ['middle',s.front-.002,.041,[.034,.023,.017],[.0085,.007,.006]],
      ['ring',.001,.039,[.032,.022,.016],[.008,.0068,.0058]],
    ]){
      const end=[a,-s.halfWidth-radii[2],-.011];
      digits.push({name,points:chain([a,.020,z],end,lengths,[0,-1,.2]),radii,contactIndex:3,
        contact:contact('frog',end,[a,-s.halfWidth,-.011],radii[2])});
    }
    const pr=.005,pinkyEnd=type==='violin'?[-.018,0,s.stick+pr]:[-.021,-s.halfWidth-pr,-.006];
    digits.push({name:'pinky',points:chain([-.021,.024,.036],pinkyEnd,[.026,.018,.014],[0,-1,.5]),radii:[.007,.006,pr],contactIndex:3,
      contact:contact(type==='violin'?'top':'frog',pinkyEnd,type==='violin'?[-.018,0,s.stick]:[-.021,-s.halfWidth,-.006],pr)});
    return {digits,palmPos:[.012,.045,.035],palmScale:[.043,.033,.013],wrist:[.005,.088,.030],thenar:[.036,.053,.025]};
  }
  // Solve the static grip once. Only a rigid transform is needed per frame.
  const grips={violin:canonical('violin'),cello:canonical('cello')};
  // Planning X is reflected by RecitalGL. This parity makes a physical
  // RIGHT hand: the wrist stays on the player's side of the frog.
  function frame(origin,axis,upHint){
    const x=unit(axis),z=unit(sub(upHint,mul(x,dot(upHint,x)))),y=unit(cross(x,z));
    return {basis:[x,y,z],point:p=>add(origin,add(mul(x,p[0]),add(mul(y,p[1]),mul(z,p[2]))))};
  }
  function frog(type,origin,axis,upHint){
    const s=spec[type],f=frame(origin,axis,upHint);
    return {basis:f.basis,centre:f.point([(s.front+s.back)/2,0,-s.depth/2]),halfScale:[(s.front-s.back)/2,s.halfWidth,s.depth/2],
      ferrule:f.point([s.front-.002,0,-s.depth*.65]),ferruleScale:[.003,s.halfWidth+.0005,s.depth*.30]};
  }
  function create(type,origin,axis,upHint){
    const f=frame(origin,axis,upHint),g=grips[type];
    const digits=g.digits.map(d=>({...d,points:d.points.map(f.point),contact:{...d.contact,centre:f.point(d.contact.centre),target:f.point(d.contact.target)}}));
    return {type,basis:f.basis,origin:[...origin],palmPos:f.point(g.palmPos),palmScale:g.palmScale,wrist:f.point(g.wrist),thenar:f.point(g.thenar),
      thumb:digits[0],fingers:digits.slice(1)};
  }
  function oriented(R,shape,centre,scale,color,basis){
    if(R.oriented)R.oriented(shape,centre,scale,color,0,...basis);
    else {const [x,y0,z]=basis,sign=dot(cross(x,y0),z)<0?-1:1,y=mul(y0,sign),size=[scale[0],scale[1]*sign,scale[2]];R.piece(shape,centre,size,color,Math.atan2(y[2],z[2]),Math.asin(clamp(-x[2],-1,1)),Math.atan2(x[1],x[0]));}
  }
  function drawFrog(R,f,ebony,metal){
    oriented(R,'box',f.centre,f.halfScale.map(v=>v*2),ebony,f.basis);
    oriented(R,'box',f.ferrule,f.ferruleScale.map(v=>v*2),metal,f.basis);
  }
  const distForOverlap=(a,b)=>Math.hypot(...sub(b,a))*.12;
  function draw(R,H,skin,light){
    const round=(p,r,color)=>oriented(R,'rod',p,[r,r,r],color,H.basis);
    oriented(R,'palm',H.palmPos,H.palmScale,skin,H.basis);
    oriented(R,'joint',H.wrist,[.022,.020,.019],skin,H.basis);
    oriented(R,'joint',H.thenar,[.017,.022,.014],skin,H.basis);
    for(const d of [H.thumb,...H.fingers]){
      for(let j=0;j<3;j++){
        const a=d.points[j],b=d.points[j+1],axis=unit(sub(b,a)),overlap=distForOverlap(a,b);
        R.segment(sub(a,mul(axis,overlap)),j===2?b:add(b,mul(axis,overlap)),d.radii[j],j===2?light:skin,'bodyLimb');
        if(j>0){const r=d.radii[j];round(d.points[j],r,skin);}
      }
      const r=d.radii[2];round(d.points[3],r,light);
    }
  }
  return {create,draw,frog,drawFrog,source:()=>JSON.stringify({spec,grips})+frame.toString()};
})();

'use strict';
// Bow-local overhand grips. X: frog -> tip; Y: toward the wrist;
// Z: away from the hair. Cello pinky drapes; violin pinky balances on top.
window.BowHand = (() => {
  const add=(a,b)=>a.map((v,i)=>v+b[i]), sub=(a,b)=>a.map((v,i)=>v-b[i]), mul=(a,s)=>a.map(v=>v*s);
  const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0), cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const unit=a=>mul(a,1/(Math.hypot(...a)||1)), clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const spec={violin:{stick:.0029,halfWidth:.006,depth:.018,front:.022,back:-.026},cello:{stick:.006,halfWidth:.008,depth:.022,front:.025,back:-.030}};
  // Cello natural-hand proportions, shared by both instruments and hands.
  const dimensions={fingers:[[.043,.029,.021],[.046,.031,.023],[.045,.030,.022],[.036,.023,.017]],
    radii:[[.00845,.0078,.006825],[.0091,.00845,.00715],[.008775,.008125,.006825],[.007475,.006825,.00585]],
    thumb:[.046,.034,.0162],thumbRadii:[.009425,.008775,.007475],armScale:.92};
  function armLengths(type){return (type==='cello'?[.30,.28]:[.36,.34]).map(v=>v*dimensions.armScale);}
  function arm(type,shoulder,wrist,pole){
    const [upper,lower]=armLengths(type),d=sub(wrist,shoulder),distance=Math.hypot(...d),axis=unit(d);
    // A small shoulder reach preserves the musical contact at full bow reach.
    // The arm bones retain their shortened lengths instead of stretching.
    const reach=Math.max(0,distance-(upper+lower-.003)),S=add(shoulder,mul(axis,reach));
    const span=Math.min(distance,upper+lower-.003),along=(upper*upper-lower*lower+span*span)/(2*span),height=Math.sqrt(Math.max(0,upper*upper-along*along));
    let side=sub(pole,mul(axis,dot(pole,axis)));if(Math.hypot(...side)<1e-8)side=cross(axis,[0,0,1]);side=unit(side);
    return {shoulder:S,elbow:add(S,add(mul(axis,along),mul(side,height))),wrist:[...wrist],requestedWrist:[...wrist],lengths:[upper,lower],error:0,shoulderReach:reach};
  }
  function drawForearm(R,A,H,colors){
    const {suit,skin,shirt}=colors,Y=unit(sub(A.wrist,A.elbow));
    const radial=H.basis?H.basis[0]:[1,0,0];let X=sub(radial,mul(Y,dot(radial,Y)));if(Math.hypot(...X)<1e-6)X=cross([0,0,1],Y);X=unit(X);const Z=cross(X,Y);
    const cuff=sub(A.wrist,mul(Y,.050)),end=sub(A.wrist,mul(Y,.030));
    const part=(shape,a,b,width,depth,color)=>oriented(R,shape,mul(add(a,b),.5),[width,Math.hypot(...sub(b,a))*.5,depth],color,[X,Y,Z]);
    part('forearm',A.elbow,cuff,.035,.022,suit);
    part('bodyLimb',A.wrist,cuff,.022,.014,skin);
    part('bodyLimb',end,cuff,.025,.016,shirt);
  }
  function drawArm(R,A,H,colors){
    const basis=H.basis||[[1,0,0],[0,1,0],[0,0,1]];
    oriented(R,'joint',A.shoulder,[.050,.050,.050],colors.suit,basis);
    R.segment(A.shoulder,A.elbow,.047,colors.suit,'limb');
    oriented(R,'joint',A.elbow,[.046,.046,.046],colors.suit,basis);
    drawForearm(R,A,H,colors);
  }
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
    const thumbRadius=dimensions.thumbRadii[2],thumbEnd=[s.front+.004,0,-s.stick-thumbRadius];
    digits.push({name:'thumb',points:chain([.043,.057,.023],thumbEnd,dimensions.thumb,[1,0,-.2]),radii:dimensions.thumbRadii,skinBaseT:.95,contactIndex:3,
      contact:contact('underside',thumbEnd,[thumbEnd[0],0,-s.stick],thumbRadius)});
    // The index bears on its middle phalanx, rather than poking the stick.
    const r=dimensions.radii[0][2],angle=.25,indexSeat=[.057,-(s.stick+r)*Math.cos(angle),(s.stick+r)*Math.sin(angle)],indexRoot=[.048,.020,.040];
    const indexEnd=add(indexSeat,[0,0,-dimensions.fingers[0][2]]);
    digits.push({name:'index',points:[indexRoot,two(indexRoot,indexSeat,...dimensions.fingers[0].slice(0,2),[0,-1,.3]),indexSeat,indexEnd],radii:dimensions.radii[0],contactIndex:2,
      contact:contact('stick',indexSeat,[indexSeat[0],-s.stick*Math.cos(angle),s.stick*Math.sin(angle)],r)});
    for(const [name,a,z,lengths,radii] of [
      ['middle',s.front-.002,.041,dimensions.fingers[1],dimensions.radii[1]],
      ['ring',.001,.039,dimensions.fingers[2],dimensions.radii[2]],
    ]){
      const end=[a,-s.halfWidth-radii[2],-.011];
      digits.push({name,points:chain([a,.020,z],end,lengths,[0,-1,.2]),radii,contactIndex:3,
        contact:contact('frog',end,[a,-s.halfWidth,-.011],radii[2])});
    }
    const pr=dimensions.radii[3][2],pinkyEnd=type==='violin'?[-.018,0,s.stick+pr]:[-.021,-s.halfWidth-pr,-.006];
    digits.push({name:'pinky',points:chain([-.021,.034,.041],pinkyEnd,dimensions.fingers[3],[0,-1,.5]),radii:dimensions.radii[3],contactIndex:3,
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
    return {type,basis:f.basis,origin:[...origin],palmPos:f.point(g.palmPos),palmScale:g.palmScale,wrist:f.point(g.wrist),thenar:f.point(g.thenar),thenarCover:true,
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
  // Each grip only moves rigidly with the bow. Build its continuous local
  // skin once and let the renderer reuse the same static GPU buffer.
  const skinMeshes={};
  const localBasis=[[1,0,0],[0,1,0],[0,0,1]];
  function draw(R,H,skin,light){
    const round=(p,r,color)=>oriented(R,'rod',p,[r,r,r],color,H.basis);
    if(R.mesh&&window.ViolinFingerSkin){
      if(!window.HandSurface){
        oriented(R,'palm',H.palmPos,H.palmScale,skin,H.basis);
        oriented(R,'joint',H.wrist,[.022,.020,.019],skin,H.basis);
        oriented(R,'joint',H.thenar,[.017,.022,.014],skin,H.basis);
      }
      let mesh=skinMeshes[H.type];
      if(!mesh){
        const g=grips[H.type],state=window.ViolinFingerSkin.create(true,!!window.HandSurface);
        mesh=window.ViolinFingerSkin.update(state,{basis:localBasis,thumb:g.digits[0],fingers:g.digits.slice(1),palmPos:g.palmPos,palmScale:g.palmScale,wrist:g.wrist,thenarCover:true});
        skinMeshes[H.type]=mesh;
      }
      R.mesh(mesh,skin,{U:H.basis[0],V:H.basis[1],W:H.basis[2],O:H.origin});
    }else {
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
  }
  return {dimensions,armLengths,arm,drawArm,drawForearm,create,draw,frog,drawFrog,source:()=>JSON.stringify({spec,grips,dimensions})+[frame,armLengths,arm,drawArm,drawForearm].map(f=>f.toString()).join('\n')};
})();

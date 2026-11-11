'use strict';
/* One wrist-rooted FK skeleton. The nonlinear solve runs at trajectory knots;
 * playback only interpolates joint coordinates and pins the sounding fingers.
 * Instrument coordinates: u along neck, v across, w above top. */
window.ViolinHand = ({atLegacy,solveArm,FINGER_LENGTHS,lowerBound,smooth,vibrato}) => {
  const M=window.ViolinModel,G=M.GEOM;
  const add=(a,b)=>a.map((v,i)=>v+b[i]),sub=(a,b)=>a.map((v,i)=>v-b[i]);
  const mul=(a,s)=>a.map(v=>v*s),dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const unit=a=>mul(a,1/(Math.hypot(...a)||1)),clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
  const local=p=>{const d=sub(p,G.O0);return [dot(d,G.U),dot(d,G.V),dot(d,G.W)];};
  const world=p=>M.frame().point(...p);
  const direction=p=>add(add(mul(G.U,p[0]),mul(G.V,p[1])),mul(G.W,p[2]));
  const mv=(R,p)=>[0,1,2].map(i=>R[0][i]*p[0]+R[1][i]*p[1]+R[2][i]*p[2]);
  const inverse=(R,p)=>R.map(a=>dot(a,p));
  function rotation(a){
    const [x,y,z]=a,c=Math.cos(x),s=Math.sin(x),d=Math.cos(y),t=Math.sin(y),e=Math.cos(z),f=Math.sin(z);
    return [[e*d,f*d,-t],[e*t*s-f*c,f*t*s+e*c,d*s],[e*t*c+f*s,f*t*c-e*s,d*c]];
  }
  const ROOT=[[.027,.070,0],[.009,.074,0],[-.009,.072,0],[-.027,.066,0]];
  const THUMB_BASE=[.020,.020,-.020],THUMB_LEN=[.042,.032,.026],FR=[.006825,.005785,.004745],TR=[.009,.008,.007];
  const LIMIT=[[-.21,1.54],[-.85,.85],[.10,1.78]],DIP=.67;
  function fk(f,a){
    const m=[Math.sin(a[1]),Math.cos(a[1]),0],pts=[ROOT[f]],angles=[a[0],a[0]+a[2],a[0]+(1+DIP)*a[2]];
    for(let j=0;j<3;j++)pts.push(add(pts[j],mul([m[0]*Math.cos(angles[j]),m[1]*Math.cos(angles[j]),-Math.sin(angles[j])],FINGER_LENGTHS[f][j])));
    return pts;
  }
  // Unique flexed branch of the linked-curl chain. Analytic planar reduction
  // avoids Newton branch changes at note boundaries.
  function ik(f,seed,target){
    const p=sub(target,ROOT[f]),L=FINGER_LENGTHS[f],d=Math.hypot(...p),rho=Math.hypot(p[0],p[1]);
    const result=q=>[L[0]+L[1]*Math.cos(q)+L[2]*Math.cos(1.67*q),L[1]*Math.sin(q)+L[2]*Math.sin(1.67*q)];
    let lo=.10,hi=1.78;for(let j=0;j<30;j++){const q=(lo+hi)/2;if(Math.hypot(...result(q))>d)lo=q;else hi=q;}
    const pip=(lo+hi)/2,[A,B]=result(pip),mcp=Math.atan2(-p[2],rho)-Math.atan2(B,A),abd=Math.atan2(p[0],p[1]);
    return [mcp,abd,pip];
  }
  function thumbFK(a){
    const [az,el,roll,mcp,ip]=a,m=[Math.cos(el)*Math.cos(az),Math.cos(el)*Math.sin(az),Math.sin(el)];
    const p=unit(sub([1,0,0],mul(m,m[0]))),q=cross(m,p),bend=add(mul(p,Math.cos(roll)),mul(q,Math.sin(roll)));
    const pts=[THUMB_BASE];
    for(let j=0;j<3;j++){const angle=j===0?0:j===1?mcp:mcp+ip;pts.push(add(pts[j],mul(add(mul(m,Math.cos(angle)),mul(bend,Math.sin(angle))),THUMB_LEN[j])));}
    return pts;
  }
  function linear(A,b){
    const n=b.length,L=new Float64Array(n*n);
    for(let i=0;i<n;i++)for(let j=0;j<=i;j++){let s=A[i*n+j];for(let k=0;k<j;k++)s-=L[i*n+k]*L[j*n+k];if(i===j){if(s<=1e-30)return null;L[i*n+i]=Math.sqrt(s);}else L[i*n+j]=s/L[j*n+j];}
    const y=new Float64Array(n),x=new Float64Array(n);for(let i=0;i<n;i++){let s=b[i];for(let j=0;j<i;j++)s-=L[i*n+j]*y[j];y[i]=s/L[i*n+i];}
    for(let i=n-1;i>=0;i--){let s=y[i];for(let j=i+1;j<n;j++)s-=L[j*n+i]*x[j];x[i]=s/L[i*n+i];}return x;
  }
  const bounds=[[-1,1],[-1,1],[-.5,.5],[.40,1.20],[-.10,.40],[-.45,.08],[-.30,1.65],[-1.4,.65],[-1.2,.80],[-.05,1.20],[-.15,1.1],[-.75,.75],...Array.from({length:4},()=>LIMIT).flat()];
  function minimize(fn,initial,iterations=40,limits=bounds){
    let x=initial.map((v,i)=>clamp(v,...limits[i])),r=fn(x),cost=dot(r,r),lambda=.003;
    for(let it=0;it<iterations;it++){
      const n=x.length,m=r.length,J=new Float64Array(n*m),A=new Float64Array(n*n),g=new Float64Array(n);
      for(let j=0;j<n;j++){const y=x.slice(),h=n>3&&j<3?2e-6:2e-5;y[j]+=h;const rr=fn(y);for(let i=0;i<m;i++)J[i*n+j]=(rr[i]-r[i])/h;}
      for(let k=0;k<m;k++)for(let i=0;i<n;i++){const v=J[k*n+i];g[i]+=v*r[k];for(let j=0;j<=i;j++)A[i*n+j]+=v*J[k*n+j];}
      for(let i=0;i<n;i++)for(let j=0;j<i;j++)A[j*n+i]=A[i*n+j];let accepted=false;
      for(let retry=0;retry<9;retry++){
        const B=A.slice();for(let i=0;i<n;i++)B[i*n+i]+=lambda*(A[i*n+i]+1e-6);const dx=linear(B,g);if(!dx)break;
        const y=x.map((v,i)=>clamp(v-dx[i],...limits[i])),rr=fn(y),cc=dot(rr,rr);
        if(cc<cost){const gain=cost-cc;x=y;r=rr;cost=cc;lambda=Math.max(1e-8,lambda*.3);accepted=gain>1e-7;break;}lambda*=5;
      }if(!accepted)break;
    }return {x,cost};
  }
  function box(p,c,h){const d=p.map((v,i)=>Math.abs(v-c[i])-h[i]);return Math.hypot(...d.map(v=>Math.max(0,v)))+Math.min(0,Math.max(...d));}
  const slope=-.0125/.328,den=Math.hypot(1,slope);
  function neck(p,full=false){
    const du=p[0]-.263,dw=p[2]-(G.wFB(.263)-(full?.0115:.01295));
    return box([(du+dw*slope)/den,p[1],(dw-du*slope)/den],[0,0,0],[.065,.0115,full?.008:.00655]);
  }
  function board(p){
    const du=p[0]-.193,dw=p[2]-(G.wFB(.193)-.0032);
    return box([(du+dw*slope)/den,p[1],(dw-du*slope)/den],[0,0,0],[.135,.0225,.0032]);
  }
  const widths=Array.from({length:357},(_,i)=>M.bodyWidth(-.161+i*.001));
  function body(p){
    const u=clamp((p[0]+.161)*1000,0,356),i=Math.min(355,Math.floor(u)),w=widths[i]+(widths[i+1]-widths[i])*(u-i);
    // Signed normal-distance guide to arched cross-sections and ribs.
    // This approximation is an optimization guide, NOT the mesh acceptance
    // oracle; the independent triangle audit uses the actual rendered wood.
    const env=Math.sin(Math.PI*u/356)**.8,upper=p[2]>=-.0155,lower=p[2]<=-.0455;
    let sd=Math.abs(p[1])-w;
    if(upper||lower){const h=Math.max(.0001,(upper?.0155:.0145)*env),z=(p[2]+(upper?.0155:.0455))/h;const k=Math.hypot(p[1]/w,z);sd=k<1?(k-1)*Math.min(w,h):(k-1)*k/Math.max(1e-8,Math.hypot(p[1]/(w*w),z/h));}
    const axial=Math.max(-.161-p[0],p[0]-.195);
    return Math.hypot(Math.max(sd,0),Math.max(axial,0))+Math.min(0,Math.max(sd,axial));
  }
  function heel(p){const d=[(p[0]-.195)/.018,p[1]/.018,(p[2]+.018)/.024];return (Math.hypot(...d)-1)*.018;}
  const surface=p=>Math.min(neck(p,true),board(p),body(p),heel(p));
  function armOf(q,shoulder=[.205,1.452,-.03]){
    const wrist=world(q.x.slice(0,3)),axis=unit(sub(wrist,shoulder)),base=direction([0,-1,-.5]);
    const pole=add(add(mul(base,Math.cos(q.x[11])),mul(cross(axis,base),Math.sin(q.x[11]))),mul(axis,dot(axis,base)*(1-Math.cos(q.x[11]))));
    return solveArm(shoulder,wrist,.36,.34,pole);
  }
  function decode(x,targets){
    const R=rotation(x.slice(3,6)),w=x.slice(0,3),a=targets.map((t,f)=>t.contact?ik(f,null,inverse(R,sub(t.p,w))):x.slice(12+f*3,15+f*3));
    return {x,R,w,a,th:x.slice(6,11)};
  }
  const H2N=(q,p)=>add(q.w,mv(q.R,p));
  // Palm loft vertices, identical sections and superellipse as the renderer.
  const palmSamples=[];
  for(const [y,rx,rz] of [[-1,.4,.5],[-.6,.85,.9],[.3,1,1],[.8,.9,.92],[1,.5,.55]])for(let j=0;j<12;j++){
    const a=(j+.5)*2*Math.PI/12,se=x=>Math.sign(x)*Math.abs(x)**(2/2.6);
    palmSamples.push([.038*rx*se(Math.cos(a)),.035+.035*y,.013*rz*se(Math.sin(a))]);
  }
  const oldBouts=[[-.098,.088,.104,.0205],[-.008,.058,.0575,.020],[.072,.068,.083,.0195]];
  const armEllipsoids=oldBouts.flatMap(([u,hl,hw,ht])=>[false,true].map(back=>({u,w:back?-.007:0,a:hl*(back?1.01:1),b:hw*(back?1.02:1),c:ht})));
  function armSurface(p){
    let d=body(p);const bound=box(p,[-.024,0,-.0035],[.166,.107,.0255]);
    if(bound>.065)return Math.min(d,bound);
    for(const el of armEllipsoids){const x=(p[0]-el.u)/el.a,y=p[1]/el.b,z=(p[2]-el.w)/el.c,k=Math.hypot(x,y,z);
      const sd=k<1?(k-1)*Math.min(el.a,el.b,el.c):(k-1)*k/Math.max(1e-8,Math.hypot(x/el.a,y/el.b,z/el.c));d=Math.min(d,sd);
    }return d;
  }
  const hinge=(v,lo,hi,s)=>v<lo?(lo-v)/s:v>hi?(v-hi)/s:0;
  function fingerResidual(q,f,a,target,reference){
    const r=[],pts=fk(f,a).map(p=>H2N(q,p)),e=sub(pts[3],target.p);
    r.push(...mul(e,target.weight>0?1/(target.weight>.999?.000015:.003+(1-target.weight)*.02):0));
    r.push((a[0]-.55)/.7,a[1]/.65,(a[2]-1.05)/.5,...a.map((v,j)=>hinge(v,...LIMIT[j],.012)));
    if(reference)r.push(...sub(a,reference).map(v=>v/.35));
    if(target.contact)r.push(Math.max(0,Math.hypot(...sub(inverse(q.R,sub(target.p,q.w)),ROOT[f]))-(FINGER_LENGTHS[f].reduce((s,v)=>s+v,0)-.004))/.0002);
    r.push(Math.max(0,unit(sub(pts[3],pts[2]))[2]+.83)/.03);
    for(let j=0;j<3;j++)for(const s of [0,.25,.5,.75,1]){
      const p=add(pts[j],mul(sub(pts[j+1],pts[j]),s)),rad=FR[j]*(j===2&&s>.725?.75-.63*(s-.725)/.275:1);
      r.push(Math.max(0,rad+(j===2?.00025:.001)-surface(p))/.00025,Math.max(0,FR[j]+.001-neck(p))/.00025);
    }
    r.push(Math.max(0,.0039-surface(sub(pts[3],mul(unit(sub(pts[3],pts[2])),.0038))))/.00025);
    for(const j of [1,2])r.push(Math.max(0,G.wFB(pts[j][0])+.009-pts[j][2])/.0006);
    return r;
  }
  function residual(q,spec,reference){
    const r=[],collision=(p,rad,margin=.001)=>r.push(Math.max(0,rad+margin-surface(p))/.00025);
    for(let f=0;f<4;f++)r.push(...fingerResidual(q,f,q.a[f],spec.targets[f]));
    for(const goal of spec.goals||[]){
      const aa=ik(goal.f,null,inverse(q.R,sub(goal.p,q.w))),pp=fk(goal.f,aa).map(p=>H2N(q,p));
      r.push(...mul(sub(pp[3],goal.p),1/.0015),...aa.map((v,j)=>hinge(v,...LIMIT[j],.08)));
      r.push(Math.max(0,unit(sub(pp[3],pp[2]))[2]+.83)/.12);
      r.push(Math.max(0,Math.hypot(...sub(inverse(q.R,sub(goal.p,q.w)),ROOT[goal.f]))-(FINGER_LENGTHS[goal.f].reduce((s,v)=>s+v,0)-.004))/.002);
      for(let j=0;j<3;j++)for(const s of [0,.5,.75]){
        const p=add(pp[j],mul(sub(pp[j+1],pp[j]),s));
        r.push(Math.max(0,FR[j]*(j===2&&s>.725?.75-.63*(s-.725)/.275:1)+.0005-surface(p))/.0015);
        r.push(Math.max(0,FR[j]+.001-neck(p))/.0015);
      }
      r.push(Math.max(0,.0039-surface(sub(pp[3],mul(unit(sub(pp[3],pp[2])),.0038))))/.0015);
    }
    for(const p of palmSamples)collision(H2N(q,p),0,.002);
    const th=thumbFK(q.th).map(p=>H2N(q,p));
    collision(th[0],.010,.001);
    for(let j=0;j<3;j++)for(const s of [0,.25,.5,.75,1])collision(add(th[j],mul(sub(th[j+1],th[j]),s)),TR[j],.001);
    for(const p of th)r.push(Math.max(0,p[2]-(G.wFB(p[0])-.0125))/.0003);
    r.push(Math.max(0,.030-(th[2][0]-th[0][0]))/.01);
    // Metacarpal seat, not a free-standing thumb target polyline.
    const seat=smooth((th[2][0]-.183)/.015)*smooth((.343-th[2][0])/.015);
    r.push(seat*(neck(th[2])-.010)/.0003,(th[2][0]-(spec.u+.030))/.030);
    r.push((1-seat)*Math.max(0,th[2][1]+M.bodyWidth(clamp(th[2][0],-.161,.195))+.012)/.003);
    r.push(Math.max(0,.036-(th[3][0]-th[1][0]))/.0002);
    r.push(Math.max(0,.034-(th[3][0]-th[0][0]))/.0004);
    // Violin grip is one topological carriage family: the wrist stays on
    // the E-side of the mould, below the neck, rather than switching between
    // over/under-body solutions and interpolating through the wood.
    const axial=Math.max(-.161-q.w[0],q.w[0]-.195,0),rim=M.bodyWidth(clamp(q.w[0],-.161,.195));
    const outside=axial<.035?Math.max(.065,rim+Math.sqrt(.035*.035-axial*axial)):.065;
    r.push(Math.max(0,q.w[1]+outside)/.0003,Math.max(0,q.w[2]-(G.wFB(q.w[0])-.012))/.0003);
    const arm=armOf(q,spec.shoulder);
    for(let j=0;j<=80;j++){
      const t=j/80,p=local(add(arm.wrist,mul(sub(arm.elbow,arm.wrist),t)));
      r.push(Math.max(0,.025+.017*t+.004-armSurface(p))/.0005);
    }
    const desired=reference||spec.seed;
    r.push(...q.x.map((v,i)=>(v-desired[i])/(i<3?.025:i<6?.18:i<11?.45:i===11?.25:.35)));
    return r;
  }
  function track(P,t){
    const S=atLegacy(P,t),hd=S.debug.handDistMm,u=.328-hd/1000;
    const targets=S.debug.contacts.map((c,f)=>{
      const seq=P.fingerNotes[f+1],k=lowerBound(seq,t+1e-7,n=>n.t0)-1,prev=seq[k],next=seq[k+1];
      let weight=c.contact?1:Math.max(prev?smooth(1-(t-prev.t1)/.12):0,next?smooth(1-(next.t0-t)/.12):0);
      return {p:local(c.target),weight,contact:c.contact};
    });
    const h=smooth((.245-u)/.065),tilt=1.05-.25*h,R=rotation([tilt,0,0]);
    const centre=[u-.025,-.050-h*.007,G.wFB(u)+.025];
    const w=sub(centre,mv(R,[0,.070,0]));
    return {targets,u,shoulder:S.armL.shoulder,seed:[...w,tilt,0,0,1.25,-1.05,0,.45,.25,-.15,...Array.from({length:4},()=>[.35,0,1.05]).flat()]};
  }
  let solveCount=0;
  function solveKey(P,t,previous,goals=[]){
    const spec=track(P,t);spec.goals=goals;const seed=previous?previous.x.slice():spec.seed;
    // Carry the previous frame to this continuous semitone anchor.
    if(previous)seed[0]+=spec.u-previous.u;
    const fn=x=>residual(decode(x,spec.targets),spec,seed);let fit=minimize(fn,seed,30);
    if(fit.cost>100){
      for(const [tilt,roll,yaw,offset,height] of [[spec.u<.20?.55:.95,.25,-.30,.025,.045],[spec.u<.20?.55:.95,0,-.30,.025,.045],[.55,.20,-.36,.045,.030]]){
        const R=rotation([tilt,roll,yaw]);
        const centre=[spec.u-offset,-.040,G.wFB(spec.u)+height],w=sub(centre,mv(R,[0,.070,0]));
        const candidate=[...w,tilt,roll,yaw,1.25,-.80,0,.45,.25,-.15,...Array.from({length:4},()=>[.35,0,1.05]).flat()],other=minimize(fn,candidate,45);
        if(other.cost<fit.cost)fit=other;
      }
    }
    const q=decode(fit.x,spec.targets);
    q.cost=fit.cost;q.u=spec.u;q.t=t;q.spec=spec;solveCount++;return q;
  }
  function blend(a,b,u){
    const x=a.x.map((v,i)=>v+((i===6||i===8)?Math.atan2(Math.sin(b.x[i]-v),Math.cos(b.x[i]-v)):b.x[i]-v)*u),q={x,R:rotation(x.slice(3,6)),w:x.slice(0,3),a:a.a.map((aa,f)=>aa.map((v,j)=>v+(b.a[f][j]-v)*u)),th:x.slice(6,11)};return q;
  }
  function carriageAt(keys,t){
    const i=clamp(lowerBound(keys,t+1e-8,q=>q.t)-1,0,keys.length-1),a=keys[i],b=keys[Math.min(i+1,keys.length-1)];
    const u=b.t>a.t?smooth(clamp((t-a.t)/(b.t-a.t),0,1)):0,q=blend(a,b,u);q.key=i;return q;
  }
  function fitJointKey(P,t,q,previous){
    const spec=track(P,t);
    for(let f=0;f<4;f++){
      const target=spec.targets[f];
      if(target.contact)q.a[f]=ik(f,null,inverse(q.R,sub(target.p,q.w)));
      else {
        const reference=(previous?previous.a[f]:q.a[f]).slice();
        const fit=minimize(a=>fingerResidual(q,f,a,target,reference),reference,14,LIMIT);q.a[f]=fit.x;
      }
      for(let j=0;j<3;j++)q.x[12+f*3+j]=q.a[f][j];
    }
    q.u=spec.u;q.t=t;q.spec=spec;return q;
  }
  function planAngles(P,carriages){
    const times=new Set(carriages.map(q=>q.t));
    for(const n of P.notes)if(n.finger)for(const t of [n.t0,n.t1,n.t0-.12,n.t0-.06,n.t1+.12])times.add(clamp(t,0,P.song.duration));
    const keys=[];let previous=null,fallbacks=0;
    for(const t of [...times].sort((a,b)=>a-b)){if(previous&&t-previous.t<1e-5)continue;
      let q=fitJointKey(P,t,carriageAt(carriages,t),previous);
      // fitJointKey fits fingers only; the interpolated carriage can leave
      // thumb/palm/forearm in the wood. Fall back to a full frame solve
      // seeded from that carriage when the full safety audit fails.
      const S=atLegacy(P,t),v=safety(q,S.debug.contacts,S.armL.shoulder);
      if(v.score>2e-6){
        // Seed from the previous accepted key, not the interpolated
        // carriage: a cold seed lets the LM land in a different solution
        // branch, and neighbouring keys then whip the fingertips.
        const candidate=solveKey(P,t,previous||{x:q.x,u:q.u}),cv=safety(candidate,S.debug.contacts,S.armL.shoulder);
        if(cv.score<v.score){q=candidate;fallbacks++;}
      }
      keys.push(q);previous=q;
    }
    if(typeof process!=='undefined'&&process.env.NH_VERBOSE)console.error(P.song.id,'planAngles fallbacks',fallbacks,'/',keys.length);
    return keys;
  }
  // Offline validation of the interpolated joint track. Failed intervals gain
  // an optimized FK knot; there is no collision/translation repair at playback.
  function safety(q,contacts,shoulder){
    let score=0,reason='';const mark=(value,name)=>{if(value>score){score=value;reason=name;}};
    for(let f=0;f<4;f++){
      const pts=fk(f,q.a[f]).map(p=>H2N(q,p)),c=contacts[f];
      if(c.contact){mark(Math.hypot(...sub(pts[3],local(c.target)))-.00002,'pin');mark((.76+unit(sub(pts[3],pts[2]))[2])*.01,'attack');
        for(const j of [1,2])if(pts[j][0]>.06&&pts[j][0]<.335&&Math.abs(pts[j][1])<.0225)mark(G.wFB(pts[j][0])+.006-pts[j][2],'joint height');}
      for(let j=0;j<3;j++)mark(hinge(q.a[f][j],LIMIT[j][0]-.03,LIMIT[j][1]+.03,1)*.01,'ROM');
      for(let j=0;j<3;j++)for(const s of [0,.25,.5,.75,1]){
        const p=add(pts[j],mul(sub(pts[j+1],pts[j]),s)),radius=FR[j]*(j===2&&s>.725?.75-.63*(s-.725)/.275:1);
        mark(FR[j]+.00015-neck(p),'neck');mark(radius+.00005-surface(p),'finger wood');
      }
      mark(.00385-surface(sub(pts[3],mul(unit(sub(pts[3],pts[2])),.0038))),'pad');
    }
    for(const p of palmSamples)mark(.0002-surface(H2N(q,p)),'palm');
    const th=thumbFK(q.th).map(p=>H2N(q,p));
    mark(.01015-surface(th[0]),'CMC');
    mark(.031-(th[3][0]-th[1][0]),'thumb direction');
    mark(.0305-(th[3][0]-th[0][0]),'thumb direction');
    for(const p of th)mark(p[2]-(G.wFB(p[0])-.0118),'thumb back');
    if(th[2][0]>.198&&th[2][0]<.328)mark(neck(th[2])-.0117,'thumb seat');
    for(let j=0;j<3;j++)for(const s of [0,.25,.5,.75,1])mark(TR[j]+.00015-surface(add(th[j],mul(sub(th[j+1],th[j]),s))),'thumb wood');
    const arm=armOf(q,shoulder);for(let j=0;j<=80;j++){const s=j/80,p=local(add(arm.wrist,mul(sub(arm.elbow,arm.wrist),s)));mark(.025+.017*s+.0005-armSurface(p),'forearm');}
    return {score,reason};
  }
  function refine(P,keys){
    const times=new Set([0,P.song.duration-.01]);
    for(const n of P.notes){times.add(n.t0);times.add(n.t0+n.dur/2);times.add(Math.max(0,n.t0-.09));times.add(n.t1);}
    const regular=[];
    for(let t=0;t<P.song.duration;t+=1/60){times.add(t);regular.push(t);}
    const samples=[...times].sort((a,b)=>a-b).map(t=>{const S=atLegacy(P,t);return {t,contacts:S.debug.contacts,shoulder:S.armL.shoulder};});
    for(let pass=0;pass<8;pass++){
      const bad=new Map();
      for(const sample of samples){const q=jointsAt(P,sample.t,keys,sample.contacts),v=safety(q,sample.contacts,sample.shoulder);
        if(v.score>2e-6&&(!bad.has(q.key)||bad.get(q.key).score<v.score))bad.set(q.key,{...sample,...v,q});
      }
      let previous=null;
      // Velocity is measured on the regular rendering clock, as in the
      // continuity suite, not on microsecond-separated MIDI event samples.
      for(const t of regular){const sample=samples[lowerBound(samples,t,s=>s.t)],q=jointsAt(P,t,keys,sample.contacts);
        if(previous)for(let f=0;f<4;f++){
          const a=H2N(q,fk(f,q.a[f])[3]),b=H2N(previous.q,fk(f,previous.q.a[f])[3]),step=Math.hypot(...sub(a,b));
          const value=step-.047;if(value>0&&(!bad.has(q.key)||bad.get(q.key).score<value))bad.set(q.key,{...sample,q,score:value,reason:'continuity'});
        }previous={q};
      }
      const batch=[...bad.values()].sort((a,b)=>b.score-a.score);
      let globalSolves=0;
      if(typeof process!=='undefined'&&process.env.NH_VERBOSE)console.error(P.song.id,'refine',pass,'bad intervals',bad.size,'max',Math.max(0,...batch.map(v=>v.score)),batch.slice().sort((a,b)=>b.score-a.score)[0]?.reason);
      if(!batch.length)break;
      for(const b of batch){
        let q=fitJointKey(P,b.t,blend(b.q,b.q,0),null),v=safety(q,b.contacts,b.shoulder);
        if(v.score>2e-6&&globalSolves<180){globalSolves++;const i0=lowerBound(keys,b.t,k=>k.t),prevKey=i0>0?keys[i0-1]:null;const candidate=solveKey(P,b.t,prevKey||{x:q.x,u:q.u}),candidateSafety=safety(candidate,b.contacts,b.shoulder);if(candidateSafety.score<v.score){q=candidate;v=candidateSafety;}}
        if(v.score>2e-6&&v.score>=b.score-1e-6)continue;
        const i=lowerBound(keys,b.t,k=>k.t);if(keys[i]&&Math.abs(keys[i].t-b.t)<1e-6)keys[i]=q;else keys.splice(i,0,q);
      }
    }
  }
  function stamp(){
    const source=window.ViolinHand.toString()+[atLegacy,solveArm,lowerBound,smooth,M.frame].map(f=>f.toString()).join('\n')+JSON.stringify(FINGER_LENGTHS)+M.bodyWidth.toString()+M.bodyTop.toString()+JSON.stringify(G,(k,v)=>typeof v==='function'?v.toString():v);
    let h=2166136261;for(let i=0;i<source.length;i++)h=Math.imul(h^source.charCodeAt(i),16777619);return (h>>>0).toString(16);
  }
  function prepare(P){
    if(P.naturalTrack)return P.naturalTrack;
    const compiled=window.VIOLIN_HAND_FRAMES;
    if(compiled?.stamp===stamp()&&compiled.songs[P.song.id]?.signature===JSON.stringify(P.notes)){
      P.naturalTrack=compiled.songs[P.song.id].keys.map(q=>({...q,R:rotation(q.x.slice(3,6)),w:q.x.slice(0,3),th:q.x.slice(6,11)}));return P.naturalTrack;
    }
    const groups=[];
    for(const n of P.notes){if(!n.finger)continue;const last=groups[groups.length-1];
      if(last&&last.position===n.position&&last.string===n.string)last.notes.push(n);
      else groups.push({t:n.t0,position:n.position,string:n.string,notes:[n]});
    }
    const keys=[];let previous=null;
    for(let i=0;i<groups.length;i++){
      const group=groups[i],goals=[],seen=new Set();
      for(const n of group.notes){const key=n.finger+':'+n.string+':'+n.semi;if(seen.has(key))continue;seen.add(key);goals.push({f:n.finger-1,p:local(M.frame().contactPoint(n.string,n.distMm))});}
      const q=solveKey(P,group.t,previous,goals);
      const lead=previous?Math.min(.12,Math.max(.025,(group.t-previous.t)*.45)):0;
      if(previous&&group.t-lead>previous.t+1e-5){const hold={...previous,t:group.t-lead};keys.push(hold);}
      keys.push(q);previous=q;
      if(typeof process!=='undefined'&&process.env.NH_VERBOSE&&i%50===0)console.error(P.song.id,i,'/',groups.length,q.cost);
    }
    if(!keys.length){const q=solveKey(P,0,null);keys.push(q);}
    if(keys[0].t>0)keys.unshift({...keys[0],t:0});
    keys.push({...keys[keys.length-1],t:P.song.duration});
    const angleKeys=planAngles(P,keys);refine(P,angleKeys);
    P.naturalTrack=angleKeys;return angleKeys;
  }
  function jointsAt(P,t,keys,contacts){
    const q=carriageAt(keys,t);
    for(let f=0;f<4;f++)if(contacts[f].contact)q.a[f]=ik(f,q.a[f],inverse(q.R,sub(local(contacts[f].target),q.w)));
    return q;
  }
  function at(P,t,hd,contacts){
    const q=jointsAt(P,t,prepare(P),contacts),fingers=[],out=[];
    for(let f=0;f<4;f++){
      const c=contacts[f],points=fk(f,q.a[f]).map(p=>world(H2N(q,p))),error=Math.hypot(...sub(points[3],c.target));
      fingers.push({points,angles:q.a[f],error});out.push({...c,error});
    }
    const basis=q.R.map(direction),thumb=thumbFK(q.th).map(p=>world(H2N(q,p)));
    return {hand:{model:'natural',palmPos:world(H2N(q,[0,.035,0])),basis,pitch:0,yaw:0,roll:0,fingers,thumb,thumbAngles:q.th,frameKey:'fk6:'+q.key,carriage:q.x.slice(0,6),swivel:q.x[11]},wrist:world(q.w),contacts:out,q};
  }
  return {at,prepare,stamp,jointsAt,safety,solveKey,residual,track,decode,blend,armOf,ROOT,THUMB_BASE,THUMB_LEN,FR,TR,LIMIT,fk,ik,thumbFK,rotation,local,world,H2N,surface,neck,board,body,palmSamples,stats:()=>({solves:solveCount}),source:()=>window.ViolinHand.toString()};
};

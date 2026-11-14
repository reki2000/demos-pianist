'use strict';
// B anatomy shared with the piano: fixed MCP/CMC roots, fixed phalanges,
// linked PIP/DIP flexion, and opposite handed frames after renderer X reflection.
window.makeGuitarHands=()=>{
 const G=window.GuitarMotion,{u,w,n,NUT,LENGTHS}=G;
 const add=(a,b)=>a.map((v,i)=>v+b[i]),sub=(a,b)=>a.map((v,i)=>v-b[i]),mul=(a,s)=>a.map(v=>v*s),dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),norm=a=>mul(a,1/(Math.hypot(...a)||1));
 const clamp=(x,a,b)=>Math.max(a,Math.min(b,x)),smooth=x=>{x=clamp(x,0,1);return x*x*(3-2*x);};
 const ROOT=[[.027,.070,0],[.009,.074,0],[-.009,.072,0],[-.027,.066,0],[.020,.020,-.010]];
 const local=p=>{const d=sub(p,NUT);return [-dot(d,u),dot(d,w),dot(d,n)];},world=p=>add(NUT,add(mul(u,-p[0]),add(mul(w,p[1]),mul(n,p[2]))));
 function basis(x,hand){
  const c=Math.cos(x[3]),s=Math.sin(x[3]),sign=hand?1:-1;
  let X=u,Y=add(mul(w,sign*c),mul(n,-sign*s)),Z=add(mul(w,s),mul(n,c));
  const cy=Math.cos(x[4]),sy=Math.sin(x[4]),xx=add(mul(X,cy),mul(Y,-sy)),yy=add(mul(X,sy),mul(Y,cy));X=xx;Y=yy;
  const cr=Math.cos(x[5]),sr=Math.sin(x[5]);return [add(mul(X,cr),mul(Z,sr)),Y,add(mul(Z,cr),mul(X,-sr))];
 }
 const point=(H,p)=>add(H.wrist,H.basis.reduce((s,a,j)=>add(s,mul(a,p[j])),[0,0,0]));
 function frame(x,hand){const H={model:'guitar-B',wrist:world(x),basis:basis(x,hand)};H.palmPos=point(H,[0,.035,0]);return H;}
 const resultant=(L,q)=>[L[0]+L[1]*Math.cos(q)+L[2]*Math.cos(1.67*q),L[1]*Math.sin(q)+L[2]*Math.sin(1.67*q)];
 function finger(base,target,digit,hint,swivel=0){
  const L=LENGTHS[digit],v=sub(target,base),distance=Math.hypot(...v),X=norm(v);let Y=norm(sub(hint,mul(X,dot(hint,X))));
  if(swivel){const Z=[X[1]*Y[2]-X[2]*Y[1],X[2]*Y[0]-X[0]*Y[2],X[0]*Y[1]-X[1]*Y[0]];Y=add(mul(Y,Math.cos(swivel)),mul(Z,Math.sin(swivel)));}
  let lo=0,hi=2.18;for(let j=0;j<16;j++){const q=(lo+hi)/2;if(Math.hypot(...resultant(L,q))>distance)lo=q;else hi=q;}
  const q=(lo+hi)/2,[a,b]=resultant(L,q),angle=Math.atan2(b,a),points=[base];
  for(let j=0;j<3;j++){const t=angle-(j===0?0:j===1?q:1.67*q);points.push(add(points[j],add(mul(X,L[j]*Math.cos(t)),mul(Y,L[j]*Math.sin(t)))));}
  return {points,lengths:L,angles:[angle,q,.67*q],target,error:Math.hypot(...sub(points[3],target)),digit};
 }
 function barreFinger(root,target,span){
  const L=LENGTHS[1],points=[root],X=mul(w,-1),reach=span+.004;let error=0;
  if(reach<=L[2]+.001){
   const goal=sub(target,mul(X,L[2])),delta=sub(goal,root),distance=Math.hypot(...delta),D=norm(delta),d=clamp(distance,Math.abs(L[0]-L[1])+.000001,L[0]+L[1]-.000001),end=add(root,mul(D,d));
   const Y=norm(sub(n,mul(D,dot(n,D)))),a=(L[0]**2-L[1]**2+d*d)/(2*d),h=Math.sqrt(Math.max(0,L[0]**2-a*a));points.push(add(root,add(mul(D,a),mul(Y,h))),end,add(end,mul(X,L[2])));
  }else if(reach<=L[1]+L[2]){
   const goal=sub(target,mul(X,L[1]+L[2])),first=add(root,mul(norm(sub(goal,root)),L[0]));points.push(first,add(first,mul(X,L[1])),add(first,mul(X,L[1]+L[2])));
  }else for(let j=0;j<3;j++)points.push(add(points[j],mul(X,L[j])));
  error=Math.hypot(...sub(points[3],target));return {points,error};
 }
 function thumbTarget(x,H){
  const root=local(point(H,ROOT[4])),d=x[0]-.020,a=G.neckSection(d),back=Math.min(-.003,root[2]-a.centre),angle=Math.atan2(back/a.depth,root[1]/a.width),c=Math.cos(angle),s=Math.sin(angle),normal=norm([0,c/a.width,s/a.depth]),seat=[d,a.width*c+.007*normal[1],a.centre+a.depth*s+.007*normal[2]],h=smooth((x[0]-.27)/.075);
  return world([seat[0],seat[1]*(1-h)+(.045+.035*Math.sin(Math.PI*h))*h,seat[2]*(1-h)+.018*h]);
 }

 function buildHand(x,hand,targets){
  const H=frame(x,hand);x=x.slice();H.fingers=[];
  const input=targets,resolve=()=>input.map((T,f)=>{
   if(!T)return T;const rest=point(H,[ROOT[f]?.[0]||0,.105,hand?-.024:-.036]);let target=T.target;
   if(T.to){const from=T.from?add(mul(T.from,1-(T.fromRelease||0)),mul(rest,T.fromRelease||0)):rest;target=add(add(mul(from,1-T.phase),mul(T.to,T.phase)),mul(n,T.lift));}
   else if(T.releaseFrom)target=add(mul(T.releaseFrom,1-T.release),mul(rest,T.release));
   target=target||rest;
   const released=T.fromRelease||0,relax=!hand&&!T.contact?(T.to?released*(1-T.phase)+(1-released)*Math.sin(Math.PI*T.phase):T.releaseFrom?T.release:1):0;
   if(!hand&&f<4&&!T.contact){const root=point(H,ROOT[f]),reach=LENGTHS[f+1].reduce((a,b)=>a+b,0)-.010,envelope=relax,far=smooth((Math.hypot(...sub(target,root))-reach)/.030)*(1-(T.barreWeight||0))*envelope;target=add(mul(target,1-far),mul(rest,far));}
   target=add(mul(target,1-relax),mul(rest,relax));return {...T,target,relax};
  });targets=resolve();
  // Preserve a barre through carriage interpolation by solving its MCP
  // position analytically. The whole hand translates; no bone is stretched.
  const B=targets[0];if(!hand&&B?.contact&&B.barre&&B.barreShapes?.length&&B.target){
   const root=point(H,ROOT[0]),L=LENGTHS[1];let shift=[0,0,0];
   for(const pin of B.barreShapes){const span=pin.span+.004;let desired=root;
    if(span>L[1]+L[2])desired=add(B.target,mul(w,L[0]+L[1]+L[2]));
    else if(span>L[2]+.001){const joint=add(B.target,mul(w,L[1]+L[2]));desired=add(joint,mul(norm(sub(root,joint)),L[0]));}
    else {const joint=add(B.target,mul(w,L[2])),v=sub(root,joint),d=Math.hypot(...v);desired=add(joint,mul(norm(v),clamp(d,Math.abs(L[0]-L[1])+.00001,L[0]+L[1]-.00001)));}
    shift=add(shift,mul(sub(desired,root),pin.weight));
   }H.wrist=add(H.wrist,shift);H.palmPos=add(H.palmPos,shift);x.splice(0,3,...local(H.wrist));
  }
  targets=resolve();
  for(let f=0;f<4;f++){
   const root=point(H,ROOT[f]),target=targets[f]?.target||point(H,[ROOT[f][0],.105,hand?-.024:-.036]);
   const F={...targets[f],...finger(root,target,f+1,hand?w:add(mul(n,1-(targets[f]?.relax||0)),mul(H.basis[2],targets[f]?.relax||0)),hand?0:x[6+f]||0)};
   if(!hand&&f===0&&targets[f]?.barreWeight>0){
    const shapes=targets[f].barreShapes.map(q=>({...q,...barreFinger(root,target,q.span)})),weight=targets[f].barreWeight,pts=[root];
    for(let j=0;j<3;j++){let dir=mul(norm(sub(F.points[j+1],F.points[j])),1-weight);for(const q of shapes)dir=add(dir,mul(norm(sub(q.points[j+1],q.points[j])),q.weight));pts.push(add(pts[j],mul(norm(dir),LENGTHS[1][j])));}
    F.points=pts;F.error=Math.hypot(...sub(pts[3],target));
   }H.fingers.push(F);
  }
  const root=point(H,ROOT[4]),target=hand?targets[4].target:thumbTarget(x,H),F=finger(root,target,0,hand?u:mul(n,-1));
  H.thumb=F.points;H.thumbInfo=F;H.carriage=x;return H;
 }
 function pressPoint(nt){
  if(!nt.barre)return G.fretPoint(nt.string,nt.fret,.006,.0042);
  if(nt.barreGroup)return nt.barreGroup.target;
  const ss=(nt.barreGroup?.notes||nt.ev.notes).filter(q=>q.lh===nt.lh&&q.fret===nt.fret).map(q=>q.string);
  return add(G.fretPoint(Math.max(...ss),nt.fret,.002,.0042),mul(w,-.004));
 }
 function barreSpan(nt){if(nt.barreGroup)return nt.barreGroup.span;const ns=(nt.barreGroup?.notes||nt.ev.notes).filter(q=>q.lh===nt.lh&&q.fret===nt.fret),ss=ns.map(q=>q.string);return Math.hypot(...sub(G.fretPoint(Math.max(...ss),nt.fret),G.fretPoint(Math.min(...ss),nt.fret)));}
 function travel(A,B){
  const gap=A?Math.max(.000001,B.t-A.t):1,end=B.t-Math.min(.004,gap*.25);let start=A?Math.max(A.t+.004,Math.max(B.t-.12,Math.min((A.barreGroup?.end??A.end)-.02,B.t-.05))):B.t-.18;
  if(start>end-Math.min(.012,gap*.5))start=end-Math.min(.012,gap*.5);return {start,end};
 }
 function leftTargets(P,t,S){return [1,2,3,4].map((digit,i)=>{
  const list=P.lhByFinger[digit],k=G.lowerBound(list,t+1e-9)-1,A=list[k],B=list[k+1],T={digit,contact:false,barre:0};let source=null,weight=0,shapes=[];
  let phase=0,start=0,end=0;if(B){({start,end}=travel(A,B));phase=smooth((t-start)/(end-start));}
  const repeat=A&&B&&A.string===B.string&&A.fret===B.fret&&B.t-(A.barreGroup?.end??A.end)<=.025&&(!P.grips||!!A.barre===!!B.barre&&Math.abs((A.barreGroup?.span||0)-(B.barreGroup?.span||0))<1e-7), sameBarre=(A?.barreGroup&&A.barreGroup===B?.barreGroup)||repeat;
  if(B&&t>=start&&!sameBarre){
   T.from=A?pressPoint(A):undefined;T.fromRelease=A?smooth((start-(A.barreGroup?.end??A.end))/.12):1;T.to=pressPoint(B);T.phase=phase;T.lift=Math.sin(Math.PI*phase)*.006;
   const ab=A?.barre?1-(T.fromRelease||0):0,bb=B.barre?1:0,wa=ab*(1-phase),wb=bb*Math.min(phase,smooth((t-B.t+.050)/.046));if(wa>0)shapes.push({span:barreSpan(A),weight:wa});if(wb>0)shapes.push({span:barreSpan(B),weight:wb});weight=wa+wb;source=B.barre?B:A?.barre?A:null;
  }else if(A&&(repeat||t<=(A.barreGroup?.end??A.end)+1e-9)){T.target=pressPoint(A);T.contact=true;T.barre=A.barre;source=A;weight=A.barre?1:0;if(weight)shapes.push({span:barreSpan(A),weight});}
  else if(A){T.releaseFrom=pressPoint(A);T.release=smooth((t-(A.barreGroup?.end??A.end))/.12);source=A;weight=A.barre?1-T.release:0;if(weight)shapes.push({span:barreSpan(A),weight});}
  if(i===0&&source?.barre){T.pressPoints=source.barreGroup?.points||source.ev.notes.filter(q=>q.lh===digit&&q.fret===source.fret).map(q=>G.fretPoint(q.string,q.fret,.002,.0042));T.barreSpan=barreSpan(source);T.barreWeight=weight;T.barreShapes=shapes;}
  return T;
 });}

 function rightTargets(S){
  const names=['i','m','a'],targets=names.map((k,i)=>({...S.rhFingers[k],target:S.rhFingers[k].target,digit:i+1}));
  targets.push(null);const p=S.rhFingers.p;targets.push({...p,target:add(p.target,mul(u,.025)),digit:0});return targets;
 }
 function segmentDistance(p,a,b){const d=sub(b,a),t=clamp(dot(sub(p,a),d)/(dot(d,d)||1),0,1);return Math.hypot(...sub(p,add(a,mul(d,t))));}
 function barrePoints(P,t,f){
  const list=P.lhByFinger[f+1],i=G.lowerBound(list,t+1e-8)-1,A=list[i];if(!A||!A.barre)return [];
  if(A.barreGroup)return A.barreGroup.points;
  return A.ev.notes.filter(nt=>nt.lh===f+1&&nt.fret===A.fret).map(nt=>G.fretPoint(nt.string,nt.fret,.002,.0042));
 }
 // Exact closest distance between two finite bone segments (including parallel cases).
 function segmentGap(a,b,c,d){
  const v=sub(b,a),w=sub(d,c),q=sub(a,c),A=dot(v,v),B=dot(v,w),C=dot(w,w),D=dot(v,q),E=dot(w,q),den=A*C-B*B;
  let s=den>1e-16?clamp((B*E-C*D)/den,0,1):0,t=(B*s+E)/C;
  if(t<0){t=0;s=clamp(-D/A,0,1);}else if(t>1){t=1;s=clamp((B-D)/A,0,1);}
  return Math.hypot(...sub(add(a,mul(v,s)),add(c,mul(w,t))));
 }
 function fingerClearance(H){let gap=Infinity;for(let f=0;f<4;f++)for(let g=f+1;g<4;g++)for(let j=0;j<3;j++)for(let k=0;k<3;k++)gap=Math.min(gap,segmentGap(H.fingers[f].points[j],H.fingers[f].points[j+1],H.fingers[g].points[k],H.fingers[g].points[k+1]));return gap;}
 function box(p,c,b){const q=p.map((v,i)=>Math.abs(v-c[i])-b[i]);return Math.hypot(...q.map(v=>Math.max(0,v)))+Math.min(0,Math.max(...q));}
 function wood(p){
  const d=local(p),width=G.fretboardHalfWidth(d[0]);
  let v=Math.min(box(d,[G.BOARD_END/2,0,-.003],[G.BOARD_END/2,width,.003]),G.neckDistance(...d));
  const B=G.BODY_SPEC;if(d[0]>B.start-.01&&d[0]<B.end+.01){const breadth=G.bodyWidth(clamp(d[0],B.start,B.end));v=Math.min(v,box(d,[(B.start+B.end)/2,0,(B.top+B.back)/2],[(B.end-B.start)/2,breadth,(B.top-B.back)/2]));}return v;
 }
 const palmChecks=[[0,.035,-.013],[0,.035,.013]];
 for(let j=0;j<8;j++){const a=(j+.5)*Math.PI*2/8;palmChecks.push([.021*Math.cos(a),-.009,.014*Math.sin(a)]);}palmChecks.push([0,-.009,0]);
 for(let r=1;r<8;r++)for(let j=0;j<12;j++){const a=j*Math.PI*2/12,b=r*Math.PI/8,se=x=>Math.sign(x)*Math.abs(x)**(2/2.6);palmChecks.push([.038*Math.sin(b)*se(Math.cos(a)),.035+.035*Math.sin(b)*se(Math.sin(a)),.013*Math.cos(b)]);}
 function constraints(x,hand,targets,barres=[],reference=x){
  const H=buildHand(x,hand,targets),r=[],collision=(p,rad,scale=.001)=>r.push(Math.max(0,rad-wood(p))/scale);
  for(let f=0;f<4;f++){
   const F=H.fingers[f],T=targets[f],active=!!T?.contact;
   if(active)r.push(...sub(F.points[3],F.target).map(v=>v/.00003));else r.push(F.error/.020);
   if(active){
    const first=norm(sub(F.points[1],F.points[0]));r.push(Math.max(0,(T.barre?-.15:.08)-dot(first,H.basis[1]))/.05);
    for(const p of barres[f]||[])r.push(Math.max(0,Math.min(...F.points.slice(0,3).map((a,j)=>segmentDistance(p,a,F.points[j+1])))-.0015)/.0004);
   }
   for(let j=0;j<3;j++)for(const t of [0,.5,1])collision(add(F.points[j],mul(sub(F.points[j+1],F.points[j]),t)),j===2?.002:.004,.0006);
  }
  if(!hand)for(let f=0;f<4;f++)for(let g=f+1;g<4;g++)for(let j=0;j<3;j++)for(let k=0;k<3;k++)r.push(Math.max(0,.006-segmentGap(H.fingers[f].points[j],H.fingers[f].points[j+1],H.fingers[g].points[k],H.fingers[g].points[k+1]))/.0003);
  for(const p of palmChecks)collision(point(H,p),.0005,.0007);
  const thumb=H.thumb;for(let j=0;j<3;j++)for(const t of (j===0?[.65,.8,1]:[0,.5,1])){const radii=[.012,.0085,.0065],radius=j<2?radii[j]+(radii[j+1]-radii[j])*t:radii[2];collision(add(thumb[j],mul(sub(thumb[j+1],thumb[j]),t)),radius,.0008);}
  if(!hand)r.push(H.thumbInfo.error/.002);
  else r.push(H.thumbInfo.error/.0001);
  r.push(...x.map((v,i)=>(v-(reference[i]||0))/(i<3?.035:.45)));
  return r;
 }
 const limits=[[0,.50],[.025,.20],[-.10,.18],[.20,1.50],[-.65,.65],[-1.40,.55],...Array.from({length:4},()=>[-1.25,1.25])],rightLimits=[[.48,.60],[-.10,.02],[.045,.15],[-.30,.80],[-.55,.55],[-.5,.5]];
 function linear(A,b){
  const n=b.length,m=A.map((r,i)=>[...r,b[i]]);for(let j=0;j<n;j++){let k=j;for(let i=j+1;i<n;i++)if(Math.abs(m[i][j])>Math.abs(m[k][j]))k=i;[m[k],m[j]]=[m[j],m[k]];if(Math.abs(m[j][j])<1e-18)return null;const d=m[j][j];for(let c=j;c<=n;c++)m[j][c]/=d;for(let i=0;i<n;i++)if(i!==j){const a=m[i][j];for(let c=j;c<=n;c++)m[i][c]-=a*m[j][c];}}return m.map(r=>r[n]);
 }
 function minimize(fn,initial,iterations=12,bounds=limits){
  let x=bounds.map((b,i)=>clamp(initial[i]||0,...b)),r=fn(x),cost=dot(r,r),lambda=.03;
  for(let it=0;it<iterations;it++){
   const J=x.map((v,j)=>{const y=x.slice(),h=j<3?2e-6:2e-5;y[j]+=h;const s=fn(y);return s.map((v,i)=>(v-r[i])/h);}),A=x.map((_,i)=>x.map((_,j)=>dot(J[i],J[j]))),b=J.map(v=>dot(v,r));let accepted=false;
   for(let retry=0;retry<7;retry++){const M=A.map((row,i)=>row.map((v,j)=>v+(i===j?lambda*(A[i][i]+1e-6):0))),d=linear(M,b);if(!d)break;const y=x.map((v,i)=>clamp(v-d[i],...bounds[i])),s=fn(y),c=dot(s,s);if(c<cost){const gain=cost-c;x=y;r=s;cost=c;lambda=Math.max(1e-7,lambda*.3);accepted=gain>1e-8;break;}lambda*=5;}if(!accepted)break;
  }return {x,cost};
 }
 let fits=0;
 function fitLeft(P,t,seed){
  const S=G.poseLegacy(P,t,false),T=leftTargets(P,t,S),barres=T.map((f,i)=>f.contact&&f.barre?barrePoints(P,t,i):[]),reference=[S.anchorD+.02,.080,-.035,.95,0,0];
  const fn=x=>constraints(x,0,T,barres,reference);let best=minimize(fn,seed||reference,18);
  if(T[0].contact&&T[0].barre){
   const target=local(T[0].target),L=LENGTHS[1],span=T[0].barreSpan+.004;let rw,rh;
   if(span>L[1]+L[2]){rw=target[1]+L.reduce((a,b)=>a+b,0);rh=target[2];}
   else if(span>L[2]+.001){rw=target[1]+L[1]+L[2]+.010;rh=target[2]+Math.sqrt(L[0]**2-.010**2);}
   else {rw=target[1]+.045;rh=target[2]+.030;}
   for(const a of [.35,.70,1.1])for(const roll of [0,-.50,-1.10]){
    const q=[0,0,0,a,0,roll],B=basis(q,0),root=world([target[0],rw,rh]),wrist=sub(root,add(mul(B[0],.027),mul(B[1],.070))),p=local(wrist);q.splice(0,3,...p);
    const other=minimize(fn,q,35);if(other.cost<best.cost)best=other;
   }
  }
  if(best.cost>25)for(const [v,z,a] of [[.070,-.050,1.2],[.095,-.025,.9],[.080,.040,.8]]){const q=reference.slice();q[1]=v;q[2]=z;q[3]=a;const next=minimize(fn,q,24);if(next.cost<best.cost)best=next;}
  fits++;return {t,x:buildHand(best.x,0,T).carriage,cost:best.cost};
 }
 function boundaries(P){
  const ts=new Set(P.events.flatMap(e=>e.notes.flatMap(n=>[n.t,n.end])));
  for(const list of Object.values(P.lhByFinger))for(let i=1;i<list.length;i++){const A=list[i-1],B=list[i],{start,end}=travel(A,B);ts.add(start);ts.add(end);}
  return [...ts].filter(t=>t>1e-6&&t<P.song.duration-1e-6).sort((a,b)=>a-b);
 }
 function normalizeBoundaries(P,keys){
  for(const t of boundaries(P)){const before=leftTargets(P,t-.000001,G.poseLegacy(P,t-.000001,false)),after=leftTargets(P,t+.000001,G.poseLegacy(P,t+.000001,false));const was=before[0].contact&&before[0].barre,now=after[0].contact&&after[0].barre;if(!!was===!!now)continue;
   let x=carriage(keys,t);const adjacent=was?G.lowerBound(keys,t-1e-7)-1:G.lowerBound(keys,t+1e-7),near=keys[adjacent];
   if(near&&Math.abs(near.t-t)<.001)x=near.x;
   const H=buildHand(x,0,was?before:after),key={t,x:H.carriage},i=keys.findIndex(k=>Math.abs(k.t-t)<1e-7);
   if(i>=0){keys[i]=key;for(let j=keys.length-1;j>i;j--)if(Math.abs(keys[j].t-t)<1e-7)keys.splice(j,1);}else keys.push(key);keys.sort((a,b)=>a.t-b.t);
  }return keys;
 }
 function stamp(){const text=window.makeGuitarHands.toString()+G.poseLegacy.toString()+G.plan.toString()+(G.gripSource?.()||'')+G.stringPoint.toString()+G.bodyWidth.toString()+JSON.stringify([G.BODY_SPEC,G.BODY_OUTLINE])+G.neckSection.toString()+G.neckDistance.toString()+G.fretboardHalfWidth.toString()+G.fretPoint.toString()+G.pluckPoint.toString()+JSON.stringify([G.SCALE,G.NUT,G.u,G.w,G.n,G.BOARD_END,G.NECK_END,G.FRETS,LENGTHS]);let h=2166136261;for(let i=0;i<text.length;i++)h=Math.imul(h^text.charCodeAt(i),16777619);return (h>>>0).toString(16);}
 const validated=new WeakMap();let dataObject,validStamp;
 const signature=P=>JSON.stringify([P.song.notes,P.song.fingering.assignments,...(P.song.leftHandPhrases?[P.song.leftHandPhrases]:[])]);
 function available(P){const D=window.GUITAR_HAND_FRAMES,cached=validated.get(P);if(cached?.data===D)return cached.ok;if(D!==dataObject){dataObject=D;validStamp=!!D&&D.stamp===stamp();}const ok=!!(validStamp&&D.songs[P.song.id]?.signature===signature(P));validated.set(P,{data:D,ok});return ok;}
 function carriage(keys,t){let i=G.lowerBound(keys,t+1e-8)-1;i=clamp(i,0,keys.length-1);const a=keys[i],b=keys[Math.min(i+1,keys.length-1)],s=b.t>a.t?smooth((t-a.t)/(b.t-a.t)):0;return a.x.map((v,k)=>v+(b.x[k]-v)*s);}
 function arm(S,W,hint){const v=sub(W,S),distance=Math.hypot(...v),dir=norm(v),d=clamp(distance,.015,.615-1e-6),a=(.315**2-.30**2+d*d)/(2*d),bend=norm(sub(hint,mul(dir,dot(hint,dir)))),E=add(add(S,mul(dir,a)),mul(bend,Math.sqrt(Math.max(0,.315**2-a*a))));return {shoulder:S,elbow:E,wrist:W,lengths:[.315,.30],error:Math.abs(distance-d)};}
 function pose(P,t,S){
  const D=window.GUITAR_HAND_FRAMES,H=buildHand(carriage(D.songs[P.song.id].keys,t),0,leftTargets(P,t,S)),R=buildHand(D.right,1,rightTargets(S));
  for(let f=0;f<4;f++){H.fingers[f].requestedContact=H.fingers[f].contact;H.fingers[f].contact=H.fingers[f].contact&&H.fingers[f].error<.002;}
  S.lhFingers=H.fingers;S.lhThumb={...H.thumbInfo,digit:0};S.rhFingers={p:{...S.rhFingers.p,...R.thumbInfo,points:R.thumb},i:R.fingers[0],m:R.fingers[1],a:R.fingers[2],c:R.fingers[3]};
  S.palm=H.palmPos;S.hands=[H,R];S.wristL=H.wrist;S.wristR=R.wrist;S.arms=[arm(S.arms[0].shoulder,H.wrist,[1,-.5,.25]),arm(S.arms[1].shoulder,R.wrist,[-1,-.6,-.1])];return S;
 }
 return {segmentGap,fingerClearance,boundaries,normalizeBoundaries,barreFinger, ROOT,LENGTHS,local,world,basis,frame,point,finger,buildHand,leftTargets,rightTargets,barrePoints,segmentDistance,wood,constraints,minimize,limits,rightLimits,fitLeft,stamp,signature,available,carriage,pose,stats:()=>({fits})};
};
window.GuitarHands=window.makeGuitarHands();

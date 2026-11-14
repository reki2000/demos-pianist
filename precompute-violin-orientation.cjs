'use strict';
// Offline migration of the former mirrored left hand. No musical data,
// phalanx lengths or fingertip targets change; only cached elbow swivels fit.
const fs=require('node:fs'),vm=require('node:vm');global.window=globalThis;
for(const n of ['bow-hand','violin-fingering','violin-songs','hand-surface','violin-skin','violin-model','violin-hand','violin-hand-frames','violin-motion'])vm.runInThisContext(fs.readFileSync(`dist/instruments/${n}.js`,'utf8'));
const N=ViolinMotion.NH,dist=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
const sourceIndex=process.argv.indexOf('--from');
if(sourceIndex>=0){vm.runInThisContext(fs.readFileSync(process.argv[sourceIndex+1],'utf8'));for(const song of Object.values(VIOLIN_HAND_FRAMES.songs))for(const key of song.keys){key.x[1]=-key.x[1];key.x[11]=-key.x[11];}}
 let bound,matrix;const vertices=[];function upload(data){const seen=new Set();bound.points=[];for(let j=0;j<data.length;j+=6){const p=Array.from(data.slice(j,j+3)),key=p.map(v=>Math.round(v*1e8)).join(':');if(!seen.has(key)){seen.add(key);bound.points.push(p);}}}const gl={VERTEX_SHADER:1,FRAGMENT_SHADER:2,COMPILE_STATUS:3,LINK_STATUS:4,ARRAY_BUFFER:5,STATIC_DRAW:6,DYNAMIC_DRAW:9,FLOAT:7,TRIANGLES:8,
 createShader:()=>({}),shaderSource(){},compileShader(){},getShaderParameter:()=>true,createProgram:()=>({}),attachShader(){},linkProgram(){},getProgramParameter:()=>true,useProgram(){},getAttribLocation:(_,n)=>n==='aP'?0:1,getUniformLocation:(_,n)=>n,createBuffer:()=>({}),bindBuffer:(_,b)=>{bound=b},bufferData:(_,data)=>upload(data),bufferSubData:(_,__,data)=>upload(data),enableVertexAttribArray(){},vertexAttribPointer(){},uniformMatrix4fv:(n,_,m)=>{if(n==='uM')matrix=Array.from(m)},uniformMatrix3fv(){},uniform3fv(){},uniform1f(){},drawArrays:(_,__,count)=>{for(const a of bound.points){vertices.push([0,1,2].map(i=>matrix[i]*a[0]+matrix[4+i]*a[1]+matrix[8+i]*a[2]+matrix[12+i]));}}};
 vm.runInThisContext(fs.readFileSync('dist/instruments/violin-gl.js','utf8'));
 const R=RecitalGL.create({getContext:()=>gl}),grid=new Map(),size=.012,mesh=ViolinModel.BODY_MESH;
 for(let j=0;j<mesh.length;j+=18){const [a,b,c]=[0,6,12].map(k=>Array.from(mesh.slice(j+k,j+k+3)));const den=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);if(Math.abs(den)<1e-12)continue;
  for(let x=Math.floor(Math.min(a[0],b[0],c[0])/size);x<=Math.floor(Math.max(a[0],b[0],c[0])/size);x++)for(let y=Math.floor(Math.min(a[1],b[1],c[1])/size);y<=Math.floor(Math.max(a[1],b[1],c[1])/size);y++){const key=x+':'+y;if(!grid.has(key))grid.set(key,[]);grid.get(key).push({a,b,c,den});}
 }
 function bodyDepth(p){let lo=Infinity,hi=-Infinity;for(const {a,b,c,den} of grid.get(Math.floor(p[0]/size)+':'+Math.floor(p[1]/size))||[]){const u=((b[1]-c[1])*(p[0]-c[0])+(c[0]-b[0])*(p[1]-c[1]))/den,v=((c[1]-a[1])*(p[0]-c[0])+(a[0]-c[0])*(p[1]-c[1]))/den;if(u<0||v<0||u+v>1)continue;const w=u*a[2]+v*b[2]+(1-u-v)*c[2];lo=Math.min(lo,w);hi=Math.max(hi,w);}return Math.max(0,Math.min(p[2]-lo,hi-p[2]));}

// Fit with a 0.5 mm skin tolerance; final
// rendered-vertex acceptance remains stricter than 1 mm.
function measure(q,shoulder){
 const arm=N.armOf(q,shoulder),fl=dist(arm.elbow,arm.wrist),cuff=arm.wrist.map((v,i)=>v+(arm.elbow[i]-v)*.05/fl);
 vertices.length=0;R.segment(arm.elbow,cuff,.042,[0,0,0],'forearm');R.segment(arm.wrist,cuff,.024,[0,0,0],'bodyLimb');
 let depth=0,guide=0;for(const point of vertices){const p=N.local([-point[0],point[1],point[2]]);depth=Math.max(depth,bodyDepth(p));guide=Math.max(guide,.001-N.body(p));}
 const fore=arm.wrist.map((v,i)=>(v-arm.elbow[i])/fl),bend=Math.acos(Math.max(-1,Math.min(1,fore.reduce((v,a,i)=>v+a*q.R[1].reduce((s,x,j)=>s+x*[ViolinModel.GEOM.U,ViolinModel.GEOM.V,ViolinModel.GEOM.W][j][i],0),0))));
 const above=Math.max(0,N.local(arm.elbow)[2]+.04);
 return {depth,cost:Math.max(0,depth-.0005)**2/1e-10+Math.max(0,guide)**2/1e-5+bend*bend+above*above/.00001};
}
function fit(P,key,reference=key.x[11]){
 const S=ViolinMotion.atLegacy(P,key.t),q=N.jointsAt(P,key.t,[key],S.debug.contacts);let best=null;
 function probe(angle){q.x[11]=angle;const m=measure(q,S.armL.shoulder),cost=m.cost+.03*(angle-reference)**2;if(!best||cost<best.cost)best={angle,cost,depth:m.depth};}
 for(let j=-24;j<=24;j++)probe(j*Math.PI/24);
 for(let h=Math.PI/48;h>.0005;h/=2){const a=best.angle;probe(a-h);probe(a+h);}
 key.x[11]=best.angle;return best;
}
for(const song of VIOLIN_SONGS){
 const P=ViolinMotion.plan(song),entry=VIOLIN_HAND_FRAMES.songs[song.id],keys=entry.keys;
 if(entry.signature!==JSON.stringify(P.notes))throw Error('Notes changed: '+song.id);
 let previous=0;for(let i=0;i<keys.length;i++){const b=fit(P,keys[i],previous);previous=b.angle;if(i%250===0)console.error(song.id,i,'/',keys.length,'depth',b.depth);}
 for(let pass=0;pass<5;pass++){
  const times=new Set([0,song.duration]);for(let t=0;t<song.duration;t+=1/30)times.add(t);for(const n of P.notes)for(const t of [n.t0,n.t0+n.dur/2,n.t1])times.add(t);
  const bad=[];for(const t of times){const S=ViolinMotion.atLegacy(P,t),q=N.jointsAt(P,t,keys,S.debug.contacts),m=measure(q,S.armL.shoulder);if(m.depth>.00095)bad.push({...q,t});}
  console.error(song.id,'arm repair',pass,bad.length);if(!bad.length)break;if(pass===4)throw Error('Unresolved forearm clearance: '+song.id);
  for(const key of bad){fit(P,key);const old=keys.findIndex(k=>Math.abs(k.t-key.t)<1e-7);if(old>=0)keys[old].x[11]=key.x[11];else keys.push({t:key.t,u:key.u,x:key.x.slice(0,12),a:key.a});}keys.sort((a,b)=>a.t-b.t);
 }
}
VIOLIN_HAND_FRAMES.stamp=N.stamp();
fs.writeFileSync('dist/instruments/violin-hand-frames.js',"'use strict';\n// Generated hand trajectories; anatomical left grip and offline elbow fitting.\nwindow.VIOLIN_HAND_FRAMES="+JSON.stringify(VIOLIN_HAND_FRAMES,(k,v)=>typeof v==='number'?Math.round(v*1e7)/1e7:v)+';\n');

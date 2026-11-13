'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');global.window=globalThis;
for(const n of ['bow-hand','hand-surface','violin-skin','violin-fingering','violin-songs','violin-model','violin-hand','violin-hand-frames','violin-motion','cello-fingering','cello-model','cello-motion','cello-songs','cello-poses','violin-gl'])vm.runInThisContext(fs.readFileSync(`dist/instruments/${n}.js`,'utf8'),{filename:n});
const sub=(a,b)=>a.map((v,i)=>v-b[i]),dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
function triangleDistance(p,a,b,c){
 const ab=sub(b,a),ac=sub(c,a),ap=sub(p,a),n=cross(ab,ac),nn=dot(n,n),d00=dot(ab,ab),d01=dot(ab,ac),d11=dot(ac,ac),d20=dot(ap,ab),d21=dot(ap,ac),den=d00*d11-d01*d01;
 if(den>1e-20){const v=(d11*d20-d01*d21)/den,w=(d00*d21-d01*d20)/den;if(v>=0&&w>=0&&v+w<=1)return Math.abs(dot(ap,n))/Math.sqrt(nn);}
 return Math.min(...[[a,b],[b,c],[c,a]].map(([x,y])=>{const e=sub(y,x),t=Math.max(0,Math.min(1,dot(sub(p,x),e)/(dot(e,e)||1)));return Math.hypot(...p.map((v,i)=>v-x[i]-e[i]*t));}));
}
const state=ViolinFingerSkin.create(true),refs=Object.values(state),edges=new Map();
assert.equal(state.positions.length/3,490);assert.equal(state.indices.length/3,960);
for(let i=0;i<state.indices.length;i+=3){const a=Array.from(state.indices.subarray(i,i+3));assert(a.every(v=>Math.floor(v/98)===Math.floor(a[0]/98)));for(let j=0;j<3;j++){const x=a[j],y=a[(j+1)%3],key=Math.min(x,y)+':'+Math.max(x,y),e=edges.get(key)||[0,0];e[0]++;e[1]+=x<y?1:-1;edges.set(key,e);}}
for(const [count,winding] of edges.values()){assert.equal(count,2,'Open seam');assert.equal(winding,0,'Inconsistent normal orientation');}
for(let f=0;f<5;f++){const adjacency=Array.from({length:98},()=>new Set());let count=0;for(const key of edges.keys()){const [a,b]=key.split(':').map(Number);if(Math.floor(a/98)===f){adjacency[a%98].add(b%98);adjacency[b%98].add(a%98);count++;}}const visited=new Set([0]),queue=[0];for(const a of queue)for(const b of adjacency[a])if(!visited.has(b)){visited.add(b);queue.push(b);}assert.equal(visited.size,98);assert.equal(98-count+192,2);}
const hands=[];for(const song of VIOLIN_SONGS){const plan=ViolinMotion.plan(song);for(let i=0;i<=100;i++)hands.push(ViolinMotion.at(plan,song.duration*i/100).handR);}CelloMotion.setHandSolver('natural');for(const song of CELLO_SONGS)for(let i=0;i<=100;i++)hands.push(CelloMotion.poseCached(song,song.duration*i/100).bowHand);
const meshes={},report={poses:hands.length,componentSurface:{triangles:960,closedDigits:5},wholeHandTriangles:1688,maxSurfaceContactGap:0};
for(const H of hands){const before=JSON.stringify(H);let draws=0;BowHand.draw({oriented(){},segment(){throw Error('Segment fallback');},mesh(data,color,F){draws++;assert.equal(data.length/18,1688);if(meshes[H.type])assert.equal(data,meshes[H.type],'Allocated a new mesh');else meshes[H.type]=data;assert.equal(F.O,H.origin);assert.equal(F.U,H.basis[0]);assert.equal(F.V,H.basis[1]);assert.equal(F.W,H.basis[2]);}},H,[.7,.5,.4],[.8,.6,.5]);assert.equal(draws,1);assert.equal(JSON.stringify(H),before,'Skin changed bow contacts or skeleton');}
for(const type of ['violin','cello']){
 const H=BowHand.create(type,[0,0,0],[1,0,0],[0,0,1]);ViolinFingerSkin.update(state,H);Object.values(state).forEach((v,i)=>assert.equal(v,refs[i]));assert(state.data.every(Number.isFinite));for(let i=0;i<state.normals.length;i+=3)assert(Math.abs(Math.hypot(...state.normals.subarray(i,i+3))-1)<1e-8);
 for(const [f,d] of [H.thumb,...H.fingers].entries()){
  // Compare actual surface triangles against each previously researched contact.
  let distance=Infinity;const data=meshes[type],target=H.basis.map(axis=>dot(sub(d.contact.target,H.origin),axis));
  for(let i=f*184*18;i<(f+1)*184*18;i+=18)distance=Math.min(distance,triangleDistance(target,Array.from(data.subarray(i,i+3)),Array.from(data.subarray(i+6,i+9)),Array.from(data.subarray(i+12,i+15))));
  report.maxSurfaceContactGap=Math.max(report.maxSurfaceContactGap,distance);assert(distance<.001,type+'/'+d.name+': skin missed grip contact '+distance);
 }
}
let buffers=0,uploads=0,updates=0,draws=0;
const gl={VERTEX_SHADER:1,FRAGMENT_SHADER:2,COMPILE_STATUS:3,LINK_STATUS:4,ARRAY_BUFFER:5,STATIC_DRAW:6,DYNAMIC_DRAW:9,FLOAT:7,TRIANGLES:8,createShader:()=>({}),shaderSource(){},compileShader(){},getShaderParameter:()=>true,createProgram:()=>({}),attachShader(){},linkProgram(){},getProgramParameter:()=>true,useProgram(){},getAttribLocation:()=>0,getUniformLocation:()=>0,createBuffer:()=>{buffers++;return{};},bindBuffer(){},bufferData(){uploads++;},bufferSubData(){updates++;},enableVertexAttribArray(){},vertexAttribPointer(){},uniformMatrix4fv(){},uniformMatrix3fv(){},uniform3fv(){},uniform1f(){},drawArrays(){draws++;}};
const R=RecitalGL.create({getContext:()=>gl}),baseline={buffers,uploads,draws},frames=4500;
for(let i=0;i<frames;i++)BowHand.draw(R,hands[i%hands.length],[.7,.5,.4],[.8,.6,.5]);
assert.equal(buffers-baseline.buffers,2,'Bow grip buffers accumulated');assert.equal(uploads-baseline.uploads,2,'Rigid skin was uploaded again');assert.equal(updates,0);assert.equal(draws-baseline.draws,frames,'Expected a single connected hand draw');
Object.assign(report,{frames,gpuBuffers:buffers-baseline.buffers,gpuUploads:uploads-baseline.uploads,gpuUpdates:updates});console.log(JSON.stringify(report,null,2));

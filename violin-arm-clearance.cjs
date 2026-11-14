'use strict';
// Actual tapered sleeve vertices against the rendered violin body. Offline only.
module.exports=N=>{
const fs=require('node:fs'),vm=require('node:vm'),dist=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
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
 const arm=N.armOf(q,shoulder),fl=dist(arm.elbow,arm.wrist);
 vertices.length=0;ViolinModel.drawForearm(R,arm,{basis:q.R.map(axis=>N.world(q.w.map((v,i)=>v+axis[i])).map((v,i)=>v-arm.wrist[i]))});
 let depth=0;for(const point of vertices){const p=N.local([-point[0],point[1],point[2]]);depth=Math.max(depth,bodyDepth(p));}
 const fore=arm.wrist.map((v,i)=>(v-arm.elbow[i])/fl),bend=Math.acos(Math.max(-1,Math.min(1,fore.reduce((v,a,i)=>v+a*q.R[1].reduce((s,x,j)=>s+x*[ViolinModel.GEOM.U,ViolinModel.GEOM.V,ViolinModel.GEOM.W][j][i],0),0))));
 const outward=arm.elbow[0],raised=Math.max(0,arm.elbow[1]-arm.wrist[1]+.040);
 return {depth,outward,bend,raised,cost:Math.max(0,.120-outward)**2/.0001+raised*raised/.0001+Math.max(0,depth-.0003)**2/1e-10+bend*bend+Math.max(0,bend-70*Math.PI/180)**2/.0004};
}

return {measure,bodyDepth};
};

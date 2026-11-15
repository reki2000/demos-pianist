'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');global.window=globalThis;
for(const n of ['bow-hand','hand-surface','violin-skin'])vm.runInThisContext(fs.readFileSync('dist/instruments/'+n+'.js','utf8'));
const sub=(a,b)=>a.map((v,i)=>v-b[i]),dot=(a,b)=>a.reduce((v,x,i)=>v+x*b[i],0),centroid=(s,loop)=>[0,1,2].map(k=>loop.reduce((v,i)=>v+s.positions[i*3+k]/loop.length,0));
const report={};
for(const type of ['violin','cello']){
 const W=BowHand.create(type,[0,0,0],[1,0,0],[0,0,1]),local=p=>W.basis.map(axis=>dot(sub(p,W.origin),axis));
 // Exercise the exact canonical coordinates used by the cached bow mesh.
 const H={basis:[[1,0,0],[0,1,0],[0,0,1]],palmPos:local(W.palmPos),palmScale:W.palmScale,wrist:local(W.wrist),thumb:{...W.thumb,points:W.thumb.points.map(local)},fingers:W.fingers.map(f=>({...f,points:f.points.map(local)})),thenarCover:true};
 const s=ViolinFingerSkin.create(true,true,false,true);ViolinFingerSkin.update(s,H);
 const boundary=centroid(s,s.surface.sockets[0]),root=centroid(s,Array.from({length:8},(_,j)=>j)),palm=H.palmPos;
 assert(boundary[0]>palm[0]&&root[0]>palm[0],'Thumb socket must be on the radial side');
 assert(boundary[1]<palm[1]&&root[1]<palm[1],'Thumb socket must follow the metacarpal toward the fingers');
 assert(boundary[2]<palm[2]&&root[2]<palm[2],'Thumb socket must open on the palmar side');
 assert(s.surface.sockets[0].length>8,'Thumb must have a broad web opening');
 // Every intermediate thumb section must retain area instead of pinching
 // into a line. Use the actual stitched positions, not template constants.
 const ring=Array.from({length:8},(_,j)=>s.surface.wristOffset+9+j),C=centroid(s,ring);let area=0;
 for(let j=0;j<8;j++){const a=sub(Array.from(s.positions.subarray(ring[j]*3,ring[j]*3+3)),C),b=sub(Array.from(s.positions.subarray(ring[(j+1)%8]*3,ring[(j+1)%8]*3+3)),C);area+=Math.hypot(a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0])/2;}
 assert(area>1e-4,'Thenar web has collapsed');
 report[type]={socketVertices:s.surface.sockets[0].length,bridgeAreaSquareMm:area*1e6,thumbDistalMm:BowHand.dimensions.thumb[2]*1000,triangles:s.indices.length/3};
}
console.log(JSON.stringify(report,null,2));

'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),crypto=require('node:crypto');global.window=globalThis;
for(const f of ['guitar-songs','guitar-fingering','guitar-motion','guitar-model','guitar-plans'])vm.runInThisContext(fs.readFileSync('dist/instruments/'+f+'.js','utf8'),{filename:f});
vm.runInThisContext(fs.readFileSync('dist/gl.js','utf8'));
const G=GuitarMotion,range=()=>({min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]}),bounds={body:range(),board:range(),nut:range()},draws={body:0,board:0};let buffer,matrix,color;
const gl={VERTEX_SHADER:1,FRAGMENT_SHADER:2,COMPILE_STATUS:3,LINK_STATUS:4,ARRAY_BUFFER:5,STATIC_DRAW:6,DYNAMIC_DRAW:9,FLOAT:7,TRIANGLES:8,createShader:()=>({}),shaderSource(){},compileShader(){},getShaderParameter:()=>true,createProgram:()=>({}),attachShader(){},linkProgram(){},getProgramParameter:()=>true,useProgram(){},getAttribLocation:()=>0,getUniformLocation:(_,n)=>n,createBuffer:()=>({}),bindBuffer:(_,b)=>buffer=b,bufferData:(_,d)=>buffer.data=d,bufferSubData:(_,__,d)=>buffer.data=d,enableVertexAttribArray(){},vertexAttribPointer(){},uniformMatrix4fv:(_,__,m)=>matrix=m,uniformMatrix3fv(){},uniform3fv:(name,c)=>{if(name==='uC')color=c;},uniform1f(){},drawArrays:(_,__,count)=>{
 const c=JSON.stringify(color),part=c===JSON.stringify([.30,.15,.08])||c===JSON.stringify([.72,.55,.32])?'body':c===JSON.stringify([.09,.06,.045])?'board':c===JSON.stringify([.88,.85,.78])?'nut':null;if(!part)return;
 if(part in draws)draws[part]++;
 for(let j=0;j<count*6;j+=6){const a=buffer.data.subarray(j,j+3),p=[0,1,2].map(k=>(k===0?-1:1)*(matrix[k]*a[0]+matrix[k+4]*a[1]+matrix[k+8]*a[2]+matrix[k+12])),v=p.map((x,k)=>x-G.NUT[k]),q=[-v.reduce((s,x,k)=>s+x*G.u[k],0),v.reduce((s,x,k)=>s+x*G.w[k],0),v.reduce((s,x,k)=>s+x*G.n[k],0)];if(part==='nut'&&Math.abs(q[0])>.003)continue;for(let k=0;k<3;k++){bounds[part].min[k]=Math.min(bounds[part].min[k],q[k]);bounds[part].max[k]=Math.max(bounds[part].max[k],q[k]);}}
}};
const R=RecitalGL.create({getContext:()=>gl}),vib={1:0,2:0,3:0,4:0,5:0,6:0};GuitarModel.drawGuitar(R,{vib},0);
const spans=b=>b.max.map((v,i)=>(v-b.min[i])*1000),body=spans(bounds.body),board=spans(bounds.board),nut=spans(bounds.nut);
assert.equal(G.SCALE,.650);assert(Math.abs(body[0]-490)<1);assert(Math.abs(body[1]-370)<1);assert(body[2]>=94&&body[2]<=101);assert(Math.abs(board[0]-G.BOARD_END*1000)<.01);assert(Math.abs(nut[1]-52)<.1);assert(Math.abs(board[2]-6)<.01);
for(let d=0;d<=G.BOARD_END;d+=.005){const p=G.stringPoint(1,d),q=G.stringPoint(6,d),span=Math.hypot(...p.map((v,k)=>v-q[k]));assert(span/2<G.fretboardHalfWidth(d)-.003,'Outer strings leave the board');}
const song=GUITAR_SONGS[0];song.fingering=GUITAR_PLAN_CACHE[song.id];const pose=G.poseLegacy(G.plan(song),12);let face=false,calls=[];
const F={setFaceDetail:v=>face=v,piece:(...a)=>{if(face)calls.push(['piece',...a]);},segment:(...a)=>{if(face)calls.push(['segment',...a]);},box(){},ball(){},bone(){}};GuitarModel.drawPerformer(F,pose,12);
const fingerprint=crypto.createHash('sha256').update(JSON.stringify(calls)).digest('hex');
assert.equal(fingerprint,'66b7db8b6f6c3f22240ac3bd15d7bdc9d20732b235d19cd94913ab2e8f70f9ab','Face drawing changed');
let nutBack=Infinity,twelfthBack=Infinity;for(let i=0;i<GuitarModel.NECK_MESH.length;i+=6){const p=GuitarModel.NECK_MESH,x=p[i]-G.NUT[0],y=p[i+1]-G.NUT[1],z=p[i+2]-G.NUT[2],d=-(x*G.u[0]+y*G.u[1]+z*G.u[2]),n=x*G.n[0]+y*G.n[1]+z*G.n[2];if(Math.abs(d)<.00001)nutBack=Math.min(nutBack,n);if(Math.abs(d-.325)<.00001)twelfthBack=Math.min(twelfthBack,n);}
assert(Math.abs(nutBack+.021)<.00001);assert(Math.abs(twelfthBack+.023)<.00001);assert(Math.abs(bounds.board.max[2]-bounds.body.max[2]-.006)<.00001);
const report={fretCount:G.FRETS,scaleLengthMm:G.SCALE*1000,neckDepthAtNutMm:-nutBack*1000,neckDepthAt12thMm:-twelfthBack*1000,renderedBodyMm:{length:body[0],width:body[1],depth:body[2]},renderedFingerboardMm:{length:board[0],nutWidth:nut[1],endWidth:board[1],depth:board[2]},bodyDraws:draws.body,boardDraws:draws.board,faceFingerprint:fingerprint};console.log(JSON.stringify(report,null,2));

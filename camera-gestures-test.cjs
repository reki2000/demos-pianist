'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');global.window=globalThis;
for(const f of ['gl','camera-gestures'])vm.runInThisContext(fs.readFileSync('dist/'+f+'.js','utf8'),{filename:f});
const C=CameraGestures,R=RecitalGL,sub=(a,b)=>a.map((v,i)=>v-b[i]),length=a=>Math.hypot(...a),near=(a,b,tol=1e-10)=>assert(length(sub(a,b))<tol,JSON.stringify({a,b}));
function project(c,p,w,h){const m=R.multiply(R.perspective(w/h),R.look(R.toWorld(c.eye),R.toWorld(c.at),R.toWorld(c.up))),q=[...R.toWorld(p),1],v=[0,0,0,0];for(let i=0;i<4;i++)for(let j=0;j<4;j++)v[i]+=m[j*4+i]*q[j];return{x:(v[0]/v[3]+1)*w/2,y:(1-v[1]/v[3])*h/2};}
const cameras=[{eye:[1.8,2.25,-2.35],at:[0,1.28,-.74],up:[0,1,0]},{eye:[0,3,.3],at:[0,1,-.51],up:[0,0,1]}];
for(const c of cameras){const snapshot=JSON.stringify(c),rect={width:390,height:360},mid={x:195,y:180};
 const pan=C.zoomPan(c,mid,{x:mid.x+30,y:mid.y-20},1,rect);near(sub(pan.eye,pan.at),sub(c.eye,c.at));near(pan.up,c.up);const p=project(pan,c.at,390,360);assert(Math.abs(p.x-225)<.0005&&Math.abs(p.y-160)<.0005,'Pan screen direction or scale is wrong');
 // An off-centre point on the target plane must stay under the fingers.
 const view=R.look(R.toWorld(c.eye),R.toWorld(c.at),R.toWorld(c.up)),at=R.toWorld(c.at),point=R.toWorld(at.map((v,i)=>v+.3*view[i*4]+.2*view[i*4+1])),from=project(c,point,390,360),to={x:from.x+12,y:from.y+18},zoom=C.zoomPan(c,from,to,.6,rect),p2=project(zoom,point,390,360);
 assert(Math.abs(p2.x-to.x)<.0005&&Math.abs(p2.y-to.y)<.0005,'Pinch anchor drifted');assert(Math.abs(length(sub(zoom.eye,zoom.at))/length(sub(c.eye,c.at))-.6)<1e-10);
 for(const ratio of [1e-8,1e8]){const z=C.zoomPan(c,mid,mid,ratio,rect);assert([...z.eye,...z.at].every(Number.isFinite));assert(Math.abs(length(sub(z.eye,z.at))-(ratio<1?.15:25))<1e-10);}
 const orbit=C.orbit(c,60,1e4);assert(Math.abs(length(sub(orbit.eye,orbit.at))-length(sub(c.eye,c.at)))<1e-10);near(orbit.at,c.at);assert.equal(JSON.stringify(c),snapshot,'Gesture mutated its input');
}
class Canvas{constructor(){this.events=new Map();this.rect={left:20,top:30,width:400,height:300};}addEventListener(t,f){if(!this.events.has(t))this.events.set(t,[]);this.events.get(t).push(f);}getBoundingClientRect(){return this.rect;}emit(type,id,x,y,extra={}){const e={pointerId:id,clientX:x,clientY:y,pointerType:'touch',button:0,preventDefault(){this.prevented=true;},...extra};for(const f of this.events.get(type)||[])f(e);return e;}}
const canvas=new Canvas();let enabled=true,mode='auto',camera=structuredClone(cameras[0]),writes=0;
const client={enabled:()=>enabled,isOrbit:()=>mode==='orbit',camera:()=>camera,change:c=>{camera=c;mode='orbit';writes++;}},control=C.bind(canvas,client);
canvas.emit('pointerdown',1,140,170);canvas.emit('pointermove',1,140,170);assert.equal(writes,0,'One finger took over automatic camera');
const start=structuredClone(camera);canvas.emit('pointerdown',2,240,170);near(camera.eye,start.eye);assert.equal(mode,'orbit');
canvas.emit('pointermove',1,120,170);canvas.emit('pointermove',2,260,170);const expected=C.zoomPan(start,{x:170,y:140},{x:170,y:140},100/140,canvas.rect);near(camera.eye,expected.eye);near(camera.at,expected.at);
const two=structuredClone(camera);canvas.emit('pointerdown',3,280,180);canvas.emit('pointermove',1,125,170);near(camera.eye,two.eye);canvas.emit('pointerup',3,280,180);near(camera.eye,two.eye);
canvas.emit('pointerup',2,260,170);const remaining=structuredClone(camera);canvas.emit('pointermove',1,135,175);assert(length(sub(camera.eye,remaining.eye))>.001);assert(Math.abs(length(sub(camera.eye,camera.at))-length(sub(remaining.eye,remaining.at)))<1e-10);
canvas.emit('pointercancel',1,135,175);const afterCancel=writes;canvas.emit('pointermove',1,200,200);assert.equal(writes,afterCancel);
canvas.emit('pointerdown',4,100,100);canvas.emit('lostpointercapture',4,100,100);const afterLost=writes;canvas.emit('pointermove',4,200,200);assert.equal(writes,afterLost);
mode='auto';const wheel=canvas.emit('wheel',0,100,100,{deltaY:80,deltaMode:0});assert(!wheel.prevented);const trackpad=canvas.emit('wheel',0,100,100,{deltaY:-80,ctrlKey:true,deltaMode:0});assert(trackpad.prevented&&mode==='orbit');
control.cancel();enabled=false;const inactive=writes;canvas.emit('pointerdown',5,100,100);canvas.emit('pointerdown',6,200,100);canvas.emit('pointermove',5,80,100);assert.equal(writes,inactive,'Inactive instrument consumed gestures');
console.log(JSON.stringify({cameraFrames:2,screenParallelPan:true,anchoredPinch:true,zoomLimits:true,noSequentialPointerDrift:true,pointerTransitions:true,cancelAndCaptureLoss:true,inactiveClientIgnored:true},null,2));

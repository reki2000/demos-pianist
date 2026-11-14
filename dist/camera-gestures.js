'use strict';
// Shared camera gestures, in the same planning coordinates as RecitalGL.
window.CameraGestures=(()=>{
 const add=(a,b)=>a.map((v,i)=>v+b[i]),sub=(a,b)=>a.map((v,i)=>v-b[i]),mul=(a,s)=>a.map(v=>v*s),dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
 const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],unit=a=>mul(a,1/(Math.hypot(...a)||1));
 const reflect=p=>[-p[0],p[1],p[2]],clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
 const copy=c=>({eye:c.eye.slice(),at:c.at.slice(),up:(c.up||[0,1,0]).slice()});
 function axes(c){const z=unit(reflect(sub(c.eye,c.at))),up=unit(reflect(c.up)),x=unit(cross(up,z));return {x,y:cross(z,x),z};}
 // Anchor the point under the original two-finger midpoint. Applying every
 // move to the gesture's initial pose avoids drift from sequential events.
 function zoomPan(camera,from,to,ratio,viewport,min=.15,max=25){
  const c=copy(camera),distance=Math.hypot(...sub(c.eye,c.at)),next=clamp(distance*ratio,min,max),s=next/distance,{x,y}=axes(c);
  const k=2*distance*Math.tan(.57/2)/Math.max(1,viewport.height),cx=viewport.width/2,cy=viewport.height/2;
  const shift=reflect(add(mul(x,((from.x-cx)-(to.x-cx)*s)*k),mul(y,((cy-from.y)-(cy-to.y)*s)*k)));
  c.at=add(c.at,shift);c.eye=add(c.at,mul(sub(camera.eye,camera.at),s));return c;
 }
 function orbit(camera,dx,dy){
  const c=copy(camera),up=unit(reflect(c.up));let v=reflect(sub(c.eye,c.at));
  const rotate=(v,a,t)=>add(add(mul(v,Math.cos(t)),mul(cross(a,v),Math.sin(t))),mul(a,dot(a,v)*(1-Math.cos(t))));
  v=rotate(v,up,dx*.008);const elevation=Math.asin(clamp(dot(unit(v),up),-1,1)),pitch=clamp(elevation+dy*.008,-Math.PI/2+.025,Math.PI/2-.025)-elevation;
  const right=unit(cross(up,unit(v)));v=rotate(v,right,-pitch);c.eye=add(c.at,reflect(v));return c;
 }
 function bind(canvas,client){
  const points=new Map();let baseline=null;
  function capture(id){try{canvas.setPointerCapture?.(id);}catch{}}
  function cancel(){const ids=[...points.keys()];points.clear();baseline=null;for(const id of ids)try{if(canvas.hasPointerCapture?.(id))canvas.releasePointerCapture(id);}catch{}}
  function rebase(){
   const c=client.camera();baseline=null;if(!c||points.size<1||points.size>2)return;
   const p=[...points.values()],rect=canvas.getBoundingClientRect();
   baseline={camera:copy(c),rect,p:p.map(v=>({...v})),mid:{x:(p[0].x+(p[1]?.x??p[0].x))/2-rect.left,y:(p[0].y+(p[1]?.y??p[0].y))/2-rect.top},span:p[1]?Math.hypot(p[1].x-p[0].x,p[1].y-p[0].y):0};
   if(points.size===2)client.change(copy(c));
  }
  canvas.addEventListener('pointerdown',e=>{
   if(!client.enabled()||e.pointerType!=='touch'&&e.button!==0)return;
   if(e.pointerType!=='touch'&&!client.isOrbit())return;
   points.set(e.pointerId,{x:e.clientX,y:e.clientY});capture(e.pointerId);rebase();
  });
  canvas.addEventListener('pointermove',e=>{
   if(!points.has(e.pointerId))return;if(!client.enabled()){cancel();return;}
   points.set(e.pointerId,{x:e.clientX,y:e.clientY});if(!baseline)rebase();if(!baseline||points.size>2)return;
   const p=[...points.values()];
   if(p.length===2){const mid={x:(p[0].x+p[1].x)/2-baseline.rect.left,y:(p[0].y+p[1].y)/2-baseline.rect.top},span=Math.hypot(p[1].x-p[0].x,p[1].y-p[0].y),ratio=span>=4&&baseline.span>=4?baseline.span/span:1;
    client.change(zoomPan(baseline.camera,baseline.mid,mid,ratio,baseline.rect,client.minDistance,client.maxDistance));
   }else if(client.isOrbit())client.change(orbit(baseline.camera,p[0].x-baseline.p[0].x,p[0].y-baseline.p[0].y));
   e.preventDefault();
  },{passive:false});
  function end(e){if(!points.delete(e.pointerId))return;if(!client.enabled()){cancel();return;}rebase();}
  for(const type of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(type,end);
  canvas.addEventListener('wheel',e=>{
   if(!client.enabled()||!client.isOrbit()&&!e.ctrlKey)return;const c=client.camera();if(!c)return;
   e.preventDefault();const rect=canvas.getBoundingClientRect(),mid={x:e.clientX-rect.left,y:e.clientY-rect.top},delta=e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?rect.height:1);
   client.change(zoomPan(c,mid,mid,Math.exp(clamp(delta*.0015,-2,2)),rect,client.minDistance,client.maxDistance));
  },{passive:false});
  window.addEventListener?.('blur',cancel);window.addEventListener?.('resize',cancel);
  return {cancel};
 }
 return {zoomPan,orbit,bind};
})();

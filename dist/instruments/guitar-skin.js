'use strict';
// Closed B palm/finger/wrist surface with continuous thumb web and rounded
// cello/violin-proportioned finger radii (replacing the old thin, pointy tips).
window.GuitarHandSkin=(()=>{
 const states=new WeakMap(),G=window.GuitarMotion;
 // Proportional to BowHand.dimensions.radii (cello/violin) scaled to the compact guitar hand.
 const FINGER_RADII=[[.0078,.0072,.0062],[.0084,.0078,.0065],[.0080,.0074,.0062],[.0069,.0063,.0054]];
 function create(hand){const s=ViolinFingerSkin.create(false,true,hand===0,true);s.thumb.radii=[.011,.0085,.0065];s.thumb.skinBaseT=.65;return s;}
 function conform(p){
  for(let i=0;i<p.length;i+=3){
   let x=p[i]-G.NUT[0],y=p[i+1]-G.NUT[1],z=p[i+2]-G.NUT[2],d=-(x*G.u[0]+y*G.u[1]+z*G.u[2]),v=x*G.w[0]+y*G.w[1]+z*G.w[2],h=x*G.n[0]+y*G.n[1]+z*G.n[2];
   if(h>=-.012){
    const board=d>=0&&d<=G.BOARD_END&&Math.abs(v)<G.fretboardHalfWidth(d),body=d>=G.BODY_SPEC.start&&d<=G.BODY_SPEC.end&&Math.abs(v)<window.GuitarModel.bodyWidth(d);
    const top=Math.max(body?window.GuitarModel.BODY_SPEC.top+.0002:-Infinity,board ? .0015 : -Infinity),lift=Math.max(0,top-h);
    if(lift){p[i]+=G.n[0]*lift;p[i+1]+=G.n[1]*lift;p[i+2]+=G.n[2]*lift;h+=lift;}
   }
   if(d>=-.05&&d<=G.NECK_END){
    const nd=G.neckDistance(d,v,h);
    if(nd<0){
     const a=G.neckSection(d),ny=h-a.centre,gx=v/(a.width*a.width),gy=ny/(a.depth*a.depth),gl=Math.hypot(gx,gy)||1,push=-nd+.0002;
     p[i]+=(G.w[0]*gx+G.n[0]*gy)/gl*push;p[i+1]+=(G.w[1]*gx+G.n[1]*gy)/gl*push;p[i+2]+=(G.w[2]*gx+G.n[2]*gy)/gl*push;
    }
   }
  }
 }
 function update(state,hand){
  const wrapped={...hand,fingers:hand.fingers.map((f,i)=>({...f,radii:FINGER_RADII[i]}))};
  return ViolinFingerSkin.update(state,wrapped,undefined,conform);
 }
 function draw(R,hands,color){let pair=states.get(R);if(!pair){pair=[create(0),create(1)];states.set(R,pair);}for(let h=0;h<2;h++)R.dynamicMesh('guitar-hand-'+h,update(pair[h],hands[h]),color);}
 return {create,update,draw};
})();

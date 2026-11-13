'use strict';
// Same closed B palm/finger/wrist surface and shorter thumb as the piano.
window.GuitarHandSkin=(()=>{
 const states=new WeakMap(),G=window.GuitarMotion;
 function create(hand){const s=ViolinFingerSkin.create(false,true,hand===0);s.thumb.radii=[.012,.0085,.0065];s.thumb.skinBaseT=.65;return s;}
 function conform(p){
  for(let i=0;i<p.length;i+=3){
   const x=p[i]-G.NUT[0],y=p[i+1]-G.NUT[1],z=p[i+2]-G.NUT[2],d=-(x*G.u[0]+y*G.u[1]+z*G.u[2]),v=x*G.w[0]+y*G.w[1]+z*G.w[2],h=x*G.n[0]+y*G.n[1]+z*G.n[2];
   if(h<-.006)continue;
   const board=d>=0&&d<=G.BOARD_END&&Math.abs(v)<G.fretboardHalfWidth(d),body=d>=G.BODY_SPEC.start&&d<=G.BODY_SPEC.end&&Math.abs(v)<window.GuitarModel.bodyWidth(d);
   const top=Math.max(body?window.GuitarModel.BODY_SPEC.top+.0002:-Infinity,board ? .0015 : -Infinity),lift=Math.max(0,top-h);if(!lift)continue;
   p[i]+=G.n[0]*lift;p[i+1]+=G.n[1]*lift;p[i+2]+=G.n[2]*lift;
  }
 }
 function update(state,hand){return ViolinFingerSkin.update(state,hand,undefined,conform);}
 function draw(R,hands,color){let pair=states.get(R);if(!pair){pair=[create(0),create(1)];states.set(R,pair);}for(let h=0;h<2;h++)R.dynamicMesh('guitar-hand-'+h,update(pair[h],hands[h]),color);}
 return {create,update,draw};
})();

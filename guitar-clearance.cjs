'use strict';
// Independent rendered-vertex audit. The planner uses its own box/capsule
// guide; acceptance checks the deformed skin against the finished instrument.
module.exports=function createAudit(G,M,Skin){
 const used=new WeakMap();
 function measure(state,H,residuals){
  Skin.update(state,H);let ids=used.get(state);if(!ids){ids=[...new Set(state.indices)];used.set(state,ids);}
  const result={body:0,board:0,neck:0,max:0};
  for(const i of ids){const p=state.positions,k=i*3,x=p[k]-G.NUT[0],y=p[k+1]-G.NUT[1],z=p[k+2]-G.NUT[2],d=-(x*G.u[0]+y*G.u[1]+z*G.u[2]),w=x*G.w[0]+y*G.w[1]+z*G.w[2],n=x*G.n[0]+y*G.n[1]+z*G.n[2];
   const body=d>M.BODY_SPEC.start&&d<M.BODY_SPEC.end?Math.max(0,Math.min(d-M.BODY_SPEC.start,M.BODY_SPEC.end-d,M.bodyWidth(d)-Math.abs(w),n-M.BODY_SPEC.back,M.BODY_SPEC.top-n)):0;
   const board=d>0&&d<G.BOARD_END?Math.max(0,Math.min(d,G.BOARD_END-d,G.fretboardHalfWidth(d)-Math.abs(w),n+.006,-n)):0;
   // The smooth elliptical shaft encloses its polygonal rendered loft.
   const neck=Math.max(0,-G.neckDistance(d,w,n));
   const depth=Math.max(body,board,neck);if(residuals)residuals.push(depth/.00008);if(depth>result.max){result.max=depth;result.witness={vertex:i,point:[d,w,n],part:body===depth?'body':board===depth?'board':'neck'};}
   result.body=Math.max(result.body,body);result.board=Math.max(result.board,board);result.neck=Math.max(result.neck,neck);
  }result.max=Math.max(result.body,result.board,result.neck);return result;
 }
 return {measure};
};

'use strict';
// A closed, shared-normal surface for each of the four FK fingers. Topology,
// scratch storage and upload storage are allocated once per renderer.
window.ViolinFingerSkin = (() => {
  const SIDES=8,RINGS=12,PER_FINGER=RINGS*SIDES+2,VERTICES=4*PER_FINGER;
  const sections=[[0,-.12],[0,0],[0,.45],[0,.88],[0,1],[1,.18],[1,.62],[1,.88],[1,1],[2,.25],[2,.72],[2,1]];
  const widths=[.0060,.0068,.0066,.0062,.0060,.0057,.0054,.0049,.0047,.0040,.0037,.0026];
  const depths=[.0028,.0045,.0060,.0058,.0055,.0052,.0049,.0045,.0043,.0038,.0026,.0015];
  const circle=new Float64Array(SIDES*2);
  for(let j=0;j<SIDES;j++){const a=(j+.5)*2*Math.PI/SIDES;circle[j*2]=Math.cos(a);circle[j*2+1]=Math.sin(a);}
  function create(){
    const indices=new Uint16Array(4*((RINGS-1)*SIDES*6+SIDES*6));let at=0;
    const triangle=(a,b,c)=>{indices[at++]=a;indices[at++]=b;indices[at++]=c;};
    for(let f=0;f<4;f++){
      const base=f*PER_FINGER;
      for(let r=0;r<RINGS-1;r++)for(let j=0;j<SIDES;j++){
        const k=(j+1)%SIDES,a=base+r*SIDES+j,b=a+SIDES,c=base+(r+1)*SIDES+k,d=base+r*SIDES+k;
        triangle(a,b,c);triangle(a,c,d);
      }
      for(let j=0;j<SIDES;j++){const k=(j+1)%SIDES;triangle(base+RINGS*SIDES,base+j,base+k);triangle(base+RINGS*SIDES+1,base+(RINGS-1)*SIDES+k,base+(RINGS-1)*SIDES+j);}
    }
    return {positions:new Float64Array(VERTICES*3),normals:new Float64Array(VERTICES*3),indices,data:new Float32Array(indices.length*6),directions:new Float64Array(9),lengths:new Float64Array(3)};
  }
  function update(state,hand,board){
    const p=state.positions,n=state.normals,dirs=state.directions,lengths=state.lengths;
    for(let f=0;f<4;f++){
      const points=hand.fingers[f].points,base=f*PER_FINGER;
      for(let s=0;s<3;s++){
        const a=points[s],b=points[s+1],x=b[0]-a[0],y=b[1]-a[1],z=b[2]-a[2],length=Math.hypot(x,y,z)||1;
        lengths[s]=length;dirs[s*3]=x/length;dirs[s*3+1]=y/length;dirs[s*3+2]=z/length;
      }
      // FK flexion stays in one plane. Its normal gives every ring a common
      // lateral axis, avoiding a twisting seam at the knuckles.
      let xx=dirs[1]*dirs[5]-dirs[2]*dirs[4],xy=dirs[2]*dirs[3]-dirs[0]*dirs[5],xz=dirs[0]*dirs[4]-dirs[1]*dirs[3];
      let length=Math.hypot(xx,xy,xz);
      if(length<1e-8){xx=hand.basis[0][0];xy=hand.basis[0][1];xz=hand.basis[0][2];length=Math.hypot(xx,xy,xz);}
      const sign=xx*hand.basis[0][0]+xy*hand.basis[0][1]+xz*hand.basis[0][2]<0?-1:1;
      xx*=sign/length;xy*=sign/length;xz*=sign/length;
      for(let r=0;r<RINGS;r++){
        const s=sections[r][0];let t=sections[r][1];
        if(r===RINGS-1)t=1-Math.min(.0018,lengths[2]*.12)/lengths[2];
        const a=points[s],dx=dirs[s*3],dy=dirs[s*3+1],dz=dirs[s*3+2];
        let cx=a[0]+dx*lengths[s]*t,cy=a[1]+dy*lengths[s]*t,cz=a[2]+dz*lengths[s]*t;
        let tx=dx,ty=dy,tz=dz;
        if(s<2&&t>.75){
          const u=Math.min(1,(t-.75)/.25),weight=u*u*(3-2*u)*.5;
          tx=dx*(1-weight)+dirs[(s+1)*3]*weight;ty=dy*(1-weight)+dirs[(s+1)*3+1]*weight;tz=dz*(1-weight)+dirs[(s+1)*3+2]*weight;
        }else if(s>0&&t<.25){
          const u=Math.max(0,t/.25),weight=(1-u*u*(3-2*u))*.5;
          tx=dx*(1-weight)+dirs[(s-1)*3]*weight;ty=dy*(1-weight)+dirs[(s-1)*3+1]*weight;tz=dz*(1-weight)+dirs[(s-1)*3+2]*weight;
        }
        length=Math.hypot(tx,ty,tz)||1;tx/=length;ty/=length;tz/=length;
        const zx=xy*tz-xz*ty,zy=xz*tx-xx*tz,zz=xx*ty-xy*tx;
        let centreW=0;
        if(board)centreW=(cx-board.O[0])*board.W[0]+(cy-board.O[1])*board.W[1]+(cz-board.O[2])*board.W[2];
        for(let j=0;j<SIDES;j++){
          const c=circle[j*2]*widths[r],d=circle[j*2+1]*depths[r],k=(base+r*SIDES+j)*3;
          let vx=cx+xx*c+zx*d,vy=cy+xy*c+zy*d,vz=cz+xz*c+zz*d;
          // Soft fingertip tissue conforms to the board. The skeleton and
          // its sounding contact point are never moved by the skin update.
          if(board&&r>=9){
            const ox=vx-board.O[0],oy=vy-board.O[1],oz=vz-board.O[2],u=ox*board.U[0]+oy*board.U[1]+oz*board.U[2],v=ox*board.V[0]+oy*board.V[1]+oz*board.V[2];
            if(u>=.058&&u<=.328&&Math.abs(v)<(u<.210?.0225:.0165)&&centreW>=board.top(u)-.0001){
              const w=ox*board.W[0]+oy*board.W[1]+oz*board.W[2],lift=Math.max(0,board.top(u)+.0002-w);
              vx+=board.W[0]*lift;vy+=board.W[1]*lift;vz+=board.W[2]*lift;
            }
          }
          p[k]=vx;p[k+1]=vy;p[k+2]=vz;
        }
      }
      for(let k=0;k<3;k++){p[(base+RINGS*SIDES)*3+k]=points[0][k]-dirs[k]*lengths[0]*.12;p[(base+RINGS*SIDES+1)*3+k]=points[3][k];}
    }
    n.fill(0);
    const indices=state.indices;
    for(let i=0;i<indices.length;i+=3){
      const a=indices[i]*3,b=indices[i+1]*3,c=indices[i+2]*3,abx=p[b]-p[a],aby=p[b+1]-p[a+1],abz=p[b+2]-p[a+2],acx=p[c]-p[a],acy=p[c+1]-p[a+1],acz=p[c+2]-p[a+2];
      const nx=aby*acz-abz*acy,ny=abz*acx-abx*acz,nz=abx*acy-aby*acx;
      n[a]+=nx;n[a+1]+=ny;n[a+2]+=nz;n[b]+=nx;n[b+1]+=ny;n[b+2]+=nz;n[c]+=nx;n[c+1]+=ny;n[c+2]+=nz;
    }
    for(let i=0;i<n.length;i+=3){const length=Math.hypot(n[i],n[i+1],n[i+2])||1;n[i]/=length;n[i+1]/=length;n[i+2]/=length;}
    const data=state.data;
    for(let i=0;i<indices.length;i++){const a=indices[i]*3,b=i*6;data[b]=p[a];data[b+1]=p[a+1];data[b+2]=p[a+2];data[b+3]=n[a];data[b+4]=n[a+1];data[b+5]=n[a+2];}
    return data;
  }
  return {create,update,sides:SIDES,rings:RINGS,vertices:VERTICES,triangles:4*((RINGS-1)*SIDES*2+SIDES*2)};
})();

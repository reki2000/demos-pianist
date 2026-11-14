'use strict';
// Closed shared-normal finger surfaces for the FK left hand and both bow grips. Topology,
// scratch storage and upload storage are reused between updates.
window.ViolinFingerSkin = (() => {
  const SIDES=8,RINGS=12,PER_FINGER=RINGS*SIDES+2,VERTICES=4*PER_FINGER;
  const sections=[[0,-.12],[0,0],[0,.45],[0,.88],[0,1],[1,.18],[1,.62],[1,.88],[1,1],[2,.25],[2,.72],[2,1]];
  const widths=[.0060,.0068,.0066,.0062,.0060,.0057,.0054,.0049,.0047,.0040,.0037,.0026];
  const depths=[.0028,.0045,.0060,.0058,.0055,.0052,.0049,.0045,.0043,.0038,.0026,.0015];
  const circle=new Float64Array(SIDES*2);
  for(let j=0;j<SIDES;j++){const a=(j+.5)*2*Math.PI/SIDES;circle[j*2]=Math.cos(a);circle[j*2+1]=Math.sin(a);}
  const bowSections=[[0,-.12],[0,0],[0,.45],[0,.88],[0,1],[1,.18],[1,.62],[1,.88],[1,1],[2,.45],[2,1],[2,1]];
  function create(bow=false,joined=false,mirrored=false){
    const count=bow||joined?5:4,surface=joined?window.HandSurface.create(bow,count*PER_FINGER,mirrored):null,vertices=count*PER_FINGER+(surface?surface.vertices:0);
    const topology=[];
    const triangle=(a,b,c)=>{topology.push(a,b,c);};
    for(let f=0;f<count;f++){
      const base=f*PER_FINGER;
      for(let r=0;r<RINGS-1;r++)for(let j=0;j<SIDES;j++){
        const k=(j+1)%SIDES,a=base+r*SIDES+j,b=a+SIDES,c=base+(r+1)*SIDES+k,d=base+r*SIDES+k;
        triangle(a,b,c);triangle(a,c,d);
      }
      for(let j=0;j<SIDES;j++){const k=(j+1)%SIDES;if(!joined)triangle(base+RINGS*SIDES,base+j,base+k);triangle(base+RINGS*SIDES+1,base+(RINGS-1)*SIDES+k,base+(RINGS-1)*SIDES+j);}
    }
    if(surface)topology.push(...surface.indices);
    const bridgeTriangles=surface?surface.sockets.reduce((n,r)=>n+r.length+8,0)+surface.wrist.length+96:0;
    const indices=new Uint16Array(topology.length+bridgeTriangles*3);indices.set(topology);
    return {bow,count,surface,topology,thumb:{points:null,radii:[.009,.007,.007]},positions:new Float64Array(vertices*3),normals:new Float64Array(vertices*3),indices,data:new Float32Array(indices.length*6),directions:new Float64Array(9),lengths:new Float64Array(3)};
  }
  function update(state,hand,board,deform){
    const p=state.positions,n=state.normals,dirs=state.directions,lengths=state.lengths;
    const bow=state.bow;
    if(state.surface&&!bow)state.thumb.points=hand.thumb;
    for(let f=0;f<state.count;f++){
      const rounded=bow||f===4,profile=rounded?bowSections:sections;
      const digit=bow?(f===0?hand.thumb:hand.fingers[f-1]):f===4?state.thumb:hand.fingers[f],points=digit.points,base=f*PER_FINGER;
      for(let s=0;s<3;s++){
        const a=points[s],b=points[s+1],x=b[0]-a[0],y=b[1]-a[1],z=b[2]-a[2],length=Math.hypot(x,y,z)||1;
        lengths[s]=length;dirs[s*3]=x/length;dirs[s*3+1]=y/length;dirs[s*3+2]=z/length;
      }
      // Left-hand FK flexion stays in one plane. Its normal gives every ring a common
      // lateral axis, avoiding a twisting seam at the knuckles.
      let xx=dirs[1]*dirs[5]-dirs[2]*dirs[4],xy=dirs[2]*dirs[3]-dirs[0]*dirs[5],xz=dirs[0]*dirs[4]-dirs[1]*dirs[3];
      let length=Math.hypot(xx,xy,xz);
      if(length<1e-8){xx=hand.basis[0][0];xy=hand.basis[0][1];xz=hand.basis[0][2];length=Math.hypot(xx,xy,xz);}
      const sign=xx*hand.basis[0][0]+xy*hand.basis[0][1]+xz*hand.basis[0][2]<0?-1:1;
      xx*=sign/length;xy*=sign/length;xz*=sign/length;
      for(let r=0;r<RINGS;r++){
        const s=profile[r][0];let t=profile[r][1];
        if(r===RINGS-1)t=rounded?1+digit.radii[2]*Math.SQRT1_2/lengths[2]:1-Math.min(.0018,lengths[2]*.12)/lengths[2];
        if(s===0&&digit.skinBaseT!==undefined)t=digit.skinBaseT+(1-digit.skinBaseT)*t;
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
        let rx=xx,ry=xy,rz=xz;
        if(rounded){const along=rx*tx+ry*ty+rz*tz;rx-=along*tx;ry-=along*ty;rz-=along*tz;const scale=1/(Math.hypot(rx,ry,rz)||1);rx*=scale;ry*=scale;rz*=scale;}
        const zx=ry*tz-rz*ty,zy=rz*tx-rx*tz,zz=rx*ty-ry*tx;
        let centreW=0;
        if(board)centreW=(cx-board.O[0])*board.W[0]+(cy-board.O[1])*board.W[1]+(cz-board.O[2])*board.W[2];
        // Bow contact centres stay inside rounded end pads. Their radius
        // matches the original grip; the left hand keeps its flat string pads.
        const radius=rounded?(s<2?digit.radii[s]+(digit.radii[s+1]-digit.radii[s])*Math.max(0,t):digit.radii[2])*(r===RINGS-1?Math.SQRT1_2:1):0;
        for(let j=0;j<SIDES;j++){
          const c=circle[j*2]*(rounded?radius:widths[r]),d=circle[j*2+1]*(rounded?radius:depths[r]),k=(base+r*SIDES+j)*3;
          let vx=cx+rx*c+zx*d,vy=cy+ry*c+zy*d,vz=cz+rz*c+zz*d;
          // Soft fingertip tissue conforms to the board. The skeleton and
          // its sounding contact point are never moved by the skin update.
          if(board&&!rounded&&r>=9){
            const ox=vx-board.O[0],oy=vy-board.O[1],oz=vz-board.O[2],u=ox*board.U[0]+oy*board.U[1]+oz*board.U[2],v=ox*board.V[0]+oy*board.V[1]+oz*board.V[2];
            if(u>=.058&&u<=.328&&Math.abs(v)<(u<.210?.0225:.0165)&&centreW>=board.top(u)-.0001){
              const w=ox*board.W[0]+oy*board.W[1]+oz*board.W[2],lift=Math.max(0,board.top(u)+.0002-w);
              vx+=board.W[0]*lift;vy+=board.W[1]*lift;vz+=board.W[2]*lift;
            }
          }
          p[k]=vx;p[k+1]=vy;p[k+2]=vz;
        }
      }
      for(let k=0;k<3;k++){p[(base+RINGS*SIDES)*3+k]=points[0][k]-dirs[k]*lengths[0]*.12;p[(base+RINGS*SIDES+1)*3+k]=points[3][k]+(rounded?dirs[6+k]*digit.radii[2]:0);}
    }
    if(state.surface){
      window.HandSurface.update(state.surface,p,hand);
      if(!state.surface.initialized){window.HandSurface.connect(state.surface,state.topology,p);state.indices.set(state.topology);state.surface.initialized=true;}
      window.HandSurface.blendSockets(state.surface,p);
      window.HandSurface.conform(state.surface,p,board);
    }
    if(deform)deform(p,hand);
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

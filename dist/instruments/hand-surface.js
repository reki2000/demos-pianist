'use strict';
// Shared indexed palm, finger sockets and wrist. Build connectivity once; the
// deformation only fills the existing position array before shared normals.
window.HandSurface=(()=>{
  const N=48,ROWS=8,LEFT_SCALE=[.038,.035,.013];
  function create(bow,offset,mirrored=false){
    const points=[[0,0,1]],id=(r,j)=>r===0?0:r===ROWS?1+(ROWS-1)*N:1+(r-1)*N+(j+N)%N;
    for(let r=1;r<ROWS;r++)for(let j=0;j<N;j++){const a=j*2*Math.PI/N,b=r*Math.PI/ROWS;const x=Math.cos(a),y=Math.sin(a);points.push([Math.sin(b)*Math.sign(x)*Math.abs(x)**(2/2.6),Math.sin(b)*Math.sign(y)*Math.abs(y)**(2/2.6),Math.cos(b)]);}
    points.push([0,0,-1]);
    // Thumb, index, middle, ring, little (left stores its thumb last).
    const ports=bow?[[5,3],[3,42],[3,39],[3,34],[3,30]]:[[4,7],[4,10],[4,14],[4,17],[5,2]];
    const holes=new Set(ports.map(([r,j])=>id(r,j))),faces=[];
    const add=(r,j,a,b,c)=>{const wrist=r>=2&&r<6&&j>=(bow?9:32)&&j<(bow?17:40);if(!wrist&&!holes.has(a)&&!holes.has(b)&&!holes.has(c))faces.push([a,b,c]);};
    for(let r=0;r<ROWS;r++)for(let j=0;j<N;j++){
      const a=id(r,j),b=id(r+1,j),c=id(r+1,j+1),d=id(r,j+1);
      if(r!==ROWS-1)add(r,j,a,b,c);if(r!==0)add(r,j,a,c,d);
    }
    if(mirrored)for(const face of faces){const b=face[1];face[1]=face[2];face[2]=b;}
    const edges=new Map();for(const f of faces)for(let k=0;k<3;k++){const a=f[k],b=f[(k+1)%3],key=Math.min(a,b)+':'+Math.max(a,b);if(edges.has(key))edges.delete(key);else edges.set(key,[a,b]);}
    const next=new Map([...edges.values()]),loops=[];
    while(next.size){const start=next.keys().next().value,loop=[];let p=start;do{loop.push(p);const q=next.get(p);if(q===undefined)throw Error('Palm boundary branches');next.delete(p);p=q;}while(p!==start);loops.push(loop);}
    const used=[...new Set(faces.flat())],mapping=new Map(used.map((v,i)=>[v,offset+i]));
    const indices=faces.flatMap(f=>f.map(v=>mapping.get(v))),sockets=[];
    for(const [r,j] of ports){const centre=points[id(r,j)];let best=-1,score=Infinity;
      for(let k=0;k<loops.length;k++){const loop=loops[k];if(loop.length>8)continue;const c=[0,0,0];for(const v of loop)for(let a=0;a<3;a++)c[a]+=points[v][a]/loop.length;const d=c.reduce((s,v,a)=>s+(v-centre[a])**2,0);if(d<score){best=k;score=d;}}
      if(best<0)throw Error('Missing palm socket');sockets.push(loops.splice(best,1)[0].map(v=>mapping.get(v)));
    }
    if(loops.length!==1)throw Error('Missing wrist socket');
    return {bow,offset,mirrored,points:new Float64Array(used.flatMap(v=>points[v])),indices,sockets,wrist:loops[0].map(v=>mapping.get(v)),wristOffset:offset+used.length,vertices:used.length+49,seams:[],initialized:false};
  }
  function stitch(indices,a,b){
    let i=0,j=0;while(i<a.length||j<b.length){const ai=a[i%a.length],bj=b[j%b.length];if(j===b.length||(i<a.length&&(i+1)/a.length<=(j+1)/b.length)){indices.push(ai,bj,a[(i+1)%a.length]);i++;}else{indices.push(ai,bj,b[(j+1)%b.length]);j++;}}
  }
  function connect(surface,indices,positions){
    // Match seam phase once in the first pose, then retain the same edges.
    const rotate=(loop,target)=>{let start=0,best=Infinity;for(let j=0;j<loop.length;j++){const d=[0,1,2].reduce((s,k)=>s+(positions[loop[j]*3+k]-positions[target*3+k])**2,0);if(d<best){best=d;start=j;}}return loop.slice(start).concat(loop.slice(0,start));};
    for(let f=0;f<5;f++){
      const a=rotate(surface.sockets[f],f*98),ring=Array.from({length:8},(_,j)=>surface.wristOffset+9+f*8+j);
      surface.seams.push(a);stitch(indices,a,ring);stitch(indices,ring,Array.from({length:8},(_,j)=>f*98+j));
    }
    // Wrist ring points run in the reverse direction from finger roots.
    const ring=Array.from({length:8},(_,j)=>surface.wristOffset+j);
    stitch(indices,rotate(surface.wrist,ring[0]),ring);
    for(let j=0;j<8;j++)indices.push(surface.wristOffset+8,ring[(j+1)%8],ring[j]);
  }
  function update(surface,p,hand){
    const bow=surface.bow,O=hand.palmPos,B=hand.basis,S=bow?hand.palmScale:LEFT_SCALE;
    for(let i=0;i<surface.points.length;i+=3)for(let k=0;k<3;k++)p[surface.offset*3+i+k]=O[k]+B[0][k]*surface.points[i]*S[0]+B[1][k]*surface.points[i+1]*S[1]+B[2][k]*surface.points[i+2]*S[2];
    // The bow frame is reflected. Keep every palm's exterior winding aligned
    // with its finger tubes by reflecting the local parameterization in Z.
    const parity=(B[0][1]*B[1][2]-B[0][2]*B[1][1])*B[2][0]+(B[0][2]*B[1][0]-B[0][0]*B[1][2])*B[2][1]+(B[0][0]*B[1][1]-B[0][1]*B[1][0])*B[2][2];
    if(parity<0&&!surface.mirrored)for(let i=0;i<surface.points.length;i+=3)for(let k=0;k<3;k++)p[surface.offset*3+i+k]-=2*B[2][k]*surface.points[i+2]*S[2];
    const direction=bow?1:-1;
    for(let j=0;j<8;j++){const a=(j+.5)*2*Math.PI/8;for(let k=0;k<3;k++)p[(surface.wristOffset+j)*3+k]=hand.wrist[k]+B[1][k]*direction*.009+B[0][k]*Math.cos(a)*.021+B[2][k]*Math.sin(a)*.014*(bow?1:-1)*(surface.mirrored?-1:1);}
    for(let k=0;k<3;k++)p[(surface.wristOffset+8)*3+k]=hand.wrist[k]+B[1][k]*direction*.009;
  }
  function blendSockets(surface,p){
    for(let f=0;f<5;f++){const a=surface.seams[f];for(let j=0;j<8;j++){
      const t=j*a.length/8,i=Math.floor(t),w=t-i;
      for(let k=0;k<3;k++)p[(surface.wristOffset+9+f*8+j)*3+k]=.45*((1-w)*p[a[i]*3+k]+w*p[a[(i+1)%a.length]*3+k])+.55*p[(f*98+j)*3+k];
    }}
  }
  // Compress only the soft palm against the actual sloped fingerboard boxes.
  // Contact targets, finger bones and wrist coordinates stay unchanged.
  function conform(surface,p,board){
    if(!board)return;
    const slope=-.0125/.328,den=Math.hypot(1,slope);
    for(let i=surface.offset*3;i<p.length;i+=3)for(let part=0;part<2;part++){
      const lo=part?.210:.058,hi=part?.328:.210,width=part?.0165:.0225,mid=(lo+hi)/2;
      const x=p[i]-board.O[0],y=p[i+1]-board.O[1],z=p[i+2]-board.O[2];
      const u=x*board.U[0]+y*board.U[1]+z*board.U[2]-mid,v=x*board.V[0]+y*board.V[1]+z*board.V[2],w=x*board.W[0]+y*board.W[1]+z*board.W[2]-(board.top(mid)-.0032);
      const q=(u+w*slope)/den,h=(w-u*slope)/den,du=(hi-lo)/2-Math.abs(q),dv=width-Math.abs(v),dw=.0032-Math.abs(h);
      if(du<=0||dv<=0||dw<=0)continue;
      let a=0,b=0,c=0;
      if(dv<=du&&dv<=dw)b=Math.sign(v||1)*(dv+.0002);
      else if(dw<=du){const lift=Math.sign(h||1)*(dw+.0002)/den;a=-slope*lift;c=lift;}
      else {const lift=Math.sign(q||1)*(du+.0002)/den;a=lift;c=slope*lift;}
      for(let k=0;k<3;k++)p[i+k]+=board.U[k]*a+board.V[k]*b+board.W[k]*c;
    }
  }
  return {create,connect,update,blendSockets,conform};
})();

'use strict';
// Shared indexed palm, finger sockets and wrist. Build connectivity once; the
// deformation only fills the existing position array before shared normals.
window.HandSurface=(()=>{
  const N=48,ROWS=8,LEFT_SCALE=[.038,.035,.013];
  function create(bow,offset,mirrored=false,thumbWeb=false){
    const points=[[0,0,1]],id=(r,j)=>r===0?0:r===ROWS?1+(ROWS-1)*N:1+(r-1)*N+(j+N)%N;
    for(let r=1;r<ROWS;r++)for(let j=0;j<N;j++){const a=j*2*Math.PI/N,b=r*Math.PI/ROWS;const x=Math.cos(a),y=Math.sin(a);points.push([Math.sin(b)*Math.sign(x)*Math.abs(x)**(2/2.6),Math.sin(b)*Math.sign(y)*Math.abs(y)**(2/2.6),Math.cos(b)]);}
    points.push([0,0,-1]);
    // Thumb, index, middle, ring, little (left stores its thumb last).
    // Bow meshes are built in their canonical local frame: the thumb exits
    // the palmar/fingerward side, not the opposite side near the wrist.
    const ports=bow?[[5,46],[3,42],[3,39],[3,34],[3,30]]:[[4,7],[4,10],[4,14],[4,17],[5,2]];
    const holes=new Set(ports.map(([r,j])=>id(r,j))),faces=[];
    if(thumbWeb)for(let r=4;r<=6;r++)for(let j=bow?45:-1;j<=(bow?48:4);j++)holes.add(id(r,j));
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
    for(const [f,[r,j]] of ports.entries()){const centre=points[id(r,j)];let best=-1,score=Infinity;
      for(let k=0;k<loops.length;k++){const loop=loops[k];if(loop.length>8&&!(thumbWeb&&f===(bow?0:4)))continue;const c=[0,0,0];for(const v of loop)for(let a=0;a<3;a++)c[a]+=points[v][a]/loop.length;const d=c.reduce((s,v,a)=>s+(v-centre[a])**2,0);if(d<score){best=k;score=d;}}
      if(best<0)throw Error('Missing palm socket');sockets.push(loops.splice(best,1)[0].map(v=>mapping.get(v)));
    }
    if(loops.length!==1)throw Error('Missing wrist socket');
    return {bow,offset,mirrored,thumbWeb,points:new Float64Array(used.flatMap(v=>points[v])),indices,sockets,wrist:loops[0].map(v=>mapping.get(v)),wristOffset:offset+used.length,vertices:used.length+49,seams:[],initialized:false};
  }
  function stitch(indices,a,b){
    let i=0,j=0;while(i<a.length||j<b.length){const ai=a[i%a.length],bj=b[j%b.length];if(j===b.length||(i<a.length&&(i+1)/a.length<=(j+1)/b.length)){indices.push(ai,bj,a[(i+1)%a.length]);i++;}else{indices.push(ai,bj,b[(j+1)%b.length]);j++;}}
  }
  function connect(surface,indices,positions){
    // Match seam phase once in the first pose, then retain the same edges.
    const rotate=(loop,target)=>{let start=0,best=Infinity;for(let j=0;j<loop.length;j++){const d=[0,1,2].reduce((s,k)=>s+(positions[loop[j]*3+k]-positions[target*3+k])**2,0);if(d<best){best=d;start=j;}}return loop.slice(start).concat(loop.slice(0,start));};
    const alignThumb=(loop,base)=>{
      const A=[0,0,0],B=[0,0,0];for(const v of loop)for(let k=0;k<3;k++)A[k]+=positions[v*3+k]/loop.length;
      for(let j=0;j<8;j++)for(let k=0;k<3;k++)B[k]+=positions[(base+j)*3+k]/8;
      let start=0,best=Infinity;
      for(let offset=0;offset<loop.length;offset++){
        let score=0;for(let j=0;j<8;j++){
          const t=j*loop.length/8,i=Math.floor(t),w=t-i;
          const a=[0,1,2].map(k=>(1-w)*positions[loop[(i+offset)%loop.length]*3+k]+w*positions[loop[(i+offset+1)%loop.length]*3+k]-A[k]);
          const b=[0,1,2].map(k=>positions[(base+j)*3+k]-B[k]),na=Math.hypot(...a),nb=Math.hypot(...b);
          score+=a.reduce((n,v,k)=>n+(v/na-b[k]/nb)**2,0);
        }if(score<best){best=score;start=offset;}
      }return loop.slice(start).concat(loop.slice(0,start));
    };
    for(let f=0;f<5;f++){
      const a=surface.thumbWeb&&f===(surface.bow?0:4)?alignThumb(surface.sockets[f],f*98):rotate(surface.sockets[f],f*98),ring=Array.from({length:8},(_,j)=>surface.wristOffset+9+f*8+j);
      surface.seams.push(a);stitch(indices,a,ring);stitch(indices,ring,Array.from({length:8},(_,j)=>f*98+j));
    }
    // Wrist ring points run in the reverse direction from finger roots.
    const ring=Array.from({length:8},(_,j)=>surface.wristOffset+j);
    stitch(indices,rotate(surface.wrist,ring[0]),ring);
    for(let j=0;j<8;j++)indices.push(surface.wristOffset+8,ring[(j+1)%8],ring[j]);
  }
  function update(surface,p,hand){
    const bow=surface.bow,O=hand.palmPos,B=hand.basis,S=hand.palmScale||LEFT_SCALE;
    for(let i=0;i<surface.points.length;i+=3)for(let k=0;k<3;k++)p[surface.offset*3+i+k]=O[k]+B[0][k]*surface.points[i]*S[0]+B[1][k]*surface.points[i+1]*S[1]+B[2][k]*surface.points[i+2]*S[2];
    // A broad thenar sheet grows out of the palm into the metacarpal.
    // It deforms existing connected vertices; no overlaid rod or open patch.
    if(hand.thenarCover&&!surface.thumbWeb){
      const thumb=bow?hand.thumb.points:hand.thumb,seat=thumb[0].map((v,k)=>v+(thumb[1][k]-v)*.90);
      const radial=O.map((v,k)=>v+B[0][k]*S[0]);
      for(let i=0;i<surface.points.length;i+=3){
        const x=surface.points[i],y=surface.points[i+1],weight=Math.max(0,x)**3*Math.max(0,1-.8*Math.abs(y));
        for(let k=0;k<3;k++)p[surface.offset*3+i+k]+=(seat[k]-radial[k])*weight;
      }
    }
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
  const woodBoxes=new WeakMap();
  function conformUnion(p,board,start){
    const slope=-.0125/.328,den=Math.hypot(1,slope);let boxes=woodBoxes.get(board);
    if(!boxes){boxes=[[.058,.210,.0225,.0032,.0032],[.210,.328,.0165,.0032,.0032],[.198,.328,.0115,.008,.0115]].map(([lo,hi,width,depth,offset])=>{const u=(lo+hi)/2,w=board.top(u)-offset;return [(u+w*slope)/den,0,(w-u*slope)/den,(hi-lo)/2,width,depth];});woodBoxes.set(board,boxes);}
    const inside=(q,v,h,b)=>Math.abs(q-b[0])<b[3]&&Math.abs(v)<b[4]&&Math.abs(h-b[2])<b[5];
    for(let i=start;i<p.length;i+=3){
      const x=p[i]-board.O[0],y=p[i+1]-board.O[1],z=p[i+2]-board.O[2],u=x*board.U[0]+y*board.U[1]+z*board.U[2],v=x*board.V[0]+y*board.V[1]+z*board.V[2],w=x*board.W[0]+y*board.W[1]+z*board.W[2],q=(u+w*slope)/den,h=(w-u*slope)/den;
      if(!boxes.some(b=>inside(q,v,h,b)))continue;
      let best=Infinity,axis=0,move=0;
      // Find an external face of the UNION. Projecting overlapping boxes in
      // sequence can trap a vertex between the neck and fingerboard.
      for(const b of boxes)for(let a=0;a<3;a++)for(const sign of [-1,1]){
        const value=b[a]+sign*(b[a+3]+.0002),d=value-(a===0?q:a===1?v:h);if(Math.abs(d)>=best)continue;
        const cq=a===0?value:q,cv=a===1?value:v,ch=a===2?value:h;if(boxes.some(other=>inside(cq,cv,ch,other)))continue;
        best=Math.abs(d);axis=a;move=d;
      }
      for(let k=0;k<3;k++)p[i+k]+=axis===1?board.V[k]*move:axis===0?(board.U[k]+board.W[k]*slope)*move/den:(board.W[k]-board.U[k]*slope)*move/den;
    }
  }
  function conform(surface,p,board,start=surface.offset*3){
    if(!board)return;
    if(board.neck)return conformUnion(p,board,start);
    const slope=-.0125/.328,den=Math.hypot(1,slope);
    for(let i=start;i<p.length;i+=3)for(let part=0;part<(board.neck?3:2);part++){
      const neck=part===2,lo=neck?.198:part?.210:.058,hi=part?.328:.210,width=neck?.0115:part?.0165:.0225,mid=(lo+hi)/2,half=neck?.008:.0032;
      const x=p[i]-board.O[0],y=p[i+1]-board.O[1],z=p[i+2]-board.O[2];
      const u=x*board.U[0]+y*board.U[1]+z*board.U[2]-mid,v=x*board.V[0]+y*board.V[1]+z*board.V[2],w=x*board.W[0]+y*board.W[1]+z*board.W[2]-(board.top(mid)-(neck?.0115:.0032));
      const q=(u+w*slope)/den,h=(w-u*slope)/den,du=(hi-lo)/2-Math.abs(q),dv=width-Math.abs(v),dw=half-Math.abs(h);
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

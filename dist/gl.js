/* Small, dependency-free WebGL renderer for the animated recital. */
window.RecitalGL=(()=>{
const sub=(a,b)=>a.map((v,i)=>v-b[i]),dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],norm=a=>{let l=Math.hypot(...a)||1;return a.map(v=>v/l)};
function multiply(a,b){let c=new Float32Array(16);for(let j=0;j<4;j++)for(let i=0;i<4;i++)for(let k=0;k<4;k++)c[j*4+i]+=a[k*4+i]*b[j*4+k];return c}
function model(p,s,r=0){let c=Math.cos(r),n=Math.sin(r);return new Float32Array([s[0],0,0,0,0,c*s[1],n*s[1],0,0,-n*s[2],c*s[2],0,...p,1])}
function look(eye,at,up=[0,1,0]){let z=norm(sub(eye,at)),x=norm(cross(up,z)),y=cross(z,x);return new Float32Array([x[0],y[0],z[0],0,x[1],y[1],z[1],0,x[2],y[2],z[2],0,-dot(x,eye),-dot(y,eye),-dot(z,eye),1])}
function perspective(aspect){let f=1/Math.tan(.57/2),n=.05,z=80;return new Float32Array([f/aspect,0,0,0,0,f,0,0,0,0,(z+n)/(n-z),-1,0,0,2*z*n/(n-z),0])}
// Planning uses pianist-local +X to the right. WebGL's +Z-facing actor has
// physical right along -X. Convert geometry and cameras here; lighting uses WebGL world coordinates.
const toWorld=p=>[-p[0],p[1],p[2]];
function create(canvas){
const gl=canvas.getContext('webgl',{antialias:true,alpha:false,powerPreference:'high-performance'});if(!gl)throw Error('WebGL is not available in this browser. Please try another browser.');
function shader(kind,src){let s=gl.createShader(kind);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s}
let prog=gl.createProgram();gl.attachShader(prog,shader(gl.VERTEX_SHADER,`attribute vec3 aP;attribute vec3 aN;uniform mat4 uM,uVP;uniform mat3 uN;varying vec3 vP,vN;void main(){vec4 p=uM*vec4(aP,1.);vP=p.xyz;vN=normalize(uN*aN);gl_Position=uVP*p;}`));
gl.attachShader(prog,shader(gl.FRAGMENT_SHADER,`precision mediump float;uniform vec3 uC,uEye;uniform float uMetal;varying vec3 vP,vN;void main(){vec3 N=normalize(vN);vec3 L=normalize(vec3(1.5,5.,-1.)-vP);vec3 V=normalize(uEye-vP);float diffuse=max((dot(N,L)+.25)/1.25,0.);float rim=pow(1.-max(dot(N,V),0.),3.);float spec=pow(max(dot(N,normalize(L+V)),0.),mix(20.,100.,uMetal));float spot=max(.2,1.-length(vP.xz)*.115);float fill=max(dot(N,normalize(vec3(-2.,3.,3.)-vP)),0.);vec3 c=uC*(vec3(.40)+diffuse*.72*vec3(1.,.91,.78)+fill*.25*vec3(.75,.84,1.))*spot; c+=vec3(.9,.76,.5)*spec*(.1+uMetal*.65);c+=vec3(.30,.37,.50)*rim*.38;float fog=clamp(length(vP-uEye)/25.,0.,.6);gl_FragColor=vec4(pow(mix(c,vec3(.027,.031,.041),fog),vec3(.82)),1.);}`));gl.linkProgram(prog);if(!gl.getProgramParameter(prog,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(prog));gl.useProgram(prog);
let attrs=['aP','aN'].map(n=>gl.getAttribLocation(prog,n)),u={};for(let n of ['uM','uVP','uN','uC','uEye','uMetal'])u[n]=gl.getUniformLocation(prog,n);
function mesh(data){let b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(data),gl.STATIC_DRAW);return{b,count:data.length/6}}
let cube=[];for(let [n,verts] of [[[0,0,1],[[-.5,-.5,.5],[.5,-.5,.5],[.5,.5,.5],[-.5,.5,.5]]],[[0,0,-1],[[.5,-.5,-.5],[-.5,-.5,-.5],[-.5,.5,-.5],[.5,.5,-.5]]],[[1,0,0],[[.5,-.5,.5],[.5,-.5,-.5],[.5,.5,-.5],[.5,.5,.5]]],[[-1,0,0],[[-.5,-.5,-.5],[-.5,-.5,.5],[-.5,.5,.5],[-.5,.5,-.5]]],[[0,1,0],[[-.5,.5,.5],[.5,.5,.5],[.5,.5,-.5],[-.5,.5,-.5]]],[[0,-1,0],[[-.5,-.5,-.5],[.5,-.5,-.5],[.5,-.5,.5],[-.5,-.5,.5]]]])for(let i of [0,1,2,0,2,3])cube.push(...verts[i],...n);
let sphere=[];const uv=(a,b)=>[Math.sin(a)*Math.cos(b),Math.cos(a),Math.sin(a)*Math.sin(b)];for(let i=0;i<14;i++)for(let j=0;j<20;j++){let a=i*Math.PI/14,b=j*Math.PI*2/20,da=Math.PI/14,db=Math.PI*2/20;let ps=[uv(a,b),uv(a+da,b),uv(a+da,b+db),uv(a,b+db)];for(let k of [0,1,2,0,2,3])sphere.push(...ps[k],...ps[k])}
function loft(sections,sides=20){let data=[],n=sections.length;
// Rings are elliptical sections [y,rx,rz,dz]; vertex normals are averaged so curved parts shade smoothly.
const se=(v,e)=>Math.sign(v)*Math.abs(v)**(2/e);
let rings=sections.map(([y,rx,rz,dz=0,e=2])=>Array.from({length:sides},(_,j)=>{let a=(j+.5)*Math.PI*2/sides;return[se(Math.cos(a),e)*rx,y,se(Math.sin(a),e)*rz+dz]}));
let normals=rings.map(r=>r.map(()=>[0,0,0])),add=(i,j,v)=>{let q=normals[i][j];for(let k=0;k<3;k++)q[k]+=v[k]};
for(let i=0;i<n-1;i++)for(let j=0;j<sides;j++){let k=(j+1)%sides,a=rings[i][j],b=rings[i+1][j],c=rings[i+1][k],d=rings[i][k],f=cross(sub(b,a),sub(c,a)),g=cross(sub(c,a),sub(d,a));for(let [x,y] of [[i,j],[i+1,j],[i+1,k]])add(x,y,f);for(let [x,y] of [[i,j],[i+1,k],[i,k]])add(x,y,g)}
normals=normals.map(r=>r.map(norm));
const vertex=(i,j)=>data.push(...rings[i][j],...normals[i][j]),flat=(a,b,c,m)=>{for(let p of [a,b,c])data.push(...p,...m)};
for(let i=0;i<n-1;i++)for(let j=0;j<sides;j++){let k=(j+1)%sides;vertex(i,j);vertex(i+1,j);vertex(i+1,k);vertex(i,j);vertex(i+1,k);vertex(i,k)}
for(let j=0;j<sides;j++){let k=(j+1)%sides,c0=[0,sections[0][0],sections[0][3]||0],c1=[0,sections.at(-1)[0],sections.at(-1)[3]||0];flat(c0,rings[0][k],rings[0][j],[0,-1,0]);flat(c1,rings.at(-1)[j],rings.at(-1)[k],[0,1,0])}return data}
// Loft along local Z instead of Y (for shoes): swap the Y and Z of positions and normals.
const alongZ=data=>{let out=data.slice();for(let i=0;i<out.length;i+=3){let y=out[i+1];out[i+1]=out[i+2];out[i+2]=y}return out};
let shapes={box:mesh(cube),sphere:mesh(sphere),
torso:mesh(loft([[-1,.70,.80],[-.78,.86,.92],[-.3,.97,1],[.4,1,.98],[.8,.9,.86],[1,.55,.6]])),
jacket:mesh(loft([[-1,.74,.82],[-.62,.70,.80],[-.15,.80,.88],[.38,.95,.94],[.68,1,.88],[.86,.82,.70],[.96,.5,.5],[1,.3,.36]])),
head:mesh(loft([[-1,.18,.2,.16],[-.92,.42,.45,.13],[-.74,.6,.66,.08],[-.48,.76,.84,.03],[-.15,.88,.95,0],[.2,.95,1,-.02],[.52,.93,.98,-.05],[.78,.8,.85,-.07],[.93,.55,.6,-.08],[1,.2,.24,-.08]],24)),
hair:mesh(loft([[-.45,.8,.6,-.42],[-.2,.95,.8,-.28],[.12,1.0,.88,-.17],[.4,1.0,.9,-.13],[.64,.96,1.02,-.05],[.86,.76,.82,-.06],[.98,.46,.52,-.07],[1.03,.1,.12,-.07]],24)),
palm:mesh(loft([[-1,.4,.5,0,2.6],[-.6,.85,.9,0,2.6],[.3,1,1,0,2.6],[.8,.9,.92,0,2.6],[1,.5,.55,0,2.6]])),
shoe:mesh(alongZ(loft([[-1,.55,.55,-.05],[-.82,.78,.92,0],[-.25,.82,1,0],[.35,.86,.78,-.18],[.75,.66,.52,-.3],[1,.22,.22,-.36]],16))),
limb:mesh(loft([[-1.04,.25,.25],[-1,.62,.62],[-.9,.9,.9],[-.7,1,1],[.7,1,1],[.9,.9,.9],[1,.62,.62],[1.04,.25,.25]])),
joint:mesh(loft([[-1,.35,.35],[-.8,.75,.75],[-.4,.96,.96],[.4,.96,.96],[.8,.75,.75],[1,.35,.35]])),
nose:mesh(loft([[-1,.62,.55,.25],[-.7,1,.95,.35],[-.2,.72,.7,.18],[.4,.5,.5,.05],[1,.38,.4,0]],12)),
tail:mesh(loft([[-1,.5,.1],[-.6,.92,.13],[.4,1,.14],[1,.8,.12]],12)),
cushion:mesh(loft([[-1,.9,.88,0,5],[-.55,1,1,0,5],[.45,1,1,0,5],[.85,.96,.94,0,5],[1,.84,.8,0,5]],32))};
function draw(shape,m,c,metal=0){m=new Float32Array(m);for(let i of [0,4,8,12])m[i]=-m[i];let normal=new Float32Array(9);for(let j=0;j<3;j++){let k=j*4,n=m[k]*m[k]+m[k+1]*m[k+1]+m[k+2]*m[k+2];for(let i=0;i<3;i++)normal[j*3+i]=m[k+i]/Math.max(n,1e-12)}gl.uniformMatrix3fv(u.uN,false,normal);let me=shapes[shape];gl.bindBuffer(gl.ARRAY_BUFFER,me.b);for(let i=0;i<2;i++){gl.enableVertexAttribArray(attrs[i]);gl.vertexAttribPointer(attrs[i],3,gl.FLOAT,false,24,i*12)}gl.uniformMatrix4fv(u.uM,false,m);gl.uniform3fv(u.uC,c);gl.uniform1f(u.uMetal,metal);gl.drawArrays(gl.TRIANGLES,0,me.count)}
function box(p,s,c,metal=0,r=0){draw('box',model(p,s,r),c,metal)}
function ball(p,s,c,metal=0,r=0){draw('sphere',model(p,s,r),c,metal)}
function piece(shape,p,s,c,rx=0,ry=0,rz=0){let m=model(p,s,rx);if(ry){let cy=Math.cos(ry),sy=Math.sin(ry);for(let i=0;i<3;i++){let x=m[i*4],z=m[i*4+2];m[i*4]=x*cy+z*sy;m[i*4+2]=z*cy-x*sy}}if(rz){let c=Math.cos(rz),s=Math.sin(rz);for(let j=0;j<3;j++){let k=j*4,x=m[k],y=m[k+1];m[k]=x*c-y*s;m[k+1]=x*s+y*c}}draw(shape,m,c,0)}
function segment(a,b,r,c,shape='limb'){let d=sub(b,a),l=Math.hypot(...d),y=norm(d),x=norm(cross(Math.abs(y[2])>.9?[1,0,0]:[0,0,1],y)),z=cross(x,y),mid=a.map((v,i)=>(v+b[i])/2);let m=new Float32Array([...x.map(v=>v*r),0,...y.map(v=>v*l/2),0,...z.map(v=>v*r),0,...mid,1]);draw(shape,m,c)}
function bone(a,b,r,c){let d=sub(b,a),l=Math.hypot(...d),y=norm(d),x=norm(cross(Math.abs(y[2])>.9?[1,0,0]:[0,0,1],y)),z=cross(x,y),mid=a.map((v,i)=>(v+b[i])/2);let m=new Float32Array([...x.map(v=>v*r),0,...y.map(v=>v*l/2),0,...z.map(v=>v*r),0,...mid,1]);draw('sphere',m,c)}
let vp;function project(p){p=toWorld(p);if(!vp)return null;let q=[...p,1],v=[0,0,0,0];for(let i=0;i<4;i++)for(let k=0;k<4;k++)v[i]+=vp[k*4+i]*q[k];return{x:(v[0]/v[3]+1)/2,y:(1-v[1]/v[3])/2,visible:v[3]>0&&Math.abs(v[0]/v[3])<.95&&Math.abs(v[1]/v[3])<.95}}
function begin(eye,at,up=[0,1,0]){eye=toWorld(eye);at=toWorld(at);up=toWorld(up);let dpr=Math.min(devicePixelRatio||1,1.8),w=Math.round(canvas.clientWidth*dpr),h=Math.round(canvas.clientHeight*dpr);if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h}gl.viewport(0,0,w,h);gl.clearColor(.028,.032,.04,1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.enable(gl.DEPTH_TEST);gl.uniformMatrix4fv(u.uVP,false,(vp=multiply(perspective(w/h),look(eye,at,up))));gl.uniform3fv(u.uEye,eye)}
return{box,ball,bone,piece,segment,begin,project,gl};}
return{create,toWorld,look,perspective,multiply};})();

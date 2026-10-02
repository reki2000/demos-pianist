import os,ctypes as C,json,sys,numpy as np
from PIL import Image
os.environ['LIBGL_ALWAYS_SOFTWARE']='1';os.environ['EGL_PLATFORM']='surfaceless';os.environ['MESA_SHADER_CACHE_DIR']='/tmp/piano-mesa-cache'
e=C.CDLL('libEGL.so.1');e.eglGetProcAddress.restype=C.c_void_p;e.eglGetProcAddress.argtypes=[C.c_char_p]
def fn(n,r,args):return C.CFUNCTYPE(r,*args)(e.eglGetProcAddress(n.encode()))
get=fn('eglGetPlatformDisplayEXT',C.c_void_p,[C.c_uint,C.c_void_p,C.POINTER(C.c_int)]);d=get(0x31DD,None,None)
e.eglInitialize.argtypes=[C.c_void_p,C.POINTER(C.c_int),C.POINTER(C.c_int)];assert e.eglInitialize(d,C.byref(C.c_int()),C.byref(C.c_int()))
e.eglBindAPI.argtypes=[C.c_uint];assert e.eglBindAPI(0x30A0)
cfg=C.c_void_p();n=C.c_int();e.eglChooseConfig.argtypes=[C.c_void_p,C.POINTER(C.c_int),C.POINTER(C.c_void_p),C.c_int,C.POINTER(C.c_int)];assert e.eglChooseConfig(d,(C.c_int*13)(0x3024,8,0x3023,8,0x3022,8,0x3025,24,0x3033,1,0x3040,4,0x3038),C.byref(cfg),1,C.byref(n)) and n.value
j=json.load(open(sys.argv[1]));w,h=j['width'],j['height'];e.eglCreateContext.restype=C.c_void_p;e.eglCreateContext.argtypes=[C.c_void_p,C.c_void_p,C.c_void_p,C.POINTER(C.c_int)];ctx=e.eglCreateContext(d,cfg,None,(C.c_int*3)(0x3098,2,0x3038));e.eglCreatePbufferSurface.restype=C.c_void_p;e.eglCreatePbufferSurface.argtypes=[C.c_void_p,C.c_void_p,C.POINTER(C.c_int)];surf=e.eglCreatePbufferSurface(d,cfg,(C.c_int*5)(0x3057,w,0x3056,h,0x3038));e.eglMakeCurrent.argtypes=[C.c_void_p,C.c_void_p,C.c_void_p,C.c_void_p];assert e.eglMakeCurrent(d,surf,surf,ctx)
U=C.c_uint;I=C.c_int;F=C.c_float;V=C.c_void_p;IP=C.POINTER(I);UP=C.POINTER(U);FP=C.POINTER(F)
CreateShader=fn('glCreateShader',U,[U]);ShaderSource=fn('glShaderSource',None,[U,I,C.POINTER(C.c_char_p),IP]);CompileShader=fn('glCompileShader',None,[U]);GetShaderiv=fn('glGetShaderiv',None,[U,U,IP]);GetShaderInfoLog=fn('glGetShaderInfoLog',None,[U,I,IP,C.c_void_p]);CreateProgram=fn('glCreateProgram',U,[]);AttachShader=fn('glAttachShader',None,[U,U]);LinkProgram=fn('glLinkProgram',None,[U]);GetProgramiv=fn('glGetProgramiv',None,[U,U,IP]);UseProgram=fn('glUseProgram',None,[U]);prog=CreateProgram()
for sh in j['shaders']:
 s=CreateShader(sh['kind']);source=C.c_char_p(sh['source'].encode());ShaderSource(s,1,C.byref(source),None);CompileShader(s);ok=I();GetShaderiv(s,0x8B81,C.byref(ok))
 if not ok.value:
  log=C.create_string_buffer(4096);GetShaderInfoLog(s,4096,None,log);raise RuntimeError(log.value.decode())
 AttachShader(prog,s)
LinkProgram(prog);ok=I();GetProgramiv(prog,0x8B82,C.byref(ok));assert ok.value,'Shader link failed';UseProgram(prog)
GenBuffers=fn('glGenBuffers',None,[I,UP]);BindBuffer=fn('glBindBuffer',None,[U,U]);BufferData=fn('glBufferData',None,[U,C.c_ssize_t,V,U]);buffers=[]
for mesh in j['meshes']:
 b=U();GenBuffers(1,C.byref(b));BindBuffer(0x8892,b);a=np.array(mesh,dtype=np.float32);BufferData(0x8892,a.nbytes,a.ctypes.data,0x88E4);buffers.append(b)
GetUniformLocation=fn('glGetUniformLocation',I,[U,C.c_char_p]);GetAttribLocation=fn('glGetAttribLocation',I,[U,C.c_char_p]);locations={k:GetUniformLocation(prog,k.encode()) for k in ['uM','uVP','uN','uC','uEye','uMetal']};attrs=[GetAttribLocation(prog,k.encode()) for k in ['aP','aN']]
M4=fn('glUniformMatrix4fv',None,[I,I,C.c_ubyte,FP]);M3=fn('glUniformMatrix3fv',None,[I,I,C.c_ubyte,FP]);V3=fn('glUniform3fv',None,[I,I,FP]);V1=fn('glUniform1f',None,[I,F]);EnableAttrib=fn('glEnableVertexAttribArray',None,[U]);Attrib=fn('glVertexAttribPointer',None,[U,I,U,C.c_ubyte,I,V]);Draw=fn('glDrawArrays',None,[U,I,I]);Viewport=fn('glViewport',None,[I,I,I,I]);Enable=fn('glEnable',None,[U]);ClearColor=fn('glClearColor',None,[F,F,F,F]);Clear=fn('glClear',None,[U]);Viewport(0,0,w,h);Enable(0x0B71);ClearColor(.028,.032,.04,1);Clear(0x4000|0x0100)
for draw in j['draws']:
 BindBuffer(0x8892,buffers[draw['mesh']]);
 for i,a in enumerate(attrs):EnableAttrib(a);Attrib(a,3,0x1406,0,24,V(i*12))
 for k in ['uM','uVP','uN','uC','uEye']:
  data=(F*len(draw[k]))(*draw[k]);func=M3 if k=='uN' else M4 if k in ['uM','uVP'] else V3
  if func in [M3,M4]:func(locations[k],1,0,data)
  else:func(locations[k],1,data)
 V1(locations['uMetal'],draw['uMetal']);Draw(4,0,draw['count'])
Finish=fn('glFinish',None,[]);Finish();Read=fn('glReadPixels',None,[I,I,I,I,U,U,V]);pixels=np.empty((h,w,4),dtype=np.uint8);Read(0,0,w,h,0x1908,0x1401,pixels.ctypes.data);err=fn('glGetError',U,[])();assert err==0,hex(err);out=sys.argv[2];Image.fromarray(pixels[::-1]).save(out);print('Rendered',len(j['draws']),'WebGL draw calls to',out)

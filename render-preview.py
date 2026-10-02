from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import subprocess,sys,os
from PIL import Image
files=list(Path('render-check').glob('*-motion-*.json'));assert len(files)==48
def render(p):
 result=subprocess.run([sys.executable,'render-egl.py',str(p),str(p.with_suffix('.png'))],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,env={**os.environ,'LP_NUM_THREADS':'2'})
 if result.returncode:raise RuntimeError(result.stderr)
 return p
with ThreadPoolExecutor(max_workers=4) as pool:list(pool.map(render,files))
for mode in ['hands','portrait']:
 images=[]
 for p in sorted(Path('render-check').glob(mode+'-motion-*.png')):
  im=Image.open(p).convert('RGB');im.thumbnail((960,467));images.append(im.convert('P',palette=Image.Palette.ADAPTIVE,colors=128))
 images[0].save('render-check/'+mode+'-motion.gif',save_all=True,append_images=images[1:],duration=83,loop=0,optimize=True)
print('Rendered 48 frames and saved hands/portrait motion GIFs.')

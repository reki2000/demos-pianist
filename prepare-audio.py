from pathlib import Path
import json,re,subprocess,hashlib
import numpy as np
from concurrent.futures import ThreadPoolExecutor,as_completed
root=Path(__file__).parent
items=json.loads((root/'audio-source/downloads.json').read_text())
layers=json.loads((root/'audio-source/layers.json').read_text())

def convert(item):
 src=root/'audio-source'/item['file']; dst=root/'dist/audio'/Path(item['file']).with_suffix('.mp3').name
 p=subprocess.run(['ffmpeg','-v','error','-i',str(src),'-ar','44100','-ac','2','-f','f32le','-'],capture_output=True,check=True)
 x=np.frombuffer(p.stdout,dtype='<f4').reshape(-1,2).copy(); sr=44100
 power=np.mean(x*x,axis=1); window=max(1,int(sr*.002)); rms=np.sqrt(np.convolve(power,np.ones(window)/window,mode='same'))
 reference=float(np.max(rms[:min(len(rms),sr)])); hit=np.flatnonzero(rms>max(reference*.018,1e-7)); first=max(0,int(hit[0])-int(sr*.0015)) if len(hit) else 0
 x=x[first:]; mechanical=item['file'].endswith('.flac'); cap=.48 if item['file'].startswith('rel') else .72 if mechanical else 12
 x=x[:int(sr*cap)]; peak=float(np.max(np.abs(x))); target=.28 if mechanical else .55
 if peak<1e-7:raise ValueError('Silent sample '+str(src))
 x*=target/peak; fadeIn=min(len(x),int(sr*.0007)); x[:fadeIn]*=np.linspace(0,1,fadeIn)[:,None]; fadeOut=min(len(x)//3,int(sr*(.045 if mechanical else .10))); x[-fadeOut:]*=np.linspace(1,0,fadeOut)[:,None]
 subprocess.run(['ffmpeg','-v','error','-y','-f','f32le','-ar',str(sr),'-ac','2','-i','-','-codec:a','libmp3lame','-q:a','2',str(dst)],input=x.astype('<f4').tobytes(),check=True)
 decoded=subprocess.run(['ffmpeg','-v','error','-i',str(dst),'-ar',str(sr),'-ac','2','-f','f32le','-'],capture_output=True,check=True); y=np.frombuffer(decoded.stdout,dtype='<f4').reshape(-1,2)
 return item['source'],{'id':dst.stem,'path':'audio/'+dst.name,'duration':len(y)/sr,'sampleRate':sr,'channels':2,'peak':float(np.max(np.abs(y))),'bytes':dst.stat().st_size,'sha256':hashlib.sha256(dst.read_bytes()).hexdigest(),'source':item['source'],'sourceRepository':item['repo'],'onsetTrimSeconds':first/sr}

assets={}
with ThreadPoolExecutor(max_workers=4) as pool:
 for future in as_completed([pool.submit(convert,i) for i in items]):
  path,asset=future.result();assets[path]=asset
manifest={'version':1,'name':'Splendid Grand Piano · Steinway','recordedVelocityLayers':4,'layers':[],'assets':{}}
for layer in layers:
 entries=[]
 for s in layer['samples']:
  a=assets[s['source']];manifest['assets'][a['id']]=a;entries.append({'root':s['pitch'],'id':a['id']})
 manifest['layers'].append({'id':layer['id'],'center':layer['center'],'samples':entries})
manifest['mechanical']={'pedalDown':[],'pedalUp':[],'keyRelease':[]}
for item in items:
 if not item['file'].endswith('.flac'):continue
 a=assets[item['source']];manifest['assets'][a['id']]=a
 key='pedalDown' if a['id'].startswith('pedalD') else 'pedalUp' if a['id'].startswith('pedalU') else 'keyRelease';manifest['mechanical'][key].append(a['id'])
(root/'dist/audio-manifest.js').write_text('window.PIANO_AUDIO_MANIFEST='+json.dumps(manifest,separators=(',',':'))+';\n')
(root/'audio-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps({'assets':len(manifest['assets']),'bytes':sum(a['bytes'] for a in manifest['assets'].values()),'recordedLayers':4,'maxPeak':max(a['peak'] for a in manifest['assets'].values())}))

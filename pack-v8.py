from pathlib import Path
import re,json,zipfile,shutil,base64,hashlib,subprocess

root=Path(__file__).parent
manifest=json.loads((root/'audio-manifest.json').read_text())
encoded={}
for id,asset in manifest['assets'].items():
 data=(root/'dist'/asset['path']).read_bytes()
 assert len(data)==asset['bytes']
 assert hashlib.sha256(data).hexdigest()==asset['sha256']
 encoded[id]=base64.b64encode(data).decode('ascii')

page=(root/'dist/index.html').read_text()
page=page.replace('<link rel="stylesheet" href="style.css">','<style>'+(root/'dist/style.css').read_text()+'</style>')
def inline(match):
 name=match[1]
 before='<script>window.PIANO_AUDIO_DATA='+json.dumps(encoded,separators=(',',':'))+';</script>' if name=='audio-manifest.js' else ''
 source=(root/'dist'/name).read_text().replace('</script','<\\/script')
 return before+'<script>'+source+'</script>'
script_tags=len(re.findall(r'<script src=',page))
page=re.sub(r'<script src="([\w./-]+\.js)"></script>',inline,page)
assert not re.search(r'<script src=|href="style.css"',page)
assert page.count('<script>')==script_tags+1
html=root/'piano-recital-v8.html'
html.write_text(page)

reports={name:json.loads((root/file).read_text()) for name,file in [
 ('integration','verification.json'),('pianoHands','piano-hand-verification.json'),('sampleEngine','audio-verification.json'),
 ('violinLeftHand','violin-left-hand-verification.json'),('violinSkin','violin-skin-verification.json'),('bowSkin','bow-skin-verification.json'),('handSurface','hand-surface-verification.json'),
 ('guitarFingerClearance','docs/verification/guitar-finger-clearance/clearance.json'),
 ('guitarHands','docs/verification/guitar-hands/verification.json'),('guitarSkin','docs/verification/guitar-hands/skin.json'),('guitarGeometry','docs/verification/guitar-hands/geometry.json'),('guitarContinuity','docs/verification/guitar-hands/continuity.json'),
 ('nativeListeningPreview','audio-render-verification.json')] if (root/file).is_file()}
reports.update(version=8,recordedInstrument=manifest['name'],recordedVelocityLayers=4,
 audioAssets=len(encoded),audioBytes=sum(a['bytes'] for a in manifest['assets'].values()),
 performanceNotesAndFingeringPreservedFromV7=False,sourcePitchesAndFingeringsPreserved=False,pianoSourcePitchesAndFingeringsPreserved=True,
 guitarSourceNotesPreserved=True,guitarFingeringsRegenerated=True,compactHandRolledChords=True,
 motionAndScoreUnchangedFromV7=False,characterMesh='smooth-tailcoat',standaloneHTMLBytes=html.stat().st_size,inlineScripts=script_tags+1,requiresRuntimeNetwork=False,
 browserUIAndAuditoryCheck=False)
camera_report=root/'docs/verification/mobile-camera/gestures.json'
if camera_report.is_file():reports['cameraGestures']=json.loads(camera_report.read_text())
reports['standaloneValidation']=json.loads(subprocess.check_output(['node','validate-v8.cjs'],cwd=root,text=True))
(root/'v8-verification.json').write_text(json.dumps(reports,ensure_ascii=False,indent=2)+'\n')
files=[html,root/'README.md',root/'AUDIO-NOTES.md',root/'FINGERING-NOTES.md',
 root/'v8-verification.json',root/'audio-manifest.json',
 root/'audio-verification.json',root/'audio-render-verification.json',root/'verification.json',
 root/'violin-left-hand-verification.json',root/'violin-skin-verification.json',root/'bow-skin-verification.json',root/'hand-surface-verification.json',root/'audio-lifecycle-patches.json',root/'geometry-patches.json',root/'geometry-baseline.json',
 root/'precompute-guitar-hands.cjs',root/'precompute-guitar-plans.cjs',root/'refine-guitar-clearance.cjs',root/'guitar-clearance.cjs',root/'guitar-note-hashes.json',root/'precompute-violin-hand.cjs',root/'precompute-violin-orientation.cjs',root/'pack-v8.py',root/'prepare-audio.py',root/'render-audio-preview.py',
 root/'piano-audio-preview-v8.mp3',root/'verify.cjs',root/'validate-v8.cjs',root/'v6-note-hashes.json',root/'piano-performance-hashes.json',root/'piano-hand-template.json',root/'precompute-piano-hands.cjs',root/'piano-hand-verification.json',
 root/'convert.py',root/'replan.cjs',root/'hanging-replan.cjs',*root.glob('raw-*.b64'),
 root/'add-songs.cjs',root/'arrangements.cjs',root/'midi.cjs',*root.glob('mutopia-sources/*.ly'),
 root/'capture-scene.cjs',root/'render-egl.py',root/'render-preview.py',
 root/'render-check/hands.json',root/'render-check/hands-motion.gif',root/'render-check/portrait-motion.gif',
 *root.glob('*test.cjs'),*(root/'docs/verification/guitar-hands').glob('*'),*(root/'docs/verification/guitar-finger-clearance').glob('*'),*(root/'docs/verification/violin-left-hand').glob('*'),*(root/'docs/verification/violin-left-orientation').glob('*'),*(root/'docs/verification/violin-skin').glob('*'),*(root/'docs/verification/bow-skin').glob('*'),*(root/'docs/verification/hand-joins').glob('*'),*(root/'docs/verification/piano-hands').glob('*'),*(root/'dist').rglob('*'),*(root/'audio-licenses').glob('*'),
 root/'audio-source/downloads.json',root/'audio-source/layers.json',root/'THIRD-PARTY-NOTICES.md']
files.extend((root/'docs/verification/mobile-camera').glob('*'))
archive=root/'piano-recital-v8.zip'
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
 for p in files:
  if p.is_file():z.write(p,p.relative_to(root))
with zipfile.ZipFile(archive) as z:assert z.testzip() is None
shutil.copyfile(html,root/'piano-recital.html')
shutil.copyfile(archive,root/'piano-recital.zip')
print(json.dumps({'htmlBytes':html.stat().st_size,'zipBytes':archive.stat().st_size,
                 'audioAssets':len(encoded),'inlineScripts':script_tags+1,'report':'v8-verification.json'}))

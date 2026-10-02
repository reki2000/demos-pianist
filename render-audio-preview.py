"""Native listening preview from the actual JS sample schedule.

The schedule, recorded samples, gain envelopes and convolution impulses come
from audio.js via audio-test.cjs. Native filters and the dynamics approximation
are not a browser's Web Audio implementation; this is not a browser test.
"""
from pathlib import Path
import json, subprocess, hashlib, math
import numpy as np
from scipy.signal import fftconvolve, butter, sosfilt
from scipy.ndimage import maximum_filter1d
from scipy.io.wavfile import write

root = Path(__file__).parent
fixture = json.loads((root/'audio-render-fixture.json').read_text())
manifest = json.loads((root/'audio-manifest.json').read_text())
sr = fixture['sampleRate']
seconds = 22
length = seconds*sr
nodes = {n['id']: n for n in fixture['nodes']}
starts, stops = {}, {}
for e in fixture['events']:
    (starts if e['kind']=='start' else stops)[e['id']] = e['t']

def decode(path):
    raw = subprocess.check_output(['ffmpeg','-v','error','-i',str(path),'-f','f32le','-ac','2','-ar',str(sr),'-'])
    return np.frombuffer(raw, dtype='<f4').reshape(-1,2)

# Decode every delivered asset and check its identity, channels and bounds.
cache = {}
decoded_seconds = 0
peak = 0
for id, asset in manifest['assets'].items():
    path = root/'dist'/asset['path']
    assert hashlib.sha256(path.read_bytes()).hexdigest() == asset['sha256']
    a = decode(path)
    assert a.shape[1] == 2 and np.isfinite(a).all() and len(a)>0
    assert abs(len(a)/sr-asset['duration']) < .002
    p = float(np.abs(a).max())
    assert p < 1
    peak = max(peak,p)
    decoded_seconds += len(a)/sr
    cache[id] = a

def automation(param, times):
    result = np.full(times.shape, param['value'], dtype=np.float64)
    previous_t, previous_v = 0, param['value']
    # Stable sorting preserves same-time set/ramp precedence.
    for e in sorted(param['events'], key=lambda e:e['t']):
        t, value = e['t'], e['v']
        if e['kind'] in ('linear','exponential') and t>previous_t:
            mask = (times>=previous_t)&(times<t)
            u = (times[mask]-previous_t)/(t-previous_t)
            if e['kind']=='linear':
                result[mask] = previous_v+(value-previous_v)*u
            else:
                result[mask] = max(previous_v,1e-7)*(max(value,1e-7)/max(previous_v,1e-7))**u
        result[times>=t] = value
        previous_t,previous_v = t,value
    return result

# Shared buses in the emitted graph; each sample travels through its real
# layer weight and per-strike envelope before reaching these three buses.
assert nodes[1]['connections']==[4] and nodes[6]['type']=='lowpass'
assert nodes[9]['connections']==[8] and nodes[8]['type']=='convolver'
buses = {i: np.zeros((length,2),np.float32) for i in (1,6,9)}
rendered = 0
for source in nodes.values():
    if source['type']!='source' or source['id'] not in starts:
        continue
    start = starts[source['id']]
    if start>=seconds:
        continue
    recording = cache[source['buffer']['id']]
    rate = source['playbackRate']['value']
    first = max(0,round(start*sr))
    end = min(length,round(stops[source['id']]*sr),first+int(len(recording)/rate))
    if end<=first:
        continue
    indices = np.arange(end-first)*rate
    sample = np.column_stack([np.interp(indices,np.arange(len(recording)),recording[:,ch]) for ch in (0,1)])
    times = np.arange(first,end)/sr
    def route(id, signal):
        if id in buses:
            buses[id][first:end] += signal
            return
        n = nodes[id]
        assert n['type']=='gain'
        signal = signal*automation(n['gain'],times)[:,None]
        for target in n['connections']:
            route(target,signal)
    for target in source['connections']:
        route(target,sample)
    rendered += 1

times = np.arange(length)/sr
def gain(id,a):
    return a*automation(nodes[id]['gain'],times)[:,None]
def filt(id,a):
    n = nodes[id]
    return sosfilt(butter(2,n['frequency']['value'],btype=n['type'],fs=sr,output='sos'),a,axis=0)
def convolve(id,a):
    impulse = np.asarray(nodes[id]['buffer']['channels'],np.float32).T
    return np.column_stack([fftconvolve(a[:,ch],impulse[:,ch])[:length] for ch in (0,1)])

dry = gain(1,buses[1])
room = gain(7,convolve(5,filt(6,buses[6])))
resonance = gain(10,filt(11,convolve(8,gain(9,buses[9]))))
mix = gain(2,gain(4,dry+room+resonance))
assert np.isfinite(mix).all()
pre_peak = float(np.abs(mix).max())
# Approximate stereo linked look-ahead dynamics with the engine's threshold,
# ratio and release. This does not assert Web Audio compressor equivalence.
lookahead = round(fixture['latency']*sr)
detector = maximum_filter1d(np.abs(mix).max(axis=1),size=lookahead*2+1,mode='nearest')
threshold = 10**(nodes[3]['threshold']['value']/20)
ratio = nodes[3]['ratio']['value']
target_gain = np.minimum(1,(threshold/np.maximum(detector,1e-9))**(1-1/ratio))
release = math.exp(-1/(sr*nodes[3]['release']['value']))
last = 1
for i in range(length):
    last = min(target_gain[i],1-(1-last)*release)
    mix[i] *= last
mix = np.concatenate((np.zeros((lookahead,2)),mix))[:length]
# Listening clip ends with a short fade rather than cutting a pedal tail.
fade = round(.4*sr)
mix[-fade:] *= np.linspace(1,0,fade)[:,None]
output_peak = float(np.abs(mix).max())
assert 0.01<output_peak<1 and np.isfinite(mix).all()
wav = root/'piano-audio-preview-v8.wav'
write(wav,sr,np.int16(mix*32767))
mp3 = root/'piano-audio-preview-v8.mp3'
subprocess.run(['ffmpeg','-v','error','-y','-i',str(wav),'-codec:a','libmp3lame','-q:a','2',str(mp3)],check=True)
encoded = decode(mp3)
assert np.isfinite(encoded).all() and float(np.abs(encoded).max())<1
report = dict(assetsDecoded=len(cache),assetSHA256Verified=True,stereo=True,finiteSamples=True,
              totalDecodedSeconds=round(decoded_seconds,3),maxAssetPeak=peak,
              renderedSourceEvents=rendered,scheduledPianoNotes=len(fixture['notes']),
              seconds=seconds,sampleRate=sr,preDynamicsPeak=pre_peak,outputPeak=output_peak,
              encodedPeak=float(np.abs(encoded).max()),roomRMS=float(np.sqrt(np.mean(room**2))),
              pedalResonanceRMS=float(np.sqrt(np.mean(resonance**2))),
              nativePreviewUsesJSRecordedSampleSchedule=True,
              filtersAndDynamicsApproximate=True,browserAuditoryCheck=False)
(root/'audio-render-verification.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report))

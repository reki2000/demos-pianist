# Piano audio

Recorded stereo grand piano (replaced oscillator synthesis in v8). Onset, pitch, velocity, note count, and fingering are unchanged from the motion side.

## Recordings

- **Splendid Grand Piano** (Steinway, public domain via AKAI): 110 recordings cover all 88 keys in 4 velocity layers (pp/mp/mf/ff), smoothly blended. Upstream notes: `audio-licenses/SPLENDID-README.md`.
- Key-release and pedal noises: **Salamander Grand Piano v3** (CC BY 3.0). See `audio-licenses/`.
- Distributed as trimmed, normalized 44.1 kHz stereo MP3 (mains ≤ 12 s). `audio-manifest.json` records source, trims, and SHA-256 per file.

## Engine

Damper sustain/decay, re-pedaling, partial pedaling, and mid-note presses follow MIDI CC64. Computed string resonance + room reverb; quiet mechanical noises. Polyphony capped at 128; DynamicsCompressor tames peaks (~6 ms look-ahead compensated on the visual side).

Audio and 3D start together after samples load, sharing the Web Audio output clock.

## Verification

`node audio-test.cjs`: pitch/layer boundaries for 88 keys × 127 velocities, samples for all 30,639 notes across 18 pieces, dampers, re-pedaling, repeats, stopping. `python render-audio-preview.py` renders a 22 s preview (needs numpy/scipy/ffmpeg).

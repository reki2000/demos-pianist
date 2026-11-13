# Piano audio

Recorded stereo grand piano (replaced oscillator synthesis in v8). Onset, pitch, velocity, note count, and fingering are unchanged from the motion side.

## Recordings

- **Splendid Grand Piano** (Steinway, public domain via AKAI): 110 recordings cover all 88 keys in 4 velocity layers (pp/mp/mf/ff), smoothly blended. Upstream notes: `audio-licenses/SPLENDID-README.md`.
- Key-release and pedal noises: **Salamander Grand Piano v3** (CC BY 3.0). See `audio-licenses/`.
- Distributed as trimmed, normalized 44.1 kHz stereo MP3 (mains ≤ 12 s). `audio-manifest.json` records source, trims, and SHA-256 per file.

## Engine

Damper sustain/decay, re-pedaling, partial pedaling, and mid-note presses follow MIDI CC64. Computed string resonance + room reverb; quiet mechanical noises. Polyphony capped at 128; DynamicsCompressor tames peaks (~6 ms look-ahead compensated on the visual side).

Audio and 3D start together after samples load, sharing the Web Audio output clock.

## Playback load

Use the AudioContext's `playback` latency hint: this is a scheduled recital,
so the device can use a larger buffer than it would for a live keyboard.
Visuals still follow the measured output clock. Pausing suspends the context.
Both render loops are capped at 30 fps; selecting a string instrument disables
the underlying piano render loop. The audio scheduler runs independently of
drawing and continues while the page is hidden.

Score staff relationships and sounding spans are cached per piece. Each frame
lays out the visible beams and rest gaps instead of rebuilding the full piece.
Face-preserving mesh reductions are documented in
`docs/verification/geometry-budget/README.md`.
These changes reduce sustained CPU/GPU load; short offline waveform tests alone
cannot establish whether a particular device is free of audio underruns.

The integrated string engines retire finished notes from their collections and
disconnect the full per-note graph, including filters, shapers and LFO gains.
Guitar and violin debug attack histories are capped at 512. Before these host
fixes, violin retained notes until stop, cello retained notes and pitch entries
for the engine lifetime, and both attack histories grew without a bound.
`audio-lifecycle-patches.json` pins the original and patched module hashes so
integration checks still detect unexpected source drift. Run
`node string-audio-test.cjs` for natural-end and early-stop resource checks.

## Verification

`node audio-test.cjs`: pitch/layer boundaries for 88 keys × 127 velocities, samples for all 30,639 notes across 18 pieces, dampers, re-pedaling, repeats, stopping. `python render-audio-preview.py` renders a 22 s preview (needs numpy/scipy/ffmpeg).

`node audio-browser-test.cjs` checks actual Web Audio gain waveforms in Chromium
(requires Playwright and its Chromium; set `CHROME` to use a system Chromium).
It covers repeated strikes and the 128-voice limit at 0.5×, 1× and 2× speed,
including the fallback for browsers without `cancelAndHoldAtTime`.

`node playback-soak-test.cjs` runs 190 seconds of real-time playback in Chromium,
checking live voices, sample cache, debug history, and suspension on pause.
It starts its own local server. Set `CHROME` for a system Chromium and
`SOAK_SECONDS` (75–300) to change the duration. This checks resource bounds,
not audible glitch freedom; software rendering and device load affect results.

When retiring a voice, preserve its current decay before scheduling the 40 ms
fade. `cancelScheduledValues` alone removes the endpoint of an ongoing ramp,
undoing the decay before the fade and causing a loud discontinuity. Use
`cancelAndHoldAtTime`, or replace the truncated ramp endpoint in the fallback.

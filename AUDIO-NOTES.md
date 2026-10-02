# v8 piano audio

Sound generation was switched from oscillator synthesis to a recorded stereo grand piano. Onset, pitch, velocity, note count and fingering for all ten pieces are unchanged from v7.

## Recordings and distribution format

- The main instrument is **Splendid Grand Piano**: Steinway recordings released into the public domain by AKAI. The original SFZ mapping is by kinwie. Source: https://github.com/smpldsnds/sfzinstruments-splendid-grand-piano. The upstream description is kept in `audio-licenses/SPLENDID-README.md`.
- Four recorded layers (pp / mp / mf / ff) are used, with adjacent layers blended smoothly according to velocity. As in the original mapping, some recordings are shared at the very top of the range; not every key was recorded four separate times.
- 110 main recordings cover all 88 keys. Playback rate is adjusted relative to the original SFZ `pitch_keycenter`, with at most two semitones of transposition. Pitch is never inferred from octave notation in the original file names.
- The four small key-release noises and four pedal noises are recordings from **Salamander Grand Piano v3 / Alexander Holm**, CC BY 3.0. Source: https://github.com/sfzinstruments/SalamanderGrandPiano; original release: https://archive.org/details/SalamanderGrandPianoV3; license: https://creativecommons.org/licenses/by/3.0/. The upstream description and full license text are kept in `audio-licenses/`.
- For distribution, excess leading silence was trimmed, stereo peaks were normalized and tails were faded briefly. Main recordings are at most 12 s, release noises 0.48 s and pedal noises 0.72 s, compressed to 44.1 kHz stereo MP3. These are processed excerpts of the original recordings.

## Pedal, resonance and level

The natural decay contained in the recordings is used as is; only the damper on key release is handled with a separate gain envelope. While the pedal is down, released notes are held; on release, remaining notes decay. Pressing mid-note, re-pedaling and partial pedaling are handled. Re-pedaling never revives energy that has already decayed. Undamped strings at the top of the range do not cut off abruptly on release.

A short impulse response imitating string resonance under the pedal and a subtle room reverb are added. These are computed approximations; they are neither a reverb measured in a real hall nor a model of every physical string-to-string interaction. Key and pedal mechanical noises are mixed quietly.

For repeated notes on the same key, the old tail is decayed briefly so that one key cannot stack unlimited voices. Polyphony is capped at 128 keystrokes. Velocity-dependent level and timbre are kept, and a DynamicsCompressor at the final stage tames strong peaks; level is not limited by hard clipping.

The audio clock and 3D start together only after the samples finish loading. The Web Audio output clock is used, and the DynamicsCompressor's ~6 ms look-ahead latency is reflected on the visual side. Selecting, seeking or stopping during loading never lets an old piece start late. Only the recordings needed by each piece are decoded, and caches for other pieces are released. The Heroic Polonaise loads 92 files and uses about 210 MB of memory for decoded audio. On low-memory devices the first preparation may take some time.

## Distribution and verification

`piano-recital.html` (built by `python pack-v8.py`) is a single HTML file that includes the recordings. No internet connection is required; open it in a browser and press the play button in the center. The multi-file version `dist/index.html` loads the same `dist/audio/` and JavaScript over an HTTP server. Run `python -m http.server 8000 --directory dist` in the extracted ZIP folder and open http://localhost:8000/.

`node audio-test.cjs` verifies pitch and layer boundaries for 88 keys × 127 velocities, the samples required by all 20,356 notes and ten pieces, dampers, re-pedaling, repeated notes and stopping. `node verify.cjs` verifies piece switching, load cancellation, speed changes, keystroke sync and the existing skeleton and score display. `audio-manifest.json` records each recording's source, trimmed leading time, length and SHA-256.

Running `python render-audio-preview.py` after `node audio-test.cjs` generates a preview of the first 22 seconds of the Heroic Polonaise using the recordings, onsets, gain envelopes and reverb impulse specified by the actual JavaScript. It requires Python, numpy, scipy and ffmpeg. It also decodes all 118 files and checks stereo, finite values, SHA-256 and peaks. The preview's filters and dynamics are native approximations, not the browser's actual Web Audio output.

Chromium could not be launched in the original build environment, so UI interaction and listening in a real browser were not checked there. The scope and results of verification are written to `v8-verification.json` and `audio-render-verification.json` when the build and preview scripts are run.

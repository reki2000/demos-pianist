# Development notes

Historical design log (v3–v10). When changing the figure, motion, fingering, score, or audio, preserve the behaviors below unless a change is intended, then re-run the listed tests.

- **v3** — Faceted-polygon figure, 3-segment fixed-length fingers, Web Audio clock, generated grand staff with gold note highlighting. Verified: keystroke sync, skeleton, tempo, in-between frames, pedal.
- **v4** — Thumb CMC on the palm side, wrist-pivot palm flexion, ordered finger assignment for chords, collision-avoiding idle fingers, beamed score. Verified: no fingertip inversions at all strikes, skeleton, beams, pedal.
- **v5** — Fixed pianist/world handedness (−X = anatomical right); look-ahead lateral spread; dynamics-driven wrist flexion; head nods, gaze, lean. WebGL draw calls inspected; 48 frames rendered via OpenGL ES.
- **v6** — Ergonomic fingering (Parncutt spans, thumb passing, outer fingers for chords) via dynamic programming over attack groups; shared palm positions; "R/L + 1–5" score labels. `FINGERING-NOTES.md`; `fingering-test.cjs`, `transition-test.cjs`.
- **v7** — Relaxed hanging fingers (MCP idle 0°); strike flexes MCP/PIP/DIP, returns in ~100 ms; 55 ms preparation, 18 ms press matching key travel. `hanging-test.cjs`.
- **v8** — Recorded Steinway (Splendid Grand Piano, 4 velocity layers), damper/decay handling, key/pedal noises, resonance + reverb, peak limiting. See `AUDIO-NOTES.md`.
- **v9** — Remodeled figure: smooth shading, tailcoat, bench; skeleton and motion unchanged.
- **v10** — Comfortable/practical span penalties, split lateral ranges (reach vs. relaxed), longer hand shifts with `shiftOverlap`, 140/130 ms prepare/relax, `PianoMotion.soften` display easing; 8 more pieces (18 total, 30,639 notes). Measured: fingertip speed p95 2.08→1.33 u/s.
- **v10+** — Distal joints (PIP/DIP) trail the knuckle with a slight phase lag; prepare/relax extended to 180/160 ms; softer `soften` time constant.

## Current invariants

- Fixed bone lengths everywhere (fingers, arms); joints bend, segments never stretch.
- Fingertip contact error ≤ ~5 mm at strikes; no inter-finger collisions; no MCP hyperextension past idle.
- MIDI pitch/velocity/onset/note count preserved; hand assignment may be redistributed, a few chords rolled.
- `node verify.cjs` is the gate: 18 songs, skeleton samples, contact error, continuous frames, pedal, audio sync, UI. See README for the full test list.

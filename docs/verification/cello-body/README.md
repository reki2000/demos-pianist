## Summary

Integrate the user-approved cello module at **demos-cellist `d9fceb4`**,
including the new body. All seven `dist/cello-*.js` artifacts are copied
byte-for-byte into `dist/instruments/` (hashes in `copies.json`).

- **Natural hand (NH):** rigid FK hand frames solved per mode/finger-slot/string
  key with LM; fixed bone lengths and per-finger/thumb contact solves. The
  original fingering plan, strings, board, neck, bridge interface and clearance
  surfaces are unchanged. `setHandSolver('legacy')` remains available.
- **Approved B-form body:** length **755 mm**, upper/C/lower widths
  **342/229/437 mm**, ribs **118 mm at the neck → 124 mm at the lower edge**,
  front/back arches **30/29 mm**, stop **400 mm**, f-hole stems **140 mm**.
- **Smooth mesh:** one closed surface, 109 longitudinal intervals (nominal ~8 mm
  plus outline extrema), shared smooth normals. Replaces the overlapping
  capped slices that caused noisy surface interference.
- **Endpin:** one straight segment on the extended `NECK_A–NECK_B` line,
  directed away from the neck, rather than world vertical; length ~648 mm,
  endpoint Y=6 mm.
- **Host adapter:** the shell supplies `renderer.mesh(data,color)`, uploads the
  immutable mesh once and reuses it across songs. It rebinds/restores the shared
  WebGL program around string frames, avoiding invalid uniform uploads and
  preserving the piano return path. Vendored violin renderer stays untouched.

## Performance

Module measurements, same 1200×800 headless Chrome/SwiftShader setup, 8 warmups
and 40 timed frames with `gl.finish()` (GPU-completed wall time):

| Metric | Previous sliced body | Approved mesh |
|---|---:|---:|
| Wooden body triangles | 241,920 | **11,880 (−95.1%)** |
| Wooden body draw calls | 756 | **1** |
| Cello draw median | 7.1 ms | **5.0 ms** |
| Full performer draw median | 7.4 ms | **6.7 ms** |
| Full performer draw p90 | 63.7 ms | 63.0 ms |

Software-renderer/VM scheduling has large tails; these are relative local
measurements, not guarantees for physical GPUs. The high-poly neck/board is
unchanged. The full module measurement notes are in
`demos-cellist/screenshots/body-review/MEASUREMENTS.md`.

### Cache breakdown

1. NH's in-memory frame-key cache avoids repeating LM solves (69 unique frames
   across this repertoire on the exact solver path).
2. The shipped **`cello-poses.js`** avoids per-render-frame pose/IK work:
   **30 Hz**, **14,839 samples** across four songs, **315 Float32 numbers per
   sample**, base64-packed numeric buffers plus string metadata; **25,640,244
   bytes** total. Keys include the solver (`natural`), with source stamps for
   motion, fingering and songs. Frames interpolate at playback time; the exact
   solver remains the fallback, and legacy does not consume the natural cache.
3. The renderer's WeakMap caches the body GPU buffer: browser smoke test
   confirms **one upload across all four songs**.

Earlier same-VM pose benchmark: 29,671 calls, **9.7 s raw → 3.3 s cached**
(~66% lower). This is separate from the body-render timings above. Interpolated
poses are approximations between samples, not a claim of exact solver equality.

## Verification

- **Unmodified `integration-test.cjs`: `ok:true`**, 20 existing module-copy
  checks, guitar/violin/cello handedness checks and all shell song checks pass.
  Independent `cmp`/SHA-256 verification also covers all seven cello files,
  including `cello-poses.js`. The previous body-copy mismatch is resolved.
- **All 12 host `*test.cjs` suites plus `verify.cjs` pass.** No existing tests or
  pins changed. Per-suite outputs are saved alongside this file.
- **Real browser smoke (`node headless-cello.cjs`): `ok:true`.** All four cello
  songs advance in playback with oscillator scheduling; the **11,880-triangle
  mesh**, not the primitive fallback, is drawn. Zero WebGL errors at the mesh,
  zero page exceptions, zero runtime NH frame solves. Guitar/violin switching
  and return to piano also complete without page errors. `prelude.png`,
  `swan.png` and `headless.json` retain evidence. Audio scheduling is tested;
  this is not a subjective listening assessment.

The body is now approved and integrated; no separate STEP B integration remains.
**PR #14 is for user review/merge only; it has not been merged or published.**

# Face-preserving geometry reduction

The head, hair, nose, ears, eyes, brows and lips keep their original meshes,
materials, normals and transforms. Each performer marks its existing face pass
with `setFaceDetail(true/false)` so facial strokes use the original limb mesh.
The separate body limb mesh has eight sides. Torso, jacket, palms, shoes and
seat cushions use fewer sides; thin strings, bows and rails use a smaller rod
mesh instead of the full ball mesh.

Violin/cello body grids keep the original outline extrema, arch equations and
closed caps, using fewer axial/lateral samples. Their body meshes fall from
9,396 to 2,820 and 11,880 to 3,720 triangles respectively. Cello neck/fingerboard
ribbons use 12 × 16 cells instead of 24 × 32, reducing draw calls substantially.
The mesh reductions preserve the fingering and audio plans; the hand pose changes are documented separately.

Measured full-scene counts in headless Chromium/SwiftShader at 12 seconds of
the default piece for each instrument, Wide camera, paused:

| Instrument | Before triangles | After triangles | Reduction | Before draws | After draws |
|---|---:|---:|---:|---:|---:|
| Piano | 112,612 | 56,536 | 49.8% | 454 | 454 |
| Guitar | 146,396 | 89,636 | 38.8% | 365 | 365 |
| Violin | 90,520 | 39,736 | 56.1% | 260 | 266 |
| Cello | 114,148 | 68,176 | 40.3% | 1,803 | 679 |

After counts include the five-finger bow-grip, violin left-hand and continuous finger skin updates.
These counts include the stage; they are not FPS or audio-underrun measurements.
Wide and portrait views of all four performers were inspected in Chromium.
`counts.json` records the measurements.

`node geometry-test.cjs` checks the original face draw-data fingerprint in both
renderers, body geometry budgets, and instrument mesh bounds within 2 mm of the
original mesh. `geometry-baseline.json` stores the reviewed original values.
The host changes to vendored modules are pinned in `geometry-patches.json`.
`node verify.cjs` and the local integration sections also pass. Upstream module
byte comparisons require the separate source repositories, absent here.

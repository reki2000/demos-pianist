# Violin left hand

The four fingers now share fixed knuckles on a wrist-rooted palm, with fixed phalanx lengths and linked PIP/DIP flexion. Sounding fingertips follow the existing fingering and vibrato targets. The thumb supports the side of the neck in lower positions and moves around the heel in higher positions; its three bones also keep constant lengths. The elbow follows the wrist, with a soft preference for a straight wrist.

References reviewed:
- [Manukau Youth Orchestra — Left hand](https://www.manukauyouthorchestra.org.nz/violin/left/): thumb joint beside the neck, open space below it, straight wrist and elbow beneath the instrument.
- [Violin Online — How to hold the violin](https://www.violinonline.com/howtoholdtheviolin.html): relaxed thumb opposite the first/second fingers, wrist clear of the neck.
- [Simon Fischer — The thumb](https://www.simonfischeronline.com/uploads/5/7/7/9/57796211/046thumb.pdf): thumb position varies with the player's anatomy and hand position; keep the thumb/index web open.

`node precompute-violin-hand.cjs` fits the trajectories offline. It saves restartable work in `/tmp/violin-hand-build` (override with `VIOLIN_HAND_WORK`) and generates `dist/instruments/violin-hand-frames.js`. Source and note signatures reject stale data. Playback interpolates coordinates and uses analytic finger IK; it never starts the nonlinear fitting process. Missing or stale data uses the existing motion.

`node violin-left-hand-test.cjs` checks all pieces, note boundaries, fixed roots and bone lengths, sounding contacts, connected wrists, unchanged bow/right arm/head, and zero runtime fitting. Face meshes remain covered by `geometry-test.cjs`.

After regenerating, run `node violin-left-hand-test.cjs` before committing. `--resume-angles` can resume an existing angle checkpoint without repeating the smooth collision-guide refinement; the contact repair and independent rendered-vertex checks still apply.

The thumb follows the interpolated palm carriage, rather than the fingering engine's earlier shift anchor. Free fingers can extend at the MCP joint while preparing a note, and the fingertip pads use a flatter section against the fingerboard.

| Lower position | Higher position |
|---|---|
| ![Lower position](low.png) | ![Higher position](high.png) |

![Full figure](wide.png)

Verification: 10,261 poses across the three pieces, plus 30 Hz motion and probes around every stored knot. Contact/root/bone errors stay at numerical precision, and playback performs zero nonlinear fits. Rendered vertices are checked at note starts, midpoints, ends and one-second samples against the actual body triangles and board/neck boxes; sampled skin overlap is below 1 mm (body 0.739 mm, board 0.837 mm, neck 0.595 mm). These clearance results describe the sampled rendered vertices. Bow/right-arm/head states match the existing motion, and the face mesh baseline passes. Full results: [verification.json](verification.json).

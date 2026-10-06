# Development notes

Design decisions, invariants and verification scope accumulated through v3–v9, kept as a reference for future work. When changing the figure, motion, fingering, score or audio, preserve these behaviors unless a change is intended, and re-run the listed tests.

## v3: Polygonal figure and score

The figure's head, torso, hands, joints, limbs and shoes are drawn as faceted polygons. Fingers have three fixed-length segments with PIP/DIP joints, creases and nails. Wrist lift before a strike scales with the square of velocity, and the elbow position changes while preserving fixed arm lengths. While notes are held, contact takes priority and vertical motion is limited.

The grand staff at the top is generated from MIDI and follows the performance clock including tempo changes. Notes matching the sounding pitch and onset are highlighted in gold. MIDI lacks the original voicing, beaming, rests and enharmonic spelling, so this is not a reproduction of the original score; durations are approximated from performance data. The score and controls remain visible in fullscreen.

Verification: audio/keystroke at 60 time points, fixed skeleton at 515, tempo conversion at 515, 1,120 in-between fingering frames, 3,276 pedal events. Real browser rendering and listening were not checked due to environment constraints.

## v4: Thumb, wrist, finger crossing and beaming

The thumb CMC (carpometacarpal) joint was placed on the side of the palm near the wrist. The thumb's three bones are drawn as metacarpal, proximal and distal phalanges; the other four fingers start at the MCP at the front. Thenar thickness, the wrist–palm connection and nail orientation were adjusted.

The palm flexes up and down around the wrist as a fixed pivot, combined with arm motion scaled by keystroke strength. Finger bases follow palm rotation while preserving finger and arm bone lengths.

Fingering for every piece was recomputed: for simultaneous notes, fingers are assigned in order from lower to higher keys. Inter-finger distance is evaluated, and unused fingers lift from the MCP to avoid collisions. In-between motion changes joint angles continuously, suppressing motions where a finger crosses another to chase a previous key. For short ornaments, the key is released before moving to the next hand position. Pitch, onset, velocity and note count are unchanged from v3.

Short notes are beamed per beat (in compound meters, per three eighth notes). Beams do not cross rests or long notes; chords share a stem, and 16th/32nd notes get double/triple beams. Gold noteheads during playback are kept.

Numeric verification: at the strike time of all 20,356 notes, no fingertip order inversions and a minimum finger-skeleton gap of at least 0.014 (world units). Fixed skeleton at 515 points, 244 audio onsets, 1,120 frames of continuous fingering motion, 3,865 beam groups, 3,276 pedal events. Score durations are estimated from MIDI performance data and are not a full reproduction of the original. Real browser rendering and listening were not checked.

Additional tests: `node anatomy-test.cjs`, `node collision-test.cjs`, `node continuity-test.cjs`, `node score-test.cjs`, `node pedal-test.cjs`.

## v5: Correct left/right layout and expressive playing

The pianist faces +Z in the WebGL world, so anatomical right is −X. Plan coordinates (with the pianist's right as +X) are now transformed to WebGL world space at render time, fixing the keyboard, both arms and hands, feet and the right damper pedal at once. Cameras use the same transform. The Hands camera puts the far side of the piano at the top of the screen, so bass is on the left and treble on the right. A0/C8 labels are shown when they fit on screen.

For fast shifts and wide chords, the next figure is looked ahead and the lateral MCP angle changes early to spread the thumb and little finger. A striking finger is not moved, and released fingers get a smooth preparation period. Finger base width and bone lengths are not enlarged. Inter-finger collision avoidance continues.

Wrist flexion grows with dynamics, and hand position is corrected to support the finger bases. This produces wrist and elbow vertical motion during strikes as well. Flexion is limited when the fingertip cannot reach. Preparation of unused fingers and contact of striking fingers are both satisfied.

Head nods, gaze toward the next strike position, and forward lean and lateral weight shift following phrase intensity were added or strengthened. Lighting of clothes and skin was adjusted, and normals under non-uniform scale are transformed correctly so the figure's form reads better. The "Pianist" camera shows head and torso; "Hands" shows fingers, wrists and elbows. Hands adjusts its distance so both hands fit even on narrow screens.

Verification: the world coordinates of all 88 keys and the camera projection in actual WebGL draw calls were inspected, confirming that pitch rises toward the pianist's right, and rises to the right on screen in the pianist-facing Hands view. Finger order and spacing at all 20,356 strikes, fixed skeleton lengths at 515 points, finger spread, wrist, head and torso motion in 595 look-ahead preparation scenes, continuity over 1,120 frames, pitch and onset of 244 notes, and 3,276 pedal events were checked. MIDI pitch, velocity, onset and finger assignment are preserved from v4.

The WebGL shaders, vertex buffers, matrices and draw calls were passed directly to OpenGL ES to render 48 frames, and the form, composition and continuity of the Hands and Pianist views were checked as images. The resulting GIFs (`render-check/*.gif`, generated by `python render-preview.py` and not committed) contain no audio, score or UI. Chromium launch restrictions remained, so final checks of UI interaction and listening in a real browser were not performed.

Additional test: `node expressive-test.cjs`. Capturing render data: `node capture-scene.cjs`; direction check: `node direction-test.cjs`. Rendering checks use Mesa EGL and Python numpy/Pillow and can be reproduced with `python render-egl.py render-check/hands.json render-check/hands.png`. The distributed HTML does not depend on any of these.

## v6: Fingering principles and phrase look-ahead

The research and how it maps to the implementation are summarized in `FINGERING-NOTES.md`. Ergonomic inter-finger spans, thumb passing on black and white keys, outer fingers in chords, back-and-forth figures and the speed of repeated notes are evaluated. Candidates for every attack group are compared with dynamic programming, choosing fingers using the previous two shapes and the upcoming notes. Major scales prefer the standard fingering and distinguish the end of one octave from a continuing octave. The thumb on black keys is not banned outright, and exceptions for chords and octaves are handled.

For notes that continue within one hand position, a shared palm position is searched and the next finger is prepared over its key. This is applied where fixed skeleton lengths, contact, spacing from unused fingers and continuity of in-between motion are all satisfied; otherwise it falls back to an independent hand move. Onset, pitch, velocity, note count and hand assignment are preserved from v5; finger assignment and release/preparation motion were updated.

The score at the top shows "R"/"L" and a number 1–5 for sounding notes. The numbers match the 3D finger assignment: 1 is the thumb, 5 the little finger. This does not reproduce fingerings from the original score or any particular pianist; it is generated automatically to fit the surrounding figures and the model's hand.

Basic scales, ascending/descending runs, multiple octaves, arpeggios, fast/slow repetition, black-key octaves and back-and-forth figures are checked with `node fingering-test.cjs`. Existing contact, skeleton, audio, pedal, beaming and clock checks continue.

Final verification: no fingertip inversions at the strike time of all 20,356 notes; fixed segment lengths and inter-finger spacing checked at 43,959 in-between points. Finger numbers were updated for 8,075 notes, and a shared hand position was adopted for 1,295 figures. Additional in-between motion check: `node transition-test.cjs`.

## v7: Striking from relaxed, hanging fingers

The motion that bent unused fingers back from the base was removed. The MCP idle angle relative to the palm is now 0°, and the distal joints bend slightly so the fingers hang naturally. A striking finger flexes MCP, PIP and DIP downward and returns smoothly to the idle pose within about 100 ms after release. In fast repetition, the return time shortens to fit the interval until the next strike. Even when avoiding contact, the base never lifts beyond the idle angle.

Base flexion and distal flexion are adjusted to white and black key heights, using the actual fore–aft position on the key while preserving fixed segment lengths. Fingers start preparing 55 ms before the next strike and press down over an 18 ms window matching key travel. On release, joints return continuously from the angles at the actual wrist pose. Lateral finger spread, wrist flexion, elbow/torso/head, score and pedal expression continue.

Onset, duration, pitch, velocity, hand assignment and finger number of all 20,356 notes from v6 were matched by SHA-256. Audio and animation still share the same Web Audio clock.

Verification: inter-finger spacing and key contact at every strike, spacing and fixed lengths at 43,959 in-between points, no MCP hyperextension beyond the idle angle across 25,490 finger poses, and continuity over 1,120 frames. Additional check: `node hanging-test.cjs`. The same render data as WebGL was rendered for 48 frames with OpenGL ES. UI interaction and listening in a real browser were not checked in that environment.

## v8: Recorded grand piano

The sound was switched to real Steinway recordings (Splendid Grand Piano). Four recorded layers from soft to loud are blended smoothly so dynamics affect both volume and timbre. Original pitch, onset, velocity, finger numbers and 3D motion are preserved. Damper sustain and decay, small recorded key and pedal noises, subtle computed resonance and reverb, and peak control were added. Selecting or stopping a piece while samples are loading is handled.

The standalone HTML embeds 118 recordings. The multi-file version can be served with `python -m http.server 8000 --directory dist`. Sources, licenses, processing, verification and limitations of the audio are in `AUDIO-NOTES.md`. `python pack-v8.py` writes the combined report to `v8-verification.json`. The preview `piano-audio-preview-v8.mp3` (generated by `python render-audio-preview.py`) is a native-processing approximation using the actual note schedule. Listening in a real browser was not checked.

## v9: Refined figure

The pianist was remodeled for a more elegant look: smooth-shaded surfaces instead of faceted polygons, more natural head-to-body proportions, a combed-back haircut, serene lowered eyes, and a black tailcoat with satin lapels, white shirt front, wing collar, bow tie, white cuffs and gold cufflinks; the tails drape over a tufted leather artist bench. Lighting uses wrapped diffuse and a cool rim light so dark clothing keeps its silhouette. Skeleton, motion, fingering and timing are unchanged.

## v10: Natural spans, soft motion and a wider repertoire

Fingering uses Parncutt et al.'s comfortable/practical maximum span for every finger pair (chords and joined consecutive notes), penalizes the lateral angle of each finger in a candidate shape, and makes hand travel, especially fast travel, more expensive. Lateral MCP range is split into a reach range for pressed keys ([1.45, .62, .48, .58, 1.0] rad, thumb to little finger) and a narrower relaxed range for free fingers ([1.30, .40, .28, .34, .60]). Free fingers take their lateral angle from the sounding fingers on either side and are kept within 0.05 rad of their neighbours' order (`orderFingers`), weighted by how free they are, so the correction is continuous.

Hand shifts last longer (0.18–0.62 s) and small shifts may start while keys are still held, but only when every held finger stays on its key from the moving palm (`shiftOverlap`); the lift arc starts after release. Fingers prepare up to 140 ms before a strike and relax over 130 ms; wrist lift and flexion are smaller and slower. `PianoMotion.soften` eases free fingers between rendered frames in the app (35 ms time constant, fixed bone lengths; sounding and approaching fingers are never delayed). The expressive test thresholds for wrist range and anticipatory fan were lowered accordingly.

Measured over the first 40 s of the ten original pieces at 120 Hz (stateless `pose`, before display easing): fingertip speed p95 2.08 → 1.33 and p99 3.20 → 2.57 world units/s, palm speed p95 1.82 → 1.16, samples with neighbouring non-thumb fingertips more than 0.12 apart 2,810 → 1,028. The largest 240 Hz fingertip step in the continuity test fell from 0.020 to 0.017. `docs/screenshots/v10-hands-before-after.png` compares the same moments (left: v9, right: v10).

Eight pieces were added (`add-songs.cjs`, `arrangements.cjs`, `midi.cjs`): Joplin's The Entertainer and Maple Leaf Rag, Satie's Gymnopédie No. 1 and the hymn New Britain from public-domain Mutopia editions (`mutopia-sources/`, rendered with LilyPond 2.25), new arrangements of When the Saints Go Marching In and Amazing Grace, and piano-midi.de performances of Träumerei, Liebestraum No. 3 and Golliwogg's Cakewalk. Score-based pieces get metric/melodic dynamics, bass-change pedalling, slight onset variation and a closing ritardando. All 18 pieces (30,639 notes) were re-planned; `v6-note-hashes.json` now holds the v10 note and finger hashes. All tests pass, and the page was loaded and played in headless Chromium (SwiftShader) without console errors.


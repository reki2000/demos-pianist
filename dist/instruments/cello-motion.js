'use strict';
/* Cello motion: turns a planned song (see cello-fingering.js) into a
 * posed performer at any time t, and draws it through a
 * RecitalGL-compatible renderer.
 *
 * plan(song) runs the fingering/bowing engine and caches the result on
 * song.cello. pose(song, t) is pure data (used by the tests):
 *   {leftArm:{shoulder,elbow,wrist}, rightArm:{...},
 *    fingers:{1..4:{points[4], contact, target}}, thumb:{points},
 *    bow:{frog,tip,contact,string}, hand:{anchor,mode}, sway}
 * draw(renderer, song, t) renders cello, bow and performer from pose().
 *
 * Motion follows the pianist app's lessons: the left hand starts moving
 * toward the next position ~180 ms before the note (using most of the
 * gap, easing in), fingers hover just above the fingerboard when free
 * and keep a natural curl, and the torso sways gently with the phrase.
 * Fingertips land on the planned string point: each finger is a
 * 3-segment chain posed by exact planar two-bone IK (the distal pair
 * keeps a fixed 0.35 rad curl), so contact error is ~0 by construction.
 */
window.CelloMotion = (() => {
  const M = window.CelloModel, F = window.CelloFingering;
  const { add, sub, mul, dot, norm, lerp } = M.vec;
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const slerp = (a, b, t) => a + (b - a) * t;
  const smooth = x => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };

  // ---- skeleton (planning coords, metres) ----
  // RecitalGL planning frame (the renderer reflects X): the performer's
  // LEFT shoulder sits at +X, the right (bow) shoulder at -X.
  const SHOULDER_L = [0.205, 1.13, 0.07], SHOULDER_R = [-0.205, 1.13, 0.07];
  const ARM = [0.30, 0.28]; // upper, forearm
  // Per-finger dimensions (metres) — a human hand is not four copies
  // of one finger. Totals follow standard hand anthropometry
  // (Garrett / ANSUR-style tables) with the middle finger as the
  // 1.00 reference at 100 mm: index 0.93, ring 0.97, little 0.76.
  // Segment splits sit near proximal:middle:distal = 1 : 0.65 : 0.5
  // with per-finger variation, and the segment radii follow the
  // same ordering (little thinnest, middle stoutest of the four).
  // The thumb is a metacarpal + two phalanges, shortest and
  // stoutest of the five digits.
  const FINGER_LEN = { 1: [0.043, 0.029, 0.021], 2: [0.046, 0.031, 0.023], 3: [0.045, 0.030, 0.022], 4: [0.036, 0.023, 0.017] };
  const FINGER_R = { 1: [0.0130, 0.0120, 0.0105], 2: [0.0140, 0.0130, 0.0110], 3: [0.0135, 0.0125, 0.0105], 4: [0.0115, 0.0105, 0.0090] };
  const THUMB_LEN = [0.044, 0.030, 0.022]; // metacarpal, proximal, distal (kept: MC1 44 mm sits in the anatomical 44-47 band; the chain total 96 mm runs a few mm under the ~103 mm anatomical ray, a stated shortfall the thenar mass covers visually)
  const THUMB_CMC_ROT_MAX = 0.6; // Stage 2: cap (rad) on the thenar complex's opposition swing about the wrist centre in thumbSolveFor -- the CMC rotation that supplements the 35 mm slide around the trapezium base
  const THUMB_R = [0.0145, 0.0135, 0.0115]; // FOUNDATION (2026-11-08): trimmed from [16.0, 14.5, 12.5] -- the old metacarpal radius drew a 32 mm tube, fatter than the middle finger, and with no thenar mass shaped around it the thumb read as a fifth finger; still the stoutest digit, now only just past the middle finger's 28 mm
  // Finger/thumb THICKNESS knob (rk 2026-11-08: the foundation
  // hand's fingers still read too thick). One factor scales
  // EVERY chain segment radius -- all four fingers and the
  // thumb together, so their relative proportions hold;
  // lengths, the skeleton and the palm masses are untouched.
  // Joint balls follow automatically: drawChain sizes each
  // ball as the mean of the adjoining segment radii. The
  // tables above are the scale-1.00 base values; FINGER_R /
  // THUMB_R stay the live tables and are mutated IN PLACE, so
  // draw(), the pose-time clearance reads and the SKELETON
  // export all see the scaled values. rk picked from the
  // thickness renders (screenshots/hand-thin-{a,b,c}-*.png at
  // 0.85 / 0.75 / 0.65): variant C = 0.65 (middle proximal
  // diameter 18.2 mm, inside the anatomical 16-20 mm band),
  // locked as the default 2026-11-08 (Stage 2). The pose-time
  // clearance reads use these radii too, re-verified in
  // Stage 2 (geometry-test S5 graze classes re-measured at
  // 0.65).
  const RADIUS_SCALE_DEFAULT = 0.65;
  let RADIUS_SCALE = RADIUS_SCALE_DEFAULT;
  const FINGER_R_BASE = { 1: [...FINGER_R[1]], 2: [...FINGER_R[2]], 3: [...FINGER_R[3]], 4: [...FINGER_R[4]] };
  const THUMB_R_BASE = [...THUMB_R];
  const setRadiusScale = s => {
    RADIUS_SCALE = s;
    for (let f = 1; f <= 4; f++) for (let j = 0; j < 3; j++) FINGER_R[f][j] = FINGER_R_BASE[f][j] * s;
    for (let j = 0; j < 3; j++) THUMB_R[j] = THUMB_R_BASE[j] * s;
    return RADIUS_SCALE;
  };
  setRadiusScale(RADIUS_SCALE_DEFAULT); // apply rk's pick at load: rest, poses and the SKELETON export all read the live (scaled) tables
  // (The pose-time ROW_S / KNUCKLE_ARC pair that used to sit
  // here -- 22 mm row stations and a hand-set 3.5/0/2/9 mm arc
  // -- is RETIRED in Stage 2: pose() now places the roots on
  // the row the rest skeleton itself defines, MC_ROW below.)

  // ---- REST SKELETON (foundation rebuild, rk 2026-11-08) ----
  // The open-hand diagnostic (all joints at 0 deg, renders
  // screenshots/hand-open-*.png) showed the shipped skeleton's
  // REST STRUCTURE was wrong independent of the pose solver:
  // the four "metacarpals" were rays from ONE wrist point (so
  // their lengths came out 92-95 mm with the order INVERTED --
  // little longest, index shortest), 41.5 deg of fan was baked
  // into the bones, the assembly had no thickness structure
  // (flat paddle, thumb coplanar), and the plate stretched to
  // 121 mm to cover the spokes. The definitions below are the
  // hand's foundation, stated in the canonical palm frame
  // (origin = wrist joint centre; X = index -> little across
  // the row, Y = wrist -> distal along the palm, Z = dorsal,
  // so palmar offsets are negative Z):
  //   MC_BASE: the four CMC bases as DISTINCT points on the
  //     distal carpal row's arc (middle base most distal --
  //     the capitate sits deepest), ~16 mm apart, ~12-17 mm
  //     distal of the wrist joint centre: the carpus is a real
  //     segment of the hand, not a point.
  //   MC_LEN: true metacarpal lengths from standard anatomical
  //     tables (adult radiographic means: II 66-70, III 70-73,
  //     IV 63-67, V 55-60 mm). Order: middle longest, little
  //     shortest. The knuckle row is DERIVED (base + length x
  //     direction), and with it the knuckle arc and PALM_LEN.
  //   MC_YAW: each metacarpal's divergence in the palm plane.
  //     Adjacent straight fingers now diverge ~2.4 deg (total
  //     fan ~7 deg, was 41.5): a relaxed extended hand's
  //     fingers sit near-parallel, and spread is an MCP
  //     abduction act, not a bone property. The CONVERGENCE
  //     fan (flexion planes aimed at the scaphoid, SCAPHOID
  //     below) lives in the flexion AXES (BONE fan yaws), as
  //     before -- not in the bones' directions.
  //   MC_CUP: the rest transverse arch, as a palmar pitch of
  //     the metacarpal direction. CMC 2/3 are the fixed pillar
  //     (0 deg); CMC 4/5 are mobile (anatomical flexion range
  //     ~10-20 / ~20-30 deg) and rest takes the shallow end --
  //     extension flattens the arch, flexion deepens it (the
  //     Stage-2 cup driver scales from these rest values).
  //   PALM_LEN: wrist joint -> middle knuckle, DERIVED from
  //     base + MC3 (~88 mm; the anatomical wrist->MCP3 span at
  //     this scale -- hand length ~188 mm less the 100 mm
  //     middle finger). What the diagnostic's "palm segment
  //     ~25 mm too long" measured was the SPOKES: no single
  //     ray carries this span any more; the metacarpal part of
  //     it is 71 mm and the carpal part ~17 mm.
  //   PLATE / THENAR / HYPOTHENAR / CARPUS_R: the palm is
  //     shaped masses, not one paddle. Plate ~92 x 80 x 21 mm
  //     (palm breadth 79-88 mm class) spanning the metacarpal
  //     region; thenar and hypothenar ellipsoids ride its
  //     palmar corners; the carpus mass covers the wrist and
  //     every CMC base, so no step shows at the junction.
  //   THUMB_BASE / THUMB_DIR: the thumb roots at the
  //     TRAPEZIUM (research rule): radial side of the carpus
  //     at wrist level (6 mm distal of the joint centre, vs
  //     the fingers' 12-17), 30 mm to the index side, and
  //     16 mm PALMAR of the dorsal plane (15-20 mm class --
  //     was 8 mm, which parked the chain in the palm plane).
  //     Its rest direction leaves the palm plane palmar-ward
  //     (~20 deg) and across (~38 deg off the palm axis), and
  //     its flexion sweeps ACROSS the palm in a plane near-
  //     parallel to the palm surface (the rolled CMC frame),
  //     never like a finger's sagittal fold.
  //   REST_CURL: the natural cascade for the rest render --
  //     slight flexion at every joint, increasing index ->
  //     little, DIP slaved at ~0.7 x PIP (the FDP coupling).
  //     Tuning values in the research report's stated ordering
  //     (no canonical degree table exists); the fully-extended
  //     diagnostic stays all-zero.
  const MC_LEN = { 1: 0.067, 2: 0.071, 3: 0.064, 4: 0.056 };
  const MC_BASE = { 1: [-0.0240, 0.0135, 0.0010], 2: [-0.0080, 0.0165, 0.0020], 3: [0.0080, 0.0150, 0.0010], 4: [0.0240, 0.0115, -0.0010] };
  const MC_YAW = { 1: -3.2, 2: -0.8, 3: 1.6, 4: 4.0 }; // degrees in the palm plane
  const MC_CUP = { 1: 0, 2: 0, 3: 4, 4: 9 };           // degrees of palmar pitch (rest arch)
  const SCAPHOID = [-0.026, 0.018, -0.010];            // convergence target of the flexion fan (proximal radial palm)
  const mcDir = f => {
    const y = MC_YAW[f] * Math.PI / 180, p = MC_CUP[f] * Math.PI / 180;
    return [Math.sin(y), Math.cos(y) * Math.cos(p), -Math.cos(y) * Math.sin(p)];
  };
  const mcRoot = f => add(MC_BASE[f], mul(mcDir(f), MC_LEN[f]));
  const PALM_LEN = Math.hypot(...mcRoot(2)); // wrist joint -> middle knuckle, derived (~0.088)
  // POSE-TIME KNUCKLE ROW, DERIVED (Stage 2): the row pose()
  // places the finger roots on is THIS skeleton's row, read
  // off the derived roots: s = station along the row
  // (canonical X), a = setback along the palm axis (canonical
  // Y, middle = 0, growing proximal-ward -- set by the
  // metacarpal length differences themselves: the little
  // finger sits 20.8 mm back, not the old hand-set 9 mm),
  // z = the cup offset (canonical Z, dorsal +; the CMC4/5
  // rest arch read on the roots). Derived spacing ~18.7 mm
  // (the retired pose row used 22 mm stations from the spoke
  // skeleton). The Stage-2 cup driver in finishHand re-scales
  // the z offsets of fingers 3/4 with their flexion.
  const MC_ROOTS = { 1: mcRoot(1), 2: mcRoot(2), 3: mcRoot(3), 4: mcRoot(4) };
  const MC_ROW = { s: {}, a: {}, z: {} };
  for (let f = 1; f <= 4; f++) {
    MC_ROW.s[f] = MC_ROOTS[f][0];
    MC_ROW.a[f] = MC_ROOTS[2][1] - MC_ROOTS[f][1];
    MC_ROW.z[f] = MC_ROOTS[f][2];
  }
  const PLATE = { centre: [0.000, 0.042, -0.002], radii: [0.040, 0.046, 0.0105] };
  const KNUCKLE_PAD = { centre: [0.001, 0.076, -0.001], radii: [0.033, 0.015, 0.0105] }; // distal palm pad under the metacarpal heads: cradles the four roots so they emerge from mass, not from the plate's rounded distal pole (the pinched stalks of the diagnostic)
  const THENAR = { centre: [-0.032, 0.025, -0.014], radii: [0.0165, 0.023, 0.0115] };
  const HYPOTHENAR = { centre: [0.028, 0.040, -0.008], radii: [0.0125, 0.030, 0.009] }; // runs up the 5th metacarpal to the little root, as the eminence does
  const CARPUS_R = { centre: [0, 0.008, -0.002], radii: [0.027, 0.018, 0.012] }; // dorsal radius kept near the plate's so the junction reads as a wrist crease, not a stepped lump
  const THUMB_BASE = [-0.030, 0.006, -0.016];
  const THUMB_DIR = norm([-0.52, 0.78, -0.34]);
  const REST_CURL = { 1: [6, 10, 7], 2: [9, 14, 10], 3: [12, 18, 13], 4: [16, 24, 17] }; // deg, MCP/PIP/DIP
  const REST_CURL_THUMB = [10, 16]; // deg, CMC across-palm sweep / MCP flexion (IP rides straight in the rest glyph)

  // ---- Joint range-of-motion table (rk's governing method) ----
  // Anatomical limits in radians, from standard goniometry
  // references (AAOS / Norkin joint-motion norms); where a tighter
  // "play" bound is listed, it is the range a cello posture
  // actually uses. The pose is solved BACKWARD from the contact
  // points (the four fingertips' string points, the thumb's rest
  // on the neck back / board anchor): fingertips -> finger joints
  // -> knuckle row -> wrist -> forearm -> elbow -> shoulder, with
  // every joint kept inside this table; if a contact cannot be
  // met in ROM the solution moves proximally, never past a limit.
  const ROM = {
    SHOULDER: { coneFromDown: 2.01 },       // upper arm within 115 deg of hanging straight down: anatomical flexion runs to ~150, and the cello left arm works high (the hand is at head height, so the elbow rides near shoulder height even in low positions -- a generic 78 deg cone measured ZERO feasible elbows)
    ELBOW: { flex: [0.09, 2.53] },          // hinge flexion 5..145 deg; hyperextension (< 0) impossible by construction
    FOREARM: { pronation: [-0.35, 0.61] },  // palm roll about the forearm axis, -20..+35 deg
    WRIST: { flex: [-0.035, 0.70], radial: 0.35, ulnar: 0.52 }, // SIGNED (rk): palmar flexion -2..+40 deg -- extension (cocking the wrist back) is ~0, it never happens in playing; radial deviation <= 20 deg, ulnar <= 30 deg (AAOS)
    FINGER: { MCP: [0, 1.57], PIP: [0, 1.57], DIP: [0, 1.22] }, // rk 2026-11-08, per joint, in the PALM frame: flexion (toward the palm) 0..90 deg, extension (backward) 0 -- never; lateral deviation: MCP <= 30 deg, PIP/DIP exactly 0 (the chain bends in the palm flexion plane). PIP's old 100 deg cap is superseded by the 90 deg line; DIP's 70 deg cap stands (inside the line).
    THUMB: { MCP: [0, 0.96], IP: [0, 1.48] }                    // flexion 0..55 / 0..85 deg, palmar only -- a dorsal bend is a failure, not a posture (functional grip values: AAOS nominal is 50/80, goniometry references run to 60/90; these caps bind only at the shortest spans)
  };

  // ROM SOLVER support (rk's three principles, 2026-11-09; the
  // solver itself lives in pose() behind CARR.romSolve): the
  // per-song stopped-note assignments per finger, used for the
  // rest<->stopping transition envelopes of fingers that are
  // not stopping (principle 3: an unused finger rides the palm
  // frame in the rest cascade; it blends toward its next
  // assignment's contact point only across the note-transition
  // window). cp is the assignment's exact contact point (the
  // fingering plan's string point + 1 mm, as pose()'s targets).
  const ROM_ASSIGN = new WeakMap();
  const romAssignFor = song => {
    let a = ROM_ASSIGN.get(song);
    if (!a) {
      a = { 1: [], 2: [], 3: [], 4: [] };
      const resA = song.cello;
      if (resA) song.notes.forEach((n, i) => {
        const r = resA.notes[i];
        if (r && r.mode !== 'open' && r.finger >= 1 && r.finger <= 4)
          a[r.finger].push({ s: n[0], e: n[0] + n[1], cp: add(M.boardPoint(r.string, F.distFromNut(r.semitone) / 1000), mul(M.n, 0.001)) });
      });
      ROM_ASSIGN.set(song, a);
    }
    return a;
  };
  // Feasibility log of the ROM solver: one record per frame
  // where NO placement in the candidate set made every
  // stopping chain ROM-feasible (the frame then falls back to
  // the shipped search, and the record is the finding reported
  // to rk -- the solver never papers over an infeasible frame
  // by bending a bone or a ROM bound). Read by
  // tools/probe-rom.cjs via Mo._romLog.
  const ROM_LOG = [];

  // ---- Placement variants (rk picks the most natural) --------
  // All three pinch the neck from the back-left (wrist and palm on
  // the player's side of the neck axis and toward the A-string
  // side, thumb on the back-left ridge, fingers over the board);
  // they differ in elbow carriage, pinch depth and palm roll --
  // three legitimate in-ROM readings of "natural".
  //   wristU / wristSide / wristN: (u, v, n) components of the
  //     wrist->knuckle axis seed (n slerps to 0.72 over lam); a
  //     POSITIVE v component puts the wrist on the -v (player's
  //     left) side of the knuckles. RK ROUND 2: the axis is
  //     ALONG-NECK DOMINANT in every variant -- a real hand's
  //     wrist sits far down-neck of its knuckles with the palm
  //     lying along the neck's back-left; the phase-1 axis pointed
  //     mostly off-board (n ~ 0.96), which parked the wrist, and
  //     with it the thumb's base, beside the knuckles: the root
  //     cause of both the ~160 deg drawn base-joint bend rk
  //     measured in the renders and the thumb spans (28-65 mm
  //     for a 96 mm chain) too short to fold without a kink.
  //   wristBack: the wrist joint centre's front/back target vs
  //     the neck axis along the board normal (negative = behind
  //     the axis), used by the neck-frame wrist placement.
  //   stationBack / wristSideM: that placement's down-neck
  //     distance from the middle knuckle's station and its
  //     distance toward the player's left (-v) from the axis.
  //   elbowY: preferred elbow height (planning Y; shoulder is
  //     1.13).
  //   devW: score weight on the signed wrist posture (flexion vs
  //     the variant's flexPref, plus deviation) -- how much of
  //     the trade each variant spends on wrist posture vs the
  //     elbow carriage.
  //   palmRoll: hand twist about the knuckle-row axis (pronation).
  //   flexPref: the gentle palmar wrist flexion the elbow search
  //     prefers (the wrist itself never extends -- ROM.WRIST).
  const VARIANTS = {
    A: { name: 'A', wristU: 0.52, wristSide: 0.33, wristN: 0.78, wristBack: -0.006, stationBack: 0.038, wristSideM: 0.034, wristFloor: 0.037, elbowY: 1.205, devW: 0.10, palmRoll: 0, flexPref: 0.10 },
    B: { name: 'B', wristU: 0.60, wristSide: 0.38, wristN: 0.72, wristBack: -0.014, stationBack: 0.048, wristSideM: 0.042, wristFloor: 0.037, elbowY: 1.255, devW: 0.45, palmRoll: 0.21, flexPref: 0.22 },
    C: { name: 'C', wristU: 0.68, wristSide: 0.28, wristN: 0.66, wristBack: -0.018, stationBack: 0.052, wristSideM: 0.045, wristFloor: 0.037, elbowY: 1.28, devW: 1.20, palmRoll: -0.14, flexPref: 0.30 }
  };
  // SHIPPED DEFAULT: variant C (rk's pick, 2026-11-07 -- "most
  // natural" of the three round-2 readings: deepest pinch,
  // straightest wrist, most compact carriage). The app path
  // produces C with no variant flags; setVariant remains only
  // as a dev tool (tools/shot-variants.mjs) for re-checking the
  // other readings against a future change.
  let VARI = { ...VARIANTS.C };
  function setVariant(name) {
    const v = VARIANTS[name];
    if (!v) throw new Error('unknown cello variant: ' + name);
    VARI = { ...v };
    return VARI;
  }

  // ---- Hand-skeleton modes (the setCarriage dev hook) --------
  // SHIPPED DEFAULT: 'bone' (rk's ruling, 2026-11-08 — the
  // per-bone metacarpal-frame skeleton is the main line; see
  // BONE below). The app path produces the bone hand with no
  // flags. The other modes ('current' = the pre-bone shipped
  // build, r1/r2/r3, wrap, fan) are the recorded exploration of
  // the CARRIAGE space — wrist placement, palm orientation,
  // knuckle-row placement — kept reachable through setCarriage
  // for re-checking, inert on the default path. Background:
  // the pre-bone chains folded in the fingerboard's sagittal plane
  // (bulge reference M.n) while the palm sat rolled ~45-80 deg
  // against that plane, so in palm coordinates the fold reads
  // as mostly SIDEWAYS bend (geometry section 9's pinned
  // baselines: MCP lateral to 87.7 deg, PIP lateral to ~67
  // deg). These modes explore the CARRIAGE space -- wrist
  // placement, palm orientation, knuckle-row placement -- with
  // the fold plane tied to the palm. The default 'current' is
  // the shipped build, unchanged in behaviour.
  //   r1 "palm-aligned carriage": the wrist placement rotates
  //     about the neck axis by rollDeg (weighted out as
  //     lam -> 1) and the chains fold in the palm plane.
  //   r2 "palm fold, row adapts": carriage nominal; the chains
  //     fold in the palm plane; the knuckle roots roll about
  //     the row axis by rootRollDeg and the wrist trial search
  //     additionally scores the metacarpal's alignment with
  //     the primary finger's palm fold plane (alignW).
  //   r3 "halfway": rollDeg/2 of carriage roll and the fold
  //     bulge reference blended halfway board -> palm.
  //   wrap "wrist wraps around the neck" (rk's steer, 2026-
  //     11-08): instead of rolling the placed wrist in place
  //     (r1), the wrist TARGET's radial offset from the neck
  //     axis is rotated around the axis toward the board-back
  //     direction by wrapDeg -- the wrist position itself is
  //     carried further around the back of the neck, and the
  //     palm frame is re-derived from the wrapped wrist and
  //     the knuckle row as usual. wrapStation 'chord' also
  //     slides the wrist along the axis so the wrist -> middle
  //     knuckle chord keeps its unwrapped length (the hand
  //     screws around the neck as it wraps). The placeWrist
  //     palm-length band clamp is DISABLED in this mode
  //     (wrapBand 'off'): at a wrapped station the honest
  //     chord exceeds the band, and the clamp's chord-scaling
  //     drags the wrist back toward the front -- it unwraps
  //     the placement it is meant to serve. The radial neck-
  //     wood floor stays (clearance, not posture). Chains fold
  //     in the palm plane, as r1/r2. liftY / liftX bias the
  //     elbow search (any mode): preferred elbow height raised
  //     by liftY and pulled toward planning-X liftX -- rk's
  //     "open the armpit, lift the elbow out to the side".
  //   fan "rotate the fan" (rk's redesign call, 2026-11-08):
  //     the R / wrap rounds established that the MCP flexion/
  //     lateral split is invariant to wrist placement and to
  //     frame rolls -- it is set by the knuckle row's roll
  //     about the metacarpal axis. This mode rotates the
  //     distal assembly itself: after the fan has built the
  //     knuckle roots, the roots are swung by fanDeg about the
  //     middle metacarpal's line (the provisional wrist ->
  //     middle knuckle axis, which the middle root lies on by
  //     construction), BEFORE the placement snapshot is taken,
  //     so every wrist trial, the palm frame, the thumb base
  //     and the chains re-derive from the rotated fan -- a
  //     skeletal pronation of the fan, not a drawn-frame roll
  //     and not a wrist move (the wrist is the pivot; the
  //     trial search then co-designs its placement around the
  //     rotated row). Targets (board points) never move;
  //     contact stays exact by chain construction. Chains
  //     fold in the palm plane, as r1/r2/wrap. (Rotating only
  //     appDir about the palm axis was probed first and is NOT
  //     this mode: the wrist placement compensates it, worst
  //     MCP lateral stayed in the 77-89 deg band at |phi|<=80.)
  //   bone "per-bone metacarpal frames" (rig-standard
  //     structure, research input 2026-11-08) — THE SHIPPED
  //     DEFAULT since rk's ruling of 2026-11-08: production hand
  //     rigs give every bone its own local frame (axis along
  //     the bone, flexion axis perpendicular to the bone and
  //     parallel to the dorsal plane) and zero the rest pose;
  //     "wrong bone roll -> fingers curl sideways" is the
  //     classic defect of a single derived frame -- the
  //     analogue of this model's row-derived palmZ. In this
  //     mode each finger's chain folds in ITS OWN flexion
  //     plane: the bulge reference is the finger's dorsal
  //     axis boneZOf(f) -- the back-of-hand normal projected
  //     perpendicular to that finger's metacarpal, yawed
  //     about the metacarpal by the fan angle psi_f =
  //     fanYawBase + fanYawSpread * (f - 2) (the fan lives in
  //     the metacarpal bases: progressively oblique planes,
  //     ulnar side converging -- a property of the hand, not
  //     of the targets). The drawn palm frame is derived FROM
  //     the middle finger's bone frame (palm plate drawn from
  //     the bones, not the other way round), and with
  //     dipSlave = 1 the chain's distal bend is slaved to the
  //     PIP bend at the measured FDP coupling (DIP ~ 0.69 *
  //     PIP) instead of resting at a fixed curl. The fanDeg
  //     root swing above is also available in this mode.
  const CARR_OFF = { mode: 'current', rollDeg: 0, rootRollDeg: 0, alignW: 0, rootAlign: 0, wrapDeg: 0, wrapStation: 'keep', wrapBand: 'off', wrapGuard: 'off', liftY: 0, liftX: 0, fanDeg: 0, fanYawBase: 0, fanYawSpread: 0, dipSlave: 0, palmFold: 0, romSolve: 0, romBandGate: 0, romPad: 1 };
  // THE SHIPPED HAND (rk's ruling, 2026-11-08): the bone
  // skeleton at its representative configuration — per-finger
  // flexion planes from the metacarpal fan (base yaw 0, spread
  // +20 deg per finger step from the middle), the DIP slaved
  // to the PIP at the FDP coupling, and the L2 elbow lift
  // (rk's "open the armpit" steer: +60 mm height pull, lateral
  // pull to planning X 0.22 in the elbow score).
  const BONE = { mode: 'bone', fanYawBase: 0, fanYawSpread: 20, dipSlave: 1, liftY: 0.06, liftX: 0.22 };
  let CARR = { ...CARR_OFF, ...BONE };
  function setCarriage(c) {
    CARR = { ...CARR_OFF, ...(c || {}) };
    return CARR;
  }

  // ---- Placement-family variants (rk's visual-variant call,
  // 2026-11-08) ----------------------------------------------
  // The Phase B fix programme centred everything the CURRENT
  // placement family can reach, and measured the mechanism of
  // what remains: neck-position contact fold totals stand at
  // ~150-207 deg (a real stopping finger folds ~90-140) with
  // the drawn MCP at its 89.4 deg cap in ~38% of middle-finger
  // contact frames, and thumb-position ring/little own-frame
  // MCP lateral medians sit at 65-70 deg (their metacarpals
  // ~65-79 deg off the fold plane). At full span the drawn
  // angle reads over the cap, so the MCP guard crushes spans
  // to ~65-75 mm and PIP+DIP ~ 120 deg follows; the scored
  // levers inside this family (trial offsets, the Phase B fold
  // term) only trade fingers against each other. Centring the
  // folds needs the placement FAMILY changed -- where the
  // wrist anchor sits and how the fingers approach -- which is
  // a visual decision, so the family is parameterised here and
  // rk picks from renders. PLACE_OFF reproduces the shipped
  // placement EXACTLY (V0 = the app path; every field the pose
  // used to hardcode is read through PLACE with these values):
  //   appNeck / appEnd: the finger approach direction's
  //     (u, v, n) components at lam = 0 / 1 (knuckle = target
  //     + appDir x reach x rho).
  //   rhoNeck / rhoEnd, curlNeck / curlEnd: the chain span
  //     fraction and rest curl the approach uses.
  //   axisNeck / axisEnd: the palm-axis seed's (u, v, n)
  //     components (wrist -> middle knuckle). axisNeck null
  //     reads the carriage variant's wristU/wristSide/wristN.
  //   stationBack / wristBack / wristSideM: overrides of the
  //     neck-frame wrist anchor (null reads VARI's): the
  //     wrist's down-neck distance from the middle knuckle's
  //     station, its front/back offset vs the neck axis along
  //     the board normal (negative = behind the axis), and its
  //     distance toward the player's left. Together the last
  //     two set the wrist's radial angle about the neck axis.
  //   foldW / foldCeilC / foldCeilH / hairpinW / polishFold:
  //     the Phase B fold term's weight multiplier, its soft
  //     ceilings (rad, contact / hover), the thumb-position
  //     hairpin charge, and the polish sweep's fold trigger.
  const PLACE_OFF = {
    appNeck: [0.88, -0.10, 0.40], appEnd: [0.35, -0.62, 0.70],
    rhoNeck: 0.98, rhoEnd: 0.58, curlNeck: 0.55, curlEnd: 0.28,
    axisNeck: null, axisEnd: [0.55, 0.42, 0.72],
    stationBack: null, wristBack: null, wristSideM: null,
    foldW: 1, foldCeilC: 2.62, foldCeilH: 2.97, hairpinW: 300, polishFold: 3.05
  };
  const PLACE_VARIANTS = {
    // V0: the shipped placement (baseline; the app path).
    V0: { name: 'V0', ...PLACE_OFF },
    // V1 "palm-plane": the wrist anchor's radial offset about
    // the neck axis rotates ~30 deg toward the back of the
    // neck (radial distance ~48 mm preserved: wristBack
    // -18 -> -38 mm, wristSideM 45 -> 30 mm), so the
    // metacarpal lines swing toward the fingers' fold planes
    // and the drawn MCP reads the fold itself instead of the
    // wrap angle; the palm-axis seed follows the wrist around
    // at the neck end of the lam blend (v 0.28 -> 0.20 /
    // n 0.66 -> 0.72). The END placement is deliberately the
    // shipped one: rotating the end axis too (axisEnd
    // [0.52, 0.30, 0.78] was swept) rolls the thumb-position
    // hand until the back of the hand loses its audience
    // component (geometry section 6 measured -0.082 against
    // its >= 0 bound) -- the end metacarpals do not turn
    // toward the board fold plane from this lever.
    // MEASURED (2026-11-08): a HALF rotation (~15 deg, the
    // placement V3 carries) was also swept and is WORSE --
    // non-monotonically: it lands the wrist in a pocket where
    // the ring finger pins at the drawn cap in ~65% of
    // contact frames, the thumb's settled IP tail reaches
    // 63.7 deg (section 10 pins <= 40) and the little root's
    // station tail reaches 76 mm. The full rotation below
    // shows none of those three.
    // MEASURED GEOMETRY VERDICT (2026-11-08): this
    // configuration FAILS geometry section 6's wrist pin
    // (drawn wrist v offset max -29.9 mm against <= -30 mm)
    // by 0.14 mm, and tuning inside the family does not fix
    // it: rotating further (wristBack -41 mm, wristSideM
    // 26 mm) moves the DRAWN wrist the other way (-26.0 mm --
    // the settled wrist is a search outcome, not the anchor),
    // and the half rotation breaks section 10's thumb pin
    // instead (see V3). Kept as measured for rk's judgement.
    V1: { name: 'V1', ...PLACE_OFF,
      wristBack: -0.038, wristSideM: 0.030,
      axisNeck: [0.68, 0.20, 0.72] },
    // V2 "high approach": the wrist anchor rides further
    // toward the heel (stationBack 52 -> 74 mm) and closer to
    // the neck axis line (wristBack -18 -> -10 mm, wristSideM
    // 45 -> 36 mm), so the metacarpals point more along the
    // neck axis; the knuckles sit less far up-neck and higher
    // off the board (appNeck u 0.88 -> 0.74, n 0.40 -> 0.55)
    // so the fingers come down onto the strings with less
    // wrap, and the span comes a touch off full stretch
    // (rhoNeck 0.98 -> 0.95), where the drawn angle blows up.
    V2: { name: 'V2', ...PLACE_OFF,
      stationBack: 0.074, wristBack: -0.010, wristSideM: 0.036,
      appNeck: [0.74, -0.08, 0.55], rhoNeck: 0.95,
      axisNeck: [0.60, 0.24, 0.72] },
    // V3 "hybrid": a HALF radial rotation placement (wristBack
    // -28 mm, wristSideM 37 mm; axes followed halfway at both
    // lam ends), plus the search's fold objective strengthened
    // -- fold weight x3, the contact soft ceiling tightened
    // 150 -> 140 deg, the hairpin charge doubled, and the
    // polish sweep triggered by fold sooner.
    V3: { name: 'V3', ...PLACE_OFF,
      wristBack: -0.028, wristSideM: 0.037,
      axisNeck: [0.68, 0.24, 0.69], axisEnd: [0.53, 0.36, 0.75],
      foldW: 3, foldCeilC: 2.44, foldCeilH: 2.80, hairpinW: 600, polishFold: 2.85 }
  };
  // SHIPPED DEFAULT: V0 (the current placement). setPlaceVariant
  // is a dev tool for the variant renders/probes, like
  // setVariant / setCarriage; the app path never calls it.
  let PLACE = { ...PLACE_VARIANTS.V0 };
  function setPlaceVariant(name) {
    const p = PLACE_VARIANTS[name];
    if (!p) throw new Error('unknown cello placement variant: ' + name);
    PLACE = { ...p };
    return PLACE;
  }

  function solveElbow(S, W, pole) {
    const [L1, L2] = ARM;
    let d = sub(W, S), dist = clamp(Math.hypot(...d), 0.05, (L1 + L2) * 0.999);
    const dir = norm(d);
    const a = (L1 * L1 - L2 * L2 + dist * dist) / (2 * dist);
    const h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
    let perp = sub(pole, mul(dir, pole.reduce((s, v, i) => s + v * dir[i], 0)));
    perp = norm(perp);
    return add(add(S, mul(dir, a)), mul(perp, h));
  }

  // Raw 3-segment finger chain from base B to target T in the
  // bend plane whose normal is planeN: proximal segment two-bone-
  // IK'd onto the virtual distal bone, distal pair held at a
  // FIXED relative bend (curl). The tip lands on T exactly for
  // any curl.
  function fingerChainRaw(B, T, lens, planeN, curl) {
    const [l1, l2, l3] = lens;
    const L23 = Math.sqrt(l2 * l2 + l3 * l3 + 2 * l2 * l3 * Math.cos(curl));
    let d = sub(T, B), dist = clamp(Math.hypot(...d), 0.02, (l1 + L23) * 0.999);
    const dir = norm(d);
    let side = sub(planeN, mul(dir, planeN.reduce((s, v, i) => s + v * dir[i], 0)));
    side = Math.hypot(...side) < 1e-6 ? [0, 0, 1] : norm(side); // in-plane bend direction
    const a = (l1 * l1 - L23 * L23 + dist * dist) / (2 * dist);
    const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
    const J = add(add(B, mul(dir, a)), mul(side, h));
    // Virtual distal direction (J -> T), then rotate by psi around the
    // plane normal to get segment 2's true direction.
    const vd = norm(sub(T, J));
    const psi = Math.atan2(l3 * Math.sin(curl), l2 + l3 * Math.cos(curl));
    const ax = norm(M.vec.cross(vd, side)); // rotation axis ~ plane normal
    const rot = (vec, ang) => {
      const c = Math.cos(ang), s = Math.sin(ang);
      return add(add(mul(vec, c), mul(M.vec.cross(ax, vec), s)), mul(ax, M.vec.dot(ax, vec) * (1 - c)));
    };
    const d2 = rot(vd, psi);
    const J2 = add(J, mul(d2, l2));
    const tip = add(J2, mul(rot(d2, -curl), l3));
    return [B, J, J2, tip];
  }
  const chainBends = pts => [
    Math.acos(clamp(dot(norm(sub(pts[1], pts[0])), norm(sub(pts[2], pts[1]))), -1, 1)),
    Math.acos(clamp(dot(norm(sub(pts[2], pts[1])), norm(sub(pts[3], pts[2]))), -1, 1))
  ];
  // Signed PIP flexion in the chain's own frame (rk 2026-11-08:
  // a joint bends toward the palm only, never backward). The
  // chain bulges toward `side` (the plane normal's in-plane
  // direction, the back-of-hand side), so flexion -- the outgoing
  // segment rotating toward the palm side of the plane -- is the
  // negative rotation about cross(dir, side). Verified against
  // the palm-frame decomposition: pressing chains read +33..+84
  // deg, the one backward case (little finger at near-full span)
  // reads -8.5 deg in both frames.
  const pipFlexOf = (B, T, planeN, pts) => {
    const dir = norm(sub(T, B));
    const side = norm(sub(planeN, mul(dir, dot(planeN, dir))));
    const nb = norm(M.vec.cross(dir, side));
    const s1 = norm(sub(pts[1], pts[0])), s2 = norm(sub(pts[2], pts[1]));
    return -Math.atan2(dot(M.vec.cross(s1, s2), nb), dot(s1, s2));
  };
  // CHAIN-LEVEL ROM CLAMPING (phase 2): the raw chain dumps the
  // whole fold into the PIP joint whenever the span is short --
  // measured up to 117 deg against the 100 deg ROM cap, worst in
  // hover/transit frames where nobody was looking. The distal
  // bend (DIP) starts at the frame's rest curl (16-32 deg of its
  // 70 deg cap), so the chain itself now trades fold from PIP
  // into DIP: if the PIP bend at the rest curl exceeds its cap,
  // the curl is raised (bisected, smallest sufficient) until the
  // PIP is inside its cap -- both joints then satisfy the ROM
  // table BY CONSTRUCTION and the tip still lands exactly. If
  // even the DIP cap cannot bring the PIP inside its cap the
  // span itself is infeasible; the chain is returned flagged
  // (.infeasible) and the caller repairs the span proximally
  // (knuckle away from the target -- see pose()). The returned
  // array carries .pip/.dip/.curlUsed/.infeasible for the tests.
  // Scalar bends of a raw chain. The PIP bend and the signed
  // PIP flexion of fingerChainRaw(B, T, lens, planeN, c)
  // depend only on (span, c, lens) -- the two-bone IK runs in
  // the (dir, side) plane, where seg1 = (a, h), the virtual
  // distal direction is ((span-a), -h), and segment 2 is that
  // direction rotated by psi about the plane normal (the
  // rotation sense flips when the joint sits past the target,
  // span < a). The clamp and slave bisections below evaluate
  // this closed form instead of building ~14 vector chains
  // per solve; the chains actually returned are still built
  // by fingerChainRaw, so drawn geometry is unchanged.
  // Validated against the vector chain on 60k random cases
  // (worst deviation 3e-9 rad, incl. clamped spans, 2026-11-08).
  const chainBendsAt = (span0, c, lens) => {
    const [l1, l2, l3] = lens;
    const L23 = Math.sqrt(l2 * l2 + l3 * l3 + 2 * l2 * l3 * Math.cos(c));
    const dist = Math.min(Math.max(span0, 0.02), (l1 + L23) * 0.999);
    const a = (l1 * l1 - L23 * L23 + dist * dist) / (2 * dist);
    const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
    const sLen = Math.hypot(a, h) || 1;
    const s1x = a / sLen, s1y = h / sLen;
    const vdLen = Math.hypot(span0 - a, h) || 1;
    const vdx = (span0 - a) / vdLen, vdy = -h / vdLen;
    const psi = Math.atan2(l3 * Math.sin(c), l2 + l3 * Math.cos(c));
    const th = (span0 - a) < 0 ? -psi : psi, co = Math.cos(th), si = Math.sin(th);
    const d2x = vdx * co - vdy * si, d2y = vdx * si + vdy * co;
    const dt = s1x * d2x + s1y * d2y, cr = s1x * d2y - s1y * d2x;
    return [Math.acos(Math.min(1, Math.max(-1, dt))), -Math.atan2(cr, dt)];
  };
  // Set by drawnMCPAngle around its measurement-only chain
  // builds so they skip the DIP-slave coupling solve (the
  // drawn chains in buildOne run the full solve).
  let CHAIN_FAST = false;
  // Scalar curl solve: every decision fingerChain makes --
  // the PIP cap trade, the PIP backward floor, the DIP
  // slave coupling -- is a function of the bends at a curl,
  // and the bends are the closed form chainBendsAt (the
  // vector chainBends/pipFlexOf readings on the built chain
  // are the same numbers, validated to 3e-9 rad). Solving
  // the curl scalarly first and building ONCE replaces up
  // to four vector builds + remeasures per chain; it was
  // the dominant cost of the bone build (the guard probes
  // build a chain per candidate root). The DIP bend of the
  // built chain is the curl itself by construction (the
  // distal segment is segment 2 rotated by exactly -curl),
  // and the PIP bend is chainBendsAt at the solved curl.
  const solveCurl = (span0, curl, lens) => {
    const PIPCAP = ROM.FINGER.PIP[1], DIPCAP = ROM.FINGER.DIP[1];
    let cUse = curl, infeasible = false, slaved = false;
    let bd = chainBendsAt(span0, curl, lens);
    if (bd[0] > PIPCAP) {
      if (chainBendsAt(span0, DIPCAP, lens)[0] > PIPCAP) { cUse = DIPCAP; infeasible = true; }
      else {
        let lo = curl, hi = DIPCAP;
        for (let i = 0; i < 12; i++) {
          const mid = (lo + hi) / 2;
          if (chainBendsAt(span0, mid, lens)[0] > PIPCAP) lo = mid; else hi = mid;
        }
        cUse = hi;
      }
      bd = chainBendsAt(span0, cUse, lens);
    }
    if (bd[1] < 0) {
      if (chainBendsAt(span0, 0, lens)[1] < 0) { cUse = 0; infeasible = true; }
      else {
        let lo = 0, hi = cUse;
        for (let i = 0; i < 12; i++) {
          const mid = (lo + hi) / 2;
          if (chainBendsAt(span0, mid, lens)[1] < 0.001) hi = mid; else lo = mid;
        }
        cUse = lo;
      }
      bd = chainBendsAt(span0, cUse, lens);
    }
    if (CARR.mode === 'bone' && CARR.dipSlave && !infeasible && !CHAIN_FAST) {
      const g = c => c - 0.69 * chainBendsAt(span0, c, lens)[0];
      if (g(0) <= 0 && g(DIPCAP) >= 0) {
        let lo = 0, hi = DIPCAP;
        for (let i = 0; i < 12; i++) { const mid = (lo + hi) / 2; if (g(mid) < 0) lo = mid; else hi = mid; }
        const bq = chainBendsAt(span0, hi, lens);
        if (bq[0] <= PIPCAP + 1e-9 && bq[1] >= -1e-9) { cUse = hi; slaved = true; bd = bq; }
      }
    }
    return { cUse, infeasible, slaved, pip: bd[0] };
  };
  // Planar chain geometry at a solved curl: segment-1
  // direction and tip position in the (dir, side) basis of
  // fingerChainRaw, in closed form (the same derivation as
  // chainBendsAt, carried to the tip: segment 2 at angle
  // thVd + sgn*psi, segment 3 at a further -sgn*curl, where
  // sgn = sign(span0 - a) is the orientation of the raw
  // build's rotation axis cross(vd, side)). Validated
  // against the vector chain on 30k random cases (worst
  // coordinate deviation 1.8e-15 m, 2026-11-08).
  const geomAt = (span0, c, lens) => {
    const [l1, l2, l3] = lens;
    const L23 = Math.sqrt(l2 * l2 + l3 * l3 + 2 * l2 * l3 * Math.cos(c));
    const dist = Math.min(Math.max(span0, 0.02), (l1 + L23) * 0.999);
    const a = (l1 * l1 - L23 * L23 + dist * dist) / (2 * dist);
    const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
    const psi = Math.atan2(l3 * Math.sin(c), l2 + l3 * Math.cos(c));
    const sgn = (span0 - a) < 0 ? -1 : 1;
    const thVd = Math.atan2(-h, span0 - a);
    const th2 = thVd + sgn * psi;
    const j2x = a + l2 * Math.cos(th2), j2y = h + l2 * Math.sin(th2);
    const th3 = th2 - sgn * c;
    return { a, h, tipX: j2x + l3 * Math.cos(th3), tipY: j2y + l3 * Math.sin(th3) };
  };
  // The drawn base-joint angle (drawnMCPAngle's measure)
  // without building the chain: solve the curl scalarly,
  // take segment 1 and the tip from geomAt, and project the
  // metacarpal against the fold-plane normal through them.
  // The guard probes this per candidate root; the closed
  // form replaces a full vector chain build per probe and
  // was the dominant remaining cost of the bone build.
  const drawnAngleCalc = (w, K, T, lens, planeN, curl) => {
    const span0 = Math.hypot(T[0] - K[0], T[1] - K[1], T[2] - K[2]);
    const sv = solveCurl(span0, curl, lens);
    const g = geomAt(span0, sv.cUse, lens);
    const dir = norm(sub(T, K));
    let side = sub(planeN, mul(dir, dot(planeN, dir)));
    side = Math.hypot(...side) < 1e-6 ? [0, 0, 1] : norm(side);
    const seg = add(mul(dir, g.a), mul(side, g.h));
    const tip = add(mul(dir, g.tipX), mul(side, g.tipY));
    let nrm = M.vec.cross(seg, tip);
    nrm = Math.hypot(...nrm) < 1e-9 ? M.n : norm(nrm);
    const meta = sub(K, w);
    const mp = sub(meta, mul(nrm, dot(meta, nrm)));
    if (Math.hypot(...mp) < 1e-9) return 0;
    return Math.acos(clamp(dot(norm(mp), norm(seg)), -1, 1));
  };
  function fingerChain(B, T, lens, planeN, curl = 0.35) {
    const span0 = Math.hypot(T[0] - B[0], T[1] - B[1], T[2] - B[2]);
    const sv = solveCurl(span0, curl, lens);
    const pts = fingerChainRaw(B, T, lens, planeN, sv.cUse);
    pts.pip = sv.pip; pts.dip = sv.cUse; pts.curlUsed = sv.cUse;
    pts.infeasible = sv.infeasible; pts.slaved = sv.slaved;
    return pts;
  }
  // Smallest knuckle->target span at which a finger's chain can
  // still meet BOTH caps (PIP at its cap with the DIP at its
  // own): the floor under the MCP guard's shrink lever and the
  // reference for the span repair. A pure function of the
  // segment lengths (the bends depend only on the span),
  // bisected once here.
  const MIN_SPAN = {};
  for (let f = 1; f <= 4; f++) {
    const lens = FINGER_LEN[f];
    let lo = 0.005, hi = lens[0] + lens[1] + lens[2];
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      const pts = fingerChainRaw([0, 0, 0], [mid, 0, 0], lens, [0, 0, 1], ROM.FINGER.DIP[1]);
      if (chainBends(pts)[0] > ROM.FINGER.PIP[1]) lo = mid; else hi = mid;
    }
    MIN_SPAN[f] = hi;
  }

  // ---- PAD CONTACT (STEP 2, 2026-11-10; the ROM solver's
  // contact model, CARR.romPad) ----------------------------
  // WHY THE DEFINITION CHANGED: every chain above lands the
  // END OF THE DISTAL BONE AXIS (pts[3]) on the target. A
  // real finger stops a string with the PULP of its distal
  // phalanx -- skin that sits a segment radius PALMAR of the
  // bone axis -- and the touching spot moves along the pad
  // as the finger rolls. Axis-tip contact therefore forces
  // the last segment to point INTO the string, which is
  // what drives the fold total and the placement angle
  // alpha up (both consults, point (2)).
  // DEFINITION: the contact point is the pad surface point
  //   P(s) = J2 + d3 * s + pal * r3
  // (J2 = DIP joint, d3 = distal segment direction, pal =
  // the unit normal of d3 in the fold plane on the flexion
  // (palmar) side, r3 = the finger's distal segment radius
  // from the live FINGER_R table, s = distance from the DIP
  // along the phalanx). The rolling freedom is s in
  // [PAD.lo, PAD.hi] x l3 -- the pulp, excluding the DIP
  // crease region and the nail-edge tip. The target is
  // UNCHANGED (the plan's stopped-string point + 1 mm, the
  // string's own radius read as skin compression), and the
  // contact is exact at P (error ~1e-16 m).
  // CONSTRUCTION: J2 -> P is a rigid link of length
  // Le = hypot(s, r3) at angle delta = atan2(r3, s) palmar
  // of d3, so the chain is the ordinary scalar solve on the
  // effective lengths [l1, l2, Le] with effective distal
  // bend c' = dip + delta; every cap stays on the TRUE
  // joints (PIP cap, PIP never backward, DIP in [0, cap],
  // the DIP slave dip = 0.69 x pip -- solveCurlPad). The
  // drawn chain is the true one ([root, PIP, DIP, axis
  // tip]); P rides on it as pts.padPt.
  const PAD = { lo: 0.40, hi: 0.90, order: [0.65, 0.55, 0.75, 0.45, 0.85, 0.40, 0.90] };
  const solveCurlPad = (span0, curl, lensE, delta) => {
    const PIPCAP = ROM.FINGER.PIP[1], DIPCAP = ROM.FINGER.DIP[1];
    const cLo = delta, cHi = DIPCAP + delta;
    let cUse = clamp(curl + delta, cLo, cHi), infeasible = false, slaved = false;
    let bd = chainBendsAt(span0, cUse, lensE);
    if (bd[0] > PIPCAP) {
      if (chainBendsAt(span0, cHi, lensE)[0] > PIPCAP) { cUse = cHi; infeasible = true; }
      else {
        let lo = cUse, hi = cHi;
        for (let i = 0; i < 14; i++) { const mid = (lo + hi) / 2; if (chainBendsAt(span0, mid, lensE)[0] > PIPCAP) lo = mid; else hi = mid; }
        cUse = hi;
      }
      bd = chainBendsAt(span0, cUse, lensE);
    }
    if (bd[1] < 0) {
      if (chainBendsAt(span0, cLo, lensE)[1] < 0) { cUse = cLo; infeasible = true; }
      else {
        let lo = cLo, hi = cUse;
        for (let i = 0; i < 14; i++) { const mid = (lo + hi) / 2; if (chainBendsAt(span0, mid, lensE)[1] < 0.001) hi = mid; else lo = mid; }
        cUse = lo;
      }
      bd = chainBendsAt(span0, cUse, lensE);
    }
    if (CARR.mode === 'bone' && CARR.dipSlave && !infeasible) {
      const g = c => (c - delta) - 0.69 * chainBendsAt(span0, c, lensE)[0];
      if (g(cLo) <= 0 && g(cHi) >= 0) {
        let lo = cLo, hi = cHi;
        for (let i = 0; i < 14; i++) { const mid = (lo + hi) / 2; if (g(mid) < 0) lo = mid; else hi = mid; }
        const bq = chainBendsAt(span0, hi, lensE);
        if (bq[0] <= PIPCAP + 1e-9 && bq[1] >= -1e-9) { cUse = hi; slaved = true; bd = bq; }
      }
    }
    return { cUse, dip: cUse - delta, infeasible, slaved, pip: bd[0] };
  };
  // fingerChainRaw's construction on the effective lengths,
  // returning the TRUE chain plus the pad point (built in
  // the same rotation frame, so P is exactly the effective
  // tip and the axis tip is the effective distal direction
  // rotated back by delta).
  function fingerChainPad(B, T, f, planeN, curl, sFrac) {
    const [l1, l2, l3] = FINGER_LEN[f], r3 = FINGER_R[f][2], sP = sFrac * l3;
    const Le = Math.hypot(sP, r3), delta = Math.atan2(r3, sP);
    const lensE = [l1, l2, Le];
    const span0 = Math.hypot(T[0] - B[0], T[1] - B[1], T[2] - B[2]);
    const sv = solveCurlPad(span0, curl, lensE, delta);
    const cE = sv.cUse;
    const L23 = Math.sqrt(l2 * l2 + Le * Le + 2 * l2 * Le * Math.cos(cE));
    const d = sub(T, B), dist = clamp(Math.hypot(...d), 0.02, (l1 + L23) * 0.999);
    const dir = norm(d);
    let side = sub(planeN, mul(dir, dot(planeN, dir)));
    side = Math.hypot(...side) < 1e-6 ? [0, 0, 1] : norm(side);
    const a = (l1 * l1 - L23 * L23 + dist * dist) / (2 * dist);
    const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
    const J = add(add(B, mul(dir, a)), mul(side, h));
    const vd = norm(sub(T, J));
    const psi = Math.atan2(Le * Math.sin(cE), l2 + Le * Math.cos(cE));
    const ax = norm(M.vec.cross(vd, side));
    const rot = (vec, ang) => {
      const c = Math.cos(ang), sn = Math.sin(ang);
      return add(add(mul(vec, c), mul(M.vec.cross(ax, vec), sn)), mul(ax, dot(ax, vec) * (1 - c)));
    };
    const d2 = rot(vd, psi);
    const J2 = add(J, mul(d2, l2));
    const d3 = rot(d2, -(cE - delta));
    const tip = add(J2, mul(d3, l3));
    const P = add(J2, mul(rot(d2, -cE), Le));
    const pts = [B, J, J2, tip];
    pts.padPt = P;
    pts.pad = { s: sP, sFrac, r: r3, normal: norm(sub(P, add(J2, mul(d3, sP)))) };
    pts.pip = sv.pip; pts.dip = sv.dip; pts.curlUsed = sv.dip;
    pts.infeasible = sv.infeasible; pts.slaved = sv.slaved;
    return pts;
  }

  // Thumb chain (rk round 2): the finger solver above folds the
  // chain at ONE virtual joint with a fixed distal curl -- for
  // the thumb's short spans that dumped a 90-160 deg kink into
  // the MCP joint, bowed toward the back-of-hand side, which rk
  // flagged in every variant. This solver works in the thumb's
  // bend plane (root->tip direction x palmar side) and
  // DISTRIBUTES the fold: the IP bend grows coupled to the MCP
  // bend, the MCP bend is bisected so the resultant length
  // matches the span, both capped by ROM.THUMB; if the span is
  // shorter than the capped chain can fold to, the caller
  // retreats the root toward the wrist (proximal fix) before
  // this runs. Every bend is palmar-signed BY CONSTRUCTION (the
  // segment angles increase monotonically toward the palmar
  // side); the base angle gamma (the CMC joint) aligns the
  // resultant onto the root->tip line, which puts the first
  // joint on the dorsal side of the chord -- the knuckle side,
  // a smooth arc hugging toward the neck -- never a backward
  // kink. Returns the bend angles for the sweep report.
  function thumbChain(B, T, dorsalRef) {
    const [l1, l2, l3] = THUMB_LEN;
    const B1C = ROM.THUMB.MCP[1], B2C = ROM.THUMB.IP[1];
    let dirv = sub(T, B), dist = Math.hypot(...dirv);
    dirv = norm(dirv);
    let palmar = sub(mul(dorsalRef, -1), mul(dirv, -dot(dorsalRef, dirv)));
    palmar = Math.hypot(...palmar) < 1e-6 ? [0, 0, 1] : norm(palmar);
    const resLen = (b1, b2) => Math.hypot(
      l1 + l2 * Math.cos(b1) + l3 * Math.cos(b1 + b2),
      l2 * Math.sin(b1) + l3 * Math.sin(b1 + b2));
    const dT = clamp(dist, 0.03, (l1 + l2 + l3) * 0.999);
    // The fold is DISTRIBUTED like a real gripping thumb: the
    // IP bend grows with the MCP bend (b2 = 0.35 + 1.1*b1, so a
    // gentle MCP bend keeps a gentle tip curl and a deep one
    // curls the tip most), and b1 is bisected so the resultant
    // length matches the span. Only if the span is shorter than
    // even that distribution reaches at the MCP cap does the IP
    // bend rise alone to its own cap.
    const b2of = b1 => Math.min(B2C, 0.35 + 1.1 * b1);
    // PHASE B (2026-11-08): MCP-FIRST distribution. The
    // coupled curve above spends the fold at the IP joint:
    // at the neck rest span (60.6 mm -- exactly the coupled
    // chain's minimum resultant, where the short-span
    // pullback parked it) it reads MCP 55 deg (cap) / IP
    // 80.6 deg in EVERY settled neck frame, the distal
    // segment folded back on itself while floating 10.5 mm
    // off the neck. A resting thumb folds CMC/MCP-first
    // with the IP nearly straight (research: IP ~0-30 deg
    // at rest). Within the span band the soft curve covers
    // (resultants 76.9-95.0 mm), cap the IP at ~35 deg and
    // let the MCP take the fold: b2 = min(0.61, 0.35 +
    // 1.1*b1). Below the band the legacy coupled fold
    // remains -- a genuinely short span has no other fold,
    // and the pullback (now targeted at this band, see
    // thumbSolveFor) keeps settled frames out of it.
    const B2_SOFT = 0.61;
    const b2ofSoft = b1 => Math.min(B2_SOFT, 0.35 + 1.1 * b1);
    let b1 = 0, b2 = b2of(0);
    if (dT >= resLen(B1C, b2ofSoft(B1C)) && dT <= resLen(0, b2ofSoft(0))) {
      let lo = 0, hi = B1C;
      for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; if (resLen(mid, b2ofSoft(mid)) > dT) lo = mid; else hi = mid; }
      b1 = (lo + hi) / 2; b2 = b2ofSoft(b1);
    } else if (dT < resLen(B1C, b2of(B1C))) {
      b1 = B1C; // shorter than the distributed fold reaches
      if (dT >= resLen(b1, B2C)) {
        let lo = b2of(b1), hi = B2C;
        for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; if (resLen(b1, mid) > dT) lo = mid; else hi = mid; }
        b2 = (lo + hi) / 2;
      } else b2 = B2C;
    } else if (dT < resLen(0, b2)) {
      let lo = 0, hi = B1C;
      for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; if (resLen(mid, b2of(mid)) > dT) lo = mid; else hi = mid; }
      b1 = (lo + hi) / 2; b2 = b2of(b1);
    } else if (dT > resLen(0, b2)) {
      // OVER-REACH (bone finalization, 2026-11-08): the span
      // exceeds what the distributed fold reaches with the MCP
      // straight (resLen(0, 0.35) ~ 95.0 mm against the 95.9 mm
      // clamp) -- a reaching thumb straightens its IP joint
      // instead of falling short, so bisect the IP bend DOWN
      // from its 0.35 floor until the resultant meets the span
      // (resLen(0, b2) decreases monotonically on [0, 0.35]).
      // The tip then lands exactly out to the clamp; beyond
      // it, placement (the wrist trials score the predicted
      // error) is the fix, not the chain.
      let lo = 0, hi = b2;
      for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; if (resLen(0, mid) > dT) lo = mid; else hi = mid; }
      b2 = (lo + hi) / 2;
    }
    const Vx = l1 + l2 * Math.cos(b1) + l3 * Math.cos(b1 + b2);
    const Vy = l2 * Math.sin(b1) + l3 * Math.sin(b1 + b2);
    const gamma = -Math.atan2(Vy, Vx);
    const e = a => add(mul(dirv, Math.cos(a)), mul(palmar, Math.sin(a)));
    const P1 = add(B, mul(e(gamma), l1));
    const P2 = add(P1, mul(e(gamma + b1), l2));
    const P3 = add(P2, mul(e(gamma + b1 + b2), l3));
    return { points: [B, P1, P2, P3], beta1: b1, beta2: b2, gamma, tipErr: Math.hypot(...sub(P3, T)) };
  }

  // Same solver as cello-model's eulerZYX: angles that put a piece()'s
  // local X/Y/Z onto the given orthonormal frame.
  function eulerZYX(xA, yA, zA) {
    const ry = Math.atan2(-xA[2], Math.hypot(xA[0], xA[1]));
    return [Math.atan2(yA[2], zA[2]), ry, Math.atan2(xA[1], xA[0])];
  }

  // Keyframe track with "arrive just before the event" easing.
  function track(keys) { // keys: [{t, v:[x,y,z]}] sorted
    return t => {
      if (!keys.length) return null;
      if (t <= keys[0].t) return keys[0].v;
      for (let i = 0; i < keys.length - 1; i++) {
        const a = keys[i], b = keys[i + 1];
        if (t < b.t) {
          const lead = Math.min(0.18, Math.max(0.03, (b.t - a.t) * 0.85));
          const p = smooth((t - (b.t - lead)) / lead);
          return lerp(a.v, b.v, p);
        }
      }
      return keys[keys.length - 1].v;
    };
  }
  const scalarTrack = keys => { // [{t, v:number}]
    const tr = track(keys.map(k => ({ t: k.t, v: [k.v, 0, 0] })));
    return t => tr(t)[0];
  };

  function plan(song) {
    const o = song.celloOptions || {};
    const res = F.plan(song, {
      secPerBeat: o.secPerBeat || 0.5,
      maxStrokeBeats: o.maxStrokeBeats || 2,
      openStringCost: o.openStringCost != null ? o.openStringCost : 0.1
    });
    song.cello = res;
    // Left-hand anchor keyframes: one per group with a stopped note.
    // The anchor is the knuckle reference of the group's primary finger.
    const keys = [], bowKeys = [], strKeys = [];
    let lastAnchor = null;
    song.notes.forEach((n, i) => {
      const r = res.notes[i];
      if (r.mode !== 'open') {
        const anchorK = r.mode === 'thumb' ? r.position : r.position;
        const pt = M.boardPoint(r.string, F.distFromNut(r.semitone) / 1000);
        keys.push({ t: n[0], v: pt, finger: r.finger, string: r.string, semitone: r.semitone, mode: r.mode, position: r.position });
        lastAnchor = pt;
      }
      bowKeys.push({ t: n[0], v: r.bowFrom }, { t: n[0] + n[1], v: r.bowTo });
      strKeys.push({ t: n[0], v: r.string });
    });
    song.cello.tracks = {
      anchor: track(keys), anchorKeys: keys,
      bow: scalarTrack(bowKeys), bowKeys,
      string: scalarTrack(strKeys)
    };
    return res;
  }

  // Which planned notes sound at time t (with a little anticipation for
  // finger preparation), and the current hand placement.
  function activeAt(song, t) {
    const res = song.cello;
    let current = null, sounding = [];
    song.notes.forEach((n, i) => {
      const r = res.notes[i];
      if (n[0] <= t && n[0] + n[1] > t) { sounding.push({ n, r }); if (r.mode !== 'open') current = r; }
    });
    if (!current) { // most recent stopped placement at or before t
      for (let i = song.notes.length - 1; i >= 0; i--) {
        if (song.notes[i][0] <= t && res.notes[i].mode !== 'open') { current = res.notes[i]; break; }
      }
    }
    if (!current) { // before the first stopped note of the song, the
      // hand waits AT the upcoming placement (the anchor track already
      // sits there) -- without this the free fingers hovered at a
      // default neck position while the wrist waited at the first
      // (e.g. thumb-position) anchor, tearing the hand apart by up to
      // ~0.29 m during an intro (The Swan enters at t = 6 s).
      for (let i = 0; i < song.notes.length; i++) {
        if (res.notes[i].mode !== 'open') { current = res.notes[i]; break; }
      }
    }
    return { sounding, current };
  }

  function poseLegacy(song, t) {
    if (!song.cello) plan(song);
    const res = song.cello, tr = res.tracks;
    const { sounding, current } = activeAt(song, t);
    const mode = current ? current.mode : 'neck';
    const anchorString = current ? current.string : 2;
    // Hand anchor point (on the board, under the hand).
    let anchorPt = tr.anchor(t);
    if (!anchorPt) anchorPt = M.boardPoint(2, F.distFromNut(2) / 1000);
    // Vibrato: long sounding notes, after a 0.3 s settle.
    let vib = 0;
    for (const { n } of sounding) if (n[1] >= 0.8 && t - n[0] > 0.3 && n[0] + n[1] - t > 0.1)
      vib = Math.max(vib, Math.min(1, (t - n[0] - 0.3) / 0.4) * Math.sin((t - n[0]) * 2 * Math.PI * 5.4) * 0.004);
    if (vib) anchorPt = add(anchorPt, mul(M.u, vib));
    // ---- Left-hand posture, rk's playing-form spec ----
    // A continuous posture parameter lam follows the hand's distance
    // from the nut (it rides the eased anchor track, so it never
    // snaps at the neck/thumb boundary):
    //   lam = 0 (neck root): the back of the hand faces the audience
    //     and the fingers stay comparatively straight at the base
    //     joint, reaching over the fingerboard nearly extended, the
    //     hook concentrated in the tip joints.
    //   lam = 1 (fingerboard end / thumb positions): the hand rolls
    //     ~100 deg about the neck axis so the back of the hand faces
    //     the player's left; the fingers bend FROM the base joint
    //     (short, hooked chains) and the fingertips point back toward
    //     the player.
    // The hand is built palm-frame first (rebuilt 2026-11). The
    // palm's distal axis (wrist -> middle knuckle), in (u, v, n)
    // components, is the PINCH direction (rk's correction): the
    // hand wraps the neck from its back-left -- the wrist sits
    // BEHIND the neck axis (the axis' -n side) and toward the
    // A-string side (-v, the player's left across the neck), the
    // thumb rests on the back-left ridge, and the fingers curl
    // over the board from that side, so the neck sits between
    // thumb and fingers. A POSITIVE v component here puts the
    // wrist on the -v side of the knuckles (wrist = knuckle -
    // axis * PALM_LEN). The pre-fix axis (v -0.52, n 0.70) put
    // the wrist in FRONT of the axis (+38 mm) and toward the
    // C side (+62 mm): measured over 116 neck frames, palm
    // centre +71 mm audience-side -- the hand draped over the
    // front-right and no test asserted the side. The wrist JOINT
    // is PALM_LEN proximal of the middle knuckle along this axis
    // (then pinched to the variant's back offset, below), the
    // palm plate spans wrist -> knuckle row, and the finger
    // chains run from roots ON the row. ROUND 2 (rk): the axis
    // seed is now along-neck dominant in every variant (see
    // VARIANTS) -- phase 1's off-board axis (u ~ 0.2, n ~ 0.96)
    // had put the wrist up beside the knuckles, which bent the
    // DRAWN base joints to ~160 deg and left the thumb a 28-65
    // mm span for its 96 mm chain.
    const dA = M.SCALE - dot(sub(anchorPt, M.AB), M.u); // hand distance from the nut
    const lam = smooth((dA - 0.20) / 0.14);
    const phi = lam * 1.745; // hand roll about the neck axis, 0 -> ~100 deg
    const backN = add(mul(M.n, Math.cos(phi)), mul(M.v, -Math.sin(phi))); // back-of-hand normal
    const sw = Math.sin(Math.PI * lam);
    const axN = PLACE.axisNeck || [VARI.wristU, VARI.wristSide, VARI.wristN], axE = PLACE.axisEnd;
    const palmAxis = norm(add(
      mul(M.u, slerp(axN[0], axE[0], lam)),
      add(mul(M.v, slerp(axN[1], axE[1], lam)),
        mul(M.n, slerp(axN[2], axE[2], lam)))));
    // Finger approach: knuckle = target + appDir * (reach * rho).
    // Neck: rho ~ 0.98 (nearly straight chain, tip curl 0.55) with
    // the approach rotated toward the nut so the knuckle row rides
    // ~33 mm off the board surface, and tilted a touch toward the
    // player's left (-v): the fingers wrap over the board FROM
    // the back-left pinch, not squarely from the front. End:
    // rho ~ 0.58 (folded chain, tip curl 0.28) with the approach
    // swung toward the player's left, following the hand roll.
    // The chains always hook in the string's sagittal plane
    // (bulge reference M.n): in the end posture the knuckle sits
    // to the player's left of the target, so the finger travels
    // across and the folded tip ends pointing back toward the
    // player (-n).
    const curlF = slerp(PLACE.curlNeck, PLACE.curlEnd, lam), rho = slerp(PLACE.rhoNeck, PLACE.rhoEnd, lam);
    const appDir = norm(add(
      mul(M.u, slerp(PLACE.appNeck[0], PLACE.appEnd[0], lam)),
      add(mul(M.v, slerp(PLACE.appNeck[1], PLACE.appEnd[1], lam)), mul(M.n, slerp(PLACE.appNeck[2], PLACE.appEnd[2], lam)))));
    // Fingers. Targets first (stopping fingers on their planned
    // string point, free fingers hovering over their upcoming
    // notes), then the knuckles: with one shared approach direction
    // the roots were parallel translates of the targets and spanned
    // up to ~0.16 m along the board -- a rake, not a hand, and no
    // hand-shaped palm could cover them. Instead the roots sit on a
    // compact knuckle row (spacing 22 mm) through the primary
    // finger's root, each chain tilted to its row station at its
    // canonical length. Free fingers angle forward from the hand
    // to their hover points, as real fingers do.
    const fingers = {};
    const stopping = {};
    for (const { r } of sounding) if (r.mode !== 'open' && r.finger !== 'T') stopping[r.finger] = r;
    const targets = {}, contacts = {}, reaches = {};
    for (let f = 1; f <= 4; f++) {
      const st = stopping[f];
      let target, contact = false;
      if (st) {
        target = add(M.boardPoint(st.string, F.distFromNut(st.semitone) / 1000), mul(M.n, 0.001));
        contact = true;
      } else if (mode === 'thumb') {
        // In thumb position free fingers hover over the board nearby.
        const k = (current ? current.position : 12) + 2 + (f - 1);
        target = add(M.boardPoint(anchorString, F.distFromNut(Math.min(k, 24)) / 1000), mul(M.n, 0.016));
      } else {
        const base = current ? current.position : 2;
        const k = base + (f - 1);
        target = add(M.boardPoint(anchorString, F.distFromNut(k) / 1000), mul(M.n, 0.014));
      }
      if (vib && contact) target = add(target, mul(M.u, vib));
      targets[f] = target; contacts[f] = contact;
      const [l1, l2, l3] = FINGER_LEN[f];
      reaches[f] = (l1 + Math.sqrt(l2 * l2 + l3 * l3 + 2 * l2 * l3 * Math.cos(curlF))) * rho;
    }
    // Primary finger: the stopping finger whose target defines the
    // hand placement (nearest the anchor); if none stops, the
    // current placement's finger.
    let prim = 0, primD = Infinity;
    for (let f = 1; f <= 4; f++) if (contacts[f]) {
      const d = Math.hypot(...sub(targets[f], anchorPt));
      if (d < primD) { primD = d; prim = f; }
    }
    if (!prim) prim = (current && current.finger >= 1 && current.finger <= 4) ? current.finger : 1;
    // Free fingers hover near the hand, not stretched out over
    // their upcoming notes: pull each hover target 35% toward the
    // primary target (keeping its hover lift). A relaxed hand's
    // free fingertips stay within the hand's own span; the stretched
    // hovers were what forced the knuckle row (and the palm fitted
    // to it) up to ~0.16 m long in low positions.
    for (let f = 1; f <= 4; f++) if (!contacts[f] && f !== prim) {
      targets[f] = add(lerp(targets[prim], targets[f], 0.65), mul(M.n, 0.0046));
      // Cap the hover distance from the primary target at 55 mm:
      // a free fingertip hovers within the hand's own reach, it
      // does not stretch out over a note a hand-span away (the
      // uncapped hovers were what raked the knuckle row open).
      const hd = sub(targets[f], targets[prim]), hl = Math.hypot(...hd);
      if (hl > 0.055) targets[f] = add(targets[prim], mul(hd, 0.055 / hl));
    }
    const rowDir = norm(sub(M.BOARD.dir, mul(appDir, dot(M.BOARD.dir, appDir))));
    // Knuckle row: each root keeps its finger's canonical chain
    // length |root - target| = reach * rho (fingertip contact
    // exact by construction) while its station along the row --
    // dot(root - root_prim, rowDir) -- is the DERIVED row's
    // station difference (MC_ROW, Stage 2: the rest skeleton's
    // own row, ~18.7 mm spacing -- the retired pose row's
    // (f - prim) * 22 mm stations described the spoke
    // skeleton): the closed-form fan tilt in the {appDir,
    // rowDir} plane that lands the root on its station. The
    // derived ARC (setback along the palm's proximal
    // direction, middle most distal, little 20.8 mm back) is
    // then applied and re-projected onto the reach sphere
    // (two passes), which moves the station by ~1 mm at most:
    // the row carries the skeleton's arc with contact still
    // exact. The row's Z (rest-cup) offsets are NOT applied
    // here: measured rejection (Stage 2) -- shifting the
    // outer roots up to 12 mm along the row plane's normal
    // pushed the little finger's chain across the neck ridge
    // (capsule graze -3.4 mm against the -2.5 bound) and put
    // finger centrelines inside the board box in low neck
    // frames. In the canonical frame those offsets are the
    // arch read on a wrist-rooted row; the pose row is rooted
    // on TARGETS, and there the arch is produced by the bone
    // frames plus the flexion-driven cup pass in finishHand
    // (the research rule: cupping is an action of the CMC
    // joints as their fingers flex, not a static row offset).
    const primRoot = add(targets[prim], mul(appDir, reaches[prim]));
    const proxRaw = mul(palmAxis, -1);
    const proxDir = norm(sub(proxRaw, mul(rowDir, dot(proxRaw, rowDir))));
    const rootOf = f => {
      if (f === prim) return primRoot;
      const D = (MC_ROW.s[f] - MC_ROW.s[prim]) - dot(sub(targets[f], targets[prim]), rowDir);
      const g = clamp(D / reaches[f], -0.92, 0.92);
      const w = g / Math.sqrt(1 - g * g);
      let root = add(targets[f], mul(norm(add(appDir, mul(rowDir, w))), reaches[f]));
      for (let it = 0; it < 2; it++) {
        const shifted = add(root, mul(proxDir, -(MC_ROW.a[f] - MC_ROW.a[prim]) / 2));
        root = add(targets[f], mul(norm(sub(shifted, targets[f])), reaches[f]));
      }
      return root;
    };
    const knuckles = {};
    for (let f = 1; f <= 4; f++) knuckles[f] = rootOf(f);
    // R2 knuckle-row roll: rotate the roots about the row axis
    // (through the primary root, along rowDir). The row keeps
    // its stations, but every chord tilts with its root, which
    // swings each finger's palm fold plane toward (or away
    // from) its metacarpal -- the row repositioning half of
    // the R2 redesign. Contact is untouched (the chains land
    // on their targets from any root).
    if (CARR.mode !== 'current' && CARR.rootRollDeg) {
      const bta = CARR.rootRollDeg * Math.PI / 180, cb = Math.cos(bta), sb = Math.sin(bta);
      for (let f = 1; f <= 4; f++) {
        if (f === prim) continue;
        const rel = sub(knuckles[f], primRoot);
        knuckles[f] = add(primRoot, add(add(mul(rel, cb), mul(M.vec.cross(rowDir, rel), sb)),
          mul(rowDir, dot(rowDir, rel) * (1 - cb))));
      }
    }
    // ---- Wrist placement + drawn base-joint (MCP) guard -------
    // The wrist is placed at an ANATOMICAL TARGET in the neck
    // frame (rk round 2): down-neck of the middle knuckle's
    // station by the variant's stationBack, just behind the neck
    // axis along the board normal (wristBack), and toward the
    // player's left (wristSideM) -- where a real wrist joint
    // centre sits in neck positions, under the fingerboard's
    // left edge. As lam -> 1 (thumb positions) the placement
    // blends to the palm-axis seed (midRoot - palmAxis*PALM_LEN),
    // which measured correctly there. The earlier construction
    // (seed + a board-normal slide cap + a length clamp) was
    // over-constrained: the guards deformed the wrist to ~70 mm
    // radial from the axis with the palm axis ~0.9 off-board,
    // and no elbow on the hinge circle could then keep the
    // signed wrist flexion under ~39 deg in neck positions.
    // Two safety guards remain: a radial floor off the neck
    // cylinder, and the palm-length band, applied by scaling the
    // actual displacement. The second argument relaxes the
    // front/back target (the MCP guard's proximal lever).
    const neckAxisDir = norm(sub(M.NECK_B, M.NECK_A));
    const axisLen = Math.hypot(...sub(M.NECK_B, M.NECK_A));
    const placeWrist = (midR, fbOff, stOff = 0, sdOff = 0, axOff = 0, latOff = 0, rowOff = 0, rowDir = null) => {
      // axOff shifts the seed along the palm axis (the wrist
      // sits a few mm nearer/farther within the palm-length
      // band below): the only placement lever that still moves
      // the wrist at lam = 1, where the neck-frame target is
      // weighted out entirely. latOff shifts it sideways along
      // the across-strings direction (perpendicular to the
      // axis), which rotates the palm axis itself -- the lever
      // the thumb-position deviation needs (measured: at the
      // worst Swan frames the whole hinge circle is wedge-
      // infeasible until the palm axis turns a few degrees).
      // rowOff shifts it along the KNUCKLE ROW direction --
      // the in-palm-plane swing of the palm axis, which the
      // deviation floor answers to most strongly (measured at
      // the worst frame: -0.16 rad of swing takes the floor
      // from 26 deg to 16 deg; the same roll buys 1 deg).
      let latDir = sub(M.v, mul(palmAxis, dot(M.v, palmAxis)));
      latDir = Math.hypot(...latDir) > 1e-9 ? norm(latDir) : [1, 0, 0];
      let rowDirW = rowDir ? sub(rowDir, mul(palmAxis, dot(rowDir, palmAxis))) : null;
      rowDirW = rowDirW && Math.hypot(...rowDirW) > 1e-9 ? norm(rowDirW) : latDir;
      const seedW = add(add(sub(midR, mul(palmAxis, PALM_LEN + axOff)), mul(latDir, latOff)), mul(rowDirW, rowOff));
      const axPt = add(M.NECK_A, mul(neckAxisDir,
        clamp(dot(sub(midR, M.NECK_A), neckAxisDir), 0, axisLen)));
      let neckW = add(add(axPt, mul(neckAxisDir, -((PLACE.stationBack !== null ? PLACE.stationBack : VARI.stationBack) + stOff))),
        add(mul(M.BOARD.normal, fbOff), mul(M.v, -((PLACE.wristSideM !== null ? PLACE.wristSideM : VARI.wristSideM) + sdOff))));
      // WRAP carriage (dev only): rotate the target's radial
      // offset around the neck axis toward the board-back
      // direction by wrapDeg (the wrist is carried around the
      // back of the neck; the sense is fixed geometrically so
      // a positive angle always travels from the player's-left
      // side toward the back). 'chord' station compensation
      // then slides the target along the axis so the wrist ->
      // middle-knuckle chord keeps its unwrapped length.
      if (CARR.mode === 'wrap' && CARR.wrapDeg) {
        let bdW = sub(mul(M.n, -1), mul(neckAxisDir, dot(mul(M.n, -1), neckAxisDir)));
        bdW = Math.hypot(...bdW) > 1e-9 ? norm(bdW) : [0, 0, 1];
        const offW = sub(neckW, axPt), axC = dot(offW, neckAxisDir);
        const radW = sub(offW, mul(neckAxisDir, axC));
        if (Math.hypot(...radW) > 1e-9) {
          const sgnW = dot(M.vec.cross(neckAxisDir, radW), bdW) < 0 ? -1 : 1;
          const aW = sgnW * CARR.wrapDeg * Math.PI / 180, cW = Math.cos(aW), sW = Math.sin(aW);
          const radR = add(add(mul(radW, cW), mul(M.vec.cross(neckAxisDir, radW), sW)),
            mul(neckAxisDir, dot(neckAxisDir, radW) * (1 - cW)));
          let axNew = axC;
          if (CARR.wrapStation === 'chord') {
            const L0 = Math.hypot(...sub(neckW, midR));
            const dW = sub(add(axPt, radR), midR), da = dot(dW, neckAxisDir);
            const disc = da * da - (Math.hypot(...dW) ** 2 - L0 * L0);
            let sNew = disc >= 0 ? -da + (Math.abs(-da + Math.sqrt(disc) - axC) < Math.abs(-da - Math.sqrt(disc) - axC) ? Math.sqrt(disc) : -Math.sqrt(disc)) : -da;
            axNew = clamp(sNew, -0.11, 0.02);
          }
          neckW = add(axPt, add(radR, mul(neckAxisDir, axNew)));
        }
      }
      let w = add(mul(neckW, 1 - lam), mul(seedW, lam));
      const axPtOf = p => add(M.NECK_A, mul(neckAxisDir,
        clamp(dot(sub(p, M.NECK_A), neckAxisDir), 0, axisLen)));
      const axPtW = axPtOf(w);
      const radial = sub(w, axPtW), rd = Math.hypot(...radial);
      if (rd < VARI.wristFloor && rd > 1e-9) w = add(w, mul(radial, (VARI.wristFloor - rd) / rd));
      const stretched = Math.hypot(...sub(midR, w));
      // Wrap mode (wrapBand 'off'): the band is skipped -- its
      // chord-scaling would drag a wrapped wrist back toward
      // the front (see the carriage comment at setCarriage).
      if (!(CARR.mode === 'wrap' && CARR.wrapBand === 'off')) {
        if (stretched > 0.0995) w = add(midR, mul(sub(w, midR), 0.0995 / stretched));
        else if (stretched < 0.082) w = add(midR, mul(sub(w, midR), 0.082 / stretched));
      }
      // R1/R3 carriage roll: rotate the placed wrist about the
      // neck axis (radial distance preserved; the palm-length
      // band is re-clamped after, since the middle knuckle sits
      // off-axis). Weighted out as lam -> 1, where the seed
      // placement takes over from the neck-frame target.
      if (CARR.mode !== 'current' && CARR.rollDeg) {
        const al = CARR.rollDeg * Math.PI / 180 * (CARR.mode === 'r3' ? 0.5 : 1) * (1 - lam);
        if (al) {
          const rel = sub(w, axPtW), ca = Math.cos(al), sa = Math.sin(al);
          w = add(axPtW, add(add(mul(rel, ca), mul(M.vec.cross(neckAxisDir, rel), sa)),
            mul(neckAxisDir, dot(neckAxisDir, rel) * (1 - ca))));
          const st2 = Math.hypot(...sub(midR, w));
          if (st2 > 0.0995) w = add(midR, mul(sub(w, midR), 0.0995 / st2));
          else if (st2 < 0.082) w = add(midR, mul(sub(w, midR), 0.082 / st2));
        }
      }
      return w;
    };
    // DRAWN MCP (rk round 2): the angle a viewer measures -- the
    // metacarpal line (wrist -> knuckle) against the proximal
    // phalanx, projected into the finger's bend plane. Phase 1
    // reported the CHAIN-internal angle (proximal phalanx vs the
    // knuckle->tip chord, <= 61 deg) and certified the hand
    // "within ROM" while the drawn angle ran 111-143 deg: with
    // the old off-board palm axis the metacarpal pointed back
    // across the chord, so the visible base joint folded ~160 deg
    // in the worst renders. rk's cap: 90 deg, every finger, every
    // frame. The guard below enforces it against a provisional
    // wrist here and against the final wrist in the assembly,
    // with two levers, both proximal-safe: shrink the finger's
    // reach (knuckle toward its target -- the chain folds more
    // at PIP/DIP and segment 1 rotates toward the metacarpal
    // line) and rotate the knuckle around its target in the
    // wrist-knuckle-target plane toward the wrist side. Contact
    // is untouched: the chain always lands on its target.
    const MCP_CAP = 1.56; // 89.4 deg: margin under rk's 90 (at 1.54 the guard's whisker-thin excess over its own cap forced the wrist search into a dragged corner with a ~53 mm palm in finger-1-led neck frames; rk's rule is the 90 deg line itself)
    // PALM-LENGTH FLOOR (bone finalization debit (c)): the
    // middle knuckle's wrist distance IS the palm length
    // (section 8 asserts [60, 100] mm). The bone hand's guard
    // travel swung the middle root to 21.7 mm in low neck
    // frames (the rotate lever walks the root around its
    // target toward the wrist, and on its reach sphere a root
    // can approach the wrist to ||T - w| - reach|). The floor
    // is enforced by REPAIR, not by freezing the levers --
    // freezing left the drawn-MCP cap unsatisfiable in
    // exactly the frames that start inside the floor (the
    // snapshot palm runs ~53 mm in finger-1-led neck frames),
    // and with no feasible trial at any wrist those frames
    // fell back to fallback-3 elbows. See the repair at the
    // end of correctMCP; the wrist trials also score the
    // final palm length.
    const PALM_FLOOR = 0.062;
    let k2RepairTarget = null; // attempt()-level repair anchor for the middle root
    let fhAnchor = null; // finishHand-entry roots + hover flags (Phase B restoration anchor)
    // (A finalBuild gate for the Phase B trial-time work was
    // measured and REJECTED: gating either the hover ladder
    // or the finishHand root restoration out of the search
    // trials broke the elbow certification the trials exist
    // to guarantee -- Prelude @67.0 viol 0.010 and @46.9
    // viol 0.029 respectively. Trial/final consistency is
    // load-bearing; the pose cost stands as measured.)
    let fhAnchorLive = false; // true only during finishHand's final guard pass
    let restoreLive = false; // Phase B: root restoration runs only in the provisional
    // guard pass and finishHand's final pass (fhAnchorLive) -- running it in every
    // attempt pre-pass and alternation round cost ~30 ms/pose of bisection chains
    // for assemblies that finishHand re-derives anyway.
    let snapRoots = null; // the placement snapshot's roots (provisional, restored):
    // the fallback anchor when a guard walk has parked a root on the wrist and
    // poisoned the nearer anchors (section 8's wrist->knuckle fan floor).
    let mcpSync = null; // set by the post-coplanarity pass to keep roots[] in step
    // Fold (bend-plane) bulge reference for the chains: the
    // shipped build folds in the board's sagittal plane (M.n);
    // the carriage redesign modes fold in / toward the palm
    // plane instead (bulge reference = the palm frame's dorsal
    // axis). Set provisionally from palmFrameOf before each
    // guard pass and finally from finishHand's drawn frame.
    let bendN = M.n;
    const bendNFor = pz => CARR.mode === 'current' ? M.n
      : CARR.mode === 'r3' ? norm(add(M.n, pz))
      : pz;
    // Per-finger metacarpal (bone) frame dorsal axis, CARR
    // 'bone' (see the setCarriage comment): the back-of-hand
    // normal projected perpendicular to the finger's own
    // metacarpal (wrist -> root), yawed about the metacarpal
    // by the finger's fan angle. The chain's bulge reference
    // in this mode, so the finger folds in its own flexion
    // plane span(metacarpal, dorsal) -- a hinge in its own
    // frame by construction.
    const boneZOf = (f, w, K) => {
      const m = norm(sub(K, w));
      let z = sub(backN, mul(m, dot(backN, m)));
      if (Math.hypot(...z) < 1e-6) z = sub(M.n, mul(m, dot(M.n, m)));
      z = norm(z);
      const psi = (CARR.fanYawBase + CARR.fanYawSpread * (f - 2)) * Math.PI / 180;
      if (psi) {
        const c = Math.cos(psi), s = Math.sin(psi);
        z = norm(add(add(mul(z, c), mul(M.vec.cross(m, z), s)), mul(m, dot(m, z) * (1 - c))));
      }
      return z;
    };
    const bendNOf = (f, w, K) => CARR.mode === 'bone' ? boneZOf(f, w, K) : bendN;
    const drawnMCPAngle = (w, K, T, f, planeZ) => {
      // BONE mode measures the REAL chain (DIP slave applied):
      // the slave moves the tip, the tip sets the fold-plane
      // normal this angle is projected against, and the fast
      // (unslaved) probe read ~1-3 deg under the drawn angle
      // in ~1,500 frames (worst drawn 115 deg against a 89.4
      // fast reading). Other modes have no slave; their fast
      // probe is exact.
      CHAIN_FAST = CARR.mode !== 'bone';
      const ang = (CARR.mode === 'bone' && CARR.palmFold)
        ? drawnAnglePalm(w, K, T, f)
        : drawnAngleCalc(w, K, T, FINGER_LEN[f], bendNOf(f, w, K), curlF);
      CHAIN_FAST = false;
      return ang;
    };
    // PALM-PLANE FOLD (solver redesign, rk 2026-11-08;
    // CARR.palmFold, bone mode only). The bone build above
    // folds each chain in span(chord, dorsal axis) -- the
    // plane through the knuckle->target chord -- so the
    // drawn MCP the guard enforces is the angle between the
    // metacarpal's PROJECTION into that plane and segment 1:
    // a wrap residue, not the joint's flexion. Measured
    // consequence (Phase B close-out, placement variants
    // V1-V3): at natural spans the projected angle reads over
    // the cap, the guard crushes spans 8-20 mm to satisfy it,
    // and PIP+DIP ~ 120 deg follows (neck contact fold
    // totals 150-207 deg against a real ~90-140); in thumb
    // position the fold plane sits 65-79 deg off the
    // metacarpals, so the own-frame decomposition reads the
    // fold as lateral (medians 65-70 deg) with the PIP
    // pinned at its cap -- the hairpin. This construction
    // folds the chain in the finger's own palm-plane family
    // instead: the plane spanned by the metacarpal m and the
    // target direction's component perpendicular to m, yawed
    // about m from the palmar flexion reference (fv =
    // +boneZ in pose space; see palmDecomp) by phi, the
    // target's own yaw in the bone
    // frame, with phi CLAMPED to rk's MCP lateral bound
    // (30 deg). The chain is the ordinary scalar solve
    // (solveCurl / fingerChainRaw) run in that plane toward
    // the target's in-plane projection: segment 1 lies
    // between m and the chord by construction, so the drawn
    // MCP IS the constructed flexion (alpha - bulge, alpha =
    // angle(m, chord)); PIP/DIP keep the anatomical cascade
    // (DIP slaved 0.69 x PIP); and segment 1's own-frame
    // lateral reads asin(sin(flexion) * sin(phi)) <= 30 deg.
    // A contact target yawed past the clamp cannot be
    // reached in-plane from this root: the build lands on
    // the projection and reports .latClamped (buildOne flags
    // the chain infeasible), and the guard's yaw lever
    // (correctMCP) rotates the knuckle about its target --
    // chord length preserved exactly -- until the yaw is
    // inside the bound: lateral need is absorbed by
    // knuckle-row yaw, never by folding sideways in-chain.
    const LAT_CAP = 30 * Math.PI / 180; // rk: MCP lateral <= 30 deg
    const palmDecomp = (f, w, K, T) => {
      const m = norm(sub(K, w));
      // Flexion reference: +boneZ, NOT -boneZ. In pose space
      // boneZ points along the side the proximal segment
      // actually rotates toward when the finger flexes
      // (measured on the shipped hand: seg1 . boneZ ~ +0.99
      // at both heroes, seg1 . m ~ 0 -- a near-pure ~89 deg
      // flexion in this frame). The -boneZ reference reads
      // that same flexion as ~-90 deg: it is the artefact
      // behind geometry section 9's "F-class" flexMin pins
      // (-92..-95 deg) and ownSplitOf's constant ~1.5 rad /
      // finger flex excess. (In restHand's canonical frame
      // the same anatomical side is -Z; the two frames'
      // z axes point to opposite sides -- a pre-existing
      // naming quirk of this codebase, measured, not fixed
      // here beyond using the measured side.)
      const fv = boneZOf(f, w, K);          // flexion side, perpendicular to m
      const la = norm(M.vec.cross(m, fv));  // the bone frame's lateral axis
      const u = sub(T, K);
      const p = dot(u, m), qf = dot(u, fv), rf = dot(u, la);
      return { m, fv, la, p, qf, rf, phi: Math.atan2(rf, qf), sPerp: Math.hypot(qf, rf) };
    };
    // The clamped construction's in-plane data, shared by
    // the chain build and the drawn angle's closed form so
    // the two can never disagree: phiC the clamped yaw, q
    // the target's coordinate along the yawed in-plane axis,
    // s the in-plane span the scalar solve runs at.
    const palmSolve = (f, w, K, T) => {
      const D = palmDecomp(f, w, K, T);
      const phiC = clamp(D.phi, -LAT_CAP, LAT_CAP);
      const clamped = Math.abs(D.phi) > LAT_CAP + 1e-12;
      let wHat, q;
      if (D.sPerp < 1e-9) { wHat = D.fv; q = 0; }
      else {
        wHat = norm(add(mul(D.fv, Math.cos(phiC)), mul(D.la, Math.sin(phiC))));
        q = D.qf * Math.cos(phiC) + D.rf * Math.sin(phiC);
      }
      return { D, phiC, clamped, wHat, q, s: Math.hypot(D.p, q) };
    };
    const fingerChainPalm = (K, T, f, w, curl) => {
      const lens = FINGER_LEN[f];
      const P = palmSolve(f, w, K, T);
      const Tp = add(add(K, mul(P.D.m, P.D.p)), mul(P.wHat, P.q));
      const sv = solveCurl(P.s, curl, lens);
      const pts = fingerChainRaw(K, Tp, lens, P.D.m, sv.cUse);
      pts.pip = sv.pip; pts.dip = sv.cUse; pts.curlUsed = sv.cUse;
      pts.infeasible = sv.infeasible; pts.slaved = sv.slaved;
      pts.latYaw = P.D.phi; pts.latClamped = P.clamped;
      return pts;
    };
    // Drawn MCP of the palm construction, closed form: the
    // scalar solve at the in-plane span, segment 1 from
    // geomAt in its (chord, m-side) basis, re-expressed in
    // the (m, wHat) basis -- the angle from the metacarpal
    // to segment 1 inside the constructed plane.
    const drawnAnglePalm = (w, K, T, f) => {
      const lens = FINGER_LEN[f];
      const P = palmSolve(f, w, K, T);
      if (P.s < 1e-9) return 0;
      const sv = solveCurl(P.s, curlF, lens);
      const g = geomAt(P.s, sv.cUse, lens);
      const al = Math.atan2(P.q, P.D.p), ca = Math.cos(al), sa = Math.sin(al);
      return Math.abs(Math.atan2(g.a * sa - g.h * ca, g.a * ca + g.h * sa));
    };
    const yawOkAt = (f, w, K) => Math.abs(palmDecomp(f, w, K, targets[f]).phi) <= LAT_CAP;
    const shrinkKnuckle = (f, w) => {
      const KT = sub(knuckles[f], targets[f]), dNow = Math.hypot(...KT);
      // The shrink floor is also the chain's PIP-feasibility
      // floor: shrinking a knuckle inside MIN_SPAN would fold
      // the finger past both caps no matter how the fold is
      // distributed (see fingerChain).
      const dMin = Math.max(reaches[f] * 0.68, MIN_SPAN[f] + 0.0005);
      if (dNow > dMin) {
        const nd = Math.max(dMin, dNow - Math.min(0.010, dNow - dMin));
        knuckles[f] = add(targets[f], mul(KT, nd / dNow));
        if (mcpSync) mcpSync(f);
      }
    };
    const rotateKnuckle = (f, w, maxStep, planeZ) => {
      const d2 = norm(sub(knuckles[f], targets[f]));
      const w2 = norm(sub(w, targets[f]));
      let axr = M.vec.cross(d2, w2);
      if (Math.hypot(...axr) < 1e-6) return;
      axr = norm(axr);
      const reachK = Math.hypot(...sub(knuckles[f], targets[f]));
      const atStep = st => {
        const c = Math.cos(st), s = Math.sin(st);
        const rot = add(add(mul(d2, c), mul(M.vec.cross(axr, d2), s)),
          mul(axr, dot(axr, d2) * (1 - c)));
        return add(targets[f], mul(rot, reachK));
      };
      // PROBED, BIDIRECTIONAL (bone finalization): the legacy
      // lever rotated by a formula step toward the wrist, up
      // to 0.35 rad per pass. In the bone frame the drawn
      // angle's gain per radian of root travel is often far
      // below 1 (the metacarpal sits near the fold plane's
      // normal, so the projected angle barely answers), and
      // the root walked most of the way around its target
      // sphere to the wrist -- 99.5 -> 29.6 mm measured on
      // the middle root in one provisional pass, poisoning
      // the placement snapshot every trial starts from.
      // Probe the drawn angle at ascending steps in BOTH
      // directions and take the SMALLEST step that actually
      // reaches the cap; for the middle finger, when both
      // directions reach it, keep the root farther from the
      // wrist (the palm floor's interest). If no probed step
      // reaches the cap, fall back to the legacy step.
      // Probe the drawn angle at ascending steps in BOTH
      // directions and take the SMALLEST step that actually
      // reaches the cap; for the middle finger, when both
      // directions reach it, keep the root farther from the
      // wrist (the palm floor's interest). If no probed step
      // reaches the cap, fall back to the legacy step: the
      // consistent-direction walk is what escapes the
      // degenerate alignments -- over the guard's iterations
      // the root travels around its sphere until the geometry
      // answers. (Removing the fallback was tried in the
      // bone finalization and measurably broke convergence:
      // the wrist search ran to its caps and fallback-3
      // assemblies leaked into 31 frames. The palm repair
      // below reverses whatever travel the final root does
      // not need.)
      const STEPS = [0.03, 0.06, 0.10, 0.16, 0.24, 0.35];
      const probe = sgn => {
        for (const st of STEPS) {
          const cand = atStep(sgn * st);
          if (drawnMCPAngle(w, cand, targets[f], f, planeZ) <= MCP_CAP) return { st: sgn * st, cand };
        }
        return null;
      };
      const pw = probe(1), pa = probe(-1);
      let pick = null;
      if (pw && pa) pick = f === 2
        ? (Math.hypot(...sub(pa.cand, w)) > Math.hypot(...sub(pw.cand, w)) ? pa : pw)
        : (Math.abs(pw.st) <= Math.abs(pa.st) ? pw : pa);
      else pick = pw || pa;
      knuckles[f] = pick ? pick.cand : atStep(Math.min(0.35, maxStep));
      if (mcpSync) mcpSync(f);
    };
    // IN-PLANE ROOT ROTATION (bone mode): rotateKnuckle turns
    // the root about the wrist->target axis -- but the bone
    // fold plane is DERIVED from the metacarpal, so plane,
    // metacarpal and chord rotate rigidly together and the
    // drawn angle is invariant under it (measured: the
    // Prelude index-led placement sat at 95.4 deg through
    // every probed step). Rotating the root about the TARGET
    // inside its own fold plane instead keeps the root on
    // its reach sphere and the chain in its plane, but turns
    // the chord against the metacarpal -- the angle answers.
    // Probe small steps both ways; smallest that reaches the
    // cap wins. The root's row station shifts by at most
    // ~0.10 rad of arc (~9 mm), inside the plate's bridging
    // margins.
    const inPlaneFix = (f, w, planeZ) => {
      const T = targets[f], rel = sub(knuckles[f], T);
      const axis = boneZOf(f, w, knuckles[f]);
      for (const d of [0.02, -0.02, 0.045, -0.045, 0.07, -0.07, 0.10, -0.10]) {
        const c = Math.cos(d), s = Math.sin(d);
        const cand = add(T, add(add(mul(rel, c), mul(M.vec.cross(axis, rel), s)),
          mul(axis, dot(axis, rel) * (1 - c))));
        if (drawnMCPAngle(w, cand, T, f, planeZ) <= MCP_CAP) {
          knuckles[f] = cand;
          if (mcpSync) mcpSync(f);
          return true;
        }
      }
      return false;
    };
    // Provisional palm frame from the CURRENT knuckles + a wrist,
    // for the MCP passes that run before finishHand builds the
    // real frame: the same recipe finishHand uses (row -> X,
    // wrist -> middle knuckle -> Y, Z = X x Y oriented to the
    // board back, variant roll about X; the trial loops'
    // rollAdj is 0 at those points by construction).
    const palmFrameOf = w => {
      // BONE mode: the provisional frame is the middle
      // finger's bone frame (Y along its metacarpal, Z its
      // dorsal axis, X = Y x Z) -- the same derivation
      // finishHand uses, so the guard passes judge the frame
      // the assembly will actually draw.
      if (CARR.mode === 'bone') {
        const midRoot = knuckles[2];
        const pY = norm(sub(midRoot, w));
        const zR = boneZOf(2, w, midRoot);
        const pX = norm(M.vec.cross(pY, zR));
        return { x: pX, y: pY, z: M.vec.cross(pX, pY) };
      }
      const midRoot = knuckles[2];
      let pY = norm(sub(midRoot, w));
      const rowVec = sub(knuckles[4], knuckles[1]);
      let pX = sub(rowVec, mul(pY, dot(rowVec, pY)));
      if (Math.hypot(...pX) < 1e-4) pX = sub(rowDir, mul(pY, dot(rowDir, pY)));
      pX = norm(pX);
      let pZ = M.vec.cross(pX, pY);
      if (dot(pZ, backN) < 0) { pX = mul(pX, -1); pZ = mul(pZ, -1); }
      if (VARI.palmRoll) {
        const c = Math.cos(VARI.palmRoll), s = Math.sin(VARI.palmRoll);
        const y2 = add(mul(pY, c), mul(pZ, s));
        const z2 = add(mul(pZ, c), mul(pY, -s));
        pY = y2; pZ = z2;
      }
      return { x: pX, y: pY, z: pZ };
    };
    // YAW LEVER (palm-fold construction): a contact target
    // yawed past LAT_CAP about its metacarpal cannot be
    // reached by an in-plane chain from this root -- the
    // build lands on the in-plane projection and flags the
    // chain. Rotate the root about its TARGET around the
    // metacarpal axis: the chord length is preserved exactly
    // (span, MIN_SPAN and reach bounds untouched), the
    // metacarpal swings with the root, and the target's yaw
    // about the new metacarpal drops by ~the rotation.
    // Steps are probed on the MEASURED yaw (the metacarpal
    // moves with the root, so the gain is not exactly 1) and
    // accepted only while the drawn MCP stays inside the
    // cap and the root stays off the wrist.
    const yawFix = (f, w, planeZ) => {
      const T = targets[f];
      for (let iter = 0; iter < 6; iter++) {
        const K = knuckles[f];
        const D = palmDecomp(f, w, K, T);
        if (Math.abs(D.phi) <= LAT_CAP) return true;
        const want = -(D.phi - Math.sign(D.phi) * LAT_CAP);
        let moved = false;
        for (const delta of [want, want * 1.5, Math.sign(want) * 0.30, Math.sign(want) * 0.55]) {
          const rel = sub(K, T), c = Math.cos(delta), s = Math.sin(delta);
          const cand = add(T, add(add(mul(rel, c), mul(M.vec.cross(D.m, rel), s)),
            mul(D.m, dot(D.m, rel) * (1 - c))));
          if (Math.hypot(...sub(cand, w)) < 0.030) continue;
          if (Math.abs(palmDecomp(f, w, cand, T).phi) >= Math.abs(D.phi)) continue;
          if (drawnMCPAngle(w, cand, T, f, planeZ) > MCP_CAP) continue;
          knuckles[f] = cand;
          if (mcpSync) mcpSync(f);
          moved = true;
          break;
        }
        if (!moved) break;
      }
      return yawOkAt(f, w, knuckles[f]);
    };
    // PALM-PLANE ROOT ROTATION (palm-fold): rotateKnuckle's
    // axis answers the projected angle weakly and
    // inPlaneFix turns about the dorsal axis, which is not
    // the constructed plane's normal once the yaw clamp
    // bites. Rotating the root about its target around the
    // CONSTRUCTED fold plane's normal turns the chord
    // against the metacarpal inside the plane family --
    // alpha (and with it the drawn angle) answers ~1:1,
    // the chord length is preserved, and the yaw moves
    // only second-order (the metacarpal leaves the old
    // plane). Probe small steps both ways; the smallest
    // that reaches the cap wins, mirroring inPlaneFix.
    const palmPlaneFix = (f, w, planeZ) => {
      const T = targets[f], rel = sub(knuckles[f], T);
      const P = palmSolve(f, w, knuckles[f], T);
      const nP = norm(M.vec.cross(P.D.m, P.wHat));
      for (const d of [0.03, -0.03, 0.07, -0.07, 0.12, -0.12, 0.20, -0.20, 0.30, -0.30]) {
        const c = Math.cos(d), s = Math.sin(d);
        const cand = add(T, add(add(mul(rel, c), mul(M.vec.cross(nP, rel), s)),
          mul(nP, dot(nP, rel) * (1 - c))));
        if (drawnMCPAngle(w, cand, T, f, planeZ) <= MCP_CAP) {
          knuckles[f] = cand;
          if (mcpSync) mcpSync(f);
          return true;
        }
      }
      return false;
    };
    const correctMCP = (w, planeZ) => {
      const k2Entry = [...knuckles[2]];
      const kEntryAll = { 1: [...knuckles[1]], 2: [...knuckles[2]], 3: [...knuckles[3]], 4: [...knuckles[4]] };
      // Wrap mode (wrapGuard 'off'): measure only. The guard's
      // levers (rotate/shrink the knuckle toward the wrist)
      // are what collapsed the palm to ~20-50 mm in every
      // palm-plane-fold experiment: on its reach sphere a root
      // can swing to within ||T - w| - reach| of the wrist, so
      // the lever eats the palm whenever the base joint reads
      // over cap. In the wrap carriage an over-cap base joint
      // is a WRIST placement fact (the trial search moves the
      // wrist; the excess stays measured on the pose), not a
      // knuckle-row defect to be ground away.
      if (CARR.mode === 'wrap' && CARR.wrapGuard === 'off') {
        let worstM = 0;
        for (let f = 1; f <= 4; f++) worstM = Math.max(worstM, drawnMCPAngle(w, knuckles[f], targets[f], f, planeZ));
        return worstM;
      }
      let worstOut = 0;
      for (let iter = 0; iter < 5; iter++) {
        let worst = 0;
        const kSnap = [1, 2, 3, 4].map(f => [...knuckles[f]]);
        for (let f = 1; f <= 4; f++) {
          // Palm-fold: settle a contact finger's lateral yaw
          // first (the yaw lever preserves the chord, so it
          // cannot disturb the span the angle levers below
          // judge); a clamped contact chain is infeasible no
          // matter what the angle reads.
          if (CARR.mode === 'bone' && CARR.palmFold && contacts[f]) yawFix(f, w, planeZ);
          const ang = drawnMCPAngle(w, knuckles[f], targets[f], f, planeZ);
          worst = Math.max(worst, ang);
          if (ang <= MCP_CAP) continue;
          // Palm-fold: the plane-native rotation first --
          // it turns the chord against the metacarpal inside
          // the constructed plane, where the angle answers.
          if (CARR.mode === 'bone' && CARR.palmFold && palmPlaneFix(f, w, planeZ)) continue;
          // Rotate first: it closes the drawn angle on the
          // target sphere, preserving the chain's span. Shrink
          // (which eats span, and with it palm length) is the
          // fallback for fingers rotation alone cannot fix --
          // firing it unconditionally cost ~20 mm of palm in
          // ordinary neck frames.
          rotateKnuckle(f, w, Math.min(0.35, (ang - MCP_CAP) * 0.9), planeZ);
          if (drawnMCPAngle(w, knuckles[f], targets[f], f, planeZ) > MCP_CAP) {
            // Bone mode: rotation about the wrist axis is
            // invariant there (see inPlaneFix) -- turn the
            // root inside its own fold plane instead, and
            // shrink only if that also fails.
            if (!(CARR.mode === 'bone' && inPlaneFix(f, w, planeZ))) shrinkKnuckle(f, w);
          }
        }
        worstOut = worst;
        if (worst <= MCP_CAP) break;
        // Stall break: an iteration that moved no root (the
        // probes found no reaching step and the shrink is at
        // its floor) will measure identically forever.
        if (kSnap.every((k0, i) => Math.hypot(...sub(knuckles[i + 1], k0)) < 1e-9)) break;
      }
      // PALM REPAIR (bone finalization debit (c)): with the
      // cap satisfied, walk the middle root back toward its
      // position before this attempt's guard travel -- the
      // attempt-level entry root (k2RepairTarget, set by
      // attempt() ahead of its pre-pass; this pass's own
      // entry outside attempts) -- reversing the travel the
      // drawn angle demonstrably answers to, as far as the
      // cap and the chain's chord bounds allow, up to the
      // floor. (A radial walk out along the metacarpal ray
      // was tried first: in the near-degenerate frames the
      // projected angle does not answer to radial motion at
      // all, and the repair never fired.) Where the cap
      // binds along the path the palm stays short by that
      // measured amount -- the residual class is named in
      // geometry-test section 8.
      {
        const K2 = knuckles[2], rNow = Math.hypot(...sub(K2, w));
        if (rNow < PALM_FLOOR) {
          const entry2 = k2RepairTarget || k2Entry;
          const T2 = targets[2];
          const atPhi = phi => K2.map((v, i) => v + (entry2[i] - v) * phi);
          const okPhi = phi => {
            const Kc = atPhi(phi);
            const chord = Math.hypot(...sub(Kc, T2));
            return chord <= reaches[2] * 0.998 && chord >= MIN_SPAN[2] + 0.0005 &&
              drawnMCPAngle(w, Kc, T2, 2, planeZ) <= MCP_CAP &&
              // Palm-fold: the walk may not re-yaw a contact
              // middle root past the lateral clamp.
              (!CARR.palmFold || !contacts[2] || yawOkAt(2, w, Kc));
          };
          if (okPhi(0)) {
            let lo = 0, hi = 1;
            for (let i = 0; i < 16; i++) {
              const mid = (lo + hi) / 2;
              if (okPhi(mid)) lo = mid; else hi = mid;
            }
            if (lo > 0.02) {
              knuckles[2] = atPhi(lo);
              if (mcpSync) mcpSync(2);
            }
          }
        }
      }
      // Degenerate-root rescue (Phase B): take the placement
      // snapshot's root outright when the current root sits
      // within 4 mm of the wrist (a guard walk parked it
      // there, under section 8's 3 mm fan floor) and the
      // snapshot root is clear of the wrist and satisfies
      // the chord bounds and the drawn-MCP cap. (The
      // finishHand-end nudge covers the frames where the
      // snapshot root is itself too close to this wrist.)
      const rescueRoot = f => {
        if (!snapRoots || Math.hypot(...sub(snapRoots[f], w)) < 0.0045) return;
        const Kc = snapRoots[f], Tf = targets[f];
        const chord = Math.hypot(...sub(Kc, Tf));
        if (chord <= reaches[f] * 0.998 && chord >= MIN_SPAN[f] + 0.0005 &&
            drawnMCPAngle(w, Kc, Tf, f, planeZ) <= MCP_CAP &&
            (!CARR.palmFold || !contacts[f] || yawOkAt(f, w, Kc))) {
          knuckles[f] = [...Kc];
          if (mcpSync) mcpSync(f);
        }
      };
      // ROOT RESTORATION (Phase B, 2026-11-08): the palm
      // repair above walks only the MIDDLE root back, and
      // only when the palm fell under its floor. The same
      // guard travel displaces the OUTER roots in ordinary
      // frames: instrumented at the Prelude hero, the
      // provisional pass moved the little root 42.7 mm and
      // this pass 45.9 mm more (its chord ending crushed to
      // the MIN_SPAN floor, which is also where the deep
      // PIP/DIP fold comes from), because the rotate lever
      // is frame-invariant in bone mode yet walks the root
      // around its target sphere iteration after iteration.
      // Generalize the repair: with the cap satisfied, walk
      // EVERY outer root back toward this pass's entry root
      // -- the row station the placement machinery chose --
      // as far as the cap and the chord bounds allow. The
      // middle root keeps its dedicated repair above (its
      // walk is palm-floor-driven and runs first).
      if (CARR.mode === 'bone' && (restoreLive || fhAnchorLive)) {
        for (const f of [1, 3, 4]) {
          const Kf = knuckles[f], Tf = targets[f];
          // Anchor: this pass's entry root -- except inside
          // finishHand's final guard pass, where the anchor
          // is the placement SNAPSHOT (fhAnchor): between
          // the snapshot and this pass, the attempt pre-pass
          // guard and the coplanarity pass both travel the
          // roots (the coplanarity hover branch re-derives
          // roots from shifted targets -- rootOf is
          // target-rooted -- and the pre-pass walked the
          // Prelude hero's index root 27 mm onto the wrist),
          // so the pass-entry root is not the row station
          // the placement chose.
          const entryF = (fhAnchorLive && fhAnchor) ? fhAnchor.roots[f] : kEntryAll[f];
          if (Math.hypot(...sub(Kf, entryF)) < 0.002) continue;
          const atPhiF = phi => Kf.map((v, i) => v + (entryF[i] - v) * phi);
          const okPhiF = (phi, capLim) => {
            const Kc = atPhiF(phi);
            const chord = Math.hypot(...sub(Kc, Tf));
            return chord <= reaches[f] * 0.998 && chord >= MIN_SPAN[f] + 0.0005 &&
              drawnMCPAngle(w, Kc, Tf, f, planeZ) <= capLim &&
              // Palm-fold: restoration may not walk a contact
              // root back out of lateral compliance.
              (!CARR.palmFold || !contacts[f] || yawOkAt(f, w, Kc));
          };
          // Two tiers: prefer restoring to a MARGIN under
          // the cap (a root parked exactly at the cap still
          // reads as a fully folded base joint -- measured:
          // cap-only restoration put 57-77% of ring/little
          // contact frames at the cap); where even the
          // current root is past the margin, fall back to
          // the cap itself so genuinely bound frames keep
          // their cap-satisfying lever end.
          for (const capLim of [MCP_CAP - 0.06, MCP_CAP]) {
            if (!okPhiF(0, capLim)) continue;
            let lo = 0, hi = 1;
            for (let i = 0; i < 10; i++) {
              const mid = (lo + hi) / 2;
              if (okPhiF(mid, capLim)) lo = mid; else hi = mid;
            }
            if (lo > 0.02) {
              knuckles[f] = atPhiF(lo);
              if (mcpSync) mcpSync(f);
            }
            break;
          }
          // Degenerate-root rescue (Phase B): a guard walk
          // can park a root within millimetres of the wrist
          // (section 8's wrist->knuckle fan floor is 3 mm;
          // measured 2.9 mm after the restoration was gated
          // out of the attempt pre-passes, whose travelled
          // roots poison the nearer anchors). If the root is
          // still wrist-degenerate after the walk above, take
          // the placement snapshot's root outright when it
          // satisfies the chord bounds and the cap.
          if (Math.hypot(...sub(knuckles[f], w)) < 0.004) rescueRoot(f);
        }
      }
      // The rescue runs in EVERY guard pass (the bisection
      // restoration above stays gated for cost): the
      // guard/clearance alternation after finishHand's final
      // pass can walk a root onto the wrist last, and no
      // gated pass runs after it.
      if (CARR.mode === 'bone') {
        for (const f of [1, 3, 4]) {
          if (Math.hypot(...sub(knuckles[f], w)) < 0.004) rescueRoot(f);
        }
      }
      return worstOut;
    };
    // Palm-fold note: skipping this provisional pass was
    // tried (the snapshot then holds rootOf's untravelled
    // roots and the wrist cloud re-anchors to them): the
    // sweep traded index/ring at-cap shares for a worse
    // index fold median (183 -> 211 deg), a broken thumb
    // rest (settled IP max 35 -> 71 deg -- the rest point
    // is derived from the post-pass middle root) and ~18%
    // more pose cost. Reverted; the pass runs in all modes.
    { const wProv = placeWrist(knuckles[2], VARI.wristBack); bendN = bendNFor(palmFrameOf(wProv).z); restoreLive = true; correctMCP(wProv, palmFrameOf(wProv).z); restoreLive = false; }
    // FAN REDESIGN rotation (dev only, CARR 'fan'): swing the
    // knuckle roots about the middle metacarpal's line by
    // fanDeg (see the setCarriage comment). Runs BEFORE the
    // placement snapshot below, so the rotated row is what
    // every wrist trial assembles from; the middle root lies
    // on the axis and is skipped so it stays exact. Chord
    // lengths change under the swing -- the chains, the span
    // repair, the clearance pass and the drawn-MCP guard all
    // re-derive from the rotated roots inside finishHand.
    if ((CARR.mode === 'fan' || CARR.mode === 'bone') && CARR.fanDeg) {
      const wP2 = placeWrist(knuckles[2], VARI.wristBack);
      const axF = norm(sub(knuckles[2], wP2));
      const fa = CARR.fanDeg * Math.PI / 180, cf = Math.cos(fa), sf = Math.sin(fa);
      for (let f = 1; f <= 4; f++) {
        if (f === 2) continue;
        const rel = sub(knuckles[f], wP2);
        knuckles[f] = add(wP2, add(add(mul(rel, cf), mul(M.vec.cross(axF, rel), sf)),
          mul(axF, dot(axF, rel) * (1 - cf))));
      }
    }
    // R2 root alignment: rotate each knuckle root about its
    // target (on its reach sphere, so contact and span are
    // untouched) PARTWAY toward the finger's own palm flexion
    // plane span(metacarpal, palmZ), judged on the provisional
    // wrist/frame. In a real hand the extended finger lies in
    // that plane by construction; the shipped fan places the
    // chords 50-70 deg out of it, which is what the palm-frame
    // decomposition reads as sideways bend. The FULL
    // projection (rootAlign = 1) moves a root by up to ~a
    // hand-width and the assembly's clearance/guard repairs
    // cascade into collapse in a large frame subset
    // (measured), so the shipped variant parameter is the
    // fraction rootAlign in (0, 1]: two fractional passes
    // here against the provisional assembly, one more against
    // the winning wrist after the trials. The wrist trials
    // re-guard and polish (the alignW score term), so this is
    // a start point, not a constraint.
    const alignRoots = (wA, pzA, frac) => {
      for (let f = 1; f <= 4; f++) {
        const mH = norm(sub(knuckles[f], wA));
        let nA = M.vec.cross(mH, pzA);
        if (Math.hypot(...nA) < 1e-6) continue;
        nA = norm(nA);
        const ch = sub(targets[f], knuckles[f]), dA = Math.hypot(...ch);
        const chN = mul(ch, 1 / dA);
        let c2 = sub(chN, mul(nA, dot(chN, nA)));
        if (Math.hypot(...c2) < 1e-6) continue;
        const blended = norm(lerp(chN, norm(c2), frac));
        knuckles[f] = sub(targets[f], mul(blended, dA));
      }
    };
    if (CARR.mode !== 'current' && CARR.rootAlign) {
      for (let itA = 0; itA < 2; itA++) {
        const wA = placeWrist(knuckles[2], VARI.wristBack);
        alignRoots(wA, palmFrameOf(wA).z, CARR.rootAlign);
      }
    }
    // Thumb rest point: one continuous target following the
    // posture parameter (no discrete mode switch, so nothing pops
    // at the neck/thumb boundary). In neck positions the pad rests
    // ON the back of the neck AT THE HAND'S OWN STATION -- the
    // neck-axis point nearest the middle knuckle, offset one thumb
    // radius behind the back surface. (The rest point used to
    // follow the anchor note, which jumps up to ~120 mm between
    // fingers inside one position; the thumb, rooted in the hand,
    // could not follow and floated stranded.) lam = 1: the thumb
    // lies across the fingerboard on the strings as the anchor
    // under the hand (rest point 3 mm in front of the anchor's
    // string point). In between, the rest point lerps across and
    // swings around the player's-left side (the -sin(pi*lam)
    // term) instead of dragging across the neck's back corner.
    const midRoot0 = knuckles[2];
    const axisPt = add(M.NECK_A, mul(neckAxisDir,
      clamp(dot(sub(midRoot0, M.NECK_A), neckAxisDir), 0, axisLen)));
    let backDir = sub(mul(M.n, -1), mul(neckAxisDir, dot(mul(M.n, -1), neckAxisDir)));
    backDir = norm(backDir); // board-back direction, perpendicular to the neck axis
    // The rest sits on the neck's back-LEFT ridge (0.62 back +
    // 0.62 toward the A-string side, -v: the player's left across
    // the neck, a station-step toward the nut): the thumb lies
    // along that ridge, opposing the fingers that wrap over the
    // board from the same side -- the pinch. PHASE B
    // (2026-11-08): the radial distance is 35.5 mm, not 45 --
    // at 45 mm the distal capsule floated +10.5 mm off the
    // neck surface in every settled frame (the resting thumb
    // never touched); 35.5 mm = 27 mm neck radius + 7.5 mm
    // distal capsule radius + 1 mm, i.e. contact class.
    // The nut-side step matters to the chain: it sets the
    // wrist->rest distance, and with it the span the 96 mm
    // thumb chain folds over (a bridge-side step collapsed
    // it to ~30 mm -- measured, round 2 -- and no in-cap
    // fold exists there). PHASE B (2026-11-08): the step is
    // 30 mm, not 10 -- at 10 mm the settled span sat at
    // 75.6 mm, below the MCP-first distribution's band, and
    // the IP joint read 61.6 deg median (80.6 before the
    // distribution fix); at 30 mm the settled span is the
    // pullback's 82 mm target and the fold reads MCP 43 /
    // IP 35 deg with the capsule on the ridge (sweep:
    // 50 mm overshoots -- span 92.8, the slide regime;
    // 70 mm breaks the settled tip, 1.85 mm error).
    // (The pre-fix rest sat on the C-side ridge, +v, the player's
    // right: one more piece of the hand assembled from the right.)
    const neckRest = add(add(axisPt, mul(norm(add(mul(backDir, 0.62), mul(M.v, -0.62))), 0.0355)),
      mul(neckAxisDir, 0.030));
    // Transition path: a cubic Bezier from the neck-ridge rest
    // to the on-board anchor, routed via the neck's A-side
    // (back-left) flank and an approach point above the board --
    // the thumb tip travels AROUND the neck and comes down onto
    // the board from above as the hand rolls over, never across
    // the neck's axis or through the board's top edge (a straight
    // lerp dragged it through both whenever the anchor sat far
    // down-board).
    const flankMid = add(add(axisPt, mul(M.v, -0.052)),
      add(mul(backDir, 0.008), mul(M.n, 0.030)));
    const boardRest = add(anchorPt, mul(M.n, 0.003));
    const approach = add(boardRest, mul(M.n, 0.045));
    // The thumb's swing LEADS the hand's roll slightly (phase
    // 2): the rest point is evaluated at lamT = lam * 1.12
    // (clamped), so mid-shift the thumb is already around the
    // flank while the hand is still arriving -- the root->rest
    // span stays nearer the chain's foldable range instead of
    // collapsing when the hand and the rest point pass each
    // other around the neck. Endpoints are unchanged (lamT = 0
    // at lam = 0, 1 at lam >= 0.9).
    const lamT = clamp(lam * 1.12, 0, 1);
    const restPt = add(add(mul(neckRest, (1 - lamT) ** 3),
      mul(flankMid, 3 * (1 - lamT) * (1 - lamT) * lamT)),
      add(mul(approach, 3 * (1 - lamT) * lamT * lamT), mul(boardRest, lamT ** 3)));
    // The thumb's dorsal reference (the way its nail faces):
    // outward from the neck's back-left ridge in neck positions,
    // rotating to a back-of-hand / board-outward blend as the
    // hand rolls onto the board. The chain flexes toward the
    // opposite (palmar) side -- pad toward the neck. Defined
    // here (a pure function of the posture constants) because
    // the wrist trials' thumb prediction uses it too.
    const radialOutT = norm(add(mul(backDir, 0.62), mul(M.v, -0.62)));
    const dorsalRefT = norm(add(mul(radialOutT, 1 - lam),
      mul(norm(add(backN, M.n)), lam)));
    // ---- The hand as one assembly: palm frame first ----
    // The palm frame is built from the knuckle row and the palm
    // axis: the wrist JOINT is placed PALM_LEN proximal of the
    // MIDDLE finger's root along the axis (plus the radial floor
    // push below) -- palm length is anatomical by construction,
    // not fitted afterwards. X is the
    // roots' principal axis (power iteration on their covariance,
    // seeded with the board direction), orthonormalised against
    // the axis; Z = X x Y, flipped (with X) so Z is the
    // back-of-hand side. The palm plate spans wrist -> row (its
    // distal face sits 7 mm past the middle knuckle, the knuckle
    // padding of a real palm), a carpus piece caps the wrist end,
    // and the thumb roots at its CMC joint beside the wrist.
    // There is no wrist ball and no heel rope: the wrist is the
    // palm's proximal end and the forearm's end.
    // Wrist: placed by placeWrist (defined with the knuckle row)
    // from the MCP-corrected middle knuckle, assembled by
    // finishHand below, and SEARCHED by the trial loops after it
    // (phase 2): a placement is accepted only when the whole
    // assembly -- drawn-MCP guard AND a ROM-feasible elbow --
    // succeeds from it; the offsets tried and the relaxation
    // used are recorded on the pose.
    const snapK = () => ({ 1: [...knuckles[1]], 2: [...knuckles[2]], 3: [...knuckles[3]], 4: [...knuckles[4]] });
    const restoreK = s => { for (let f = 1; f <= 4; f++) knuckles[f] = s[f]; };
    const snapT = () => ({ 1: [...targets[1]], 2: [...targets[2]], 3: [...targets[3]], 4: [...targets[4]] });
    const restoreT = s => { for (let f = 1; f <= 4; f++) targets[f] = s[f]; };
    const snap0 = snapK(), snapT0 = snapT();
    snapRoots = snap0; // same object: the R2 re-alignment below mutates it in place
    // Fibonacci-sphere samples for the palm plate's neck
    // clearance check inside finishHand. NP = 300 (Stage 2):
    // the canonical plate is flat (92 x 80 x 21 mm), and at
    // 80 samples its closest neck approach fell between
    // samples -- the lift read +3 mm where section 8b's
    // 300-sample measure found the rim -10.7 mm around the
    // neck. The sample count now matches the test's.
    const SURF_P = [];
    { const NP = 300, ga = Math.PI * (3 - Math.sqrt(5));
      for (let i = 0; i < NP; i++) { const y = 1 - (i / (NP - 1)) * 2, rr = Math.sqrt(Math.max(0, 1 - y * y)), th = ga * i; SURF_P.push([Math.cos(th) * rr, y, Math.sin(th) * rr]); } }
    let rollAdj = 0; // trial loops' pronation adjustment (see the frame block)
    // finishHand(w): everything downstream of a chosen wrist --
    // palm frame, coplanarity, the final drawn-MCP pass, the
    // finger chains (with the span repair for chains the PIP/DIP
    // clamp flags infeasible), the palm/carpus pieces, and the
    // elbow search. Returns the assembly for the trial loops.
    const finishHand = w => {
      // PHASE B: capture the restoration anchor before the
      // coplanarity pass can re-derive hover roots from
      // shifted targets; correctMCP's restoration anchors
      // hover roots here (see the restoration block). The
      // anchor is the placement SNAPSHOT, not the entry
      // roots: the attempt pre-pass guard runs before
      // finishHand and walks roots itself (measured: the
      // index root walked 27 mm onto the wrist in every
      // attempt of the Prelude t=8.82 frame), so entry
      // roots can already be travelled; the snapshot is
      // the trial-invariant row the placement chose.
      fhAnchor = { roots: { 1: [...knuckles[1]], 2: [...knuckles[2]], 3: [...knuckles[3]], 4: [...knuckles[4]] },
        hover: { 1: !contacts[1], 2: !contacts[2], 3: !contacts[3], 4: !contacts[4] } };
      const roots = [1, 2, 3, 4].map(f => knuckles[f]);
      const K = roots.reduce((a, r) => add(a, mul(r, 0.25)), [0, 0, 0]);
      const midRoot = roots[1];
      let palmY = norm(sub(midRoot, w));
      const palmYRaw = palmY; // un-rolled metacarpal direction (the bone-mode carpal frame below starts from it)
      const palmLen = Math.hypot(...sub(midRoot, w));
      // X is the knuckle row's own direction (index root ->
      // little root), orthonormalised against Y. (A principal-
      // axis fit of the roots went ambiguous in thumb position,
      // where the row runs diagonally across the palm frame.)
      // BONE mode: X/Z come from the middle finger's bone
      // frame instead (Z = its dorsal axis, X = Y x Z) -- the
      // plate is drawn from the bones; the row-based fit below
      // is the shipped derivation.
      let palmX, palmZ;
      if (CARR.mode === 'bone') {
        const zR = boneZOf(2, w, midRoot);
        palmX = norm(M.vec.cross(palmY, zR));
        palmZ = M.vec.cross(palmX, palmY);
      } else {
        const rowVec = sub(roots[3], roots[0]);
        palmX = sub(rowVec, mul(palmY, dot(rowVec, palmY)));
        if (Math.hypot(...palmX) < 1e-4) palmX = sub(rowDir, mul(palmY, dot(rowDir, palmY)));
        palmX = norm(palmX);
        palmZ = M.vec.cross(palmX, palmY);
        if (dot(palmZ, backN) < 0) { palmX = mul(palmX, -1); palmZ = mul(palmZ, -1); }
      }
      // Variant palm roll (the forearm-pronation reading, bounded
      // by ROM.FOREARM): rotate the palm frame about the knuckle-
      // row axis. The skeleton points (wrist, roots) do not move.
      // rollAdj is the trial loops' last-resort pronation
      // adjustment (pose-scope, set before the attempt; the
      // effective pronation is exported for the ROM sweep).
      // BONE mode: the frame IS the bone frame -- variant C's
      // drawn-frame palmRoll compensation does not apply on
      // top of it; the trials' rollAdj (a placement lever)
      // still does.
      const rollNow = (CARR.mode === 'bone' ? 0 : VARI.palmRoll) + rollAdj;
      if (rollNow) {
        const th = rollNow, c = Math.cos(th), s = Math.sin(th);
        const y2 = add(mul(palmY, c), mul(palmZ, s));
        const z2 = add(mul(palmZ, c), mul(palmY, -s));
        palmY = y2; palmZ = z2;
      }
      bendN = bendNFor(palmZ);
      // Board-box helpers (signed distance / escape direction),
      // shared by the hover-target clamp below and the root
      // clearance repair after the MCP pass.
      const boardFrame = q => { const rel = sub(q, M.BOARD.A); return [dot(rel, M.BOARD.dir), dot(rel, M.v), dot(rel, M.BOARD.normal)]; };
      const boardParts = q => {
        const [a, b, c] = boardFrame(q);
        const halfW = 0.023 + 0.008 * clamp(a / M.BOARD.END, 0, 1);
        const da = a < 0 ? -a : (a > M.BOARD.END ? a - M.BOARD.END : 0);
        const db = Math.max(Math.abs(b) - halfW, 0);
        const dc = c > 0.0008 ? c - 0.0008 : (c < -0.0062 ? -0.0062 - c : 0);
        return { a, b, c, halfW, da, db, dc };
      };
      const boardDistK = q => {
        const P = boardParts(q);
        if (P.da === 0 && P.db === 0 && P.dc === 0)
          return -Math.min(P.halfW - Math.abs(P.b), P.c + 0.0062, 0.0008 - P.c, P.a, M.BOARD.END - P.a);
        return Math.hypot(P.da, P.db, P.dc);
      };
      const boardEscape = q => {
        const P = boardParts(q);
        let e = add(add(mul(M.BOARD.dir, P.da * (P.a < 0 ? -1 : 1)), mul(M.v, P.db * Math.sign(P.b))),
          mul(M.BOARD.normal, P.dc));
        if (Math.hypot(...e) < 1e-9) e = M.BOARD.normal; // inside the box: exit through the face
        return norm(e);
      };
      // Keep the knuckles coplanar with the palm, as a real
      // hand's are. CONTACT fingers keep their targets -- their
      // roots are pulled toward the plane as far as the chain's
      // reach allows. HOVER fingers' targets are not musical
      // invariants, so the target shifts instead and the fan
      // re-solves.
      // BONE mode: the plane is each finger's OWN flexion
      // plane (its bone frame) -- the fan means the outer
      // roots sit far off the MIDDLE finger's plane by
      // design, and measuring them against it dragged the
      // little finger's hover target ~45 mm through the neck
      // (its chain then crossed the neck cylinder; section 5
      // caught it). Against its own plane the offset is the
      // small residual the pass exists to remove.
      for (let f = 1; f <= 4; f++) {
        if (f === prim) continue;
        const pzF = CARR.mode === 'bone' ? boneZOf(f, w, knuckles[f]) : palmZ;
        if (contacts[f]) {
          const off = dot(sub(knuckles[f], midRoot), pzF);
          if (Math.abs(off) < 0.004) continue;
          const [l1, l2, l3] = FINGER_LEN[f];
          const maxChord = (l1 + Math.sqrt(l2 * l2 + l3 * l3 + 2 * l2 * l3 * Math.cos(curlF))) * 0.998;
          let pull = 0.8;
          while (pull > 0.05) {
            const cand = sub(knuckles[f], mul(pzF, off * pull));
            if (Math.hypot(...sub(cand, targets[f])) <= maxChord) {
              knuckles[f] = cand; roots[f - 1] = cand; break;
            }
            pull *= 0.6;
          }
        } else {
          for (let it = 0; it < 2; it++) {
            const off = dot(sub(knuckles[f], midRoot), pzF);
            if (Math.abs(off) <= 0.006) break;
            targets[f] = sub(targets[f], mul(pzF, off * 0.65));
            knuckles[f] = rootOf(f);
            roots[f - 1] = knuckles[f];
          }
        }
      }
      // Hover targets keep their tips off the board: the
      // coplanarity shift above can push a hover target into
      // the slab (the palm-Z shift has a board-normal
      // component), leaving the fingertip capsule sunk through
      // the board. Lift any hover target whose tip capsule
      // would graze, and re-derive its root.
      for (let f = 1; f <= 4; f++) {
        if (contacts[f]) continue;
        const needT = FINGER_R[f][2] + 0.003, bd = boardDistK(targets[f]);
        if (bd < needT) {
          targets[f] = add(targets[f], mul(boardEscape(targets[f]), needT - bd + 0.0005));
          knuckles[f] = rootOf(f);
          roots[f - 1] = knuckles[f];
        }
      }
      // Drawn-MCP final pass: the coplanarity pulls above can
      // move a knuckle by ~20 mm and re-open the base-joint angle
      // past the cap, so the full guard loop runs once more
      // against the FINAL wrist, with roots[] kept in step,
      // before the chains are built.
      mcpSync = f => { roots[f - 1] = knuckles[f]; };
      fhAnchorLive = true;
      let mcpWorst = correctMCP(w, palmZ);
      fhAnchorLive = false;
      // ROOT CLEARANCE REPAIR: no knuckle may sit inside the
      // neck cylinder or within its capsule shell of the board
      // box. A hover root computed from a far target along the
      // approach direction can dive through the neck's board
      // side in low positions (menuet's finger-4-led frames put
      // the index root 12 mm inside the wood), or park 0.3 mm
      // off the board's face where its knuckle ball would sink
      // through the slab (gigue's opening). Push out to surface
      // + base radius + 2 mm; the chains below re-solve from
      // the moved root (contact tips stay exact). Re-run after
      // the span repair, whose retreats could in principle
      // re-enter. (The board helpers live above the coplanarity
      // pass; the hover-target clamp there uses them too.)
      const clearRoots = () => {
        let pushed = false;
        for (let f = 1; f <= 4; f++) {
          const need = 0.027 + FINGER_R[f][0] + 0.002;
          const ap = add(M.NECK_A, mul(neckAxisDir, clamp(dot(sub(knuckles[f], M.NECK_A), neckAxisDir), 0, axisLen)));
          const rad = sub(knuckles[f], ap), rl = Math.hypot(...rad);
          if (rl < need) {
            knuckles[f] = add(ap, mul(rl > 1e-6 ? mul(rad, 1 / rl) : backDir, need + 0.0005));
            roots[f - 1] = knuckles[f];
            pushed = true;
          }
          const needB = FINGER_R[f][0] + 0.002, bd = boardDistK(knuckles[f]);
          if (bd < needB) {
            knuckles[f] = add(knuckles[f], mul(boardEscape(knuckles[f]), needB - bd + 0.0005));
            roots[f - 1] = knuckles[f];
            pushed = true;
          }
        }
        return pushed;
      };
      const clearAll = () => { let any = false; for (let r = 0; r < 3; r++) { if (!clearRoots()) break; any = true; } return any; };
      // Finger chains from the final knuckles.
      // CHAIN CLEARANCE REPAIR (bone finalization): the bone
      // fold plane's bulge direction is the finger's own
      // dorsal axis, rotated away from the board normal by
      // the fan and the hand roll -- where the board-plane
      // fold of the shipped build kept every segment on the
      // chord's board side by construction, a bone-plane
      // chain can cut the corner through the fingerboard's
      // edge (Swan thumb position, finger 1: the middle
      // phalanx passed ~12 mm under the board surface) or
      // across the neck. A chain may not pass through the
      // instrument: sample the built chain against the neck
      // cylinder and the board box (section 5's measures and
      // graze bounds); on a breach, blend the fold plane
      // from the bone axis toward the board normal in steps
      // and keep the first blend that clears (or the least
      // breaching). The chain still folds in ONE plane and
      // the tip still lands exactly; the blended frames are
      // the named exception in section 9's own-frame table.
      const chainBreach = (pts, f) => {
        let worst = Infinity;
        for (let j = 0; j < 3; j++) for (let kk = 0; kk <= 8; kk++) {
          const pt = pts[j].map((v, q) => v + (pts[j + 1][q] - v) * kk / 8);
          if (contacts[f] && Math.hypot(...sub(pt, targets[f])) < 0.006) continue;
          const ap = add(M.NECK_A, mul(neckAxisDir, clamp(dot(sub(pt, M.NECK_A), neckAxisDir), 0, axisLen)));
          worst = Math.min(worst, Math.hypot(...sub(pt, ap)) - 0.027 - FINGER_R[f][j] + 0.002);
          worst = Math.min(worst, boardDistK(pt) - FINGER_R[f][j] + 0.007);
        }
        return worst;
      };
      // Chain build dispatch: the palm-fold construction
      // (CARR.palmFold) replaces the chord-plane build in
      // bone mode; every other path keeps fingerChain.
      const buildChain = (f, K, T) => (CARR.mode === 'bone' && CARR.palmFold)
        ? fingerChainPalm(K, T, f, w, curlF)
        : fingerChain(K, T, FINGER_LEN[f], bendNOf(f, w, K), curlF);
      const buildOne = f => {
        let target = targets[f];
        const knuckle = knuckles[f];
        // The drawn base-joint angle of a built chain, from
        // its own points (fold-plane normal from the chain
        // itself -- drawnMCPAngle's recipe).
        const drawnFromPts = pts => {
          const meta = sub(knuckle, w), seg = sub(pts[1], pts[0]);
          let nrm = M.vec.cross(seg, sub(pts[3], pts[0]));
          nrm = Math.hypot(...nrm) < 1e-9 ? M.n : norm(nrm);
          const mp = sub(meta, mul(nrm, dot(meta, nrm)));
          return Math.hypot(...mp) < 1e-9 ? 0 : Math.acos(clamp(dot(norm(mp), norm(seg)), -1, 1));
        };
        // PHASE B HOVER RELAXATION (bone mode, 2026-11-08):
        // a hover finger's target is a preparation point,
        // not a contact, yet the audit found hover chains
        // folded as deep as contact chains (fold-total
        // medians 188-201 deg) because their spans end
        // crushed by the guard / clearance machinery between
        // rootOf and here. Give the hover chain a relaxed
        // span instead: lift the target along the board
        // normal in steps until the knuckle->target span
        // reaches the relaxed-cascade span (the span whose
        // solved bends read as a loose cascade: DIP ~17 deg,
        // PIP ~25 deg by the slave rule), capped at the
        // existing ladder's 28 mm and by the drawn-MCP cap
        // with margin. The tip floats above its preparation
        // point in a shallow cascade; contact fingers and
        // their exact targets are untouched. The ladder
        // deliberately runs inside every search trial, not
        // just the final build: gating it to the winner's
        // build measurably broke the elbow certification
        // (Prelude @67.0, viol 0.010) because finishHand
        // derives hover roots from these targets, so trial
        // and final assemblies must see the same targets.
        // The pose cost of that consistency is reported
        // with the Phase B measurements.
        if (CARR.mode === 'bone' && !contacts[f]) {
          const [hl1, hl2, hl3] = FINGER_LEN[f];
          const spanR = (hl1 + Math.sqrt(hl2 * hl2 + hl3 * hl3 + 2 * hl2 * hl3 * Math.cos(0.30))) * 0.99;
          if (Math.hypot(...sub(target, knuckle)) < spanR) {
            let bestT = null;
            for (const lift of [0.006, 0.012, 0.018, 0.024, 0.028]) {
              const tNew = add(targets[f], mul(M.BOARD.normal, lift));
              const cand = buildChain(f, knuckle, tNew);
              if (cand.infeasible || drawnFromPts(cand) > MCP_CAP - 0.02) continue;
              bestT = tNew;
              if (Math.hypot(...sub(tNew, knuckle)) >= spanR) break;
            }
            if (bestT) { target = bestT; targets[f] = bestT; }
          }
        }
        let pts = buildChain(f, knuckle, target);
        // Palm-fold: a CONTACT chain whose target yawed past
        // the lateral clamp landed on the in-plane
        // projection, not on its target -- flag it
        // infeasible so the proximal repairs (the guard's
        // yaw lever, the span repair) and the trial ranking
        // see the miss. Hover chains take the projection
        // legally (a preparation point, not a contact).
        if (CARR.mode === 'bone' && CARR.palmFold && contacts[f] && pts.latClamped) pts.infeasible = true;
        if (CARR.mode === 'bone' && chainBreach(pts, f) < 0) {
          // Palm-fold: the blend rotates the constructed
          // plane (bulge reference = the metacarpal itself)
          // toward the board plane, as the bone build blends
          // from its dorsal axis.
          const zB = (CARR.mode === 'bone' && CARR.palmFold) ? norm(sub(knuckle, w)) : bendNOf(f, w, knuckle);
          let bestPts = pts, bestBr = chainBreach(pts, f);
          for (const beta of [0.3, 0.55, 0.8, 1]) {
            const pn = norm(add(mul(zB, 1 - beta), mul(M.n, beta)));
            const cand = fingerChain(knuckle, target, FINGER_LEN[f], pn, curlF);
            // The blend may not break the drawn base-joint
            // cap the guard just settled (measured: an
            // uncapped blend rotated the Prelude index
            // chain's plane until it read 95.4 deg). A
            // residual capsule graze inside section 5's
            // bounds is the lesser evil; the cap is rk's
            // hard anatomical rule.
            if (drawnFromPts(cand) > MCP_CAP) continue;
            const br = chainBreach(cand, f);
            if (br > bestBr) { bestBr = br; bestPts = cand; }
            if (br >= 0) break;
          }
          pts = bestPts;
          // HOVER TARGET LIFT (bone finalization): what the
          // blend cannot clear is the ring finger's distal
          // segment in neck position -- its hover chain runs
          // nearly straight at a yawed plane and the middle
          // joint sags through the board's edge (measured
          // -13 mm capsule, -17 mm at the neck in two Menuet
          // placements). A hover target is not a musical
          // invariant: lift it off the board in steps and
          // rebuild, keeping the first lift that clears (the
          // drawn cap and chain feasibility still hold).
          if (!contacts[f] && chainBreach(pts, f) < 0) {
            const t0 = targets[f];
            // Ladder extended to 28 mm (Stage 2): the derived
            // knuckle row moved the outer roots ~21 mm back,
            // the coplanarity pass's hover-target shift grew
            // with it, and a Menuet hover target could start
            // ~16 mm under the surface -- the old 16 mm top
            // step left its tip inside the board slab
            // (section 5 centreline count). The ladder still
            // stops at the first step that clears.
            for (const lift of [0.004, 0.008, 0.012, 0.016, 0.020, 0.024, 0.028]) {
              const tNew = add(t0, mul(M.BOARD.normal, lift));
              const cand = buildChain(f, knuckle, tNew);
              if (cand.infeasible || drawnFromPts(cand) > MCP_CAP) continue;
              const br = chainBreach(cand, f);
              if (br > chainBreach(pts, f)) { pts = cand; targets[f] = tNew; target = tNew; }
              if (br >= 0) break;
            }
          }
        }
        // BEND PLANE (rk 2026-11-08, measured outcome): the
        // shipped build (CARR 'current') folds the chains in
        // the board plane -- NOT in span(chord, palmZ). Folding
        // them in the palm plane at THIS placement (directly,
        // or by twisting the solved joints about the chord)
        // was tried three ways and measurably
        // wrecks this placement: the MCP guard re-settles the
        // knuckles (palm length collapses to ~49-60 mm, row
        // span compresses), or, with the placement held, the
        // proximal segment ends up folded back across the
        // metacarpal (true MCP totals to ~145-172 deg). The
        // placement itself puts the chords ~70-90 deg out of
        // the palm plane, so palm-plane folding is a placement
        // redesign (rk's visual-variant call), not a chain
        // change. What the chain DOES enforce by construction
        // in its own frame: flexion only toward its bulge
        // side's opposite (the palm side of the chain plane),
        // PIP flexion clamped into [0, 90] deg (cap + floor
        // bisections in fingerChain), DIP the clamped curl in
        // [0, 70] deg, lateral exactly 0 in the chain plane.
        // Geometry section 9 measures the palm-frame
        // decomposition of the result and pins it explicitly.
        // SUPERSEDED under CARR.palmFold (solver redesign,
        // rk 2026-11-08): the three failed attempts changed
        // the fold plane of the CHORD-IK chain while the
        // guard kept scoring the projected wrap angle; the
        // redesign instead constructs the fold in the palm
        // plane (fingerChainPalm) and makes the guard score
        // THAT angle, with lateral yaw clamped and absorbed
        // by root yaw -- see the palm-fold block at
        // drawnMCPAngle.
        // Base-joint (MCP) bend of the chain: angle between the
        // first segment and the knuckle->target chord. (Chain-
        // internal -- NOT the drawn angle rk reads; see
        // drawnMCPAngle.)
        const mcp = Math.acos(clamp(dot(norm(sub(pts[1], knuckle)), norm(sub(target, knuckle))), -1, 1));
        return { points: pts, contact: contacts[f], target, mcpAngle: mcp, drawnMcp: drawnFromPts(pts), tipDir: norm(sub(pts[3], pts[2])), pip: pts.pip, dip: pts.dip, curlUsed: pts.curlUsed, chainInfeasible: pts.infeasible, slaveDip: pts.slaved === true };
      };
      for (let f = 1; f <= 4; f++) fingers[f] = buildOne(f);
      // CMC CUP DRIVER (Stage 2; research rule: the mobile
      // CMC 4/5 joints cup the palm as their fingers flex --
      // extension flattens the transverse arch, flexion
      // deepens it). The ring/little roots are shifted along
      // their own dorsal axes by (k - 1) x their rest cup
      // offset against the fixed pillar (finger 2), with k
      // from the mean PIP bend of fingers 3+4: k in [0.6,
      // 1.3], the shift itself capped at 3 mm. Runs BEFORE
      // the span repair so every repair below settles after
      // it. Two measured guards (Stage 2): the pass is gated
      // to neck/mid postures (lam < 0.5) -- in thumb position
      // the rolled hand's arch is carried by the frame, and
      // an uncapped full-range version of this pass (k to
      // 1.45, shifts to 5.3 mm, applied after the span
      // repair) measurably flipped a Swan contact finger's
      // tip direction (section 6: -0.37 against the +0.25
      // bound) and left hover chains clamped infeasible.
      // Bone mode only -- the dev modes have no cupped row.
      if (CARR.mode === 'bone' && lam < 0.5) {
        const meanPip = (fingers[3].pip + fingers[4].pip) / 2;
        const kCup = clamp(0.6 + 0.55 * (meanPip / 1.35), 0.6, 1.3);
        if (Math.abs(kCup - 1) > 0.05) {
          for (const f of [3, 4]) {
            const dz = clamp((MC_ROW.z[f] - MC_ROW.z[2]) * (kCup - 1), -0.003, 0.003);
            if (Math.abs(dz) < 0.0005) continue;
            knuckles[f] = add(knuckles[f], mul(boneZOf(f, w, knuckles[f]), dz));
            roots[f - 1] = knuckles[f];
            fingers[f] = buildOne(f);
          }
        }
      }
      // SPAN REPAIR (proximal fix, rk's method): a chain the
      // PIP/DIP clamp still flags infeasible has a span shorter
      // than both caps allow (MIN_SPAN) -- the knuckle retreats
      // from its target in 2 mm steps (<= 20 mm) until the chain
      // folds legally. Contact is untouched (the chain always
      // lands on its target); the drawn-MCP guard then re-runs,
      // its shrink lever now floored at MIN_SPAN so it cannot
      // re-shorten a repaired span back into infeasibility.
      if ([1, 2, 3, 4].some(f => fingers[f].chainInfeasible)) {
        for (let f = 1; f <= 4; f++) {
          let guard = 0;
          while (fingers[f].chainInfeasible && guard < 10) {
            // Palm-fold: a yaw-clamped contact chain is not
            // span-infeasible -- swing the root about its
            // target (chord preserved) before retreating it.
            if (CARR.mode === 'bone' && CARR.palmFold && contacts[f] &&
                fingers[f].points.latClamped && yawFix(f, w, palmZ)) {
              roots[f - 1] = knuckles[f];
              fingers[f] = buildOne(f);
              guard++;
              continue;
            }
            const stepK = add(knuckles[f], mul(norm(sub(knuckles[f], targets[f])), 0.002));
            knuckles[f] = stepK;
            roots[f - 1] = knuckles[f];
            fingers[f] = buildOne(f);
            guard++;
          }
        }
        correctMCP(w, palmZ);
        for (let f = 1; f <= 4; f++) fingers[f] = buildOne(f);
      }
      // CHAIN BOARD CLEARANCE (safety net at section 7's
      // graze bound): a near-straight chain at its longest
      // spans can sag across the board box's edge (the worst
      // shipped frames graze at the -7 mm bound). When a
      // chain's interior crosses -6.5 mm the repair is the
      // MCP guard's own shrink lever applied for clearance:
      // the knuckle walks toward its target in 2 mm steps
      // (span floored at MIN_SPAN), which raises the first
      // joint off the chord; the alternation below re-runs
      // the guard afterwards. Points within 12 mm of a
      // contact target are exempt (the fingertip wraps the
      // string there), mirroring section 7's exclusion.
      {
        const chainBoardWorst = f => {
          const pts = fingers[f].points;
          let worst = Infinity;
          for (let j = 0; j < 3; j++) for (let kk = 1; kk < 8; kk++) {
            const pt = add(pts[j], mul(sub(pts[j + 1], pts[j]), kk / 8));
            if (contacts[f] && Math.hypot(...sub(pt, targets[f])) < 0.012) continue;
            worst = Math.min(worst, boardDistK(pt) - FINGER_R[f][j]);
          }
          return worst;
        };
        for (let round = 0; round < 6; round++) {
          let any = false;
          for (let f = 1; f <= 4; f++) {
            if (chainBoardWorst(f) < -0.0065 &&
                Math.hypot(...sub(knuckles[f], targets[f])) > MIN_SPAN[f] + 0.004 &&
                // The middle knuckle's wrist distance IS the
                // palm length (section 8's 60 mm floor): the
                // shrink must not eat the palm.
                (f !== 2 || Math.hypot(...sub(knuckles[f], w)) > 0.064)) {
              knuckles[f] = add(knuckles[f], mul(norm(sub(targets[f], knuckles[f])), 0.002));
              roots[f - 1] = knuckles[f];
              fingers[f] = buildOne(f);
              any = true;
            }
          }
          if (!any) break;
        }
      }
      // Clearance and the drawn-MCP guard fight: a clearance
      // push can re-open the drawn angle past the cap (one
      // first-position frame measured 93.7 deg after its board
      // push), and a guard rotation can swing a root back
      // toward the neck. Alternate them (bounded) until both
      // hold; the mcpWorst the trial search scores is the FINAL
      // one, so the search can prefer wrists where the
      // alternation converges under the cap.
      for (let round = 0; round < 3; round++) {
        const pushed = clearAll();
        if (pushed) for (let f = 1; f <= 4; f++) fingers[f] = buildOne(f);
        mcpWorst = correctMCP(w, palmZ);
        for (let f = 1; f <= 4; f++) fingers[f] = buildOne(f);
        if (!pushed && mcpWorst <= MCP_CAP) break;
      }
      // WRIST-DEGENERATE ROOT RESCUE (Phase B, end of
      // finishHand so every consumer below -- palm masses,
      // the thumb's carpal frame, the pose -- sees the same
      // roots): in finger-1-led neck frames the guard's
      // walks can park a root within 1-3 mm of the wrist,
      // under section 8's 3 mm fan floor (the baseline
      // itself measured only 3.4-4 mm there -- a
      // knife-edge class, not a placement redesign). The
      // snapshot root is itself only ~29 mm from such a
      // wrist, so a relocation is not available; nudge the
      // parked root along the snapshot direction in 0.5 mm
      // steps to the first point at least 4.5 mm from the
      // wrist that keeps the chord bounds and the
      // drawn-MCP cap, and rebuild its chain.
      if (CARR.mode === 'bone' && snapRoots) {
        for (const f of [1, 3, 4]) {
          if (Math.hypot(...sub(knuckles[f], w)) >= 0.004) continue;
          const cur = knuckles[f], snap = snapRoots[f], Tf = targets[f];
          // Step along the WRIST->snapshot ray (the snapshot
          // metacarpal's direction): stepping root->snapshot
          // can initially point back at the wrist when the
          // parked offset is anti-aligned with the snapshot
          // (measured: all 12 steps rejected in the winning
          // attempt), while the ray grows the wrist distance
          // monotonically.
          const dirR = norm(sub(snap, w));
          const savedK = [...knuckles[f]], savedR = roots[f - 1], savedF = fingers[f], savedT = [...targets[f]];
          let accepted = false;
          for (let k = 1; k <= 20 && !accepted; k++) {
            const cand = add(cur, mul(dirR, k * 0.0005));
            if (Math.hypot(...sub(cand, w)) < 0.0045) continue;
            const chord = Math.hypot(...sub(cand, Tf));
            if (chord > reaches[f] * 0.998 || chord < MIN_SPAN[f] + 0.0005) continue;
            knuckles[f] = cand; roots[f - 1] = cand;
            fingers[f] = buildOne(f);
            // Accept on the BUILT chain's drawn angle (the
            // quantity section 9 asserts): the guard's
            // bone-frame angle reads over cap at these
            // parked roots while the chain itself sits at
            // ~71 deg, which is why a guard-angle predicate
            // could never accept a nudge here.
            if (fingers[f].drawnMcp <= MCP_CAP &&
                // Palm-fold: the nudge may not park a contact
                // root where its chain clamps off the target.
                !(CARR.palmFold && contacts[f] && fingers[f].points.latClamped)) accepted = true;
          }
          if (!accepted) {
            knuckles[f] = savedK; roots[f - 1] = savedR; fingers[f] = savedF; targets[f] = savedT;
          }
        }
      }
      mcpSync = null;
      // PALM MASSES (Stage 2; was: ONE ellipsoid fitted to the
      // roots' stations/spans). The drawn palm is now the
      // FOUNDATION's shaped masses -- the canonical PLATE,
      // KNUCKLE_PAD and HYPOTHENAR of the rest skeleton,
      // transformed into the pose's palm frame (origin = the
      // wrist joint; in bone mode the frame's Y is the middle
      // metacarpal, exactly restHand's canonical frame). The
      // drawn plate is therefore the anatomical 92 x 80 x 21
      // mm plate in every pose; the roots are cradled by the
      // UNION of the masses (section 8b measures root bridging
      // against the union, and its fitted-plate bands are
      // retired there with the reason). The plate neck-
      // clearance lift below translates the whole palm-frame
      // group rigidly, as the fitted plate's lift did.
      const palmEuler = eulerZYX(palmX, palmY, palmZ);
      const massAt = m => ({
        centre: add(add(add(w, mul(palmX, m.centre[0])), mul(palmY, m.centre[1])), mul(palmZ, m.centre[2])),
        radii: [...m.radii],
        basis: { x: palmX, y: palmY, z: palmZ },
        euler: palmEuler
      });
      const palm = massAt(PLATE);
      const pad = massAt(KNUCKLE_PAD);
      const hypothenar = massAt(HYPOTHENAR);
      const xSt = roots.map(r => dot(sub(r, midRoot), palmX));
      const xLo = Math.min(...xSt, 0), xHi = Math.max(...xSt, 0);
      const carpus = {
        centre: add(w, mul(palmY, 0.008)),
        radii: [0.026, 0.019, 0.015],
        basis: { x: palmX, y: palmY, z: palmZ },
        euler: palmEuler
      };
      // Plate clearance: the palm masses' palm side can press
      // into the neck where the hand wraps it. Sample the
      // PLATE and KNUCKLE PAD surfaces against the neck
      // cylinder; if either enters, lift the whole palm-frame
      // group (plate, pad, hypothenar -- one rigid frame) by
      // the deficit. Roots stay bridged: they sit inside the
      // masses' knuckle end, and a dorsal/radial lift only
      // buries them deeper in the union.
      // BONE mode: the plate sits rotated ~90 deg from the
      // shipped frame, so its long axis can reach AROUND the
      // neck and the dorsal lift (capped, and pointing along
      // the plate rather than away from the wood) left the
      // surface up to ~20 mm inside the cylinder. The lift
      // there runs radially off the neck axis instead -- the
      // direction the measured distance actually answers to.
      {
        // Two passes, cap on the TOTAL translation: the
        // radial direction is read off the plate centre, so
        // a large first lift can leave a rim sample still
        // short; re-measure and top up. Cap history (Stage
        // 2, all measured on the section-8b sweep): the
        // fitted plate's 24 mm cap left the canonical plate
        // 10.2 mm inside the cylinder at the worst Prelude
        // frame (its 92 mm length reaches further around
        // the neck than the fitted plate did); a per-pass
        // cap (48 total) cleared it but walked the masses
        // needlessly; a lift directed at the binding
        // SAMPLE's radial was worse still (-25 mm: the
        // plate wraps the cylinder, so one rim point's
        // radial misleads). 30 mm total lands the worst
        // surface at -4.2 mm (bound -8) while the root-
        // bridging gaps stay at their splay-set level.
        let lifted = 0;
        const LIFT_CAP = 0.030;
        for (let pass = 0; pass < 2; pass++) {
          let minD = Infinity;
          for (const mass of [palm, pad]) {
            for (const sf of SURF_P) {
              const pt = add(mass.centre, add(mul(palmX, sf[0] * mass.radii[0]),
                add(mul(palmY, sf[1] * mass.radii[1]), mul(palmZ, sf[2] * mass.radii[2]))));
              const ap = add(M.NECK_A, mul(neckAxisDir,
                clamp(dot(sub(pt, M.NECK_A), neckAxisDir), 0, axisLen)));
              minD = Math.min(minD, Math.hypot(...sub(pt, ap)) - 0.027);
            }
          }
          const capT = (CARR.mode === 'bone' ? LIFT_CAP : 0.010) - lifted;
          if (minD >= 0.002 || capT <= 0) break;
          let lift;
          if (CARR.mode === 'bone') {
            const apC = add(M.NECK_A, mul(neckAxisDir,
              clamp(dot(sub(palm.centre, M.NECK_A), neckAxisDir), 0, axisLen)));
            let rd = sub(palm.centre, apC);
            rd = Math.hypot(...rd) < 1e-6 ? palmZ : norm(rd);
            lift = mul(rd, Math.min(0.002 - minD, capT));
          } else {
            lift = mul(palmZ, Math.min(0.002 - minD, capT));
          }
          lifted += Math.hypot(...lift);
          palm.centre = add(palm.centre, lift);
          pad.centre = add(pad.centre, lift);
          hypothenar.centre = add(hypothenar.centre, lift);
        }
      }
      // Same lift for the carpus ellipsoid (its wrist-side
      // surface measured 3.0 mm into the neck at the closest
      // wrist stations); the shift is inside the wrist mass and
      // the ellipsoid still covers the wrist joint.
      {
        let minD = Infinity;
        for (const sf of SURF_P) {
          const pt = add(carpus.centre, add(mul(palmX, sf[0] * carpus.radii[0]),
            add(mul(palmY, sf[1] * carpus.radii[1]), mul(palmZ, sf[2] * carpus.radii[2]))));
          const ap = add(M.NECK_A, mul(neckAxisDir,
            clamp(dot(sub(pt, M.NECK_A), neckAxisDir), 0, axisLen)));
          minD = Math.min(minD, Math.hypot(...sub(pt, ap)) - 0.027);
        }
        if (minD < 0.002) {
          if (CARR.mode === 'bone') {
            const apC = add(M.NECK_A, mul(neckAxisDir,
              clamp(dot(sub(carpus.centre, M.NECK_A), neckAxisDir), 0, axisLen)));
            let rd = sub(carpus.centre, apC);
            rd = Math.hypot(...rd) < 1e-6 ? palmZ : norm(rd);
            carpus.centre = add(carpus.centre, mul(rd, Math.min(0.002 - minD, 0.020)));
          } else {
            carpus.centre = add(carpus.centre, mul(palmZ, Math.min(0.002 - minD, 0.008)));
          }
        }
      }
      // Elbow: chosen on its IK circle (the hinge locus for the
      // solved wrist) by ANATOMY, not by a pole. Every candidate
      // is filtered by the ROM table as a HARD constraint (phase
      // 2: these never relax -- the round-2 search let a least-
      // violation fallback pick elbows in ~35% of frames, with
      // wrist flexion to 42.7 deg, deviation to -41 deg and one
      // 154 deg shoulder cone): the SIGNED wrist posture of the
      // DRAWN palm frame against the forearm must stay inside
      // its wedge (palmar flexion only, capped deviation -- the
      // wrist is never cocked back), the upper arm inside the
      // shoulder's cone, the elbow on the player's-left half.
      // Only the forearm/neck CLEARANCE relaxes across levels.
      // If no candidate survives at any level the wrist itself
      // is wrong (rk's method: solve proximally) -- the trial
      // loops outside move the wrist placement and re-run the
      // whole assembly; the least-violation elbow is returned
      // flagged (fallback 3) only as the last resort, with its
      // violation recorded on the pose.
      // BONE mode: the elbow search certifies the WRIST,
      // whose anatomical reference frame is the carpus --
      // the shipped row-based frame with the variant roll --
      // NOT the middle finger's bone frame the plate now
      // draws from. Measuring the wedge against the bone
      // frame rotated the flex/dev readings by the frame
      // difference (~50 deg) and failed certification in
      // ~15-20% of Prelude frames at fanYawBase >= 0 over
      // assemblies that were otherwise sound. carpalY /
      // carpalZ are that carpal frame (built from the
      // un-rolled metacarpal direction); other modes keep
      // certifying the drawn frame itself.
      let carpalY = palmY, carpalZ = palmZ;
      if (CARR.mode === 'bone') {
        const rowVecC = sub(roots[3], roots[0]);
        let cX = sub(rowVecC, mul(palmYRaw, dot(rowVecC, palmYRaw)));
        if (Math.hypot(...cX) < 1e-4) cX = sub(rowDir, mul(palmYRaw, dot(rowDir, palmYRaw)));
        cX = norm(cX);
        let cZ = M.vec.cross(cX, palmYRaw);
        if (dot(cZ, backN) < 0) { cX = mul(cX, -1); cZ = mul(cZ, -1); }
        const rc = VARI.palmRoll + rollAdj, cc2 = Math.cos(rc), sc2 = Math.sin(rc);
        carpalY = add(mul(palmYRaw, cc2), mul(cZ, sc2));
        carpalZ = add(mul(cZ, cc2), mul(palmYRaw, -sc2));
      }
      const searchElbow = () => {
        const cC = add(w, mul(palmY, 0.008));
        const limbR = tau => {
          const x = 2 * tau - 1, SS = [[-1, 0.62], [-0.55, 1], [0.55, 1], [1, 0.62]];
          for (let i = 0; i < 3; i++) if (x <= SS[i + 1][0]) { const f = (x - SS[i][0]) / (SS[i + 1][0] - SS[i][0]); return 0.038 * (SS[i][1] + (SS[i + 1][1] - SS[i][1]) * f); }
          return 0.038 * 0.62;
        };
        const abN = sub(M.NECK_B, M.NECK_A), abL2 = dot(abN, abN);
        const foreScore = EL => {
          let m = Infinity;
          for (let i = 0; i <= 16; i++) {
            const tau = i / 16, q = add(EL, mul(sub(w, EL), tau));
            if (Math.hypot(...sub(q, cC)) < 0.030) continue;
            const tt = clamp(dot(sub(q, M.NECK_A), abN) / abL2, 0, 1);
            if (tt * Math.sqrt(abL2) < 0.09) continue;
            const qp = add(M.NECK_A, mul(abN, tt));
            m = Math.min(m, Math.hypot(...sub(q, qp)) - 0.027 - limbR(tau));
            if (m < -0.08) break; // below every level's floor: exact value no longer matters
          }
          return m;
        };
        const dSW = sub(w, SHOULDER_L), dLen = clamp(Math.hypot(...dSW), 0.05, (ARM[0] + ARM[1]) * 0.999);
        const dirSW = norm(dSW);
        const aSW = (ARM[0] * ARM[0] - ARM[1] * ARM[1] + dLen * dLen) / (2 * dLen);
        const hSW = Math.sqrt(Math.max(0, ARM[0] * ARM[0] - aSW * aSW));
        const C = add(SHOULDER_L, mul(dirSW, aSW));
        const seed = [0.35, -1, 0.45]; // down, toward the player's left, behind
        let perp0 = sub(seed, mul(dirSW, dot(seed, dirSW)));
        perp0 = Math.hypot(...perp0) > 1e-9 ? norm(perp0) : [0, -1, 0];
        const perp1 = M.vec.cross(dirSW, perp0);
        // SIGNED wrist model (rk round 2): the forearm -> palm-
        // axis angle decomposed in the hand's own frame --
        // flexion about the knuckle-row (radial) axis, signed
        // palmar positive, and radial/ulnar deviation about the
        // back-of-hand axis. Judged here on the FINAL drawn
        // frame (post-roll palmY/palmZ, final roots), so what
        // the search certifies is exactly what is drawn and
        // what the sweep measures; the chosen candidate's
        // flex/dev/cone are exported on the pose.
        const radRefW = norm(sub(roots[0], roots[3]));
        const wristFlexDev = E => {
          const fa = norm(sub(w, E));
          const t = sub(carpalY, mul(fa, dot(fa, carpalY)));
          const along = dot(fa, carpalY);
          const proj = v => {
            const x = sub(v, mul(fa, dot(fa, v)));
            return Math.hypot(...x) < 1e-9 ? [0, 0, 0] : norm(x);
          };
          return {
            flex: -Math.atan2(dot(t, proj(carpalZ)), along),
            dev: Math.atan2(dot(t, proj(radRefW)), along)
          };
        };
        const wedgeViol = (flex, dev) =>
          20 * Math.max(0, ROM.WRIST.flex[0] - flex) + Math.max(0, flex - ROM.WRIST.flex[1]) +
          Math.max(0, dev - ROM.WRIST.radial) + Math.max(0, -dev - ROM.WRIST.ulnar);
        const coneOf = cand => Math.acos(clamp(dot(norm(sub(cand, SHOULDER_L)), [0, -1, 0]), -1, 1));
        const scoreOf = (cand, wd, clr) => 1.6 * Math.abs(cand[1] - VARI.elbowY) +
          // Elbow lift (rk's "open the armpit" steer, dev only):
          // strong dedicated pulls toward the raised height and
          // the lateral target, so the scan measures how far
          // the wedge-feasible arc itself lets the elbow travel
          // rather than how a weak bias trades against devW.
          (CARR.liftY ? 3.0 * Math.abs(cand[1] - (VARI.elbowY + CARR.liftY)) : 0) +
          (CARR.liftX ? 3.0 * Math.abs(cand[0] - CARR.liftX) : 0) +
          VARI.devW * (Math.abs(wd.flex - VARI.flexPref) + Math.abs(wd.dev)) -
          0.8 * clr - 0.25 * cand[0];
        // Evaluate every candidate ONCE (clearance + wrist wedge
        // + cone); the levels below only filter this table.
        const CANDS = [];
        for (let k = 0; k < 128; k++) {
          const th = k / 128 * 2 * Math.PI;
          const cand = add(C, add(mul(perp0, Math.cos(th) * hSW), mul(perp1, Math.sin(th) * hSW)));
          const wd = wristFlexDev(cand);
          CANDS.push({ cand, clr: foreScore(cand), flex: wd.flex, dev: wd.dev, cone: coneOf(cand), wv: wedgeViol(wd.flex, wd.dev) });
        }
        const LEVELS = [{ clr: -0.004 }, { clr: -0.015 }, { clr: -0.030 }];
        for (let lv = 0; lv < LEVELS.length; lv++) {
          let best = null;
          for (const c of CANDS) {
            if (c.clr < LEVELS[lv].clr || c.wv > 0 || c.cand[0] < 0.02 || c.cone > ROM.SHOULDER.coneFromDown) continue;
            const score = scoreOf(c.cand, c, c.clr);
            if (!best || score < best.score) best = { elbow: c.cand, score, flex: c.flex, dev: c.dev, cone: c.cone };
          }
          if (best) return { ...best, fallback: lv, viol: 0 };
        }
        // Last resort (the trial loops score this heavily and
        // move the wrist instead): least total violation --
        // wedge (extension weighted 20x inside wedgeViol), cone
        // excess, side shortfall, clearance shortfall.
        let best = null;
        for (const c of CANDS) {
          const viol = c.wv +
            2 * Math.max(0, c.cone - ROM.SHOULDER.coneFromDown) +
            2 * Math.max(0, 0.02 - c.cand[0]) +
            0.5 * Math.max(0, -0.030 - c.clr);
          const score = scoreOf(c.cand, c, c.clr);
          if (!best || viol < best.viol - 1e-9 || (Math.abs(viol - best.viol) <= 1e-9 && score < best.score))
            best = { elbow: c.cand, score, flex: c.flex, dev: c.dev, cone: c.cone, viol };
        }
        return { ...best, fallback: 3 };
      };
      const el = searchElbow();
      return {
        roots, K, midRoot, palmX, palmY, palmZ, palmLen, palm, pad, hypothenar, carpus, xHalf: (xHi - xLo) / 2,
        elbow: el.elbow, elbowFallback: el.fallback, elbowFlex: el.flex,
        elbowDev: el.dev, elbowCone: el.cone, elbowViol: el.viol, mcpWorst,
        // The exported pronation is the CARPAL roll (variant
        // roll + trial adjustment) in every mode; in bone
        // mode rollNow itself excludes the variant roll
        // because the drawn frame is the bone frame.
        pronation: CARR.mode === 'bone' ? VARI.palmRoll + rollAdj : rollNow
      };
    };
    // One full assembly attempt from the snapshot state with a
    // given wrist (provisional drawn-MCP guard, then finishHand).
    const attempt = wTry => {
      // The palm repair inside correctMCP reverses toward
      // the middle root as it stood HERE, before this
      // attempt's own guard pre-pass travels it: finishHand's
      // later pass would otherwise only see the pre-dragged
      // root as its entry and call the damage settled.
      k2RepairTarget = [...knuckles[2]];
      bendN = bendNFor(palmFrameOf(wTry).z);
      correctMCP(wTry, palmFrameOf(wTry).z);
      const H = finishHand(wTry);
      k2RepairTarget = null;
      return H;
    };
    // The thumb's root solve from a finished assembly: CMC
    // base -> thenar slide -> short-span pullback -> neck-
    // clearance walk (lam < 0.5) -> predicted tip error.
    // Factored out of the final assembly (which calls it once
    // with the winning wrist) because the wrist trials now
    // PREDICT the thumb's tip error from every candidate
    // assembly and score it (see runTrial): the thumb used to
    // be solved only after the winning wrist was fixed, so
    // its reach never influenced the placement -- in thumb
    // position the root->rest span sat past the chain's reach
    // at every tried wrist and the settled tip error measured
    // 5.8 mm (bone-finalization debit (a), 2026-11-08).
    // Prediction and final solve share this code so they
    // cannot drift apart.
    const thumbSolveFor = (wS, H) => {
      const rootsS = H.roots, KS = H.K;
      // BONE mode: the thumb's CMC sits in the CARPAL frame
      // (research rule: the thumb roots at the trapezium at
      // wrist level, in its own saddle -- it is not slaved to
      // the middle finger's bone frame). Placing the base
      // from the bone frame displaced it by ~1-2 cm in some
      // frames and cost the thumb its settled rest; the
      // carpal frame is the shipped derivation (row-based,
      // rolled by the exported pronation).
      let thY = H.palmY, thX = H.palmX, thZ = H.palmZ;
      if (CARR.mode === 'bone') {
        const cY = norm(sub(rootsS[1], wS));
        const rowC = sub(rootsS[3], rootsS[0]);
        let cX = sub(rowC, mul(cY, dot(rowC, cY)));
        cX = Math.hypot(...cX) < 1e-4 ? H.palmX : norm(cX);
        let cZ = M.vec.cross(cX, cY);
        if (dot(cZ, backN) < 0) { cX = mul(cX, -1); cZ = mul(cZ, -1); }
        const rc = H.pronation, cc3 = Math.cos(rc), sc3 = Math.sin(rc);
        thY = add(mul(cY, cc3), mul(cZ, sc3));
        thZ = add(mul(cZ, cc3), mul(cY, -sc3));
        thX = cX;
      }
      // FOUNDATION (2026-11-08): the base offsets ARE the
      // rest skeleton's THUMB_BASE, read in the carpal frame:
      // 6 mm distal of the wrist joint centre (trapezium, at
      // wrist level -- was 20 mm, up beside the finger CMC
      // row), 30 mm toward the index side (was 22), and 16 mm
      // palmar of the frame's dorsal plane (was 8 -- the old
      // base parked the thumb chain in the palm plane, the
      // in-plane fifth finger of the open-hand diagnostic).
      const thSign = Math.sign(dot(sub(rootsS[0], KS), thX)) || 1;
      const base = add(add(add(wS, mul(thY, THUMB_BASE[1])),
        mul(thX, thSign * -THUMB_BASE[0])), mul(thZ, THUMB_BASE[2]));
      const thumbMax = THUMB_LEN[0] + Math.sqrt(THUMB_LEN[1] ** 2 + THUMB_LEN[2] ** 2 +
        2 * THUMB_LEN[1] * THUMB_LEN[2] * Math.cos(0.35));
      // Thenar slide + CMC rotation (Stage 2 rework around
      // the trapezium base), in three stages, each solved
      // against the actual span by bisection:
      // (0) ROTATION SHARE: the root first swings about the
      //     WRIST joint centre around the carpal frame's
      //     dorsal axis (the opposition swing of the thenar
      //     complex), bisected to leave the last ~12 mm of
      //     span excess for the slide. The arc's tangent
      //     carries the along-palm component the Swan
      //     thumb-position deficit lives on (measured: the
      //     palm-axis component is +88..96 mm of a 111-118
      //     mm base->rest span, ~75% -- the old slide
      //     formula, sized from the base->rest distance
      //     along a direction perpendicular to that axis,
      //     closed only part of its nominal amount and the
      //     settled tip error measured 6.26 mm), and a root
      //     placed on the arc sits dorsal of the in-plane
      //     slide line: a slide-only root parked the
      //     proximal phalanx across the fingerboard box's
      //     corner at the Swan brace frames (centreline
      //     -2.6 mm, section 5's count).
      // (1) SLIDE: the root slides toward the rest point
      //     within the palm plane, up to 35 mm, magnitude
      //     bisected on the actual span (see (0) for why the
      //     old distance formula undershot).
      // (2) TOP-UP ROTATION: whatever the saturated slide
      //     still cannot close, a further swing about the
      //     wrist centre does, capped so the TOTAL swing
      //     stays within THUMB_CMC_ROT_MAX.
      let root = base, slideUsed = 0, cmcRot = 0, rotFirst = 0;
      {
        const spanTarget = thumbMax * 0.999 - 0.0015;
        const toRest = sub(restPt, base);
        if (Math.hypot(...toRest) > spanTarget) {
          let inDir = sub(toRest, mul(H.palmY, dot(toRest, H.palmY)));
          inDir = Math.hypot(...inDir) < 1e-6 ? norm(toRest) : norm(inDir);
          const rotAbout = (pt, th) => {
            const rel = sub(pt, wS), c = Math.cos(th), s = Math.sin(th);
            return add(wS, add(add(mul(rel, c), mul(M.vec.cross(thZ, rel), s)), mul(thZ, dot(thZ, rel) * (1 - c))));
          };
          const rotSgn = pt => Math.hypot(...sub(restPt, rotAbout(pt, 0.05))) < Math.hypot(...sub(restPt, rotAbout(pt, -0.05))) ? 1 : -1;
          // (0) rotation share
          {
            const shareTarget = spanTarget + 0.012, sgn = rotSgn(base);
            if (Math.hypot(...sub(restPt, rotAbout(base, sgn * THUMB_CMC_ROT_MAX))) > shareTarget) rotFirst = sgn * THUMB_CMC_ROT_MAX;
            else {
              let lo = 0, hi = THUMB_CMC_ROT_MAX;
              for (let i = 0; i < 18; i++) { const mid = (lo + hi) / 2; if (Math.hypot(...sub(restPt, rotAbout(base, sgn * mid))) > shareTarget) lo = mid; else hi = mid; }
              rotFirst = sgn * hi;
            }
            root = rotAbout(base, rotFirst);
          }
          // (1) slide from the rotated root
          {
            const rootAt = s => add(root, mul(inDir, s));
            if (Math.hypot(...sub(restPt, rootAt(0.035))) > spanTarget) slideUsed = 0.035;
            else {
              let lo = 0, hi = 0.035;
              for (let i = 0; i < 18; i++) { const mid = (lo + hi) / 2; if (Math.hypot(...sub(restPt, rootAt(mid))) > spanTarget) lo = mid; else hi = mid; }
              slideUsed = hi;
            }
            root = rootAt(slideUsed);
          }
          // (2) top-up rotation, total swing within the cap
          if (Math.hypot(...sub(restPt, root)) > spanTarget) {
            const room = Math.max(0, THUMB_CMC_ROT_MAX - Math.abs(rotFirst)), sgn = rotSgn(root);
            if (Math.hypot(...sub(restPt, rotAbout(root, sgn * room))) > spanTarget) cmcRot = sgn * room;
            else {
              let lo = 0, hi = room;
              for (let i = 0; i < 18; i++) { const mid = (lo + hi) / 2; if (Math.hypot(...sub(restPt, rotAbout(root, sgn * mid))) > spanTarget) lo = mid; else hi = mid; }
              cmcRot = sgn * hi;
            }
            root = rotAbout(root, cmcRot);
          }
        }
      }
      // Short-span pullback (proximal fix, rk's method): if
      // the rest point is closer to the root than the capped
      // chain can fold to, retreat the root toward the wrist
      // (bisected so the span equals the target, else all
      // the way).
      // PHASE B (2026-11-08): the target is no longer the
      // coupled-caps MINIMUM resultant (60.6 mm -- the span
      // that forced the (55 deg, 80.6 deg) crumple in every
      // settled neck frame). It is 82 mm, inside the
      // MCP-first distribution's band, where the same chain
      // folds at ~(43 deg MCP, <=35 deg IP) with the
      // metacarpal laid along the neck. Spans the wrist
      // locus cannot stretch to 82 mm keep the legacy fold
      // (transient class; the sweep measures it).
      let pullback = 0;
      {
        const minSpan = 0.082;
        const root0 = root;
        const spanAt = k => Math.hypot(...sub(restPt, add(root0, mul(sub(wS, root0), k))));
        if (spanAt(0) < minSpan) {
          if (spanAt(1) <= minSpan) {
            root = add(root0, sub(wS, root0));
            pullback = 1;
          } else {
            let lo = 0, hi = 1;
            for (let i = 0; i < 18; i++) {
              const mid = (lo + hi) / 2;
              if (spanAt(mid) < minSpan) lo = mid; else hi = mid;
            }
            root = add(root0, mul(sub(wS, root0), hi));
            pullback = hi;
          }
        }
      }
      // Neck clearance for the metacarpal capsule (neck
      // positions): walk the root further along the pullback
      // locus toward the wrist -- the span grows but stays
      // inside the chain's reach -- until the 16 mm capsule
      // clears the neck cylinder (best effort where even the
      // wrist end cannot clear within reach).
      if (lam < 0.5) {
        const need = 0.027 + THUMB_R[0] + 0.001;
        const axD = q => Math.hypot(...sub(q, add(M.NECK_A, mul(neckAxisDir,
          clamp(dot(sub(q, M.NECK_A), neckAxisDir), 0, axisLen)))));
        if (axD(root) < need) {
          const root0 = root, seg = sub(wS, root0);
          const spanLim = thumbMax * 0.999 - 0.004;
          const spanAt = k => Math.hypot(...sub(restPt, add(root0, mul(seg, k))));
          let kReach = 1;
          if (spanAt(1) > spanLim) {
            let lo = 0, hi = 1;
            for (let i = 0; i < 18; i++) { const mid = (lo + hi) / 2; if (spanAt(mid) <= spanLim) lo = mid; else hi = mid; }
            kReach = lo;
          }
          let kFound = -1, kPrev = 0;
          for (let i = 1; i <= 24 && kFound < 0; i++) {
            const k = kReach * i / 24;
            if (axD(add(root0, mul(seg, k))) >= need) {
              let lo = kPrev, hi = k;
              for (let it = 0; it < 14; it++) { const mid = (lo + hi) / 2; if (axD(add(root0, mul(seg, mid))) >= need) hi = mid; else lo = mid; }
              kFound = hi;
            }
            kPrev = k;
          }
          if (kFound >= 0) root = add(root0, mul(seg, kFound));
        }
      }
      return { root, base, pullback, slide: slideUsed, cmcRot, rotFirst, thX, thY, thZ, thSign, tipErr: thumbChain(root, restPt, dorsalRefT).tipErr };
    };
    // ============================================================
    // ROM SOLVER (rk's three principles, 2026-11-09;
    // CARR.romSolve, bone mode only) =============================
    // rk's directive: "bone lengths never change; every joint
    // stays within its ROM; that should be enough; unused
    // fingers need do nothing." This path rebuilds the pose
    // solution on exactly those rules and nothing else:
    //  1. RIGID SKELETON. The knuckle roots and CMC bases are
    //     the Stage 1 skeleton's canonical points (MC_ROOTS /
    //     MC_BASE) carried by ONE rigid frame (anchored at
    //     the middle root, oriented by the palm axis and the
    //     middle finger's bone frame, plus a roll about the
    //     palm axis; the wrist is derived from the frame). No root is ever walked, shrunk, repaired
    //     or restored: |wrist -> root| is the skeleton's own
    //     distance in every frame (the middle root's is
    //     PALM_LEN exactly), pairwise root distances are the
    //     canonical ones, and every chain walks its table
    //     segment lengths. If a target cannot be reached, the
    //     PLACEMENT (the frame) moves -- never the bones.
    //  2. ROM FEASIBILITY IS THE ONLY CRITERION. A candidate
    //     placement is accepted iff EVERY stopping chain,
    //     solved in its own bone plane by the ordinary chain
    //     solve (PIP/DIP caps and the DIP slave inside
    //     solveCurl), lands exactly on its plan target with
    //     the drawn MCP inside rk's 90 deg cap, the elbow
    //     search certifies inside the wedge/cone at a stated
    //     clearance level (fallback <= 2, viol 0), the thumb
    //     solve reaches its rest point inside the section-9
    //     bounds, and the whole assembly satisfies the hard
    //     physical gates (section 5 capsule/centreline bounds,
    //     section 6 posture bands). No fold terms, no split
    //     penalties, no soft-score trading across fingers: the
    //     first feasible candidate in a fixed near-to-far
    //     order from the shipped placement seed wins. If NO
    //     candidate is feasible the frame is logged to
    //     ROM_LOG with the concrete failures and the shipped
    //     search below runs instead -- the finding is reported,
    //     never papered over by violating 1 or 2.
    //  3. UNUSED FINGERS DO NOTHING. A finger that is not
    //     stopping is not solved, targeted, relaxed or
    //     clearance-chased: it rides the rigid frame in the
    //     Stage 1 rest cascade (restHand's own construction,
    //     REST_CURL in its own bone plane). Only across the
    //     note-transition window (the module's track() lead:
    //     gap x 0.85 clamped to [0.03, 0.18] s, smooth easing)
    //     does it blend -- joint angles and first-segment
    //     direction interpolated in its own fold plane --
    //     toward the chain solved for its driving assignment's
    //     exact contact point, arriving at env = 1 exactly when
    //     the note starts, and symmetrically after it ends.
    // The stopping chains are the shipped bone-mode chains
    // (fingerChain in the finger's own boneZOf plane): what
    // changes is the placement and the absence of every
    // proximal repair downstream of it.
    // Keep the old thumb construction/anchors byte-identical; only
    // acceptance clearances use the physical STEP 3 surfaces.
    const legacyRomBoardD = q => {
      const rel = sub(q, M.BOARD.A), a = dot(rel, M.BOARD.dir), b = dot(rel, M.v), c = dot(rel, M.BOARD.normal);
      const halfW = 0.023 + 0.008 * clamp(a / M.BOARD.END, 0, 1);
      const da = a < 0 ? -a : (a > M.BOARD.END ? a - M.BOARD.END : 0);
      const db = Math.max(Math.abs(b) - halfW, 0);
      const dc = c > 0.0008 ? c - 0.0008 : (c < -0.0062 ? -0.0062 - c : 0);
      if (da === 0 && db === 0 && dc === 0) return -Math.min(halfW - Math.abs(b), c + 0.0062, 0.0008 - c, a, M.BOARD.END - a);
      return Math.hypot(da, db, dc);
    };
    const romBoardD = M.BOARD.distance;
    const romNeckSurfaceD = M.NECK.distance;
    const romNeckD = q => {
      const ab = sub(M.NECK_B, M.NECK_A), tt = clamp(dot(sub(q, M.NECK_A), ab) / dot(ab, ab), 0, 1);
      return Math.hypot(...sub(q, add(M.NECK_A, mul(ab, tt))));
    };
    const romAxPt = q => add(M.NECK_A, mul(neckAxisDir, clamp(dot(sub(q, M.NECK_A), neckAxisDir), 0, axisLen)));
    // Section 5's own measures, replicated: capsule clearance
    // vs the neck cylinder and the board box, and the count
    // of centrelines inside the box, with the suite's contact
    // exclusions around the chain's target.
    const romChainClear = (pts, radii, target, ex) => {
      let neck = Infinity, board = Infinity, inside = 0;
      for (let j = 0; j < 3; j++) for (let kk = 0; kk <= 8; kk++) {
        const pt = pts[j].map((v, q) => v + (pts[j + 1][q] - v) * kk / 8);
        const dT = Math.hypot(...sub(pt, target));
        if (dT >= ex.neck) neck = Math.min(neck, romNeckSurfaceD(pt) - radii[j]);
        if (dT >= ex.boardC && romBoardD(pt) < 0) inside++;
        if (dT >= ex.boardCap) board = Math.min(board, romBoardD(pt) - radii[j]);
      }
      return { neck, board, inside };
    };
    // buildOne's drawnFromPts, shared shape: the drawn base
    // angle from a built chain's own points.
    const romDrawn = (pts, root, w) => {
      const meta = sub(root, w), seg = sub(pts[1], pts[0]);
      let nrm = M.vec.cross(seg, sub(pts[3], pts[0]));
      nrm = Math.hypot(...nrm) < 1e-9 ? M.n : norm(nrm);
      const mp = sub(meta, mul(nrm, dot(meta, nrm)));
      return Math.hypot(...mp) < 1e-9 ? 0 : Math.acos(clamp(dot(norm(mp), norm(seg)), -1, 1));
    };
    const romRecord = (pts, target, contact, w, root, sv) => ({
      points: pts, contact, target,
      mcpAngle: Math.acos(clamp(dot(norm(sub(pts[1], pts[0])), norm(sub(target, pts[0]))), -1, 1)),
      drawnMcp: romDrawn(pts, root, w), tipDir: norm(sub(pts[3], pts[2])),
      pip: sv.pip, dip: sv.dip, curlUsed: sv.curlUsed, chainInfeasible: sv.infeasible, slaveDip: sv.slaved === true,
      // STEP 2: a pad-contact chain declares its contact point
      // (the suites measure contact error THERE) and its pad
      // parameters; axis-tip chains carry neither field (the
      // shipped records are unchanged byte for byte).
      ...(pts.padPt ? { contactPt: pts.padPt, pad: { s: pts.pad.s, r: pts.pad.r, normal: pts.pad.normal } } : {})
    });
    // The rest cascade in pose space: restHand's own
    // construction (chainFrom with the per-joint axis
    // cross(boneZ, dir), flexion rotating the ray toward the
    // palm side of the finger's bone frame), rooted on the
    // rigid frame. The metacarpal direction is base -> root,
    // as in the canonical assembly.
    const romRestChain = (f, w, root, base) => {
      const z = boneZOf(f, w, root), lens = FINGER_LEN[f], angs = REST_CURL[f];
      const pts = [root];
      let p = root, d = norm(sub(root, base));
      for (let j = 0; j < 3; j++) {
        if (angs[j]) {
          const ax = norm(M.vec.cross(z, d)), th = angs[j] * Math.PI / 180, c = Math.cos(th), s = Math.sin(th);
          d = norm(add(add(mul(d, c), mul(M.vec.cross(ax, d), s)), mul(ax, dot(ax, d) * (1 - c))));
        }
        p = add(p, mul(d, lens[j])); pts.push(p);
      }
      return pts;
    };
    const romRestRecord = (pts, w, root, f) => romRecord(pts, pts[3], false, w, root,
      { pip: REST_CURL[f][1] * Math.PI / 180, dip: REST_CURL[f][2] * Math.PI / 180, curlUsed: REST_CURL[f][2] * Math.PI / 180, infeasible: false, slaved: false });
    // Transition envelope for a non-stopping finger: the
    // max over its assignments of the in/out ramps (the
    // track() lead rule), plus the driving assignment's exact
    // contact point (the one whose ramp is highest).
    const romEnvOf = f => {
      const list = romAssignFor(song)[f];
      let env = 0, cp = null;
      for (let i = 0; i < list.length; i++) {
        const a = list[i];
        const gapIn = i > 0 ? a.s - list[i - 1].e : Infinity;
        const gapOut = i < list.length - 1 ? list[i + 1].s - a.e : Infinity;
        const Lin = clamp(gapIn * 0.85, 0.03, 0.18), Lout = clamp(gapOut * 0.85, 0.03, 0.18);
        let e1 = 1;
        if (t < a.s) e1 = smooth((t - (a.s - Lin)) / Lin);
        else if (t > a.e) e1 = 1 - smooth((t - a.e) / Lout);
        if (e1 > env) { env = e1; cp = a.cp; }
      }
      return { env: clamp(env, 0, 1), cp };
    };
    // Signed joint flexion of a built chain in its bone
    // frame (geometry section 9's pfJ/dfJ convention), and
    // the walk normal (the flexion rotation axis, -nb).
    const romBendOf = (pts, j, pz, target = pts[3]) => {
      const dirC = norm(sub(target, pts[0]));
      let side = sub(pz, mul(dirC, dot(pz, dirC)));
      if (Math.hypot(...side) < 1e-6) return 0;
      side = norm(side);
      const nb = norm(M.vec.cross(dirC, side));
      const s1 = norm(sub(pts[j + 1], pts[j])), s2 = norm(sub(pts[j + 2], pts[j + 1]));
      return -Math.atan2(dot(M.vec.cross(s1, s2), nb), dot(s1, s2));
    };
    const romWalkN = (pts, pz) => {
      const dirC = norm(sub(pts[3], pts[0]));
      let side = sub(pz, mul(dirC, dot(pz, dirC)));
      if (Math.hypot(...side) < 1e-6) return null;
      side = norm(side);
      return mul(norm(M.vec.cross(dirC, side)), -1);
    };
    // Blend rest -> solved in the finger's own fold family:
    // first-segment direction, PIP and DIP flexion and the
    // fold-plane normal are interpolated; the chain is then
    // re-walked at the table segment lengths, so lengths are
    // exact at every env, the blend reproduces the rest chain
    // at env = 0 and the solved chain at env = 1, and nothing
    // pops at the window edges.
    const romBlend = (f, root, restPts, solvPts, env, pz) => {
      const lens = FINGER_LEN[f];
      const d0 = norm(lerp(norm(sub(restPts[1], root)), norm(sub(solvPts[1], root)), env));
      const b1 = slerp(romBendOf(restPts, 0, pz), romBendOf(solvPts, 0, pz), env);
      const b2 = slerp(romBendOf(restPts, 1, pz), romBendOf(solvPts, 1, pz), env);
      let nR = romWalkN(restPts, pz), nS = romWalkN(solvPts, pz);
      if (!nR) nR = nS;
      if (!nS) nS = nR;
      if (nR && nS && dot(nR, nS) < 0) nS = mul(nS, -1);
      const nB = nR && nS ? norm(lerp(nR, nS, env)) : (nS || nR);
      const rotD = (d, ang) => {
        if (!nB || !ang) return d;
        const c = Math.cos(ang), s = Math.sin(ang);
        return norm(add(add(mul(d, c), mul(M.vec.cross(nB, d), s)), mul(nB, dot(nB, d) * (1 - c))));
      };
      const pts = [root];
      let p = root, d = d0;
      p = add(p, mul(d, lens[0])); pts.push(p);
      d = rotD(d, b1); p = add(p, mul(d, lens[1])); pts.push(p);
      d = rotD(d, b2); p = add(p, mul(d, lens[2])); pts.push(p);
      return { pts, pip: b1, dip: b2 };
    };
    // finishHand's elbow search, replicated on this solver's
    // frame (the carpal frame derivation is the bone mode's:
    // row-based, rolled by the exported pronation -- here the
    // variant roll only, rollAdj = 0). Wedge/cone/side are
    // hard; only the forearm clearance relaxes across levels.
    const romElbow = (w, rootsArr, palmYv) => {
      const rowVecC = sub(rootsArr[3], rootsArr[0]);
      let cX = sub(rowVecC, mul(palmYv, dot(rowVecC, palmYv)));
      if (Math.hypot(...cX) < 1e-4) cX = sub(rowDir, mul(palmYv, dot(rowDir, palmYv)));
      cX = norm(cX);
      let cZ = M.vec.cross(cX, palmYv);
      if (dot(cZ, backN) < 0) { cX = mul(cX, -1); cZ = mul(cZ, -1); }
      const rc = VARI.palmRoll, cc2 = Math.cos(rc), sc2 = Math.sin(rc);
      const carpalY = add(mul(palmYv, cc2), mul(cZ, sc2));
      const carpalZ = add(mul(cZ, cc2), mul(palmYv, -sc2));
      const cC = add(w, mul(palmYv, 0.008));
      const limbR = tau => {
        const x = 2 * tau - 1, SS = [[-1, 0.62], [-0.55, 1], [0.55, 1], [1, 0.62]];
        for (let i = 0; i < 3; i++) if (x <= SS[i + 1][0]) { const f = (x - SS[i][0]) / (SS[i + 1][0] - SS[i][0]); return 0.038 * (SS[i][1] + (SS[i + 1][1] - SS[i][1]) * f); }
        return 0.038 * 0.62;
      };
      const abN = sub(M.NECK_B, M.NECK_A), abL2 = dot(abN, abN);
      const foreScore = EL => {
        let m = Infinity;
        for (let i = 0; i <= 16; i++) {
          const tau = i / 16, q = add(EL, mul(sub(w, EL), tau));
          if (Math.hypot(...sub(q, cC)) < 0.030) continue;
          const tt = clamp(dot(sub(q, M.NECK_A), abN) / abL2, 0, 1);
          if (tt * Math.sqrt(abL2) < 0.09) continue;
          const qp = add(M.NECK_A, mul(abN, tt));
          m = Math.min(m, Math.hypot(...sub(q, qp)) - 0.027 - limbR(tau));
          if (m < -0.08) break;
        }
        return m;
      };
      const dSW = sub(w, SHOULDER_L), dLen = clamp(Math.hypot(...dSW), 0.05, (ARM[0] + ARM[1]) * 0.999);
      const dirSW = norm(dSW);
      const aSW = (ARM[0] * ARM[0] - ARM[1] * ARM[1] + dLen * dLen) / (2 * dLen);
      const hSW = Math.sqrt(Math.max(0, ARM[0] * ARM[0] - aSW * aSW));
      const C = add(SHOULDER_L, mul(dirSW, aSW));
      const seed = [0.35, -1, 0.45];
      let perp0 = sub(seed, mul(dirSW, dot(seed, dirSW)));
      perp0 = Math.hypot(...perp0) > 1e-9 ? norm(perp0) : [0, -1, 0];
      const perp1 = M.vec.cross(dirSW, perp0);
      const radRefW = norm(sub(rootsArr[0], rootsArr[3]));
      const wristFlexDev = E => {
        const fa = norm(sub(w, E));
        const tt2 = sub(carpalY, mul(fa, dot(fa, carpalY)));
        const along = dot(fa, carpalY);
        const proj = v => {
          const x = sub(v, mul(fa, dot(fa, v)));
          return Math.hypot(...x) < 1e-9 ? [0, 0, 0] : norm(x);
        };
        return {
          flex: -Math.atan2(dot(tt2, proj(carpalZ)), along),
          dev: Math.atan2(dot(tt2, proj(radRefW)), along)
        };
      };
      const wedgeViol = (flex, dev) =>
        20 * Math.max(0, ROM.WRIST.flex[0] - flex) + Math.max(0, flex - ROM.WRIST.flex[1]) +
        Math.max(0, dev - ROM.WRIST.radial) + Math.max(0, -dev - ROM.WRIST.ulnar);
      const coneOf = cand => Math.acos(clamp(dot(norm(sub(cand, SHOULDER_L)), [0, -1, 0]), -1, 1));
      const scoreOf = (cand, wd, clr) => 1.6 * Math.abs(cand[1] - VARI.elbowY) +
        (CARR.liftY ? 3.0 * Math.abs(cand[1] - (VARI.elbowY + CARR.liftY)) : 0) +
        (CARR.liftX ? 3.0 * Math.abs(cand[0] - CARR.liftX) : 0) +
        VARI.devW * (Math.abs(wd.flex - VARI.flexPref) + Math.abs(wd.dev)) -
        0.8 * clr - 0.25 * cand[0];
      const CANDS = [];
      for (let k = 0; k < 128; k++) {
        const th = k / 128 * 2 * Math.PI;
        const cand = add(C, add(mul(perp0, Math.cos(th) * hSW), mul(perp1, Math.sin(th) * hSW)));
        const wd = wristFlexDev(cand);
        CANDS.push({ cand, clr: foreScore(cand), flex: wd.flex, dev: wd.dev, cone: coneOf(cand), wv: wedgeViol(wd.flex, wd.dev) });
      }
      const LEVELS = [{ clr: -0.004 }, { clr: -0.015 }, { clr: -0.030 }];
      for (let lv = 0; lv < LEVELS.length; lv++) {
        let best = null;
        for (const c of CANDS) {
          if (c.clr < LEVELS[lv].clr || c.wv > 0 || c.cand[0] < 0.02 || c.cone > ROM.SHOULDER.coneFromDown) continue;
          const score = scoreOf(c.cand, c, c.clr);
          if (!best || score < best.score) best = { elbow: c.cand, score, flex: c.flex, dev: c.dev, cone: c.cone };
        }
        if (best) return { ...best, fallback: lv, viol: 0 };
      }
      let best = null;
      for (const c of CANDS) {
        const viol = c.wv +
          2 * Math.max(0, c.cone - ROM.SHOULDER.coneFromDown) +
          2 * Math.max(0, 0.02 - c.cand[0]) +
          0.5 * Math.max(0, -0.030 - c.clr);
        const score = scoreOf(c.cand, c, c.clr);
        if (!best || viol < best.viol - 1e-9 || (Math.abs(viol - best.viol) <= 1e-9 && score < best.score))
          best = { elbow: c.cand, score, flex: c.flex, dev: c.dev, cone: c.cone, viol };
      }
      return { ...best, fallback: 3 };
    };
    // finishHand's palm masses (canonical masses in the pose
    // frame) with the plate/carpus neck lifts, replicated:
    // the lift translates the mass group only, never a root.
    const romMasses = (w, palmX, palmY, palmZ) => {
      const palmEuler = eulerZYX(palmX, palmY, palmZ);
      const massAt = m => ({
        centre: add(add(add(w, mul(palmX, m.centre[0])), mul(palmY, m.centre[1])), mul(palmZ, m.centre[2])),
        radii: [...m.radii],
        basis: { x: palmX, y: palmY, z: palmZ },
        euler: palmEuler
      });
      const palm = massAt(PLATE);
      const pad = massAt(KNUCKLE_PAD);
      const hypothenar = massAt(HYPOTHENAR);
      const carpus = {
        centre: add(w, mul(palmY, 0.008)),
        radii: [0.026, 0.019, 0.015],
        basis: { x: palmX, y: palmY, z: palmZ },
        euler: palmEuler
      };
      {
        let lifted = 0;
        const LIFT_CAP = 0.030;
        for (let pass = 0; pass < 2; pass++) {
          let minD = Infinity;
          for (const mass of [palm, pad]) {
            for (const sf of SURF_P) {
              const pt = add(mass.centre, add(mul(palmX, sf[0] * mass.radii[0]),
                add(mul(palmY, sf[1] * mass.radii[1]), mul(palmZ, sf[2] * mass.radii[2]))));
              minD = Math.min(minD, romNeckD(pt) - 0.027);
            }
          }
          const capT = LIFT_CAP - lifted;
          if (minD >= 0.002 || capT <= 0) break;
          const apC = romAxPt(palm.centre);
          let rd = sub(palm.centre, apC);
          rd = Math.hypot(...rd) < 1e-6 ? palmZ : norm(rd);
          const lift = mul(rd, Math.min(0.002 - minD, capT));
          lifted += Math.hypot(...lift);
          palm.centre = add(palm.centre, lift);
          pad.centre = add(pad.centre, lift);
          hypothenar.centre = add(hypothenar.centre, lift);
        }
      }
      {
        let minD = Infinity;
        for (const sf of SURF_P) {
          const pt = add(carpus.centre, add(mul(palmX, sf[0] * carpus.radii[0]),
            add(mul(palmY, sf[1] * carpus.radii[1]), mul(palmZ, sf[2] * carpus.radii[2]))));
          minD = Math.min(minD, romNeckD(pt) - 0.027);
        }
        if (minD < 0.002) {
          const apC = romAxPt(carpus.centre);
          let rd = sub(carpus.centre, apC);
          rd = Math.hypot(...rd) < 1e-6 ? palmZ : norm(rd);
          carpus.centre = add(carpus.centre, mul(rd, Math.min(0.002 - minD, 0.020)));
        }
      }
      return { palm, pad, hypothenar, carpus };
    };
    const romSurfMin = (mass, fn) => {
      let m = Infinity;
      const B = mass.basis, C = mass.centre, r = mass.radii;
      for (const sf of SURF_P) {
        const pt = add(C, add(mul(B.x, sf[0] * r[0]), add(mul(B.y, sf[1] * r[1]), mul(B.z, sf[2] * r[2]))));
        m = Math.min(m, fn(pt));
      }
      return m;
    };
    // The final assembly's thumb clearance rotation,
    // replicated (rigid rotation of the interior joints about
    // the root -> tip axis; root, tip and bends unchanged).
    const romThumbClear = (pts0, root) => {
      const boxD = legacyRomBoardD;
      const breachT = pts => {
        let worst = Infinity;
        for (let j = 0; j < 3; j++) for (let kk = 0; kk <= 8; kk++) {
          const pt = pts[j].map((v, q) => v + (pts[j + 1][q] - v) * kk / 8);
          if (Math.hypot(...sub(pt, restPt)) < 0.012) continue;
          worst = Math.min(worst, boxD(pt) - THUMB_R[j] + 0.0165);
          worst = Math.min(worst, romNeckD(pt) - 0.027 - THUMB_R[j] + 0.0025);
        }
        return worst;
      };
      const minBoxC = pts => {
        let worst = Infinity;
        for (let j = 0; j < 3; j++) for (let kk = 0; kk <= 8; kk++) {
          const pt = pts[j].map((v, q) => v + (pts[j + 1][q] - v) * kk / 8);
          if (Math.hypot(...sub(pt, restPt)) < 0.012) continue;
          worst = Math.min(worst, boxD(pt));
        }
        return worst;
      };
      if (breachT(pts0) >= 0 && minBoxC(pts0) >= 0.0005) return pts0;
      const axT = norm(sub(restPt, root));
      const better = (e, b) => {
        const ef = e.m >= 0, bf = b.m >= 0;
        if (ef !== bf) return ef;
        if (ef) return e.c > b.c + 1e-9;
        return e.m > b.m + 1e-9;
      };
      let best = pts0, bestE = { m: breachT(pts0), c: minBoxC(pts0) };
      for (let ai = 1; ai <= 15; ai++) for (const sgn of [1, -1]) {
        const ang = sgn * ai * 0.06, c = Math.cos(ang), s = Math.sin(ang);
        const rotP = p => {
          const rel = sub(p, root);
          return add(root, add(add(mul(rel, c), mul(M.vec.cross(axT, rel), s)), mul(axT, dot(axT, rel) * (1 - c))));
        };
        const cand = [pts0[0], rotP(pts0[1]), rotP(pts0[2]), pts0[3]];
        const e = { m: breachT(cand), c: minBoxC(cand) };
        if (better(e, bestE)) { bestE = e; best = cand; }
      }
      return best;
    };
    // One candidate placement: the rigid frame anchored at
    // the middle root A (the placement's anchor point), its
    // palm axis along by, rolled by roll about by. The wrist
    // is DERIVED (A minus the frame's middle-root offset) --
    // an outcome the gates judge, not an input. Returns
    // { fail: [...] } or the finished assembly { H, recs }.
    // GATE CLASSES (STEP 1, 2026-11-10 -- the consult's point
    // (1)): every gate below is either a CONSTRAINT -- bone
    // lengths (by construction), the ROM table (chain caps,
    // drawn MCP <= cap, the elbow search's wedge/cone),
    // contact (finger contact exact, thumb on its rest
    // point), physical clearance (section 5's capsule/
    // centreline bounds, the wrist centre out of the wood,
    // section 8's palm-mass surfaces) -- or a BAND: section
    // 6's posture statistics (back-of-hand components,
    // wristLat / wristFb / palmLat), the 11 mm wristAxis
    // centre clearance, the chain-internal MCP form bounds
    // (mcpNeck / mcpThumb / tipPlayer) and section 10's
    // resting-thumb IP <= 40 deg. The bands are the SHIPPED
    // placement's measured ranges (fit to a solver that
    // collapses the palm 88 -> 72-82 mm and walks roots up
    // to 56 mm); judging a rigid-skeleton solve by them is
    // circular, so they are reported (diag), not gated.
    // CARR.romBandGate = 1 restores the pre-STEP-1 gating
    // (dev knob: reproduces the old solve rate).
    const romTry = (A, by, roll) => {
      const fail = [], diag = [];
      // viol: the constraint violation (the search heuristic of
      // the constraint-only descent). violB: the PRE-STEP-1
      // staged violation -- constraints + bands, accumulated
      // only up to the first stage at which the old gating
      // would have returned -- kept as a SEARCH heuristic only
      // (romAssemble's first pass replays the old descent
      // trajectory with it, so the solved set is a superset of
      // the pre-STEP-1 one); acceptance never reads it.
      let viol = 0, violB = 0, stopB = false, stageAny = false;
      const F = (v, s) => { fail.push(s); viol += Math.max(0, v); if (!stopB) violB += Math.max(0, v); stageAny = true; };
      const Bd = (v, s) => {
        if (CARR.romBandGate) { F(v, s); return; }
        diag.push(s); if (!stopB) violB += Math.max(0, v); stageAny = true;
      };
      const stage = () => { if (stageAny) stopB = true; return fail.length > 0; };
      let z0 = boneZOf(2, sub(A, mul(by, PALM_LEN)), A);
      z0 = norm(sub(z0, mul(by, dot(z0, by))));
      const bx0 = norm(M.vec.cross(by, z0));
      const bz0 = M.vec.cross(bx0, by);
      const cr = Math.cos(roll), sr = Math.sin(roll);
      const bx = add(mul(bx0, cr), mul(bz0, -sr));
      const bz = add(mul(bx0, sr), mul(bz0, cr));
      const off = (tbl, f) => add(add(mul(bx, tbl[f][0]), mul(by, tbl[f][1])), mul(bz, tbl[f][2]));
      const off2 = off(MC_ROOTS, 2);
      const w = sub(A, off2);
      const roots = {}, bases = {}, rootsArr = [];
      for (let f = 1; f <= 4; f++) {
        roots[f] = add(A, sub(off(MC_ROOTS, f), off2));
        bases[f] = add(A, sub(off(MC_BASE, f), off2));
        rootsArr.push(roots[f]);
      }
      const midRoot = roots[2];
      const palmYv = norm(sub(midRoot, w));
      const zR = boneZOf(2, w, midRoot);
      const palmXv = norm(M.vec.cross(palmYv, zR));
      const palmZv = M.vec.cross(palmXv, palmYv);
      const K = rootsArr.reduce((a, r) => add(a, mul(r, 0.25)), [0, 0, 0]);
      // Section 6 posture bands (placement properties) --
      // BAND class (STEP 1, 2026-11-10): diagnostic only
      // unless CARR.romBandGate (see romTry's header).
      if (lam < 0.05) {
        if (dot(palmZv, M.n) < 0.45) Bd((0.45 - dot(palmZv, M.n)) * 100, 'backNeck.aud ' + dot(palmZv, M.n).toFixed(3));
        if (dot(palmZv, mul(M.v, -1)) < -0.10) Bd((-0.10 - dot(palmZv, mul(M.v, -1))) * 100, 'backNeck.lat ' + dot(palmZv, mul(M.v, -1)).toFixed(3));
        const wRel = sub(w, romAxPt(w));
        if (dot(wRel, M.v) > -0.030) Bd((dot(wRel, M.v) + 0.030) * 1000, 'wristLat ' + (dot(wRel, M.v) * 1000).toFixed(1) + 'mm');
        if (dot(wRel, M.n) > 0.028) Bd((dot(wRel, M.n) - 0.028) * 1000, 'wristFb ' + (dot(wRel, M.n) * 1000).toFixed(1) + 'mm');
      }
      if (lam > 0.85) {
        if (dot(palmZv, mul(M.v, -1)) < 0.60) Bd((0.60 - dot(palmZv, mul(M.v, -1))) * 100, 'backEnd.lat ' + dot(palmZv, mul(M.v, -1)).toFixed(3));
        if (dot(palmZv, M.n) < 0.02) Bd((0.02 - dot(palmZv, M.n)) * 100, 'backEnd.aud ' + dot(palmZv, M.n).toFixed(3));
      }
      // Wrist joint centre inside the board: physical (the
      // centre sits inside the carpus mass) -- a constraint.
      if (romBoardD(w) < 0) F(-romBoardD(w) * 1000 + 2, 'wrist inside board box');
      // wristAxis 11 mm: the shipped hand's measured centre
      // clearance (section 5 says so itself: "the surface
      // claim proper is the carpus, section 8") -- BAND.
      if (romNeckD(w) - 0.027 < 0.011) Bd((0.011 - (romNeckD(w) - 0.027)) * 1000, 'wristAxis ' + ((romNeckD(w) - 0.027) * 1000).toFixed(1) + 'mm');
      if (stage()) return { fail, viol, violB };
      // Chains.
      const recs = {};
      let insideF = 0;
      const EX0 = { neck: 0, boardC: 0, boardCap: 0 };
      for (let f = 1; f <= 4; f++) {
        const root = roots[f], pz = boneZOf(f, w, root);
        if (contacts[f]) {
          // STEP 2: with CARR.romPad the contact is the pad
          // point P(s) (see PAD); the roll s is a per-finger
          // freedom tried near-to-far from the pulp centre
          // (PAD.order), first s whose chain meets every
          // per-finger constraint wins -- the same "first
          // feasible, no score" rule as the placement. The
          // pad must face the board (its outward normal has a
          // component INTO the board: dot(normal, board
          // normal) < 0) -- a pad facing away cannot press.
          const sList = CARR.romPad ? PAD.order : [null];
          let pick = null;
          for (const sF of sList) {
            const pts = sF === null ? fingerChain(root, targets[f], FINGER_LEN[f], pz, curlF)
              : fingerChainPad(root, targets[f], f, pz, curlF, sF);
            const rec = romRecord(pts, targets[f], true, w, root, pts);
            const lf = [];
            const L = (v, msg) => lf.push([v, msg]);
            if (pts.infeasible) L(25, 'f' + f + ' chain infeasible at span ' + (Math.hypot(...sub(targets[f], root)) * 1000).toFixed(1) + 'mm');
            const cpt = pts.padPt || pts[3];
            const tipErr = Math.hypot(...sub(cpt, targets[f]));
            if (tipErr > 1e-9) L(tipErr * 1000, 'f' + f + (pts.padPt ? ' pad' : ' tip') + ' err ' + (tipErr * 1000).toFixed(2) + 'mm');
            if (pts.pad) {
              const fc = dot(pts.pad.normal, M.BOARD.normal);
              if (fc >= 0) L(fc * 100 + 1, 'f' + f + ' pad faces away ' + fc.toFixed(3));
            }
            if (rec.drawnMcp > MCP_CAP) L((rec.drawnMcp - MCP_CAP) * 180 / Math.PI * 0.3, 'f' + f + ' drawnMcp ' + (rec.drawnMcp * 180 / Math.PI).toFixed(1) + 'deg');
            const cl = romChainClear(pts, FINGER_R[f], targets[f], { neck: 0.006, boardC: 0.006, boardCap: 0.012 });
            if (cl.neck < -0.0025) L((-0.0025 - cl.neck) * 1000, 'f' + f + ' neckCap ' + (cl.neck * 1000).toFixed(2) + 'mm');
            if (cl.board < -0.0115) L((-0.0115 - cl.board) * 1000, 'f' + f + ' boardCap ' + (cl.board * 1000).toFixed(2) + 'mm');
            const lv = lf.reduce((acc, x) => acc + Math.max(0, x[0]), 0) + cl.inside * 3;
            if (!pick || lv < pick.lv) pick = { pts, rec, lf, lv, cl };
            if (!lf.length && !cl.inside) break;
          }
          const rec = pick.rec;
          recs[f] = rec;
          for (const [v, msg] of pick.lf) F(v, msg);
          if (lam < 0.05 && rec.mcpAngle > 1.02) Bd((rec.mcpAngle - 1.02) * 180 / Math.PI * 0.3, 'f' + f + ' mcpNeck ' + (rec.mcpAngle * 180 / Math.PI).toFixed(1) + 'deg');
          if (lam > 0.85 && rec.mcpAngle < 0.90) Bd((0.90 - rec.mcpAngle) * 180 / Math.PI * 0.3, 'f' + f + ' mcpThumb ' + (rec.mcpAngle * 180 / Math.PI).toFixed(1) + 'deg');
          if (lam > 0.85 && rec.tipDir[2] < 0.25) Bd((0.25 - rec.tipDir[2]) * 100, 'f' + f + ' tipPlayer ' + rec.tipDir[2].toFixed(3));
          insideF += pick.cl.inside;
        } else {
          const { env, cp } = romEnvOf(f);
          const restPts = romRestChain(f, w, root, bases[f]);
          if (env <= 0) {
            recs[f] = romRestRecord(restPts, w, root, f);
            if (recs[f].drawnMcp > MCP_CAP) F((recs[f].drawnMcp - MCP_CAP) * 180 / Math.PI * 0.3, 'f' + f + ' rest drawnMcp ' + (recs[f].drawnMcp * 180 / Math.PI).toFixed(1) + 'deg');
            const cl = romChainClear(restPts, FINGER_R[f], restPts[3], EX0);
            if (cl.neck < -0.0025) F((-0.0025 - cl.neck) * 1000, 'f' + f + ' rest neckCap ' + (cl.neck * 1000).toFixed(2) + 'mm');
            if (cl.board < -0.0115) F((-0.0115 - cl.board) * 1000, 'f' + f + ' rest boardCap ' + (cl.board * 1000).toFixed(2) + 'mm');
            insideF += cl.inside;
          } else {
            const tgt = cp || targets[f];
            // STEP 2: the transition target is solved with the
            // stopping model (pad contact, first chain-feasible
            // roll) so the blend arrives at a pose of the same
            // contact definition the stopping solve uses.
            let pts = null;
            if (CARR.romPad) {
              for (const sF of PAD.order) { pts = fingerChainPad(root, tgt, f, pz, curlF, sF); if (!pts.infeasible) break; }
            } else pts = fingerChain(root, tgt, FINGER_LEN[f], pz, curlF);
            // A transition solve need only respect the joint
            // caps: while the hand is still travelling, the
            // chain's span may exceed the reach and the raw
            // build clamps it (the fingertip reaches toward
            // its point as far as the bones allow and lands
            // when the hand arrives -- the stopping branch
            // above is where exactness is enforced).
            if (pts.infeasible) {
              F(25, 'f' + f + ' transition solve infeasible at span ' + (Math.hypot(...sub(tgt, root)) * 1000).toFixed(1) + 'mm');
              recs[f] = romRestRecord(restPts, w, root, f);
            } else if (env >= 1) {
              recs[f] = romRecord(pts, pts.padPt || pts[3], false, w, root, pts);
              if (recs[f].drawnMcp > MCP_CAP) F((recs[f].drawnMcp - MCP_CAP) * 180 / Math.PI * 0.3, 'f' + f + ' trans drawnMcp ' + (recs[f].drawnMcp * 180 / Math.PI).toFixed(1) + 'deg');
              const cl = romChainClear(pts, FINGER_R[f], pts[3], EX0);
              if (cl.neck < -0.0025) F((-0.0025 - cl.neck) * 1000, 'f' + f + ' trans neckCap ' + (cl.neck * 1000).toFixed(2) + 'mm');
              if (cl.board < -0.0115) F((-0.0115 - cl.board) * 1000, 'f' + f + ' trans boardCap ' + (cl.board * 1000).toFixed(2) + 'mm');
              insideF += cl.inside;
            } else {
              const bl = romBlend(f, root, restPts, pts, env, pz);
              recs[f] = romRecord(bl.pts, bl.pts[3], false, w, root,
                { pip: bl.pip, dip: bl.dip, curlUsed: bl.dip, infeasible: false, slaved: false });
              if (recs[f].drawnMcp > MCP_CAP) F((recs[f].drawnMcp - MCP_CAP) * 180 / Math.PI * 0.3, 'f' + f + ' blend drawnMcp ' + (recs[f].drawnMcp * 180 / Math.PI).toFixed(1) + 'deg');
              const cl = romChainClear(bl.pts, FINGER_R[f], bl.pts[3], EX0);
              if (cl.neck < -0.0025) F((-0.0025 - cl.neck) * 1000, 'f' + f + ' blend neckCap ' + (cl.neck * 1000).toFixed(2) + 'mm');
              if (cl.board < -0.0115) F((-0.0115 - cl.board) * 1000, 'f' + f + ' blend boardCap ' + (cl.board * 1000).toFixed(2) + 'mm');
              insideF += cl.inside;
            }
          }
        }
      }
      // STEP 4 audit: a pad chain's axis-tip chord can cross the fold
      // normal during a transition. Scalar curl magnitudes alone then
      // miss backwards PIP/DIP flexion (Swan ~74.503 s, f3). Certify the
      // ACTUAL final chain in the same target/bone frame as geometry §9;
      // do not change the ROM table, coupling, or the rest cascade.
      for (let f = 1; f <= 4; f++) {
        const rec = recs[f], pz = boneZOf(f, w, roots[f]);
        for (const [j, key] of [[0, 'PIP'], [1, 'DIP']]) {
          const a = romBendOf(rec.points, j, pz, rec.target), cap = ROM.FINGER[key][1];
          if (a < -1e-9 || a > cap + 1e-9)
            F(Math.max(-a, a - cap) * 180 / Math.PI + 1, 'f' + f + ' actual ' + key + ' outside ROM ' + (a * 180 / Math.PI).toFixed(2) + 'deg');
        }
      }
      if (insideF > 0) F(insideF * 3, 'finger centrelines inside board: ' + insideF);
      if (stage()) return { fail, viol, violB };
      // Thumb: the Phase B solve, unchanged (principle 2 for
      // the thumb is its existing behaviour: MCP-first fold,
      // IP <= 35 deg class, pad in the contact class).
      const Hlike = { roots: rootsArr, K, palmX: palmXv, palmY: palmYv, palmZ: palmZv, pronation: VARI.palmRoll };
      const thS = thumbSolveFor(w, Hlike);
      const settledR = lam < 0.02 || lam > 0.98;
      if (settledR && thS.tipErr > 0.002) F((thS.tipErr - 0.002) * 1000, 'thumb settled tip err ' + (thS.tipErr * 1000).toFixed(2) + 'mm');
      else if (thS.tipErr > 0.017) F((thS.tipErr - 0.017) * 1000, 'thumb tip err ' + (thS.tipErr * 1000).toFixed(2) + 'mm');
      if (stage()) return { fail, viol, violB };
      const thSol = thumbChain(thS.root, restPt, dorsalRefT);
      if (lam < 0.02 && thSol.beta2 > 0.698) Bd((thSol.beta2 - 0.698) * 180 / Math.PI * 0.3, 'thumb IP ' + (thSol.beta2 * 180 / Math.PI).toFixed(1) + 'deg');
      const thumbPts = romThumbClear(thSol.points, thS.root);
      const exT = lam > 0.5 ? { neck: 0.025, boardC: 0.025, boardCap: 0.025 } : { neck: 0, boardC: 0.006, boardCap: 0.012 };
      const clT = romChainClear(thumbPts, THUMB_R, thumbPts[3], exT);
      if (clT.neck < -0.0075) F((-0.0075 - clT.neck) * 1000, 'thumb neckCap ' + (clT.neck * 1000).toFixed(2) + 'mm');
      if (clT.board < -0.0165) F((-0.0165 - clT.board) * 1000, 'thumb boardCap ' + (clT.board * 1000).toFixed(2) + 'mm');
      if (clT.inside > 2) F((clT.inside - 2) * 3, 'thumb centrelines inside board: ' + clT.inside);
      if (stage()) return { fail, viol, violB };
      // Elbow: ROM-certified or the placement is wrong.
      const el = romElbow(w, rootsArr, palmYv);
      if (el.fallback > 2 || el.viol !== 0) { F(el.fallback * 15 + el.viol * 50 + 5, 'elbow fallback ' + el.fallback + ' viol ' + el.viol.toFixed(3)); return { fail, viol, violB }; }
      // Palm masses and their surface gates (section 8b).
      const ms = romMasses(w, palmXv, palmYv, palmZv);
      const plateN = romSurfMin(ms.palm, romNeckSurfaceD);
      const plateB = romSurfMin(ms.palm, q => romBoardD(q));
      const carpN = romSurfMin(ms.carpus, romNeckSurfaceD);
      const carpB = romSurfMin(ms.carpus, q => romBoardD(q));
      if (plateN < -0.008) F((-0.008 - plateN) * 1000, 'plate neck ' + (plateN * 1000).toFixed(2) + 'mm');
      if (plateB < -0.004) F((-0.004 - plateB) * 1000, 'plate board ' + (plateB * 1000).toFixed(2) + 'mm');
      if (carpN < 0) F(-carpN * 1000, 'carpus neck ' + (carpN * 1000).toFixed(2) + 'mm');
      if (carpB < -0.002) F((-0.002 - carpB) * 1000, 'carpus board ' + (carpB * 1000).toFixed(2) + 'mm');
      if (lam < 0.05 && dot(sub(ms.palm.centre, romAxPt(ms.palm.centre)), M.v) > -0.012)
        Bd((dot(sub(ms.palm.centre, romAxPt(ms.palm.centre)), M.v) + 0.012) * 1000, 'palmLat ' + (dot(sub(ms.palm.centre, romAxPt(ms.palm.centre)), M.v) * 1000).toFixed(1) + 'mm');
      if (stage()) return { fail, viol, violB };
      const xSt = rootsArr.map(r => dot(sub(r, midRoot), palmXv));
      const H = {
        roots: rootsArr, K, midRoot, palmX: palmXv, palmY: palmYv, palmZ: palmZv, palmLen: PALM_LEN,
        palm: ms.palm, pad: ms.pad, hypothenar: ms.hypothenar, carpus: ms.carpus,
        xHalf: (Math.max(...xSt, 0) - Math.min(...xSt, 0)) / 2,
        elbow: el.elbow, elbowFallback: el.fallback, elbowFlex: el.flex, elbowDev: el.dev,
        elbowCone: el.cone, elbowViol: el.viol,
        mcpWorst: Math.max(...[1, 2, 3, 4].map(f => recs[f].drawnMcp)), pronation: VARI.palmRoll
      };
      return { fail: null, H, recs, wrist: w, diag, viol: 0, violB };
    };
    // Candidate placements, in near-to-far order from the
    // seed: the seed anchors the middle root at the snapshot
    // row's own middle root (the prologue's target-anchored
    // placement) with the palm axis along the shipped seed
    // wrist -> root direction. Candidates shift the anchor
    // along the neck axis / across (v) / front-back (n),
    // pitch or yaw the palm axis about the seed frame's axes,
    // and roll the rigid frame about the palm axis. The first
    // feasible one wins (continuity with the natural
    // approach, not a fold-shaped score).
    const ROM_CANDS = [
      // [dAnchor(neck), dV, dN, pitch, yaw, roll]
      [0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0.10], [0, 0, 0, 0, 0, -0.10],
      [0, 0, 0, 0.12, 0, 0], [0, 0, 0, -0.12, 0, 0],
      [0, 0, 0, 0, 0.12, 0], [0, 0, 0, 0, -0.12, 0],
      [0.012, 0, 0, 0, 0, 0], [-0.012, 0, 0, 0, 0, 0],
      [0, 0.012, 0, 0, 0, 0], [0, -0.012, 0, 0, 0, 0],
      [0, 0, 0.012, 0, 0, 0], [0, 0, -0.012, 0, 0, 0],
      [0, 0, 0, 0, 0, 0.20], [0, 0, 0, 0, 0, -0.20],
      [0, 0, 0, 0.24, 0, 0], [0, 0, 0, -0.24, 0, 0],
      [0, 0, 0, 0, 0.24, 0], [0, 0, 0, 0, -0.24, 0],
      [0.024, 0, 0, 0, 0, 0], [-0.024, 0, 0, 0, 0, 0],
      [0, 0.024, 0, 0, 0, 0], [0, -0.024, 0, 0, 0, 0],
      [0, 0, 0.024, 0, 0, 0], [0, 0, -0.024, 0, 0, 0],
      [0, 0, 0, 0, 0, 0.30], [0, 0, 0, 0, 0, -0.30],
      [0, 0, 0.012, 0.12, 0, 0.10], [0, 0, -0.012, -0.12, 0, -0.10],
      [0.012, 0, 0, 0, 0.12, 0], [-0.012, 0, 0, 0, -0.12, 0]
    ];
    const romAssemble = () => {
      const rotAx = (v, ax, ang) => {
        const c = Math.cos(ang), s = Math.sin(ang);
        return norm(add(add(mul(v, c), mul(M.vec.cross(ax, v), s)), mul(ax, dot(ax, v) * (1 - c))));
      };
      // Two starts: the snapshot row's middle root (the
      // placement the provisional guard settled) and the
      // prologue's untravelled rootOf row middle root (the
      // natural approach before any guard travel). Each
      // start's palm axis runs from its own placeWrist seed
      // wrist to its anchor.
      const mkStart = (A0, rowDirW) => {
        const wSeed = placeWrist(A0, (PLACE.wristBack !== null ? PLACE.wristBack : VARI.wristBack), 0, 0, 0, 0, 0, rowDirW);
        const by0 = norm(sub(A0, wSeed));
        let zS = boneZOf(2, wSeed, A0);
        zS = norm(sub(zS, mul(by0, dot(zS, by0))));
        const bxS = norm(M.vec.cross(by0, zS));
        const bzS = M.vec.cross(bxS, by0);
        return { A0, by0, bxS, bzS };
      };
      const starts = [mkStart([...knuckles[2]], norm(sub(knuckles[4], knuckles[1])))];
      {
        const rOf = { 1: rootOf(1), 2: rootOf(2), 3: rootOf(3), 4: rootOf(4) };
        starts.push(mkStart(rOf[2], norm(sub(rOf[4], rOf[1]))));
      }
      let seedFail = null, bestFail = null, bestFailViol = Infinity, tried = 0;
      // TWO PASSES (STEP 1): pass 1 runs each start's fixed
      // list and then a bounded descent downhill on violB --
      // the pre-STEP-1 staged violation (bands included), i.e.
      // the old search trajectory; pass 2 (only if pass 1
      // found nothing) runs the same descent per start from
      // that start's lowest CONSTRAINT-violation list
      // candidate, downhill on viol. Both are search
      // heuristics; ACCEPTANCE in both is constraint
      // feasibility (romTry's fail list) and nothing else.
      // Measured reason (2026-11-10): with the bands removed
      // from the descent's gradient, a single constraint-only
      // descent lost 164 frames the old band-guided descent
      // had won (it stalls in tip-error minima of 0.15-0.3
      // mm) while winning 37 new ones; replaying the old
      // trajectory first makes the solved set a superset of
      // the pre-STEP-1 one by construction (the old
      // trajectory's acceptance points are all constraint-
      // feasible), and pass 2 adds the new ones.
      const mkTryP = st => p => {
        const A = add(add(add(st.A0, mul(neckAxisDir, p[0])), mul(M.v, p[1])), mul(M.n, p[2]));
        let by = st.by0;
        if (p[3]) by = rotAx(by, st.bxS, p[3]);
        if (p[4]) by = rotAx(by, st.bzS, p[4]);
        const r = romTry(A, by, p[5]);
        tried++;
        if (r.fail && r.viol < bestFailViol - 1e-12) { bestFailViol = r.viol; bestFail = r.fail; }
        return r;
      };
      const winOf = (r, how, cand, si) => {
        for (let f = 1; f <= 4; f++) fingers[f] = r.recs[f];
        return { wrist: r.wrist, rollAdj: 0, relax: 0, H: r.H, score: 0, diag: r.diag, how, cand, start: si, tried, thumb: r.thumb };
      };
      // Bounded descent (singles, then rotation/anchor
      // diagonals) from p0 on the violation key ('violB' or
      // 'viol'); returns the winning state or null.
      const descend = (tryP, p0, v0, key) => {
        let cur = p0.slice(), curViol = v0;
        let sA = 0.008, sR = 0.06, budget = 64;
        const DIAG = [[3, 4], [3, 5], [4, 5], [1, 4], [2, 4], [0, 3]];
        while (budget > 0 && sA >= 0.001) {
          let improved = false, won = null;
          const step = (delta) => {
            if (budget-- <= 0) return false;
            const p = cur.slice();
            for (const [k, d] of delta) p[k] += d;
            const r = tryP(p);
            if (!r.fail) { won = r; return true; }
            if (r[key] < curViol - 1e-6) { cur = p; curViol = r[key]; improved = true; }
            return false;
          };
          for (let k = 0; k < 6 && budget > 0 && !won; k++)
            for (const sgn of [1, -1]) { if (step([[k, sgn * (k < 3 ? sA : sR)]])) break; }
          if (!won && !improved)
            for (const [a, b] of DIAG) {
              for (const sa of [1, -1]) for (const sb of [1, -1]) {
                if (step([[a, sa * (a < 3 ? sA : sR)], [b, sb * (b < 3 ? sA : sR)]])) break;
                if (won || budget <= 0) break;
              }
              if (won || budget <= 0) break;
            }
          if (won) return won;
          if (!improved) { sA /= 2; sR /= 2; }
        }
        return null;
      };
      const bestC = [];
      for (let si = 0; si < starts.length; si++) {
        const tryP = mkTryP(starts[si]);
        let bestB = Infinity, bestPB = null, bestCv = Infinity, bestPC = null;
        for (let ci = 0; ci < ROM_CANDS.length; ci++) {
          const p = ROM_CANDS[ci];
          const r = tryP(p);
          if (!r.fail) return winOf(r, 'cand', ci, si);
          if (!seedFail) seedFail = r.fail;
          if (r.violB < bestB - 1e-9) { bestB = r.violB; bestPB = p; }
          if (r.viol < bestCv - 1e-9) { bestCv = r.viol; bestPC = p; }
        }
        bestC.push({ p: bestPC, v: bestCv });
        if (bestPB) {
          const r = descend(tryP, bestPB, bestB, 'violB');
          if (r) return winOf(r, 'descentB', -1, si);
        }
      }
      for (let si = 0; si < starts.length; si++) {
        if (!bestC[si].p) continue;
        const r = descend(mkTryP(starts[si]), bestC[si].p, bestC[si].v, 'viol');
        if (r) return winOf(r, 'descentC', -1, si);
      }
      if (ROM_LOG.length < 4096) ROM_LOG.push({
        song: song.id, t: +t.toFixed(3), lam: +lam.toFixed(3), tried,
        stopping: [1, 2, 3, 4].filter(f => contacts[f]), seedFail, bestFail
      });
      return null;
    };
    let romWin = null;
    if (CARR.mode === 'bone' && CARR.romSolve) romWin = romAssemble();

    // WRIST TRIALS (phase 2): the wrist placement is searched,
    // not just relaxed along one axis. Inner ladder = the pinch-
    // depth relaxation (wristBack +0..24 mm, the round-2 MCP
    // lever); outer offsets move the placement's station along
    // the neck and its side offset as well. A trial wins when
    // the elbow search is feasible (fallback < 3: wedge, cone
    // and side all satisfied) AND the drawn-MCP guard is inside
    // its cap; otherwise the best-scoring assembly is kept and
    // its residual violation stays on the pose for the sweep.
    const OFFSETS = [
      // [wristBack, station, side, alongAxis, lateral, rollAdj, row]
      // (roughly ascending invasiveness; the loops stop at the
      // first fully feasible assembly)
      [0, 0, 0, 0, 0, 0, 0], [0, 0, 0, -0.006, 0, 0, 0], [0, 0, 0, 0.006, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0.008], [0, 0, 0, 0, 0, 0, -0.008], [0, 0, 0, 0, 0, 0, 0.016],
      [0, 0, 0, 0, 0, 0, -0.016], [0, 0, 0, 0, 0.008, 0, 0], [0, 0, 0, 0, -0.008, 0, 0],
      [0, 0, 0, 0, 0.014, 0, 0], [0, 0, 0, 0, -0.014, 0, 0], [0, 0, 0, 0, 0.020, 0, 0],
      [0, 0, 0, 0, -0.020, 0, 0], [0, 0, 0, 0, 0, 0.08, 0], [0, 0, 0, 0, 0, 0.16, 0],
      [0, 0, 0, 0, 0, 0.24, 0], [0.012, 0, 0, 0, 0, 0, 0], [0, 0, 0, -0.011, 0, 0, 0],
      [0, 0, 0, 0, 0, -0.08, 0], [0, 0, 0, 0, 0.008, 0.08, 0], [0, 0, 0, 0, 0.014, 0.16, 0],
      [0, 0, 0, 0, -0.014, 0.16, 0], [0, 0, 0, 0, 0.020, 0.24, 0], [0, 0, 0, 0, -0.020, 0.24, 0],
      [0.024, 0, 0, 0, 0, 0, 0], [0, -0.012, 0, 0, 0, 0, 0],
      [0, 0.012, 0, 0, 0, 0, 0], [0, 0, -0.010, 0, 0, 0, 0], [0, 0, 0, -0.006, 0.008, 0.08, 0],
      [0.012, -0.012, 0, -0.006, 0, 0, 0], [0.024, -0.012, -0.010, 0.006, 0, 0, 0],
      [-0.012, 0.012, 0.006, -0.006, 0, 0, 0]
    ];
    let bestTry = null;
    const seenTrial = new Set();
    const feasible = H => H.elbowFallback < 3 && H.mcpWorst <= MCP_CAP;
    const settled = lam < 0.02 || lam > 0.98;
    // OWN-FRAME MCP SPLIT of the trial just attempted (bone
    // mode): rk's joint-direction rule read in each finger's
    // own metacarpal frame -- segment 1's flexion toward the
    // palm side of the finger's OWN flexion plane must lie in
    // [0, 90] deg and its lateral deviation within 30 deg
    // (PIP/DIP lateral are 0 by construction in this
    // skeleton). Returns the summed excess over the four
    // fingers, in radians: the quantity the trial score
    // charges and the clean-trial gate below uses. Read from
    // the trial's own chains (pose-scope `fingers`, which
    // attempt() leaves holding the attempted assembly).
    const ownSplitOf = wT => {
      let excess = 0;
      for (let f = 1; f <= 4; f++) {
        const F = fingers[f];
        if (!F) continue;
        const mDir = norm(sub(F.points[0], wT));
        const pz = boneZOf(f, wT, F.points[0]);
        // Palm-fold: the split is measured against the
        // measured flexion side (+boneZ in pose space; see
        // palmDecomp) -- with the historical -boneZ reference
        // every palm chain's flexion (~+90 deg of true
        // flexion) would book as ~1.5 rad of flex excess per
        // finger and no trial could ever read clean. The
        // lateral component is unchanged in magnitude (the
        // axis flips sign with the reference).
        let fv = mul(sub(pz, mul(mDir, dot(pz, mDir))), CARR.palmFold ? 1 : -1);
        if (Math.hypot(...fv) < 1e-9) continue;
        fv = norm(fv);
        const lv = M.vec.cross(mDir, fv);
        const s1 = norm(sub(F.points[1], F.points[0]));
        const flex = Math.atan2(dot(s1, fv), dot(s1, mDir));
        const lat = Math.asin(clamp(dot(s1, lv), -1, 1));
        excess += Math.max(0, Math.abs(lat) - 0.524) + Math.max(0, -flex) + Math.max(0, flex - 1.5708);
      }
      return excess;
    };
    // A CLEAN trial (bone finalization): feasible, its
    // own-frame split inside tolerance, and -- in settled
    // frames -- a thumb tip the chain can reach (<= 2 mm,
    // the section-9 settled bound). In the dev modes both
    // extra terms are identically zero and this reduces to
    // feasible().
    // WINNER TIERS (the fix round's lesson): the trial score
    // is NOT lexicographic -- its soft terms (split, thumb,
    // palm) can outweigh a fallback level. The original
    // search never compared scores across the feasibility
    // line (the grid simply broke at the first feasible
    // trial); a score-ordered fallback once the clean gate
    // replaced that break returned fallback-3 assemblies
    // with 115 deg drawn MCPs in 49 frames. So the winner is
    // chosen by TIER first and score only within a tier:
    //   rank 4 clean    feasible + chains feasible + thumb
    //                   reached + split inside tolerance
    //   rank 3 thumb-ok feasible + chains feasible + thumb
    //                   reached (split out of tolerance)
    //   rank 2 settled  feasible + chains feasible (settled
    //                   thumb out of reach)
    //   rank 1 feasible (a chain clamped at its span -- the
    //                   elbow gates pass but a finger does
    //                   not truly reach its target)
    //   rank 0 any      (nothing feasible was found)
    // An infeasible trial can therefore never beat a
    // feasible one, however clean its split reads; a
    // chain-infeasible trial never beats a chain-feasible
    // one either (section 9 asserts chain feasibility per
    // frame, and feasible() alone does not see it).
    const SPLIT_TOL = 0.35;
    const okTry = rec => rankOf(rec) >= 4;
    const rankOf = rec => {
      if (!feasible(rec.H)) return 0;
      if (rec.infeasN > 0) return 1;
      if (settled && rec.thumbErr > 0.002) return 2;
      if (rec.splitPen > SPLIT_TOL) return 3;
      return 4;
    };
    let bestFeas = null, bestThumb = null, bestClean = null;
    // Global attempt budget per pose: a safety net only --
    // set above the search's structural maximum (grid 124 +
    // descent 30 + polish ~33 + the alignW pass, deduped),
    // so it never binds in practice; the tiers make even a
    // capped search return the best trial of the highest
    // tier it reached.
    let trialBudget = 260;
    let attemptsMade = 0;
    // One scored assembly attempt at a placement offset tuple.
    // Offsets whose levers are weighted out at this lam (neck-
    // frame offsets at lam = 1, seed offsets at lam = 0, the MCP
    // ladder's fbOff at lam = 1) reproduce an earlier trial
    // exactly -- deduped for free on the effective (wrist, roll).
    const runTrial = (off, extra) => {
      const [wbOff, stOff, sdOff, axOff, latOff, rollOff, rowOff] = off;
      restoreK(snap0); restoreT(snapT0);
      rollAdj = rollOff;
      const rowDirW = norm(sub(knuckles[4], knuckles[1]));
      const wTry = placeWrist(knuckles[2], (PLACE.wristBack !== null ? PLACE.wristBack : VARI.wristBack) + wbOff + extra, stOff, sdOff, axOff, latOff, rowOff, rowDirW);
      const trialKey = rollOff + '|' + wTry.map(x => x.toFixed(6)).join(',');
      if (seenTrial.has(trialKey)) return null;
      seenTrial.add(trialKey);
      if (trialBudget-- <= 0) return null;
      attemptsMade++;
      const H = attempt(wTry);
      // Chains that clamped at their span in this assembly
      // (the trial's chains are the pose-scope `fingers` the
      // attempt just built): counted for the tier rank and
      // charged in the score -- feasible() does not see them.
      let infeasN = 0;
      for (let f = 1; f <= 4; f++) if (fingers[f] && fingers[f].chainInfeasible) infeasN++;
      // BONE-FINALIZATION SCORE TERMS (default mode only;
      // the dev modes keep their historical scores):
      // - thumbPen: the thumb's PREDICTED tip error from
      //   this assembly (thumbSolveFor -- the same solve the
      //   final assembly runs). Settled frames carry the
      //   hard weight (section 9 pins settled error at
      //   <= 2 mm); mid-shift, where the tip is passing the
      //   neck and the bound is the looser global one, the
      //   weight is small and only past 6 mm.
      // - splitPen: the own-frame MCP split excess
      //   (ownSplitOf) -- the wrist placement is the only
      //   lever that turns the metacarpals against the fold
      //   planes, so the search has to see the split.
      // - palmPen: the FINAL palm length (middle root after
      //   finishHand's passes) held at the section-8 floor
      //   with margin -- the guard levers floor their own
      //   travel (PALM_FLOOR), this steers the wrist when
      //   the collapse enters through the placement itself.
      let thumbErr = 0, splitPen = 0, palmPen = 0, palmLen = null, wristRootPen = 0;
      // PHASE B FOLD TERM (2026-11-08): the colour-bone audit
      // measured contact fold totals (drawn MCP + PIP + DIP)
      // centred at 150-208 deg against a real stopping fold
      // of ~90-140 deg, with the middle finger at the drawn-
      // MCP cap in 42% of contact frames -- yet nothing in
      // the search scored fold: the grid takes the first
      // feasible wrist and the polish triggers did not
      // include fold. foldPen charges the excess over a soft
      // ceiling (contact 150 deg, hover 170 deg) so feasible
      // trials are ranked by fold too, and foldWorst feeds
      // the polish trigger below. Soft term only: tiers and
      // hard gates are unchanged.
      let foldPen = 0, foldWorst = 0;
      if (CARR.mode === 'bone') {
        thumbErr = thumbSolveFor(wTry, H).tipErr;
        splitPen = ownSplitOf(wTry);
        palmLen = Math.hypot(...sub(H.roots[1], wTry));
        palmPen = Math.max(0, 0.064 - palmLen) * 800;
        // PHASE B: wrist-inside-the-row guard. A trial wrist
        // can land within millimetres of a snapshot root
        // (the Prelude t=8.82 winner sat 24.9 mm from the
        // index root the provisional placement had put 70+
        // mm from its own wrist); from there the guard's
        // only cap-satisfying walks park the root ON the
        // wrist (section 8's fan floor measured 2.9 mm).
        // Charge any wrist closer than 45 mm to a snapshot
        // root so sane wrists win the tier.
        for (let f = 1; f <= 4; f++) {
          const d = Math.hypot(...sub(wTry, snap0[f]));
          if (d < 0.045) wristRootPen += (0.045 - d) * 2000;
        }
        for (let f = 1; f <= 4; f++) {
          const F = fingers[f];
          if (!F) continue;
          const tot = F.drawnMcp + F.pip + F.dip;
          const ex = F.contact ? Math.max(0, tot - PLACE.foldCeilC) : Math.max(0, tot - PLACE.foldCeilH);
          // Weights calibrated against splitPen x8 (a few
          // points per finger): the first calibration (x400)
          // let fold improvements buy large own-frame
          // lateral regressions in thumb position (index
          // contact lat median 27 -> 49 deg measured). x40 /
          // x15 keeps fold the loudest soft term without
          // drowning the split. PLACE.foldW scales the whole
          // fold charge (placement-family variants only; V0
          // ships foldW = 1, the calibrated values).
          foldPen += PLACE.foldW * (F.contact ? 40 : 15) * ex * ex;
          if (F.contact) foldWorst = Math.max(foldWorst, tot);
          // Thumb-position hairpin: a contact chain whose
          // PIP sits past ~65 deg while the base joint
          // contributes almost nothing is the audit's
          // hairpin class; charge the PIP excess directly.
          if (F.contact && lam > 0.75) foldPen += PLACE.hairpinW * Math.max(0, F.pip - 1.13) ** 2;
          // Section-6 guard (Phase B): in thumb position a
          // straighter chain's distal segment rotates to lie
          // along the board pointing AWAY from the player --
          // the fold term alone steered Swan winners there
          // (min tip-player component -0.37 against the
          // section-6 bound +0.25, measured). Score the
          // bound the way thumbPen scores section 9's: past
          // a margin inside the bound, charge hard.
          if (F.contact && lam > 0.85) foldPen += 300 * Math.max(0, 0.32 - F.tipDir[2]);
        }
      }
      const thumbPen = settled
        ? Math.max(0, thumbErr - 0.002) * 1500
        : Math.max(0, thumbErr - 0.006) * 60;
      // R2 alignment term: penalise the angle between the
      // palm's metacarpal axis and the primary finger's palm
      // fold plane (span(chord, palmZ)) -- the quantity the
      // MCP flexion/lateral split answers to. Only a score
      // term: the hard gates (elbow wedge/cone, drawn-MCP
      // cap) are unchanged.
      let alignPen = 0;
      if (CARR.alignW) {
        const fnP = M.vec.cross(sub(targets[prim], H.roots[prim - 1]), H.palmZ);
        if (Math.hypot(...fnP) > 1e-9)
          alignPen = CARR.alignW * Math.asin(Math.min(1, Math.abs(dot(H.palmY, norm(fnP)))));
      }
      const score = (H.elbowFallback >= 3 ? 100 + H.elbowViol * 57.3 : H.elbowFallback * 0.01) +
        (H.mcpWorst > MCP_CAP ? (H.mcpWorst - MCP_CAP) * 600 : 0) + alignPen +
        thumbPen + splitPen * 8 + palmPen + infeasN * 40 + foldPen + wristRootPen +
        (Math.abs(wbOff) + Math.abs(stOff) + Math.abs(sdOff) + Math.abs(axOff) + Math.abs(latOff) + Math.abs(rowOff) + Math.abs(rollOff) * 0.05 + extra) * 2;
      const rec = { score, wrist: wTry, relax: wbOff + extra, rollAdj: rollOff, off, extra, H, thumbErr, splitPen, palmLen, infeasN, foldPen, foldWorst };
      if (!bestTry || score < bestTry.score) bestTry = rec;
      const rkT = rankOf(rec);
      if (rkT >= 1 && (!bestFeas || score < bestFeas.score)) bestFeas = rec;
      if (rkT >= 3 && (!bestThumb || score < bestThumb.score)) bestThumb = rec;
      if (rkT >= 4 && (!bestClean || score < bestClean.score)) bestClean = rec;
      return rec;
    };
    // With an alignment term (R2) the first feasible trial is
    // not necessarily the best-aligned one: run one pass over
    // every offset at extra = 0 first, and skip the ladder
    // entirely if that pass already found a feasible assembly.
    if (CARR.alignW && !romWin) for (const off of OFFSETS) runTrial(off, 0);
    if (!romWin && !(CARR.alignW && bestTry && feasible(bestTry.H))) {
      grid: for (const off of OFFSETS) {
        for (const extra of [0, 0.008, 0.016, 0.024]) {
          const rec = runTrial(off, extra);
          // Palm-fold: feasible alone no longer ends the
          // grid -- with the fold constructed honestly, a
          // feasible-but-deep-folded first trial is common,
          // and the placements with centred folds sit
          // further down the offset list (the shipped
          // build's grid only stopped this early because
          // its split artefact kept early trials unclean,
          // so the whole grid ran and the polish compared).
          // Break at the first trial that is feasible AND
          // clean AND inside the fold ceiling; the trial
          // budget still bounds the full pass.
          if (rec && feasible(rec.H) &&
              (!CARR.palmFold || (okTry(rec) && rec.foldWorst <= PLACE.polishFold))) break grid;
        }
      }
    }
    // COORDINATE DESCENT (phase 2): if the grid found no fully
    // feasible assembly, walk the placement levers that rotate
    // the palm frame against the forearm (lateral offset,
    // pronation adjustment, along-axis shift) downhill on the
    // trial score from the grid's best point. This is what
    // closes the thumb-position deviation gap: at the worst
    // Swan frames the whole hinge circle sits ~10 deg of radial
    // deviation past the cap, and only turning the palm axis
    // itself (a placement property, not a ROM change) reaches
    // a legal elbow. Bounded and deterministic; the caps keep
    // the wrist a wrist (<= 30 mm lateral, pronation adjustment
    // inside ROM.FOREARM with margin).
    if (!bestFeas && bestTry) {
      let cur = bestTry;
      // step sizes by offset index: row 6, lat 4, roll 5, ax 3,
      // wristBack 0 (added in the bone finalization: the Swan
      // thumb-position frames at t~60-64 sit ~5 deg of wrist
      // deviation past the radial cap at every grid point, and
      // the frontier there also runs along the wrist's radial
      // station, which only the wristBack lever moves)
      const stepOf = { 6: 0.005, 4: 0.006, 5: 0.06, 3: 0.004, 0: 0.006 };
      const inCaps = off => Math.abs(off[6]) <= 0.024 && Math.abs(off[4]) <= 0.036 && off[5] <= 0.44 && off[5] >= -0.10 && Math.abs(off[3]) <= 0.012 && off[0] <= 0.036 && off[0] >= -0.024;
      let budget = 60;
      while (budget > 0 && !feasible(cur.H)) {
        let improved = false;
        const tryStep = delta => {
          if (budget-- <= 0) return;
          const off = cur.off.map((v, i) => v + (delta[i] || 0));
          if (!inCaps(off)) return;
          const rec = runTrial(off, cur.extra);
          if (!rec) return;
          // VIOLATION-LEXICOGRAPHIC acceptance (bone
          // finalization): the hunt's job while nothing is
          // feasible is to close the violation, not to trade
          // it against the soft score terms -- in the settled
          // Swan thumb-position frames the thumb term alone
          // outweighed ~2 deg of wrist deviation and parked
          // the walk at viol 0.079 with a 0.041 point already
          // visited. Feasibility first, then the violation
          // measure (elbow violation + drawn-MCP excess),
          // then the score.
          const violKey = r => r.H.elbowViol + Math.max(0, r.H.mcpWorst - MCP_CAP);
          const better = feasible(rec.H) !== feasible(cur.H) ? feasible(rec.H)
            : !feasible(rec.H)
              ? (violKey(rec) < violKey(cur) - 1e-4 ||
                  (violKey(rec) <= violKey(cur) + 1e-4 && rec.score < cur.score - 1e-9))
              : rec.score < cur.score - 1e-9;
          if (better) { cur = rec; improved = true; }
        };
        for (const idx of [6, 4, 5, 3, 0]) {
          for (const sgn of [1, -1]) {
            const delta = [0, 0, 0, 0, 0, 0, 0];
            delta[idx] = sgn * stepOf[idx];
            tryStep(delta);
            if (okTry(cur) || budget <= 0) break;
          }
          if (okTry(cur) || budget <= 0) break;
        }
        // Diagonal moves (row swing + pronation together) when
        // single-coordinate steps stall: the deviation frontier
        // in deep thumb position runs diagonally in (row, roll).
        if (!improved && !okTry(cur)) {
          for (const sl of [1, -1]) for (const sr of [1, -1]) {
            const delta = [0, 0, 0, 0, 0, 0, 0];
            delta[6] = sl * stepOf[6]; delta[5] = sr * stepOf[5];
            tryStep(delta);
            if (okTry(cur) || budget <= 0) break;
          }
        }
        if (!improved) {
          for (const k of Object.keys(stepOf)) stepOf[k] /= 2;
          if (stepOf[6] < 0.0012) break;
        }
      }
    }
    // POLISH (bone finalization): the searches above stop
    // at the first feasible assembly, exactly as the shipped
    // build did -- but a feasible assembly can still carry
    // the debits (a chain clamped at its span, a settled
    // thumb the chain cannot reach from that wrist, a palm
    // under its floor). When the best feasible trial is
    // dirty in any of those, a bounded second sweep --
    // offsets not yet seen, the wristBack ladder, then a
    // short tier-guarded descent -- looks for a feasible
    // trial that is cleaner. The winner below is chosen by
    // tier, so the polish can only ever improve the
    // assembly, never trade a hard gate for a softer term.
    // (The own-frame split is scored and tier-gated but
    // does not by itself trigger the sweep: it is out of
    // tolerance in most frames for structural reasons the
    // offsets cannot move, and an always-on sweep measured
    // ~85 ms/frame while trading away thumb and palm
    // quality. A bounded split-triggered variant was also
    // measured and rejected on the same trade.)
    const polishDirty = r => r && (r.infeasN > 0 || (settled && r.thumbErr > 0.002) || (r.palmLen != null && r.palmLen < 0.064) || (r.foldWorst != null && r.foldWorst > PLACE.polishFold));
    // Palm-fold: a rank-4 ("clean") trial can still carry a
    // 200+ deg fold -- the tier gate predates the fold term,
    // and with the split measured honestly (palmDecomp's
    // flexion side) clean trials are common, so the polish
    // must not disengage the moment one exists: a clean but
    // folded winner is dirty too, and the sweep/descent
    // below keep looking for a clean trial that is also
    // unfolded (acceptance stays tier-then-score, so this
    // can only improve the winner). In the historical build
    // bestClean was rare (the split's sign artefact kept
    // trials at rank <= 3), so the gated form below reduces
    // to the shipped behaviour when palmFold is off.
    const cleanFolded = () => CARR.palmFold && bestClean && bestClean.foldWorst > PLACE.polishFold;
    if (CARR.mode === 'bone' && bestFeas && (polishDirty(bestThumb || bestFeas) || cleanFolded())) {
      const att0 = attemptsMade;
      for (const off of OFFSETS) {
        if (attemptsMade - att0 >= 16 || (bestClean && !cleanFolded())) break;
        const rec = runTrial(off, 0);
        if (rec && okTry(rec) && (!CARR.palmFold || rec.foldWorst <= PLACE.polishFold)) break;
      }
      // The settled thumb's reach and the palm's length are
      // both wristBack facts (the root rides the wrist): the
      // grid's ladder reaches +24 mm of extra wristBack,
      // which the extra = 0 sweep above never sees. When
      // either term is the dirty one, climb the ladder on
      // the plain and wristBack offsets.
      if ((!bestClean || cleanFolded()) && ((settled && (bestThumb || bestFeas).thumbErr > 0.002) ||
          ((bestThumb || bestFeas).palmLen != null && (bestThumb || bestFeas).palmLen < 0.064) ||
          cleanFolded())) {
        ladder: for (const off of [OFFSETS[0], OFFSETS[16], OFFSETS[24]]) {
          for (const extra of [0.008, 0.016, 0.024]) {
            if (attemptsMade - att0 >= 24) break ladder;
            const rec = runTrial(off, extra);
            if (rec && okTry(rec) && (!CARR.palmFold || rec.foldWorst <= PLACE.polishFold)) break ladder;
          }
        }
      }
      let curP = bestClean || bestThumb || bestFeas;
      if ((!bestClean || cleanFolded()) && curP) {
        const stepOfP = { 6: 0.005, 4: 0.006, 5: 0.06, 3: 0.004 };
        const inCapsP = off => Math.abs(off[6]) <= 0.024 && Math.abs(off[4]) <= 0.036 && off[5] <= 0.44 && off[5] >= -0.10 && Math.abs(off[3]) <= 0.012;
        let dBudget = 8;
        // Palm-fold: "done" also requires the fold ceiling --
        // a clean-but-folded curP keeps descending on score
        // (the acceptance below is tier-then-score, and the
        // score carries foldPen).
        const doneP = r => okTry(r) && (!CARR.palmFold || r.foldWorst <= PLACE.polishFold);
        while (dBudget > 0 && !doneP(curP)) {
          let improved = false;
          const tryStepP = delta => {
            if (dBudget-- <= 0) return;
            const off = curP.off.map((v, i) => v + (delta[i] || 0));
            if (!inCapsP(off)) return;
            const rec = runTrial(off, curP.extra);
            if (rec && feasible(rec.H) && (rankOf(rec) > rankOf(curP) || (rankOf(rec) === rankOf(curP) && rec.score < curP.score - 1e-9))) { curP = rec; improved = true; }
          };
          for (const idx of [6, 4, 5, 3]) {
            for (const sgn of [1, -1]) {
              const delta = [0, 0, 0, 0, 0, 0, 0];
              delta[idx] = sgn * stepOfP[idx];
              tryStepP(delta);
              if (doneP(curP) || dBudget <= 0) break;
            }
            if (doneP(curP) || dBudget <= 0) break;
          }
          if (!improved) break;
        }
      }
    }
    // R2 final re-alignment: the trials settled the wrist
    // some distance from the provisional placement the roots
    // were aligned against. Re-align the snapshot roots once
    // (same fraction) against the WINNING wrist and its drawn
    // palm frame, so the regenerated assembly starts with its
    // chords closer to the final fingers' flexion planes.
    if (CARR.mode !== 'current' && CARR.rootAlign && bestTry) {
      restoreK(snap0); restoreT(snapT0);
      alignRoots(bestTry.wrist, bestTry.H.palmZ, CARR.rootAlign);
      const s2 = snapK();
      for (let f = 1; f <= 4; f++) snap0[f] = s2[f];
    }
    // Regenerate the winning assembly deterministically from the
    // snapshot state (finishHand's mutations are not idempotent,
    // so the end state cannot simply be restored). The winner
    // is the best trial of the highest reached TIER (clean,
    // then thumb-ok, then feasible, then any) -- see rankOf.
    restoreK(snap0); restoreT(snapT0);
    const winTry = romWin || bestClean || bestThumb || bestFeas || bestTry;
    rollAdj = winTry.rollAdj;
    const wrist = winTry.wrist;
    const wristBackRelax = winTry.relax;
    const H = romWin ? romWin.H : attempt(wrist);
    const { roots, K, palmX, palmY, palmZ, palm, pad, hypothenar, carpus } = H;
    const elbowL = H.elbow, elbowFallback = H.elbowFallback, mcpWorst = H.mcpWorst;
    // Thumb: rooted at its CMC joint -- the wrist-end corner of
    // the palm on the index side, where the thumb's metacarpal
    // actually articulates -- and chained to the rest point as
    // part of the hand's own structure. When the rest point sits
    // near the chain's reach limit (the wrist rides radially out
    // for the forearm's sake), the thenar root slides toward the
    // rest point within the palm plane, up to 35 mm -- the
    // thenar mass rotating toward the neck, as a real hand's
    // does; the drawn thenar capsule bridges root and base so
    // the assembly stays connected.
    // The solve itself (base, slide, pullback, clearance
    // walk) is thumbSolveFor above -- shared with the wrist
    // trials' tip-error prediction.
    const thS = thumbSolveFor(wrist, H);
    const thumbBase = thS.base, thumbRoot = thS.root, thumbPullback = thS.pullback;
    const thumbSol = thumbChain(thumbRoot, restPt, dorsalRefT);
    let thumbPts = thumbSol.points;
    // THUMB CLEARANCE ROTATION (bone mode): in thumb
    // position the proximal phalanx can lie across the
    // fingerboard box's corner (measured -15.5 mm capsule
    // against section 5's -8 mm graze bound; the shipped
    // hand's thumb rode higher). The chain's intrinsic
    // bends (beta1/beta2, the tip error) are properties of
    // the chord and the segment lengths, so rotate the two
    // interior joints rigidly about the root->tip axis --
    // root, tip and bends unchanged -- by the smallest
    // angle that clears the board box and the neck.
    if (CARR.mode === 'bone') {
      const boxD = pt => {
        const rel = sub(pt, M.BOARD.A), a = dot(rel, M.BOARD.dir), b = dot(rel, M.v), c = dot(rel, M.BOARD.normal);
        const halfW = 0.023 + 0.008 * clamp(a / M.BOARD.END, 0, 1);
        const da = a < 0 ? -a : (a > M.BOARD.END ? a - M.BOARD.END : 0);
        const db = Math.max(Math.abs(b) - halfW, 0);
        const dc = c > 0.0008 ? c - 0.0008 : (c < -0.0062 ? -0.0062 - c : 0);
        if (da === 0 && db === 0 && dc === 0) return -Math.min(halfW - Math.abs(b), c + 0.0062, 0.0008 - c, a, M.BOARD.END - a);
        return Math.hypot(da, db, dc);
      };
      // Margins are measured against section 5's own graze
      // bounds (board -16.5 mm, neck -2.5 mm for the thumb):
      // the search maximises the worse margin, so it can
      // never trade one bound away to buy the other (a
      // board-slack-weighted version measurably did exactly
      // that at Swan t~18: board -11.2 -> -8.8 mm bought with
      // neck +0.2 -> -2.8 mm, past the neck bound).
      const breachT = pts => {
        let worst = Infinity;
        for (let j = 0; j < 3; j++) for (let kk = 0; kk <= 8; kk++) {
          const pt = pts[j].map((v, q) => v + (pts[j + 1][q] - v) * kk / 8);
          if (Math.hypot(...sub(pt, restPt)) < 0.012) continue;
          worst = Math.min(worst, boxD(pt) - THUMB_R[j] + 0.0165);
          const abT = sub(M.NECK_B, M.NECK_A);
          const ap = add(M.NECK_A, mul(abT, clamp(dot(sub(pt, M.NECK_A), abT) / dot(abT, abT), 0, 1)));
          worst = Math.min(worst, Math.hypot(...sub(pt, ap)) - 0.027 - THUMB_R[j] + 0.0025);
        }
        return worst;
      };
      const minBoxC = pts => {
        let worst = Infinity;
        for (let j = 0; j < 3; j++) for (let kk = 0; kk <= 8; kk++) {
          const pt = pts[j].map((v, q) => v + (pts[j + 1][q] - v) * kk / 8);
          if (Math.hypot(...sub(pt, restPt)) < 0.012) continue;
          worst = Math.min(worst, boxD(pt));
        }
        return worst;
      };
      if (breachT(thumbPts) < 0 || minBoxC(thumbPts) < 0.0005) {
        const axT = norm(sub(restPt, thumbRoot));
        // Lexicographic choice (Stage 2): a rotation that
        // keeps BOTH capsule bounds always beats one that
        // violates either, however clear its centreline;
        // among bound-feasible rotations the one whose
        // centreline rides highest off the box wins (section
        // 5 also counts centrelines inside the box); if none
        // is feasible, the least bound violation wins.
        const better = (e, b) => {
          const ef = e.m >= 0, bf = b.m >= 0;
          if (ef !== bf) return ef;
          if (ef) return e.c > b.c + 1e-9;
          return e.m > b.m + 1e-9;
        };
        let best = thumbPts, bestE = { m: breachT(thumbPts), c: minBoxC(thumbPts) };
        for (let ai = 1; ai <= 15; ai++) for (const sgn of [1, -1]) {
          const ang = sgn * ai * 0.06, c = Math.cos(ang), s = Math.sin(ang);
          const rotP = p => {
            const rel = sub(p, thumbRoot);
            return add(thumbRoot, add(add(mul(rel, c), mul(M.vec.cross(axT, rel), s)), mul(axT, dot(axT, rel) * (1 - c))));
          };
          const cand = [thumbPts[0], rotP(thumbPts[1]), rotP(thumbPts[2]), thumbPts[3]];
          const e = { m: breachT(cand), c: minBoxC(cand) };
          if (better(e, bestE)) { bestE = e; best = cand; }
        }
        thumbPts = best;
      }
    }
    const thumbSolve = { beta1: thumbSol.beta1, beta2: thumbSol.beta2, gamma: thumbSol.gamma, tipErr: thumbSol.tipErr, pullback: thumbPullback, slide: thS.slide, cmcRot: thS.cmcRot, rotFirst: thS.rotFirst };
    // THENAR EMINENCE (rk 2026-11-08: "the two balls at the
    // thumb's base look wrong"). The drawn thenar is ONE
    // lofted mass -- the foundation's THENAR ellipsoid in the
    // carpal frame, offset from the CMC base exactly as in
    // the rest skeleton, then centred partway along the
    // base -> root path with its long radius stretched by
    // the root's travel (slide + CMC rotation), so it flows
    // from the wrist/carpus into the thumb metacarpal as one
    // surface. The old drawing (a capsule base -> root plus
    // a proud ball ON the root, against the carpus ball at
    // the wrist) read as two discrete spheres stuck on the
    // wrist; both are gone -- no ball sits at the thumb base
    // or root any more (section 8b asserts their absence).
    const thenar = (() => {
      const cOff = [
        -(THENAR.centre[0] - THUMB_BASE[0]) * thS.thSign,
        THENAR.centre[1] - THUMB_BASE[1],
        THENAR.centre[2] - THUMB_BASE[2]
      ];
      const centre0 = add(add(add(thumbBase, mul(thS.thX, cOff[0])), mul(thS.thY, cOff[1])), mul(thS.thZ, cOff[2]));
      const travel = Math.hypot(...sub(thumbRoot, thumbBase));
      return {
        centre: lerp(centre0, thumbRoot, 0.30),
        radii: [THENAR.radii[0], THENAR.radii[1] + 0.30 * travel, THENAR.radii[2]],
        basis: { x: thS.thX, y: thS.thY, z: thS.thZ },
        euler: eulerZYX(thS.thX, thS.thY, thS.thZ)
      };
    })();
    // Bow + right arm. The stroke fraction is eased to 17%..83% of
    // the bow: at the extreme tip the frog lever (~0.72 m from a
    // contact already ~0.57 m from the shoulder) would over-extend
    // the arm's fixed bone lengths.
    const bowF = 0.5 + (tr.bow(t) - 0.5) * 0.66;
    const sFloat = tr.string(t);
    const s0 = clamp(Math.floor(sFloat), 0, 3), s1 = clamp(s0 + 1, 0, 3), sf = sFloat - s0;
    const contact = lerp(M.bowContact(s0), M.bowContact(s1), sf);
    const dir = norm(lerp(M.bowDir(s0), M.bowDir(s1), sf));
    const frog = sub(contact, mul(dir, bowF * M.BOW_LENGTH));
    const tip = add(contact, mul(dir, (1 - bowF) * M.BOW_LENGTH));
    // frog/tip are the HAIR line (through the contact); the hand
    // grips the STICK, 20 mm toward the audience from the hair.
    const stickFrog = add(frog, mul(M.n, 0.020)), stickTip = add(tip, mul(M.n, 0.020));
    const wristR = add(stickFrog, add(mul(dir, -0.010), [0, 0.012, 0]));
    const elbowR = solveElbow(SHOULDER_R, wristR, [-0.55, -1, 0.15]);
    const sway = {
      lean: 0.035 + 0.012 * Math.sin(t * 0.45),
      turn: 0.05 * Math.sin(t * 0.23 + 1.2),
      breath: 0.006 * Math.sin(t * 2 * Math.PI * 0.22)
    };
    return {
      leftArm: { shoulder: SHOULDER_L, elbow: elbowL, wrist },
      rightArm: { shoulder: SHOULDER_R, elbow: elbowR, wrist: wristR },
      fingers, thumb: { points: thumbPts },
      bow: { frog, tip, contact, string: sFloat, frac: bowF, stickFrog, stickTip },
      hand: { anchor: anchorPt, mode, lambda: lam, backNormal: palm.basis.z, palm, pad, hypothenar, thenar, carpus, row: { centre: K, axis: palmX, half: H.xHalf }, thumbRoot, thumbBase, thumbRest: restPt, wrist, elbowFallback, variant: VARI.name, mcpWorst, wristBackRelax, thumbSolve, wristFlex: H.elbowFlex, wristDev: H.elbowDev, elbowCone: H.elbowCone, elbowViol: H.elbowViol, pronation: H.pronation, ...(romWin ? { rom: { how: romWin.how, cand: romWin.cand, start: romWin.start, tried: romWin.tried, diag: romWin.diag } } : {}) }, sway,
      sounding: sounding.map(({ r }) => r.string)
    };
  }

  // ==================================================================
  // NATURAL LEFT HAND (redesign, 2026-11-11)
  // ------------------------------------------------------------------
  // Shape first, placement second. The hand is ONE forward-kinematic
  // model (fixed bone lengths by construction):
  //   wrist: position + orientation (6 DOF, neck coordinates)
  //   fingers 1-4: MCP flexion, MCP abduction, PIP flexion
  //                (DIP = DIPK x PIP, the FDP coupling)
  //   thumb: CMC (2 axes) + pad roll, MCP, IP
  //   elbow: swivel about the shoulder-wrist axis
  // A FRAME -- (mode, each finger's semitone slot, each finger's
  // string) -- is solved ONCE by Levenberg-Marquardt: every frame
  // finger's tip cap is tangent to the fingerboard at its slot, the
  // thumb rests on the back of the neck (or lies across two strings
  // in thumb position), and the remaining freedom is spent on
  // comfort: can-grip joint values, a straight wrist, an even finger
  // cascade, clearance from the instrument. The solver always
  // returns a pose. WHICH finger stops does not move the frame:
  // the stopping finger and the lower fingers stay down, the higher
  // fingers hover by opening their MCP a few degrees. In time, frames
  // blend in joint space (the hand keeps its shape through a shift)
  // and sounding fingers are then pinned exactly by a 3-DOF Newton
  // IK on the finger alone.
  // Neck coordinates: origin = fingerboard surface centre at the nut,
  // d = along the board toward the bridge, v = across toward the C
  // string, n = out of the board. Hand frame (canonical, as the rest
  // skeleton above): X index -> little, Y distal, Z dorsal.
  // ==================================================================
  const NH = (() => {
    const cross = M.vec.cross, D2R = Math.PI / 180, B = M.BOARD;
    const O = B.A, eD = B.dir, eV = M.v, eN = B.normal;
    const toNeck = p => { const r = sub(p, O); return [dot(r, eD), dot(r, eV), dot(r, eN)]; };
    const toWorld = q => [
      O[0] + q[0] * eD[0] + q[1] * eV[0] + q[2] * eN[0],
      O[1] + q[0] * eD[1] + q[1] * eV[1] + q[2] * eN[1],
      O[2] + q[0] * eD[2] + q[1] * eV[2] + q[2] * eN[2]];
    const dirWorld = q => [
      q[0] * eD[0] + q[1] * eV[0] + q[2] * eN[0],
      q[0] * eD[1] + q[1] * eV[1] + q[2] * eN[1],
      q[0] * eD[2] + q[1] * eV[2] + q[2] * eN[2]];
    const DIPK = 0.67;
    const CFG = {
      press: 0.0005,            // pad compression at a stop (m)
      hoverMcp: 9 * D2R, hoverPip: 5 * D2R, // a hovering finger opens by this much
      hop: 0.05,                            // s: one finger moving between two consecutive stops of its own
      dropLead: 0.085, liftLag: 0.11,       // s: finger lands before its note / lifts after
      contactTol: 5e-5,                     // m: a stop counts as held within a tenth of the pad compression
      holdUntil: 0.5,                       // a sounding finger stays planted through this share of the hand's departure
      minGap: 0.0165,                       // closest two neighbouring fingertips stand on one string (m)
      frameRelax: 0.88, frameSpan: 0.086,   // relaxed block: shrink factor / widest held span (m)
      vibHand: 0.0030, vibTip: 0.0007,      // m: hand sway / rolling contact travel
      pole: [1, -0.95, -0.1]                // elbow reference: out to the player's left, a little low
    };

    // ---- instrument surfaces (approximate signed distance, neck coords) ----
    const NECK_END = M.NECK.end, depthAt = M.NECK.depthAt;
    function sdInst(p) {
      const d = p[0], x = p[1], z = p[2];
      const lo = -0.085, hi = B.END;
      const dc = d < 0 ? 0 : d > hi ? hi : d;
      const w = B.widthAt(dc) / 2, th = B.thicknessAt(dc);
      const hasNeck = d <= NECK_END;
      let sd;
      if (z >= -th || !hasNeck) {
        const xc = x < -w ? -w : x > w ? w : x;
        const top = z - B.crown(xc), side = Math.abs(x) - w, bot = hasNeck ? -1 : -th - z;
        const m = Math.max(top, side, bot);
        sd = m <= 0 ? m : Math.hypot(Math.max(top, 0), Math.max(side, 0), Math.max(bot, 0));
      } else {
        const b = depthAt(dc) - th, ez = -(z + th);
        const k = Math.hypot(x / w, ez / b);
        if (k < 1e-6) sd = -Math.min(w, b);
        else sd = (k - 1) * k / Math.hypot(x / (w * w), ez / (b * b));
      }
      const axial = Math.max(lo - d, d - hi);
      if (axial > 0) sd = sd > 0 ? Math.hypot(sd, axial) : axial;
      return sd;
    }
    const sdGrad = p => {
      const h = 1e-5, g = [
        sdInst([p[0] + h, p[1], p[2]]) - sdInst([p[0] - h, p[1], p[2]]),
        sdInst([p[0], p[1] + h, p[2]]) - sdInst([p[0], p[1] - h, p[2]]),
        sdInst([p[0], p[1], p[2] + h]) - sdInst([p[0], p[1], p[2] - h])];
      return norm(g);
    };
    // Upper bout of the body (world coords), a rounded box.
    const BOUT_C = add(add(M.AB, mul(M.u, 0.16)), mul(M.n, -0.052)), BOUT_H = [0.172, 0.170, 0.056], BOUT_R = 0.02;
    function sdBody(pw) {
      const r = sub(pw, BOUT_C);
      const qx = Math.abs(dot(r, M.v)) - (BOUT_H[0] - BOUT_R), qy = Math.abs(dot(r, M.u)) - (BOUT_H[1] - BOUT_R), qz = Math.abs(dot(r, M.n)) - (BOUT_H[2] - BOUT_R);
      return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - BOUT_R;
    }

    // ---- stop points ----
    // The stop of string s at semitone k, ON the crowned board surface.
    const stopPoint = (s, k) => stopPointD(s, F.distFromNut(k) / 1000);
    function stopPointD(s, dNut) {
      const q = toNeck(M.boardPoint(s, dNut));
      const x = q[1], rr = Math.sqrt(B.radius * B.radius - x * x);
      q[2] = B.crown(x);
      return { T: q, N: norm([0, x / rr, 1]) };
    }

    // ---- skeleton (hand frame) ----
    // The foundation's bases, lengths, cup and segment tables are kept;
    // the metacarpals fan a little wider (the playing hand is an OPEN
    // hand: knuckle row 61 mm index -> little instead of 56).
    const YAW = { 1: -5.5, 2: -1.2, 3: 2.2, 4: 6.5 };
    // Thumb at its anatomical length (metacarpal 46, phalanges 34 + 27 = 107 mm; the
    // foundation's 96 mm chain could not oppose the fingers without slanting the hand).
    const TL = [0.046, 0.034, 0.027];
    const FB = {}, ROOT = {};
    for (let f = 1; f <= 4; f++) {
      const y = YAW[f] * D2R, c = MC_CUP[f] * D2R;
      const m = [Math.sin(y), Math.cos(y) * Math.cos(c), -Math.cos(y) * Math.sin(c)], z = norm(sub([0, 0, 1], mul(m, m[2])));
      ROOT[f] = add(MC_BASE[f], mul(m, MC_LEN[f]));
      FB[f] = { m, z, a: cross(m, z), K: ROOT[f] };
    }
    const KAPPA = { 1: 4 * D2R, 2: 1 * D2R, 3: -2 * D2R, 4: -5 * D2R }; // flexion planes converge (fist -> scaphoid)
    const LIM = {
      mcp: [-12 * D2R, 88 * D2R], pip: [6 * D2R, 102 * D2R],
      abd: { 1: [-30 * D2R, 12 * D2R], 2: [-22 * D2R, 15 * D2R], 3: [-15 * D2R, 18 * D2R], 4: [-13 * D2R, 32 * D2R] },
      thumb: [[-15 * D2R, 65 * D2R], [0, 66 * D2R], [-60 * D2R, 120 * D2R], [-8 * D2R, 58 * D2R], [-18 * D2R, 78 * D2R]]
    };
    function fingerFK(f, t1, psi, t2) {
      const { m, z, a, K } = FB[f], L = FINGER_LEN[f], r = FINGER_R[f][2];
      const cp = Math.cos(psi), sp = Math.sin(psi), ck = Math.cos(KAPPA[f]), sk = Math.sin(KAPPA[f]);
      const m1 = [m[0] * cp + a[0] * sp, m[1] * cp + a[1] * sp, m[2] * cp + a[2] * sp];
      const a1 = [a[0] * cp - m[0] * sp, a[1] * cp - m[1] * sp, a[2] * cp - m[2] * sp];
      const z1 = [z[0] * ck - a1[0] * sk, z[1] * ck - a1[1] * sk, z[2] * ck - a1[2] * sk];
      const F1 = t1, F2 = t1 + t2, F3 = F2 + DIPK * t2;
      const c1 = Math.cos(F1), s1 = Math.sin(F1), c2 = Math.cos(F2), s2 = Math.sin(F2), c3 = Math.cos(F3), s3 = Math.sin(F3);
      const P1 = [0, 0, 0], P2 = [0, 0, 0], P3 = [0, 0, 0], C = [0, 0, 0], d3 = [0, 0, 0], p3 = [0, 0, 0];
      for (let i = 0; i < 3; i++) {
        P1[i] = K[i] + L[0] * (m1[i] * c1 - z1[i] * s1);
        P2[i] = P1[i] + L[1] * (m1[i] * c2 - z1[i] * s2);
        d3[i] = m1[i] * c3 - z1[i] * s3;
        p3[i] = -(m1[i] * s3 + z1[i] * c3);
        P3[i] = P2[i] + L[2] * d3[i];
        C[i] = P2[i] + (L[2] - r) * d3[i];
      }
      return { pts: [K, P1, P2, P3], C, d3, p3, r };
    }
    // Thumb position: the thumb lies on the string by the side of its IP joint -- the
    // seat height is the joint's drawn radius, so the joint rests on the board, not in it.
    const seatR = () => (THUMB_R[1] + THUMB_R[2]) / 2;
    function thumbFK(az, el, om, tm, ti) {
      const L = TL, r = THUMB_R[2];
      const ce = Math.cos(el), se = Math.sin(el);
      const t1 = [-ce * Math.sin(az), ce * Math.cos(az), -se];
      const u1 = norm([-t1[1] * t1[0], 1 - t1[1] * t1[1], -t1[1] * t1[2]]); // distal, made perpendicular to t1
      const u2 = cross(t1, u1);                                             // om > 0 turns the pad ulnar
      const co = Math.cos(om), so = Math.sin(om);
      const p = [co * u1[0] + so * u2[0], co * u1[1] + so * u2[1], co * u1[2] + so * u2[2]];
      const cm = Math.cos(tm), sm = Math.sin(tm), c3 = Math.cos(tm + ti), s3 = Math.sin(tm + ti);
      const P0 = THUMB_BASE, P1 = [0, 0, 0], P2 = [0, 0, 0], P3 = [0, 0, 0], C = [0, 0, 0], d3 = [0, 0, 0], p3 = [0, 0, 0];
      for (let i = 0; i < 3; i++) {
        P1[i] = P0[i] + L[0] * t1[i];
        P2[i] = P1[i] + L[1] * (cm * t1[i] + sm * p[i]);
        d3[i] = c3 * t1[i] + s3 * p[i];
        p3[i] = c3 * p[i] - s3 * t1[i];
        P3[i] = P2[i] + L[2] * d3[i];
        C[i] = P2[i] + (L[2] - r) * d3[i];
      }
      return { pts: [P0, P1, P2, P3], C, d3, p3, r };
    }

    // ---- rotations ----
    const rod = w => { // rotation matrix (row-major 9) of a rotation vector
      const th = Math.hypot(w[0], w[1], w[2]);
      if (th < 1e-12) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
      const x = w[0] / th, y = w[1] / th, z = w[2] / th, c = Math.cos(th), s = Math.sin(th), C = 1 - c;
      return [c + x * x * C, x * y * C - z * s, x * z * C + y * s, y * x * C + z * s, c + y * y * C, y * z * C - x * s, z * x * C - y * s, z * y * C + x * s, c + z * z * C];
    };
    const mm = (a, b) => { const o = new Array(9); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) o[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j]; return o; };
    const mv = (a, v) => [a[0] * v[0] + a[1] * v[1] + a[2] * v[2], a[3] * v[0] + a[4] * v[1] + a[5] * v[2], a[6] * v[0] + a[7] * v[1] + a[8] * v[2]];
    const mtv = (a, v) => [a[0] * v[0] + a[3] * v[1] + a[6] * v[2], a[1] * v[0] + a[4] * v[1] + a[7] * v[2], a[2] * v[0] + a[5] * v[1] + a[8] * v[2]];
    const col = (a, j) => [a[j], a[3 + j], a[6 + j]];
    const fromCols = (x, y, z) => [x[0], y[0], z[0], x[1], y[1], z[1], x[2], y[2], z[2]];
    const m2q = m => {
      const tr = m[0] + m[4] + m[8]; let q;
      if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; q = [(m[7] - m[5]) / s, (m[2] - m[6]) / s, (m[3] - m[1]) / s, s / 4]; }
      else if (m[0] > m[4] && m[0] > m[8]) { const s = Math.sqrt(1 + m[0] - m[4] - m[8]) * 2; q = [s / 4, (m[1] + m[3]) / s, (m[2] + m[6]) / s, (m[7] - m[5]) / s]; }
      else if (m[4] > m[8]) { const s = Math.sqrt(1 + m[4] - m[0] - m[8]) * 2; q = [(m[1] + m[3]) / s, s / 4, (m[5] + m[7]) / s, (m[2] - m[6]) / s]; }
      else { const s = Math.sqrt(1 + m[8] - m[0] - m[4]) * 2; q = [(m[2] + m[6]) / s, (m[5] + m[7]) / s, s / 4, (m[3] - m[1]) / s]; }
      return q;
    };
    const q2m = q => {
      const [x, y, z, w] = q;
      return [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w), 2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w), 2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)];
    };

    // ---- arm ----
    const POLE = norm(CFG.pole);
    function elbowOf(Ww, phi) {
      const a = sub(Ww, SHOULDER_L), d = Math.hypot(...a), ah = mul(a, 1 / d);
      const dd = Math.min(d, ARM[0] + ARM[1] - 1e-4);
      const x = (dd * dd + ARM[0] * ARM[0] - ARM[1] * ARM[1]) / (2 * dd), r = Math.sqrt(Math.max(0, ARM[0] * ARM[0] - x * x));
      const p1 = norm(sub(POLE, mul(ah, dot(POLE, ah)))), p2 = cross(ah, p1);
      const c = Math.cos(phi), s = Math.sin(phi);
      return { E: [0, 1, 2].map(i => SHOULDER_L[i] + ah[i] * x + (p1[i] * c + p2[i] * s) * r), over: d - (ARM[0] + ARM[1] - 1e-4) };
    }

    // ---- frame state ----
    // q = { w:[d,v,n], R:[9], f:{1..4:[mcp,abd,pip]}, th:[az,el,om,mcp,ip], sw }
    const cloneQ = q => ({ w: [...q.w], R: [...q.R], f: { 1: [...q.f[1]], 2: [...q.f[2]], 3: [...q.f[3]], 4: [...q.f[4]] }, th: [...q.th], sw: q.sw });
    const pack = q => { const x = [q.w[0], q.w[1], q.w[2], 0, 0, 0]; for (let f = 1; f <= 4; f++) x.push(...q.f[f]); x.push(...q.th, q.sw); return x; };
    const unpack = (x, Rb) => ({
      w: [x[0], x[1], x[2]], R: mm(rod([x[3], x[4], x[5]]), Rb),
      f: { 1: [x[6], x[7], x[8]], 2: [x[9], x[10], x[11]], 3: [x[12], x[13], x[14]], 4: [x[15], x[16], x[17]] },
      th: [x[18], x[19], x[20], x[21], x[22]], sw: x[23]
    });
    const blendQ = (a, b, t) => {
      if (t <= 0) return a; if (t >= 1) return b;
      const qa = a.quat || (a.quat = m2q(a.R)), qb0 = b.quat || (b.quat = m2q(b.R));
      const sg = qa[0] * qb0[0] + qa[1] * qb0[1] + qa[2] * qb0[2] + qa[3] * qb0[3] < 0 ? -1 : 1;
      let qq = qa.map((v, i) => v + (sg * qb0[i] - v) * t); const l = Math.hypot(...qq); qq = qq.map(v => v / l);
      const L = (u, v) => u + (v - u) * t, o = { w: a.w.map((v, i) => L(v, b.w[i])), R: q2m(qq), f: {}, th: a.th.map((v, i) => L(v, b.th[i])), sw: L(a.sw, b.sw) };
      for (let f = 1; f <= 4; f++) o.f[f] = a.f[f].map((v, i) => L(v, b.f[f][i]));
      return o;
    };

    // Wrist angles of hand frame R (neck coords) against the forearm.
    function wristAngles(q) {
      const Ww = toWorld(q.w), { E, over } = elbowOf(Ww, q.sw);
      const fw = norm(sub(Ww, E));
      const X = dirWorld(col(q.R, 0)), Y = dirWorld(col(q.R, 1)), Z = dirWorld(col(q.R, 2));
      const fy = dot(fw, Y), fx = dot(fw, X), fz = dot(fw, Z);
      const hOut = norm(cross(sub(E, SHOULDER_L), sub(Ww, E)));
      return { Ww, E, over, flex: Math.atan2(fz, fy), dev: Math.atan2(-fx, fy), pron: dot(Z, hOut), fw };
    }

    // ---- the frame objective ----
    // spec = { mode, fingers:{f:{T,N}|null}, thumb:{...} }
    const WRIST = { flex0: -8, flexS: 12, flexLo: -32, dev0: 12, devS: 14, pronLo: 0.30 };
    let THUMBV = 0.014;
    const hinge = (x, lo, hi, s) => x < lo ? (lo - x) / s : x > hi ? (x - hi) / s : 0;
    const PRIOR = {
      neck: { mcp: { 1: 30, 2: 32, 3: 34, 4: 36 }, pip: { 1: 52, 2: 58, 3: 56, 4: 44 }, attack: 55, thumb: [22, 46, 15, 14, 12] },
      thumb: { mcp: { 1: 36, 2: 38, 3: 38, 4: 52 }, pip: { 1: 86, 2: 88, 3: 82, 4: 72 }, attack: 78, thumb: [30, 22, 40, 10, 0] }
    };
    function residuals(q, spec, dbg) {
      const r = [], P = PRIOR[spec.mode], R = q.R, W = q.w;
      const H2N = p => { const v = mv(R, p); return [W[0] + v[0], W[1] + v[1], W[2] + v[2]]; };
      const col_ = []; // collision samples: [point(neck), radius, margin]
      const mark = dbg ? (name => { (dbg.marks = dbg.marks || []).push([name, r.length]); }) : (() => {});
      const fk = {};
      for (let f = 1; f <= 4; f++) {
        const a = q.f[f], k = fk[f] = fingerFK(f, a[0], a[1], a[2]), tg = spec.fingers[f];
        const Cn = H2N(k.C), d3 = mv(R, k.d3);
        if (tg) {
          const want = [tg.T[0] + tg.N[0] * (k.r - CFG.press), tg.T[1] + tg.N[1] * (k.r - CFG.press), tg.T[2] + tg.N[2] * (k.r - CFG.press)];
          const e3 = [Cn[0] - want[0], Cn[1] - want[1], Cn[2] - want[2]];
          if (spec.anchor && spec.anchor[f]) for (let i = 0; i < 3; i++) r.push(e3[i] / 0.00005);
          else { // frame fingers that are not sounding: Huber -- a finger that cannot reach its slot gives way gracefully
            const en = Math.hypot(e3[0], e3[1], e3[2]) / 0.0015, hub = en <= 1 ? 1 : Math.sqrt(2 * en - 1) / en;
            for (let i = 0; i < 3; i++) r.push(e3[i] / 0.0015 * hub);
          }
          const att = Math.asin(clamp(-(d3[0] * tg.N[0] + d3[1] * tg.N[1] + d3[2] * tg.N[2]), -1, 1));
          r.push((att - P.attack * D2R) / (16 * D2R), hinge(att, 22 * D2R, 86 * D2R, 2 * D2R));
          // the finger meets the string square-on: its distal axis has no component along the string
          r.push(d3[0] / 0.45);
        } else {
          col_.push([Cn, k.r, 0.006]);
          r.push(0, 0, 0, 0, 0, 0);
        }
        r.push((a[0] - P.mcp[f] * D2R) / (20 * D2R), a[1] / (11 * D2R), (a[2] - P.pip[f] * D2R) / (16 * D2R));
        r.push(hinge(a[0], LIM.mcp[0], LIM.mcp[1], D2R), hinge(a[1], LIM.abd[f][0], LIM.abd[f][1], D2R), hinge(a[2], LIM.pip[0], LIM.pip[1], D2R));
        const rr = FINGER_R[f];
        const p1 = H2N(k.pts[1]), p2 = H2N(k.pts[2]), p0 = H2N(k.pts[0]);
        col_.push([p1, (rr[0] + rr[1]) / 2, 0.002], [p2, (rr[1] + rr[2]) / 2, 0.0005], [lerp(p0, p1, 0.5), rr[0], 0.003], [lerp(p1, p2, 0.5), rr[1], 0.0015], [p0, 0.0105, 0.007]);
        col_.push([H2N(lerp(MC_BASE[f], k.pts[0], 0.5)), 0.011, 0.004]);
      }
      mark('fingers');
      for (let f = 1; f <= 3; f++) {
        r.push((q.f[f][0] - q.f[f + 1][0]) / (24 * D2R));
        r.push(hinge(q.f[f + 1][1] - q.f[f][1], -11 * D2R, (f === 2 ? 17 : 21) * D2R, D2R));
      }
      mark('cascade');
      // thumb
      const t = q.th, tk = thumbFK(t[0], t[1], t[2], t[3], t[4]), tp = P.thumb;
      const Ct = H2N(tk.C), tP1 = H2N(tk.pts[1]), tP2 = H2N(tk.pts[2]);
      const sT = [28, 26, 40, 16, 18];
      for (let i = 0; i < 5; i++) r.push((t[i] - tp[i] * D2R) / (sT[i] * D2R), hinge(t[i], LIM.thumb[i][0], LIM.thumb[i][1], D2R));
      if (spec.mode === 'neck') {
        const th = spec.thumb;
        r.push((sdInst(Ct) - (tk.r - CFG.press)) / 0.00012);
        r.push((Ct[0] - th.d) / 0.007, (Ct[1] - th.v) / THUMBV);
        r.push(hinge(Ct[2], -1, -B.thicknessAt(Ct[0]) - 0.006, 0.001));
        const g = sdGrad(Ct), p3 = mv(R, tk.p3);
        r.push((1 + p3[0] * g[0] + p3[1] * g[1] + p3[2] * g[2]) / 0.2);
        r.push(0, 0, 0);
        col_.push([tP2, (THUMB_R[1] + THUMB_R[2]) / 2, 0.0005], [tP1, (THUMB_R[0] + THUMB_R[1]) / 2, 0.003], [lerp(tP1, tP2, 0.5), THUMB_R[1], 0.001]);
      } else {
        const th = spec.thumb, d3 = mv(R, tk.d3), I = tP2, L3 = TL[2];
        const a1 = 0.22 * L3, a2 = a1 + th.span;
        for (let i = 0; i < 3; i++) r.push((I[i] + a1 * d3[i] - (th.A1[i] + th.N1[i] * (seatR() - CFG.press))) / 0.00012);
        for (let i = 0; i < 3; i++) r.push((I[i] + a2 * d3[i] - (th.A2[i] + th.N2[i] * (seatR() - CFG.press))) / 0.003); // the second string: a lean, not a clamp
        r.push(R[1] / 0.25, 0); // thumb position: the hand stays square to the string; reach comes from curl, not slant
        col_.push([tP1, (THUMB_R[0] + THUMB_R[1]) / 2, 0.003], [tP2, (THUMB_R[1] + THUMB_R[2]) / 2, -0.0008], [Ct, tk.r, -0.0008], [lerp(tP1, tP2, 0.5), THUMB_R[1], 0.0005]);
      }
      col_.push([H2N(lerp(tk.pts[0], tk.pts[1], 0.5)), 0.013, 0.003], [H2N(lerp(tk.pts[1], FB[1].K, 0.5)), 0.008, 0.004]);
      mark('thumb');
      // wrist / arm
      const wa = wristAngles(q);
      r.push((wa.flex - WRIST.flex0 * D2R) / (WRIST.flexS * D2R), hinge(wa.flex, WRIST.flexLo * D2R, 50 * D2R, 1.5 * D2R));
      r.push((wa.dev - WRIST.dev0 * D2R) / (WRIST.devS * D2R), hinge(wa.dev, -15 * D2R, 32 * D2R, 1.5 * D2R));
      r.push(hinge(wa.pron, WRIST.pronLo, 2, 0.04) + Math.max(0, 0.75 - wa.pron) / 0.6);
      r.push(q.sw / (38 * D2R), hinge(wa.E[1], -9, SHOULDER_L[1] + 0.13, 0.006), hinge(wa.E[0], 0.27, 9, 0.006), Math.max(0, wa.over) / 0.001);
      mark('wrist');
      // collisions
      const Wn = W, En = toNeck(wa.E);
      col_.push([H2N(CARPUS_R.centre), 0.024, 0.004], [H2N(HYPOTHENAR.centre), 0.014, 0.003], [H2N(PLATE.centre), 0.016, 0.004]);
      for (const u of [0.18, 0.4, 0.65]) col_.push([lerp(Wn, En, u), 0.038, 0.004]);
      let worst = Infinity;
      for (const [p, rad, mg] of col_) {
        const sd = sdInst(p) - rad;
        if (sd < worst) worst = sd;
        r.push(sd < mg ? (mg - sd) / 0.0008 : 0);
      }
      for (const u of [0, 0.25, 0.5, 0.8]) {
        const sd = sdBody(toWorld(lerp(Wn, En, u))) - (u === 0 ? 0.026 : 0.038);
        if (sd < worst) worst = sd;
        r.push(sd < 0.006 ? (0.006 - sd) / 0.0015 : 0);
      }
      mark('collide');
      if (dbg) { dbg.wa = wa; dbg.worst = worst; dbg.fk = fk; dbg.tk = tk; dbg.r = r; dbg.Ct = Ct; }
      return r;
    }

    // ---- Levenberg-Marquardt, forward-difference Jacobian ----
    function solveLin(A, b, n) { // Cholesky; returns null if not PD
      const L = new Float64Array(n * n);
      for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) {
        let s = A[i * n + j];
        for (let k = 0; k < j; k++) s -= L[i * n + k] * L[j * n + k];
        if (i === j) { if (s <= 1e-300) return null; L[i * n + i] = Math.sqrt(s); } else L[i * n + j] = s / L[j * n + j];
      }
      const y = new Float64Array(n), x = new Float64Array(n);
      for (let i = 0; i < n; i++) { let s = b[i]; for (let k = 0; k < i; k++) s -= L[i * n + k] * y[k]; y[i] = s / L[i * n + i]; }
      for (let i = n - 1; i >= 0; i--) { let s = y[i]; for (let k = i + 1; k < n; k++) s -= L[k * n + i] * x[k]; x[i] = s / L[i * n + i]; }
      return x;
    }
    // Outer variables: wrist (3) + rotation increment (3) + thumb (5) +
    // elbow swivel (1). The fingers are ELIMINATED: for every trial
    // hand placement each frame finger is put on its slot by its own
    // 3-DOF IK (warm-started), so contact holds throughout the search
    // and the objective only weighs comfort.
    function solveFrame(spec, seed, maxIter = 40) {
      let Rb = seed.R, fW = { 1: [...seed.f[1]], 2: [...seed.f[2]], 3: [...seed.f[3]], 4: [...seed.f[4]] };
      let x = [seed.w[0], seed.w[1], seed.w[2], 0, 0, 0, ...seed.th, seed.sw];
      const n = x.length;
      const build = xx => {
        const q = { w: [xx[0], xx[1], xx[2]], R: mm(rod([xx[3], xx[4], xx[5]]), Rb), f: {}, th: [xx[6], xx[7], xx[8], xx[9], xx[10]], sw: xx[11] };
        for (let f = 1; f <= 4; f++) q.f[f] = spec.fingers[f] ? fingerIK(f, fW[f], N2H(q, capTarget(spec.fingers[f], FINGER_R[f][2]))).a : fW[f];
        return q;
      };
      const fn = xx => residuals(build(xx), spec);
      let r = fn(x), cost = r.reduce((s, v) => s + v * v, 0), lam = 1e-2, stall = 0, iters = 0;
      const m = r.length, J = new Float64Array(m * n), A = new Float64Array(n * n), g = new Float64Array(n), Ad = new Float64Array(n * n);
      for (; iters < maxIter && stall < 3; iters++) {
        for (let j = 0; j < n; j++) {
          const h = j < 3 ? 4e-6 : 4e-5, keep = x[j]; x[j] = keep + h;
          const rj = fn(x); x[j] = keep;
          for (let i = 0; i < m; i++) J[i * n + j] = (rj[i] - r[i]) / h;
        }
        A.fill(0); g.fill(0);
        for (let i = 0; i < m; i++) {
          const ri = r[i], o = i * n;
          for (let a = 0; a < n; a++) { const ja = J[o + a]; if (ja === 0) continue; g[a] += ja * ri; for (let b = 0; b <= a; b++) A[a * n + b] += ja * J[o + b]; }
        }
        for (let a = 0; a < n; a++) for (let b = 0; b < a; b++) A[b * n + a] = A[a * n + b];
        let ok = false;
        for (let tries = 0; tries < 8 && !ok; tries++) {
          Ad.set(A);
          for (let a = 0; a < n; a++) Ad[a * n + a] += lam * (A[a * n + a] + 1e-6);
          const dx = solveLin(Ad, g, n);
          if (dx) {
            const xn = x.map((v, i) => v - dx[i]), qn = build(xn), rn = residuals(qn, spec), cn = rn.reduce((s, v) => s + v * v, 0);
            if (cn < cost) {
              stall = (cost - cn) < 1e-4 * (1 + cost) ? stall + 1 : 0;
              Rb = qn.R; fW = qn.f; x = xn; x[3] = x[4] = x[5] = 0;
              r = rn; cost = cn; lam = Math.max(lam * 0.3, 1e-7); ok = true; break;
            }
          }
          lam *= 4;
        }
        if (!ok) break;
      }
      const q = build(x);
      q.cost = cost; q.iters = iters;
      return q;
    }

    // ---- per-finger exact contact (hand fixed) ----
    // Newton on (mcp, abd, pip) so the tip cap centre lands on Ch (hand frame).
    // (Scalar code, analytic Jacobian: this is the solver's inner loop.)
    function fingerIK(f, ang, Ch) {
      const { m, z, a, K } = FB[f], L = FINGER_LEN[f], L0 = L[0], L1 = L[1], L2 = L[2] - FINGER_R[f][2];
      const ck = Math.cos(KAPPA[f]), sk = Math.sin(KAPPA[f]), k1 = 1 + DIPK;
      const lim = LIM.abd[f], tx = Ch[0] - K[0], ty = Ch[1] - K[1], tz = Ch[2] - K[2];
      let t1 = ang[0], ps = ang[1], t2 = ang[2], mu = 1e-10;
      // state at the accepted point
      let m0, m1, m2, a0, a1, a2, z0, z1, z2, c2, s2, c3, s3, A, Bz, ex, ey, ez, en;
      const evalAt = (u1, up, u2) => {
        const cp = Math.cos(up), sp = Math.sin(up);
        m0 = m[0] * cp + a[0] * sp; m1 = m[1] * cp + a[1] * sp; m2 = m[2] * cp + a[2] * sp;
        a0 = a[0] * cp - m[0] * sp; a1 = a[1] * cp - m[1] * sp; a2 = a[2] * cp - m[2] * sp;
        z0 = z[0] * ck - a0 * sk; z1 = z[1] * ck - a1 * sk; z2 = z[2] * ck - a2 * sk;
        const F2 = u1 + u2, F3 = F2 + DIPK * u2;
        c2 = Math.cos(F2); s2 = Math.sin(F2); c3 = Math.cos(F3); s3 = Math.sin(F3);
        A = L0 * Math.cos(u1) + L1 * c2 + L2 * c3; Bz = L0 * Math.sin(u1) + L1 * s2 + L2 * s3;
        ex = m0 * A - z0 * Bz - tx; ey = m1 * A - z1 * Bz - ty; ez = m2 * A - z2 * Bz - tz;
        en = Math.sqrt(ex * ex + ey * ey + ez * ez);
      };
      evalAt(t1, ps, t2);
      for (let it = 0; it < 14 && en > 1e-11; it++) {
        // Jacobian columns: d/dt1, d/dpsi, d/dt2
        const A2 = L1 * c2 + L2 * k1 * c3, B2 = L1 * s2 + L2 * k1 * s3;
        const j0x = -m0 * Bz - z0 * A, j0y = -m1 * Bz - z1 * A, j0z = -m2 * Bz - z2 * A;
        const j1x = a0 * A - m0 * sk * Bz, j1y = a1 * A - m1 * sk * Bz, j1z = a2 * A - m2 * sk * Bz;
        const j2x = -m0 * B2 - z0 * A2, j2y = -m1 * B2 - z1 * A2, j2z = -m2 * B2 - z2 * A2;
        const g0 = j0x * ex + j0y * ey + j0z * ez, g1 = j1x * ex + j1y * ey + j1z * ez, g2 = j2x * ex + j2y * ey + j2z * ez;
        const p00 = j0x * j0x + j0y * j0y + j0z * j0z, p11 = j1x * j1x + j1y * j1y + j1z * j1z, p22 = j2x * j2x + j2y * j2y + j2z * j2z;
        const q01 = j0x * j1x + j0y * j1y + j0z * j1z, q02 = j0x * j2x + j0y * j2y + j0z * j2z, q12 = j1x * j2x + j1y * j2y + j1z * j2z;
        const e0 = en, b1 = t1, bp = ps, b2 = t2;
        let ok = false;
        for (let tr = 0; tr < 7 && !ok; tr++) {
          const q00 = p00 + mu, q11 = p11 + mu, q22 = p22 + mu;
          const d0 = q11 * q22 - q12 * q12, d1 = q02 * q12 - q01 * q22, d2 = q01 * q12 - q02 * q11;
          const det = q00 * d0 + q01 * d1 + q02 * d2;
          if (Math.abs(det) > 1e-40) {
            const x0 = (g0 * d0 + g1 * d1 + g2 * d2) / det;
            const x1 = (g0 * d1 + g1 * (q00 * q22 - q02 * q02) + g2 * (q01 * q02 - q00 * q12)) / det;
            const x2 = (g0 * d2 + g1 * (q01 * q02 - q00 * q12) + g2 * (q00 * q11 - q01 * q01)) / det;
            const st = Math.sqrt(x0 * x0 + x1 * x1 + x2 * x2), sc = st > 0.35 ? 0.35 / st : 1;
            const n1 = clamp(b1 - x0 * sc, LIM.mcp[0], LIM.mcp[1]), np = clamp(bp - x1 * sc, lim[0], lim[1]), n2 = clamp(b2 - x2 * sc, LIM.pip[0], LIM.pip[1]);
            evalAt(n1, np, n2);
            if (en < e0) { t1 = n1; ps = np; t2 = n2; ok = true; mu = Math.max(mu * 0.2, 1e-10); break; }
          }
          mu = Math.max(mu * 20, 1e-7);
        }
        if (!ok) { evalAt(b1, bp, b2); break; }
        if (e0 - en < 1e-13) break;
      }
      return { a: [t1, ps, t2], err: en };
    }
    const capTarget = (tg, r) => [tg.T[0] + tg.N[0] * (r - CFG.press), tg.T[1] + tg.N[1] * (r - CFG.press), tg.T[2] + tg.N[2] * (r - CFG.press)];
    const N2H = (q, p) => mtv(q.R, sub(p, q.w));
    // Thumb, neck mode: restore cap tangency on the neck back by the CMC elevation.
    function thumbSeat(q) {
      const t = [...q.th], want = THUMB_R[2] - CFG.press;
      const g = el => { const k = thumbFK(t[0], el, t[2], t[3], t[4]), v = mv(q.R, k.C); return sdInst([q.w[0] + v[0], q.w[1] + v[1], q.w[2] + v[2]]) - want; };
      let a = t[1], fa = g(a);
      for (let it = 0; it < 8 && Math.abs(fa) > 1e-9; it++) {
        const h = 1e-5, d = (g(a + h) - fa) / h;
        if (Math.abs(d) < 1e-9) break;
        a = clamp(a - clamp(fa / d, -0.15, 0.15), LIM.thumb[1][0], LIM.thumb[1][1]); fa = g(a);
      }
      t[1] = a; return { th: t, err: Math.abs(fa) };
    }
    // Thumb, thumb position: damped least squares on (az, el, mcp, ip) so the string-side
    // contact point lands on the stop (smallest change from the incoming shape; never
    // accepts a worse iterate). Then the distal phalanx must LIE on the strings, not dive
    // past them: if the tip cap sits below the contact height, the IP joint is opened
    // and the contact re-solved with it held.
    function thumbIK(q, th) {
      const want = N2H(q, [0, 1, 2].map(i => th.A1[i] + th.N1[i] * (seatR() - CFG.press))), Nh = mtv(q.R, th.N1);
      const along = th.along != null ? th.along : 0.22 * TL[2];
      const pt = tt => { const k = thumbFK(tt[0], tt[1], tt[2], tt[3], tt[4]); return [k.pts[2][0] + k.d3[0] * along, k.pts[2][1] + k.d3[1] * along, k.pts[2][2] + k.d3[2] * along]; };
      const tipH = tt => { const k = thumbFK(tt[0], tt[1], tt[2], tt[3], tt[4]); return (k.C[0] - want[0]) * Nh[0] + (k.C[1] - want[1]) * Nh[1] + (k.C[2] - want[2]) * Nh[2]; };
      const solve = (t0, idx) => {
        let t = [...t0], p = pt(t), e = sub(p, want), err = Math.hypot(...e), mu = 1e-8;
        const n = idx.length;
        for (let it = 0; it < 14 && err > 1e-10; it++) {
          const J = idx.map(j => { const b = [...t]; b[j] += 1e-6; const pj = pt(b); return [(pj[0] - p[0]) * 1e6, (pj[1] - p[1]) * 1e6, (pj[2] - p[2]) * 1e6]; });
          const g = J.map(c => dot(c, e));
          let ok = false;
          for (let tr = 0; tr < 7 && !ok; tr++) {
            const A = new Float64Array(n * n);
            for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) A[i * n + j] = dot(J[i], J[j]) + (i === j ? mu : 0);
            const dx = solveLin(A, g, n);
            if (dx) {
              const st = Math.hypot(...dx), sc = st > 0.3 ? 0.3 / st : 1, t2 = [...t];
              idx.forEach((j, i) => { t2[j] = clamp(t[j] - dx[i] * sc, LIM.thumb[j][0], LIM.thumb[j][1]); });
              const p2 = pt(t2), e2 = sub(p2, want), en = Math.hypot(...e2);
              if (en < err) { const gain = err - en; t = t2; p = p2; e = e2; err = en; mu = Math.max(mu * 0.2, 1e-9); ok = gain > 1e-13; break; }
            }
            mu = Math.max(mu * 20, 1e-6);
          }
          if (!ok) break;
        }
        return { th: t, err };
      };
      let r = solve(q.th, [0, 1, 3, 4]);
      for (let round = 0; round < 3; round++) {
        const h = tipH(r.th);
        if (h > -0.0008 - (seatR() - THUMB_R[2])) break;
        const b = [...r.th]; b[4] -= 1e-4;
        const dh = (tipH(b) - h) / 1e-4; // per radian of IP extension
        if (Math.abs(dh) < 1e-4) break;
        const open = clamp((-0.0008 - (seatR() - THUMB_R[2]) - h) / dh, 0, 0.2); // extension only
        const t2 = [...r.th]; t2[4] = Math.max(t2[4] - open, LIM.thumb[4][0]);
        if (t2[4] === r.th[4]) break;
        const r2 = solve(t2, [0, 1, 3]);
        if (r2.err > Math.max(r.err, CFG.contactTol * 0.5)) break; // never trade the contact for the tip
        r = r2;
      }
      return r;
    }

    // ---- frame specs from the fingering plan ----
    const seedFor = (spec, variant = 0) => {
      const ref = spec.fingers[2] || spec.fingers[1] || spec.fingers[3];
      let R, K2, th, fa;
      if (spec.mode === 'neck') {
        // can grip beside the neck: index toward the nut, palm axis out of the board, back of the hand to the player's left
        R = mm(rod([0.25, 0, 0]), rod([variant ? 0.75 : 1.21, 0, 0]));
        K2 = variant ? [ref.T[0], ref.T[1] - 0.055, ref.T[2] + 0.04] : [ref.T[0], ref.T[1] - 0.066, ref.T[2] + 0.014];
        th = [22, 46, 15, 14, 12]; fa = [50, 0, 56];
      } else {
        // over the board: back of the hand toward the audience, fingers across the strings
        R = variant ? mm(rod([0, 0, -0.6]), rod([-0.35, 0, 0])) : rod([-0.35, 0, 0]);
        K2 = variant ? [ref.T[0] - 0.03, ref.T[1] - 0.05, ref.T[2] + 0.055] : [ref.T[0], ref.T[1] - 0.058, ref.T[2] + 0.05];
        th = [30, 22, 40, 10, 6]; fa = [36, 0, 64];
      }
      const w = sub(K2, mv(R, ROOT[2]));
      const q = { w, R, f: {}, th: th.map(v => v * D2R), sw: 0 };
      for (let f = 1; f <= 4; f++) q.f[f] = fa.map(v => v * D2R);
      return q;
    };
    // ---- frames ----
    // A frame spec is fully determined by (mode, slots, strings, anchored
    // fingers, thumb semitone/string); its solve is seeded from a PARENT
    // spec derived from the key alone (anchored -> plain; irregular ->
    // the closed block at that position; other string -> one string
    // toward the home string; other position -> one semitone toward the
    // home position). So a frame is a pure function of its key (the
    // cache can be global, pose stays a pure function of (song, t)) and
    // neighbouring frames come from the same family of solutions.
    function makeSpec(mode, slots, strs, anchors, tk, tHi) {
      const spec = { mode, slots: { ...slots }, strs: { ...strs }, fingers: {}, exact: {}, anchor: null, tk, tHi };
      // Frame fingers sit over RELAXED slots: the block is drawn in toward its centre
      // (never wider than CFG.frameSpan) -- a real hand does not hold a 10 cm stretch
      // while one finger plays. A sounding finger goes to its exact stop at pose time.
      const ds = [1, 2, 3, 4].filter(f => slots[f] != null).map(f => F.distFromNut(slots[f]) / 1000);
      const lo = Math.min(...ds), hi = Math.max(...ds), c = (lo + hi) / 2;
      const gf = mode === 'neck' ? Math.min(CFG.frameRelax, CFG.frameSpan / Math.max(hi - lo, 1e-6)) : 1;
      const pd = {}, fs = [1, 2, 3, 4].filter(f => slots[f] != null), isA = f => !!(anchors && anchors.includes(f));
      for (const f of fs) pd[f] = c + (F.distFromNut(slots[f]) / 1000 - c) * gf;
      if (fs.some(isA)) { // the relaxed block gathers round the sounding finger(s)
        const an = fs.filter(isA), off = an.reduce((a, f) => a + F.distFromNut(slots[f]) / 1000 - pd[f], 0) / an.length;
        for (const f of fs) pd[f] = isA(f) ? F.distFromNut(slots[f]) / 1000 : pd[f] + off;
      }
      // Two fingertips cannot stand closer than a finger's width: neighbours on one string
      // keep CFG.minGap (high positions' semitones are narrower than a finger). Anchored
      // (sounding) fingers hold their stop; the neighbours give way.
      const gap = (a, b) => strs[a] === strs[b] ? CFG.minGap : 0;
      if (fs.some(isA)) {
        for (let i = 1; i < fs.length; i++) if (!isA(fs[i])) pd[fs[i]] = Math.max(pd[fs[i]], pd[fs[i - 1]] + gap(fs[i], fs[i - 1]));
        for (let i = fs.length - 2; i >= 0; i--) if (!isA(fs[i])) pd[fs[i]] = Math.min(pd[fs[i]], pd[fs[i + 1]] - gap(fs[i], fs[i + 1]));
      } else {
        const m0 = fs.reduce((a, f) => a + pd[f], 0) / fs.length;
        for (let i = 1; i < fs.length; i++) pd[fs[i]] = Math.max(pd[fs[i]], pd[fs[i - 1]] + gap(fs[i], fs[i - 1]));
        const m1 = fs.reduce((a, f) => a + pd[f], 0) / fs.length;
        for (const f of fs) pd[f] += m0 - m1;
      }
      for (let f = 1; f <= 4; f++) {
        if (slots[f] == null) { spec.fingers[f] = spec.exact[f] = null; continue; }
        spec.exact[f] = stopPoint(strs[f], slots[f]);
        spec.fingers[f] = isA(f) ? spec.exact[f] : stopPointD(strs[f], pd[f]);
      }
      spec.key = mode + '|' + [1, 2, 3, 4].map(f => slots[f] + ':' + strs[f]).join(',');
      if (mode === 'neck') {
        const d1 = spec.fingers[1].T[0], d2 = spec.fingers[2].T[0];
        const sMean = [1, 2, 3, 4].reduce((a, f) => a + strs[f], 0) / 4;
        // thumb behind the neck between the 1st and 2nd fingers, a little to the A side; it follows the hand round on the low strings
        spec.thumb = { d: 0.45 * d1 + 0.55 * d2, v: -0.006 + (1.5 - sMean) * 0.002 };
      } else {
        const lo2 = tHi - 1, a1 = stopPoint(tHi, tk), a2 = stopPoint(lo2, tk);
        spec.thumb = { A1: a1.T, N1: a1.N, A2: a2.T, N2: a2.N, span: Math.hypot(...sub(a2.T, a1.T)), hi: tHi, lo: lo2, k: tk };
        spec.key += '|T' + tk + ':' + tHi;
      }
      if (anchors && anchors.length) {
        spec.anchor = {};
        for (const f of anchors) spec.anchor[f] = true;
        spec.key += '|a' + anchors.join('');
      }
      return spec;
    }
    const HOME = { neckPos: 2, neckStr: 2, thumbPos: 12, thumbStr: 3 };
    const closedNeck = (b, s) => makeSpec('neck', { 1: b, 2: b + 1, 3: b + 2, 4: b + 3 }, { 1: s, 2: s, 3: s, 4: s }, null);
    const plainThumb = (t, s) => makeSpec('thumb', { 1: t + 2, 2: t + 3, 3: t + 5, 4: null }, { 1: s, 2: s, 3: s, 4: s }, null, t, Math.max(s, 1));
    function parentSpec(sp) {
      if (sp.anchor) return makeSpec(sp.mode, sp.slots, sp.strs, null, sp.tk, sp.tHi);
      const fs = sp.mode === 'neck' ? [1, 2, 3, 4] : [1, 2, 3];
      const sAll = fs.map(f => sp.strs[f]), uni = sAll.every(x => x === sAll[0]), sR = Math.round(sAll.reduce((a, b) => a + b, 0) / sAll.length);
      if (sp.mode === 'neck') {
        const b = sp.slots[1];
        if (!(uni && fs.every(f => sp.slots[f] === b + f - 1))) return closedNeck(clamp(sp.slots[2] - 1, 1, 12), sR);
        if (sAll[0] !== HOME.neckStr) return closedNeck(b, sAll[0] + Math.sign(HOME.neckStr - sAll[0]));
        return b === HOME.neckPos ? null : closedNeck(b + Math.sign(HOME.neckPos - b), HOME.neckStr);
      }
      const t = sp.tk;
      if (!(uni && sp.slots[1] === t + 2 && sp.slots[2] === t + 3 && sp.slots[3] === t + 5 && sp.tHi === Math.max(sAll[0], 1))) return plainThumb(t, sR);
      if (sAll[0] !== HOME.thumbStr) return plainThumb(t, sAll[0] + 1);
      return t === HOME.thumbPos ? null : plainThumb(t + Math.sign(HOME.thumbPos - t), HOME.thumbStr);
    }
    const FRAME_CACHE = new Map();
    let solveCount = 0, solveMs = 0;
    const now = () => typeof performance !== 'undefined' ? performance.now() : Date.now();
    function frameFor(spec) {
      let q = FRAME_CACHE.get(spec.key);
      if (q) return q;
      const par = parentSpec(spec), warm = par ? frameFor(par) : null;
      const t0 = now();
      q = null;
      if (warm) { // the parent's shape carried to this place
        const s2 = cloneQ(warm);
        const ref = spec.fingers[2] || spec.fingers[1], refW = par.fingers[2] || par.fingers[1];
        s2.w = add(s2.w, sub(ref.T, refW.T));
        q = solveFrame(spec, s2, 40);
      }
      if (!q || q.cost > Math.max(70, 3 * warm.cost)) for (const v of [0, 1]) {
        const c = solveFrame(spec, seedFor(spec, v), 60);
        if (!q || c.cost < q.cost) q = c;
      }
      // polish: exact tangency for every frame finger and the thumb
      for (let f = 1; f <= 4; f++) if (spec.fingers[f]) {
        const ik = fingerIK(f, q.f[f], N2H(q, capTarget(spec.fingers[f], FINGER_R[f][2])));
        q.f[f] = ik.a;
      }
      q.th = q.th.map((v, i) => clamp(v, LIM.thumb[i][0], LIM.thumb[i][1])); // the soft range terms become hard before the seat
      if (spec.mode === 'neck') q.th = thumbSeat(q).th; else q.th = thumbIK(q, spec.thumb).th;
      q.quat = m2q(q.R); q.spec = spec; q.key = spec.key;
      const dbg = {}; residuals(q, spec, dbg); q.diag = { flex: dbg.wa.flex / D2R, dev: dbg.wa.dev / D2R, worst: dbg.worst };
      FRAME_CACHE.set(spec.key, q);
      solveCount++; solveMs += now() - t0;
      return q;
    }

    function planHand(song) {
      const res = song.cello, groups = [];
      song.notes.forEach((n, i) => {
        const r = res.notes[i];
        if (r.mode === 'open') return;
        const g = groups[groups.length - 1];
        if (g && Math.abs(g.t - n[0]) < 1e-4) { g.notes.push({ n, r }); g.end = Math.max(g.end, n[0] + n[1]); }
        else groups.push({ t: n[0], end: n[0] + n[1], mode: r.mode, position: r.position, notes: [{ n, r }] });
      });
      // sticky shapes
      groups.forEach(g => {
        g.back = g.notes.some(x => x.r.ext === 'back');
        const f2 = g.notes.find(x => x.r.finger === 2);
        g.shape2 = g.mode === 'thumb' && f2 ? f2.r.semitone - g.position : null;
      });
      groups.forEach((g, i) => {
        if (g.mode === 'neck') {
          for (const j of [i - 1, i + 1]) {
            const o = groups[j];
            if (o && o.mode === 'neck' && o.position === g.position && Math.abs(o.t - g.t) < 0.6 && o.notes.some(x => x.r.ext === 'fwd')) g.fwdNear = true;
          }
        } else if (g.shape2 == null) {
          let best = null;
          for (let k = 1; k < groups.length && best == null; k++) for (const j of [i - k, i + k]) {
            const o = groups[j];
            if (o && o.mode === 'thumb' && o.position === g.position && o.shape2 != null) { best = o.shape2; break; }
          }
          g.shape2x = best || 3;
        }
      });
      const keys = [];
      for (const g of groups) {
        const slots = {}, strs = {}, played = {};
        for (const { r } of g.notes) played[r.finger] = r;
        // notes still held from earlier onsets belong to this hand shape too
        g.held = [];
        for (let j = groups.indexOf(g) - 1, n = 0; j >= 0 && n < 6; j--, n++) for (const x of groups[j].notes)
          if (x.n[0] + x.n[1] > g.t + 0.03 && groups[j].mode === g.mode && !played[x.r.finger]) { played[x.r.finger] = x.r; g.held.push(x.r); }
        if (g.mode === 'neck') {
          const b = g.position;
          const fits = off => [2, 3, 4].every(f => !played[f] || played[f].semitone === b + off[f - 1]);
          const CL = [0, 1, 2, 3], FW = [0, 2, 3, 4];
          const off = fits(CL) && fits(FW) ? (g.fwdNear ? FW : CL) : fits(CL) ? CL : FW;
          for (let f = 1; f <= 4; f++) slots[f] = b + off[f - 1];
          if (g.back) slots[1] = b - 1;
        } else {
          const t = g.position;
          slots[1] = t + 2; slots[2] = t + (g.shape2 != null ? g.shape2 : g.shape2x); slots[3] = t + 5; slots[4] = null;
        }
        const pf = [1, 2, 3, 4].filter(f => played[f]);
        const anyStr = g.notes[g.notes.length - 1].r.string; // highest-pitch stopped note's string
        for (let f = 1; f <= 4; f++) {
          if (played[f]) { slots[f] = played[f].semitone; strs[f] = played[f].string; continue; }
          let near = null;
          for (const p of pf) if (near == null || Math.abs(p - f) < Math.abs(near - f)) near = p;
          strs[f] = near != null ? played[near].string : anyStr;
        }
        const tHi = g.mode === 'thumb' ? Math.max(played.T ? played.T.string : strs[1], 1) : null;
        const spec = makeSpec(g.mode, slots, strs, null, g.position, tHi);
        g.q = frameFor(spec);
        // A sounding finger must reach its stop from the frame. Where the shared frame
        // cannot give that (wide extensions), the hand takes a frame of its own for
        // these fingers: they are anchored hard and the others give way -- the pivot.
        if (pf.some(f => fingerIK(f, g.q.f[f], N2H(g.q, capTarget(spec.exact[f], FINGER_R[f][2]))).err > 1e-7))
          g.q = frameFor(makeSpec(g.mode, slots, strs, pf, g.position, tHi));
        g.spec = g.q.spec;
        const last = keys[keys.length - 1];
        if (!last || last.q !== g.q) keys.push({ t: g.t, q: g.q, prevEnd: last ? last.lastEnd : -Infinity, prevT: last ? last.lastT : -Infinity });
        keys[keys.length - 1].lastEnd = g.end; keys[keys.length - 1].lastT = g.t;
      }
      // transition leads
      for (let i = 1; i < keys.length; i++) {
        const a = keys[i - 1], b = keys[i];
        const dist = Math.hypot(...sub(a.q.w, b.q.w));
        const base = clamp(0.09 + 1.1 * dist, 0.09, 0.34);
        const silence = b.t - b.prevEnd;
        b.hold = dist < 0.015 ? 1 : dist < 0.04 ? 0.5 : CFG.holdUntil; // small re-balancing: the sounding finger simply stays planted; a real shift lets go over its second half
        b.prevQ = a.q;
        b.lead = Math.max(0.03, Math.min(Math.max(base, Math.min(0.5, silence * 0.85)), (b.t - b.prevT) * 0.9));
      }
      // per-finger "down" intervals: the stopping finger and every lower finger on the same string
      const down = { 1: [], 2: [], 3: [], 4: [] };
      for (const g of groups) for (const { n, r } of g.notes) {
        if (r.finger === 'T') continue;
        for (let f = 1; f <= r.finger; f++) if (g.spec.strs[f] === r.string && g.spec.fingers[f]) {
          const L = down[f], last = L[L.length - 1];
          if (last && n[0] <= last[1] + 0.02) last[1] = Math.max(last[1], n[0] + n[1]); else L.push([n[0], n[0] + n[1]]);
        }
      }
      for (let f = 1; f <= 4; f++) down[f].sort((a, b) => a[0] - b[0]);
      // each finger's own stops, in time order
      const stops = { 1: [], 2: [], 3: [], 4: [], T: [] };
      const qsOf = new Map();
      for (const g of groups) { for (const { r } of g.notes) qsOf.set(r, new Set([g.q])); for (const r of g.held) qsOf.get(r).add(g.q); }
      for (const g of groups) for (const { n, r } of g.notes) stops[r.finger].push({ t0: n[0], t1: n[0] + n[1], r, g, qs: qsOf.get(r), long: n[1] >= 0.8 });
      for (const k in stops) stops[k].sort((a, b) => a.t0 - b.t0);
      // note index -> group
      const noteGroup = new Map();
      for (const g of groups) for (const x of g.notes) noteGroup.set(x.r, g);
      return { keys, down, stops, groups, noteGroup };
    }

    const liftOf = (L, t) => { // 0 = down, 1 = hovering
      let lo = 0, hi = L.length;
      while (lo < hi) { const m = (lo + hi) >> 1; if (L[m][1] < t) lo = m + 1; else hi = m; }
      const nx = L[lo], pv = L[lo - 1];
      if (nx && nx[0] <= t) return 0;
      const a = nx ? (nx[0] - t) / CFG.dropLead : 1, b = pv ? (t - pv[1]) / CFG.liftLag : 1;
      return smooth(Math.min(a, b, 1));
    };

    function poseHand(song, t, sounding) {
      const res = song.cello, H = res.hand || (res.hand = planHand(song));
      const keys = H.keys;
      // frame blend
      let i = 0;
      { let lo = 0, hi = keys.length; while (lo < hi) { const m = (lo + hi) >> 1; if (keys[m].t <= t) lo = m + 1; else hi = m; } i = Math.max(0, lo - 1); }
      const A = keys[i], Bk = keys[i + 1];
      let wRaw = 0;
      if (Bk && t > Bk.t - Bk.lead && t >= A.t) wRaw = clamp((t - (Bk.t - Bk.lead)) / Bk.lead, 0, 1);
      if (t < keys[0].t) wRaw = 0;
      let q = cloneQ(wRaw > 0 ? blendQ(A.q, Bk.q, smooth(wRaw)) : A.q);
      const mode = (wRaw > 0.5 ? Bk.q : A.q).spec.mode;
      if (wRaw > 0 && A.q.spec.mode !== Bk.q.spec.mode) { // changing sides of the neck: swing the hand clear
        const bump = Math.sin(Math.PI * smooth(wRaw));
        q.w[1] -= 0.06 * bump; q.w[2] += 0.03 * bump;
      }
      // Each finger's own stops around t, as weighted pulls onto the exact stop:
      // the note it is on (1), the one it is leaving (fades over liftLag), the one
      // it is approaching (rises over dropLead). Two consecutive stops of the SAME
      // finger hop inside the tail of the first (CFG.hop).
      const frameC = e => {
        const old = e.t1 <= A.t + 1e-9; // a stop that ended before this key period belongs to the hand shape it left
        const inA = !old && e.qs.has(A.q), inB = !old && !!Bk && e.qs.has(Bk.q);
        if (inA) return inB || Bk0.hold >= 1 ? 1 : 1 - smooth((wRaw - Bk0.hold) / (1 - Bk0.hold));
        if (inB) return smooth((wRaw - 0.45) / 0.5);
        return A.hold >= 1 && e.qs.has(A.prevQ) ? 1 : 0;
      };
      const pulls = (L, tt) => {
        let lo = 0, hi = L.length;
        while (lo < hi) { const m = (lo + hi) >> 1; if (L[m].t1 <= tt) lo = m + 1; else hi = m; }
        const first = L[lo], cur = first && first.t0 <= tt ? first : null, nxt = cur ? L[lo + 1] : first, prv = L[lo - 1];
        const out = [];
        // approach of nxt: its own dropLead when the finger is free, else out of the previous stop's tail
        const before = cur || prv;
        let u = 0;
        if (nxt) {
          let start = nxt.t0 - CFG.dropLead;
          if (before && before.t1 > start) start = Math.min(before.t1 - Math.min(CFG.hop, 0.4 * (before.t1 - before.t0)), nxt.t0 - 0.02);
          u = smooth((tt - start) / (nxt.t0 - start));
        }
        if (cur) {
          out.push({ e: cur, w: 1 - u, on: true });
          if (u > 0) out.push({ e: nxt, w: u });
        } else {
          const wn = u;
          const wp = prv ? Math.min(1 - smooth((tt - prv.t1) / CFG.liftLag), 1 - wn) : 0;
          if (wp > 0) out.push({ e: prv, w: wp });
          if (wn > 0) out.push({ e: nxt, w: wn });
        }
        for (const o of out) o.s = o.w * frameC(o.e);
        return out;
      };
      const Bk0 = Bk || { hold: 1 };
      // vibrato only where the finger can follow the hand's sway at both extremes
      const vibOK = (fq, f, r) => {
        const c = fq.vibOK || (fq.vibOK = {}), k = f + ':' + r.string + ':' + r.semitone;
        if (c[k] == null) {
          c[k] = [-1, 1].every(sg => {
            const q2 = { R: fq.R, w: [fq.w[0] + sg * CFG.vibHand, fq.w[1], fq.w[2]] }, tg = stopPoint(r.string, r.semitone);
            tg.T = [tg.T[0] + sg * CFG.vibTip, tg.T[1], tg.T[2]];
            return fingerIK(f, fq.f[f], N2H(q2, capTarget(tg, FINGER_R[f][2]))).err < CFG.contactTol * 0.5;
          });
        }
        return c[k];
      };
      const near = {};
      let vib = 0;
      for (const k of [1, 2, 3, 4, 'T']) {
        const ps = near[k] = pulls(H.stops[k], t), on = ps.find(o => o.on);
        if (k !== 'T' && on && on.s === 1 && on.e.long && t - on.e.t0 > 0.3 && on.e.t1 - t > 0.1 && vibOK(on.e.g.q, k, on.e.r))
          vib = Math.min(1, (t - on.e.t0 - 0.3) / 0.4, (on.e.t1 - 0.1 - t) / 0.2) * Math.sin((t - on.e.t0) * 2 * Math.PI * 5.4);
      }
      if (vib) q.w[0] += CFG.vibHand * vib;
      // fingers: frame shape, lifted when free, drawn onto the exact stop when it is theirs
      const state = {}, contact = {}, target = {};
      for (let f = 1; f <= 4; f++) {
        const L = liftOf(H.down[f], t);
        state[f] = L;
        q.f[f][0] -= CFG.hoverMcp * L; q.f[f][2] = Math.max(LIM.pip[0], q.f[f][2] - CFG.hoverPip * L);
        const base = q.f[f];
        let acc = [0, 0, 0], sw = 0;
        for (const o of near[f]) {
          const tg = stopPoint(o.e.r.string, o.e.r.semitone);
          if (o.on) target[f] = { T: tg.T, N: tg.N }; // reported target: the planned stop itself
          if (vib) tg.T = [tg.T[0] + CFG.vibTip * vib, tg.T[1], tg.T[2]];
          if (o.s <= 0) continue;
          const ik = fingerIK(f, base, N2H(q, capTarget(tg, FINGER_R[f][2])));
          for (let k = 0; k < 3; k++) acc[k] += o.s * ik.a[k];
          sw += o.s;
          if (o.on && o.s >= 1) contact[f] = ik.err < CFG.contactTol;
        }
        if (sw > 0) q.f[f] = base.map((v, k) => v * (1 - sw) + acc[k]);
        // no fingertip in the wood: a tip that an in-between pose would sink is raised from the knuckle
        if (!contact[f]) {
          const depth = a0 => { const k = fingerFK(f, a0, q.f[f][1], q.f[f][2]), v = mv(q.R, k.C); return sdInst([q.w[0] + v[0], q.w[1] + v[1], q.w[2] + v[2]]) - k.r + CFG.press; };
          for (let it = 0; it < 6; it++) {
            const sd = depth(q.f[f][0]);
            if (sd >= -1e-5) break;
            const g = (depth(q.f[f][0] - 1e-3) - sd) / 1e-3; // clearance gained per radian of MCP opening
            q.f[f][0] -= Math.min(0.12, -sd / Math.max(g, 0.03));
          }
        }
      }
      // thumb
      let thumbContact = false, thumbTarget = null;
      const modeChange = wRaw > 0 && A.q.spec.mode !== Bk.q.spec.mode;
      if (mode === 'neck') { if (!modeChange) { const ts = thumbSeat(q); q.th = ts.th; thumbContact = ts.err < CFG.contactTol; } }
      else if (!modeChange) {
        // The thumb stays on its string and slides with the hand: its seat is the
        // frame's (blended through a shift), pulled onto the exact stop when it sounds.
        const spA = A.q.spec.thumb, spB = wRaw > 0 ? Bk.q.spec.thumb : spA, u = smooth(wRaw);
        const base0 = 0.22 * TL[2];
        const seat = hiSide => {
          const pa = hiSide ? spA.A1 : spA.A2, pb = hiSide ? spB.A1 : spB.A2, na = hiSide ? spA.N1 : spA.N2, nb = hiSide ? spB.N1 : spB.N2;
          return { A1: lerp(pa, pb, u), N1: norm(lerp(na, nb, u)) };
        };
        const on = near.T.find(o => o.on);
        let sT = 0, wLo = 0, mixT = [0, 0, 0], mixN = [0, 0, 0];
        for (const o of near.T) {
          if (o.s <= 0) continue;
          const a1 = stopPoint(o.e.r.string, o.e.r.semitone), lo = o.e.r.string !== o.e.g.q.spec.thumb.hi;
          if (o.on) thumbTarget = a1;
          sT += o.s; if (lo) wLo += o.s;
          for (let k = 0; k < 3; k++) { mixT[k] += o.s * a1.T[k]; mixN[k] += o.s * a1.N[k]; }
        }
        const sHi = seat(true), sLo = seat(false), span = spA.span + (spB.span - spA.span) * u;
        let th = { A1: lerp(sHi.A1, sLo.A1, wLo), N1: norm(lerp(sHi.N1, sLo.N1, wLo)), along: base0 + span * wLo };
        if (sT > 0) th = { A1: lerp(th.A1, mul(mixT, 1 / sT), Math.min(1, sT)), N1: norm(lerp(th.N1, mul(mixN, 1 / sT), Math.min(1, sT))), along: th.along };
        const ik = thumbIK(q, th); q.th = ik.th;
        thumbContact = ik.err < CFG.contactTol && (!on || on.s >= 1);
      }
      // world
      const R = q.R, W = q.w, H2W = p => { const v = mv(R, p); return toWorld([W[0] + v[0], W[1] + v[1], W[2] + v[2]]); };
      const fingers = {};
      for (let f = 1; f <= 4; f++) {
        const k = fingerFK(f, q.f[f][0], q.f[f][1], q.f[f][2]);
        const tg = target[f];
        const cap = H2W(k.C);
        fingers[f] = {
          points: k.pts.map(H2W), cap, capR: k.r, contact: !!contact[f],
          target: tg ? toWorld(tg.T) : null,
          contactPt: tg ? sub(cap, mul(dirWorld(tg.N), k.r - CFG.press)) : null,
          lift: state[f], angles: { mcp: q.f[f][0] / D2R, abd: q.f[f][1] / D2R, pip: q.f[f][2] / D2R, dip: DIPK * q.f[f][2] / D2R },
          metacarpal: [H2W(MC_BASE[f]), H2W(ROOT[f])]
        };
        if (!tg) { // hovering/resting fingers report the slot under them (not a contact claim)
          const sp = (wRaw > 0.5 ? Bk.q : A.q).spec.fingers[f];
          fingers[f].slot = sp ? toWorld(sp.T) : null;
        }
      }
      const tk = thumbFK(q.th[0], q.th[1], q.th[2], q.th[3], q.th[4]);
      const wa = wristAngles(q);
      const X = dirWorld(col(R, 0)), Y = dirWorld(col(R, 1)), Z = dirWorld(col(R, 2));
      const cur = (wRaw > 0.5 ? Bk.q : A.q);
      return {
        leftArm: { shoulder: SHOULDER_L, elbow: wa.E, wrist: wa.Ww },
        fingers,
        thumb: {
          points: tk.pts.map(H2W), cap: H2W(tk.C), capR: tk.r, seatR: mode === 'thumb' ? seatR() : tk.r, contact: thumbContact,
          target: thumbTarget ? toWorld(thumbTarget.T) : null,
          stringPt: H2W(add(tk.pts[2], mul(tk.d3, 0.22 * TL[2]))),
          angles: q.th.map(v => v / D2R)
        },
        hand: {
          model: 'natural', mode, lambda: mode === 'thumb' ? 1 : 0, wrist: wa.Ww, anchor: wa.Ww,
          frame: { x: X, y: Y, z: Z }, backNormal: Z, frameKey: cur.key, blend: wRaw, vib,
          wristFlex: wa.flex / D2R, wristDev: wa.dev / D2R, pronation: wa.pron, swivel: q.sw / D2R,
          thumbBase: H2W(THUMB_BASE), thumbRoot: H2W(THUMB_BASE), masses: massesOf(H2W, X, Y, Z, tk)
        }
      };
    }

    // Palm masses for drawing: the foundation's shaped ellipsoids ride
    // the hand frame; the thenar eminence rides the thumb metacarpal.
    function massesOf(H2W, X, Y, Z, tk) {
      const eul = eulerZYX(X, Y, Z);
      const mass = m => ({ centre: H2W(m.centre), radii: [...m.radii], euler: eul });
      const b = H2W(tk.pts[0]), m1 = H2W(tk.pts[1]), ty = norm(sub(m1, b));
      let tz = sub(Z, mul(ty, dot(Z, ty))); tz = Math.hypot(...tz) > 1e-6 ? norm(tz) : X;
      const tx = cross(ty, tz);
      return {
        carpus: mass(CARPUS_R), palm: mass(PLATE), pad: mass(KNUCKLE_PAD), hypothenar: mass(HYPOTHENAR),
        thenar: { centre: lerp(H2W(THENAR.centre), lerp(b, m1, 0.45), 0.6), radii: [THENAR.radii[0] * 0.9, THENAR.radii[1], THENAR.radii[2] * 1.05], euler: eulerZYX(tx, ty, tz) },
        web: [lerp(b, m1, 0.72), H2W(lerp(MC_BASE[1], ROOT[1], 0.5))]
      };
    }

    // The hand alone (canonical frame, wrist at the origin): fully
    // extended, and the relaxed cascade -- for the open-hand renders.
    function openHand(kind) {
      const rest = kind === 'rest';
      const fingers = {};
      for (let f = 1; f <= 4; f++) {
        const a = rest ? [REST_CURL[f][0] * D2R, 0, REST_CURL[f][1] * D2R] : [0, 0, 0];
        const k = fingerFK(f, a[0], a[1], a[2]);
        fingers[f] = { points: k.pts, cap: k.C, capR: k.r, metacarpal: [MC_BASE[f], ROOT[f]] };
      }
      const tk = rest ? thumbFK(30 * D2R, 22 * D2R, 60 * D2R, 12 * D2R, 10 * D2R) : thumbFK(34 * D2R, 20 * D2R, 60 * D2R, 0, 0);
      const id = p => p;
      return { fingers, thumb: { points: tk.pts, cap: tk.C, capR: tk.r }, hand: { model: 'natural', frame: { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }, masses: massesOf(id, [1, 0, 0], [0, 1, 0], [0, 0, 1], tk), wrist: [0, 0, 0] } };
    }

    return {
      _ikErr: (q, f) => { const ik = fingerIK(f, q.f[f], N2H(q, capTarget(q.spec.exact[f], FINGER_R[f][2]))); return ik.err; },
      THUMB_LEN: TL, ROOT, YAW,
      CFG, LIM, PRIOR, WRIST, DIPK, residuals, solveFrame, seedFor, planHand, poseHand, openHand, fingerFK, thumbFK, sdInst, sdBody, stopPoint, stopPointD, toNeck, toWorld, FRAME_CACHE,
      stats: () => ({ frames: FRAME_CACHE.size, solves: solveCount, ms: solveMs })
    };
  })();

  function withBowHand(p) {
    const axis = sub(p.bow.stickTip, p.bow.stickFrog);
    const bowHand = window.BowHand.create('cello', p.bow.stickFrog, axis, M.n);
    return { ...p, bowHand, rightArm: { ...p.rightArm, wrist: bowHand.wrist,
      elbow: solveElbow(p.rightArm.shoulder, bowHand.wrist, [-0.55, -1, 0.15]) } };
  }

  let HAND_SOLVER = 'natural';
  const setHandSolver = s => { HAND_SOLVER = s === 'legacy' ? 'legacy' : 'natural'; return HAND_SOLVER; };

  function pose(song, t) {
    if (HAND_SOLVER === 'legacy') return withBowHand(poseLegacy(song, t));
    if (!song.cello) plan(song);
    const res = song.cello, tr = res.tracks;
    const { sounding } = activeAt(song, t);
    const L = NH.poseHand(song, t, sounding);
    // Bow + right arm + sway: unchanged from the legacy pose.
    const bowF = 0.5 + (tr.bow(t) - 0.5) * 0.66;
    const sFloat = tr.string(t);
    const s0 = clamp(Math.floor(sFloat), 0, 3), s1 = clamp(s0 + 1, 0, 3), sf = sFloat - s0;
    const contact = lerp(M.bowContact(s0), M.bowContact(s1), sf);
    const dir = norm(lerp(M.bowDir(s0), M.bowDir(s1), sf));
    const frog = sub(contact, mul(dir, bowF * M.BOW_LENGTH));
    const tip = add(contact, mul(dir, (1 - bowF) * M.BOW_LENGTH));
    const stickFrog = add(frog, mul(M.n, 0.020)), stickTip = add(tip, mul(M.n, 0.020));
    const wristR = add(stickFrog, add(mul(dir, -0.010), [0, 0.012, 0]));
    const elbowR = solveElbow(SHOULDER_R, wristR, [-0.55, -1, 0.15]);
    const sway = {
      lean: 0.035 + 0.012 * Math.sin(t * 0.45),
      turn: 0.05 * Math.sin(t * 0.23 + 1.2),
      breath: 0.006 * Math.sin(t * 2 * Math.PI * 0.22)
    };
    return withBowHand({
      leftArm: L.leftArm,
      rightArm: { shoulder: SHOULDER_R, elbow: elbowR, wrist: wristR },
      fingers: L.fingers, thumb: L.thumb,
      bow: { frog, tip, contact, string: sFloat, frac: bowF, stickFrog, stickTip },
      hand: L.hand, sway,
      sounding: sounding.map(({ r }) => r.string)
    });
  }

  // ---- pose cache -------------------------------------------------
  // The natural solver is pure for (song, t), but a browser render loop
  // should not repeat its active-note scan, pull tracks and four IK solves
  // at 60 Hz.  The generated cache stores a compact, Float32-rounded
  // snapshot stream.  It is deliberately keyed by solver name: loading a
  // natural cache can never silently change the legacy comparison path.
  const cacheTree = v => {
    if (typeof v === 'number') return 'n';
    if (typeof v === 'boolean') return 'b';
    if (typeof v === 'string') return ['s'];
    if (v === null) return ['z'];
    if (Array.isArray(v)) return ['a', v.length, v.map(cacheTree)];
    return ['o', Object.keys(v), Object.keys(v).map(k => cacheTree(v[k]))];
  };
  const cacheFlat = (schema, v, n, s) => {
    if (schema === 'n') { n.push(Math.fround(v)); return; }
    if (schema === 'b') { n.push(v ? 1 : 0); return; }
    if (schema[0] === 's') { s.push(v); return; }
    if (schema[0] === 'z') return;
    if (schema[0] === 'a') { for (let i = 0; i < schema[1]; i++) cacheFlat(schema[2][i], v[i], n, s); return; }
    for (let i = 0; i < schema[1].length; i++) cacheFlat(schema[2][i], v[schema[1][i]], n, s);
  };
  const cacheUnflat = (schema, n, s, ni, si) => {
    if (schema === 'n') return n[ni.i++];
    if (schema === 'b') return n[ni.i++] >= 0.5;
    if (schema[0] === 's') return s[si.i++];
    if (schema[0] === 'z') return null;
    if (schema[0] === 'a') { const a = []; for (let i = 0; i < schema[1]; i++) a.push(cacheUnflat(schema[2][i], n, s, ni, si)); return a; }
    const o = {}; for (let i = 0; i < schema[1].length; i++) o[schema[1][i]] = cacheUnflat(schema[2][i], n, s, ni, si); return o;
  };
  const point = (p, on = true) => ({ on, p: p ? [...p] : [0, 0, 0] });
  const mass = m => ({ centre: [...m.centre], radii: [...m.radii], euler: [...m.euler] });
  // Canonicalization removes nullable fields and variable-length sounding
  // arrays so every frame has exactly one numeric vector/schema.
  const cacheView = p => {
    const finger = f => ({ points: f.points, cap: f.cap, capR: f.capR, contact: f.contact,
      target: point(f.target, !!f.target), contactPt: point(f.contactPt, !!f.contactPt), lift: f.lift,
      angles: f.angles, metacarpal: f.metacarpal, slot: point(f.slot, !!f.slot) });
    const masses = p.hand.masses;
    return {
      leftArm: p.leftArm, rightArm: p.rightArm,
      fingers: [1, 2, 3, 4].map(f => finger(p.fingers[f])),
      thumb: { points: p.thumb.points, cap: p.thumb.cap, capR: p.thumb.capR, seatR: p.thumb.seatR,
        contact: p.thumb.contact, target: point(p.thumb.target, !!p.thumb.target), stringPt: p.thumb.stringPt, angles: p.thumb.angles },
      bow: p.bow, hand: { model: p.hand.model, mode: p.hand.mode, lambda: p.hand.lambda, wrist: p.hand.wrist,
        anchor: p.hand.anchor, frame: p.hand.frame, backNormal: p.hand.backNormal, frameKey: p.hand.frameKey,
        blend: p.hand.blend, vib: p.hand.vib, wristFlex: p.hand.wristFlex, wristDev: p.hand.wristDev,
        pronation: p.hand.pronation, swivel: p.hand.swivel, thumbBase: p.hand.thumbBase, thumbRoot: p.hand.thumbRoot,
        masses: { carpus: mass(masses.carpus), palm: mass(masses.palm), pad: mass(masses.pad), hypothenar: mass(masses.hypothenar),
          thenar: mass(masses.thenar), web: masses.web } },
      sway: p.sway, sounding: { count: p.sounding.length, values: [...p.sounding, 0, 0, 0, 0].slice(0, 4) }
    };
  };
  const cachePose = v => {
    const fingers = {}; const finger = f => ({ points: f.points, cap: f.cap, capR: f.capR, contact: f.contact,
      target: f.target.on ? f.target.p : null, contactPt: f.contactPt.on ? f.contactPt.p : null, lift: f.lift,
      angles: f.angles, metacarpal: f.metacarpal, slot: f.slot.on ? f.slot.p : null });
    for (let i = 0; i < 4; i++) fingers[i + 1] = finger(v.fingers[i]);
    const masses = v.hand.masses, mm = m => ({ centre: m.centre, radii: m.radii, euler: m.euler });
    return { leftArm: v.leftArm, rightArm: v.rightArm, fingers, thumb: { ...v.thumb, target: v.thumb.target.on ? v.thumb.target.p : null }, bow: v.bow,
      hand: { ...v.hand, masses: { carpus: mm(masses.carpus), palm: mm(masses.palm), pad: mm(masses.pad), hypothenar: mm(masses.hypothenar), thenar: mm(masses.thenar), web: masses.web } },
      sway: v.sway, sounding: v.sounding.values.slice(0, v.sounding.count) };
  };
  const packPose = p => { const view = cacheView(p), schema = cacheTree(view), n = [], s = []; cacheFlat(schema, view, n, s); return { schema, frame: { n, s } }; };
  let POSE_CACHE = null;
  const setPoseCache = cache => { POSE_CACHE = cache && cache.version === 1 ? cache : null; return !!POSE_CACHE; };
  const cacheData = entry => {
    if (entry._numbers) return entry._numbers;
    let bin = '';
    if (typeof atob === 'function') bin = atob(entry.data);
    else if (typeof Buffer !== 'undefined') bin = Buffer.from(entry.data, 'base64').toString('binary');
    else return null;
    const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return entry._numbers = new Float32Array(bytes.buffer);
  };
  const poseCached = (song, t) => {
    const entry = POSE_CACHE && POSE_CACHE.solvers && POSE_CACHE.solvers[HAND_SOLVER] && POSE_CACHE.solvers[HAND_SOLVER][song.id];
    if (!entry || !entry.data || !entry.frames) return null;
    const data = cacheData(entry); if (!data) return null;
    const x = clamp(t, 0, entry.duration), q = x / entry.step, i = Math.min(entry.frames - 1, Math.floor(q)), j = Math.min(entry.frames - 1, i + 1), u = Math.min(1, q - i);
    const a0 = i * entry.width, b0 = j * entry.width, n = new Array(entry.width);
    for (let k = 0; k < entry.width; k++) n[k] = Math.fround(data[a0 + k] + (data[b0 + k] - data[a0 + k]) * u);
    return withBowHand(cachePose(cacheUnflat(entry.schema, n, u < 0.5 ? entry.strings[i] : entry.strings[j], { i: 0 }, { i: 0 })));
  };

  // ---- drawing ----
  const SKIN = [0.76, 0.57, 0.45], SKIN_L = [0.82, 0.64, 0.51], SUIT = [0.050, 0.052, 0.064],
    SHIRT = [0.85, 0.84, 0.81], HAIR = [0.075, 0.058, 0.05], WOOD = [0.16, 0.10, 0.06],
    LASH = [0.20, 0.12, 0.10], LIP1 = [0.62, 0.38, 0.33], LIP2 = [0.70, 0.48, 0.40];

  function drawFigure(R, p) {
    // Chair + legs (seated, knees spread around the cello).
    R.box([0, 0.445, 0.14], [0.47, 0.045, 0.44], WOOD);
    R.box([0, 0.70, 0.35], [0.47, 0.55, 0.04], WOOD);
    for (const sx of [-1, 1]) {
      R.segment([sx * 0.20, 0.44, 0.30], [sx * 0.20, 0.0, 0.30], 0.02, WOOD, 'limb');
      const hip = [sx * 0.105, 0.53, 0.10], knee = [sx * 0.225, 0.475, -0.315], ankle = [sx * 0.235, 0.045, -0.20];
      R.segment(hip, knee, 0.062, SUIT, 'limb');
      R.segment(knee, ankle, 0.047, SUIT, 'limb');
      R.piece('shoe', add(ankle, [0, -0.012, -0.045]), [0.075, 0.045, 0.145], [0.02, 0.02, 0.025]);
    }
    // Torso, head.
    const lean = p.sway.lean;
    R.piece('jacket', [0, 0.875, 0.085], [0.185, 0.30, 0.135], SUIT, lean, 0, -p.sway.turn); // z-turn negated: planning frame is X-mirrored
    // The head loft's face is its local +Z, and the player faces -Z
    // (toward the audience): without the PI yaw the face pointed at
    // the chair back. With it, the 0.38 X-tilt reads as a downward
    // glance toward the fingerboard.
    const headC = [-0.012, 1.315 + p.sway.breath, 0.045], HX = 0.38, HY = Math.PI, HZ = 0.06;
    R.setFaceDetail?.(true);
R.piece('head', headC, [0.105, 0.125, 0.112], SKIN, HX, HY, HZ);
    R.piece('hair', [-0.016, 1.345 + p.sway.breath, 0.062], [0.108, 0.122, 0.115], HAIR, 0.30, Math.PI, 0.06);
    // Face, mirroring the pianist's construction (demos-pianist
    // app.js): the same nose loft piece, two-segment lowered-lid
    // lash lines, hair-colour brows, joint-loft ears and two lip
    // segments, at the pianist's head-local offsets scaled by the
    // head-radii ratio ([.105,.125,.112] / [.112,.148,.128]).
    // headPoint applies the head's own Rz*Ry*Rx frame, so the
    // features ride the animated head on its true front (+Z local).
    const headPoint = q => {
      const cx = Math.cos(HX), sx = Math.sin(HX), cy = Math.cos(HY), sy = Math.sin(HY), cz = Math.cos(HZ), sz = Math.sin(HZ);
      const y1 = q[1] * cx - q[2] * sx, z1 = q[1] * sx + q[2] * cx;
      const x2 = q[0] * cy + z1 * sy, z2 = -q[0] * sy + z1 * cy;
      return [headC[0] + x2 * cz - y1 * sz, headC[1] + x2 * sz + y1 * cz, headC[2] + z2];
    };
    R.piece('nose', headPoint([0, -0.0101, 0.1068]), [0.015, 0.0287, 0.0175], SKIN_L, HX, HY, HZ);
    for (const s of [-1, 1]) {
      const ex = s * 0.0375, lid = 0.0101;
      R.segment(headPoint([ex - 0.0159, lid + 0.0017, 0.0989]), headPoint([ex, lid - 0.0025, 0.105]), 0.002, LASH);
      R.segment(headPoint([ex, lid - 0.0025, 0.105]), headPoint([ex + 0.0159, lid + 0.0008, 0.0998]), 0.002, LASH);
      R.segment(headPoint([ex - 0.0188, 0.0338, 0.1033]), headPoint([ex + 0.0169, 0.0363, 0.1033]), 0.0028, HAIR);
      R.piece('joint', headPoint([s * 0.1022, -0.0068, -0.007]), [0.0113, 0.0253, 0.0193], SKIN, HX, HY, HZ);
    }
    R.segment(headPoint([-0.0188, -0.0625, 0.0989]), headPoint([0.0188, -0.0625, 0.0989]), 0.0037, LIP1);
    R.segment(headPoint([-0.0113, -0.0701, 0.0963]), headPoint([0.0113, -0.0701, 0.0963]), 0.0031, LIP2);
R.setFaceDetail?.(false);
    // Arms. Both forearms end at their wrist joints; only the
    // right keeps a wrist ball (the bow hand's mass) -- the left
    // wrist is the palm assembly's proximal end, drawn below.
    // PART OVERLAP (rk, phase 2, DRAWING ONLY -- no pose data
    // changes): the loft profiles taper to 0.35-0.62 of the
    // segment radius at their ends, so bare end-to-end segments
    // neck visibly at every joint. Segments are therefore drawn
    // extended past their joint points into the neighbouring
    // part (10-12 mm on the arms), and a ball of ~the adjoining
    // radius sits on the joint itself, so the surface reads
    // continuous. The same treatment runs on the finger/thumb
    // chains below (extensions 0.22x segment length; joint balls
    // sized by the no-bulge rule there, see drawChain).
    for (const [arm, sleeve] of [[p.leftArm, SUIT], [p.rightArm, SUIT]]) {
      const dUE = norm(sub(arm.elbow, arm.shoulder)), dEF = norm(sub(arm.wrist, arm.elbow));
      R.segment(arm.shoulder, add(arm.elbow, mul(dUE, 0.012)), 0.047, sleeve, 'limb');
      if (arm === p.leftArm && p.hand.model === 'natural') {
        // the sleeve stops short of the wrist; the bare wrist narrows into the carpus
        R.segment(sub(arm.elbow, mul(dEF, 0.012)), sub(arm.wrist, mul(dEF, 0.030)), 0.038, sleeve, 'limb');
        R.segment(sub(arm.wrist, mul(dEF, 0.075)), add(arm.wrist, mul(dEF, 0.006)), 0.0265, SKIN, 'limb');
      } else
      R.segment(sub(arm.elbow, mul(dEF, 0.012)), add(arm.wrist, mul(dEF, 0.012)), 0.038, sleeve, 'limb');
      R.ball(arm.elbow, [0.046, 0.046, 0.046], sleeve);
      R.ball(arm.shoulder, [0.050, 0.050, 0.050], sleeve);
    }
    // Left hand, one assembly (see pose()): carpus at the wrist
    // joint, the palm's shaped masses spanning wrist -> knuckle
    // row, the thenar eminence at the thumb's base, then the
    // fingers and thumb chained out of the row / thenar corner.
    // Drawn before the fingers so the chains emerge from the
    // masses' knuckle edge.
    if (p.hand.model === 'natural') { drawNaturalHand(R, p); drawBowHand(R, p); return; }
    const pm = p.hand.palm, cp = p.hand.carpus;
    // The carpus is drawn 1.15x its pose radii so the wrist/palm
    // junction blends into the forearm's extended end (the pose
    // radii stay the anatomical ones the tests measure).
    R.piece('joint', cp.centre, cp.radii.map(r => r * 1.15), SKIN, cp.euler[0], cp.euler[1], cp.euler[2]);
    // The palm is the foundation's shaped masses (Stage 2):
    // plate, knuckle pad, hypothenar eminence -- one 'joint'
    // piece each, at the pose masses.
    R.piece('joint', pm.centre, pm.radii, SKIN, pm.euler[0], pm.euler[1], pm.euler[2]);
    const pd = p.hand.pad, hy = p.hand.hypothenar;
    R.piece('joint', pd.centre, pd.radii, SKIN, pd.euler[0], pd.euler[1], pd.euler[2]);
    R.piece('joint', hy.centre, hy.radii, SKIN, hy.euler[0], hy.euler[1], hy.euler[2]);
    // Thenar eminence: ONE lofted mass flowing from the
    // wrist/carpus into the thumb metacarpal (rk 2026-11-08:
    // the old capsule + root ball read as two balls stuck on
    // the wrist). No capsule, no ball at the thumb base.
    const th = p.hand.thenar;
    R.piece('joint', th.centre, th.radii, SKIN, th.euler[0], th.euler[1], th.euler[2]);
    // Left fingers + thumb, per-finger radii, with the part-
    // overlap treatment: each segment drawn extended past its
    // distal joint (0.22x its length; the fingertip segment is
    // NOT extended -- nothing may poke past the contact point)
    // and seated 0.18-0.22x into the proximal part. Continuity
    // comes from that overlap, NOT from ball size (rk: the 1.08x
    // joint balls / 1.05x knuckle balls of the first overlap
    // pass protruded past the segment capsules and read as
    // beads -- deko-boko). NO-BULGE RULE for every ball on a
    // chain: its radius stays at the local segment radius --
    // the plain mean of the two adjoining radii at an inner
    // joint -- so the joint width always lies BETWEEN its
    // neighbours' widths and the
    // silhouette tapers monotonically instead of beading. The
    // segments use the 'limb' loft, not 'joint': the 'joint'
    // profile pinches to 0.75x at its ends and 0.35x at the
    // tips, so each phalanx swelled mid-segment and pinched at
    // the joints (a pill shape) however the balls were sized,
    // while 'limb' holds the full radius across the middle 70%
    // of the drawn length -- with the 0.22x extensions, that
    // plateau covers the whole anatomical span and the taper
    // hides inside the neighbouring part. There is NO knuckle
    // ball: a sphere at a root reaches its full radius along
    // the palm's normal too, so it stood up to ~5 mm proud of
    // the flat palm plate as a marble on the back of the hand,
    // where the segment tube itself (a disc across the finger
    // axis) reaches only ~1-2 mm past the plate. Segment 0
    // instead seats into the plate, so the tube's own
    // plateau forms the knuckle as it emerges. Segment 0 is
    // drawn in two pieces for the fingers: a root piece at
    // 0.74x radius from an 0.18x seat inside the plate to
    // 0.45x along the segment, underneath the full-radius
    // piece. A full-diameter tube (26-28 mm) is as thick as
    // the palm plate itself (28 mm), so wherever a root sits
    // off the plate's mid-plane the plain tube crested the
    // plate's back as a round dome (measured worst: finger 3
    // in thumb position); the thinned root stays under the
    // plate surface while the full piece flares out of it
    // over ~2 mm, so the finger reads as emerging from the
    // hand rather than beaded onto it. (The thumb's root sits
    // in the thenar mass, not over the plate -- single piece.)
    const drawChain = (pts, radii, colOf, rootThin) => {
      for (let j = 0; j < 3; j++) {
        const a = pts[j], b = pts[j + 1], d = sub(b, a), L = Math.hypot(...d) || 1e-9, dir = mul(d, 1 / L);
        const extA = (j === 0 ? 0.18 : 0.22) * L, extB = j === 2 ? 0 : 0.22 * L;
        if (j === 2) {
          // NO FINGERTIP BALL (rk 2026-11-08): the foundation's
          // 0.74x taper + tangent ball read as a screw-on cap
          // perched on the fingertip, and rk ruled the ball
          // unnecessary. The distal segment now runs at full
          // radius straight to the tip point and the 'limb'
          // loft's own end taper (1 -> 0.62 -> 0.25 over its
          // last stations) closes it round. The tip point is
          // the chain end -- contact is centreline-based and
          // does not move; no sphere is added at any tip.
          R.segment(sub(a, mul(dir, extA)), b, radii[2], colOf(2), 'limb');
          continue;
        }
        if (j === 0 && rootThin)
          R.segment(sub(a, mul(dir, extA)), add(a, mul(dir, 0.45 * L)), radii[0] * 0.74, colOf(0), 'limb');
        R.segment(sub(a, mul(dir, j === 0 && rootThin ? -0.15 * L : extA)), add(b, mul(dir, extB)), radii[j], colOf(j), 'limb');
        if (j < 2) { const rB = (radii[j] + radii[j + 1]) / 2; R.ball(b, [rB, rB, rB], colOf(j + 1)); }
      }
    };
    for (let f = 1; f <= 4; f++)
      drawChain(p.fingers[f].points, FINGER_R[f], j => j === 2 ? SKIN_L : SKIN, true);
    drawChain(p.thumb.points, THUMB_R, () => SKIN, false); // the thumb's root sits in the thenar eminence drawn above -- no root ball
    drawBowHand(R, p);
  }
  function drawBowHand(R, p) {
    window.BowHand.draw(R, p.bowHand, SKIN, SKIN_L);
  }

  // The natural hand's skin: palm masses in the hand frame, thenar on
  // the thumb metacarpal, chains as overlapped 'limb' lofts. The
  // distal phalanx ends in a ball of its own radius centred on the
  // tip cap -- the very sphere the solver lays tangent to the board,
  // so what touches in the pose touches on screen.
  function drawNaturalHand(R, p, colOf) {
    const ms = p.hand.masses, skin = colOf || (() => SKIN), tipCol = colOf ? colOf : (() => SKIN_L);
    R.piece('joint', ms.carpus.centre, ms.carpus.radii.map(r => r * 1.15), skin('palm'), ...ms.carpus.euler);
    for (const k of ['palm', 'pad', 'hypothenar', 'thenar']) R.piece('joint', ms[k].centre, ms[k].radii, skin('palm'), ...ms[k].euler);
    R.segment(ms.web[0], ms.web[1], 0.0055, skin('palm'), 'joint'); // the web between thumb and index
    const chain = (c, radii, rootThin, key) => {
      const pts = c.points;
      for (let j = 0; j < 3; j++) {
        const a = pts[j], b = pts[j + 1], d = sub(b, a), L = Math.hypot(...d) || 1e-9, dir = mul(d, 1 / L);
        if (j === 2) {
          R.segment(sub(a, mul(dir, 0.22 * L)), add(c.cap, mul(dir, c.capR * 0.25)), radii[2], tipCol(key), 'limb');
          R.ball(c.cap, [c.capR, c.capR, c.capR], tipCol(key));
          continue;
        }
        if (j === 0 && rootThin) R.segment(sub(a, mul(dir, 0.18 * L)), add(a, mul(dir, 0.45 * L)), radii[0] * 0.74, skin(key), 'limb');
        R.segment(sub(a, mul(dir, j === 0 && rootThin ? -0.15 * L : 0.2 * L)), add(b, mul(dir, 0.22 * L)), radii[j], skin(key), 'limb');
        const rB = (radii[j] + radii[j + 1]) / 2; R.ball(b, [rB, rB, rB], skin(key));
      }
    };
    for (let f = 1; f <= 4; f++) chain(p.fingers[f], FINGER_R[f], true, f);
    chain(p.thumb, THUMB_R, false, 'T');
  }

  function draw(R, song, t, opts = {}) {
    const p = poseCached(song, t) || pose(song, t);
    M.drawCello(R, { hotString: p.sounding.length ? p.sounding[0] : -1 });
    M.drawBow(R, clamp(Math.round(p.bow.string), 0, 3), p.bow.frac, p.bow);
    drawFigure(R, p);
    return p;
  }

  // ---- Canonical REST assembly (foundation, 2026-11-08) ----
  // The hand alone, built ONLY from the rest skeleton above in
  // the canonical palm frame (wrist joint at the origin, X =
  // index -> little, Y = distal, Z = dorsal): CMC bases on
  // their carpal arc, metacarpals at their rest directions,
  // knuckle roots derived, chains laid on the metacarpals.
  // Two chain sets: EXTENDED (every joint at 0 deg -- the
  // diagnostic rk asked for; comparable 1:1 with the pre-
  // foundation renders) and REST (the natural cascade of
  // REST_CURL, each finger folding in its own fan-yawed flexion
  // plane toward the palm side of its bone frame; the thumb
  // folding across the palm in its rolled CMC frame). The
  // diagnostic page (tools/hand-open.html) and geometry
  // section 8a-rest both consume THIS builder, so what is
  // rendered and what is asserted is the shipped skeleton.
  const restHand = () => {
    const pX = [1, 0, 0], pY = [0, 1, 0], pZ = [0, 0, 1];
    const rotAbout = (v, ax, th) => {
      const c = Math.cos(th), s = Math.sin(th);
      return norm(add(add(mul(v, c), mul(M.vec.cross(ax, v), s)), mul(ax, dot(ax, v) * (1 - c))));
    };
    const chainFrom = (root, dir0, lens, axisOf, angsDeg) => {
      const pts = [root];
      let p = root, d = dir0;
      for (let j = 0; j < lens.length; j++) {
        if (angsDeg[j]) d = rotAbout(d, axisOf(d), angsDeg[j] * Math.PI / 180);
        p = add(p, mul(d, lens[j])); pts.push(p);
      }
      return pts;
    };
    const bases = {}, meta = {}, boneZ = {}, roots = {}, fingersExt = {}, fingersRest = {};
    for (let f = 1; f <= 4; f++) {
      bases[f] = [...MC_BASE[f]];
      meta[f] = mcDir(f);
      roots[f] = mcRoot(f);
      let z = sub(pZ, mul(meta[f], dot(pZ, meta[f])));
      z = norm(z);
      const psi = (BONE.fanYawBase + BONE.fanYawSpread * (f - 2)) * Math.PI / 180;
      if (psi) z = rotAbout(z, meta[f], psi);
      boneZ[f] = z;
      const axisOf = d => norm(M.vec.cross(z, d)); // flexion rotates the ray toward -boneZ (the palm side)
      fingersExt[f] = chainFrom(roots[f], meta[f], FINGER_LEN[f], axisOf, [0, 0, 0]);
      fingersRest[f] = chainFrom(roots[f], meta[f], FINGER_LEN[f], axisOf, REST_CURL[f]);
    }
    const eul = eulerZYX(pX, pY, pZ);
    const mass = m => ({ centre: [...m.centre], radii: [...m.radii], euler: eul });
    // Thumb: straight along THUMB_DIR when extended; at rest
    // its MCP/IP flexion rotates the ray about the fixed axis
    // whose positive sense sweeps the tip ACROSS the palm
    // (toward the little side), in the thumb's own near-palm-
    // parallel flexion plane.
    const thumbAxis = norm(M.vec.cross(THUMB_DIR, norm([1, 0.15, 0.10])));
    const thumbExt = chainFrom(THUMB_BASE, THUMB_DIR, THUMB_LEN, () => thumbAxis, [0, 0]);
    const thumbRest = chainFrom(THUMB_BASE, THUMB_DIR, THUMB_LEN, () => thumbAxis, REST_CURL_THUMB);
    return {
      wrist: [0, 0, 0], frame: { x: pX, y: pY, z: pZ },
      bases, meta, boneZ, roots, fingersExt, fingersRest,
      palm: mass(PLATE), pad: mass(KNUCKLE_PAD), thenar: mass(THENAR), hypothenar: mass(HYPOTHENAR), carpus: mass(CARPUS_R),
      thumbBase: [...THUMB_BASE], thumbDir: [...THUMB_DIR], thumbAxis, thumbExt, thumbRest,
      scaphoid: [...SCAPHOID]
    };
  };

  return { plan, pose, poseCached, packPose, setPoseCache, poseLegacy, setHandSolver, NH, drawNaturalHand, draw, setVariant, setCarriage, setRadiusScale, setPlaceVariant, VARIANTS, BONE, PLACE_VARIANTS, ROM, restHand, _romLog: ROM_LOG, _ik: { solveElbow, fingerChain, fingerChainPad, MIN_SPAN, PAD }, SKELETON: { SHOULDER_L, SHOULDER_R, ARM, FINGER_LEN, FINGER_R, THUMB_LEN, THUMB_R, THUMB_CMC_ROT_MAX, get RADIUS_SCALE() { return RADIUS_SCALE; }, HAND: { PALM_LEN, MC_ROW, MC_LEN, MC_BASE, MC_YAW, MC_CUP, SCAPHOID, PLATE, KNUCKLE_PAD, THENAR, HYPOTHENAR, CARPUS: CARPUS_R, THUMB_BASE, THUMB_DIR, REST_CURL, REST_CURL_THUMB } } };
})();

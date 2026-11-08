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
  const THUMB_LEN = [0.044, 0.030, 0.022]; // metacarpal, proximal, distal
  const THUMB_R = [0.0160, 0.0145, 0.0125];
  // Knuckle-row arc: each root's setback from the row line along the
  // palm's proximal direction — the middle knuckle is the most
  // distal, the little finger's knuckle sits 9 mm back.
  const KNUCKLE_ARC = { 1: 0.0035, 2: 0, 3: 0.002, 4: 0.009 };
  const ROW_S = 0.022; // MCP spacing along the knuckle row
  const PALM_LEN = 0.093; // wrist joint -> middle knuckle; anatomical band 85-100 mm at this figure's ~1.0 scale (forearm 0.28, head height ~0.25)

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
  const CARR_OFF = { mode: 'current', rollDeg: 0, rootRollDeg: 0, alignW: 0, rootAlign: 0, wrapDeg: 0, wrapStation: 'keep', wrapBand: 'off', wrapGuard: 'off', liftY: 0, liftX: 0, fanDeg: 0, fanYawBase: 0, fanYawSpread: 0, dipSlave: 0 };
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
    let b1 = 0, b2 = b2of(0);
    if (dT < resLen(B1C, b2of(B1C))) {
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

  function pose(song, t) {
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
    const palmAxis = norm(add(
      mul(M.u, slerp(VARI.wristU, 0.55, lam)),
      add(mul(M.v, slerp(VARI.wristSide, 0.42, lam)),
        mul(M.n, slerp(VARI.wristN, 0.72, lam)))));
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
    const curlF = slerp(0.55, 0.28, lam), rho = slerp(0.98, 0.58, lam);
    const appDir = norm(add(
      mul(M.u, slerp(0.88, 0.35, lam)),
      add(mul(M.v, slerp(-0.10, -0.62, lam)), mul(M.n, slerp(0.40, 0.70, lam)))));
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
    // dot(root - root_prim, rowDir) -- is (f - prim) * ROW_S: the
    // closed-form fan tilt in the {appDir, rowDir} plane that
    // lands the root on its station. The knuckle ARC is then
    // applied as a setback along the palm's proximal direction
    // and re-projected onto the reach sphere (two passes), which
    // moves the station by ~1 mm at most: the row the palm frame
    // is fitted to carries the arc (middle knuckle most distal,
    // little 9 mm back) with contact still exact.
    const primRoot = add(targets[prim], mul(appDir, reaches[prim]));
    const proxRaw = mul(palmAxis, -1);
    const proxDir = norm(sub(proxRaw, mul(rowDir, dot(proxRaw, rowDir))));
    const rootOf = f => {
      if (f === prim) return primRoot;
      const D = (f - prim) * ROW_S - dot(sub(targets[f], targets[prim]), rowDir);
      const g = clamp(D / reaches[f], -0.92, 0.92);
      const w = g / Math.sqrt(1 - g * g);
      let root = add(targets[f], mul(norm(add(appDir, mul(rowDir, w))), reaches[f]));
      for (let it = 0; it < 2; it++) {
        const shifted = add(root, mul(proxDir, -(KNUCKLE_ARC[f] - KNUCKLE_ARC[prim]) / 2));
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
      let neckW = add(add(axPt, mul(neckAxisDir, -(VARI.stationBack + stOff))),
        add(mul(M.BOARD.normal, fbOff), mul(M.v, -(VARI.wristSideM + sdOff))));
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
      const ang = drawnAngleCalc(w, K, T, FINGER_LEN[f], bendNOf(f, w, K), curlF);
      CHAIN_FAST = false;
      return ang;
    };
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
    const correctMCP = (w, planeZ) => {
      const k2Entry = [...knuckles[2]];
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
          const ang = drawnMCPAngle(w, knuckles[f], targets[f], f, planeZ);
          worst = Math.max(worst, ang);
          if (ang <= MCP_CAP) continue;
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
              drawnMCPAngle(w, Kc, T2, 2, planeZ) <= MCP_CAP;
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
      return worstOut;
    };
    { const wProv = placeWrist(knuckles[2], VARI.wristBack); bendN = bendNFor(palmFrameOf(wProv).z); correctMCP(wProv, palmFrameOf(wProv).z); }
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
    // the neck, 45 mm from the axis, a station-step toward the
    // nut): the thumb lies along that ridge, opposing the fingers
    // that wrap over the board from the same side -- the pinch.
    // The nut-side step matters to the chain: it keeps the
    // wrist->rest distance ~60 mm, a span the 96 mm thumb chain
    // can fold to inside its caps (a bridge-side step collapsed
    // it to ~30 mm -- measured, round 2 -- and no in-cap fold
    // exists there).
    // (The pre-fix rest sat on the C-side ridge, +v, the player's
    // right: one more piece of the hand assembled from the right.)
    const neckRest = add(add(axisPt, mul(norm(add(mul(backDir, 0.62), mul(M.v, -0.62))), 0.045)),
      mul(neckAxisDir, 0.010));
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
    // Fibonacci-sphere samples for the palm plate's neck
    // clearance check inside finishHand.
    const SURF_P = [];
    { const NP = 80, ga = Math.PI * (3 - Math.sqrt(5));
      for (let i = 0; i < NP; i++) { const y = 1 - (i / (NP - 1)) * 2, rr = Math.sqrt(Math.max(0, 1 - y * y)), th = ga * i; SURF_P.push([Math.cos(th) * rr, y, Math.sin(th) * rr]); } }
    let rollAdj = 0; // trial loops' pronation adjustment (see the frame block)
    // finishHand(w): everything downstream of a chosen wrist --
    // palm frame, coplanarity, the final drawn-MCP pass, the
    // finger chains (with the span repair for chains the PIP/DIP
    // clamp flags infeasible), the palm/carpus pieces, and the
    // elbow search. Returns the assembly for the trial loops.
    const finishHand = w => {
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
      let mcpWorst = correctMCP(w, palmZ);
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
        let pts = fingerChain(knuckle, target, FINGER_LEN[f], bendNOf(f, w, knuckle), curlF);
        if (CARR.mode === 'bone' && chainBreach(pts, f) < 0) {
          const zB = bendNOf(f, w, knuckle);
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
            for (const lift of [0.004, 0.008, 0.012, 0.016]) {
              const tNew = add(t0, mul(M.BOARD.normal, lift));
              const cand = fingerChain(knuckle, tNew, FINGER_LEN[f], bendNOf(f, w, knuckle), curlF);
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
        // Base-joint (MCP) bend of the chain: angle between the
        // first segment and the knuckle->target chord. (Chain-
        // internal -- NOT the drawn angle rk reads; see
        // drawnMCPAngle.)
        const mcp = Math.acos(clamp(dot(norm(sub(pts[1], knuckle)), norm(sub(target, knuckle))), -1, 1));
        return { points: pts, contact: contacts[f], target, mcpAngle: mcp, drawnMcp: drawnFromPts(pts), tipDir: norm(sub(pts[3], pts[2])), pip: pts.pip, dip: pts.dip, curlUsed: pts.curlUsed, chainInfeasible: pts.infeasible, slaveDip: pts.slaved === true };
      };
      for (let f = 1; f <= 4; f++) fingers[f] = buildOne(f);
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
      mcpSync = null;
      // The plate's Z is fitted to the roots' stations too: when
      // the primary is a short finger its root sits closer along
      // the approach direction, which projects out of the middle
      // root's plane by up to ~19 mm; the plate thickens toward
      // that side instead of leaving the root outside.
      const zSt = roots.map(r => dot(sub(r, midRoot), palmZ));
      const zOff = clamp(zSt.reduce((a, z) => a + z, 0) / 4, -0.014, 0.014);
      const zRad = clamp(Math.max(...zSt.map(z => Math.abs(z - zOff))) + 0.006, 0.014, 0.020);
      const palmEuler = eulerZYX(palmX, palmY, palmZ);
      // The plate's X and Y spans are fitted to the actual
      // assembly (wrist at -palmLen along Y, roots at their
      // stations), centred on the span rather than on the middle
      // knuckle, so every root sits inside the drawn plate even
      // when the fan angles the row relative to the palm axis.
      const xSt = roots.map(r => dot(sub(r, midRoot), palmX));
      const xLo = Math.min(...xSt, 0), xHi = Math.max(...xSt, 0);
      const ySt = roots.map(r => dot(sub(r, midRoot), palmY));
      const yLo = Math.min(-palmLen, ...ySt), yHi = Math.max(...ySt, 0);
      const palm = {
        centre: add(add(add(midRoot, mul(palmX, (xLo + xHi) / 2)), mul(palmY, (yLo + yHi) / 2)), mul(palmZ, zOff)),
        radii: [(xHi - xLo) / 2 + 0.013, (yHi - yLo) / 2 + 0.014, zRad],
        basis: { x: palmX, y: palmY, z: palmZ },
        euler: palmEuler
      };
      const carpus = {
        centre: add(w, mul(palmY, 0.008)),
        radii: [0.026, 0.019, 0.015],
        basis: { x: palmX, y: palmY, z: palmZ },
        euler: palmEuler
      };
      // Plate clearance: the fitted ellipsoid's palm side can
      // press into the neck where the hand wraps it (worst
      // measured 6.6 mm, a finger-4-led low frame). Sample the
      // surface against the neck cylinder; if it enters, lift
      // the centre along the back-of-hand axis by the deficit
      // (capped 10 mm). Roots stay bridged: they sit inside the
      // plate's knuckle end, and a dorsal lift only buries them
      // deeper, which the root-ball bridging check allows.
      // BONE mode: the plate sits rotated ~90 deg from the
      // shipped frame, so its long axis can reach AROUND the
      // neck and the dorsal lift (capped, and pointing along
      // the plate rather than away from the wood) left the
      // surface up to ~20 mm inside the cylinder. The lift
      // there runs radially off the neck axis instead, capped
      // at 24 mm -- the direction the measured distance
      // actually answers to.
      {
        let minD = Infinity;
        for (const sf of SURF_P) {
          const pt = add(palm.centre, add(mul(palmX, sf[0] * palm.radii[0]),
            add(mul(palmY, sf[1] * palm.radii[1]), mul(palmZ, sf[2] * palm.radii[2]))));
          const ap = add(M.NECK_A, mul(neckAxisDir,
            clamp(dot(sub(pt, M.NECK_A), neckAxisDir), 0, axisLen)));
          minD = Math.min(minD, Math.hypot(...sub(pt, ap)) - 0.027);
        }
        if (minD < 0.002) {
          if (CARR.mode === 'bone') {
            const apC = add(M.NECK_A, mul(neckAxisDir,
              clamp(dot(sub(palm.centre, M.NECK_A), neckAxisDir), 0, axisLen)));
            let rd = sub(palm.centre, apC);
            rd = Math.hypot(...rd) < 1e-6 ? palmZ : norm(rd);
            palm.centre = add(palm.centre, mul(rd, Math.min(0.002 - minD, 0.024)));
          } else {
            palm.centre = add(palm.centre, mul(palmZ, Math.min(0.002 - minD, 0.010)));
          }
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
        roots, K, midRoot, palmX, palmY, palmZ, palmLen, palm, carpus, xHalf: (xHi - xLo) / 2,
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
      const base = add(add(add(wS, mul(thY, 0.020)),
        mul(thX, (Math.sign(dot(sub(rootsS[0], KS), thX)) || 1) * 0.022)), mul(thZ, -0.008));
      const thumbMax = THUMB_LEN[0] + Math.sqrt(THUMB_LEN[1] ** 2 + THUMB_LEN[2] ** 2 +
        2 * THUMB_LEN[1] * THUMB_LEN[2] * Math.cos(0.35));
      // Thenar slide: when the rest point sits near the
      // chain's reach limit, the root slides toward it within
      // the palm plane, up to 35 mm -- the thenar mass
      // rotating toward the neck, as a real hand's does; the
      // drawn thenar capsule bridges root and base.
      let root = base;
      {
        const toRest = sub(restPt, base), dRest = Math.hypot(...toRest);
        const slide = clamp(dRest - (thumbMax * 0.999 - 0.004), 0, 0.035);
        if (slide > 0) {
          let inDir = sub(toRest, mul(H.palmY, dot(toRest, H.palmY)));
          inDir = Math.hypot(...inDir) < 1e-6 ? toRest : norm(inDir);
          root = add(base, mul(inDir, slide));
        }
      }
      // Short-span pullback (proximal fix, rk's method): if
      // the rest point is closer to the root than the capped
      // chain can fold to, retreat the root toward the wrist
      // (bisected so the span equals the chain's true minimum
      // resultant under its COUPLED caps, else all the way).
      let pullback = 0;
      {
        const [tl1, tl2, tl3] = THUMB_LEN;
        const b2c = Math.min(ROM.THUMB.IP[1], 0.35 + 1.1 * ROM.THUMB.MCP[1]);
        const minSpan = Math.hypot(
          tl1 + tl2 * Math.cos(ROM.THUMB.MCP[1]) + tl3 * Math.cos(ROM.THUMB.MCP[1] + b2c),
          tl2 * Math.sin(ROM.THUMB.MCP[1]) + tl3 * Math.sin(ROM.THUMB.MCP[1] + b2c));
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
      return { root, base, pullback, tipErr: thumbChain(root, restPt, dorsalRefT).tipErr };
    };
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
        let fv = sub(mul(pz, -1), mul(mDir, -dot(pz, mDir)));
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
      const wTry = placeWrist(knuckles[2], VARI.wristBack + wbOff + extra, stOff, sdOff, axOff, latOff, rowOff, rowDirW);
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
      let thumbErr = 0, splitPen = 0, palmPen = 0, palmLen = null;
      if (CARR.mode === 'bone') {
        thumbErr = thumbSolveFor(wTry, H).tipErr;
        splitPen = ownSplitOf(wTry);
        palmLen = Math.hypot(...sub(H.roots[1], wTry));
        palmPen = Math.max(0, 0.064 - palmLen) * 800;
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
        thumbPen + splitPen * 8 + palmPen + infeasN * 40 +
        (Math.abs(wbOff) + Math.abs(stOff) + Math.abs(sdOff) + Math.abs(axOff) + Math.abs(latOff) + Math.abs(rowOff) + Math.abs(rollOff) * 0.05 + extra) * 2;
      const rec = { score, wrist: wTry, relax: wbOff + extra, rollAdj: rollOff, off, extra, H, thumbErr, splitPen, palmLen, infeasN };
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
    if (CARR.alignW) for (const off of OFFSETS) runTrial(off, 0);
    if (!(CARR.alignW && bestTry && feasible(bestTry.H))) {
      grid: for (const off of OFFSETS) {
        for (const extra of [0, 0.008, 0.016, 0.024]) {
          const rec = runTrial(off, extra);
          if (rec && feasible(rec.H)) break grid;
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
    const polishDirty = r => r && (r.infeasN > 0 || (settled && r.thumbErr > 0.002) || (r.palmLen != null && r.palmLen < 0.064));
    if (CARR.mode === 'bone' && bestFeas && polishDirty(bestThumb || bestFeas)) {
      const att0 = attemptsMade;
      for (const off of OFFSETS) {
        if (attemptsMade - att0 >= 16 || bestClean) break;
        const rec = runTrial(off, 0);
        if (rec && okTry(rec)) break;
      }
      // The settled thumb's reach and the palm's length are
      // both wristBack facts (the root rides the wrist): the
      // grid's ladder reaches +24 mm of extra wristBack,
      // which the extra = 0 sweep above never sees. When
      // either term is the dirty one, climb the ladder on
      // the plain and wristBack offsets.
      if (!bestClean && ((settled && (bestThumb || bestFeas).thumbErr > 0.002) ||
          ((bestThumb || bestFeas).palmLen != null && (bestThumb || bestFeas).palmLen < 0.064))) {
        ladder: for (const off of [OFFSETS[0], OFFSETS[16], OFFSETS[24]]) {
          for (const extra of [0.008, 0.016, 0.024]) {
            if (attemptsMade - att0 >= 24) break ladder;
            const rec = runTrial(off, extra);
            if (rec && okTry(rec)) break ladder;
          }
        }
      }
      let curP = bestClean || bestThumb || bestFeas;
      if (!bestClean && curP) {
        const stepOfP = { 6: 0.005, 4: 0.006, 5: 0.06, 3: 0.004 };
        const inCapsP = off => Math.abs(off[6]) <= 0.024 && Math.abs(off[4]) <= 0.036 && off[5] <= 0.44 && off[5] >= -0.10 && Math.abs(off[3]) <= 0.012;
        let dBudget = 8;
        while (dBudget > 0 && !okTry(curP)) {
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
              if (okTry(curP) || dBudget <= 0) break;
            }
            if (okTry(curP) || dBudget <= 0) break;
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
    const winTry = bestClean || bestThumb || bestFeas || bestTry;
    rollAdj = winTry.rollAdj;
    const wrist = winTry.wrist;
    const wristBackRelax = winTry.relax;
    const H = attempt(wrist);
    const { roots, K, palmX, palmY, palmZ, palm, carpus } = H;
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
      const breachT = pts => {
        let worst = Infinity;
        for (let j = 0; j < 3; j++) for (let kk = 0; kk <= 8; kk++) {
          const pt = pts[j].map((v, q) => v + (pts[j + 1][q] - v) * kk / 8);
          if (Math.hypot(...sub(pt, restPt)) < 0.012) continue;
          worst = Math.min(worst, boxD(pt) - THUMB_R[j] + 0.008);
          const abT = sub(M.NECK_B, M.NECK_A);
          const ap = add(M.NECK_A, mul(abT, clamp(dot(sub(pt, M.NECK_A), abT) / dot(abT, abT), 0, 1)));
          worst = Math.min(worst, Math.hypot(...sub(pt, ap)) - 0.027 - THUMB_R[j] + 0.002);
        }
        return worst;
      };
      if (breachT(thumbPts) < 0) {
        const axT = norm(sub(restPt, thumbRoot));
        let best = thumbPts, bestBr = breachT(thumbPts);
        for (const ang of [0.12, -0.12, 0.24, -0.24, 0.38, -0.38, 0.55, -0.55]) {
          const c = Math.cos(ang), s = Math.sin(ang);
          const rotP = p => {
            const rel = sub(p, thumbRoot);
            return add(thumbRoot, add(add(mul(rel, c), mul(M.vec.cross(axT, rel), s)), mul(axT, dot(axT, rel) * (1 - c))));
          };
          const cand = [thumbPts[0], rotP(thumbPts[1]), rotP(thumbPts[2]), thumbPts[3]];
          const br = breachT(cand);
          if (br > bestBr) { bestBr = br; best = cand; }
          if (br >= 0) break;
        }
        thumbPts = best;
      }
    }
    const thumbSolve = { beta1: thumbSol.beta1, beta2: thumbSol.beta2, gamma: thumbSol.gamma, tipErr: thumbSol.tipErr, pullback: thumbPullback };
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
      hand: { anchor: anchorPt, mode, lambda: lam, backNormal: palm.basis.z, palm, carpus, row: { centre: K, axis: palmX, half: H.xHalf }, thumbRoot, thumbBase, thumbRest: restPt, wrist, elbowFallback, variant: VARI.name, mcpWorst, wristBackRelax, thumbSolve, wristFlex: H.elbowFlex, wristDev: H.elbowDev, elbowCone: H.elbowCone, elbowViol: H.elbowViol, pronation: H.pronation }, sway,
      sounding: sounding.map(({ r }) => r.string)
    };
  }

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
      R.segment(sub(arm.elbow, mul(dEF, 0.012)), add(arm.wrist, mul(dEF, 0.012)), 0.038, sleeve, 'limb');
      R.ball(arm.elbow, [0.046, 0.046, 0.046], sleeve);
      R.ball(arm.shoulder, [0.050, 0.050, 0.050], sleeve);
    }
    R.ball(p.rightArm.wrist, [0.042, 0.046, 0.042], SKIN);
    // Left hand, one assembly (see pose()): carpus at the wrist
    // joint, the palm plate spanning wrist -> knuckle row, a
    // thenar ball at the thumb's root, then the fingers and thumb
    // chained out of the row / thenar corner. Drawn before the
    // fingers so the chains emerge from the plate's knuckle edge.
    const pm = p.hand.palm, cp = p.hand.carpus;
    // The carpus is drawn 1.15x its pose radii so the wrist/palm
    // junction blends into the forearm's extended end (the pose
    // radii stay the anatomical ones the tests measure).
    R.piece('joint', cp.centre, cp.radii.map(r => r * 1.15), SKIN, cp.euler[0], cp.euler[1], cp.euler[2]);
    R.piece('joint', pm.centre, pm.radii, SKIN, pm.euler[0], pm.euler[1], pm.euler[2]);
    // Thenar mass: a capsule from the thumb's CMC base to its
    // (possibly slid) root, plus the ball on the root. (Capsule
    // radius 0.0185, up from 0.0165, so its ends sink into the
    // palm corner and the root ball instead of necking.)
    R.segment(p.hand.thumbBase, p.hand.thumbRoot, 0.0185, SKIN, 'limb');
    R.ball(p.hand.thumbRoot, [0.019, 0.023, 0.017], SKIN);
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
        if (j === 0 && rootThin)
          R.segment(sub(a, mul(dir, extA)), add(a, mul(dir, 0.45 * L)), radii[0] * 0.74, colOf(0), 'limb');
        R.segment(sub(a, mul(dir, j === 0 && rootThin ? -0.15 * L : extA)), add(b, mul(dir, extB)), radii[j], colOf(j), 'limb');
        if (j < 2) { const rB = (radii[j] + radii[j + 1]) / 2; R.ball(b, [rB, rB, rB], colOf(j + 1)); }
      }
    };
    for (let f = 1; f <= 4; f++)
      drawChain(p.fingers[f].points, FINGER_R[f], j => j === 2 ? SKIN_L : SKIN, true);
    drawChain(p.thumb.points, THUMB_R, () => SKIN, false); // root ball already drawn above
    // Right hand curled on the bow frog: palm + four short fingers.
    const bw = p.rightArm.wrist, bd = norm(sub(p.bow.tip, p.bow.frog));
    R.ball(add(bw, mul(bd, 0.012)), [0.045, 0.038, 0.048], SKIN);
    for (let f = 0; f < 4; f++) {
      const b0 = add(bw, add(mul(bd, -0.008 + f * 0.013), mul(M.n, -0.018)));
      const b1 = add(b0, add(mul(bd, 0.010), mul(M.n, 0.020)));
      R.segment(b0, b1, 0.010, SKIN, 'joint');
    }
  }

  function draw(R, song, t, opts = {}) {
    const p = pose(song, t);
    M.drawCello(R, { hotString: p.sounding.length ? p.sounding[0] : -1 });
    M.drawBow(R, clamp(Math.round(p.bow.string), 0, 3), p.bow.frac);
    drawFigure(R, p);
    return p;
  }

  return { plan, pose, draw, setVariant, setCarriage, VARIANTS, BONE, ROM, _ik: { solveElbow, fingerChain, MIN_SPAN }, SKELETON: { SHOULDER_L, SHOULDER_R, ARM, FINGER_LEN, FINGER_R, THUMB_LEN, THUMB_R, HAND: { PALM_LEN, ROW_S, KNUCKLE_ARC } } };
})();

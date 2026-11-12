'use strict';
/* Cello geometry: a single source of truth for where everything is.
 *
 * Planning coordinates (metres) are RecitalGL planning coords: the
 * renderer reflects X into world space (its toWorld), so this frame
 * is the mirror of the stage — the performer's right is at -X, the
 * performer's left at +X, +Y up, -Z toward the audience. (Authoring
 * the performer anatomically in this frame — right hand at +X —
 * rendered a left-handed player: every planning-frame check passed
 * while the drawn figure's hands were swapped on screen.) The cello
 * stands on its endpin in front of the seated player, body tilted
 * back toward the player and leaning to the player's left (planning
 * +X), scroll up-left.
 *
 * Strings are indexed 0..3 = C G D A. The A string is on the player's
 * left (+X side in planning), the C string on the right (-X side).
 * Frame:
 *   u — along the body/neck, bridge toward nut.
 *   v — across the strings toward -X (C-string side).
 *   n — out of the top plate toward the audience. This frame is
 *   left-handed in planning coords, so n = v x u (not u x v).
 * AB is a point on the top plate under the bridge. The strings leave
 * the nut 14 mm above the plate line and meet the bridge top 88 mm
 * above it (a real bridge's height), so the string line is not
 * parallel to the body axis. The fingerboard's playing surface is a
 * single straight line in the (u, n) plane — the same line the neck
 * axis parallels, so the board sits on the neck along its whole
 * length: it starts 0.5 mm below the string line at the nut and its
 * extension reaches the bridge 6 mm below the bridge top (the
 * string-action budget of a standard setup), reaching ~71 mm above
 * the plate at its free end. STEP 3: this is now the crown centreline;
 * the physical board is transversely curved (R65) and the neck is D-shaped.
 * The legacy target rails and placement/scroll axis stay fixed.
 * Stopping points come from the fingering
 * engine's 690 mm scale: a note k semitones above the open string
 * stops at distFromNut(k) from the nut, and a stopped finger presses
 * the string onto boardPoint().
 *
 * Drawing goes through a RecitalGL-compatible renderer (the host's):
 * {begin, box, ball, bone, piece, segment, project}. piece() applies
 * scale between its rotations, so slab() corrects the Z-rotation for
 * the scale ratio to keep long axes true. Nothing here touches the DOM.
 */
window.CelloModel = (() => {
  const F = window.CelloFingering;
  const SCALE = F.SCALE_MM / 1000; // 0.69 m

  const add = (a, b) => a.map((v, i) => v + b[i]);
  const sub = (a, b) => a.map((v, i) => v - b[i]);
  const mul = (a, s) => a.map(v => v * s);
  const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = a => { const l = Math.hypot(...a) || 1; return a.map(v => v / l); };
  const lerp = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

  const AB = [0.01, 0.88, -0.385]; // top plate under the bridge
  const u = norm([0.17, 0.93, 0.325]);
  const v = norm(sub([-1, 0, 0], mul(u, dot([-1, 0, 0], u))));
  const n = norm(cross(v, u));
  const RX = Math.atan2(u[2], u[1]);
  // piece() left-multiplies its Rz in the world frame (after Rx), so
  // the lean that brings +Y onto u is a single constant angle.
  const RZ = Math.atan2(-u[0], Math.hypot(u[1], u[2]));
  const NUTP = add(add(AB, mul(u, SCALE)), mul(n, 0.014)); // nut, string side
  const BRIDGE = add(AB, mul(n, 0.088)); // bridge top centre

  const BRIDGE_SPREAD = 0.052, NUT_SPREAD = 0.033;
  const offBridge = s => (1.5 - s) * (BRIDGE_SPREAD / 3);
  const offNut = s => (1.5 - s) * (NUT_SPREAD / 3);
  const nutPoint = s => add(NUTP, mul(v, offNut(s)));
  const bridgePoint = s => add(BRIDGE, mul(v, offBridge(s)));
  // Point on string s at distance d metres from the nut (0..SCALE).
  function stringPoint(s, d) { return lerp(nutPoint(s), bridgePoint(s), d / SCALE); }
  const semitonePoint = (s, k) => stringPoint(s, F.distFromNut(k) / 1000);
  // Fingerboard surface under string s at distance d from the nut.
  // The surface line is fixed by the setup above: BOARD_NUT_N at the
  // nut, BOARD_PROJ_N where its extension meets the bridge (u = 0).
  const BOARD_END = 0.58;
  const BOARD_NUT_N = 0.0135;
  const BOARD_PROJ_N = 0.082;
  const boardSurfN = uc => BOARD_NUT_N + (SCALE - uc) * (BOARD_PROJ_N - BOARD_NUT_N) / SCALE;
  const boardSurf = uc => add(add(AB, mul(u, uc)), mul(n, boardSurfN(uc)));
  const boardA = boardSurf(SCALE);              // at the nut
  const boardB = boardSurf(SCALE - BOARD_END);  // free end
  const boardDir = norm(sub(boardB, boardA));            // nut -> free end
  const boardNormal = norm(cross(boardDir, v));          // out of the surface (left-handed frame: dir x v)
  // piece() composes Rz * Ry * Rx (world frame, in that order).
  // eulerZYX solves the angles that put local X/Y/Z onto the given
  // orthonormal frame, so a drawn slab can be aligned to the board
  // exactly — the X-only rotation of box() cannot express the neck's
  // sideways lean and left the old fingerboard slabs skewed ~12 deg.
  function eulerZYX(xA, yA, zA) {
    const ry = Math.atan2(-xA[2], Math.hypot(xA[0], xA[1]));
    return [Math.atan2(yA[2], zA[2]), ry, Math.atan2(xA[1], xA[0])];
  }
  // The mirrored planning frame makes (v, boardDir, boardNormal)
  // left-handed, which no ZYX rotation can express; a centred box is
  // indifferent to the sign of its thickness axis, so the solver gets
  // the right-handed triad (v, boardDir, -boardNormal).
  const BOARD_EULER = eulerZYX(v, boardDir, mul(boardNormal, -1));
  // LEGACY placement/scroll axis, deliberately fixed. STEP 3 no longer
  // interprets this as a 27 mm physical radius: NECK.distance and
  // drawNeckBoard below own the D-shaped surface.
  const NECK_OFF = 0.034;
  const neckAxisPt = uc => add(boardSurf(uc), mul(boardNormal, -NECK_OFF));
  const NECK_A = neckAxisPt(0.25);   // heel end
  const NECK_B = neckAxisPt(0.685);  // nut end
  const neckDirV = norm(sub(NECK_B, NECK_A));
  // Pegbox + scroll sit on the neck axis extended past the nut.
  const SCROLL = [
    add(NECK_B, mul(neckDirV, 0.030)),
    add(NECK_B, add(mul(neckDirV, 0.082), mul(boardNormal, 0.002)))
  ];
  function boardPoint(s, d) {
    const p = lerp(boardA, boardB, Math.min(d / BOARD_END, 1));
    return add(p, mul(v, offNut(s) + (offBridge(s) - offNut(s)) * (d / SCALE)));
  }
  // STEP 3: physical surfaces, independent of the legacy placement axis
  // and boardPoint targets above. Strings, targets, scroll and thumb
  // anchors MUST NOT move when the old 27 mm collision cylinder is retired.
  const BOARD_RADIUS = 0.065;
  // Flat underside: crown thickness grows 7->12 mm, leaving ~4 mm
  // ebony at the wide end's edges (R65 sag there is ~8 mm). Keeping
  // 7 mm everywhere would invert the edge ribbons, not form a solid.
  const thicknessAt = d => 0.007 + 0.005 * Math.max(0, Math.min(1, d / BOARD_END));
  const widthAt = d => 0.032 + (0.0625 - 0.032) * Math.max(0, Math.min(1, d / BOARD_END));
  const crown = x => Math.sqrt(Math.max(0, BOARD_RADIUS ** 2 - x * x)) - BOARD_RADIUS;
  const neckStart = dot(sub(boardSurf(0.685), boardA), boardDir);
  const neckEnd = dot(sub(boardSurf(0.25), boardA), boardDir);
  // D: flat glue face, half-elliptic rounded back. Total crown-to-back
  // thickness is 40 mm at the nut, 46 mm at the heel. No body edits.
  const neckDepth = d => 0.040 + 0.006 * Math.max(0, Math.min(1, (d - neckStart) / (neckEnd - neckStart)));
  const section = (kind, d) => {
    const w = widthAt(d) / 2, out = [], N = 16;
    if (kind === 'neck') {
      for (let i = 0; i <= N; i++) {
        const a = Math.PI * i / N;
        const thick = thicknessAt(d);
        out.push([w * Math.cos(a), -thick - (neckDepth(d) - thick) * Math.sin(a)]);
      }
    } else {
      for (let i = 0; i <= N; i++) { const x = -w + 2 * w * i / N; out.push([x, crown(x)]); }
      for (let i = N; i >= 0; i--) { const x = -w + 2 * w * i / N; out.push([x, -thicknessAt(d)]); }
    }
    return out;
  };
  // Signed polygon distance in a transverse section. Axial taper is
  // evaluated at the query station (not a full 3-D closest-point solve;
  // transverse distances overestimate by <0.2% at these taper slopes).
  const polygonD = (x, z, poly) => {
    let dd = Infinity, inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [ax, az] = poly[j], [bx, bz] = poly[i], dx = bx - ax, dz = bz - az;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
      dd = Math.min(dd, (x - ax - t * dx) ** 2 + (z - az - t * dz) ** 2);
      if ((az > z) !== (bz > z) && x < ax + (bx - ax) * (z - az) / (bz - az)) inside = !inside;
    }
    return Math.sqrt(dd) * (inside ? -1 : 1);
  };
  const surfaceDistance = (q, kind) => {
    const rel = sub(q, boardA), a = dot(rel, boardDir), x = dot(rel, v), z = dot(rel, boardNormal);
    const lo = kind === 'neck' ? neckStart : 0, hi = kind === 'neck' ? neckEnd : BOARD_END;
    const d = Math.max(lo, Math.min(hi, a)), crossD = polygonD(x, z, section(kind, d));
    const axial = Math.max(lo - a, a - hi);
    return Math.hypot(Math.max(crossD, 0), Math.max(axial, 0)) + Math.min(Math.max(crossD, axial), 0);
  };
  // Render transverse ribbons using the same section profile. Primitive
  // boxes approximate the smooth surface at 12 axial x 16 lateral samples.
  function drawSurface(R, kind, color) {
    const axial = 12, lateral = 16;
    const lo = kind === 'neck' ? neckStart : 0, hi = kind === 'neck' ? neckEnd : BOARD_END;
    for (let i = 0; i < axial; i++) {
      const d = lo + (hi - lo) * (i + 0.5) / axial, w = widthAt(d) / 2;
      for (let j = 0; j < lateral; j++) {
        const x = -w + 2 * w * (j + 0.5) / lateral;
        const thick = thicknessAt(d), top = kind === 'neck' ? -thick : crown(x);
        const bottom = kind === 'neck' ? -thick - (neckDepth(d) - thick) * Math.sqrt(1 - (x / w) ** 2) : -thick;
        const c = add(add(add(boardA, mul(boardDir, d)), mul(v, x)), mul(boardNormal, (top + bottom) / 2));
        R.piece('box', c, [2 * w / lateral, (hi - lo) / axial, top - bottom], color, ...BOARD_EULER);
      }
    }
  }
  const drawNeckBoard = (R, neckColor = COLORS.varnishDark, boardColor = COLORS.ebony) => {
    drawSurface(R, 'neck', neckColor); drawSurface(R, 'board', boardColor);
  };
  // Where the bow hair meets string s: ~85 mm from the bridge.
  const bowContact = s => stringPoint(s, SCALE - 0.085);

  const BOW_LENGTH = 0.72;
  // Frog -> tip direction at mid string level: toward the player's
  // left and a touch down, angled so the frog rests toward the body
  // and the tip reaches across the front of the strings
  // (dir . n ~ +0.15, still ~perpendicular to the string: dir . u
  // ~ -0.02). The old base had a -0.30 Z component (dir . n =
  // 0.334), so the bow speared diagonally through the string
  // plane -- and the stick, not the hair, met the string.
  const bowDirBase = norm([0.96, -0.16, -0.10]);
  // String-level roll of the bow about the string axis. Kept small
  // (0.06 rad per string step): the roll pivots at the contact, so a
  // large angle swings the frog on a ~0.6 m lever far out of the
  // right arm's reach; the visible level change comes mainly from
  // the contact point moving across the bridge arc.
  // (Sign: bowDir rotates bowDirBase about u by this angle — a
  // Rodrigues rotation, whose sense reverses in the mirrored
  // planning frame, hence (s - 1.5), not (1.5 - s).)
  const stringTilt = s => (s - 1.5) * 0.06;
  function bowDir(s) {
    const a = stringTilt(s), c = Math.cos(a), sn = Math.sin(a);
    const d = bowDirBase;
    return norm(add(add(mul(d, c), mul(cross(u, d), sn)), mul(u, dot(u, d) * (1 - c))));
  }
  function bowSegment(s, f) {
    const c = bowContact(s), d = bowDir(s);
    return { frog: sub(c, mul(d, f * BOW_LENGTH)), tip: add(c, mul(d, (1 - f) * BOW_LENGTH)), contact: c, dir: d };
  }

  const COLORS = {
    varnish: [0.40, 0.185, 0.065], varnishDark: [0.30, 0.125, 0.045],
    ebony: [0.030, 0.028, 0.032], bridge: [0.72, 0.55, 0.33],
    string: [0.78, 0.76, 0.72],
    bowWood: [0.23, 0.10, 0.05], hair: [0.85, 0.82, 0.75]
  };
  // Sizes passed to piece() are HALF extents (the loft shapes span
  // [-1,1]); sizes passed to box() are full extents.
  function slab(R, shape, center, size, color) { R.piece(shape, center, size, color, RX, 0, RZ); }

  // B-form outline anchors in d from AB (positive toward the neck). The
  // body runs from d=+400 mm at the upper edge to d=-355 mm at the lower
  // edge, so AB/stop is 400/755 = 53.0% down from the upper edge.
  // Widths are half-widths (column 1). Columns 2/3 retain the old station
  // metadata; actual rib taper and plate arches are defined by BODY_MESH.
  // The maxima/minima follow the measured stations:
  // upper maximum at 27%, C-bout corners near 38/60%, lower maximum at 75%.
  const BODY_SLICES = [
    [-0.3550, 0.1300, 0.0620, -0.002], [-0.3200, 0.1750, 0.0615, -0.001],
    [-0.2850, 0.2050, 0.0610,  0.000], [-0.2300, 0.2170, 0.0605,  0.020],
    [-0.1700, 0.2185, 0.0600,  0.030], [-0.1500, 0.2050, 0.0595,  0.029],
    [-0.1000, 0.1740, 0.0590,  0.024], [-0.0600, 0.1320, 0.0590,  0.016],
    [-0.0100, 0.1145, 0.0590,  0.008], [ 0.0450, 0.1170, 0.0595,  0.009],
    [ 0.0900, 0.1320, 0.0600,  0.015], [ 0.1200, 0.1580, 0.0605,  0.021],
    [ 0.1960, 0.1710, 0.0610,  0.030], [ 0.2700, 0.1500, 0.0615,  0.018],
    [ 0.4000, 0.1000, 0.0590, -0.002]
  ];
  const bodySpec = { length: 0.755, lowerWidth: 0.437, middleWidth: 0.229, upperWidth: 0.342, rib: [0.118, 0.124], stop: 0.400, fHole: 0.140, upperMaxFromTop: 0.27, cBouts: [0.38, 0.60], lowerMaxFromTop: 0.75 };
  // Shape-preserving cubic Hermite half-width: zero tangent at extrema
  // prevents an interpolated bout from exceeding its declared dimensions.
  const bodyWidth = d => {
    const secant = j => (BODY_SLICES[j + 1][1] - BODY_SLICES[j][1]) / (BODY_SLICES[j + 1][0] - BODY_SLICES[j][0]);
    const tangent = j => {
      if (j === 0) return secant(0);
      if (j === BODY_SLICES.length - 1) return secant(j - 1);
      const a = secant(j - 1), b = secant(j);
      return a * b <= 0 ? 0 : 2 * a * b / (a + b);
    };
    let i = 0;
    while (i < BODY_SLICES.length - 2 && d > BODY_SLICES[i + 1][0]) i++;
    const a = BODY_SLICES[i], b = BODY_SLICES[i + 1], h = b[0] - a[0], t = Math.max(0, Math.min(1, (d - a[0]) / h));
    return (2*t*t*t - 3*t*t + 1)*a[1] + (t*t*t - 2*t*t + t)*h*tangent(i) +
      (-2*t*t*t + 3*t*t)*b[1] + (t*t*t - t*t)*h*tangent(i + 1);
  };
  // One watertight mesh, not hundreds of intersecting capped primitives.
  // 48 axial intervals and shared, area-weighted vertex normals
  // eliminate the old coplanar intersections/z-fighting and station stripes.
  // Side ribs taper monotonically: 118 mm neck -> 124 mm endpin.
  // Top/back arches rise 30/29 mm above their respective rib-edge planes.
  const BODY_MESH = (() => {
    const vertices = [], normals = [], faces = [], across = 12;
    // Include the original extrema exactly, not merely the nearest grid ring.
    const stations = [...new Set([
      ...Array.from({ length: 49 }, (_, i) => 0.400 - bodySpec.length * i / 48),
      ...BODY_SLICES.map(s => s[0])
    ].map(d => Number(d.toFixed(9))))].sort((a, b) => b - a);
    const rings = stations.length - 1;
    const samples = [];
    for (let j = 0; j <= across; j++) samples.push(['top', j / across]);
    samples.push(['right', 1 / 3], ['right', 2 / 3]);
    for (let j = across; j >= 0; j--) samples.push(['back', j / across]);
    samples.push(['left', 2 / 3], ['left', 1 / 3]);
    const sides = samples.length;
    for (let i = 0; i <= rings; i++) {
      const d = stations[i], t = (0.400 - d) / bodySpec.length;
      const width = bodyWidth(d), rib = 0.118 + 0.006 * t;
      const envelope = Math.pow(Math.sin(Math.PI * t), 0.8);
      for (const [kind, s] of samples) {
        let x, z;
        if (kind === 'top' || kind === 'back') {
          x = width * (2 * s - 1);
          const arch = Math.sin(Math.PI * s) * envelope;
          z = kind === 'top' ? -0.030 + 0.030 * arch : -0.030 - rib - 0.029 * arch;
        } else { x = width * (kind === 'right' ? 1 : -1); z = -0.030 - rib * s; }
        vertices.push(add(add(add(AB, mul(u, d)), mul(v, x)), mul(n, z)));
        normals.push([0, 0, 0]);
      }
    }
    const triangle = (a, b, c) => {
      const N = cross(sub(vertices[b], vertices[a]), sub(vertices[c], vertices[a]));
      faces.push([a, b, c]);
      for (const k of [a, b, c]) normals[k] = add(normals[k], N);
    };
    for (let i = 0; i < rings; i++) for (let j = 0; j < sides; j++) {
      const a = i * sides + j, b = i * sides + (j + 1) % sides, c = b + sides, d = a + sides;
      triangle(a, c, b); triangle(a, d, c);
    }
    // Closed end faces have separate flat normals, not smoothed across the rim.
    const data = [];
    for (const face of faces) for (const k of face) data.push(...vertices[k], ...norm(normals[k]));
    for (const i of [0, rings]) {
      const first = i * sides, centre = vertices.slice(first, first + sides).reduce((a, b) => add(a, mul(b, 1 / sides)), [0, 0, 0]);
      const N = mul(u, i === 0 ? 1 : -1);
      for (let j = 0; j < sides; j++) for (const p of [centre, vertices[first + j], vertices[first + (j + 1) % sides]]) data.push(...p, ...N);
    }
    return new Float32Array(data);
  })();
  // Exact extended legacy neck axis; both endpoints lie on this one line.
  const endpinStart = add(NECK_A, mul(neckDirV, dot(sub(add(AB, mul(u, -0.355)), NECK_A), neckDirV)));
  const endpinLength = (endpinStart[1] - 0.006) / neckDirV[1];
  const ENDPIN = { start: endpinStart, end: sub(endpinStart, mul(neckDirV, endpinLength)), direction: mul(neckDirV, -1), length: endpinLength };

  function drawCello(R, opts = {}) {
    const C = COLORS;
    const axisAt = d => add(AB, mul(u, d)); // d>0 toward nut, along the plate line
    if (R.mesh) R.mesh(BODY_MESH, C.varnish);
    else {
      // Older primitive-only hosts/recorders retain a diagnostic fallback.
      // Visual hosts should implement the optional mesh(data, color) API.
      for (let i = 0; i < 96; i++) {
        const d = 0.400 - (i + 0.5) * bodySpec.length / 96;
        const width = bodyWidth(d);
        slab(R, 'cushion', add(axisAt(d), mul(n, -0.09)), [width / 2, bodySpec.length / 192, 0.075], C.varnish);
      }
    }
    // Endpin from the bottom edge to the floor.
    R.segment(ENDPIN.start, ENDPIN.end, 0.006, [0.55, 0.55, 0.58], 'limb');
    // Neck + heel + scroll: on the neck axis, which parallels the
    // fingerboard; the pegbox/scroll balls sit on its extension.
    drawNeckBoard(R);
    // Bridge: feet, waist and heart, with the 400 mm stop centred at AB.
    const bridgeC = add(AB, mul(n, 0.042));
    slab(R, 'box', bridgeC, [0.105, 0.034, 0.086], C.bridge);
    R.piece('cushion', add(bridgeC, mul(n, 0.045)), [0.072, 0.015, 0.022], C.bridge, RX, 0, RZ);
    for (const side of [-1, 1]) {
      const foot = add(add(AB, mul(v, side * 0.062)), mul(n, 0.036));
      R.piece('box', foot, [0.035, 0.018, 0.006], C.bridge, RX, 0, RZ);
      R.segment(add(foot, mul(n, 0.006)), add(foot, mul(n, 0.042)), 0.006, C.bridge, 'limb');
    }
    // Tailpiece and saddle.
    slab(R, 'box', add(axisAt(-0.205), mul(n, 0.014)), [0.072, 0.19, 0.016], C.ebony);
    R.piece('cushion', add(axisAt(-0.405), mul(n, 0.010)), [0.042, 0.018, 0.006], C.ebony, RX, 0, RZ);
    // F holes: 140 mm stems at the bridge station, with the upper and
    // lower hooks separated from the string plane so they remain legible
    // in front, side and rear three-quarter views.
    for (const side of [-1, 1]) {
      const q = d => add(add(axisAt(d), mul(v, side * 0.108)), mul(n, 0.010));
      // The inward notch is the endpoint at the bridge/stop line (AB, d=0).
      R.segment(q(-0.070), q(0.070), 0.0055, C.ebony, 'limb');
      R.segment(q(0.070), add(q(0.070), mul(v, side * 0.024)), 0.0045, C.ebony, 'limb');
      R.segment(q(-0.070), add(q(-0.070), mul(v, -side * 0.018)), 0.0045, C.ebony, 'limb');
      R.ball(q(-0.079), [0.008, 0.008, 0.008], C.ebony);
      R.ball(q(0.079), [0.007, 0.007, 0.007], C.ebony);
    }
    // Pegbox, scroll and four pegs.  These are separate from SCROLL's
    // historical anchor points; no fingering or collision coordinate moves.
    R.segment(SCROLL[0], SCROLL[1], 0.038, C.varnishDark, 'limb');
    R.ball(SCROLL[1], [0.042, 0.052, 0.042], C.varnishDark);
    R.ball(SCROLL[0], [0.028, 0.070, 0.026], C.varnishDark);
    for (let i = 0; i < 4; i++) {
      const p = add(SCROLL[0], mul(neckDirV, 0.014 + i * 0.018));
      for (const side of [-1, 1]) {
        const stem = add(p, add(mul(v, side * 0.050), mul(n, (i % 2 ? 0.012 : -0.004))));
        R.segment(p, stem, 0.006, C.varnishDark, 'limb');
        R.ball(add(stem, mul(v, side * 0.010)), [0.013, 0.018, 0.010], C.varnishDark);
      }
    }
    // Strings: nut -> bridge -> tailpiece; played string lit.
    const tp = add(axisAt(-0.205), mul(n, 0.024));
    for (let s = 0; s < 4; s++) {
      const hot = opts.hotString === s;
      R.segment(nutPoint(s), bridgePoint(s), hot ? 0.0028 : 0.0016, hot ? [1.0, 0.80, 0.45] : C.string, 'limb');
      R.segment(bridgePoint(s), add(tp, mul(v, offBridge(s) * 0.7)), 0.0014, C.string, 'limb');
    }
  }

  // The bowSegment line is the HAIR: it is the part that meets the
  // string, approaching from the front (audience side). The stick
  // rides 20 mm further toward the audience (+n) from the hair, and
  // the frog block sits on the stick at the frog end. (Previously the
  // stick was drawn on the contact line and the hair floated 20 mm in
  // front of the string, never touching it -- the bow read as
  // approaching the string from the wrong side.)
  function drawBow(R, s, f, geometry = null) {
    const { frog, tip } = geometry || bowSegment(s, f);
    R.segment(frog, tip, 0.0016, COLORS.hair, 'limb');
    const sF = add(frog, mul(n, 0.020)), sT = add(tip, mul(n, 0.020));
    R.segment(sF, sT, 0.006, COLORS.bowWood, 'limb');
    window.BowHand.drawFrog(R, window.BowHand.frog('cello', sF, sub(sT, sF), n), COLORS.ebony, [.7,.7,.72]);
    return { frog, tip, stickFrog: sF, stickTip: sT };
  }

  return {
    SCALE, AB, BRIDGE, NUT: NUTP, u, v, n, RX, RZ,
    BOARD: { A: boardA, B: boardB, END: BOARD_END, dir: boardDir, normal: boardNormal, euler: BOARD_EULER, nutN: BOARD_NUT_N, projN: BOARD_PROJ_N, surf: boardSurf, neckOff: NECK_OFF, widthAt, radius: BOARD_RADIUS, thicknessAt, crown, distance: q => surfaceDistance(q, 'board') },
    NECK: { depthAt: neckDepth, start: neckStart, end: neckEnd, distance: q => surfaceDistance(q, 'neck') }, drawNeckBoard,
    NECK_A, NECK_B, SCROLL,
    nutPoint, bridgePoint, stringPoint, semitonePoint, bowContact, boardPoint,
    BOW_LENGTH, bowDir, bowSegment, stringTilt, COLORS, BODY_SLICES, bodySpec, BODY_MESH, ENDPIN, drawCello, drawBow,
    vec: { add, sub, mul, dot, cross, norm, lerp }
  };
})();

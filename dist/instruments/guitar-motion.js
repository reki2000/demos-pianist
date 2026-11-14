'use strict';
/* Guitar geometry + performer motion planning.
 *
 * Units are metres; the audience/camera sits toward -Z.
 *
 * HANDEDNESS: the host renderer (gl.js) mirrors X (its toWorld maps
 * planning [x,y,z] to world [-x,y,z], cameras included), so this
 * module builds the scene MIRRORED in planning X: the neck rises
 * toward planning +X and the fretting arm's shoulder sits at
 * planning +X, which the renderer flips to the player's anatomical
 * left on screen. Shoulders below are named for the ANATOMICAL hand
 * (shL frets, shR plucks), not for the planning side they sit on.
 *
 * The guitar is placed in the classical seated posture (Yepes):
 * body on the raised left leg, neck angled steeply up to the
 * player's left (~44 deg). Its frame is
 * built from the nut point N, the neck axis u (bridge -> headstock),
 * the across-strings axis w (string 1 side -> string 6 side) and the
 * fretboard normal n. Fret wire distance from the nut follows the
 * 650 mm scale: d(f) = L * (1 - 2^(-f/12)).
 *
 * plan(song) runs the fingering engine and turns it into events;
 * pose(plan, t) reconstructs the performer at time t: left-hand
 * fingers land on the exact string/fret points the engine chose
 * (just behind the fret wire), the hand slides between positions
 * using the whole gap (arriving ~180 ms early), free fingers keep a
 * natural light curl, and right-hand fingers pluck their assigned
 * string at the soundhole.
 */
window.GuitarMotion = (() => {
const clamp = (v, a, b) => Math.max(a, Math.min(b, v)), smooth = v => { v = clamp(v, 0, 1); return v * v * v * (v * (v * 6 - 15) + 10); };
const add = (a, b) => a.map((v, i) => v + b[i]), sub = (a, b) => a.map((v, i) => v - b[i]), mul = (a, s) => a.map(v => v * s), dot = (a, b) => a.reduce((r, v, i) => r + v * b[i], 0), unit = a => mul(a, 1 / (Math.hypot(...a) || 1));
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

const SCALE = 0.650;
const NUT = [0.454, 1.341, -0.376];
let u = unit([0.6291, 0.6946, -0.3488]); // neck rises steeply (44 deg elevation) toward planning +X = the player's anatomical left on screen, yawed 29 deg toward the audience so the headstock reaches forward-left (Yepes reference photos); pivoted at the waist so the seat on the left thigh is unchanged
/* w is built with the renderer's own segment-frame formula
 * (x = norm(cross([0,0,1], dir))) so a 'tail'-loft fretboard drawn
 * along -u lies exactly in the string plane: w across the strings
 * (string 1 side -> string 6 side), n = u x w out of the fretboard. */
let w = unit(cross([0, 0, 1], mul(u, -1)));
let n = unit(cross(u, w));
const fretDist = f => SCALE * (1 - Math.pow(2, -f / 12));
const NUT_SPACING = 0.0086, BRIDGE_SPACING = 0.0116; // per-string step across w
function stringPoint(string, d, lift = 0.005) {
  const frac = clamp(d / SCALE, 0, 1), step = NUT_SPACING + (BRIDGE_SPACING - NUT_SPACING) * frac;
  return add(add(NUT, mul(u, -d)), add(mul(w, (3.5 - string) * step), mul(n, lift))); // mirrored frame: string 6 on the -w (chin) edge, string 1 on the +w edge
}
const fretPoint = (string, fret, behind = 0.006, lift) => stringPoint(string, Math.max(0, fretDist(fret) - (fret ? behind : 0)), lift);
const BODY_SPEC={start:.325,end:.815,length:.490,width:.370,depth:.099,top:-.006,back:-.105};
const BODY_OUTLINE=[[.325,0],[.332,.060],[.350,.103],[.380,.128],[.425,.141],[.460,.136],[.495,.121],[.530,.116],[.560,.125],[.600,.151],[.660,.177],[.715,.185],[.755,.174],[.785,.144],[.806,.090],[.815,0]];
function bodyWidth(d){
 let i=0;while(i<BODY_OUTLINE.length-2&&d>BODY_OUTLINE[i+1][0])i++;
 const sec=j=>(BODY_OUTLINE[j+1][1]-BODY_OUTLINE[j][1])/(BODY_OUTLINE[j+1][0]-BODY_OUTLINE[j][0]),tangent=j=>{if(!j)return sec(0);if(j===BODY_OUTLINE.length-1)return sec(j-1);const a=sec(j-1),b=sec(j);return a*b<=0?0:2*a*b/(a+b);};
 const [a,x]=BODY_OUTLINE[i],[b,y]=BODY_OUTLINE[i+1],h=b-a,t=Math.max(0,Math.min(1,(d-a)/h));return (2*t**3-3*t*t+1)*x+(t**3-2*t*t+t)*h*tangent(i)+(-2*t**3+3*t*t)*y+(t**3-t*t)*h*tangent(i+1);
}

const FRETS=20,BOARD_END=.452,NECK_END=.350;
const fretboardHalfWidth = d => d <= .325 ? .026+.005*Math.max(0,d)/.325 : .031+.001*Math.min(1,(d-.325)/(BOARD_END-.325));
function neckSection(d){const t=clamp(d/.325,0,1),heel=clamp((d-.325)/.025,0,1),width=.024+.005*t+.001*heel,back=-.021-.002*t-.027*heel;return {width,depth:(-.006-back)/2,centre:(-.006+back)/2};}
function neckDistance(d,v,z){const a=neckSection(d),y=z-a.centre,k0=Math.hypot(v/a.width,y/a.depth),k1=Math.hypot(v/(a.width*a.width),y/(a.depth*a.depth));const cross=k1>1e-10?k0*(k0-1)/k1:-Math.min(a.width,a.depth);return Math.max(cross,-.05-d,d-NECK_END);}
const PLUCK_D = SCALE - 0.115; // over the soundhole, 115 mm from the bridge
const pluckPoint = (string, lift = 0.006) => stringPoint(string, PLUCK_D, lift);
const bridgePoint = string => stringPoint(string, SCALE, 0.004);

/* Finger segment lengths (anatomical digits: thumb, index..little). */
const LENGTHS = [[.030,.023,.018],[.0368,.0224,.016],[.0416,.0256,.0176],[.0384,.024,.0168],[.0304,.0192,.0136]];
const REST_CURL = [0.5, 0.62, 0.68, 0.74, 0.8]; // PIP curl of a relaxed finger, thumb..little
/* Solve a 3-segment finger from base to target. Points are built from
 * angles (pianist's resultant construction), so segment lengths are
 * exact and the tip lands on the target whenever it is reachable.
 * extraCurl adds PIP bend (resting fingers), moving the tip off target. */
function resultant(ls, q) { return [ls[0] + ls[1] * Math.cos(q) + ls[2] * Math.cos(q * 1.65), -ls[1] * Math.sin(q) - ls[2] * Math.sin(q * 1.65)]; }
/* The finger bends in the plane spanned by (base->target) and bendHint:
 * e1 points at the target, e2 is the flexion direction inside that
 * plane. The 2D resultant construction then lands the tip exactly on
 * the target whenever the distance is within the finger's reach. */
function solveFinger(base, target, digit, bendHint, extraCurl = 0) {
  const ls = LENGTHS[digit];
  const v = sub(target, base), d = Math.hypot(...v);
  const maxD = ls[0] + ls[1] + ls[2] - 1e-6, minD = Math.hypot(...resultant(ls, 1.82));
  const reach = clamp(d, minD, maxD);
  let lo = 0, hi = 1.82;
  for (let i = 0; i < 18; i++) { const q = (lo + hi) / 2; if (Math.hypot(...resultant(ls, q)) > reach) lo = q; else hi = q; }
  const q = clamp((lo + hi) / 2 + extraCurl, 0, 1.82);
  const r = resultant(ls, q);
  const e1 = unit(v);
  let e2 = sub(bendHint, mul(e1, dot(bendHint, e1)));
  if (Math.hypot(...e2) < 1e-5) e2 = sub([0, -1, 0], mul(e1, -e1[1]));
  e2 = unit(e2);
  const ang = -Math.atan2(r[1], r[0]); // rotate the resultant onto e1
  const points = [base];
  for (let i = 0; i < 3; i++) {
    const a = ang - (i === 0 ? 0 : i === 1 ? q : q * 1.65);
    points.push(add(points[i], add(mul(e1, ls[i] * Math.cos(a)), mul(e2, ls[i] * Math.sin(a)))));
  }
  return { points, lengths: ls, angles: [ang, q, q * 0.65], error: Math.hypot(...sub(points[3], target)), target, contact: extraCurl === 0 };
}

// Compile a fretting choreography independently of the pluck clock. Lower
// stops may stay down beneath higher notes; a higher stop lifts for an open
// or lower sounding note on the same string. Repeated plucks never reset a grip.
function gripHolds(song,events){
 const phrases=song.leftHandPhrases;if(!phrases)return null;
 const raw=events.flatMap(e=>e.notes).sort((a,b)=>a.t-b.t||a.i-b.i),byFinger={1:[],2:[],3:[],4:[]};
 const key=n=>[n.string,n.fret,n.barre,n.barreGroup?.strings.join(',')||''].join(':');
 for(const p of phrases){
  const ns=raw.filter(n=>n.t>=p.startTime-1e-5&&n.t<p.endTime-1e-5),times=[...new Set([p.startTime,p.endTime,...ns.map(n=>n.t)])].sort((a,b)=>a-b);
  const requests=[1,2,3,4].map(f=>ns.filter(n=>n.lh===f));
  for(let j=0;j<times.length-1;j++){
   const start=times[j],end=times[j+1];if(end-start<1e-7)continue;
   const allowed=new Map();for(const n of ns){if(n.t>start+1e-6)break;allowed.set(n.string,n.fret);}
   for(let f=1;f<=4;f++){
    const list=requests[f-1];if(!list.length)continue;
    const source=list.findLast(n=>n.t<=start+1e-6)||list[0];let string=source.string,fret=source.fret,barre=0,strings=[string];
    if(f===1){
     const declared=p.barre&&fret===p.position;
     const possible=declared?Array.from({length:p.barre[1]-p.barre[0]+1},(_,i)=>p.barre[0]+i):[...new Set(p.stops.filter(q=>q.finger===1&&q.fret===fret).map(q=>q.string))];
     const safe=possible.filter(s=>(allowed.get(s)??Infinity)>=fret).sort((a,b)=>a-b);
     if(!safe.length)continue;
     // Do not flatten across an open/lower string between two stops.
     const runs=[];for(const s of safe){let r=runs.at(-1);if(!r||Array.from({length:s-r.at(-1)-1},(_,i)=>r.at(-1)+1+i).some(s=>(allowed.get(s)??Infinity)<fret)){r=[];runs.push(r);}r.push(s);}
     strings=runs.find(r=>r.includes(source.string))||runs.sort((a,b)=>b.length-a.length)[0];string=strings.at(-1);barre=strings.length>1?1:0;
    }else if((allowed.get(string)??Infinity)<fret)continue;
    const nt={...source,t:start,end,grip:true,string,fret,lh:f,barre};delete nt.barreGroup;
    if(barre){const points=strings.map(s=>fretPoint(s,fret,.002,.0042));nt.barreGroup={fret,end,notes:[nt],strings,points,target:add(fretPoint(string,fret,.002,.0042),mul(w,-.004)),span:Math.hypot(...sub(points.at(-1),points[0]))};}
    nt.ev={t:start,notes:[nt]};
    const prev=byFinger[f].at(-1);if(prev&&Math.abs(prev.end-start)<1e-5&&key(prev)===key(nt)){prev.end=end;if(prev.barreGroup)prev.barreGroup.end=end;}
    else byFinger[f].push(nt);
   }
  }
 }
 const final=phrases.at(-1).endTime;
 for(let f=1;f<=4;f++){
  const list=byFinger[f];
  for(let i=0;i<list.length;i++){
   const nt=list[i],next=list[i+1];if(next&&next.t-nt.end<1e-5)continue;
   const last=raw.filter(n=>n.lh===f&&n.t>=nt.t-1e-5&&n.t<nt.end-1e-5&&n.string===nt.string&&n.fret===nt.fret).at(-1);
   nt.end=Math.max(nt.t+.012,last?last.t+.014:nt.t+.012,nt.end-.060);if(nt.barreGroup)nt.barreGroup.end=nt.end;
  }
  list.push(...raw.filter(n=>n.lh===f&&n.t>=final-1e-5));list.sort((a,b)=>a.t-b.t||a.i-b.i);
 }
 return byFinger;
}

function plan(song) {
  if (!song.fingering) window.GuitarFingering.build(song);
  const A = song.fingering.assignments, notes = song.notes;
  // Hand events come from the fingering engine's own grouping (same
  // strum window, same feasibility split) — one source of truth.
  const grouped = window.GuitarFingering.groupEvents(notes, window.GuitarFingering.windowOf(song), song.tuning || window.GuitarFingering.OPEN);
  const events = grouped.map(ev => ({ t: ev.t, notes: ev.notes.map(i => { const nn = notes[i], a = A[i];
    return { i, t: nn[0], end: Math.min(nn[0] + nn[1],a.releaseAt??Infinity), pitch: nn[2], vel: nn[3], string: a.string, fret: a.fret, lh: a.lh, barre: a.barre, rh: a.rh, pos: a.pos, sweep: !!a.sweep, brush: !!a.brush }; }) }));
  for (const ev of events) for (const nt of ev.notes) nt.ev = ev;
  const chronological=events.flatMap(e=>e.notes).sort((a,b)=>a.t-b.t||a.i-b.i);
  // A string cannot retain its former fret after it is plucked again.
  // Keep the score/audio source notes intact; this is the fretting hold.
  const lastOnString=new Map();
  for(const nt of chronological){const old=lastOnString.get(nt.string);if(old){const handoff=old.lh&&nt.lh&&old.lh!==nt.lh?.045:0;old.end=Math.min(old.end,Math.max(old.t+.004,nt.t-handoff));}lastOnString.set(nt.string,nt);}
  // Release before a large shift, rather than stretching a held finger
  // across two positions. Source note timing and pitches remain untouched.
  const shiftEvents=events.filter(e=>e.notes.some(n=>n.fret>0));
  for(let i=1;i<shiftEvents.length;i++){
    const a=shiftEvents[i-1],b=shiftEvents[i],da=fretDist(a.notes[0].pos||1),db=fretDist(b.notes[0].pos||1);
    if(Math.abs(db-da)<=.060)continue;
    const travel=clamp(Math.abs(db-da)/1.6,.025,.22),release=Math.max(a.t+.004,b.t-.004-travel-.012);
    for(const ev of events){if(ev.t>=b.t)break;for(const nt of ev.notes)if(nt.fret>0&&nt.end>release)nt.end=Math.max(nt.t+.004,release);}
  }
  // Close a new barre after releasing the previous chord. Keeping its
  // old little finger pressed until the attack would stretch the compact
  // hand while the index is already preparing the next barre.
  let lastIndex=null;
  for(const b of events){
    const idx=b.notes.find(nt=>nt.lh===1);
    if(idx?.barre&&(!lastIndex?.barre||lastIndex.fret!==idx.fret)){
      const release=b.t-.050;
      for(const ev of events){if(ev.t>=b.t)break;for(const nt of ev.notes)if(nt.fret>0&&nt.t<release&&nt.end>release&&nt.end<=b.t+.030)nt.end=Math.max(nt.t+.004,release);}
    }
    if(idx)lastIndex=idx;
  }
  // Finish a former hold before forming the next chord. A hold ending
  // exactly at its onset must not pin the old wrist for that first frame.
  for(const b of events)if(b.notes.filter(n=>n.fret>0).length>=2){
    for(const nt of chronological){if(nt.t>=b.t)break;
      if(nt.fret&&nt.end>=b.t-.020&&nt.end<=b.t+.015&&!b.notes.some(q=>q.lh===nt.lh&&q.fret===nt.fret&&(q.string===nt.string||q.lh===1&&q.barre)))nt.end=Math.min(nt.end,Math.max(nt.t+.004,b.t-.035));
    }
  }
  // One barre spans a strummed/held chord, even when the MIDI event
  // window splits the bass and treble attacks into separate blocks.
  let barreGroup=null;
  for(const nt of chronological)if(nt.lh===1){
    if(!barreGroup||nt.fret!==barreGroup.fret||nt.t>barreGroup.end+.025)barreGroup={fret:nt.fret,end:nt.end,notes:[]};
    barreGroup.notes.push(nt);barreGroup.end=Math.max(barreGroup.end,nt.end);nt.barreGroup=barreGroup;
    if(nt.barre||barreGroup.notes.some(n=>n.barre)||new Set(barreGroup.notes.map(n=>n.string)).size>1)for(const n of barreGroup.notes)n.barre=Math.max(n.barre,1);
  }
  for(const group of new Set(events.flatMap(e=>e.notes.map(n=>n.barreGroup).filter(Boolean)))){
    group.strings=[...new Set(group.notes.map(n=>n.string))].sort((a,b)=>a-b);
    group.target=add(fretPoint(group.strings.at(-1),group.fret,.002,.0042),mul(w,-.004));
    group.points=group.strings.map(s=>fretPoint(s,group.fret,.002,.0042));
    group.span=Math.hypot(...sub(fretPoint(group.strings.at(-1),group.fret),fretPoint(group.strings[0],group.fret)));
  }
  // Lift the former fingertip before a new index barre takes over the
  // same fret/string, even when that string is not plucked again yet.
  for(const group of new Set(chronological.filter(n=>n.barre).map(n=>n.barreGroup))){
    const start=group.notes[0].t,lo=group.strings[0],hi=group.strings.at(-1);
    for(const nt of chronological){if(nt.t>=start)break;if(nt.lh>1&&nt.fret===group.fret&&nt.string>=lo&&nt.string<=hi)nt.end=Math.min(nt.end,Math.max(nt.t+.004,start-.045));}
  }
  // Per-LH-finger note lists (digits 1..4) and per-RH-finger lists.
  const lhByFinger = { 1: [], 2: [], 3: [], 4: [] }, rhByFinger = { p: [], i: [], m: [], a: [] };
  for (const ev of events) for (const nt of ev.notes) {
    if (nt.lh >= 1) lhByFinger[nt.lh].push(nt);
    rhByFinger[nt.rh].push(nt);
  }
  for(const list of [...Object.values(lhByFinger),...Object.values(rhByFinger)])list.sort((a,b)=>a.t-b.t||a.i-b.i);
  const grips=gripHolds(song,events);
  if(grips)for(let f=1;f<=4;f++)lhByFinger[f]=grips[f];
  // String vibration: last pluck time per string.
  const plucks = []; for (const ev of events) for (const nt of ev.notes) plucks.push({ t: nt.t, string: nt.string, vel: nt.vel });
  // Sounding-pitch segments (sweep line over note starts/ends) so
  // pose().activeNotes is exact at any t, not just near an event.
  const crit = [...new Set(notes.flatMap(n => [n[0], n[0] + n[1]]))].sort((a, b) => a - b);
  const byEnd = notes.map(n => ({ end: n[0] + n[1], pitch: n[2] })).sort((a, b) => a.end - b.end);
  const sounding = new Map(); let si = 0, ei2 = 0;
  const segments = crit.map(ct => {
    while (si < notes.length && notes[si][0] <= ct) { sounding.set(notes[si][2], (sounding.get(notes[si][2]) || 0) + 1); si++; }
    while (ei2 < byEnd.length && byEnd[ei2].end <= ct) { const p = byEnd[ei2].pitch, c = (sounding.get(p) || 0) - 1; if (c <= 0) sounding.delete(p); else sounding.set(p, c); ei2++; }
    return { t: ct, pitches: [...sounding.keys()] };
  });
  return { song, events, lhByFinger, rhByFinger, plucks, segments, grips, duration: song.duration };
}

function lowerBound(arr, t, key = 't') { let a = 0, b = arr.length; while (a < b) { const m = (a + b) >> 1; if (arr[m][key] < t) a = m + 1; else b = m; } return a; }
/* Hand anchor (distance from nut) at time t: the hand serves the current
 * event, then uses the gap to glide to the next position, arriving just
 * before the next onset. All-open events do not move the hand. */
/* Position keyframes for the palm anchor: (event time, fretDist of
 * the event's effective position), only where the value changes. */
function posKeys(plan) {
  if (plan._posKeys) return plan._posKeys;
  const posOf = ev => {
    const f = ev.notes.filter(x => x.fret > 0);
    if (!f.length) return -1;
    const p = ev.notes[0].pos;
    if (p > 0) {
      const lo = Math.min(...f.map(x => x.fret)), span = Math.max(...f.map(x => x.fret)) - lo;
      return span > 4 ? lo + (span - 4) / 2 : p;
    }
    return Math.max(1, Math.round(f.reduce((s2, x) => s2 + x.fret, 0) / f.length - 1));
  };
  const keys = [];
  for (const ev of plan.events) {
    const p = posOf(ev);
    if (p <= 0) continue;
    const d = fretDist(p);
    if (!keys.length || Math.abs(d - keys[keys.length - 1].d) > 1e-6) keys.push({ t: ev.t, d });
  }
  if(plan.song.leftHandPhrases){
    const phrases=plan.song.leftHandPhrases,tail=keys.filter(k=>k.t>=phrases.at(-1).endTime-1e-5);
    keys.splice(0,keys.length,...phrases.map(p=>({t:p.startTime,d:fretDist(p.position)})),...tail);
  }
  plan._posKeys = keys;
  return keys;
}
/* Hand anchor (distance from nut) at time t: glide between position
 * keyframes, arriving ~4 ms before each keyframe; the glide duration
 * scales with distance (max ~1.6 m/s along the neck) so the palm
 * never teleports, even between dense fallback-position events. */
function anchorAt(plan, t) {
  const keys = posKeys(plan);
  if (!keys.length) return fretDist(1);
  let k = -1;
  for (let i = 0; i < keys.length; i++) { if (keys[i].t <= t + 0.005) k = i; else break; }
  if (k < 0) return keys[0].d;
  const cur = keys[k], nxt = keys[k + 1];
  if (!nxt) return cur.d;
  const D = clamp(Math.abs(nxt.d - cur.d) / 1.6, 0.025, 0.22);
  const end = nxt.t - 0.004;
  let start = Math.max(cur.t - 0.004, end - D);
  if (start > end - 0.006) start = end - 0.006;
  if (t <= start) return cur.d;
  const s = smooth((t - start) / Math.max(1e-4, end - start));
  return cur.d + (nxt.d - cur.d) * s;
}

function poseLegacy(plan, t, solve = true) {
  const { song, events } = plan;
  const anchorD = anchorAt(plan, t);
  const palm = add(add(NUT, mul(u, -anchorD)), add(mul(n, -0.034), mul(w, -0.006)));
  const lhFingers = [], lhTargets = [];
  const mixP = (a, b, s) => a.map((v, k) => v + (b[k] - v) * s);
  const REST_E = d => REST_CURL[d] * 0.55;
  /* A note's press point. A barre finger aims across the whole group it
   * covers in its event (tip past the far string), slightly flattened. */
  const notePoint = (nt, lift) => {
    if (nt.barre && nt.ev) {
      const far = Math.max(...nt.ev.notes.filter(x => x.lh === nt.lh && x.fret === nt.fret).map(x => x.string));
      return add(fretPoint(far, nt.fret, 0.002, lift), mul(w, -0.004)); // tip reaches past the bass-most covered string
    }
    return fretPoint(nt.string, nt.fret, 0.006, lift);
  };
  for (let digit = 1; digit <= 4; digit++) {
    /* Segment scheme per finger: HOLD the current note's press point,
     * TRAVEL to the next note over the gap (arcing off the board),
     * RELEASE to rest after the last note. Segment boundaries are
     * continuous by construction: travel starts and ends exactly on
     * the hold points, and the curl (extra) blends between the same
     * endpoint values the neighbouring segments use. */
    const list = plan.lhByFinger[digit];
    const ni = lowerBound(list, t + 1e-9);
    const A = ni > 0 ? list[ni - 1] : null;      // last started note
    const B = ni < list.length ? list[ni] : null; // next note
    const root = add(palm, add(mul(w, (digit - 1) * 0.0195 - 0.024), add(mul(n, -0.002), mul(u, -0.002 - (digit === 2 ? 0.003 : 0)))));
    const rest = add(palm, add(mul(w, (digit - 1) * 0.018 - 0.020), add(mul(n, 0.036), mul(u, -0.014))));
    const holdExtra = nt => nt ? (nt.barre ? -0.30 : 0) : REST_E(digit);
    let target = rest, extra = REST_E(digit), contact = false, barre = 0;
    if (A) {
      const pressRamp = smooth((t - (A.t - 0.035)) / 0.035);
      target = notePoint(A, 0.0042); extra = 0.25 + (holdExtra(A) - 0.25) * pressRamp; barre = A.barre;
      contact = t >= A.t - 0.005 && t <= A.end + 0.02;
    }
    // Travel window to B: starts after A has sounded (or 180 ms out
    // from rest), ends just before B's onset; at least 12 ms wide.
    let w0 = null, w1 = null;
    if (B) {
      w1 = B.t - 0.004;
      w0 = !A ? B.t - 0.18 : Math.max(A.t + 0.004, Math.min(A.end - 0.02, B.t - 0.05));
      if (w0 > w1 - 0.012) w0 = w1 - 0.012;
    }
    if (B && t >= w0) {
      const s = smooth((t - w0) / (w1 - w0));
      const from = A ? notePoint(A, 0.0042) : rest;
      target = mixP(from, notePoint(B, 0.0042), s);
      target = add(target, mul(n, Math.sin(Math.PI * s) * 0.006)); // arc off the board mid-travel
      extra = (A ? holdExtra(A) : REST_E(digit)) + (holdExtra(B) - (A ? holdExtra(A) : REST_E(digit))) * s;
      barre = s > 0.5 ? B.barre : barre; contact = false;
    } else if (A && t > A.end + 0.02) { // release toward rest
      const s = smooth((t - A.end - 0.02) / 0.12);
      target = mixP(notePoint(A, 0.0042), rest, s);
      extra = holdExtra(A) + (REST_E(digit) - holdExtra(A)) * s; contact = false;
    }
    const edgeHint = sub(stringPoint(6, anchorD, 0.0), root);
    const f = solve ? solveFinger(root, target, digit, edgeHint, extra) : {target, error:0};
    f.requestedContact = contact;f.preparing = !!B && t >= w0;
    f.contact = contact && f.error < 0.006; f.digit = digit; f.barre = barre;
    lhFingers.push(f); lhTargets.push(target);
  }
  // Left thumb behind the neck, opposite the position.
  const thumbTarget = add(add(NUT, mul(u, -anchorD)), mul(n, -0.020));
  const thumbRoot = add(palm, add(mul(w, -0.020), mul(n, -0.010)));
  const thumb = solve ? solveFinger(thumbRoot, thumbTarget, 0, mul(w, 1), 0.3) : {target:thumbTarget}; thumb.digit = 0;
  // Right hand at the soundhole.
  const rhBase = add(stringPoint(3, PLUCK_D, 0.052), mul(w, 0.004));
  const rhDef = { p: { digit: 0, rootOff: [-0.046, -0.010, -0.014], rest: 5 }, i: { digit: 1, rootOff: [-0.010, 0.004, 0.006], rest: 3 }, m: { digit: 2, rootOff: [0.010, 0.006, 0.008], rest: 2 }, a: { digit: 3, rootOff: [0.028, 0.002, 0.006], rest: 1 } };
  const rhFingers = {};
  for (const name of ['p', 'i', 'm', 'a']) {
    const def = rhDef[name];
    const root = add(rhBase, add(mul(w, def.rootOff[0]), add(mul(n, def.rootOff[1]), mul(u, def.rootOff[2]))));
    const list = plan.rhByFinger[name];
    const ni = lowerBound(list, t + 1e-4);
    const cur = ni > 0 ? list[ni - 1] : null, nxt = ni < list.length ? list[ni] : null;
    let string = def.rest, env = 0;
    if (cur && t - cur.t < 0.10) { string = cur.string; env = Math.cos(Math.PI * clamp((t - cur.t) / 0.085, 0, 1) / 2); }
    else if (cur && t - cur.t < 0.35) string = cur.string;
    const lift = 0.017 - env * 0.012;
    let target = add(pluckPoint(string, lift), mul(w, (name === 'p' ? 1 : -1) * .003 * Math.sin(Math.PI * (1-env))));
    if (cur && t - cur.t > 0.35 && string !== def.rest) { // fade the string memory out, never snap
      const s = smooth((t - cur.t - 0.35) / 0.2);
      target = target.map((v, k) => v + (pluckPoint(def.rest, 0.011)[k] - v) * s);
    }
    if (nxt && nxt.string !== string && nxt.t - t < 0.12) { // prepare after the current attack
      const end=nxt.t-.002,start=Math.min(end-.002,Math.max(cur?cur.t+.002:-Infinity,nxt.t-.12));
      const s = smooth((t-start)/(end-start));
      target = target.map((v, k) => v + (pluckPoint(nxt.string, 0.005)[k] - v) * s);
    }
    const f = solve ? solveFinger(root, target, def.digit, name === 'p' ? add(mul(w, 0.6), mul(n, -0.4)) : add(mul(n, -1), mul(u, -0.35)), name === 'p' ? 0.25 : 0.35 - env * 0.3) : {target};
    f.contact = !!cur && Math.abs(t-cur.t)<.006; f.digit = def.digit; f.string = string; f.env = env;
    rhFingers[name] = f;
  }
  // Arms: shoulders fixed to the torso, two-bone IK with exact lengths.
  const sway = 0.012 * Math.sin(t * 0.45), lean = 0.05 + 0.02 * Math.sin(t * 0.23 + 1.2);
  const shL = [0.205, 1.435 + sway * 0.3, -0.055], shR = [-0.205, 1.435 - sway * 0.3, -0.055]; // planning sides mirrored (see header): shL renders as the anatomical left shoulder
  const armIK = (S, W, out) => {
    const L1 = 0.315, L2 = 0.30, d = clamp(Math.hypot(...sub(W, S)), 0.1, L1 + L2 - 0.002);
    const dir = unit(sub(W, S));
    const a = Math.acos(clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1));
    const bend = unit(sub(out, mul(dir, dot(out, dir))));
    const E = add(add(S, mul(dir, L1 * Math.cos(a))), mul(bend, L1 * Math.sin(a)));
    return { shoulder: S, elbow: E, wrist: W, lengths: [L1, L2], error: Math.abs(Math.hypot(...sub(W, E)) - L2) };
  };
  const wristL = add(palm, mul(n, -0.012));
  const wristR = add(rhBase, add(mul(w, -0.016), mul(n, 0.014)));
  const arms = [armIK(shL, wristL, [1, -0.5, 0.25]), armIK(shR, wristR, [-1, -0.6, -0.1])];
  // String shimmer envelopes + active pitches.
  const vib = {};
  for (let s = 1; s <= 6; s++) vib[s] = 0;
  for (const p of plan.plucks) { if (p.t > t) break; const age = t - p.t; if (age < 0.5) vib[p.string] = Math.max(vib[p.string], (p.vel / 127) * Math.exp(-age * 10)); }
  const segi = lowerBound(plan.segments, t + 1e-9) - 1;
  const activeNotes = segi >= 0 ? plan.segments[segi].pitches : [];
  return { t, palm, anchorD, lhFingers, lhThumb: thumb, rhFingers, arms, vib, activeNotes, torso: { lean, sway, nod: 0 }, wristL, wristR };
}

function pose(plan,t){return window.GuitarHands?.available(plan) ? window.GuitarHands.pose(plan,t,poseLegacy(plan,t,false)) : poseLegacy(plan,t);}

return { gripSource:()=>[gripHolds,posKeys].map(f=>f.toString()).join('\n'), poseLegacy, BODY_SPEC,BODY_OUTLINE,bodyWidth,FRETS,BOARD_END,NECK_END,neckSection,neckDistance,fretboardHalfWidth, SCALE, NUT, u, w, n, fretDist, stringPoint, fretPoint, pluckPoint, bridgePoint, PLUCK_D, LENGTHS, solveFinger, plan, pose, lowerBound };
})();

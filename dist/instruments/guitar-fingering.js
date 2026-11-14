'use strict';
/* Classical-guitar fingering engine.
 *
 * For every note it chooses (string, fret), a left-hand finger
 * (1-4; 0 = open string; barré flagged) and a right-hand finger
 * (p/i/m/a), following standard classical practice:
 *
 * TUNING   strings 1..6 open at E4 B3 G3 D3 A2 E2 = MIDI 64 59 55 50
 *          45 40 (song.tuning overrides — Capricho Árabe is drop D).
 *          Frets 0..20 (650 mm scale geometry lives in the motion
 *          module; pitch here is open + fret by construction).
 * EVENTS   Notes are grouped into hand events: exact simultaneities
 *          for engraved sources; performed sources (humanised MIDI)
 *          pass song.strumWindow (e.g. 0.05 s) so a strummed chord
 *          spread over a few tens of ms is ONE hand configuration.
 * LH       Beam search over (string, fret) per event. Cost prefers
 *   - lower positions mildly, open strings slightly;
 *   - staying on the string a melodic line already uses;
 *   - few/small position shifts (a shift is cheaper when the gap
 *     before the event leaves time for it);
 *   - NOT re-fretting a string whose note is still ringing.
 *   Then fingers by the position rule finger = fret - position + 1
 *   (open strings take none). The position anchor PERSISTS from the
 *   previous event when the event fits it, which is what makes scale
 *   runs come out in one position. Several notes at one fret share
 *   finger 1 = barré (flag 1 = partial, 2 = full across the played
 *   span); other same-fret groups are fingered spreading toward the
 *   treble side (the F-major shape 1-3-4-2-1-1). Notes still held
 *   from earlier events keep their fingers; combos that contradict a
 *   held finger are priced near-infinitely.
 * RH       Chords: p takes the lowest note(s) — the two lowest bass
 *   strings can be a thumb sweep — then i/m/a by string (3->i, 2->m,
 *   1->a). Single-note chains are classed: TREMOLO (even fast stream
 *   with a dominating treble line and interleaved accompaniment —
 *   the Recuerdos texture) -> melody events cycle a-m-i
 *   continuously, accompaniment takes p or its string finger;
 *   ARPEGGIO (sawtooth cycling over few pitch classes) -> fixed
 *   string map; MELODY (everything else) -> strict i-m alternation.
 * VALIDATE An independent pass re-derives the hard rules from the
 *   assignments: pitch identity, per-event feasibility (distinct
 *   fingers/strings, one fret per finger unless barré, span), and —
 *   over the engine's own role labels — RH alternation within
 *   melodic runs and thumb placement. Softer style counts (position
 *   jumps on short notice, tight finger moves, arpeggio same-string
 *   repeats, ringing re-frets) are reported for pinning, not hidden.
 */
const OPEN = [0, 64, 59, 55, 50, 45, 40]; // standard tuning, index = string 1..6
const MAXFRET = 20;
const EPS = 0.005; // exact-simultaneity epsilon, seconds

const fretOf = (pitch, string, open = OPEN) => pitch - open[string];
function optionsFor(pitch, open = OPEN) {
  const out = [];
  for (let s = 1; s <= 6; s++) { const f = fretOf(pitch, s, open); if (f >= 0 && f <= MAXFRET) out.push({ string: s, fret: f }); }
  return out;
}
const windowOf = song => song.strumWindow || EPS;

/* Group note indices into hand events by onset window. A note does
 * NOT join the group when the enlarged group has no distinct-string
 * assignment at all (e.g. a 30 ms-apart ascending run that merely
 * falls inside a strum window is a run, not a chord). */
function groupEvents(notes, win, open = OPEN) {
  const events = [];
  for (let i = 0; i < notes.length; i++) {
    const last = events[events.length - 1];
    if (last && notes[i][0] - last.t <= win &&
        eventCandidates([...last.notes, i], open, notes).length) last.notes.push(i);
    else events.push({ t: notes[i][0], notes: [i] });
  }
  for (const ev of events) ev.notes.sort((a, b) => notes[a][2] - notes[b][2]);
  return events;
}

/* Candidate (string, fret) sets per event: distinct strings within
 * the event; spans over 7 frets pruned as physically absurd. */
function eventCandidates(evNotes, open, notes) {
  const opts = evNotes.map(i => optionsFor(notes[i][2], open));
  if (opts.some(o => !o.length)) return [];
  let combos = [[]];
  for (let k = 0; k < evNotes.length; k++) {
    const next = [];
    for (const c of combos) for (const o of opts[k]) {
      if (c.some(x => x.string === o.string)) continue;
      next.push([...c, o]);
    }
    combos = next;
    if (combos.length > 120) {
      combos.sort((a, b) => Math.min(...a.map(x => x.fret || 99)) - Math.min(...b.map(x => x.fret || 99)));
      combos = combos.slice(0, 120);
    }
    if (!combos.length) return [];
  }
  return combos.filter(c => {
    const fs = c.filter(x => x.fret > 0).map(x => x.fret);
    return !fs.length || Math.max(...fs) - Math.min(...fs) <= 9;
  });
}

/* Fingers for one event's (string, fret) set given a position anchor.
 * Returns null when infeasible. barre: 0 none, 1 partial, 2 full. */
function fingersFor(combo, anchorPos) {
  const fretted = combo.filter(x => x.fret > 0);
  if (!fretted.length) return { fingers: combo.map(() => 0), pos: anchorPos || 0, barre: 0 };
  const minF = Math.min(...fretted.map(x => x.fret)), maxF = Math.max(...fretted.map(x => x.fret));
  const byFret = new Map();
  for (const x of fretted) { if (!byFret.has(x.fret)) byFret.set(x.fret, []); byFret.get(x.fret).push(x); }
  const posCand = new Set([minF, minF - 1, minF - 2, minF - 3, anchorPos, maxF - 3].filter(p => p >= 1));
  let best = null;
  for (const pos of posCand) {
    const fingersTrial = new Map(); let ok = true, barre = 0;
    for (const [fret, group] of [...byFret.entries()].sort((a, b) => a[0] - b[0])) {
      const base = fret - pos + 1;
      if (group.length === 1) {
        if (base < 1 || base > 5) { ok = false; break; }
        fingersTrial.set(group[0], Math.min(base, 4)); // base 5 = finger 4 stretched
      } else if (base === 1) {
        for (const x of group) fingersTrial.set(x, 1);
        barre = Math.max(barre, group.length >= 4 ? 2 : 1);
      } else if (base >= 2 && base <= 4 && group.length <= 5 - base) {
        // Spread toward the treble side: increasing fingers go to
        // DECREASING string numbers (F major: s5=3, s4=4, s3=2 with
        // the barré at fret 1 handled by the base===1 branch).
        const sorted = [...group].sort((a, b) => b.string - a.string);
        sorted.forEach((x, j) => fingersTrial.set(x, base + j));
        if (sorted.some(x => fingersTrial.get(x) > 4)) { ok = false; break; }
      } else { ok = false; break; }
    }
    if (!ok) continue;
    const used = new Map();
    for (const x of fretted) {
      const f = fingersTrial.get(x);
      if (used.has(f) && used.get(f) !== x.fret) { ok = false; break; }
      used.set(f, x.fret);
    }
    if (!ok) continue;
    const stretch = Math.max(0, (maxF - minF) - 3);
    // Prefer the anchor position, then positions near it; at the
    // start of a piece prefer the neutral shape (lowest fret under
    // finger 2), which keeps scale runs in one position.
    const score = stretch * 6 + (anchorPos ? Math.abs(pos - anchorPos) * 1 : Math.abs((minF - pos + 1) - 2))
      + ([...fingersTrial.values()].some((f, ix) => f === 4 && fretted[ix] && fretted[ix].fret - pos + 1 === 5) ? 8 : 0);
    if (!best || score < best.score) best = { fingers: combo.map(x => x.fret === 0 ? 0 : fingersTrial.get(x)), pos, barre, score };
  }
  // A compact four-note chord can compress the positional rule (e.g.
  // frets 2,4,4,5 use fingers 1,2,3,4). Never assign a curved finger
  // to two strings as the old infeasible-group fallback did.
  if(!best&&fretted.length<=4){
    const order=[...fretted].sort((a,b)=>a.fret-b.fret||b.string-a.string),map=new Map(order.map((x,i)=>[x,i+1]));
    best={fingers:combo.map(x=>x.fret?map.get(x):0),pos:minF,barre:0,score:20};
  }
  return best;
}

function comboCost(combo, ff, ctx) {
  let c = 0;
  const fretted = combo.filter(x => x.fret > 0);
  const pos = ff ? ff.pos : 0;
  if (fretted.length) c += pos * 0.55 + Math.max(...fretted.map(x => x.fret)) * 0.12;
  c += combo.filter(x => x.fret === 0).length * -0.4;
  if (!ff) { c += 1000000; const fs = fretted.map(x => x.fret); if (fs.length) c += (Math.max(...fs) - Math.min(...fs)) * 6; } // infeasible fingers; among infeasible, prefer compact
  else {
    const span = fretted.length ? Math.max(...fretted.map(x => x.fret)) - Math.min(...fretted.map(x => x.fret)) : 0;
    if (span > 3) c += (span - 3) * 18;
    if (ff.barre) c += ff.barre === 2 ? 1.2 : 0.7;
  }
  if (ff) for (let k = 0; k < combo.length; k++) {
    const h = ctx.heldByFinger.get(ff.fingers[k]);
    if (ff.fingers[k] >= 1 && h && h.fret !== combo[k].fret) c += 400; // contradicts a held finger
  }
  // The compact B hand must serve held notes and the new event together.
  // Open strings need no fretting finger. Price physical distance, not just
  // fret count, since the same fret span is wider near the nut.
  const heldFrets=(ctx.heldNotes||[]).map(x=>x.fret),allFrets=[...fretted.map(x=>x.fret),...heldFrets].filter(f=>f>0);
  if(allFrets.length){const d=f=>.650*(1-2**(-f/12)),span=d(Math.max(...allFrets))-d(Math.min(...allFrets));c+=Math.max(0,span-.100)*50000;}
  const top = combo[combo.length - 1];
  if (ctx.prevTop && top.pitch !== ctx.prevTop.pitch && top.string === ctx.prevTop.string) c -= 1.6; // melodic string continuity
  for (const x of combo) {
    const ring = ctx.ringing.get(x.string);
    if (ring && ring.pitch !== x.pitch && ring.until > ctx.t + 0.02) c += 6; // cuts a ringing string
  }
  if (ctx.prevPos && pos && pos !== ctx.prevPos) {
    const gap = ctx.t - ctx.prevT;
    c += Math.abs(pos - ctx.prevPos) * (gap < 0.09 ? 13 : gap < 0.2 ? 7 : gap < 0.45 ? 3 : 1.1);
  }
  if (ff && ctx.prevPos && ff.pos === ctx.prevPos) c -= 2.5; // position persistence
  return c;
}

/* LH fingers per event from the chosen combos: position-rule
 * assignment with a persistent anchor; still-sounding notes' fingers
 * were already priced into the beam via heldByFinger. */
function assignFingers(song, events, chosen) {
  // Applies the (string, fret) combos AND the finger assignment the
  // beam actually priced (recomputing here could diverge from the
  // beam's anchor chain and invent conflicts it had avoided).
  const notes = song.notes, out = new Array(notes.length);
  events.forEach((ev, ei) => {
    const { combo, ff } = chosen[ei];
    combo.forEach((x, k) => out[ev.notes[k]] = { string: x.string, fret: x.fret, pitch: notes[ev.notes[k]][2], lh: 0, barre: 0, rh: null, role: 'chord', pos: ff ? ff.pos : 0, ev: ei });
    if (ff) combo.forEach((x, k) => { const a = out[ev.notes[k]]; a.lh = ff.fingers[k]; a.barre = ff.barre && ff.fingers[k] === 1 ? ff.barre : 0; });
    else { // Infeasible group (e.g. a wide strum the hand re-forms
      // mid-strum): repair greedily — fingers in fret order — so the
      // hand still looks plausible; validate() counts these honestly.
      const order = combo.map((x, k) => k).filter(k => combo[k].fret > 0).sort((a, b) => combo[a].fret - combo[b].fret);
      const byFret = new Map(); let nextF = 1;
      for (const k of order) { if (!byFret.has(combo[k].fret)) byFret.set(combo[k].fret, Math.min(4, nextF++)); out[ev.notes[k]].lh = byFret.get(combo[k].fret); }
    }
  });
  return out;
}

/* Tremolo streams: long even runs of single notes whose treble line
 * (within 5 semitones of the run's top pitch) dominates, with lower
 * accompaniment interleaved — the Recuerdos texture. */
function detectTremolo(events, notes) {
  const mark = new Map();
  let i = 0;
  while (i < events.length) {
    if (events[i].notes.length !== 1) { i++; continue; }
    let j = i + 1, gPrev = null;
    while (j < events.length && events[j].notes.length === 1) {
      const g = events[j].t - events[j - 1].t;
      if (g > 0.30 || g < 0.03 || (gPrev !== null && Math.max(g, gPrev) / Math.min(g, gPrev) > 1.5)) break;
      gPrev = g; j++;
    }
    const run = events.slice(i, j);
    if (run.length >= 16) {
      const pitches = run.map(ev => notes[ev.notes[0]][2]);
      const top = Math.max(...pitches);
      if (pitches.filter(p => p >= top - 5).length / pitches.length >= 0.55) {
        let local = Math.max(...pitches.slice(0, 4)); // seed with the line, not a leading bass note
        run.forEach((ev, k) => {
          const p = pitches[k];
          if (p >= local - 5) { mark.set(i + k, 'trem-mel'); local = Math.max(local - 2, p); }
          else mark.set(i + k, 'trem-acc');
        });
      }
    }
    i = Math.max(j, i + 1);
  }
  return mark;
}

const STRING_RH = { 6: 'p', 5: 'p', 4: 'p', 3: 'i', 2: 'm', 1: 'a' };
function assignRH(song, events, A) {
  const notes = song.notes;
  const trem = detectTremolo(events, notes);
  let alt = 'i', tremCycle = 0;
  const TREM_SEQ = ['a', 'm', 'i'];
  // Classify single-note chains: arpeggio vs melody.
  const role = new Map();
  let i = 0;
  while (i < events.length) {
    if (events[i].notes.length !== 1 || trem.has(i)) { i++; continue; }
    let j = i + 1;
    while (j < events.length && events[j].notes.length === 1 && !trem.has(j) &&
           events[j].t - events[j - 1].t <= 0.45 &&
           Math.abs(notes[events[j].notes[0]][2] - notes[events[j - 1].notes[0]][2]) <= 12) j++;
    const chain = events.slice(i, j);
    if (chain.length >= 6) {
      const ps = chain.map(ev => notes[ev.notes[0]][2]);
      const pcs = new Set(ps.map(p => p % 12));
      let turns = 0; for (let k = 2; k < ps.length; k++) if ((ps[k] - ps[k - 1]) * (ps[k - 1] - ps[k - 2]) < 0) turns++;
      const arp = pcs.size <= 5 && turns / (ps.length - 2) >= 0.35;
      chain.forEach((ev, k) => role.set(i + k, arp ? 'arp' : 'mel'));
    }
    i = Math.max(j, i + 1);
  }
  let lastArp = null; // {string, rh} of the previous arpeggio note
  events.forEach((ev, ei) => {
    if (ev.notes.length >= 2) { // chord / strum block: p-i-m-a by string
      const idx = [...ev.notes].sort((a, b) => A[b].string - A[a].string); // string 6 (bass) first
      const used = new Set(); let pCount = 0;
      for (const ni of idx) {
        const a = A[ni]; a.role = 'chord';
        let f = STRING_RH[a.string];
        if (f === 'p') {
          pCount++;
          if (pCount <= 2) { a.rh = 'p'; if (pCount === 2) { a.sweep = true; A[idx[0]].sweep = true; } used.add('p'); continue; }
          f = 'i';
        }
        if (used.has(f)) f = ['i', 'm', 'a'].find(x => !used.has(x)) || f;
        a.rh = f; used.add(f);
        if (STRING_RH[a.string] !== f) a.brush = true;
      }
      return;
    }
    const ni = ev.notes[0], a = A[ni];
    const tr = trem.get(ei);
    if (tr === 'trem-mel') { a.role = 'trem-mel'; a.rh = TREM_SEQ[tremCycle++ % 3]; return; }
    if (tr === 'trem-acc') { a.role = 'trem-acc'; a.rh = a.string >= 4 ? 'p' : STRING_RH[a.string]; return; }
    const r = role.get(ei) || 'mel';
    a.role = r;
    if (r === 'mel' && a.string >= 6) { a.rh = 'p'; return; } // string-6 melody: thumb (alternation resumes above)
    if (r === 'arp') {
      let f = STRING_RH[a.string];
      // Striking the same treble string twice in an arpeggio stream
      // alternates fingers (a<->m on string 1, m<->i on 2-3); thumb
      // repeats on bass strings are normal pedal practice.
      if (lastArp && lastArp.string === a.string && a.string <= 3 && lastArp.rh === f)
        f = a.string === 1 ? (f === 'a' ? 'm' : 'a') : (f === 'm' ? 'i' : 'm');
      a.rh = f; lastArp = { string: a.string, rh: f };
      return;
    }
    a.rh = alt; alt = alt === 'i' ? 'm' : 'i'; // strict i-m alternation
  });
  // Authored p-a-m-i texture is rhythmic, rather than a global pitch threshold.
  // High accompaniment notes must still be played by the thumb.
  if(song.rightHandTremolo){
    const {bpm,endBeat}=song.rightHandTremolo;let cycle=0;
    events.forEach(ev=>{if(ev.notes.length!==1)return;const ni=ev.notes[0],beat=notes[ni][0]*bpm/60;if(beat>=endBeat-1e-4)return;

      const a=A[ni];if(Math.abs(beat*2-Math.round(beat*2))<.001){a.rh='p';a.role='trem-acc';}
      else{a.rh=['a','m','i'][cycle++%3];a.role='trem-mel';}
    });
  }

}

// Reuse an already held index barre for equal-fret treble notes. A note
// above the barre still needs another finger. Extending the barre must not
// mute an open/lower-fret string sounding inside its span.
function reuseBarres(notes,assignments){
 const ringing=new Map();let index=null,changed=0;
 for(let i=0;i<notes.length;){
  let end=i+1;while(end<notes.length&&notes[end][0]===notes[i][0])end++;
  const t=notes[i][0],current=assignments.slice(i,end),own=current.find(a=>a.lh===1);
  for(const [s,r]of ringing)if(r.until<=t+1e-8)ringing.delete(s);
  if(own&&(!index||own.fret!==index.fret))index={fret:own.fret,until:t,notes:[]};
  if(index&&index.until<t-1e-8)index=null;
  if(!index&&own)index={fret:own.fret,until:t,notes:[]};
  if(index){
   for(let k=i;k<end;k++)if(assignments[k].lh===1){index.until=Math.max(index.until,t+notes[k][1]);index.notes.push(assignments[k]);}
   for(let k=i;k<end;k++){
    const a=assignments[k];if(a.lh<=1||a.string!==1||a.fret!==index.fret||current.some(b=>b.lh===1&&b.fret!==a.fret))continue;
    const span=Math.max(a.string,...index.notes.map(b=>b.string)),nextStrings=new Set(current.map(b=>b.string));
    const blocked=[...ringing].some(([s,r])=>s<=span&&!nextStrings.has(s)&&r.fret<a.fret)||current.some(b=>b.string<=span&&b.fret<a.fret);
    if(blocked)continue;
    a.lh=1;a.barre=1;for(const b of index.notes)b.barre=Math.max(1,b.barre);index.notes.push(a);index.until=Math.max(index.until,t+notes[k][1]);changed++;
   }
  }
  for(let k=i;k<end;k++){const a=assignments[k];ringing.set(a.string,{fret:a.fret,until:t+notes[k][1]});}
  i=end;
 }
 return changed;
}

function build(song) {
  const open = song.tuning || OPEN;
  const notes = song.notes, win = windowOf(song);
  const events = groupEvents(notes, win, open);
  let beam = [{ cost: 0, picks: [], prevPos: 0, prevTop: null, ringing: new Map(), heldByFinger: new Map() }];
  let unplayable = 0;
  events.forEach((ev, ei) => {
    const hints = song.fingeringHints || {};
    const combos = eventCandidates(ev.notes, open, notes).filter(combo=>combo.every((x,k)=>{
      const h=hints[ev.notes[k]];return !h||(h.string==null||h.string===x.string)&&(h.lh!==0||x.fret===0)&&(h.lh==null||h.lh===0||x.fret>0);
    }));
    if (!combos.length) unplayable += ev.notes.length;
    const usable = combos.length ? combos : [ev.notes.map(ni => optionsFor(notes[ni][2], open)[0] || { string: 1, fret: 0 })];
    const next = [];
    for (const st of beam) {
      const held = new Map();
      for (const [f, h] of st.heldByFinger) if (h.until > ev.t + EPS) held.set(f, h);
      for (const combo0 of usable) {
        const combo = combo0.map((x, k) => ({ ...x, pitch: notes[ev.notes[k]][2] }));
        let ff = fingersFor(combo.map(x => ({ ...x })), st.prevPos);
        if(ff){ff={...ff,fingers:ff.fingers.slice()};combo.forEach((x,k)=>{const h=hints[ev.notes[k]];if(h?.lh!=null)ff.fingers[k]=h.lh;});
          if(combo.length===1&&combo[0].fret>0&&hints[ev.notes[0]]?.lh)ff.pos=Math.max(1,combo[0].fret-ff.fingers[0]+1);
          const occupied=new Map();for(let k=0;k<combo.length;k++){const f=ff.fingers[k];if(f&&occupied.has(f)&&(f!==1||occupied.get(f)!==combo[k].fret)){ff=null;break;}if(f)occupied.set(f,combo[k].fret);}
        }
        const replaced=new Set(combo.map(x=>x.string));
        const heldNotes=[...st.ringing.entries()].filter(([s,r])=>!replaced.has(s)&&r.until>ev.t+EPS&&r.fret>0).map(([s,r])=>({...r,string:s}));
        const effectiveHeld=new Map();for(const r of heldNotes){const old=effectiveHeld.get(r.finger);if(!old||old.until<r.until)effectiveHeld.set(r.finger,r);}
        const ctx = { heldNotes, prevPos: st.prevPos, prevTop: st.prevTop, ringing: st.ringing, heldByFinger: effectiveHeld, t: ev.t, prevT: ei > 0 ? events[ei - 1].t : ev.t - 1 };
        const c = comboCost(combo, ff, ctx);
        const ringing = new Map(st.ringing);
        combo.forEach((x, k) => ringing.set(x.string, { pitch: x.pitch, fret:x.fret, finger:ff?.fingers[k]||0, until: notes[ev.notes[k]][0] + notes[ev.notes[k]][1] }));
        for (const [s, r] of ringing) if (r.until <= ev.t + EPS) ringing.delete(s);
        const heldByFinger = new Map(held);
        if (ff) combo.forEach((x, k) => { if (ff.fingers[k] >= 1) heldByFinger.set(ff.fingers[k], { fret: x.fret, until: ev.t + notes[ev.notes[k]][1] }); });
        next.push({ cost: st.cost + c, picks: [...st.picks, { combo: combo.map(x => ({ string: x.string, fret: x.fret })), ff }],
          prevPos: ff && ff.pos ? ff.pos : st.prevPos, prevTop: combo[combo.length - 1], ringing, heldByFinger });
      }
    }
    next.sort((a, b) => a.cost - b.cost);
    beam = next.slice(0, 40);
  });
  const chosen = beam[0].picks;
  const assignments = assignFingers(song, events, chosen);
  reuseBarres(notes,assignments);
  for(let i=0;i<assignments.length;i++){
    const release=song.fingeringHints?.[i]?.releaseAt;
    if(assignments[i].lh===1&&Number.isFinite(release)&&release>notes[i][0])assignments[i].releaseAt=release;
  }
  assignRH(song, events, assignments);
  let barreChords = 0;
  events.forEach(ev => { if (ev.notes.some(ni => assignments[ni].barre)) barreChords++; });
  const stats = { notes: notes.length, events: events.length, unplayable, barreChords };
  song.fingering = { assignments, stats, open };
  return song.fingering;
}

/* Independent validation against the documented rules. Hard counters
 * (pitch, unplayable, per-event string/finger feasibility, barre by
 * finger 1 only, thumb on strings 1-2, same-finger repeats inside a
 * melodic or tremolo chain) must be zero; style counters are pinned. */
function validate(song) {
  const A = song.fingering.assignments, notes = song.notes, OPENv = song.fingering.open || OPEN;
  const v = { notes: notes.length, events: 0, pitchErrors: 0, unplayable: 0, stringConflicts: 0, fingerConflicts: 0,
    onsetSpanOver4: 0, fastPositionJumps: 0, tightFingerMoves: 0, rhSameFingerMelody: 0, rhArpSameString: 0,
    rhThumbOnTreble: 0, authoredThumbOnTreble: 0, rhThumbOnString3: 0, barreErrors: 0, ringingRefrets: 0 };
  const events = groupEvents(notes, windowOf(song), OPENv); v.events = events.length;
  A.forEach((a, i) => { if (notes[i][2] !== OPENv[a.string] + a.fret) v.pitchErrors++; if (!optionsFor(notes[i][2], OPENv).length) v.unplayable++; });
  events.forEach(ev => {
    const as = ev.notes.map(ni => A[ni]);
    const strs = new Set(); for (const a of as) { if (strs.has(a.string)) v.stringConflicts++; strs.add(a.string); }
    const byFinger = new Map();
    for (const a of as) {
      if (a.lh < 1) continue;
      if (byFinger.has(a.lh) && byFinger.get(a.lh) !== a.fret && !a.barre) v.fingerConflicts++;
      byFinger.set(a.lh, a.fret);
      if (a.barre && a.lh !== 1) v.barreErrors++;
    }
    const fretted = as.filter(a => a.fret > 0);
    if (fretted.length >= 2 && Math.max(...fretted.map(a => a.fret)) - Math.min(...fretted.map(a => a.fret)) > 3) v.onsetSpanOver4++;
  });
  let prevPos = 0, prevT = -1;
  const lastFinger = new Map();
  events.forEach(ev => {
    const as = ev.notes.map(ni => A[ni]);
    const frettedPos = as.filter(a => a.fret > 0).map(a => a.pos || a.fret);
    const pos = frettedPos.length ? Math.min(...frettedPos) : 0;
    if (prevPos && pos && pos !== prevPos && ev.t - prevT < 0.09) v.fastPositionJumps++;
    if (pos) { prevPos = pos; prevT = ev.t; }
    for (const a of as) {
      if (a.lh < 1) continue;
      const lf = lastFinger.get(a.lh);
      if (lf && lf.fret !== a.fret && ev.t - lf.t > EPS && ev.t - lf.t < 0.09) v.tightFingerMoves++;
      lastFinger.set(a.lh, { fret: a.fret, t: ev.t });
    }
  });
  const ring = new Map();
  notes.forEach((n, i) => { const a = A[i]; const r = ring.get(a.string); if (r && r.pitch !== n[2] && r.until > n[0] + 0.02) v.ringingRefrets++; ring.set(a.string, { pitch: n[2], until: n[0] + n[1] }); });
  let lastMel = null, lastTrem = null; const lastArp = new Map();
  A.forEach((a,i) => {
    const beat=song.rightHandTremolo?notes[i][0]*song.rightHandTremolo.bpm/60:Infinity;
    const authoredThumb=a.role==='trem-acc'&&beat<song.rightHandTremolo?.endBeat&&Math.abs(beat*2-Math.round(beat*2))<.001;
    if (a.rh === 'p' && a.string <= 2) {if(authoredThumb)v.authoredThumbOnTreble++;else v.rhThumbOnTreble++;}
    if (a.rh === 'p' && a.string === 3) v.rhThumbOnString3++;
    if (a.role === 'mel' && a.rh !== 'p') { if (lastMel && lastMel.rh === a.rh) v.rhSameFingerMelody++; lastMel = a; }
    if (a.role === 'trem-mel') { if (lastTrem && lastTrem.rh === a.rh) v.rhSameFingerMelody++; lastTrem = a; }
    if (a.role === 'arp') { const la = lastArp.get('seq'); if (la && la.string === a.string && a.string <= 3 && la.rh === a.rh) v.rhArpSameString++; lastArp.set('seq', a); }
  });
  return v;
}

window.GuitarFingering = { reuseBarres, OPEN, MAXFRET, build, validate, detectTremolo, groupEvents, windowOf };

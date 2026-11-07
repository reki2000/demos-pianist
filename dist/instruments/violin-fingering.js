'use strict';
/*
 * ViolinFingering — fingering + bowing assignment for a 3D violin app.
 *
 * Instrument model
 *   Strings 0..3 (low to high): G3=55, D4=62, A4=69, E5=76; length 328 mm.
 *   distMm(semi) = 328*(1 - 2^(-semi/12)) — sounding length lost to a stop.
 *   semi = pitch - open(string) must be >= 0; finger 0 is the open string
 *   (position 0). Position p (1..14) puts finger 1 at POS_BASE[p-1]
 *   semitones above the open string, and each finger covers a 2-semitone
 *   window of offsets from that base (FINGER_WINDOWS): f1 [-1,0], f2 [1,2],
 *   f3 [3,4], f4 [5,6]. The windows tile contiguously, so in 1st position
 *   (base 2) fingers 1..4 cover semis 1..8 exactly, as they should.
 *   Candidates per note are all feasible (string, position, finger)
 *   triples. Positions are capped at song.maxPosition || 10, except
 *   forceString songs, which may climb to position 15 (capped by the 14
 *   defined bases; POS_BASE[13]=24 already reaches semi 30 with f4).
 *
 * Assignment (dynamic programming over attack groups)
 *   A group is the set of notes sharing a start time within 0.03 s.
 *   Group feasibility: notes need distinct strings; a multi-note group
 *   must use ADJACENT strings (a contiguous string set), one shared
 *   position in which every fingered note is feasible (an open string is
 *   compatible with any shared position), and distinct fingers — except
 *   that the same finger may serve two notes whose semis are EQUAL (a
 *   perfect-fifth barre, e.g. D on the G string + A on the D string).
 *   If song.forceString is set it is a hard constraint: every candidate
 *   lives on that one string and the positions climb as needed.
 *
 *   Cost model (deterministic; lower is better):
 *     base(candidate)   = 0.25*position + string preference
 *                         (0, .02, .04, .06 for G,D,A,E — a whisper, so
 *                         position dominates) + 0.03 if finger 4.
 *                         Double stops add 2.5 per pitch/string inversion
 *                         (higher pitch placed on a lower string).
 *     transition(a -> b), between consecutive groups:
 *       shift     position changes: 2.2*|dPosition| + 1.5 when the shift
 *                 is exposed (mid-phrase, no rest, no open string);
 *                 a flat 0.3 when the shift happens during a rest
 *                 (gap > 0.04 s after the previous group ends) or onto /
 *                 from a group containing an open string.
 *       crossing  single-to-single: 0.8 per string-index step; same
 *                 string costs 0, which (with the shift cost) is what
 *                 keeps a phrase on one string when that is feasible.
 *       same finger, large interval (|dpitch| >= 5, finger > 0, pitch
 *                 actually changes): 0.9 + 0.12*(|dpitch| - 5).
 *       stretch   consecutive notes in the SAME position (both fingered):
 *                 0.6 * max(0, |dSemi| - (2*|dFinger| + 1)), plus 0.4
 *                 when both notes sit on the outer edges of their finger
 *                 windows and the fingers are >= 2 apart.
 *       repeat    same pitch, different finger, no position change: 0.2.
 *     The DP keeps, per group state, the cheapest path ending in it and
 *     backtracks from the cheapest final state.
 *
 * Bowing (precedence, highest first)
 *   1. Slurs: if song.slurs is present, each slur span is ONE stroke
 *      covering the notes whose start falls in [start, end). Notes not
 *      under any slur are each their own stroke (per attack group) —
 *      slur data overrides the legato-merging rule below.
 *   2. No slurs: consecutive attack groups stay in one stroke while the
 *      gap from the previous group's end to the next start is < 0.25 s;
 *      a gap >= 0.25 s starts a new stroke.
 *   3. Either way, a stroke's total sounding duration (sum over its
 *      groups of each group's longest note) may not exceed 7 s; longer
 *      strokes are split at the group boundary nearest their middle,
 *      recursively.
 *   Direction: the first stroke is down-bow and direction alternates at
 *   every stroke change — EXCEPT a retake: a stroke preceded by a gap
 *   >= 1.0 s restarts down-bow (if alternation already gives down, it
 *   simply stays down); the next stroke alternates from there.
 *   Bow position (fractions, 0 = frog, 1 = tip): each stroke's budget is
 *   clamp(soundingDuration/6, 0.08, 1), effectively capped at 0.96 so the
 *   fractions can stay inside [0.02, 0.98]. Down-bows travel up in
 *   fraction, up-bows down. A stroke starts where the previous one ended
 *   (chained), clamped back into range when the budget would overflow;
 *   after a long rest (>= 1.0 s) a down-bow restarts at 0.05 and an
 *   up-bow at 0.95 instead. Within a stroke the travel is distributed
 *   over the groups in proportion to their sounding durations, so every
 *   sounding note moves the bow (|bowTo - bowFrom| > 0) and the sign of
 *   bowTo - bowFrom always matches the stroke direction.
 */
window.ViolinFingering=(()=>{
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
// Strings low to high: index, name, open-string MIDI pitch.
const STRINGS=[{name:'G3',open:55},{name:'D4',open:62},{name:'A4',open:69},{name:'E5',open:76}];
const STRING_LENGTH_MM=328;
// Finger-1 semitone above the open string, for positions 1..14.
const POS_BASE=[2,4,5,7,9,10,12,14,16,17,19,21,22,24];
// Semitone-offset windows from POS_BASE, per finger 1..4.
const FINGER_WINDOWS={1:[-1,0],2:[1,2],3:[3,4],4:[5,6]};
const STRING_PREF=[0,.02,.04,.06];
const distMm=semi=>STRING_LENGTH_MM*(1-Math.pow(2,-semi/12));
function fingerForOffset(off){for(let f=1;f<=4;f++){let w=FINGER_WINDOWS[f];if(off>=w[0]&&off<=w[1])return f;}return 0;}
function maxPositionFor(song){let cap=song.forceString!=null?15:(song.maxPosition||10);return Math.min(cap,POS_BASE.length);}
// All feasible (string, position, finger) triples for one pitch.
function candidatesFor(pitch,song){
  let strings=song.forceString!=null?[song.forceString]:[0,1,2,3],cap=maxPositionFor(song),out=[];
  for(let s of strings){let semi=pitch-STRINGS[s].open;if(semi<0)continue;
    if(semi===0)out.push({string:s,position:0,finger:0,semi});
    for(let pos=1;pos<=cap;pos++){let f=fingerForOffset(semi-POS_BASE[pos-1]);if(f)out.push({string:s,position:pos,finger:f,semi});}
  }
  if(!out.length){ // Out-of-range pitch: degrade gracefully on the nearest string.
    let s=0;for(let i=0;i<4;i++)if(STRINGS[i].open<=pitch)s=i;if(song.forceString!=null)s=song.forceString;
    out.push({string:s,position:cap,finger:4,semi:Math.max(0,pitch-STRINGS[s].open)});
  }
  return out;
}
const baseCost=c=>0.25*c.position+STRING_PREF[c.string]+(c.finger===4?.03:0);
// One DP state for a whole attack group: an assignment per note, sharing
// `pos` (the group's hand position: the shared position, or 0 if all open).
function groupAssignments(group,song){
  let perNote=group.notes.map(n=>candidatesFor(n.pitch,song));
  if(group.notes.length===1)return perNote[0].map(c=>({assign:[c],pos:c.position,cost:baseCost(c)}));
  if(group.notes.length>4){ // More notes than strings: fall back to each note's cheapest.
    let assign=perNote.map(cs=>cs.reduce((a,b)=>baseCost(a)<baseCost(b)?a:b));
    return[{assign,pos:Math.max(...assign.map(c=>c.position)),cost:assign.reduce((v,c)=>v+baseCost(c),0)}];
  }
  let cap=maxPositionFor(song),out=[];
  for(let pos=0;pos<=cap;pos++){
    // Options per note at this shared position (open strings fit any pos).
    let options=perNote.map((cs,ni)=>{let o=[];
      for(let c of cs){if(c.position===pos)o.push(c);else if(c.finger===0)o.push(c);else if(pos>0&&c.position===0&&c.finger===0)o.push(c);}
      if(pos>0)o=o.filter(c=>c.finger===0||c.position===pos);
      return o;});
    if(options.some(o=>!o.length))continue;
    let chosen=Array(group.notes.length);
    const rec=ni=>{if(ni===group.notes.length){
        let strs=chosen.map(c=>c.string);if(new Set(strs).size!==strs.length)return;
        if(Math.max(...strs)-Math.min(...strs)!==strs.length-1)return; // adjacent (contiguous) strings
        for(let a=0;a<chosen.length;a++)for(let b=a+1;b<chosen.length;b++)
          if(chosen[a].finger!==0&&chosen[a].finger===chosen[b].finger&&chosen[a].semi!==chosen[b].semi)return; // barre only for equal semis
        let cost=chosen.reduce((v,c)=>v+baseCost(c),0);
        for(let a=0;a<chosen.length;a++)for(let b=a+1;b<chosen.length;b++)
          if((group.notes[a].pitch-group.notes[b].pitch)*(chosen[a].string-chosen[b].string)<0)cost+=2.5; // pitch/string inversion
        out.push({assign:chosen.slice(),pos,cost});return;}
      for(let c of options[ni]){chosen[ni]=c;rec(ni+1);}};
    rec(0);
  }
  if(!out.length){ // No jointly feasible stopping: each note's cheapest, independently.
    let assign=perNote.map(cs=>cs.reduce((a,b)=>baseCost(a)<baseCost(b)?a:b));
    out.push({assign,pos:Math.max(...assign.map(c=>c.position)),cost:assign.reduce((v,c)=>v+baseCost(c),0)});
  }
  out.sort((a,b)=>a.cost-b.cost||a.assign[0].string-b.assign[0].string||a.pos-b.pos);
  return out.slice(0,48);
}
function transitionCost(aG,a,bG,b){
  let cost=0,aEnd=Math.max(...aG.notes.map(n=>n.start+n.dur)),gap=bG.start-aEnd;
  let hasOpen=a.assign.some(c=>c.finger===0)||b.assign.some(c=>c.finger===0);
  if(a.pos!==b.pos)cost+=(gap>0.04||hasOpen)?0.3:2.2*Math.abs(b.pos-a.pos)+1.5;
  if(aG.notes.length===1&&bG.notes.length===1){
    let x=a.assign[0],y=b.assign[0];
    cost+=0.8*Math.abs(y.string-x.string);
    let interval=Math.abs(bG.notes[0].pitch-aG.notes[0].pitch);
    if(x.finger>0&&x.finger===y.finger&&interval>=5)cost+=0.9+0.12*(interval-5);
    if(interval===0&&x.finger!==y.finger&&a.pos===b.pos)cost+=0.2;
    if(a.pos>0&&a.pos===b.pos&&x.finger>0&&y.finger>0&&x.finger!==y.finger){
      cost+=0.6*Math.max(0,Math.abs(y.semi-x.semi)-(2*Math.abs(y.finger-x.finger)+1));
      let base=POS_BASE[a.pos-1],ex=c=>{let o=c.semi-base,w=FINGER_WINDOWS[c.finger];return o===w[0]||o===w[1];};
      if(Math.abs(y.finger-x.finger)>=2&&ex(x)&&ex(y))cost+=0.4;
    }
  }else{
    let mean=s=>s.assign.reduce((v,c)=>v+c.string,0)/s.assign.length;
    cost+=0.4*Math.abs(mean(b)-mean(a));
  }
  return cost;
}
// Split a stroke (list of groups) so no part sounds longer than 7 s.
function splitStroke(groups){
  let sounding=groups.reduce((v,g)=>v+g.dur,0);
  if(sounding<=7||groups.length<2)return[groups];
  let acc=0,best=1,bestDiff=Infinity;
  for(let i=1;i<groups.length;i++){acc+=groups[i-1].dur;let d=Math.abs(acc-sounding/2);if(d<bestDiff){bestDiff=d;best=i;}}
  return[...splitStroke(groups.slice(0,best)),...splitStroke(groups.slice(best))];
}
function assign(song){
  let notes=(song.notes||[]).map((n,i)=>({i,start:n[0],dur:n[1],pitch:n[2],velocity:n[3]}));
  // Attack groups: starts within 0.03 s of the group's first start.
  let groups=[];
  for(let n of notes){let g=groups[groups.length-1];
    if(g&&n.start-g.start<0.03)g.notes.push(n);
    else groups.push({start:n.start,notes:[n]});}
  for(let g of groups)g.dur=Math.max(...g.notes.map(n=>n.dur));
  // --- Fingering DP ---
  let layers=[],choices=[];
  if(groups.length){
    let states=groups.map(g=>groupAssignments(g,song));
    for(let gi=0;gi<groups.length;gi++){let layer=[];
      for(let si=0;si<states[gi].length;si++){let st=states[gi][si];
        if(gi===0){layer.push({cost:st.cost,index:si,parent:null});continue;}
        let best=null;
        for(let pi=0;pi<layers[gi-1].length;pi++){let prev=layers[gi-1][pi],
          v=prev.cost+st.cost+transitionCost(groups[gi-1],states[gi-1][prev.index],groups[gi],st);
          if(!best||v<best.cost)best={cost:v,index:si,parent:prev};}
        layer.push(best);}
      layers.push(layer);}
    let s=layers[layers.length-1].reduce((a,b)=>a.cost<b.cost?a:b);
    for(let gi=groups.length-1;gi>=0;gi--){choices[gi]=states[gi][s.index];s=s.parent;}
  }
  // --- Repair: partial-overlap string collisions ---
  // Attack groups enforce distinct strings only within one onset. Two
  // notes whose spans overlap by MORE than the 0.03 s grouping epsilon
  // but whose onsets differ land in different groups and can be assigned
  // the same string — physically impossible (one string sounds one
  // pitch at a time; source MIDIs do contain such overlaps, e.g.
  // acciaccatura figures in the Csárdás). Overlaps <= 0.03 s are MIDI
  // release bleed, not concurrency, and are left alone. Reassign the
  // later note to another feasible string when one exists
  // (single-note groups only, so chord-group invariants stay intact).
  let collisionsFixed=0,collisionsLeft=0;
  if(groups.length){
    let flat=[];
    groups.forEach((g,gi)=>g.notes.forEach((n,k)=>flat.push({n,gi,k,c:choices[gi].assign[k]})));
    const overlaps=(a,b)=>Math.min(a.n.start+a.n.dur,b.n.start+b.n.dur)-Math.max(a.n.start,b.n.start)>0.03;
    const clashes=(cand,self)=>flat.some(o=>o!==self&&overlaps(o,self)&&o.c.string!==cand.string&&
      cand.finger!==0&&o.c.finger===cand.finger&&o.c.semi!==cand.semi);
    for(let e of flat)for(let o of flat){
      if(o===e||o.n.start<=e.n.start||!overlaps(e,o)||o.c.string!==e.c.string)continue;
      if(groups[o.gi].notes.length!==1){collisionsLeft++;continue;}
      let cands=candidatesFor(o.n.pitch,song).filter(c=>c.string!==e.c.string&&
        !flat.some(x=>x!==o&&overlaps(x,o)&&x.c.string===c.string)&&!clashes(c,o));
      if(cands.length){cands.sort((a,b)=>(baseCost(a)+0.25*Math.abs(a.position-e.c.position))-(baseCost(b)+0.25*Math.abs(b.position-e.c.position)));
        o.c=cands[0];choices[o.gi].assign[o.k]=o.c;collisionsFixed++;}
      else collisionsLeft++;
    }
  }
  // --- Bowing: stroke = list of group indices ---
  let strokeGroups=[];
  if(song.slurs&&song.slurs.length){
    let claimed=new Set();
    for(let [ss,se] of song.slurs){let gs=[];
      groups.forEach((g,gi)=>{if(!claimed.has(gi)&&g.start>=ss-1e-9&&g.start<se-1e-9){gs.push(gi);claimed.add(gi);}});
      if(gs.length)strokeGroups.push(gs);}
    groups.forEach((g,gi)=>{if(!claimed.has(gi))strokeGroups.push([gi]);}); // unslurred: separate strokes
    strokeGroups.sort((a,b)=>groups[a[0]].start-groups[b[0]].start);
  }else{
    let cur=[];
    groups.forEach((g,gi)=>{if(cur.length){let prev=groups[cur[cur.length-1]],
        gap=g.start-(prev.start+prev.dur);if(gap>=0.25){strokeGroups.push(cur);cur=[];}}
      cur.push(gi);});
    if(cur.length)strokeGroups.push(cur);
  }
  strokeGroups=strokeGroups.flatMap(gs=>splitStroke(gs.map(gi=>groups[gi]))).map(gs=>gs.map(g=>groups.indexOf(g)));
  // Direction, with the long-rest retake restarting down-bow.
  let strokes=[];
  strokeGroups.forEach((gs,si)=>{let start=groups[gs[0]].start,
    end=Math.max(...gs.map(gi=>groups[gi].start+groups[gi].dur)),
    sounding=gs.reduce((v,gi)=>v+groups[gi].dur,0),bow,retake=false;
    if(si===0)bow='down';
    else if(start-strokes[si-1].end>=1.0){bow='down';retake=true;} // retake
    else bow=strokes[si-1].bow==='down'?'up':'down';
    strokes.push({groups:gs,start,end,sounding,bow,retake});});
  // Bow fractions, chained stroke to stroke.
  let planNotes=Array(notes.length),prevEndFrac=null,prevStrokeEnd=null,down=0,up=0,retakes=0;
  strokes.forEach((stroke,bowId)=>{
    if(stroke.bow==='down')down++;else up++;if(stroke.retake)retakes++;
    let budget=Math.min(clamp(stroke.sounding/6,0.08,1),0.96),dir=stroke.bow==='down'?1:-1;
    let longRest=prevStrokeEnd!=null&&stroke.start-prevStrokeEnd>=1.0;
    let want=longRest?(dir>0?0.05:0.95):(prevEndFrac!=null?prevEndFrac:(dir>0?0.05:0.95));
    let from=dir>0?clamp(want,0.02,0.98-budget):clamp(want,0.02+budget,0.98);
    let cursor=from;
    for(let gi of stroke.groups){let g=groups[gi],share=stroke.sounding>0?budget*(g.dur/stroke.sounding):0,
        segFrom=cursor,segTo=cursor+dir*share;cursor=segTo;
      for(let n of g.notes){let c=choices[gi].assign[g.notes.indexOf(n)];
        planNotes[n.i]={i:n.i,string:c.string,position:c.position,finger:c.finger,semi:c.semi,
          distMm:distMm(c.semi),bow:stroke.bow,bowId,bowFrom:segFrom,bowTo:segTo};}}
    prevEndFrac=cursor;prevStrokeEnd=stroke.end;});
  let shifts=0,crossings=0;
  for(let gi=1;gi<groups.length;gi++){if(choices[gi]&&choices[gi-1]){if(choices[gi].pos!==choices[gi-1].pos)shifts++;
    if(groups[gi].notes.length===1&&groups[gi-1].notes.length===1)crossings+=Math.abs(choices[gi].assign[0].string-choices[gi-1].assign[0].string);}}
  let stats={notes:notes.length,groups:groups.length,strokes:strokes.length,downBows:down,upBows:up,retakes,
    collisionsFixed,collisionsLeft,
    shifts,crossings,openNotes:planNotes.filter(n=>n&&n.finger===0).length,
    maxPosition:planNotes.reduce((v,n)=>Math.max(v,n?n.position:0),0),
    forcedString:song.forceString!=null?song.forceString:null};
  return{notes:planNotes,stats};
}
return{assign,STRINGS,POS_BASE,FINGER_WINDOWS,distMm,STRING_LENGTH_MM};
})();

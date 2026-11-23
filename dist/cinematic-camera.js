'use strict';
// Concert coverage: deliberate cuts between subjects, with a slow arc and dolly
// within each shot. All motion follows the playback clock, including seeks.
window.CinematicCamera=(()=>{
 const Y=[0,1,0],Z=[0,0,1],add=(a,b)=>a.map((v,i)=>v+b[i]),sub=(a,b)=>a.map((v,i)=>v-b[i]),mul=(a,s)=>a.map(v=>v*s);
 const shot=(label,duration,at,offset,subject=null,width=.4,height=.4,arc=.24,push=.10,up=Y)=>({label,duration,at,offset,subject,width,height,arc,push,up});
 const C={
  piano:[
   shot('Stage · opening arc',7,[0,1.16,-.45],[2.5,1.2,-3.0],null,2.5,2),
   shot('Keyboard · above both hands',6,[0,1.05,-.55],[.10,1.85,.12],'hands',1.25,.6,.18,.10,Z),
   shot('Left hand · bass-side close-up',6,[-.35,1.10,-.55],[-.50,.48,-.62],'left',.33,.35,-.25,.12),
   shot('Expression · left profile',5,[0,1.62,-1.08],[-1.12,.28,.85],null,.65,.65,.20,-.08),
   shot('Right hand · treble-side close-up',6,[.35,1.10,-.55],[.52,.42,-.60],'right',.33,.35,.25,.12),
   shot('Over the pianist’s shoulder',7,[0,1.05,-.55],[.55,1.20,-1.40],'hands',1.15,.65,-.20,.08),
   shot('Keyboard · low bass-side angle',5,[0,1.06,-.52],[-1.75,.45,-.48],'hands',1.15,.55,.24,-.08),
   shot('Performer · right profile',6,[0,1.37,-.88],[1.80,.35,.50],null,1.1,1.15,-.26,.10),
   shot('Hands · high treble-side angle',6,[0,1.05,-.55],[1.05,1.40,.12],'hands',1.15,.65,.20,.08),
   shot('Expression · from the keyboard',5,[0,1.60,-1.08],[.80,.20,.95],null,.65,.65,-.22,.08),
   shot('Grand piano · wide reverse angle',7,[0,1.05,.4],[-3.2,1.6,3.4],null,3.0,2.0,.28,-.10),
   shot('Hands and wrists · frontal detail',6,[0,1.10,-.55],[.12,.72,-1.40],'hands',1.15,.65,-.20,.12),
  ],
  guitar:[
   shot('Stage · opening arc',7,[.08,1.12,-.2],[1.7,.85,-2.6],null,1.5,1.8),
   shot('Fretting hand · treble-side detail',6,[.35,1.28,-.3],[.48,.35,-.58],'left',.3,.35,-.26,.12),
   shot('Plucking hand · soundhole detail',6,[.02,1.02,-.3],[-.40,.30,-.56],'right',.3,.35,.26,.12),
   shot('Expression · left profile',5,[.02,1.58,-.08],[-.95,.20,-.95],null,.65,.65,-.22,-.08),
   shot('Both hands · high angle',7,[.2,1.15,-.3],[.25,1.25,-.75],'hands',.9,.6,.22,.08),
   shot('Fretting hand · opposite side',6,[.35,1.28,-.3],[-.42,.42,-.58],'left',.3,.35,.26,-.08),
   shot('Performer · right profile',6,[.08,1.3,-.15],[1.9,.30,-.3],null,1.1,1.2,-.25,.10),
   shot('Plucking hand · low string angle',5,[.02,1.02,-.3],[.45,.12,-.56],'right',.3,.35,-.20,.10),
   shot('Over the fretting shoulder',7,[.22,1.15,-.3],[.65,.90,.65],'hands',.9,.7,.24,.08),
   shot('Expression · right three-quarter',5,[.02,1.58,-.08],[.85,.22,-1.0],null,.65,.65,.22,.08),
   shot('Stage · reverse angle',7,[.05,1.1,-.2],[-2.4,1.1,.9],null,1.6,1.8,-.26,-.10),
   shot('Hands · front three-quarter',6,[.2,1.15,-.3],[-.8,.50,-1.15],'hands',.9,.7,.22,.10),
  ],
  violin:[
   shot('Stage · opening arc',7,[.05,1.15,-.15],[1.8,.65,-3.0],null,1.6,2.0),
   shot('Left hand · fingerboard detail',6,[.30,1.43,-.35],[.52,.34,-.65],'left',.3,.35,-.26,.12),
   shot('Right hand · bow grip detail',6,[-.12,1.30,-.30],[-.55,.30,-.62],'right',.3,.35,.26,.10),
   shot('Expression · left three-quarter',5,[.10,1.61,-.18],[-.95,.22,-1.0],null,.7,.7,.22,-.08),
   shot('Violin and both hands · high angle',7,[.15,1.42,-.3],[.3,1.0,-.85],'hands',1.05,.6,-.22,.08),
   shot('Left hand · opposite fingerboard angle',6,[.30,1.43,-.35],[-.45,.38,-.62],'left',.3,.35,.25,-.08),
   shot('Performer · bow-side profile',6,[.02,1.35,-.15],[-1.9,.30,-.35],null,1.1,1.35,.25,.10),
   shot('Right hand · low bow-side angle',5,[-.12,1.30,-.30],[-.50,.12,-.68],'right',.3,.35,-.24,.10),
   shot('Over the violinist’s shoulder',7,[.15,1.42,-.3],[.65,.65,.80],'hands',1.05,.65,.22,.08),
   shot('Expression · right profile',5,[.10,1.61,-.18],[1.05,.2,-.75],null,.7,.7,-.22,.10),
   shot('Stage · high reverse angle',7,[.05,1.15,-.15],[2.4,1.2,1.1],null,1.6,2.0,-.25,-.10),
   shot('Hands and instrument · front detail',6,[.15,1.42,-.3],[.25,.45,-1.40],'hands',1.05,.65,.22,.10),
  ],
  cello:[
   shot('Stage · opening arc',7,[0,.95,-.1],[-2.0,.85,-2.8],null,1.5,1.9),
   shot('Left hand · fingerboard detail',6,[.30,1.1,-.2],[.50,.38,-.65],'left',.3,.35,-.26,.12),
   shot('Right hand · bow grip detail',6,[-.05,.85,-.3],[-.55,.28,-.60],'right',.3,.35,.26,.10),
   shot('Expression · left three-quarter',5,[0,1.4,.0],[-.9,.2,-1.1],null,.7,.7,.22,-.08),
   shot('Both hands · high string angle',7,[.12,1.0,-.2],[.35,1.1,-.8],'hands',.9,.7,-.22,.08),
   shot('Left hand · opposite fingerboard angle',6,[.30,1.1,-.2],[-.45,.42,-.62],'left',.3,.35,.26,-.08),
   shot('Performer · bow-side profile',6,[0,1.0,-.1],[-2.0,.35,-.3],null,1.0,1.5,.25,.10),
   shot('Right hand · low bow-side angle',5,[-.05,.85,-.3],[-.55,.1,-.64],'right',.3,.35,-.22,.10),
   shot('Over the cellist’s shoulder',7,[.12,1.0,-.2],[.65,.9,.75],'hands',.9,.7,.22,.08),
   shot('Expression · right profile',5,[0,1.4,.0],[1.0,.22,-.8],null,.7,.7,-.22,.10),
   shot('Stage · high reverse angle',7,[0,.95,-.1],[2.4,1.3,.9],null,1.5,1.9,-.25,-.10),
   shot('Hands and bow · frontal detail',6,[.12,1.0,-.2],[.2,.48,-1.4],'hands',.9,.7,.22,.10),
  ],
  viola:[
   shot('Viola · concert front',7,[.05,1.12,-.15],[.55,.22,-2.45],null,1.3,1.55),
   shot('Left hand · fingerboard detail',6,[.27,1.44,-.34],[.75,.28,-.68],'left',.45,.42,.22,.10),
   shot('Bow hand · alternating strokes',6,[-.12,1.42,-.28],[-.95,.22,-.82],'right',.55,.45,-.24,.10),
   shot('Expression · violist portrait',5,[.08,1.50,-.14],[-.85,.22,-.95],null,.70,.72,-.22,-.08),
   shot('Viola · high angle over strings',7,[.12,1.44,-.30],[.25,.85,-.72],'hands',.68,.55,.22,.08),
   shot('Performer · right three-quarter',6,[.05,1.28,-.15],[-1.75,.28,-.70],null,1.1,1.35,.24,.10),
   shot('Low scroll & bow angle',5,[.15,1.42,-.32],[.45,-.18,-.78],'hands',.60,.48,-.22,.10),
   shot('Over the violist’s shoulder',7,[.10,1.46,-.25],[.65,.52,.78],'hands',.78,.60,.22,.08),
   shot('Left profile · chinrest & neck',5,[.10,1.48,-.20],[1.15,.20,-.75],null,.80,.85,.22,.08),
   shot('Stage · high reverse angle',7,[.05,1.15,-.15],[2.2,1.15,1.0],null,1.6,2.0,-.24,-.10),
   shot('Hands and bow · front detail',6,[.12,1.44,-.32],[-.32,.26,-1.12],'hands',.75,.58,.22,.10),
   shot('Viola · wide stage view',6,[.05,1.16,-.15],[-.65,.30,-2.65],null,1.4,1.65,.18,.08),
  ],
  flute:[
   shot('Stage · opening arc',7,[-.16,1.10,-.14],[-.45,.20,-2.35],null,1.3,1.55),
   shot('Keywork · both hands detail',6,[-.28,1.46,-.16],[-.06,.24,-.68],'hands',.45,.35,-.24,.10),
   shot('Left hand · upper keys',6,[-.20,1.49,-.14],[.34,.22,-.56],'left',.28,.32,.22,.10),
   shot('Expression · embouchure profile',5,[0,1.56,-.08],[-.95,.18,-.85],null,.65,.65,-.22,-.08),
   shot('Right hand · footjoint keys',6,[-.38,1.44,-.17],[-.38,.22,-.54],'right',.28,.32,-.24,.10),
   shot('Flute · high angle over keys',7,[-.28,1.46,-.16],[-.10,.78,-.56],'hands',.65,.50,.22,.08),
   shot('Performer · right three-quarter',6,[-.10,1.34,-.12],[-1.75,.28,-.65],null,1.1,1.35,.24,.10),
   shot('Keywork · low frontal angle',5,[-.28,1.46,-.16],[.18,-.10,-.66],'hands',.55,.40,-.22,.10),
   shot('Over the flutist’s shoulder',7,[-.22,1.46,-.15],[.55,.50,.68],'hands',.75,.55,.22,.08),
   shot('Expression · left three-quarter',5,[0,1.56,-.08],[.92,.18,-.88],null,.65,.65,.22,.08),
   shot('Stage · high reverse angle',7,[-.08,1.15,-.10],[2.2,1.15,1.0],null,1.6,2.0,-.24,-.10),
   shot('Hands and flute · front detail',6,[-.24,1.47,-.16],[-.25,.28,-1.10],'hands',.75,.55,.22,.10),
  ],
  oboe:[
   shot('Stage · opening arc',7,[0,1.05,-.22],[.55,.18,-2.35],null,1.3,1.55),
   shot('Keywork · both hands detail',6,[0,1.24,-.32],[.32,.24,-.68],'hands',.42,.45,-.24,.10),
   shot('Left hand · half-hole & octave',6,[0,1.34,-.25],[.45,.18,-.52],'left',.26,.32,.22,.10),
   shot('Expression · reed & profile',5,[0,1.52,-.12],[-.95,.18,-.88],null,.65,.65,-.22,-.08),
   shot('Right hand · lower keys',6,[0,1.18,-.36],[-.44,.16,-.54],'right',.26,.32,-.24,.10),
   shot('Oboe · high angle over keys',7,[0,1.24,-.32],[.15,.72,-.68],'hands',.60,.55,.22,.08),
   shot('Performer · right three-quarter',6,[0,1.32,-.14],[-1.75,.28,-.60],null,1.1,1.35,.24,.10),
   shot('Keywork · low bell angle',5,[0,1.20,-.34],[-.22,-.18,-.72],'hands',.50,.45,-.22,.10),
   shot('Over the oboist’s shoulder',7,[0,1.28,-.28],[.62,.52,.65],'hands',.75,.60,.22,.08),
   shot('Expression · left three-quarter',5,[0,1.52,-.12],[.92,.18,-.90],null,.65,.65,.22,.08),
   shot('Stage · high reverse angle',7,[0,1.15,-.12],[2.2,1.15,1.0],null,1.6,2.0,-.24,-.10),
   shot('Hands and oboe · front detail',6,[0,1.26,-.30],[-.28,.26,-1.08],'hands',.70,.58,.22,.10),
  ],
  clarinet:[
   shot('Clarinet · concert front',7,[0,1.02,-.24],[.55,.18,-2.35],null,1.3,1.55),
   shot('Clarinet · both hands on keys',6,[0,1.22,-.34],[.34,.22,-.72],'hands',.45,.48,-.24,.10),
   shot('Left hand · register & upper keys',6,[0,1.32,-.26],[.48,.18,-.56],'left',.28,.34,.22,.10),
   shot('Embouchure · right profile',5,[0,1.52,-.12],[-.95,.18,-.88],null,.65,.65,-.22,-.08),
   shot('Right hand · lower keys & bell',6,[0,1.12,-.38],[-.44,.16,-.56],'right',.28,.34,-.24,.10),
   shot('Clarinet · high angle over keys',7,[0,1.22,-.34],[.15,.70,-.68],'hands',.60,.55,.22,.08),
   shot('Clarinetist · right three-quarter',6,[0,1.24,-.16],[-1.65,.24,-.65],null,1.1,1.35,.24,.10),
   shot('Bell & lower joint · low angle',5,[0,1.14,-.36],[-.22,-.16,-.72],'hands',.50,.45,-.22,.10),
   shot('Over the clarinetist’s shoulder',7,[0,1.26,-.28],[.62,.50,.68],'hands',.75,.60,.22,.08),
   shot('Expression · left three-quarter',5,[0,1.52,-.12],[.92,.18,-.90],null,.65,.65,.22,.08),
   shot('Stage · high reverse angle',7,[0,1.15,-.12],[2.1,1.10,1.0],null,1.6,2.0,-.24,-.10),
   shot('Hands and clarinet · front detail',6,[0,1.24,-.32],[-.28,.24,-1.08],'hands',.70,.58,.22,.10),
  ],
  trumpet:[
   shot('Trumpet · concert front',7,[0,1.15,-.26],[-.68,.16,-2.30],null,1.3,1.50),
   shot('3-Valve pistons · detail',6,[0,1.48,-.36],[-.55,.24,-.52],'right',.35,.32,.24,.10),
   shot('Right hand · valve work',6,[0,1.50,-.36],[-.48,.16,-.56],'hands',.48,.48,-.22,.10),
   shot('Brass bell · front three-quarter',5,[0,1.46,-.50],[.72,.14,-.78],null,.65,.60,.24,.08),
   shot('Left hand · valve casing grip',6,[0,1.46,-.34],[.55,.16,-.50],'left',.34,.32,.22,.10),
   shot('Trumpet · high angle over valves',7,[0,1.48,-.36],[-.20,.72,-.58],'hands',.58,.46,.22,.08),
   shot('Trumpeter · right profile',6,[0,1.34,-.22],[-1.75,.20,-.45],null,1.1,1.30,.24,.10),
   shot('Bell & pistons · low hero angle',5,[0,1.46,-.44],[-.26,-.24,-.76],'hands',.55,.45,-.22,.10),
   shot('Over the trumpeter’s shoulder',7,[0,1.48,-.32],[.62,.48,.68],'hands',.75,.55,.22,.08),
   shot('Trumpeter · left profile',5,[0,1.44,-.26],[1.45,.16,-.55],null,.95,1.15,.22,.08),
   shot('Stage · high reverse angle',7,[0,1.18,-.18],[2.1,1.10,1.0],null,1.6,1.95,-.24,-.10),
   shot('Trumpet · wide recital angle',6,[0,1.18,-.24],[.75,.25,-2.55],null,1.4,1.65,.20,.08),
  ],
  harp:[
   shot('Concert Harp · front three-quarter',7,[0,.82,-.38],[-1.15,.20,-2.65],null,1.7,1.85),
   shot('47 Strings · hands plucking',6,[-.04,1.02,-.44],[-.95,.18,-.68],null,.95,.95,.22,.08),
   shot('Harpist & golden pillar · left',6,[-.04,.95,-.40],[1.25,.22,-1.15],null,1.3,1.55,.22,.08),
   shot('Curved neck & tuning pins',5,[-.04,1.45,-.46],[-.85,.20,-.72],null,.85,.85,-.20,.08),
   shot('7 Pedals & base · low angle',6,[-.04,.35,-.35],[-.85,.28,-1.10],null,.95,.85,.22,.08),
   shot('Harp · high gallery view',7,[-.04,.95,-.40],[-.65,1.45,-2.15],null,1.6,1.75,.20,.08),
   shot('Right profile · strings & bodice',6,[-.04,.98,-.36],[-1.95,.16,-.25],null,1.3,1.55,.22,.08),
   shot('Left profile · bass strings',5,[-.04,.98,-.36],[1.95,.16,-.25],null,1.3,1.55,-.22,.08),
   shot('Over the harpist’s shoulder',7,[-.04,1.12,-.36],[.75,.65,.95],null,1.2,1.25,.20,.08),
   shot('Expression · harpist portrait',5,[0,1.24,.02],[-.85,.18,-.98],null,.75,.80,.20,.08),
   shot('Stage · reverse hall angle',7,[0,.92,-.30],[2.2,1.15,1.15],null,1.8,2.0,-.22,-.08),
   shot('Concert Harp · wide stage view',6,[0,.86,-.38],[1.10,.26,-2.75],null,1.8,1.95,.18,.08),
  ],
  bass:[
   shot('Double Bass · full instrument front',7,[.12,.88,-.20],[-.65,.18,-2.85],null,1.6,2.05),
   shot('French bow · alternating strokes',6,[.20,.74,-.39],[-.65,.18,-1.15],null,.95,.95,.22,.08),
   shot('Left hand · neck shifts',6,[.19,1.42,-.24],[.85,.18,-1.05],null,.85,.95,.22,.08),
   shot('Scroll & upper bout · high detail',5,[.18,1.52,-.20],[-.75,.22,-.95],null,.85,.90,-.22,.08),
   shot('Bridge & heavy strings · close-up',6,[.20,.72,-.37],[.55,.12,-1.05],null,.85,.85,.22,.08),
   shot('Double Bass · stage-left angle',7,[.12,.98,-.20],[1.75,.32,-2.15],null,1.5,1.95,.20,.08),
   shot('Bassist · right three-quarter',6,[.10,.98,-.20],[-1.85,.25,-1.65],null,1.5,1.95,.22,.08),
   shot('Low endpin & lower bout angle',5,[.20,.65,-.28],[-.65,-.12,-1.55],null,1.1,1.35,-.20,.08),
   shot('Over the bassist’s shoulder',7,[.15,1.18,-.18],[.85,.58,.95],null,1.2,1.35,.22,.08),
   shot('Expression · bassist portrait',5,[0,1.54,-.05],[-.85,.18,-1.05],null,.75,.80,.22,.08),
   shot('Stage · reverse hall angle',7,[.10,.95,-.18],[2.2,1.15,1.15],null,1.7,2.05,-.24,-.08),
   shot('Double Bass · wide concert view',6,[.12,.90,-.20],[.75,.22,-2.95],null,1.7,2.10,.18,.08),
  ],
  percussion:[
   shot('Percussion · concert front',7,[0,.68,-.46],[0,.52,-3.15],null,2.1,1.75),
   shot('Mallets & bars · overhead sweep',6,[0,.92,-.50],[.35,1.15,-1.35],null,1.5,1.25,.24,.08),
   shot('Stage-left · mallet arc',6,[0,.92,-.48],[1.65,.48,-1.65],null,1.6,1.35,.22,.08),
   shot('Stage-right · mallet arc',5,[0,.92,-.48],[-1.65,.48,-1.65],null,1.6,1.35,-.22,.08),
   shot('Mallet tips · close-up',6,[0,.94,-.48],[-.42,.38,-1.15],null,1.1,1.05,.24,.10),
   shot('Percussionist · portrait & mallets',7,[0,1.22,-.25],[.85,.26,-1.45],null,1.1,1.25,.22,.08),
   shot('Low resonator / kettle angle',6,[0,.72,-.50],[-.75,-.05,-1.85],null,1.5,1.35,.22,.08),
   shot('Right side · full stance',5,[0,.96,-.35],[-2.15,.35,-.85],null,1.5,1.60,-.20,.08),
   shot('Over the percussionist’s shoulder',7,[0,1.12,-.35],[.55,.78,1.25],null,1.6,1.35,.22,.08),
   shot('Left side · full stance',5,[0,.96,-.35],[2.15,.35,-.85],null,1.5,1.60,.20,.08),
   shot('Stage · reverse hall angle',7,[0,.95,-.35],[2.1,1.15,1.35],null,1.8,1.85,-.22,-.08),
   shot('Percussion · wide stage view',6,[0,.86,-.46],[-.55,.46,-2.85],null,2.0,1.70,.18,.08),
  ],
  quartet:[
   shot('String quartet · hall front',7,[0,.78,-.05],[0,.36,-4.85],null,3.4,1.65,.18,.08),
   shot('Violin I & II · bow sync',6,[.78,1.22,-.08],[1.10,.28,-2.10],null,1.6,1.10,.22,.10),
   shot('Cello & Viola · low strings',6,[-.82,1.02,-.05],[-1.15,.28,-2.25],null,1.7,1.15,.22,.10),
   shot('Quartet · stage-left arc',6,[0,.95,0],[2.65,.55,-3.55],null,2.9,1.60,.20,.08),
   shot('Violin I · concertmaster',6,[1.15,1.30,-.35],[.85,.20,-1.55],null,1.1,1.05,.24,.10),
   shot('Cello · bass anchor',6,[-1.18,.98,-.28],[-1.05,.24,-1.65],null,1.2,1.10,.22,.10),
   shot('Quartet · overhead semicircle',6,[0,.95,0],[.35,2.25,-3.65],null,3.0,1.70,.18,.08),
   shot('Viola · inner voice',6,[-.46,1.28,.22],[-.65,.22,-1.65],null,1.1,1.05,.22,.10),
   shot('Quartet · stage-right sweep',6,[0,.95,0],[-2.55,.52,-3.60],null,2.9,1.60,.20,.08),
   shot('Behind the quartet · hall view',6,[0,1.05,0],[.55,.85,3.25],null,3.1,1.65,.18,.08),
   shot('Center dialogue · Vn II & Va',6,[0,1.22,.22],[.18,.24,-1.85],null,1.5,1.05,.24,.10),
   shot('Quartet · wide recital view',6,[0,.82,-.05],[-.45,.42,-5.05],null,3.4,1.70,.16,.08),
  ],
  ensemble:[
   shot('All-Star Decet · grand stage',7,[0,.68,.45],[0,.58,-7.25],null,5.2,2.10,.16,.06),
   shot('Woodwinds · Flute & Oboe duet',6,[0,1.28,1.32],[.15,.24,-1.95],null,1.7,1.15,.22,.10),
   shot('Violin section · 4 bows in sync',6,[1.05,1.22,.15],[1.55,.38,-2.65],null,2.4,1.35,.20,.08),
   shot('Cello section & Classical Guitar',6,[-1.18,.95,-.32],[-1.55,.36,-2.45],null,2.2,1.30,.22,.08),
   shot('Grand Piano & Pianist · continuo',6,[2.05,.95,1.52],[1.45,.55,-2.35],null,2.2,1.35,.20,.08),
   shot('Decet · stage-left gallery',6,[0,.95,.45],[3.85,.85,-5.15],null,4.5,2.05,.18,.08),
   shot('Decet · overhead semicircle',6,[0,.95,.45],[.45,3.05,-5.10],null,4.6,2.10,.16,.08),
   shot('Guitar & Cello I · continuo',6,[-.75,.95,-.30],[-.72,.30,-1.85],null,1.5,1.15,.22,.10),
   shot('Decet · stage-right gallery',6,[0,.95,.45],[-3.85,.85,-5.15],null,4.5,2.05,.18,.08),
   shot('Behind the ensemble · hall view',6,[0,1.08,.45],[.65,1.25,4.65],null,4.6,2.10,.16,.08),
   shot('Front strings & soloist arc',6,[0,1.00,.10],[-.35,.42,-4.45],null,3.8,1.80,.18,.08),
   shot('All-Star Decet · wide concert',6,[0,.72,.45],[-.55,.65,-7.45],null,5.3,2.15,.16,.06),
  ],
 };
 function subjects(kind,pose){
  const point=p=>Array.isArray(p)?p:p&&[p.x,p.y,p.z];
  const centre=h=>point(h?.palmPos||h?.palm||h?.wrist);
  let left,right;
  if(kind==='piano'){left=centre(pose?.hands?.[1]);right=centre(pose?.hands?.[0]);}
  else if(kind==='guitar'){left=centre(pose?.hands?.[0])||point(pose?.wristL);right=centre(pose?.hands?.[1])||point(pose?.wristR);}
  else if(kind==='violin'||kind==='viola'||kind==='flute'||kind==='oboe'||kind==='clarinet'||kind==='trumpet'){left=centre(pose?.handL);right=centre(pose?.handR);}
  else if(kind==='cello'){left=point(pose?.hand?.masses?.palm?.centre||pose?.leftArm?.wrist);right=centre(pose?.bowHand)||point(pose?.rightArm?.wrist);}
  const result={};if(left?.every(Number.isFinite))result.left=left;if(right?.every(Number.isFinite))result.right=right;
  if(result.left&&result.right)result.hands=mul(add(left,right),.5);return result;
 }
 function sample(kind,t,subjects={},options={}){
  const shots=C[kind];if(!shots)throw Error('Unknown cinematic instrument: '+kind);
  const total=shots.reduce((v,s)=>v+s.duration,0);let clock=Math.max(0,Number.isFinite(t)?t:0)%total,index=0;
  while(clock>=shots[index].duration){clock-=shots[index++].duration;}
  const s=shots[index],phase=clock/s.duration,ease=phase*phase*(3-2*phase),motion=!options.reducedMotion;
  const at=(subjects[s.subject]||s.at).slice(),angle=motion?(ease-.5)*s.arc:0,dolly=motion?1+s.push*(.5-ease):1;
  const [x,y,z]=s.offset;let offset=[x*Math.cos(angle)-z*Math.sin(angle),y+(motion?.035*Math.sin(phase*Math.PI):0),x*Math.sin(angle)+z*Math.cos(angle)];
  offset=mul(offset,dolly);
  const aspect=Math.max(.25,options.aspect||1.5),span=s.subject==='hands'&&subjects.left&&subjects.right?Math.max(s.width,Math.hypot(...sub(subjects.left,subjects.right))+.22):s.width;
  const distance=Math.hypot(...offset),minimum=Math.max(span/(2*Math.tan(.57/2)*aspect),s.height/(2*Math.tan(.57/2)),.55);
  if(distance<minimum)offset=mul(offset,minimum/distance);
  return {eye:add(at,offset),at,up:s.up.slice(),label:String(index+1).padStart(2,'0')+' / '+s.label,index,phase,duration:s.duration};
 }
 function create(kind){let key=null,lastTime=null,filtered={};return {reset(){key=null;lastTime=null;filtered={};},at(t,subjects={},options={}){
  const dt=t-lastTime,reset=key!==options.key||lastTime==null||dt<0||dt>.5;key=options.key;lastTime=t;if(reset)filtered={};
  for(const [name,p]of Object.entries(subjects))if(p?.length===3&&p.every(Number.isFinite))filtered[name]=reset||!filtered[name]?p.slice():add(filtered[name],mul(sub(p,filtered[name]),1-Math.exp(-Math.max(0,dt)*3)));
  return sample(kind,t,filtered,options);
 }};}
 return {sample,create,subjects,catalog:C};
})();

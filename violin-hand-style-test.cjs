'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),crypto=require('node:crypto');
global.window=globalThis;
for(const n of ['bow-hand','hand-surface','violin-skin','violin-model'])vm.runInThisContext(fs.readFileSync('dist/instruments/'+n+'.js','utf8'),{filename:n});
const roots=[[.027,.070,0],[.009,.074,0],[-.009,.072,0],[-.027,.066,0]];
const hand={wrist:[0,0,0],palmPos:[0,.035,0],basis:[[1,0,0],[0,1,0],[0,0,-1]],fingers:roots.map(root=>({points:[root,[root[0],root[1]+.028,-.015],[root[0],root[1]+.047,-.035],[root[0],root[1]+.060,-.053]]})),thumb:[[.032,.035,-.012],[.052,.045,-.017],[.061,.060,-.020],[.064,.077,-.022]]};
const plain=ViolinFingerSkin.create(false,true,true),shaped=ViolinModel.createLeftSkin(),before=JSON.stringify(hand);
ViolinFingerSkin.update(plain,hand);ViolinFingerSkin.update(shaped,hand);
// Pin the old default geometry, to micrometre precision: piano, guitar and
// bow grips keep the original profile unless they explicitly opt into it.
const defaultHash=crypto.createHash('sha256').update(JSON.stringify(Array.from(plain.positions,v=>Math.round(v*1e6)))).digest('hex');
assert.equal(defaultHash,'8b8148718e13d662182e94a458c3516ed33f7d47d0939aaad7cd6ceb4e92f6d0');
const extent=(mesh,ring)=>Math.max(...Array.from({length:8},(_,j)=>Math.abs(mesh.positions[(ring*8+j)*3]-roots[0][0])));
const widthRatio=extent(shaped,3)/extent(plain,3);
assert(Math.abs(widthRatio-1.18)<1e-10,'The rendered shaft did not become thicker');
assert(extent(shaped,11)>extent(plain,11)*1.25,'The distal ring remains pointed');
const points=hand.fingers[0].points,tip=points[3],axis=tip.map((v,i)=>v-points[2][i]),length=Math.hypot(...axis);axis.forEach((v,i)=>axis[i]=v/length);
function behindTip(mesh,ring){const c=[0,0,0];for(let j=0;j<8;j++)for(let k=0;k<3;k++)c[k]+=mesh.positions[(ring*8+j)*3+k]/8;return -c.reduce((s,v,i)=>s+(v-tip[i])*axis[i],0);}
assert(Math.abs(behindTip(shaped,10)-.0045)<1e-10);
assert(behindTip(shaped,11)<behindTip(plain,11)*.75,'The cap still tapers to a long cone');
for(let k=0;k<3;k++)assert.equal(shaped.positions[97*3+k],tip[k],'Skin moved the musical fingertip');
assert.equal(shaped.thumb.skinBaseT,.65);assert.equal(JSON.stringify(hand),before);
const edges=new Map();for(let i=0;i<shaped.indices.length;i+=3)for(let j=0;j<3;j++){const a=shaped.indices[i+j],b=shaped.indices[i+(j+1)%3],key=Math.min(a,b)+':'+Math.max(a,b);edges.set(key,(edges.get(key)||0)+1);}assert([...edges.values()].every(n=>n===2),'Opened skin seam');
const storage=[shaped.positions,shaped.normals,shaped.data,shaped.indices];for(let i=0;i<20;i++)ViolinFingerSkin.update(shaped,hand);assert.deepEqual([shaped.positions,shaped.normals,shaped.data,shaped.indices],storage);storage.forEach((p,i)=>assert.equal(p,[shaped.positions,shaped.normals,shaped.data,shaped.indices][i]));
// Check the actual rounded skin pole against sounding contacts on all pieces.
for(const n of ['violin-fingering','violin-songs','violin-hand','violin-hand-frames','violin-motion'])vm.runInThisContext(fs.readFileSync('dist/instruments/'+n+'.js','utf8'),{filename:n});
const live=ViolinModel.createLeftSkin(),G=ViolinModel.GEOM,board={O:G.O0,U:G.U,V:G.V,W:G.W,top:G.wFB};let contactSamples=0;
for(const song of VIOLIN_SONGS){const P=ViolinMotion.plan(song);assert(ViolinMotion.NH.available(P));for(let i=0;i<=100;i++){const S=ViolinMotion.at(P,song.duration*i/100);ViolinFingerSkin.update(live,S.handL,board);for(let f=0;f<4;f++)if(S.debug.contacts[f].contact){const target=S.debug.contacts[f].target,offset=(f*98+97)*3;assert(Math.hypot(...target.map((v,k)=>v-live.positions[offset+k]))<.00000001,'Rounded skin lost its sounding contact');contactSamples++;}}}
console.log(JSON.stringify({defaultProfileUnchanged:true,contactSamples,shaftWidthIncreasePercent:(widthRatio-1)*100,distalRingWidthIncreasePercent:(extent(shaped,11)/extent(plain,11)-1)*100,capLengthMm:behindTip(shaped,10)*1000,thumbMetacarpalHiddenFraction:shaped.thumb.skinBaseT,closedSurface:true,reusesStorage:true},null,2));

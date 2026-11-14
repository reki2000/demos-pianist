'use strict';
// The distal thumb bone does not determine its neck seat. Reuse the
// verified wrist/finger coordinates when shortening only that distal bone.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),crypto=require('node:crypto');
global.window=globalThis;
for(const n of ['bow-hand','violin-fingering','violin-songs','violin-model','violin-hand','violin-hand-frames','violin-motion'])vm.runInThisContext(fs.readFileSync('dist/instruments/'+n+'.js','utf8'),{filename:n});
const N=ViolinMotion.NH,D=VIOLIN_HAND_FRAMES,digest=()=>crypto.createHash('sha256').update(JSON.stringify(D.songs)).digest('hex'),before=digest();
assert.deepEqual(N.THUMB_LEN,[.042,.032,.018]);let samples=0,maxSeatError=0;
for(const song of VIOLIN_SONGS){const P=ViolinMotion.plan(song),entry=D.songs[song.id];assert.equal(entry.signature,JSON.stringify(P.notes),'Score changed');for(let t=0;t<song.duration;t+=.1){const S=ViolinMotion.atLegacy(P,t),q=N.jointsAt(P,t,entry.keys,S.debug.contacts),thumb=N.thumbData(q),e=Math.hypot(...thumb.target.map((v,i)=>v-thumb.points[2][i]));maxSeatError=Math.max(maxSeatError,e);assert(e<.00005,'Shorter thumb lost its neck seat');samples++;}}
assert.equal(digest(),before,'Style migration moved the hand');assert.equal(N.stats().solves,0);
D.stamp=N.stamp();fs.writeFileSync('dist/instruments/violin-hand-frames.js',"'use strict';\n// Verified carriage coordinates; shorter distal thumb and rounded hand skin.\nwindow.VIOLIN_HAND_FRAMES="+JSON.stringify(D)+';\n');
console.log(JSON.stringify({samples,maxThumbSeatError:maxSeatError,carriageAndFingerDataPreserved:true,dataSHA256:before,thumbLengthsMm:N.THUMB_LEN.map(v=>v*1000)},null,2));

'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');global.window=globalThis;
for(const f of ['hand-surface','violin-skin','guitar-songs','guitar-fingering','guitar-motion','guitar-hands','guitar-hand-frames','guitar-skin','guitar-model','guitar-plans'])vm.runInThisContext(fs.readFileSync('dist/instruments/'+f+'.js','utf8'),{filename:f});
const G=GuitarMotion,N=GuitarHands,skins=[GuitarHandSkin.create(0),GuitarHandSkin.create(1)],audit=require('./guitar-clearance.cjs')(G,GuitarModel,GuitarHandSkin),report={handPoses:0,renderedSkinPenetration:{body:0,board:0,neck:0},limitMm:1,runtimeFits:0};
for(const song of GUITAR_SONGS){song.fingering=GUITAR_PLAN_CACHE[song.id];const P=G.plan(song);assert(N.available(P),'Stale or missing hand data');const times=new Set([0,song.duration,...P.events.map(e=>e.t),...N.boundaries(P)]);for(let t=0;t<song.duration;t+=1)times.add(t);
 for(const t of times){const S=G.pose(P,t);for(let h=0;h<2;h++){const m=audit.measure(skins[h],S.hands[h]);for(const part of ['body','board','neck'])report.renderedSkinPenetration[part]=Math.max(report.renderedSkinPenetration[part],m[part]);assert(m.max<.001,`${song.id} ${t} hand ${h}: skin intersects instrument by ${m.max*1000} mm`);report.handPoses++;}}
}
report.runtimeFits=N.stats().fits;assert.equal(report.runtimeFits,0);console.log(JSON.stringify(report,null,2));

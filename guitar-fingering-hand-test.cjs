'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');global.window=globalThis;
for(const f of ['guitar-fingering','guitar-motion','guitar-hands'])vm.runInThisContext(fs.readFileSync('dist/instruments/'+f+'.js','utf8'),{filename:f});
const F=GuitarFingering,N=GuitarHands;
function fixture(topFret=5,open=false){const notes=[[0,2,50,90],[.5,.5,64+topFret,90]],A=[{string:5,fret:5,lh:1,barre:1},{string:1,fret:topFret,lh:4,barre:0}];if(open){notes.splice(1,0,[.1,2,55,90]);A.splice(1,0,{string:3,fret:0,lh:0,barre:0});}return{notes,A};}
let a=fixture();assert.equal(F.reuseBarres(a.notes,a.A),1);assert.equal(a.A[1].lh,1,'The held barre must cover an equal-fret first string');
a=fixture(7);F.reuseBarres(a.notes,a.A);assert.equal(a.A[1].lh,4,'A higher note cannot be replaced by a lower barre');
a=fixture(5,true);F.reuseBarres(a.notes,a.A);assert.equal(a.A[2].lh,4,'Extending a barre must preserve a ringing open string');
const gap=N.segmentGap;assert(gap([0,0,0],[1,0,0],[.5,-1,0],[.5,1,0])<1e-10);assert(Math.abs(gap([0,0,0],[1,0,0],[0,.01,0],[1,.01,0])-.01)<1e-10);
const base=[0,0,0],target=[.01,.05,.015],distance=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));for(const phi of [-1,0,1]){const f=N.finger(base,target,2,[0,0,1],phi);assert(distance(f.points[3],target)<.000001);for(let j=0;j<3;j++)assert(Math.abs(distance(f.points[j],f.points[j+1])-N.LENGTHS[2][j])<1e-10);}
console.log(JSON.stringify({equalFretBarreReused:true,higherFretPreserved:true,openStringPreserved:true,swivelPreservesBonesAndContact:true},null,2));

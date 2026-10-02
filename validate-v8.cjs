const fs=require('fs'),vm=require('vm'),assert=require('assert'),crypto=require('crypto');
const html=fs.readFileSync('piano-recital-v8.html','utf8');
const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
assert.equal(scripts.length,9);assert(!/<script\s+src=|href="style.css"/.test(html));
for(const [i,script] of scripts.entries())new vm.Script(script,{filename:'inline-'+i+'.js'});
const c={window:null};c.window=c;vm.createContext(c);
for(const i of [0,2,3,5,6,7])vm.runInContext(scripts[i],c);
const manifest=c.PIANO_AUDIO_MANIFEST,data=c.PIANO_AUDIO_DATA;
assert.equal(Object.keys(data).length,Object.keys(manifest.assets).length);
let bytes=0;
for(const [id,a] of Object.entries(manifest.assets)){
 const buffer=Buffer.from(data[id],'base64');assert.equal(buffer.length,a.bytes);
 assert.equal(crypto.createHash('sha256').update(buffer).digest('hex'),a.sha256);bytes+=buffer.length;
}
const hashes=JSON.parse(fs.readFileSync('v6-note-hashes.json'));
for(const song of c.SONGS){assert.equal(crypto.createHash('sha256').update(JSON.stringify(song.notes)).digest('hex'),hashes[song.id]);for(const n of song.notes)for(const p of c.PianoAudio.notePlan(n))assert(data[p.id]);}
if(fs.existsSync('piano-recital-v7.html')){
 const previous=[...fs.readFileSync('piano-recital-v7.html','utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
 for(let i=0;i<5;i++)assert.equal(scripts[i],previous[i],'Motion/score/GL source changed');
}
console.log(JSON.stringify({inlineScriptSyntaxChecks:scripts.length,embeddedAssetsVerified:Object.keys(data).length,embeddedAudioBytes:bytes,songs:c.SONGS.length,noteAndFingeringHashesPreserved:true,allNotesHaveEmbeddedSamples:true,externalScriptOrStylesheetDependencies:0}));

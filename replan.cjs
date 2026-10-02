const fs=require('fs'),vm=require('vm');const c=global;c.window=c;vm.runInThisContext(fs.readFileSync('dist/songs.js','utf8'));vm.runInThisContext(fs.readFileSync('dist/motion.js','utf8'));
for(const s of c.SONGS){if(s.motion?.version>=12)continue;delete s.motion;s.originalNotes=s.notes.map(n=>n.slice());c.PianoMotion.build(s);delete s.originalNotes;console.log(s.id,s.notes.length);}
fs.writeFileSync('dist/songs.js','window.SONGS='+JSON.stringify(c.SONGS)+';');

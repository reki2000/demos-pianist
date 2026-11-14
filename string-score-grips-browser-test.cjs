'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict'),{chromium}=require('playwright');
const root=path.join(__dirname,'dist'),out=path.join(__dirname,'docs/verification/string-notation-grips');
const server=http.createServer((req,res)=>{const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));if(!file.startsWith(root+path.sep))return res.writeHead(403).end();fs.readFile(file,(err,data)=>{if(err)return res.writeHead(404).end();res.setHeader('Content-Type',({'.js':'application/javascript','.html':'text/html','.css':'text/css'})[path.extname(file)]||'application/octet-stream');res.end(data);});});
(async()=>{let browser;await new Promise(r=>server.listen(0,'127.0.0.1',r));try{
 browser=await chromium.launch({executablePath:process.env.CHROME||'/usr/bin/chromium',args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const page=await browser.newPage({viewport:{width:1100,height:900}}),errors=[],scores=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.multiShell&&window.StringScore);
 await page.evaluate(()=>{const render=StringScore.render;StringScore.render=(canvas,cfg)=>{const result=render(canvas,cfg);window.scoreSnapshot={cfg,result};return result;};});
 for(const instrument of ['violin','cello']){
  await page.evaluate(id=>multiShell.chooseInstrument(id),instrument);
  const ids=await page.evaluate(id=>(id==='violin'?VIOLIN_SONGS:CELLO_SONGS).map(s=>s.id),instrument);
  for(const id of ids){
   await page.evaluate(id=>multiShell.chooseSong(id),id);await page.waitForFunction(id=>window.scoreSnapshot?.cfg.song.id===id,id);
   const target=await page.evaluate(()=>{
    const {cfg}=scoreSnapshot,model=StringScore.prepare(cfg.song,cfg),beam=model.beams.find(b=>b.groups.length>=3)||model.beams[0];if(!beam)return {beams:0};
    const beat=beam.groups[Math.floor(beam.groups.length/2)].beat;let a=0,b=cfg.song.duration;for(let i=0;i<40;i++){const m=(a+b)/2;if(cfg.beatAt(m)<beat)a=m;else b=m;}
    return {beams:model.beams.length,time:(a+b)/2,beat,notes:beam.groups.length};
   });assert(target.beams>0,instrument+': no beam groups in '+id);
   for(const width of [1100,390]){
    await page.setViewportSize({width,height:900});await page.evaluate(t=>multiShell.seek(t),target.time);
    await page.waitForFunction(t=>window.scoreSnapshot&&Math.abs(scoreSnapshot.cfg.t-t)<.02&&scoreSnapshot.result.beams>0,target.time);
    const result=await page.evaluate(()=>({beams:scoreSnapshot.result.beams,clef:scoreSnapshot.result.clef,width:document.getElementById('score').clientWidth}));
    if(['bach-preludio','prelude','gigue'].includes(id))await page.locator('#score').screenshot({path:path.join(out,`${instrument}-${id}-${width}.png`)});
    scores.push({instrument,song:id,viewport:width,totalBeamGroups:target.beams,visibleBeams:result.beams,clef:result.clef});
   }
  }
 }
 await page.setViewportSize({width:1100,height:900});await page.evaluate(()=>{multiShell.chooseInstrument('guitar');multiShell.chooseSong('recuerdos');});await page.locator('[data-camera="hands"]').click();
 const grips=[];
 for(const bar of [3,7]){
  const time=(bar-1)*180/74+.8;await page.evaluate(t=>multiShell.seek(t),time);await page.waitForFunction(t=>window.__multiDebug?.instrument==='guitar'&&Math.abs(__multiDebug.time-t)<.02,time);await page.waitForTimeout(1200);
  await page.locator('#scene').screenshot({path:path.join(out,`alhambra-bar-${bar}.png`)});
  const result=await page.evaluate(bar=>{const s=GUITAR_SONGS.find(s=>s.id==='recuerdos');s.fingering=GUITAR_PLAN_CACHE.recuerdos;const P=GuitarMotion.plan(s),points=[];for(let t=(bar-1)*180/74+.2;t<bar*180/74-.2;t+=.05)points.push(GuitarMotion.pose(P,t).hands[0].wrist);return {bar,wristRangeMm:1000*Math.max(...points.flatMap(a=>points.map(b=>Math.hypot(...a.map((v,i)=>v-b[i]))))),runtimeFits:GuitarHands.stats().fits,gl:document.getElementById('scene').getContext('webgl').getError()};},bar);
  assert(result.wristRangeMm<.01);assert.equal(result.runtimeFits,0);assert.equal(result.gl,0);grips.push(result);
 }
 assert.deepEqual(errors,[]);console.log(JSON.stringify({scores,grips,pageErrors:errors},null,2));
 }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}})().catch(e=>{console.error(e);process.exitCode=1;});

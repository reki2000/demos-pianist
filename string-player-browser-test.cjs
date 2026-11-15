'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict'),{chromium}=require('playwright');
const root=path.join(__dirname,'dist'),out=path.join(__dirname,process.env.STRING_PLAYER_VERIFICATION_DIR||'docs/verification/string-player-proportions');
const server=http.createServer((req,res)=>{const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));if(!file.startsWith(root+path.sep))return res.writeHead(403).end();fs.readFile(file,(err,data)=>{if(err)return res.writeHead(404).end();res.setHeader('Content-Type',({'.js':'application/javascript','.html':'text/html','.css':'text/css','.mp3':'audio/mpeg'})[path.extname(file)]||'application/octet-stream');res.end(data);});});
(async()=>{let browser;await new Promise(r=>server.listen(0,'127.0.0.1',r));try{
 browser=await chromium.launch({executablePath:process.env.CHROME||'/usr/bin/chromium',args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--autoplay-policy=no-user-gesture-required']});
 const page=await browser.newPage({viewport:{width:1100,height:900}}),errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.multiShell&&window.ViolinModel);
 await page.evaluate(()=>{window.stringViews={};const vd=ViolinModel.draw;ViolinModel.draw=(R,S)=>{stringViews.violin={time:S.time,buffers:R.dynamicStats(),gl:R.gl.getError(),fits:ViolinMotion.NH.stats().solves};return vd(R,S);};const cd=CelloMotion.draw;CelloMotion.draw=(R,song,t,...rest)=>{stringViews.cello={time:t,buffers:R.dynamicStats(),gl:R.gl.getError()};return cd(R,song,t,...rest);};});
 const poses=[];
 for(const [type,song,time]of [['violin','air',13.75],['violin','czardas',216.1],['cello','prelude',20],['cello','swan',60],['cello','gigue',33]]){
  await page.evaluate(({type,song,time})=>{multiShell.chooseInstrument(type);multiShell.chooseSong(song);multiShell.seek(time);},{type,song,time});
  await page.waitForFunction(({type,time})=>window.stringViews[type]&&Math.abs(stringViews[type].time-time)<.01,{type,time});
  for(const camera of ['hands','portrait']){await page.locator(`[data-camera="${camera}"]`).click();await page.waitForTimeout(400);await page.locator('#scene').screenshot({path:path.join(out,`${type}-${song}-${camera}.png`)});}
  const pose=await page.evaluate(type=>stringViews[type],type);assert.equal(pose.gl,0);poses.push({type,song,time});
 }
 const playback=[];
 for(const type of (process.argv.includes('--poses-only')?[]:['violin','cello'])){
  await page.evaluate(type=>{multiShell.chooseInstrument(type);multiShell.chooseSong(type==='violin'?'meditation':'swan');multiShell.seek(0);multiShell.play();},type);await page.waitForTimeout(1000);
  const sample=()=>page.evaluate(type=>({...stringViews[type],playing:multiShell.getState().playing}),type),first=await sample(),observations=[];
  for(let i=0;i<15;i++){await page.waitForTimeout(5000);const v=await sample();assert(v.playing);assert.equal(v.buffers.buffers,first.buffers.buffers);assert.equal(v.gl,0);if(type==='violin')assert.equal(v.fits,0);observations.push(v);}
  assert(observations.at(-1).time-first.time>60);assert(observations.at(-1).buffers.uploads>first.buffers.uploads);await page.evaluate(()=>multiShell.pause());playback.push({type,seconds:75,first,observations});
 }
 assert.deepEqual(errors,[]);console.log(JSON.stringify({poses,playback,pageErrors:errors,auditoryCheck:false},null,2));

 }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}})().catch(e=>{console.error(e);process.exitCode=1;});

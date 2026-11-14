'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict'),{chromium}=require('playwright');
const root=path.join(__dirname,'dist'),output=path.join(__dirname,'docs/verification/repertoire');
const server=http.createServer((req,res)=>{const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));if(!file.startsWith(root+path.sep))return res.writeHead(403).end();fs.readFile(file,(err,data)=>{if(err)return res.writeHead(404).end();res.setHeader('Content-Type',({'.js':'application/javascript','.html':'text/html','.css':'text/css','.mp3':'audio/mpeg'})[path.extname(file)]||'application/octet-stream');res.end(data);});});
(async()=>{let browser;await new Promise(r=>server.listen(0,'127.0.0.1',r));try{
 browser=await chromium.launch({executablePath:process.env.CHROME||'/usr/bin/chromium',args:['--no-sandbox','--autoplay-policy=no-user-gesture-required','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const page=await browser.newPage({viewport:{width:1000,height:800}}),errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.addInitScript(()=>{
  window.testRenderers=[];let current;
  Object.defineProperty(window,'RecitalGL',{configurable:true,get:()=>current,set(api){current=api;const create=api.create;api.create=(...args)=>{const R=create(...args);testRenderers.push(R);return R;};}});
  window.audioTaps=[];const connect=AudioNode.prototype.connect;
  AudioNode.prototype.connect=function(target,...args){const result=connect.call(this,target,...args);if(target instanceof AudioDestinationNode){let tap=audioTaps.find(t=>t.ctx===this.context);if(!tap){tap={ctx:this.context,analyser:this.context.createAnalyser()};tap.analyser.fftSize=2048;audioTaps.push(tap);}connect.call(this,tap.analyser);}return result;};
 });
 await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.multiShell);
 const report=[];
 for(const [instrument,song]of [['guitar','recuerdos'],['violin','bach-preludio']]){
  await page.evaluate(({instrument,song})=>{multiShell.chooseInstrument(instrument);multiShell.chooseSong(song);multiShell.seek(0);}, {instrument,song});
  await page.waitForFunction(({instrument,song})=>window.__multiDebug?.instrument===instrument&&window.__multiDebug?.song===song,{instrument,song});
  await page.evaluate(()=>multiShell.play());let peak=0;
  for(let i=0;i<12;i++){await page.waitForTimeout(500);const rms=await page.evaluate(()=>Math.max(0,...audioTaps.map(({analyser})=>{const data=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(data);return Math.sqrt(data.reduce((s,v)=>s+v*v,0)/data.length);})));peak=Math.max(peak,rms);}
  const state=await page.evaluate(()=>multiShell.getState());assert(state.playing&&state.time>=4,JSON.stringify(state));assert(peak>.00001,'No synthesized audio output');await page.evaluate(()=>multiShell.pause());
  for(const t of [0,20,60,100]){await page.evaluate(t=>multiShell.seek(t),t);await page.waitForFunction(t=>Math.abs(__multiDebug.time-t)<.02,t);}
  await page.evaluate(()=>multiShell.seek(2));await page.waitForFunction(()=>Math.abs(__multiDebug.time-2)<.02);
  await page.locator('[data-camera="hands"]').click();await page.waitForTimeout(1500);
  await page.screenshot({path:path.join(output,instrument+'.png')});
  const status=await page.evaluate(()=>({fits:GuitarHands.stats().fits,solves:ViolinMotion.NH.stats().solves,gl:testRenderers.map(R=>R.gl.getError())}));assert.equal(status.fits,0);assert.equal(status.solves,0);assert(status.gl.every(e=>e===0));
  report.push({instrument,song,playedSeconds:state.time,peakRMS:peak,seekTimes:[0,20,60,100],...status});
 }
 assert.deepEqual(errors,[]);console.log(JSON.stringify({instruments:report,pageErrors:errors,auditoryCheck:false},null,2));
 }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}})().catch(e=>{console.error(e);process.exitCode=1;});

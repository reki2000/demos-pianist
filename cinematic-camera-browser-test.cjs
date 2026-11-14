'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict'),{chromium}=require('playwright');
const root=path.join(__dirname,'dist'),output=path.join(__dirname,'docs/verification/cinematic');
const server=http.createServer((req,res)=>{const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));if(!file.startsWith(root+path.sep))return res.writeHead(403).end();fs.readFile(file,(err,data)=>{if(err)return res.writeHead(404).end();res.setHeader('Content-Type',({'.js':'application/javascript','.html':'text/html','.css':'text/css'})[path.extname(file)]||'application/octet-stream');res.end(data);});});
const delta=(a,b)=>a.map((v,i)=>v-b[i]);
(async()=>{let browser;await new Promise(r=>server.listen(0,'127.0.0.1',r));try{
 browser=await chromium.launch({executablePath:process.env.CHROME||'/usr/bin/chromium',args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const page=await browser.newPage({viewport:{width:1000,height:800}}),errors=[],reports=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.addInitScript(()=>{let current;window.cameraSerial=0;Object.defineProperty(window,'RecitalGL',{configurable:true,get:()=>current,set(api){current=api;const create=api.create;api.create=(...args)=>{const R=create(...args),begin=R.begin;R.begin=(eye,at,up=[0,1,0])=>{begin.call(R,eye,at,up);window.cameraRenderer=R;window.cameraFrame={eye:eye.slice(),at:at.slice(),up:up.slice(),serial:++cameraSerial};};return R;};}});});
 await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.multiShell&&window.CinematicCamera);
 async function seek(instrument,t,index){
  const serial=await page.evaluate(({instrument,t})=>{const serial=cameraSerial;if(instrument==='piano')recital.seek(t);else multiShell.seek(t);return serial;},{instrument,t});
  await page.waitForFunction(({serial,prefix})=>window.cameraFrame?.serial>serial&&document.getElementById('shotText').textContent.startsWith(prefix),{serial,prefix:String(index+1).padStart(2,'0')+' / '});
  return page.evaluate(()=>({...cameraFrame,label:document.getElementById('shotText').textContent,projection:cameraRenderer.project(cameraFrame.at),gl:cameraRenderer.gl.getError(),guitarFits:GuitarHands.stats().fits,violinSolves:ViolinMotion.NH.stats().solves}));
 }
 for(const viewport of [{width:1000,height:800},{width:390,height:844}]){
  await page.setViewportSize(viewport);
  for(const instrument of ['piano','guitar','violin','cello']){
   await page.evaluate(id=>{multiShell.chooseInstrument(id);if(id==='piano')recital.choose(SONGS.reduce((a,b)=>a.duration>b.duration?a:b).id);else if(id==='violin')multiShell.chooseSong('czardas');else if(id==='guitar')multiShell.chooseSong('asturias');},instrument);
   if(instrument==='piano')await page.evaluate(async()=>{await recital.play();recital.pause();});
   await page.locator('[data-camera="auto"]').click();const times=await page.evaluate(id=>{let t=0;return CinematicCamera.catalog[id].map(s=>{const mid=t+s.duration/2;t+=s.duration;return mid;});},instrument),shots=[];
   for(let i=0;i<times.length;i++){
    const q=await seek(instrument,times[i],i);assert(q.eye.concat(q.at,q.up).every(Number.isFinite));assert.equal(q.gl,0);assert.equal(q.guitarFits,0);assert.equal(q.violinSolves,0);assert(q.projection.visible&&Math.abs(q.projection.x-.5)<.001&&Math.abs(q.projection.y-.5)<.001);
    shots.push({index:i,label:q.label,distance:Math.hypot(...delta(q.eye,q.at))});
    if(viewport.width===1000&&[1,2,3,8].includes(i))await page.screenshot({path:path.join(output,`${instrument}-${i+1}.png`)});
   }
   const a=await seek(instrument,times[1]-.5,1),b=await seek(instrument,times[1]+.5,1);assert(Math.hypot(...delta(delta(a.eye,a.at),delta(b.eye,b.at)))>.005,'No rendered camera motion');
   await page.emulateMedia({reducedMotion:'reduce'});const r=await seek(instrument,times[1]-.5,1),r2=await seek(instrument,times[1]+.5,1);assert(Math.hypot(...delta(delta(r.eye,r.at),delta(r2.eye,r2.at)))<1e-7,'Reduced-motion preference ignored');await page.emulateMedia({reducedMotion:'no-preference'});
   reports.push({instrument,viewport,shots,movingWithinShot:true,reducedMotion:true});
  }
 }
 assert.deepEqual(errors,[]);console.log(JSON.stringify({views:reports,pageErrors:errors,runtimeFits:0},null,2));
 }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}})().catch(e=>{console.error(e);process.exitCode=1;});

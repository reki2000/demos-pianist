'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict'),{chromium}=require('playwright');
const root=path.join(__dirname,'dist'),out=path.join(__dirname,'docs/verification/violin-expression');
const server=http.createServer((req,res)=>{const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));if(!file.startsWith(root+path.sep))return res.writeHead(403).end();fs.readFile(file,(err,data)=>{if(err)return res.writeHead(404).end();res.setHeader('Content-Type',({'.js':'application/javascript','.html':'text/html','.css':'text/css','.mp3':'audio/mpeg'})[path.extname(file)]||'application/octet-stream');res.end(data);});});
(async()=>{let browser;await new Promise(r=>server.listen(0,'127.0.0.1',r));try{
 browser=await chromium.launch({executablePath:process.env.CHROME||'/usr/bin/chromium',args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--autoplay-policy=no-user-gesture-required']});
 const page=await browser.newPage({viewport:{width:1100,height:900}}),errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.multiShell&&window.ViolinModel);
 await page.evaluate(()=>{const draw=ViolinModel.draw;ViolinModel.draw=(R,S)=>{window.violinSnapshot={time:S.time,model:S.handL.model,expression:S.expression,parent:typeof R.withTransform==='function',buffers:R.dynamicStats(),gl:R.gl.getError()};return draw(R,S);};});
 const poses=[];
 for(const [song,time]of [['air',13.75],['czardas',216.1],['meditation',205],['bach-preludio',81.85]]){
  await page.evaluate(({song,time})=>{multiShell.chooseInstrument('violin');multiShell.chooseSong(song);multiShell.seek(time);},{song,time});
  await page.waitForFunction(t=>window.violinSnapshot&&Math.abs(violinSnapshot.time-t)<.01,time);
  for(const camera of ['hands','portrait']){await page.locator(`[data-camera="${camera}"]`).click();await page.waitForTimeout(500);await page.locator('#scene').screenshot({path:path.join(out,`${song}-${camera}.png`)});}
  const pose=await page.evaluate(()=>violinSnapshot);assert.equal(pose.model,'natural');assert(pose.parent);assert.equal(pose.gl,0);poses.push({song,time,expression:pose.expression});
 }
 await page.evaluate(()=>{multiShell.chooseSong('meditation');multiShell.seek(30);multiShell.play();});await page.waitForTimeout(1200);
 const first=await page.evaluate(()=>violinSnapshot);await page.waitForTimeout(10000);const last=await page.evaluate(()=>({...violinSnapshot,solves:ViolinMotion.NH.stats().solves}));
 assert(last.time-first.time>7);assert.equal(last.buffers.buffers,first.buffers.buffers);assert(last.buffers.uploads>first.buffers.uploads);assert.equal(last.solves,0);assert.equal(last.gl,0);
 assert(Math.abs(last.expression.yaw-first.expression.yaw)+Math.abs(last.expression.roll-first.expression.roll)>.005);assert.deepEqual(errors,[]);
 console.log(JSON.stringify({poses,playback:{firstTime:first.time,lastTime:last.time,dynamicBuffers:last.buffers.buffers,runtimeFits:last.solves},pageErrors:errors,auditoryCheck:false},null,2));
 }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}})().catch(e=>{console.error(e);process.exitCode=1;});

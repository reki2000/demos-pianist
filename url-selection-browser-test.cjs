'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict'),{chromium}=require('playwright');
const root=path.join(__dirname,'dist'),server=http.createServer((req,res)=>{if(new URL(req.url,'http://localhost').pathname==='/standalone.html'){fs.readFile(path.join(__dirname,'piano-recital.html'),(err,data)=>{if(err)return res.writeHead(404).end();res.setHeader('Content-Type','text/html');res.end(data);});return;}const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));if(!file.startsWith(root+path.sep))return res.writeHead(403).end();fs.readFile(file,(err,data)=>{if(err)return res.writeHead(404).end();res.setHeader('Content-Type',({'.js':'application/javascript','.html':'text/html','.css':'text/css'})[path.extname(file)]||'application/octet-stream');res.end(data);});});
(async()=>{let browser;await new Promise(r=>server.listen(0,'127.0.0.1',r));try{
 browser=await chromium.launch({executablePath:process.env.CHROME||'/usr/bin/chromium',args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const context=await browser.newContext({viewport:{width:950,height:750}}),errors=[],report={instruments:[],invalidLinks:[],pageErrors:errors};
 context.on('page',p=>p.on('pageerror',e=>errors.push(String(e))));
 await context.addInitScript(()=>{window.initialSelectionHistoryLength=history.length;window.selectionAudioContexts=0;const C=window.AudioContext;if(C)window.AudioContext=class extends C{constructor(...args){super(...args);selectionAudioContexts++;}};});
 const page=await context.newPage(),base='http://127.0.0.1:'+server.address().port+'/';
 const ready=p=>p.waitForFunction(()=>window.multiShell&&window.recital);
 const read=p=>p.evaluate(()=>({state:multiShell.getState(),instrument:document.querySelector('[data-instrument].selected')?.dataset.instrument,song:document.querySelector('#songs .song.active')?.dataset.song,url:location.href,history:history.length,initialHistory:initialSelectionHistoryLength,audioContexts:selectionAudioContexts}));
 async function check(p,id,song){await p.waitForFunction(({id,song})=>window.multiShell&&multiShell.getState().instrument===id&&multiShell.getState().song===song,{id,song});const v=await read(p),u=new URL(v.url);assert.equal(v.instrument,id);assert.equal(v.song,song);assert.equal(u.searchParams.get('instrument'),id);assert.equal(u.searchParams.get('song'),song);assert.equal(v.state.playing,false);assert.equal(v.audioContexts,0,'Restoring a selection started audio');return v;}
 let v;
 if(!process.argv.includes('--standalone-only')){
 await page.goto(base);await ready(page);v=await read(page);const firstPiano=v.state.song;await check(page,'piano',firstPiano);assert.equal(v.history,v.initialHistory,'Initial normalization pushed a history entry');
 for(const id of ['piano','guitar','violin','cello']){
  await page.locator(`[data-instrument="${id}"]`).click();const button=page.locator('#songs .song').nth(1),song=await button.getAttribute('data-song');await button.click();v=await check(page,id,song);const length=v.history;
  // Re-selecting the current instrument or song must not flood history.
  await page.locator(`[data-instrument="${id}"]`).click();await page.locator(`#songs [data-song="${song}"]`).click();assert.equal((await read(page)).history,length);
  await page.reload();await ready(page);const restored=await check(page,id,song);assert.equal(restored.history,length);assert.equal(restored.history,restored.initialHistory);
  const copy=await context.newPage();await copy.goto(restored.url);await ready(copy);const shared=await check(copy,id,song);assert.equal(shared.history,shared.initialHistory,'Deep-link restoration added an intermediate selection');await copy.close();
  report.instruments.push({instrument:id,song,reload:true,copiedURL:true,noAutoplay:true});
 }
 const before=await read(page);await page.locator('[data-instrument="violin"]').click();const middle=await read(page);await page.locator('#songs .song').nth(1).click();const after=await read(page),historyLength=after.history;
 await page.goBack();await check(page,middle.state.instrument,middle.state.song);assert.equal((await read(page)).history,historyLength);
 await page.goBack();await check(page,before.state.instrument,before.state.song);
 await page.goForward();await check(page,middle.state.instrument,middle.state.song);await page.goForward();await check(page,after.state.instrument,after.state.song);report.backForward=true;
 await page.goto(base+'?instrument=cello&song=swan&campaign=keep%20me#notes');await ready(page);await check(page,'cello','swan');await page.locator('[data-instrument="guitar"]').click();v=await read(page);let u=new URL(v.url);assert.equal(u.searchParams.get('campaign'),'keep me');assert.equal(u.hash,'#notes');await page.reload();await ready(page);await check(page,'guitar',v.state.song);report.otherParametersAndFragmentPreserved=true;
 for(const [query,id,song]of [['?instrument=missing&song=missing','piano',firstPiano],['?instrument=__proto__&song=constructor','piano',firstPiano],['?instrument=violin&song=missing','violin','air'],['?instrument=cello&song=air','cello','prelude']]){
  await page.goto(base+query);await ready(page);const corrected=await check(page,id,song);assert.equal(corrected.history,corrected.initialHistory);report.invalidLinks.push({query,instrument:id,song});
 }
 // Piano changes through its public API also reach the shell observer.
 await page.evaluate(()=>{multiShell.chooseInstrument('piano');recital.choose(SONGS[2].id);});v=await read(page);await check(page,'piano',v.state.song);report.programmaticPianoSelection=true;
 }
 if(process.argv.includes('--standalone')||process.argv.includes('--standalone-only')){await page.goto(base+'standalone.html?instrument=cello&song=swan');await ready(page);await check(page,'cello','swan');await page.locator('[data-instrument="violin"]').click();await page.locator('#songs .song').nth(1).click();v=await read(page);await page.reload();await ready(page);await check(page,'violin',v.state.song);report.standaloneHTMLReload=true;report.standaloneURLScheme='http:';report.fileURLTested=false;}
 assert.deepEqual(errors,[]);console.log(JSON.stringify(report,null,2));
 }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}})().catch(e=>{console.error(e);process.exitCode=1;});

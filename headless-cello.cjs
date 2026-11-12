'use strict';
// Local verification only; Chrome/Puppeteer paths may be overridden.
const fs = require('fs'), path = require('path'), http = require('http'), assert = require('assert');
const { createRequire } = require('module');
const puppeteer = createRequire(process.env.HEADLESS_PACKAGE || '/home/hatch/workspace/.headless/package.json')('puppeteer-core');
const out = path.join(__dirname, 'docs/verification/cello-body');
const root = path.join(__dirname, 'dist');
const server = http.createServer((req, res) => {
  const file = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname.replace(/\/$/, '/index.html'));
  if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (e, data) => {
    if (e) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', ({'.html':'text/html','.js':'application/javascript','.css':'text/css','.mp3':'audio/mpeg'})[path.extname(file)] || 'application/octet-stream');
    res.end(data);
  });
});
(async () => {
  fs.mkdirSync(out, {recursive:true});
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const browser = await puppeteer.launch({executablePath: process.env.CHROME || '/home/hatch/workspace/.headless/chrome-headless-shell/linux-156.0.8078.80/chrome-headless-shell-linux64/chrome-headless-shell', args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  try {
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.setViewport({width:1200,height:800});
    await page.evaluateOnNewDocument(() => {
      window.__celloSmoke = {meshFrames:0,meshUploads:0,oscillatorsStarted:0,cacheCalls:0,glErrors:[]};
      const start = OscillatorNode.prototype.start;
      OscillatorNode.prototype.start = function(...args) { window.__celloSmoke.oscillatorsStarted++; return start.apply(this,args); };
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/`, {waitUntil:'load',timeout:60000});
    await page.waitForFunction(() => window.multiShell && window.CELLO_POSE_CACHE);
    await page.evaluate(() => {
      const draw = CelloModel.drawCello, cached = CelloMotion.poseCached;
      CelloMotion.poseCached = (...args) => { __celloSmoke.cacheCalls++; return cached(...args); };
      CelloModel.drawCello = (R, opts) => {
        if (!R.__smokeWrapped) {
          if (typeof R.mesh !== 'function') throw Error('smooth mesh adapter not installed');
          const mesh=R.mesh, gl=R.gl, upload=gl.bufferData.bind(gl);
          gl.bufferData=(target,data,usage)=>{if(data===CelloModel.BODY_MESH)__celloSmoke.meshUploads++;return upload(target,data,usage);};
          R.mesh=(data,color)=>{if(data!==CelloModel.BODY_MESH)throw Error('wrong mesh');__celloSmoke.meshFrames++;mesh(data,color);const e=gl.getError();if(e)__celloSmoke.glErrors.push(e);};
          R.__smokeWrapped=true;
        }
        return draw(R,opts);
      };
      multiShell.chooseInstrument('cello');
    });
    const songs = [];
    for (const [song, requested] of [['prelude',9.45],['swan',20.14],['gigue',31],['menuet',30]]) {
      // Start just before an onset: transport intentionally does not retrigger
      // a note already held at an arbitrary seek point (notably The Swan).
      const t = await page.evaluate((song, requested) => {
        const s=CELLO_INSTRUMENT.songs.find(s=>s.id===song);
        return Math.max(0,s.notes.find(n=>n[0]>=requested)[0]-.02);
      },song,requested);
      await page.evaluate((song,t)=>{multiShell.chooseSong(song);multiShell.seek(t);},song,t);
      const before=await page.evaluate(()=>({...multiShell.getState(),audio:__celloSmoke.oscillatorsStarted}));
      await page.click('#play');
      await page.waitForFunction(t=>multiShell.getState().playing && multiShell.getState().time>t+.45,{},t);
      const after=await page.evaluate(()=>({...multiShell.getState(),audio:__celloSmoke.oscillatorsStarted,debug:__multiDebug,sides:multiShell.debugSides()}));
      assert(after.audio>before.audio, 'no cello audio scheduled: '+song);
      assert.equal(after.debug.song,song);
      songs.push({song,timeBefore:before.time,timeAfter:after.time,playing:after.playing,oscillatorsStarted:after.audio-before.audio});
      if (song==='prelude'||song==='swan') await page.screenshot({path:path.join(out,song+'.png')});
      await page.evaluate(()=>multiShell.pause());
    }
    const checks=await page.evaluate(()=>({...__celloSmoke,triangles:CelloModel.BODY_MESH.length/18,solver:CelloMotion.NH.stats(),cacheHz:CELLO_POSE_CACHE.hz}));
    assert(checks.meshFrames>0 && checks.cacheCalls>0);
    assert.equal(checks.meshUploads,1,'mesh buffer must be reused across songs');
    assert.equal(checks.solver.solves,0,'shipped pose cache must avoid runtime NH frame solves');
    assert.equal(checks.triangles,11880); assert.deepStrictEqual(checks.glErrors,[]); assert.deepStrictEqual(errors,[]);
    // Ensure the adapter does not break the other instruments or the piano return path.
    for(const id of ['guitar','violin','piano']) {
      await page.evaluate(id=>multiShell.chooseInstrument(id),id);
      await new Promise(r=>setTimeout(r,200));
    }
    assert.equal(errors.length,0);
    const report={ok:true,songs,checks,pageErrors:errors,returnToPiano:true};
    fs.writeFileSync(path.join(out,'headless.json'),JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify(report,null,2));
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>server.close());

'use strict';
// Real-time playback regression; requires Playwright + Chromium (or CHROME).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const root = path.join(__dirname, 'dist');
const seconds = Number(process.env.SOAK_SECONDS || 190);
assert(Number.isFinite(seconds) && seconds >= 75 && seconds <= 300);
const server = http.createServer((req, res) => {
  const file = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname.replace(/\/$/, '/index.html'));
  if (!file.startsWith(root + path.sep)) return res.writeHead(403).end();
  fs.readFile(file, (error, data) => {
    if (error) return res.writeHead(404).end();
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.mp3': 'audio/mpeg' })[path.extname(file)] || 'application/octet-stream');
    res.end(data);
  });
});
(async () => {
  let browser;
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    browser = await chromium.launch({
      ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}),
      args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    });
    const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    await page.addInitScript(() => {
      Object.defineProperty(window, 'PianoAudio', { configurable: true, set(api) {
        const create = api.create;
        api.create = (...args) => window.soakEngine = create(...args);
        Object.defineProperty(window, 'PianoAudio', { value: api, writable: true, configurable: true });
      } });
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.evaluate(() => recital.play());
    const observations = [], started = Date.now();
    while ((Date.now() - started) / 1000 < seconds) {
      await new Promise(resolve => setTimeout(resolve, 5000));
      const state = await page.evaluate(() => ({ ...recital.getState(),
        voices: soakEngine.voices.size, samples: soakEngine.buffers.size,
        attacks: soakEngine.stats.attacks.length, baseLatency: soakEngine.master.context.baseLatency,
      }));
      assert(state.playing, 'Playback stopped early');
      assert(state.voices <= 160, 'Sounding and retiring voices accumulated');
      assert.equal(state.samples, 92, 'Sample cache grew during one piece');
      assert(state.attacks <= 512, 'Debug history accumulated');
      observations.push(state);
    }
    assert(observations.at(-1).time >= 60, 'Did not reach the reported onset time');
    await page.evaluate(() => recital.pause());
    await page.waitForFunction(() => soakEngine.master.context.state === 'suspended');
    assert.equal(await page.evaluate(() => soakEngine.voices.size), 0);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ realTimePlayback: true, seconds, observations, pausedContextSuspended: true, auditoryCheck: false }, null, 2));
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

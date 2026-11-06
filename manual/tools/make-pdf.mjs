// Print the manual to PDF (A4, CSS page size), after fonts and the QR code are ready; also check phone width.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const [page, outPdf] = process.argv.slice(2);
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 9200 + Math.floor(Math.random() * 90);
const p = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'pdf-'))}`, 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let w; for (let i = 0; i < 50 && !w; i++) { try { w = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(t => t.type === 'page')?.webSocketDebuggerUrl; } catch {} await sleep(200); }
const ws = new WebSocket(w); await new Promise(r => ws.addEventListener('open', r, { once: true }));
let seq = 0; const wait = new Map(); const errs = [];
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.text); if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); } });
const send = (method, params = {}) => new Promise(res => { const id = ++seq; wait.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const ev = async x => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result.result?.value;
await send('Page.enable'); await send('Runtime.enable');
await send('Page.navigate', { url: pathToFileURL(page).href });
for (let i = 0; i < 60; i++) { await sleep(250); if (await ev("document.readyState==='complete' && !!document.querySelector('#qr img, #qr canvas')")) break; }
await ev('document.fonts.ready.then(()=>true)'); await sleep(500);
const imgs = await ev(`[...document.images].filter(i => i.closest('#qr') === null).map(i => [i.getAttribute('src'), i.naturalWidth > 0])`);
const r = await send('Page.printToPDF', { preferCSSPageSize: true, printBackground: true });
writeFileSync(outPdf, Buffer.from(r.result.data, 'base64'));
for (const wdt of [390, 1280]) {
  await send('Emulation.setDeviceMetricsOverride', { width: wdt, height: 900, deviceScaleFactor: 1, mobile: wdt < 600 });
  await sleep(400);
  console.log('width', wdt, 'scrollWidth', await ev('document.documentElement.scrollWidth'), 'height', await ev('document.documentElement.scrollHeight'));
}
console.log('images broken:', imgs.filter(x => !x[1]).map(x => x[0]), 'of', imgs.length, '| anchors ok:', await ev(`[...document.querySelectorAll('.toc a')].every(a => document.querySelector(a.getAttribute('href')))`), '| JS errors', errs.length);
ws.close(); p.kill();

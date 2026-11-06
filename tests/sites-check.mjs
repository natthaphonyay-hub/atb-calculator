// usage: node tests/sites-check.mjs [page URL, default the DoseLogic home]   (prints the frames and the ATB version shown on the public DoseLogic Google Site)
// Which ATB does the public Google Sites page show right now? Lists the frame targets and the version text inside them.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const port = 9900 + Math.floor(Math.random() * 90);
const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'sites-'))}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });
let wsUrl; for (let i = 0; i < 50 && !wsUrl; i++) { try { wsUrl = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(t => t.type === 'page')?.webSocketDebuggerUrl; } catch {} await sleep(200); }
const ws = new WebSocket(wsUrl); await new Promise(r => ws.addEventListener('open', r, { once: true }));
let seq = 0; const wait = new Map(); const attached = [];
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.method === 'Target.attachedToTarget') attached.push(m.params); if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); } });
const send = (method, params = {}, sessionId) => new Promise(res => { const id = ++seq; wait.set(id, res); ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params })); });
await send('Page.enable');
await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
const target = process.argv[2] || 'https://sites.google.com/view/pharmatoolseditor';
await send('Page.navigate', { url: target + (target.includes('?') ? '&' : '?') + 'nocache=' + Date.now() });
await sleep(9000);
for (const a of attached) {
  const s = a.sessionId;
  await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, s);
}
await sleep(4000);
const seen = [];
for (const a of attached) {
  const r = await send('Runtime.evaluate', { expression: `JSON.stringify({ url: location.href.slice(0, 90), version: (document.querySelector('.footer-info-version') || {}).textContent || [...document.querySelectorAll('iframe')].map(f => { try { return f.contentDocument.querySelector('.footer-info-version').textContent; } catch (e) { return null; } }).filter(Boolean)[0] || null, frames: [...document.querySelectorAll('iframe')].map(f => (f.getAttribute('title') || '') + ' -> ' + (f.getAttribute('src') || '(no src)').slice(0, 80)) })`, returnByValue: true }, a.sessionId);
  seen.push(r.result?.result?.value || JSON.stringify({ url: a.targetInfo.url.slice(0, 90), note: 'not evaluable' }));
}
const top = await send('Runtime.evaluate', { expression: `JSON.stringify([...document.querySelectorAll('iframe')].map(f => (f.getAttribute('title') || '') + ' -> ' + (f.getAttribute('src') || '').slice(0, 80)))`, returnByValue: true });
console.log('TOP iframes:', top.result.result.value);
const nav = await send('Runtime.evaluate', { expression: `JSON.stringify([...new Set([...document.querySelectorAll('a[href*="/view/pharmatoolseditor"]')].map(a => decodeURI(a.getAttribute('href'))))])`, returnByValue: true });
console.log('PAGES:', nav.result.result.value);
seen.forEach(v => console.log('FRAME', v));
ws.close(); proc.kill();

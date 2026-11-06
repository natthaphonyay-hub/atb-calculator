// Screenshots for the ATB user manual: each shot sets up the page, adds numbered markers, and clips to elements.
// usage: node manual/tools/manual-shots.mjs <app.html or URL> <outDir>
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const [app, outDir] = process.argv.slice(2);
const url = /^https?:/.test(app) ? app : pathToFileURL(app).href;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 9400 + Math.floor(Math.random() * 90);
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'man-'))}`, '--hide-scrollbars', '--no-first-run', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let wsUrl; for (let i = 0; i < 50 && !wsUrl; i++) { try { wsUrl = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(t => t.type === 'page')?.webSocketDebuggerUrl; } catch {} await sleep(200); }
const ws = new WebSocket(wsUrl); await new Promise(r => ws.addEventListener('open', r, { once: true }));
let seq = 0; const wait = new Map(); const errs = [];
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.text); if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); } });
const send = (method, params = {}) => new Promise(res => { const id = ++seq; wait.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const ev = async x => { const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400)); return r.result.result?.value; };
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setTimezoneOverride', { timezoneId: 'Asia/Bangkok' });
await send('Emulation.setDeviceMetricsOverride', { width: 430, height: 900, deviceScaleFactor: 2, mobile: true });
await send('Page.navigate', { url });
for (let i = 0; i < 60; i++) { await sleep(250); if (await ev("document.readyState==='complete'")) break; }
await ev('document.fonts.ready.then(()=>true)');
const HELP = String.raw`
window.$h = s => document.querySelector(s);
window.setv = (id, v, type) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event(type || 'input', { bubbles: true })); };
window.clearMk = () => document.querySelectorAll('.mk').forEach(x => x.remove());
window.order = o => { clearMk(); doReset(); document.getElementById('toast').classList.remove('show');
  if (o.drug !== undefined) setv('drugName', o.drug);
  if (o.dose !== undefined) setv('dose', o.dose);
  if (o.unit !== undefined) setv('unit', o.unit);
  setv('startDate', o.date || '2026-11-06', 'change'); setv('startTime', o.time || '08:00', 'change');
  setv('frequency', String(o.freq || 8), 'change');
  if (o.mode === 'doses') { applyDurationType('doses'); }
  setv('duration1', o.d1 === undefined ? '5' : o.d1); setv('duration2', o.d2 === undefined ? '7' : o.d2);
  setv('checkDate', o.cdate || '2026-11-08', 'change'); setv('checkTime', o.ctime || '10:00', 'change');
  scheduleExpanded = !!o.expand; updateScheduleTable(); };
window.mark = (sel, n, dx = -14, dy = -12) => { const el = typeof sel === 'string' ? $h(sel) : sel; const r = el.getBoundingClientRect(); const b = document.createElement('div');
  const L = dx === 'R' ? r.right + 8 : dx === 'IR' ? r.right - 42 : r.left + dx, T = (dx === 'R' || dx === 'IR') ? r.top + (r.height - 30) / 2 : r.top + dy;
  b.className = 'mk'; b.textContent = n; b.style.cssText = 'position:absolute;z-index:9999;width:30px;height:30px;border-radius:50%;background:#e11d48;color:#fff;font:700 17px/30px IBM Plex Sans Thai,sans-serif;text-align:center;box-shadow:0 0 0 3px #fff,0 2px 6px rgba(0,0,0,.35);left:' + (L + scrollX) + 'px;top:' + (T + scrollY) + 'px';
  document.body.appendChild(b); };
window.markText = (sel, text, n, dx = -36) => { const root = $h(sel); const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let node;
  while ((node = walker.nextNode())) { const i = node.textContent.indexOf(text); if (i >= 0) { const rg = document.createRange(); rg.setStart(node, i); rg.setEnd(node, i + 1); const r = rg.getBoundingClientRect();
    const b = document.createElement('div'); b.className = 'mk'; b.textContent = n; b.style.cssText = 'position:absolute;z-index:9999;width:30px;height:30px;border-radius:50%;background:#e11d48;color:#fff;font:700 17px/30px IBM Plex Sans Thai,sans-serif;text-align:center;box-shadow:0 0 0 3px #fff,0 2px 6px rgba(0,0,0,.35);left:' + (r.left + dx + scrollX) + 'px;top:' + (r.top + (r.height - 30) / 2 + scrollY) + 'px';
    document.body.appendChild(b); return; } } throw new Error('text not found: ' + text); };
window.clipOf = (sels, pad = 10) => { let x0 = 1e9, y0 = 1e9, x1 = 0, y1 = 0; sels.forEach(s => { const r = $h(s).getBoundingClientRect(); x0 = Math.min(x0, r.left); y0 = Math.min(y0, r.top + scrollY); x1 = Math.max(x1, r.right); y1 = Math.max(y1, r.bottom + scrollY); });
  return { x: Math.max(0, x0 - pad), y: Math.max(0, y0 - pad - 6), width: Math.min(innerWidth, x1 + pad) - Math.max(0, x0 - pad), height: y1 - y0 + 2 * pad + 6 }; };
const st = document.createElement('style'); st.textContent = 'header.header{position:static!important} .toast{display:none!important} *{animation:none!important;transition:none!important}'; document.head.appendChild(st);
true`;
await ev(HELP);
const MERO = `order({ drug: 'Meropenem' })`;
const shots = [
  { name: 'a01-home', js: `order({}); setv('startDate', '2026-11-06', 'change'); setv('startTime', '10:00', 'change'); mark('#resetBtn', 1, 'IR'); mark('.manual-link', 2, -14, -14)`, clip: ['header.header', '#inputCard .card-header', '.form-row.triple'], pad: 0 },
  { name: 'a02-drug', js: `${MERO}; mark('#drugName', 1, 'IR'); mark('#dose', 2, 'IR'); mark('#unit', 3, 'IR'); markText('#autofillHint', 'ขนาดยา', 4)`, clip: ['#inputCard .card-header', '#autofillHint'] },
  { name: 'a03-start', js: `${MERO}; mark('#startDate', 1, 130, -18); mark('#startTime', 2, 125, -18); mark('#frequency', 3, 145, -18)`, clip: ['label[for=startDate]', '#frequency'] },
  { name: 'a04-duration', js: `${MERO}; mark('.duration-toggle', 1, 'R'); mark('#duration1', 2, 6, 15); mark('#duration2', 3, 6, 15)`, clip: ['.duration-box'] },
  { name: 'a05-error', js: `${MERO}; setv('duration1', '9'); mark('#duration1', 1, 6, 15); mark('#formStatus', 2, 40, -16)`, clip: ['.duration-box', '#formStatus'] },
  { name: 'a06-note', js: `${MERO}; markText('#noteContent', 'นับยา', 1); markText('#noteContent', 'เริ่มได้รับยา', 2); markText('#noteContent', 'ครบ 5 วัน', 3); markText('#noteContent', 'ครบ 7 วัน', 4); mark('#copyNoteBtn', 5)`, clip: ['#noteSection'] },
  { name: 'a07-progress', js: `${MERO}; mark('.progress-check-inputs', 1); mark('.btn-now', 2, 'R'); mark('.progress-ring-container', 3); mark('.progress-stats', 4); mark('.progress-status', 5); mark('#copyProgressBtn', 6)`, clip: ['#progressSection'] },
  { name: 'a08-schedule', js: `${MERO}; mark('.schedule-summary', 1); mark('#scheduleBody tr.day-row', 2); mark('.dose-badge.checkpoint', 3, 'R'); mark('#scheduleBody tr.gap-row', 4); mark('#scheduleToggle', 5); mark('#copyScheduleBtn', 6)`, clip: ['#scheduleSection'] },
  { name: 'a09-schedule-full', js: `order({ drug: 'Meropenem', expand: true }); markText('#scheduleBody tr:nth-child(4) .dose-time-cell', 'น.', 1, 30)`, clip: ['#scheduleSection .schedule-table thead', '#scheduleBody tr:nth-child(8)'] },
  { name: 'a10-doses', js: `order({ drug: 'Cefazolin', mode: 'doses', d1: '', d2: '3' }); mark('#btnDoses', 1, 'R'); mark('#duration2', 2, 6, 15); markText('#noteContent', 'Dose ที่ 3', 3)`, clip: ['.duration-box', '#noteSection'] },
  { name: 'a11-unusual', js: `order({}); markText('#noteContent', '...', 1, -40)`, clip: ['#noteSection'] },
  { name: 'a12-reset', js: `${MERO}; askReset(); mark('#resetBtn', 1, 'IR'); mark('#resetBar .btn-danger', 2, -16, -18)`, clip: ['header.header'], pad: 0 },
];
for (const s of shots) {
  const clip = await ev(`(() => { ${s.js}; return clipOf(${JSON.stringify(s.clip)}, ${s.pad ?? 10}); })()`);
  await sleep(250);
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { ...clip, scale: 1 } });
  writeFileSync(join(outDir, s.name + '.png'), Buffer.from(shot.result.data, 'base64'));
  console.log('saved', s.name, Math.round(clip.width), 'x', Math.round(clip.height));
  await ev(`cancelReset && document.getElementById('resetBar').classList.add('hidden'); clearMk(); true`);
}
console.log('JS errors:', errs.length, errs.slice(0, 3));
ws.close(); chrome.kill();

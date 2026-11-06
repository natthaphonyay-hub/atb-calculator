// usage: node tests/behaviour.mjs <new.html> <old.html> <shotDir> <wrapDir>
// Behaviour checks on the new ATB page (top level and inside a Google-Sites-like sandboxed cross-origin iframe),
// plus before/after screenshots. usage: node atb-behave.mjs <new.html> <old.html> <shotDir> <wrapDir>
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
const [NEW, OLD, SHOTS, WRAP] = process.argv.slice(2);
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const ok = (name, pass, detail = '') => { results.push([pass ? 'PASS' : 'FAIL', name, detail]); };

async function browser() {
  const port = 9100 + Math.floor(Math.random() * 300);
  const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'atbb-'))}`, '--no-first-run', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
  let wsUrl; for (let i = 0; i < 50 && !wsUrl; i++) { try { wsUrl = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(t => t.type === 'page')?.webSocketDebuggerUrl; } catch {} await sleep(200); }
  const ws = new WebSocket(wsUrl); await new Promise(r => ws.addEventListener('open', r, { once: true }));
  let seq = 0; const wait = new Map(); const log = []; const attached = [];
  ws.addEventListener('message', e => { const m = JSON.parse(e.data);
    if (m.method === 'Runtime.exceptionThrown') log.push('EXC ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
    if (m.method === 'Page.javascriptDialogOpening') log.push('DIALOG ' + m.params.message);
    if (m.method === 'Log.entryAdded') log.push('LOG ' + m.params.entry.level + ' ' + m.params.entry.text);
    if (m.method === 'Target.attachedToTarget') attached.push(m.params);
    if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); } });
  const send = (method, params = {}, sessionId) => new Promise(res => { const id = ++seq; wait.set(id, res); ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params })); });
  return { proc, ws, send, log, attached };
}

const b = await browser();
const { send } = b;
const ev = async (x, ctx) => { const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true, ...(ctx ? { contextId: ctx } : {}) }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 500)); return r.result.result?.value; };
await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');
await send('Emulation.setTimezoneOverride', { timezoneId: 'Asia/Bangkok' });
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
const load = async url => { await send('Page.navigate', { url }); for (let i = 0; i < 50; i++) { await sleep(200); if (await ev("document.readyState==='complete'")) break; } await ev('document.fonts.ready.then(()=>true)'); await sleep(200); };
const H = String.raw`
window.$ = id => document.getElementById(id);
window.typeIn = (id, v) => { const el = $(id); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
window.changeIn = (id, v) => { const el = $(id); el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); };
true`;
const click = async (sel) => {
  const box = await ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
  for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: box[0], y: box[1], button: 'left', clickCount: 1 });
  await sleep(150);
};
const shot = async (file, sels, pad = 8) => {
  const clip = await ev(`(() => { let x0 = 1e9, y0 = 1e9, x1 = 0, y1 = 0; ${JSON.stringify(sels)}.forEach(s => { const r = document.querySelector(s).getBoundingClientRect(); x0 = Math.min(x0, r.left); y0 = Math.min(y0, r.top + scrollY); x1 = Math.max(x1, r.right); y1 = Math.max(y1, r.bottom + scrollY); }); return { x: Math.max(0, x0 - ${pad}), y: Math.max(0, y0 - ${pad}), width: Math.min(innerWidth, x1 + ${pad}) - Math.max(0, x0 - ${pad}), height: y1 - y0 + 2 * ${pad} }; })()`);
  const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { ...clip, scale: 1 } });
  writeFileSync(join(SHOTS, file), Buffer.from(r.result.data, 'base64'));
};

// ---------- 1. top-level behaviour ----------
await load(pathToFileURL(NEW).href); await ev(H);
ok('opens with no guessed start date/time', await ev(`$('startDate').value === '' && $('startTime').value === ''`));
ok('no save/load buttons', await ev(`!document.querySelector('[onclick*="Preset"]')`));
ok('empty form shows what is missing, note hidden', await ev(`$('noteSection').classList.contains('hidden') && $('formStatus').textContent.includes('ยังขาด: ชื่อยา, ขนาดยา, หน่วย, วันที่เริ่ม, เวลาเริ่ม')`), await ev(`$('formStatus').textContent`));
await ev(`typeIn('drugName', 'Ceftriaxone')`);
ok('picking a listed drug fills dose and unit, hint shows', await ev(`$('dose').value === '2' && $('unit').value === 'g' && !$('autofillHint').classList.contains('hidden')`));
await ev(`typeIn('drugName', 'Ceftriaxonex')`);
ok('changing to an unlisted name clears what the app filled', await ev(`$('dose').value === '' && $('unit').value === '' && $('autofillHint').classList.contains('hidden')`));
await ev(`typeIn('dose', '1'); typeIn('unit', 'g'); typeIn('drugName', 'Meropenem')`);
ok('a dose the pharmacist typed is never overwritten', await ev(`$('dose').value === '1' && $('unit').value === 'g' && $('autofillHint').classList.contains('hidden')`));
await ev(`typeIn('dose', ''); typeIn('unit', ''); typeIn('drugName', 'Meropenem'); typeIn('drugName', 'Ceftazidime')`);
ok('switching between listed drugs refills only app-filled values', await ev(`$('dose').value === '2' && $('unit').value === 'g'`));
await ev(`changeIn('startDate', '2026-11-06'); changeIn('startTime', '08:00'); changeIn('frequency', '8'); changeIn('checkDate', '2026-11-08'); changeIn('checkTime', '10:00')`);
ok('valid order shows the note and table', await ev(`!$('noteSection').classList.contains('hidden') && $('formStatus').textContent === ''`));
ok('midnight dose shows 23.59 in admin times', await ev(`$('noteContent').textContent.includes('[ 8, 16, 23.59 ]')`), await ev(`$('noteContent').textContent.split(String.fromCharCode(10))[1]`));
await ev(`typeIn('duration2', '6')`);
ok('note updates while typing a duration (no blur needed)', await ev(`$('noteContent').textContent.includes('ครบ 6 วัน Dose สุดท้าย')`));
await ev(`typeIn('duration2', '7')`);
await ev(`typeIn('duration1', '9')`);
ok('checkpoint later than end is refused with a reason', await ev(`$('noteSection').classList.contains('hidden') && $('formStatus').classList.contains('error') && $('formStatus').textContent.includes('ต้องไม่มากกว่าระยะที่ 2')`));
await ev(`typeIn('duration1', '2.5')`);
ok('a decimal duration is refused', await ev(`$('formStatus').textContent.includes('ระยะที่ 1 ต้องเป็นจำนวนเต็มตั้งแต่ 1 วัน ขึ้นไป')`));
await ev(`typeIn('duration1', '5')`);
await click('#btnDoses');
ok('days -> doses converts 5/7 days at q8h to 15/21 doses', await ev(`$('duration1').value === '15' && $('duration2').value === '21' && $('btnDoses').getAttribute('aria-pressed') === 'true' && document.querySelector('.unit-suffix').textContent === 'dose'`), await ev(`$('duration1').value + '/' + $('duration2').value`));
ok('conversion message shown in the page', await ev(`$('toast').classList.contains('show') && $('toast').textContent.includes('dose')`), await ev(`$('toast').textContent`));
await click('#btnDays');
ok('doses -> days converts back to 5/7', await ev(`$('duration1').value === '5' && $('duration2').value === '7' && document.querySelector('.unit-suffix').textContent === 'วัน'`));
await click('#btnDoses'); await ev(`typeIn('duration1', '10')`); await click('#btnDays');
ok('a dose count with no whole-day value is cleared, with a message', await ev(`$('duration1').value === '' && $('duration2').value === '7' && $('toast').textContent.includes('แปลงเป็นวันเต็มไม่ได้')`), await ev(`$('duration1').value + '|' + $('toast').textContent`));
await ev(`typeIn('duration1', '5')`);
await sleep(300);
await shot('new-input.png', ['#inputCard']);
await shot('new-note.png', ['#noteSection']);
await shot('new-schedule-collapsed.png', ['#scheduleSection']);
const nKey = await ev(`[...$('scheduleBody').querySelectorAll('tr')].filter(t => !t.classList.contains('day-row') && !t.classList.contains('gap-row')).length`);
ok('table starts collapsed to the key doses', nKey <= 4 && await ev(`$('scheduleToggle').textContent === 'แสดงทุก dose (21)'`), `key rows ${nKey}`);
ok('phone table shows the milestone tags', await ev(`(() => { const t = [...document.querySelectorAll('#scheduleBody .dose-badge')].filter(b => b.offsetParent).map(b => b.textContent); return t.includes('ครบ 5 วัน') && t.includes('ครบ 7 วัน') && t.includes('ถัดไป'); })()`));
await click('#scheduleToggle');
ok('expand shows every dose grouped by day', await ev(`[...$('scheduleBody').querySelectorAll('tr')].filter(t => !t.classList.contains('day-row') && !t.classList.contains('gap-row')).length === 21 && $('scheduleToggle').getAttribute('aria-expanded') === 'true'`));
ok('midnight dose 3 sits under day 1 as 23:59', await ev(`(() => { const rows = [...$('scheduleBody').querySelectorAll('tr')]; const firstDay = rows[0].textContent; const r3 = rows.find(r => r.querySelector('.dose-number')?.textContent === '3'); const idx = rows.indexOf(r3); const days = rows.slice(0, idx).filter(r => r.classList.contains('day-row')); return days.length === 1 && r3.textContent.includes('23:59'); })()`));
await shot('new-schedule-expanded.png', ['#scheduleSection']);
await click('#scheduleToggle');
// reset flow
await click('#resetBtn');
ok('reset asks in the page, focus on cancel', await ev(`!$('resetBar').classList.contains('hidden') && document.activeElement === $('resetCancelBtn')`));
await shot('new-reset-bar.png', ['header.header']);
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
await sleep(150);
ok('Esc cancels and keeps the data', await ev(`$('resetBar').classList.contains('hidden') && $('drugName').value === 'Ceftazidime' && document.activeElement === $('resetBtn')`));
await click('#resetBtn'); await click('.btn-danger');
ok('confirm reset clears inputs, back to days 5/7, message shown', await ev(`['drugName','dose','unit','startDate','startTime'].every(id => $(id).value === '') && $('duration1').value === '5' && $('duration2').value === '7' && $('btnDays').classList.contains('active') && $('toast').textContent === 'ล้างข้อมูลแล้ว' && $('noteSection').classList.contains('hidden')`));
ok('no native dialogs or errors at top level', !b.log.some(l => l.startsWith('DIALOG') || l.startsWith('EXC')), b.log.filter(l => !l.includes('favicon')).slice(0, 3).join(' | '));

// ---------- 2. before screenshots (v5.0) ----------
await load(pathToFileURL(OLD).href); await ev(H);
await ev(`typeIn('drugName', 'Ceftriaxone'); changeIn('startDate', '2026-11-06'); changeIn('startTime', '08:00'); changeIn('frequency', '8'); changeIn('checkDate', '2026-11-08'); changeIn('checkTime', '10:00'); changeIn('duration1', '5'); changeIn('duration2', '7')`);
await sleep(300);
await shot('old-input.png', ['#inputCard']);
await shot('old-note.png', ['#noteSection']);
await shot('old-schedule.png', ['#scheduleSection']);

// ---------- 3. inside a sandboxed cross-origin iframe like Google Sites ----------
const py = (dir, port) => spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', dir], { stdio: 'ignore' });
copyFileSync(NEW, join(WRAP, 'app.html'));
const p1 = 8611, p2 = 8612;
writeFileSync(join(WRAP, 'wrap.html'), `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}iframe{border:0;width:100vw;height:787px;display:block}</style>
<iframe id="f" src="http://127.0.0.1:${p1}/app.html" sandbox="allow-scripts allow-popups allow-forms allow-same-origin allow-popups-to-escape-sandbox allow-downloads allow-storage-access-by-user-activation"></iframe>`);
const s1 = py(WRAP, p1), s2 = py(WRAP, p2);
await sleep(800);
b.log.length = 0;
await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
await send('Page.navigate', { url: `http://localhost:${p2}/wrap.html` });
await sleep(3000);
const sess = b.attached.find(a => a.targetInfo.type === 'iframe')?.sessionId;
if (!sess) throw new Error('iframe target not attached: ' + JSON.stringify(b.attached.map(a => a.targetInfo.type)));
await send('Runtime.enable', {}, sess); await send('Log.enable', {}, sess);
const inFrame = async x => { const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }, sess); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400)); return r.result.result?.value; };
ok('frame is cross-origin to the page around it', await inFrame(`location.origin`) !== `http://localhost:${p2}`, await inFrame(`location.origin`));
ok('app loads inside the sandboxed frame', await inFrame(`document.title.includes('ATB')`));
// the isolated world shares the DOM: drive it with DOM events
await inFrame(`(() => { const set = (id, v, t) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event(t || 'input', { bubbles: true })); }; set('drugName', 'Ceftriaxone'); set('startDate', '2026-11-06', 'change'); set('startTime', '08:00', 'change'); set('checkDate', '2026-11-08', 'change'); set('checkTime', '10:00', 'change'); return true; })()`);
await sleep(300);
const frameBox = async sel => { const r = await inFrame(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); el.scrollIntoView({ block: 'center' }); const b = el.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; })()`); return r; };
const clickFrame = async sel => { const [x, y] = await frameBox(sel); await sleep(100); const [x2, y2] = await frameBox(sel); for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: x2, y: y2, button: 'left', clickCount: 1 }); await sleep(250); };
await clickFrame('#resetBtn');
ok('reset works in the Sites-like sandbox (in-page confirm shows)', await inFrame(`!document.getElementById('resetBar').classList.contains('hidden')`));
await clickFrame('#resetCancelBtn');
await clickFrame('#copyNoteBtn');
const copyState = await inFrame(`[document.getElementById('copyNoteBtn').textContent.trim(), document.getElementById('toast').textContent, document.getElementById('toast').classList.contains('show')]`);
ok('copy gives visible feedback in the sandbox (Copied! or a message)', copyState[0].includes('Copied') || copyState[2], JSON.stringify(copyState));
ok('no native dialog attempts in the sandbox', !b.log.some(l => l.startsWith('DIALOG') || /Ignored call to '(alert|confirm)/.test(l)), b.log.filter(l => !l.includes('favicon')).slice(0, 4).join(' | '));
s1.kill(); s2.kill();
b.ws.close(); b.proc.kill();
for (const r of results) console.log(r.join('  '));
console.log('TOTAL', results.length, 'FAIL', results.filter(r => r[0] === 'FAIL').length);

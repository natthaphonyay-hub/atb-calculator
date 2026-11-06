// Run test cases in a real headless Chrome page (old or new ATB) and dump what the page shows.
// usage: node tests/run-cases.mjs <page.html> <old|new> <cases.json> <out.json>
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const [file, kind, casesPath, outPath] = process.argv.slice(2);
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 9500 + Math.floor(Math.random() * 400);
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'atbv-'))}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let wsUrl; for (let i = 0; i < 50 && !wsUrl; i++) { try { wsUrl = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(t => t.type === 'page')?.webSocketDebuggerUrl; } catch {} await sleep(200); }
const ws = new WebSocket(wsUrl); await new Promise(r => ws.addEventListener('open', r, { once: true }));
let seq = 0; const wait = new Map(); const errs = [];
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); if (m.method === 'Page.javascriptDialogOpening') errs.push('DIALOG: ' + m.params.message); if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); } });
const send = (method, params = {}) => new Promise(res => { const id = ++seq; wait.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const ev = async x => { const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 600)); return r.result.result?.value; };
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setTimezoneOverride', { timezoneId: 'Asia/Bangkok' });
await send('Page.navigate', { url: pathToFileURL(file).href });
for (let i = 0; i < 40; i++) { await sleep(200); if (await ev("document.readyState==='complete'")) break; }
await sleep(300);
const RUNNER = String.raw`
window.__runCase = (c, kind) => {
  const $ = id => document.getElementById(id);
  copyToClipboard = t => { window.__copied = t; };
  $('drugName').value = c.drug; $('dose').value = c.dose; $('unit').value = c.unit;
  $('startDate').value = c.startDate; $('startTime').value = c.startTime;
  $('frequency').value = String(c.freq);
  if (kind === 'new') { autoFilledFor = null; applyDurationType(c.mode); scheduleExpanded = true; } else { durationType = c.mode; }
  $('duration1').value = c.d1 === null ? '' : String(c.d1);
  $('duration2').value = c.d2 === null ? '' : String(c.d2);
  $('checkDate').value = c.checkDate; $('checkTime').value = c.checkTime;
  calculate(); calculateProgress();
  const out = { valid: schedule.length > 0 };
  out.schedule = schedule.map(s => [s.no, s.date.getTime(), s.formattedDate, s.formattedTime]);
  out.noteHidden = $('noteSection').classList.contains('hidden');
  out.scheduleHidden = $('scheduleSection').classList.contains('hidden');
  out.note = out.noteHidden ? null : $('noteContent').textContent;
  out.progress = ['dosesReceived','dosesRemaining','daysPassed','daysRemaining','progressPercent','progressStartDate','progressCheckDate','progressEndDate','progressStatusText'].map(id => $(id).textContent);
  out.progressClass = $('progressDisplay').className;
  out.summary = ['summaryDrug','summaryTotal','summaryStart','summaryEnd'].map(id => $(id).textContent);
  const readRows = () => [...$('scheduleBody').querySelectorAll('tr')].map(tr => {
    if (tr.classList.contains('day-row')) return ['day', tr.textContent.trim()];
    if (tr.classList.contains('gap-row')) return ['gap', tr.textContent.trim()];
    const tds = tr.querySelectorAll('td');
    return ['dose', tr.className, [...tds].map(td => td.textContent.replace(/\s+/g, ' ').trim()), [...tr.querySelectorAll('.dose-badge')].map(b => b.className.replace('dose-badge', '').trim() + ':' + b.textContent.trim())];
  });
  out.rows = readRows();
  if (kind === 'new' && out.valid) {
    scheduleExpanded = false; updateScheduleTable();
    out.rowsCollapsed = readRows();
    out.toggle = [$('scheduleToggle').className, $('scheduleToggle').textContent];
    out.formStatus = '';
  }
  if (kind === 'new') { out.formStatus = $('formStatus').textContent; out.formStatusClass = $('formStatus').className; out.copyProgressDisabled = $('copyProgressBtn').disabled; }
  window.__copied = null; if (out.valid) { copySchedule(); out.copySchedule = window.__copied; window.__copied = null; copyProgress(); out.copyProgress = window.__copied; }
  return out;
};
true`;
await ev(RUNNER);
const cases = JSON.parse(readFileSync(casesPath, 'utf8'));
const results = [];
const B = 200;
for (let i = 0; i < cases.length; i += B) {
  const batch = cases.slice(i, i + B);
  const r = await ev(`(${JSON.stringify(batch)}).map(c => { try { return window.__runCase(c, ${JSON.stringify(kind)}); } catch (e) { return { error: String(e && e.stack || e) }; } })`);
  results.push(...r);
}
writeFileSync(outPath, JSON.stringify({ errs, results }));
console.log(kind, 'cases', results.length, 'page JS errors', errs.length, errs.slice(0, 3));
ws.close(); chrome.kill();

#!/usr/bin/env python3
"""Independent model of ATB Calculator v5.1, written from the rules (not from the JS),
plus the random case generator and the checker against what the real page shows.
usage: tests/atb_oracle.py gen N seed cases.json | tests/atb_oracle.py check cases.json new.json old.json page.html"""
import json, math, random, re, sys
from datetime import datetime, timedelta

FREQ_LABEL = {4: 'q 4 hr', 6: 'q 6 hr', 8: 'q 8 hr', 12: 'q 12 hr', 24: 'OD', 48: 'q 48 hr'}
M_LONG = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม']
M_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']
WD_SHORT = ['จันทร์', 'อังคาร', 'พุธ', 'พฤหัส', 'ศุกร์', 'เสาร์', 'อาทิตย์']
DRUGS = ['Amoxicillin + Clavulanic acid', 'Ceftriaxone', 'Ceftazidime', 'Metronidazole', 'Cefazolin', 'Clindamycin', 'Meropenem', 'Cloxacillin', 'Tazocin (Piperacillin + tazobactam)', 'Vancomycin', 'Colistin']
EPOCH = datetime(1970, 1, 1)

def full_date(d): return f"{d.day} {M_LONG[d.month - 1]} {d.year + 543}"
def short_date(d): return f"{d.day} {M_SHORT[d.month - 1]} {(d.year + 543) % 100:02d}"
def day_header(d): return f"{WD_SHORT[d.weekday()]} {short_date(d)}"
def hhmm(d): return f"{d.hour:02d}:{d.minute:02d}"
def short_dt(d): return f"{d.day} {M_SHORT[d.month - 1]} {hhmm(d)}"
def ms(d): return int((d - EPOCH).total_seconds()) * 1000 - 7 * 3600 * 1000  # Asia/Bangkok, no DST

def js_number(s):
    s = s.strip()
    if s == '': return 0.0
    if re.fullmatch(r'[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?', s): return float(s)
    return float('nan')

# The rule under test: a dose the app computes that falls at 00:00 shows as 23:59 the day before;
# the first dose keeps the time the pharmacist entered.
def shown(real, first):
    return real - timedelta(minutes=1) if (not first and real.hour == 0 and real.minute == 0) else real

def validate(c):
    missing, errors = [], []
    if not c['drug'].strip(): missing.append('ชื่อยา')
    if not c['dose'].strip(): missing.append('ขนาดยา')
    elif not (js_number(c['dose'].replace(',', '')) > 0): errors.append('ขนาดยาต้องเป็นตัวเลขที่มากกว่า 0')
    if not c['unit'].strip(): missing.append('หน่วย')
    if not c['startDate']: missing.append('วันที่เริ่ม')
    if not c['startTime']: missing.append('เวลาเริ่ม')
    unit_word = 'วัน' if c['mode'] == 'days' else 'dose'
    mx = 365 if c['mode'] == 'days' else 2190
    def rd(v):
        if v is None or str(v).strip() == '': return (True, False, None)
        n = js_number(str(v))
        return (False, (n == n) and float(n).is_integer() and n >= 1, n)
    r1, r2 = rd(c['d1']), rd(c['d2'])
    if r2[0]: missing.append('ระยะที่ 2 (Total/End)')
    for r, name in ((r1, 'ระยะที่ 1'), (r2, 'ระยะที่ 2')):
        if r[0]: continue
        if not r[1]: errors.append(f'{name} ต้องเป็นจำนวนเต็มตั้งแต่ 1 {unit_word} ขึ้นไป')
        elif r[2] > mx: errors.append(f'{name} ต้องไม่เกิน {mx} {unit_word}')
    if r1[1] and r2[1] and r1[2] <= mx and r2[2] <= mx and r1[2] > r2[2]:
        errors.append('ระยะที่ 1 (Checkpoint) ต้องไม่มากกว่าระยะที่ 2 (Total/End)')
    return missing, errors

def expected(c, sep):
    missing, errors = validate(c)
    if missing or errors:
        title = 'ยังสร้าง Pharmacist note ไม่ได้ ต้องแก้ก่อน' if errors else 'กรอกให้ครบ แล้ว Pharmacist note จะขึ้นเอง'
        status = title + ''.join(errors) + (('ยังขาด: ' + ', '.join(missing)) if missing else '')
        return {'valid': False, 'formStatus': status, 'formStatusClass': 'form-status' + (' error' if errors else ''),
                'noteHidden': True, 'scheduleHidden': True, 'schedule': [], 'copyProgressDisabled': True,
                'progress': ['0', '0', '0', '0', '0%', '-', '-', '-', 'กรุณากรอกข้อมูลให้ครบถ้วน'], 'progressClass': 'progress-display'}
    start = datetime.strptime(c['startDate'] + ' ' + c['startTime'], '%Y-%m-%d %H:%M')
    freq, mode = c['freq'], c['mode']
    d1 = int(c['d1']) if c['d1'] not in (None, '') else None
    d2 = int(c['d2'])
    per_day = 24 / freq
    total = math.ceil(d2 * per_day) if mode == 'days' else d2
    sh = [shown(start + timedelta(hours=freq * i), i == 0) for i in range(total)]

    def cp(val):
        if not val: return None
        td = math.ceil(per_day * val) if mode == 'days' else val
        return td - 1, shown(start + timedelta(hours=(td - 1) * freq), td == 1)

    h, m = start.hour, start.minute
    lab = lambda t: f"{t}.{m:02d}" if m > 0 else str(t)
    if freq >= 24: admin = lab(h)
    else:
        admin = ', '.join(lab((h + i * freq) % 24) for i in range(24 // freq))   # bracket times keep 0 (owner's call)
    drugstr = ' '.join(v for v in (c['drug'], c['dose'], c['unit']) if v.strip())
    note = f"Pharmacist note\n\t- นับยา {drugstr or '...'} IV {FREQ_LABEL[freq]} [ {admin} ]\n"
    note += f"\t\t- {'เริ่มได้รับยา Dose แรก'.ljust(30)} วันที่ {full_date(start)} เวลา {hhmm(start)} น.\n"
    c1, c2 = cp(d1), cp(d2)
    lbl = lambda n: f'ครบ {n} วัน Dose สุดท้าย' if mode == 'days' else f'Dose ที่ {n}'
    if c1 and d1 > 0 and d1 != d2:
        note += f"\t\t- {lbl(d1).ljust(30)} วันที่ {full_date(c1[1])} เวลา {hhmm(c1[1])} น.\n"
    note += f"\t\t- {lbl(d2).ljust(30)} วันที่ {full_date(c2[1])} เวลา {hhmm(c2[1])} น."

    check = datetime.strptime(c['checkDate'] + ' ' + c['checkTime'], '%Y-%m-%d %H:%M')
    received = 0 if check < start else sum(1 for s in sh if s <= check)
    remaining = max(0, total - received)
    day = 86400000
    days_passed = max(0, math.floor((ms(check) - ms(start)) / day))
    days_left = max(0, math.ceil((ms(sh[-1]) - ms(check)) / day))
    pct = math.floor((received / total) * 100 + 0.5) if total else 0
    if check < start: status = f"ยังไม่เริ่มให้ยา - เริ่ม Dose แรกวันที่ {short_dt(start)}"
    elif pct >= 100: status = f"ครบกำหนด {total} Doses แล้ว!"
    elif remaining == 1: status = 'เหลืออีก 1 Dose สุดท้าย!'
    else: status = f"{drugstr or 'ยา'}: ได้รับแล้ว {received}/{total} Doses (เหลืออีก {remaining} Doses)"
    if pct >= 100: pcls = 'progress-display'
    elif pct >= 70: pcls = 'progress-display warning'
    elif 0 < remaining <= 3: pcls = 'progress-display urgent'
    else: pcls = 'progress-display'

    ci1 = c1[0] if c1 and c1[0] < total else -1
    ci2 = c2[0] if c2 and c2[0] < total else -1
    if ci1 == ci2 or d1 == d2: ci1 = -1
    nxt = next((i for i, s in enumerate(sh) if s > check), -1)
    ms_lbl = lambda n: f'ครบ {n} วัน' if mode == 'days' else f'Dose {n}'
    rowinfo = []
    for i, s in enumerate(sh):
        tags = []
        if i == 0: tags.append(('start', 'เริ่มต้น'))
        if i == ci1: tags.append(('checkpoint', ms_lbl(d1)))
        if i == ci2: tags.append(('end', ms_lbl(d2)))
        if i == nxt: tags.append(('next', 'ถัดไป'))
        rowinfo.append((i, s, tags, s <= check))

    def render(rows_vis, collapsed):
        out, last_day, last_i = [], '', -1
        for i, s, tags, rec in rows_vis:
            if collapsed and last_i >= 0 and i - last_i > 1: out.append(['gap', f'อีก {i - last_i - 1} dose'])
            if short_date(s) != last_day:
                out.append(['day', day_header(s)]); last_day = short_date(s)
            shown_tags = tags or [('received', 'ได้รับแล้ว') if rec else ('waiting', 'รอรับยา')]
            cls = ' '.join(x for x in ('next-dose' if i == nxt else '', 'received' if rec else '') if x)
            out.append(['dose', cls, [str(i + 1), f'{hhmm(s)} น.', ''.join(t for _, t in shown_tags)], [f'{k}:{t}' for k, t in shown_tags]])
            last_i = i
        if collapsed and last_i < total - 1: out.append(['gap', f'อีก {total - 1 - last_i} dose'])
        return out
    vis = [r for r in rowinfo if r[2]]
    toggle_cls = 'btn btn-outline btn-full' + (' hidden' if len(vis) == len(rowinfo) else '')
    copy_sched = (f"แผนการให้ยา: {drugstr or 'ไม่ระบุชื่อยา'}\n{sep}\nเริ่ม: {full_date(start)} {hhmm(start)}\nความถี่: {FREQ_LABEL[freq]}\nรวม: {total} Doses\n{sep}\n\n"
                  + ''.join(f"Dose {i + 1}: {short_date(s)} - {hhmm(s)} น.\n" for i, s in enumerate(sh)))
    copy_prog = (f"สถานะการให้ยา: {drugstr or 'ไม่ระบุ'}\n{sep}\nเริ่มยา: {full_date(start)} {hhmm(start)}\nตรวจสอบ ณ: {full_date(check)} {hhmm(check)}\n"
                 f"สิ้นสุด: {full_date(sh[-1])} {hhmm(sh[-1])}\n{sep}\nได้รับแล้ว: {received} Doses\nเหลืออีก: {remaining} Doses\nผ่านมาแล้ว: {days_passed} วัน\n"
                 f"เหลืออีก: {days_left} วัน\nความคืบหน้า: {pct}%\n{sep}\nรวมทั้งหมด: {total} Doses")
    return {'valid': True, 'formStatus': '', 'formStatusClass': 'form-status', 'noteHidden': False, 'scheduleHidden': False,
            'schedule': [[i + 1, ms(s), short_date(s), hhmm(s)] for i, s in enumerate(sh)], 'note': note,
            'progress': [str(received), str(remaining), str(days_passed), str(days_left), f'{pct}%', short_dt(start), short_dt(check), short_dt(sh[-1]), status],
            'progressClass': pcls, 'summary': [drugstr or '-', f'{total} Doses', short_date(sh[0]), short_date(sh[-1])],
            'rows': render(rowinfo, False), 'rowsCollapsed': render(vis, True),
            'toggle': [toggle_cls, f'แสดงทุก dose ({total})'], 'copySchedule': copy_sched, 'copyProgress': copy_prog,
            'copyProgressDisabled': False, '_shift': any(i > 0 and s != start + timedelta(hours=freq * i) for i, s in enumerate(sh)) or bool(c1 and c1[0] == 0 and h == 0 and m == 0) or bool(c2 and c2[0] == 0 and h == 0 and m == 0),
            '_adminShift': '23.59' in admin}

def gen(n, seed):
    rnd = random.Random(seed)
    cases = []
    for k in range(n):
        start = datetime(2026, 1, 1) + timedelta(days=rnd.randint(0, 900))
        if rnd.random() < 0.15: start = rnd.choice([datetime(2026, 12, 31), datetime(2028, 2, 28), datetime(2028, 2, 29), datetime(2026, 2, 28), datetime(2027, 12, 30)])
        hour = rnd.choice([0, 0, 0, 8, 16, 12, 18, 20, 22, 23, rnd.randint(0, 23)])
        minute = rnd.choice([0, 0, 0, 0, 30, 15, 45, rnd.randint(0, 59)])
        start = start.replace(hour=hour, minute=minute)
        freq = rnd.choice([4, 6, 8, 12, 24, 48])
        mode = rnd.choice(['days', 'days', 'doses'])
        if rnd.random() < 0.03: d2 = rnd.choice([365, 200, 120]) if mode == 'days' else rnd.choice([2190, 500])
        else: d2 = rnd.randint(1, 30) if mode == 'days' else rnd.randint(1, 60)
        d1 = None if rnd.random() < 0.25 else rnd.randint(1, d2)
        per_day = 24 / freq
        total = math.ceil(d2 * per_day) if mode == 'days' else d2
        span_h = (total - 1) * freq
        r = rnd.random()
        if r < 0.15:   # exactly on a dose time, or on the 23:59 that stands for a midnight dose
            i = rnd.randrange(total)
            check = start + timedelta(hours=freq * i)
            if check.hour == 0 and check.minute == 0 and i > 0 and rnd.random() < 0.6: check -= timedelta(minutes=1)
        else:
            check = start + timedelta(minutes=rnd.randint(-2 * 1440, span_h * 60 + 2 * 1440))
        drug = rnd.choice(DRUGS)
        dose, unit = rnd.choice([('2', 'g'), ('1', 'g'), ('500', 'mg'), ('1.2', 'g'), ('4.5', 'g'), ('1,000', 'mg'), ('600', 'mg')])
        c = {'drug': drug, 'dose': dose, 'unit': unit, 'startDate': start.strftime('%Y-%m-%d'), 'startTime': start.strftime('%H:%M'),
             'freq': freq, 'mode': mode, 'd1': d1, 'd2': d2, 'checkDate': check.strftime('%Y-%m-%d'), 'checkTime': check.strftime('%H:%M')}
        if rnd.random() < 0.3:   # break one or two things
            for _ in range(rnd.choice([1, 1, 2])):
                what = rnd.choice(['drug', 'dose', 'dosebad', 'unit', 'date', 'time', 'd2empty', 'd1bad', 'd2bad', 'order', 'big'])
                if what == 'drug': c['drug'] = rnd.choice(['', '   '])
                elif what == 'dose': c['dose'] = ''
                elif what == 'dosebad': c['dose'] = rnd.choice(['0', '-1', 'abc', '2 g', '1..2', '0.0'])
                elif what == 'unit': c['unit'] = ''
                elif what == 'date': c['startDate'] = ''
                elif what == 'time': c['startTime'] = ''
                elif what == 'd2empty': c['d2'] = None
                elif what == 'd1bad': c['d1'] = rnd.choice(['0', '-2', '2.5', '3.5'])
                elif what == 'd2bad': c['d2'] = rnd.choice(['0', '-1', '7.5', '0.5'])
                elif what == 'order':
                    if c['d2'] not in (None, '') and str(c['d2']).isdigit() and int(c['d2']) >= 1: c['d1'] = int(c['d2']) + rnd.randint(1, 5)
                elif what == 'big': c['d2'] = (366 if mode == 'days' else 2191) + rnd.randint(0, 50)
        cases.append(c)
    return cases

def check(cases_path, new_path, old_path, page_path):
    cases = json.load(open(cases_path))
    new = json.load(open(new_path)); old = json.load(open(old_path))
    sep = re.search(r'━+', open(page_path, encoding='utf-8').read()).group(0)
    assert not new['errs'], new['errs'][:3]
    stats = {'cases': len(cases), 'valid': 0, 'invalid': 0, 'mismatch_new': 0, 'with_shift': 0, 'old_compared': 0, 'mismatch_old': 0}
    shown_mismatch = 0
    for i, c in enumerate(cases):
        got, exp = new['results'][i], expected(c, sep)
        if 'error' in got:
            stats['mismatch_new'] += 1
            if shown_mismatch < 3: print('PAGE ERROR', i, got['error'][:300]); shown_mismatch += 1
            continue
        stats['valid' if exp['valid'] else 'invalid'] += 1
        keys = [k for k in exp if not k.startswith('_')]
        bad = [k for k in keys if got.get(k) != exp[k]]
        if bad:
            stats['mismatch_new'] += 1
            if shown_mismatch < 5:
                shown_mismatch += 1
                print('MISMATCH case', i, json.dumps(c, ensure_ascii=False))
                for k in bad[:3]: print('  ', k, '\n    page  :', json.dumps(got.get(k), ensure_ascii=False)[:500], '\n    oracle:', json.dumps(exp[k], ensure_ascii=False)[:500])
        if exp['valid']:
            if exp['_shift'] or exp['_adminShift']:
                stats['with_shift'] += 1
            else:   # nothing at midnight: the new page must match v5.0 exactly
                stats['old_compared'] += 1
                o = old['results'][i]
                for k in ('schedule', 'note', 'progress', 'progressClass', 'summary', 'copySchedule', 'copyProgress'):
                    if o.get(k) != got.get(k):
                        stats['mismatch_old'] += 1
                        if shown_mismatch < 8:
                            shown_mismatch += 1
                            print('OLD DIFF', i, k, json.dumps(c, ensure_ascii=False)[:300], '\n   old:', json.dumps(o.get(k), ensure_ascii=False)[:300], '\n   new:', json.dumps(got.get(k), ensure_ascii=False)[:300])
                        break
    print(json.dumps(stats, ensure_ascii=False))
    return stats['mismatch_new'] == 0 and stats['mismatch_old'] == 0

if __name__ == '__main__':
    if sys.argv[1] == 'gen':
        json.dump(gen(int(sys.argv[2]), int(sys.argv[3])), open(sys.argv[4], 'w'), ensure_ascii=False)
        print('generated', sys.argv[2])
    else:
        ok = check(*sys.argv[2:6])
        sys.exit(0 if ok else 1)

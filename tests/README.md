# ชุดทดสอบ ATB Calculator

แก้ `index.html` แล้วต้องรันทั้งสองชุด ต้องมี Google Chrome, Node 22 ขึ้นไป และ Python 3

## 1. สุ่มเทียบกับตัวคำนวณแยก

`atb_oracle.py` เป็นตัวคำนวณอีกชุดที่เขียนจากกฎ ไม่ได้ลอกจากโค้ดหน้าเว็บ ใช้สุ่มโจทย์แล้วเทียบทุกค่าที่หน้าเว็บแสดง ได้แก่ ตาราง note ความคืบหน้า สรุป ข้อความคัดลอก และข้อความเตือนตอนกรอกผิด

```sh
git show f70da78:index.html > /tmp/atb-v5.0.html        # เวอร์ชันก่อนหน้า ใช้เทียบกรณีที่ไม่มีเวลาเที่ยงคืน
python3 tests/atb_oracle.py gen 20000 7 /tmp/cases.json
node tests/run-cases.mjs index.html new /tmp/cases.json /tmp/new.json
node tests/run-cases.mjs /tmp/atb-v5.0.html old /tmp/cases.json /tmp/old.json
python3 tests/atb_oracle.py check /tmp/cases.json /tmp/new.json /tmp/old.json index.html
```

ผ่านเมื่อ `mismatch_new` และ `mismatch_old` เป็น 0

## 2. กดใช้งานจริงและทดสอบในกรอบแบบ Google Sites

```sh
mkdir -p /tmp/atb-shots /tmp/atb-wrap
node tests/behaviour.mjs index.html /tmp/atb-v5.0.html /tmp/atb-shots /tmp/atb-wrap
```

ทดสอบการเติมขนาดยา การสลับวันกับ dose ปุ่มรีเซ็ต การกรอกผิด ตารางแบบย่อและแบบเต็ม และเปิดแอปในกรอบต่างโดเมนที่ตั้งค่า sandbox เหมือน Google Sites ผ่านเมื่อบรรทัดสุดท้ายเป็น `FAIL 0`

ผลรอบ v5.1 ถึง v5.3 (2026-11-06): สุ่มรวม 66,000 โจทย์ (รอบล่าสุด v5.3 สุ่ม 20,000) ไม่ตรง 0 กดใช้งาน 31 ข้อ ผ่านครบ

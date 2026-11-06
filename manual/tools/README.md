# สร้างรูปและ PDF ของคู่มือใหม่

แก้หน้าตาแอปเมื่อไร ให้ถ่ายรูปคู่มือใหม่และสร้าง PDF ใหม่ ต้องมี Google Chrome และ Node 22 ขึ้นไป รันจากโฟลเดอร์ repo

```sh
node manual/tools/manual-shots.mjs index.html manual/img          # รูป a01 ถึง a12 พร้อมเลขชี้
node manual/tools/make-pdf.mjs manual/index.html manual/atb-calculator-manual.pdf
```

`make-pdf.mjs` บอกจำนวนรูปที่โหลดไม่ขึ้น ลิงก์สารบัญ และความกว้างหน้าที่จอ 390 กับ 1280 ด้วย ฉบับ 2026-11-06 ได้ 8 หน้า

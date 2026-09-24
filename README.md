# CaeLum World Bible

ฐานข้อมูลโลกสำหรับโปรเจกต์ **CaeLum** ออกแบบให้เป็นเว็บ Static ที่เปิดได้ทั้งคอมพิวเตอร์และมือถือ

## โครงสร้าง

- `index.html` — หน้าเว็บหลัก
- `styles.css` — Responsive UI
- `app.js` — ระบบค้นหา แสดงข้อมูล Author Mode และบันทึกผ่าน GitHub API
- `data/world.json` — ฐานข้อมูล Lore

## วิธีทำงาน

หน้า Public อ่าน `data/world.json` และซ่อนรายการที่ตั้งเป็น `author-only`

เจ้าของสามารถกด **Author Mode** และใส่ GitHub Fine-grained Personal Access Token ที่:
- เป็นของบัญชี `sanaisawan63x2`
- จำกัด Repository access ไว้ที่ `CaeLum`
- Repository permission: **Contents: Read and write**

Token ไม่ถูกฝังใน source code และถูกเก็บเฉพาะ `sessionStorage` ของแท็บปัจจุบัน เมื่อบันทึก เว็บจะใช้ GitHub Contents API แก้ `data/world.json` และสร้าง Commit อัตโนมัติ

> หมายเหตุ: `author-only` คือการซ่อนจาก UI ไม่ใช่การเข้ารหัส หาก repository หรือไฟล์ `world.json` ถูกเปิดต่อสาธารณะ ผู้ที่เข้าไปดู source โดยตรงยังสามารถอ่านข้อมูลนั้นได้

## การเผยแพร่

เว็บถูกทำให้พร้อมสำหรับ GitHub Pages โดยใช้ไฟล์ Static ทั้งหมดจาก root ของ repository

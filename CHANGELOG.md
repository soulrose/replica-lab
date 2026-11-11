# Changelog

เลขเวอร์ชันแบบ MAJOR.MINOR.PATCH: แก้บั๊ก = PATCH, เพิ่มความสามารถ = MINOR, เปลี่ยนแบบที่ของเดิมใช้ไม่ได้ (เช่น รูปแบบโปรไฟล์แอป) = MAJOR

## 1.0.1 - 2026-11-11
- หน้า About แสดงผู้พัฒนา: DevTeam, Information Technology, Faculty of Medicine Ramathibodi Hospital, Mahidol University
- ไม่แสดงแหล่งอัปเดต (ชื่อ repo) ในหน้า About และข้อความแจ้งเตือน

## 1.0.0 - 2026-11-11
- รันแอปจาก image ในเครื่องเป็นหลาย replica บน Docker Swarm ทีละแอป ปรับจำนวนขึ้นลง เริ่ม/หยุด
- เพิ่มแอปจาก image ในเครื่อง (กรอกค่าให้เอง: ชื่อ, port 8080, RAM อัตโนมัติ) เช็คชื่อ/port ซ้ำก่อนบันทึก
- สร้าง image จากโฟลเดอร์โปรเจกต์ที่มี Dockerfile
- นำเข้า service ที่รันอยู่ใน swarm, ลบแอปที่ไม่ใช้ (มียืนยัน)
- วัด RAM อัตโนมัติก่อนขึ้น (container ทดลอง) และปุ่มจูน RAM ใหม่
- ทดสอบส่งซ้ำข้าม replica แบบ GraphQL (เลือก mutation จาก schema) และ HTTP, ชุดทดสอบบันทึกแยกต่อแอป, ทดสอบกระจายโหลด
- ดู log แยกแต่ละ replica, เปลี่ยน image / pull จาก Harbor / เปลี่ยน port
- หน้าต่างแอปแบบ Hyperion: ปิดหน้าต่าง = หยุดทุกอย่างและจำค่าไว้, Replica Lab.exe + ไอคอนบน Desktop
- ตัวอัปเดตจาก GitHub และหน้า About

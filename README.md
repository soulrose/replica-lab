# Replica Lab

เอา image ที่ build ไว้ในเครื่องมารันเป็นหลาย replica บน Docker Swarm ปรับจำนวนขึ้นลง ดู log ทีละตัว และยิงทดสอบส่งซ้ำข้าม replica ได้ในหน้าต่างเดียว

ผู้พัฒนา: DevTeam, Information Technology, Faculty of Medicine Ramathibodi Hospital, Mahidol University

## ติดตั้ง (ครั้งแรก)

1. ติดตั้ง **Docker Desktop** ถ้ายังไม่มี โปรแกรมจะเปิดหน้าดาวน์โหลดให้เอง
2. ติดตั้ง **Node.js รุ่น LTS** (https://nodejs.org/en/download) ถ้ายังไม่มี โปรแกรมจะเปิดหน้าดาวน์โหลดให้เอง
3. ดับเบิลคลิก **`ReplicaLab-Setup-x.y.z.exe`** กด **ติดตั้ง** (ค่าเริ่มต้นลงที่ `%LOCALAPPDATA%\ReplicaLab` เปลี่ยนได้ แต่ห้ามมีช่องว่างใน path) ได้ไอคอน **Replica Lab** บน Desktop และเมนู Start แล้วโปรแกรมเปิดเอง
   - ติดตั้งทับของเดิมได้: เก็บ `config\`, `apps\*.local.env` และโปรไฟล์แอปที่มีอยู่ไว้เหมือนการอัปเดต ถ้า Replica Lab เปิดอยู่จะถามก่อนปิดให้
   - ติดตั้งแบบไม่มีหน้าต่าง: `ReplicaLab-Setup-x.y.z.exe /silent [/dir=C:\ReplicaLab] [/noicons] [/open]`
   - หรือแตก zip / clone ไว้ที่ไหนก็ได้ แล้วดับเบิลคลิก **`create-shortcut.cmd`** (ย้ายโฟลเดอร์เมื่อไหร่ ให้รันอีกครั้ง)

## ใช้งาน

- **กดไอคอน Replica Lab** จะได้หน้าต่างแอป ระบบเช็ค Docker (ถ้ายังไม่เปิดจะเปิดให้) แล้วรันแอปที่ใช้ครั้งล่าสุดและเข้าหน้า Replica Lab เอง
- **ปิดหน้าต่าง = หยุดทุกอย่าง** ประมาณ 4 วินาทีหลังปิด replica จะถูกลบ ระบบจำ image, จำนวน replica และ port ของแต่ละแอปไว้ให้ครั้งหน้า ส่วนการกด refresh หรือย่อหน้าต่างจะไม่หยุด
- รันได้ **ทีละแอป** สลับแอปแล้วแอปเดิมหยุดและจำค่าไว้

### เพิ่มแอปของทีม
**ง่ายสุด: build จากโฟลเดอร์ในหน้า Replica Lab** กด **เปลี่ยนแอป** แล้วไปที่ **สร้าง image จากโฟลเดอร์โปรเจกต์** วาง path ของโปรเจกต์ (ที่มี Dockerfile) กด ตรวจโฟลเดอร์ แล้ว Build image เสร็จแล้วฟอร์มเพิ่มแอปกรอกให้เอง กด บันทึกแล้วใช้เลย ถ้า build ทับ image ที่แอปลงสนามใช้อยู่ จะมีปุ่ม รีสตาร์ท replica ด้วย image ใหม่

หรือทำเอง:
1. build image ในเครื่องตามปกติ เช่น `docker build -t patientprofile:local .`
2. ในหน้า Replica Lab กด **เปลี่ยนแอป** แล้วไปที่ **เพิ่มแอปจาก image ในเครื่อง** เลือก image แล้วกด **เดาค่าจาก image**
   - ระบบเดาชนิด (Tomcat/WAR, Spring Boot, อื่นๆ), port ในแอป, health path (เช่น `/PatientProfileWebService/`) และหา port บนเครื่องที่ว่างให้
3. ตรวจค่า ใส่ environment ถ้าต้องใช้ แล้วกด **บันทึกแล้วใช้เลย**

### service ที่รันอยู่ใน swarm แล้ว
service ที่สร้างเอง (`docker service create`, stack อื่น) จะแสดงในหน้า "เปลี่ยนแอป" ใต้หัวข้อ **service ที่รันอยู่ใน swarm**
- **ควบคุมเลย** (แนะนำ): Replica Lab คุม service นั้นตรงๆ ไม่สร้างตัวใหม่ ใช้ port เดิมของมัน ปรับจำนวน replica, เริ่ม/หยุด, เปลี่ยน image, ดู log, ยิงทดสอบส่งซ้ำ/กระจายโหลดได้เหมือนแอปของ Replica Lab
  - ครั้งแรกระบบสร้างรายการแอปให้เอง (`apps/<ชื่อ>.json` ที่มี `"attach": "<ชื่อ service>"`) ครั้งต่อไปกด **ใช้แอปนี้** ได้เลย
  - ถ้า service ไม่มี network ของตัวเอง (มีแค่ port) ระบบต่อ network `replicalab_link` ให้ เพื่อให้หน้า Replica Lab คุยกับแต่ละ replica ได้ replica จะรีสตาร์ททีละตัวครั้งเดียว
  - **ปิด Replica Lab แล้ว service ยังรันต่อ** ด้วยจำนวน replica ล่าสุด (เป็นของเดิม Replica Lab ไม่ลบ)
  - เปลี่ยน port จากหน้านี้ไม่ได้ (แก้ที่ตัว service) service แบบ global ปรับ replica ไม่ได้
  - **เลิกควบคุม** ลบแค่รายการในแอป ไม่แตะ service
- **คัดลอกเป็นแอปใหม่:** สร้างแอปของ Replica Lab จากค่าของ service นั้น (image, port, healthcheck, env) รันเป็นอีกชุดแยกกัน ต้องใช้ port อื่น

อยากให้เดาค่าแม่นขึ้น ให้ใส่ LABEL ใน Dockerfile ของแอป (ไม่บังคับ):
```dockerfile
LABEL rama.lab.kind="tomcat" rama.lab.port="8080" rama.lab.health="/PatientProfileWebService/" rama.lab.test="http"
```

### ในหน้า Replica Lab
- **การ์ดยูนิต:** 1 ใบต่อ replica มีไฟสถานะ, HP (health) และพลังงาน (heap ของ Spring หรือ RAM ของ container) กดการ์ดเพื่อดู log ของตัวนั้น
- **ปรับทีม:** −/+ หรือแถบเลื่อน แล้วกด "ปรับทีมเป็น N ยูนิต" (สูงสุด 5) มีปุ่ม เริ่ม/หยุด ด้วย
- **คลังยูนิต:**
  - เปลี่ยน image (Swarm ทยอยเปลี่ยนทีละตัว)
  - Pull image จาก Harbor
  - เปลี่ยน port ที่ใช้เรียกแอป
  - build local จากโค้ด (เฉพาะ ramaservice)
- **ภารกิจ ส่งซ้ำข้าม replica:**
  - ส่ง request เดียวกันหลายชุดพร้อมกัน ชุดที่ i ไปที่ replica ลำดับ i ผ่านเมื่อทุกชุดได้ id เดียวกัน
  - **GraphQL:** เลือก mutation จาก schema ของแอปได้
  - **HTTP:** กำหนด method, path, headers, body และ field id ในคำตอบ
  - `{{run}}` คือรหัสสุ่มใหม่ทุกรอบ
  - **ชุดทดสอบที่บันทึกไว้:** ตั้งชื่อแล้วกด "บันทึกชุดนี้" จะเก็บแยกต่อแอปใน `apps/<แอป>.tests.json` เลือกครั้งหน้าค่ากลับมาครบ
- **ภารกิจ กระจายโหลด:** ยิง request ผ่าน VIP ดูว่ากระจายไปทุก replica ไหม (นับต่อ replica ได้เฉพาะแอป Spring)

## เวอร์ชันและการอัปเดต

- กดชื่อ **Replica Lab** มุมซ้ายบน = หน้า About: เวอร์ชัน, Docker/Node, สิ่งที่มีในเวอร์ชันนี้, ปุ่ม **เช็คอัปเดต** ถ้ามีเวอร์ชันใหม่จะขึ้นป้ายสีเขียวข้างชื่อ
- อัปเดตมาจาก tag ของ repo บน GitHub ที่ตั้งไว้ใน `update.json` กด **อัปเดตเป็น x.y.z** แล้วโปรแกรมดาวน์โหลด เขียนทับไฟล์โปรแกรม และเริ่มหน้าใหม่เอง แอปที่ลงสนามยังรันต่อ
- อัปเดตไม่แตะ `config\` (ค่าเฉพาะเครื่อง), `apps\*.local.env` (ความลับ) และไม่ทับโปรไฟล์แอปที่มีอยู่ (เพิ่มเฉพาะแอปใหม่)
- เลขเวอร์ชัน `MAJOR.MINOR.PATCH`: แก้บั๊ก = เลขท้าย, เพิ่มความสามารถ = เลขกลาง, เปลี่ยนแบบที่ของเดิมใช้ไม่ได้ = เลขหน้า

**ออกเวอร์ชันใหม่ (คนดูแล):**
1. แก้เลขใน `VERSION` และเพิ่มหัวข้อ `## x.y.z - วันที่` ใน `CHANGELOG.md`
2. commit, `git tag vx.y.z`, `git push` แล้ว `git push origin vx.y.z` (tag ต้อง push แยก)
3. เครื่องทีมจะเห็นป้าย "มีเวอร์ชันใหม่" ภายใน 10 นาทีหลังเปิดโปรแกรม

**ทำไฟล์ส่งให้ทีม:** `make-package.ps1` ได้ทั้ง `..\replica-lab-team.zip` และ `..\ReplicaLab-Setup-x.y.z.exe` (exe มี zip ฝังอยู่ข้างใน, build ด้วย `launcher\build-setup.cmd`)

**ความลับ:** vault token ของ ramaservice อยู่ใน `apps\ramaservice.local.env` ซึ่งไม่ขึ้น git (repo เป็นสาธารณะ) zip และ setup exe ที่ส่งให้ทีม (`make-package.ps1`) มีไฟล์นี้ อย่าเอา exe ขึ้น GitHub ถ้าติดตั้งจาก GitHub ให้ขอ token จากทีมแล้วใส่ไฟล์นี้เอง

## ไฟล์

| ไฟล์ | คืออะไร |
|---|---|
| `apps/<แอป>.json` | โปรไฟล์แอป: image, ชนิด, port, health, RAM, ชนิดการทดสอบ |
| `apps/<แอป>.env` | environment ที่ส่งเข้า container (ramaservice: vault token ของทีม + ค่า Spring) |
| `apps/<แอป>.tests.json` | ชุดทดสอบที่บันทึกไว้ของแอปนั้น |
| `config/` | ค่าเฉพาะเครื่อง: แอปล่าสุด, image/replica/port ที่ใช้ล่าสุดของแต่ละแอป (ไม่ต้องส่งต่อ) |
| `builder/helper.log` | log ของตัวช่วยบนเครื่อง (เปิดแอป, สลับแอป, หยุดเพราะปิดหน้าต่าง, build) |
| `create-shortcut.cmd` | สร้างไอคอนบน Desktop และเมนู Start |
| `start.cmd` / `stop.cmd` | เปิด / หยุด (ไอคอนเรียก start.cmd) |
| `run-local.ps1 -App <ชื่อ>` | รันแอปจากคำสั่ง (ไม่เปิดหน้าต่าง) |

## ramaservice
- ใช้ profile `dev` อ่านค่าจาก vault-dev ด้วย token ของทีมใน `apps/ramaservice.env`
- ปิด Liquibase (`SPRING_LIQUIBASE_ENABLED` และ `RAMA_LIQUIBASE_ENABLED`), Quartz และ Eureka ไว้ replica ในเครื่องจึงไม่แก้ schema ไม่รัน job และไม่ไปลงทะเบียนกับ dev
- **build local:** ในหน้าเว็บเลือก worktree ของ ramaservice แล้วกด Build ได้ image `ramaservice:local-<branch>` ที่รวมไฟล์ที่ยังไม่ commit

## ข้อควรระวัง
- ทดสอบส่งซ้ำเขียนข้อมูลลง **DB จริงที่แอปต่ออยู่** (ramaservice คือ DB ของ dev) แอป WAR เก่ามักฝัง config DB ไว้ใน WAR ตรวจให้แน่ก่อนยิง
- ใช้ได้บนเครื่องเดียว (single-node swarm) image ที่ build ในเครื่องใช้ได้ทันทีโดยไม่ต้อง push
- container ใช้ DNS ของโรงพยาบาล (10.6.22.16, 10.6.22.15) เพื่อหาชื่อเครื่องภายในได้
- แอปเก่าที่เก็บ session ในหน่วยความจำ ถ้า request ไปตก replica อื่น login จะหลุด เพราะ Swarm กระจายตาม connection ไม่ติดตาม cookie

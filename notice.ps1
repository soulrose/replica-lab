# Messages shown by start.cmd (a .cmd file cannot show Thai text), e.g. powershell -File notice.ps1 node
param([string]$Kind)
Add-Type -AssemblyName PresentationFramework
switch ($Kind) {
    "node" {
        Start-Process "https://nodejs.org/en/download"
        [void][System.Windows.MessageBox]::Show(
            "Replica Lab ต้องใช้ Node.js`n`nเปิดหน้าดาวน์โหลดให้แล้ว ติดตั้ง Node.js รุ่น LTS แล้วเปิด Replica Lab ใหม่อีกครั้ง",
            "Replica Lab", "OK", "Information")
    }
    "shortcut" {
        [void][System.Windows.MessageBox]::Show(
            "สร้างไอคอน Replica Lab บน Desktop แล้ว`n`nถ้าย้ายโฟลเดอร์โปรแกรม ให้รัน create-shortcut.cmd ใหม่",
            "Replica Lab", "OK", "Information")
    }
}

// Replica Lab.exe: double-click to open Replica Lab. It runs start.cmd next to it without a console window.
// Built by launcher\build-exe.cmd with the C# compiler that ships with Windows (.NET Framework 4).
using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

[assembly: System.Reflection.AssemblyTitle("Replica Lab")]
[assembly: System.Reflection.AssemblyProduct("Replica Lab")]
[assembly: System.Reflection.AssemblyVersion("1.0.0.0")]

static class ReplicaLab
{
    [STAThread]
    static int Main()
    {
        string dir = AppDomain.CurrentDomain.BaseDirectory;
        string start = Path.Combine(dir, "start.cmd");
        if (!File.Exists(start))
        {
            MessageBox.Show("ไม่พบ start.cmd ข้างไฟล์นี้\n\nวาง Replica Lab.exe ไว้ในโฟลเดอร์ replica-lab เดียวกับ start.cmd",
                            "Replica Lab", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return 1;
        }
        var psi = new ProcessStartInfo("cmd.exe", "/c \"\"" + start + "\"\"")
        {
            WorkingDirectory = dir,
            UseShellExecute = false,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden
        };
        try { Process.Start(psi); }
        catch (Exception e)
        {
            MessageBox.Show("เปิด Replica Lab ไม่ได้: " + e.Message, "Replica Lab", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
        return 0;
    }
}

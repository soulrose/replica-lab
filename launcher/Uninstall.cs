// Replica Lab Uninstall: removes a copy that ReplicaLab-Setup.exe installed, so the team can move to the portable zip.
// It finds the folder from HKCU\Software\ReplicaLab (InstallDir, written by Setup) or %LOCALAPPDATA%\ReplicaLab,
// stops that copy if it is the one running, copies apps\ and config\ to a backup folder on the Desktop (profiles,
// saved tests, secrets, last state), deletes the Desktop / old Start menu icons that point into the folder, the folder
// and the registry key. A portable copy elsewhere (and its icon) is left alone.
// Silent for scripts:  ReplicaLab-Uninstall.exe /silent [/dir=C:\ReplicaLab] [/nobackup]
// Built by launcher\build-uninstall.cmd with the C# compiler that ships with Windows.
using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net.Sockets;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: AssemblyTitle("Replica Lab Uninstall")]
[assembly: AssemblyProduct("Replica Lab")]
[assembly: AssemblyCompany("DevTeam, Information Technology, Faculty of Medicine Ramathibodi Hospital, Mahidol University")]
[assembly: AssemblyVersion("1.0.0.0")]

static class Uninstall
{
    const string RegKey = @"Software\ReplicaLab";
    public const string Title = "ถอนการติดตั้ง Replica Lab";

    [DllImport("user32.dll")] static extern bool SetProcessDPIAware();

    [STAThread]
    static int Main()
    {
        try { SetProcessDPIAware(); } catch { }
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        string[] args = Environment.GetCommandLineArgs();
        bool silent = false, backup = true; string dir = null;
        for (int i = 1; i < args.Length; i++)
        {
            string a = args[i].ToLowerInvariant();
            if (a == "/silent") silent = true;
            else if (a == "/nobackup") backup = false;
            else if (a.StartsWith("/dir=")) dir = args[i].Substring(5).Trim('"');
        }
        if (silent)
        {
            try
            {
                dir = dir != null ? Path.GetFullPath(dir) : FindDir();
                if (dir == null) { Console.WriteLine("no installed Replica Lab found"); ForgetDir(); return 0; }
                string why = NotOurs(dir);
                if (why != null) throw new Exception(why);
                if (RunningFrom(dir)) StopCopy(dir);
                if (RunningFrom(dir)) throw new Exception("Replica Lab in " + dir + " is still running");
                string saved = backup ? Backup(dir) : null;
                Remove(dir, null);
                Console.WriteLine("removed " + dir + (saved != null ? ", backup in " + saved : ""));
                return 0;
            }
            catch (Exception ex) { Console.Error.WriteLine("uninstall failed: " + ex.Message); return 1; }
        }
        try
        {
            string found = dir != null ? Path.GetFullPath(dir) : FindDir();
            if (found == null)
            {
                ForgetDir();
                MessageBox.Show("ไม่พบ Replica Lab ที่ติดตั้งด้วยตัวติดตั้ง (ReplicaLab-Setup) ในเครื่องนี้\n\nถ้าใช้แบบ portable (แตก zip) ไม่ต้องถอน ลบโฟลเดอร์ได้เลย",
                    Title, MessageBoxButtons.OK, MessageBoxIcon.Information);
                return 0;
            }
            Application.Run(new UninstallForm(found));
            return 0;
        }
        catch (Exception ex) { MessageBox.Show("ถอนการติดตั้งไม่ได้ เกิดข้อผิดพลาด:\n\n" + ex, Title, MessageBoxButtons.OK, MessageBoxIcon.Error); return 1; }
    }

    // the installed folder: what Setup remembered, else its default; only when a Replica Lab is really there
    public static string FindDir()
    {
        try
        {
            using (var k = Registry.CurrentUser.OpenSubKey(RegKey))
            {
                var d = k == null ? null : k.GetValue("InstallDir") as string;
                if (!string.IsNullOrEmpty(d) && File.Exists(Path.Combine(d, "VERSION"))) return Path.GetFullPath(d);
            }
        }
        catch { }
        foreach (var d in new[] { Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "ReplicaLab"), @"C:\ReplicaLab" })
            if (File.Exists(Path.Combine(d, "VERSION")) && File.Exists(Path.Combine(d, "Replica Lab.exe"))) return d;
        return null;
    }

    // never delete a folder that is not a Replica Lab program folder (a wrong /dir= or a damaged registry value)
    public static string NotOurs(string dir)
    {
        string full = dir.TrimEnd('\\');
        if (Path.GetPathRoot(dir).TrimEnd('\\').Equals(full, StringComparison.OrdinalIgnoreCase)) return "refusing to remove a drive root: " + dir;
        foreach (var sf in new[] { Environment.SpecialFolder.UserProfile, Environment.SpecialFolder.Desktop, Environment.SpecialFolder.LocalApplicationData,
                                   Environment.SpecialFolder.ApplicationData, Environment.SpecialFolder.MyDocuments, Environment.SpecialFolder.Windows,
                                   Environment.SpecialFolder.ProgramFiles })
            if (Environment.GetFolderPath(sf).TrimEnd('\\').Equals(full, StringComparison.OrdinalIgnoreCase)) return "refusing to remove " + dir;
        foreach (var f in new[] { "VERSION", "start.cmd", "run-local.ps1", @"builder\builder.mjs" })
            if (!File.Exists(Path.Combine(dir, f))) return "not a Replica Lab folder (no " + f + "): " + dir;
        return null;
    }

    public static string Version(string dir)
    {
        try { return File.ReadAllText(Path.Combine(dir, "VERSION")).Trim(); } catch { return ""; }
    }

    // apps\ (profiles, saved tests, *.local.env secrets) and config\ (last image/replicas/port per app) go to the Desktop,
    // ready to copy into the portable folder
    public static string Backup(string dir)
    {
        string dest = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Desktop), "ReplicaLab-backup-" + DateTime.Now.ToString("yyyyMMdd-HHmm"));
        int n = 0;
        foreach (var sub in new[] { "apps", "config" })
        {
            string src = Path.Combine(dir, sub);
            if (!Directory.Exists(src)) continue;
            foreach (var f in Directory.GetFiles(src, "*", SearchOption.AllDirectories))
            {
                string to = Path.Combine(dest, f.Substring(dir.TrimEnd('\\').Length + 1));
                Directory.CreateDirectory(Path.GetDirectoryName(to));
                File.Copy(f, to, true);
                n++;
            }
        }
        return n > 0 ? dest : null;
    }

    public static void Remove(string dir, Action<string> progress)
    {
        if (progress != null) progress("กำลังลบไอคอน…");
        foreach (var lnk in new[] {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Desktop), "Replica Lab.lnk"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "Replica Lab.lnk") })
            if (File.Exists(lnk) && PointsInto(lnk, dir)) { try { File.Delete(lnk); } catch { } }

        if (progress != null) progress("กำลังลบโฟลเดอร์ " + dir + "…");
        Exception last = null;
        for (int i = 0; i < 10; i++)          // a just-stopped node.exe or powershell may hold a file for a moment
        {
            try { if (Directory.Exists(dir)) Directory.Delete(dir, true); last = null; break; }
            catch (Exception ex) { last = ex; System.Threading.Thread.Sleep(700); }
        }
        if (last != null) throw new Exception("ลบโฟลเดอร์ไม่หมด (มีโปรแกรมเปิดไฟล์อยู่?): " + last.Message);
        ForgetDir(dir);
    }

    // forget Setup's InstallDir: when it is this folder, or (dir null) when it points at nothing
    public static void ForgetDir(string dir = null)
    {
        try
        {
            string d;
            using (var k = Registry.CurrentUser.OpenSubKey(RegKey)) d = k == null ? null : k.GetValue("InstallDir") as string;
            bool forget = string.IsNullOrEmpty(d) || !File.Exists(Path.Combine(d, "VERSION")) ||
                          (dir != null && string.Equals(Path.GetFullPath(d).TrimEnd('\\'), dir.TrimEnd('\\'), StringComparison.OrdinalIgnoreCase));
            if (forget) Registry.CurrentUser.DeleteSubKeyTree(RegKey, false);
        }
        catch { }
    }

    // a shortcut is ours only when its target or working folder is inside the installed folder
    static bool PointsInto(string lnk, string dir)
    {
        try
        {
            Type t = Type.GetTypeFromProgID("WScript.Shell");
            object shell = Activator.CreateInstance(t);
            object sc = t.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { lnk });
            Type st = sc.GetType();
            string target = (st.InvokeMember("TargetPath", BindingFlags.GetProperty, null, sc, null) as string) ?? "";
            string work = (st.InvokeMember("WorkingDirectory", BindingFlags.GetProperty, null, sc, null) as string) ?? "";
            string root = dir.TrimEnd('\\') + "\\";
            return (target + "\\").StartsWith(root, StringComparison.OrdinalIgnoreCase) || (work + "\\").StartsWith(root, StringComparison.OrdinalIgnoreCase);
        }
        catch { return false; }
    }

    // ---- stopping the copy (same as Setup) ----
    public static void StopCopy(string dir)
    {
        string stop = Path.Combine(dir, "stop.cmd");
        if (File.Exists(stop)) RunHidden("cmd.exe", "/c \"\"" + stop + "\"\"", dir, 120000);
        for (int i = 0; i < 20 && HelperRunning(); i++) System.Threading.Thread.Sleep(500);
    }

    public static bool HelperRunning()
    {
        try { using (var c = new TcpClient()) { c.Connect("127.0.0.1", 18091); return true; } } catch { return false; }
    }

    public static string HelperFolder()
    {
        try
        {
            var req = (System.Net.HttpWebRequest)System.Net.WebRequest.Create("http://127.0.0.1:18091/about");
            req.Proxy = null; req.Timeout = 20000;
            req.Headers["X-Replica-Lab"] = "1";
            req.Headers["Sec-Fetch-Site"] = "same-origin";
            using (var res = req.GetResponse())
            using (var r = new StreamReader(res.GetResponseStream(), System.Text.Encoding.UTF8))
            {
                var m = System.Text.RegularExpressions.Regex.Match(r.ReadToEnd(), "\"folder\"\\s*:\\s*\"((?:[^\"\\\\]|\\\\.)*)\"");
                return m.Success ? m.Groups[1].Value.Replace("\\\\", "\\") : null;
            }
        }
        catch { return null; }
    }

    // true when the running Replica Lab is the copy in dir (or it cannot tell)
    public static bool RunningFrom(string dir)
    {
        if (!HelperRunning()) return false;
        string f = HelperFolder();
        return f == null || string.Equals(f.TrimEnd('\\'), dir.TrimEnd('\\'), StringComparison.OrdinalIgnoreCase);
    }

    public static int RunHidden(string file, string args, string dir, int waitMs)
    {
        var psi = new ProcessStartInfo(file, args) { WorkingDirectory = dir, UseShellExecute = false, CreateNoWindow = true, WindowStyle = ProcessWindowStyle.Hidden };
        using (var p = Process.Start(psi))
        {
            if (!p.WaitForExit(waitMs)) return -1;
            return p.ExitCode;
        }
    }
}

class UninstallForm : Form
{
    readonly string dir;
    readonly CheckBox backupBox = new CheckBox();
    readonly Button goBtn = new Button(), cancelBtn = new Button();
    readonly Label status = new Label();

    public UninstallForm(string dir)
    {
        this.dir = dir;
        string ver = Uninstall.Version(dir);
        Text = Uninstall.Title;
        Font = new Font("Segoe UI", 9.75f);
        AutoScaleMode = AutoScaleMode.Dpi;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false; MinimizeBox = false;
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Color.White;
        try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }
        ClientSize = new Size(560, 300);

        var head = new Label { Text = "ถอน Replica Lab " + ver, Font = new Font("Segoe UI Semibold", 15f), AutoSize = true, Location = new Point(24, 20) };
        var sub = new Label
        {
            Text = "ลบตัวที่ติดตั้งด้วย ReplicaLab-Setup เพื่อเปลี่ยนไปใช้แบบ portable (แตก zip)\nโฟลเดอร์ที่จะลบ:",
            ForeColor = Color.FromArgb(90, 90, 100), AutoSize = true, Location = new Point(26, 58)
        };
        var path = new TextBox { Text = dir, ReadOnly = true, Location = new Point(26, 102), Width = 508, BackColor = Color.FromArgb(245, 245, 248) };
        backupBox.Text = "สำรองโปรไฟล์แอป, ชุดทดสอบ และค่าที่จำไว้ (apps\\, config\\) ไว้บน Desktop";
        backupBox.Checked = true; backupBox.AutoSize = true; backupBox.Location = new Point(26, 144);
        var note = new Label
        {
            Text = "ไอคอน Replica Lab บน Desktop ที่ชี้มาที่โฟลเดอร์นี้จะถูกลบด้วย ตัว portable ที่อยู่ที่อื่นไม่ถูกแตะ\nimage และ service อื่นใน Docker ไม่ถูกลบ",
            ForeColor = Color.FromArgb(90, 90, 100), AutoSize = true, Location = new Point(26, 176)
        };
        status.Location = new Point(26, 222); status.Size = new Size(508, 22); status.ForeColor = Color.FromArgb(90, 90, 100);
        goBtn.Text = "ถอนการติดตั้ง"; goBtn.Size = new Size(130, 34); goBtn.Location = new Point(286, 252);
        cancelBtn.Text = "ยกเลิก"; cancelBtn.Size = new Size(110, 34); cancelBtn.Location = new Point(424, 252);
        goBtn.Click += (s, e) => Go();
        cancelBtn.Click += (s, e) => Close();
        Controls.AddRange(new Control[] { head, sub, path, backupBox, note, status, goBtn, cancelBtn });
        CancelButton = cancelBtn; ActiveControl = cancelBtn;      // the safe button has the focus
    }

    void Say(string s) { status.Text = s; status.Refresh(); }

    void Go()
    {
        string why = Uninstall.NotOurs(dir);
        if (why != null) { MessageBox.Show(this, "ไม่ลบให้: โฟลเดอร์นี้ไม่ใช่โฟลเดอร์ของ Replica Lab\n\n" + why, Text, MessageBoxButtons.OK, MessageBoxIcon.Warning); return; }
        if (Uninstall.RunningFrom(dir))
        {
            var r = MessageBox.Show(this, "Replica Lab เปิดอยู่ ต้องปิดก่อน\n\nกด OK เพื่อปิดให้ (replica ที่รันอยู่จะหยุด)", Text, MessageBoxButtons.OKCancel, MessageBoxIcon.Information);
            if (r != DialogResult.OK) return;
            goBtn.Enabled = cancelBtn.Enabled = backupBox.Enabled = false;
            Say("กำลังปิด Replica Lab…");
            Uninstall.StopCopy(dir);
            if (Uninstall.RunningFrom(dir))
            {
                MessageBox.Show(this, "ยังปิด Replica Lab ไม่ได้ ปิดหน้าต่าง Replica Lab แล้วลองอีกครั้ง", Text, MessageBoxButtons.OK, MessageBoxIcon.Warning);
                goBtn.Enabled = cancelBtn.Enabled = backupBox.Enabled = true; Say(""); return;
            }
        }
        goBtn.Enabled = cancelBtn.Enabled = backupBox.Enabled = false;
        string saved = null;
        try
        {
            if (backupBox.Checked) { Say("กำลังสำรอง apps\\ และ config\\…"); saved = Uninstall.Backup(dir); }
            Uninstall.Remove(dir, Say);
        }
        catch (Exception ex)
        {
            Say("");
            MessageBox.Show(this, "ถอนไม่สำเร็จ: " + ex.Message + (saved != null ? "\n\nสำรองไว้แล้วที่ " + saved : ""), Text, MessageBoxButtons.OK, MessageBoxIcon.Error);
            goBtn.Enabled = cancelBtn.Enabled = backupBox.Enabled = true;
            return;
        }
        MessageBox.Show(this, "ถอน Replica Lab แล้ว\n" + dir +
            (saved != null ? "\n\nสำรองไว้ที่ " + saved + "\nใช้กับตัว portable: คัดลอกโฟลเดอร์ apps และ config ในนั้นไปวางทับในโฟลเดอร์ replica-lab ที่แตกจาก zip" : ""),
            Text, MessageBoxButtons.OK, MessageBoxIcon.Information);
        Close();
    }
}

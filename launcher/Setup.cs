// Replica Lab Setup: one exe for the team. The program files ride inside it as an embedded zip (payload.zip, made by
// make-package.ps1); it unpacks them into a folder, makes the Desktop icon and opens Replica Lab.
// Installing over an older copy is safe: like the updater, it keeps config\ (this machine), apps\*.local.env (secrets)
// and app profiles that already exist. Built by launcher\build-setup.cmd with the C# compiler that ships with Windows.
using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Net.Sockets;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: AssemblyTitle("Replica Lab Setup")]
[assembly: AssemblyProduct("Replica Lab")]
[assembly: AssemblyCompany("DevTeam, Information Technology, Faculty of Medicine Ramathibodi Hospital, Mahidol University")]
[assembly: AssemblyVersion("1.0.0.0")]

static class Setup
{
    const string RegKey = @"Software\ReplicaLab";
    const string Title = "Replica Lab Setup";

    [DllImport("user32.dll")] static extern bool SetProcessDPIAware();

    [STAThread]
    static int Main()
    {
        try { SetProcessDPIAware(); } catch { }
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Stream payload = Assembly.GetExecutingAssembly().GetManifestResourceStream("payload.zip");
        if (payload == null) { MessageBox.Show("ไฟล์ติดตั้งไม่สมบูรณ์ (ไม่มีตัวโปรแกรมข้างใน)", Title, MessageBoxButtons.OK, MessageBoxIcon.Error); return 1; }
        // silent install for scripts:  ReplicaLab-Setup.exe /silent [/dir=C:\ReplicaLab] [/noicons] [/open]
        string[] args = Environment.GetCommandLineArgs();
        bool silent = false, icons = true, open = false; string dir = null;
        for (int i = 1; i < args.Length; i++)
        {
            string a = args[i].ToLowerInvariant();
            if (a == "/silent") silent = true;
            else if (a == "/noicons") icons = false;
            else if (a == "/open") open = true;
            else if (a.StartsWith("/dir=")) dir = args[i].Substring(5).Trim('"');
        }
        using (var zip = new ZipArchive(payload, ZipArchiveMode.Read))
        {
            if (!silent)
            {
                // never die without a word: a crash shows its message instead of the exe doing "nothing"
                try { Application.Run(new SetupForm(zip)); return 0; }
                catch (Exception ex) { MessageBox.Show("ติดตั้งไม่ได้ เกิดข้อผิดพลาด:\n\n" + ex, Title, MessageBoxButtons.OK, MessageBoxIcon.Error); return 1; }
            }
            try
            {
                dir = Path.GetFullPath(dir ?? DefaultDir());
                if (dir.Contains(" ")) throw new Exception("folder must not contain spaces: " + dir);
                if (RunningFrom(dir)) StopCopy(dir);
                if (RunningFrom(dir)) throw new Exception("Replica Lab in " + dir + " is still running");
                int kept;
                int copied = Unpack(zip, dir, out kept, null);
                SaveDir(dir);
                if (icons) MakeIcons(dir);
                Console.WriteLine("installed " + Version(zip) + " in " + dir + ": " + copied + " files, " + kept + " kept");
                if (open) Process.Start(new ProcessStartInfo(Path.Combine(dir, "Replica Lab.exe")) { WorkingDirectory = dir, UseShellExecute = true });
                return 0;
            }
            catch (Exception ex) { Console.Error.WriteLine("setup failed: " + ex.Message); return 1; }
        }
    }

    public static void StopCopy(string dir)
    {
        string stop = Path.Combine(dir, "stop.cmd");
        if (File.Exists(stop)) RunHidden("cmd.exe", "/c \"\"" + stop + "\"\"", dir, 120000);
        for (int i = 0; i < 20 && HelperRunning(); i++) System.Threading.Thread.Sleep(500);
    }

    public static void MakeIcons(string dir)
    {
        RunHidden("powershell.exe", "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"" + Path.Combine(dir, "create-shortcut.ps1") + "\" -Quiet", dir, 60000);
    }

    // copy the payload into dir. Like the updater: never config\, and existing apps\* / *.local.env stay as they are
    public static int Unpack(ZipArchive zip, string dir, out int kept, Action<string> progress)
    {
        int copied = 0; kept = 0;
        Directory.CreateDirectory(dir);
        foreach (var e in zip.Entries)
        {
            string rel = Rel(e);
            if (progress != null) progress(rel);
            if (rel == "" || rel.EndsWith("\\")) continue;                      // folder entries
            if (rel.StartsWith("config\\", StringComparison.OrdinalIgnoreCase)) continue;
            string dest = Path.GetFullPath(Path.Combine(dir, rel));
            if (!dest.StartsWith(dir.TrimEnd('\\') + "\\", StringComparison.OrdinalIgnoreCase)) continue;   // stay inside the folder
            bool keep = File.Exists(dest) &&
                        (rel.StartsWith("apps\\", StringComparison.OrdinalIgnoreCase) || rel.EndsWith(".local.env", StringComparison.OrdinalIgnoreCase));
            if (keep) { kept++; continue; }
            Directory.CreateDirectory(Path.GetDirectoryName(dest));
            e.ExtractToFile(dest, true);
            copied++;
        }
        return copied;
    }

    public static string DefaultDir()
    {
        try
        {
            using (var k = Registry.CurrentUser.OpenSubKey(RegKey))
            {
                var d = k == null ? null : k.GetValue("InstallDir") as string;
                if (!string.IsNullOrEmpty(d)) return d;
            }
        }
        catch { }
        string local = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "ReplicaLab");
        return local.Contains(" ") ? @"C:\ReplicaLab" : local;
    }

    public static void SaveDir(string dir)
    {
        try { using (var k = Registry.CurrentUser.CreateSubKey(RegKey)) k.SetValue("InstallDir", dir); } catch { }
    }

    // entry name inside the zip without its top folder (replica-lab\...), with Windows separators
    public static string Rel(ZipArchiveEntry e)
    {
        string n = e.FullName.Replace('/', '\\');
        int i = n.IndexOf('\\');
        return i < 0 ? "" : n.Substring(i + 1);
    }

    public static string Version(ZipArchive zip)
    {
        foreach (var e in zip.Entries)
            if (Rel(e).Equals("VERSION", StringComparison.OrdinalIgnoreCase))
                using (var r = new StreamReader(e.Open())) return r.ReadToEnd().Trim();
        return "";
    }

    public static bool HelperRunning()
    {
        try { using (var c = new TcpClient()) { c.Connect("127.0.0.1", 18091); return true; } } catch { return false; }
    }

    // the folder the running helper belongs to (its /about), or null when it cannot tell
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

    // true when the Replica Lab that runs now is the copy in dir (or it cannot tell): it must stop before its files change
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

class SetupForm : Form
{
    readonly ZipArchive zip;
    readonly string version;
    readonly TextBox dirBox = new TextBox();
    readonly CheckBox iconBox = new CheckBox(), openBox = new CheckBox();
    readonly Button installBtn = new Button(), cancelBtn = new Button(), browseBtn = new Button();
    readonly Label status = new Label();
    readonly ProgressBar bar = new ProgressBar();

    public SetupForm(ZipArchive zip)
    {
        this.zip = zip;
        version = Setup.Version(zip);
        Text = "ติดตั้ง Replica Lab " + version;
        Font = new Font("Segoe UI", 9.75f);
        AutoScaleMode = AutoScaleMode.Dpi;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false; MinimizeBox = false;
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Color.White;
        try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }
        ClientSize = new Size(560, 330);

        var head = new Label { Text = "Replica Lab " + version, Font = new Font("Segoe UI Semibold", 15f), AutoSize = true, Location = new Point(24, 20) };
        var sub = new Label
        {
            Text = "รัน image ในเครื่องเป็นหลาย replica บน Docker Swarm\nต้องมี Docker Desktop และ Node.js (โปรแกรมจะพาไปหน้าดาวน์โหลดถ้ายังไม่มี)",
            ForeColor = Color.FromArgb(90, 90, 100), AutoSize = true, Location = new Point(26, 58)
        };
        var dirLabel = new Label { Text = "ติดตั้งที่", AutoSize = true, Location = new Point(26, 112) };
        dirBox.Text = Setup.DefaultDir();
        dirBox.Location = new Point(26, 134); dirBox.Width = 410;
        browseBtn.Text = "เลือก…"; browseBtn.Location = new Point(446, 132); browseBtn.Size = new Size(88, 30);
        browseBtn.Click += (s, e) =>
        {
            using (var d = new FolderBrowserDialog { Description = "เลือกโฟลเดอร์ที่จะติดตั้ง Replica Lab", SelectedPath = dirBox.Text })
                if (d.ShowDialog(this) == DialogResult.OK) dirBox.Text = Path.Combine(d.SelectedPath, "ReplicaLab");
        };
        iconBox.Text = "สร้างไอคอนบน Desktop"; iconBox.Checked = true; iconBox.AutoSize = true; iconBox.Location = new Point(26, 176);
        openBox.Text = "เปิด Replica Lab เมื่อติดตั้งเสร็จ"; openBox.Checked = true; openBox.AutoSize = true; openBox.Location = new Point(26, 204);
        bar.Location = new Point(26, 240); bar.Size = new Size(508, 8); bar.Visible = false;
        status.Location = new Point(26, 252); status.Size = new Size(508, 22); status.ForeColor = Color.FromArgb(90, 90, 100);
        installBtn.Text = "ติดตั้ง"; installBtn.Size = new Size(110, 34); installBtn.Location = new Point(306, 282);
        cancelBtn.Text = "ยกเลิก"; cancelBtn.Size = new Size(110, 34); cancelBtn.Location = new Point(424, 282);
        installBtn.Click += (s, e) => Install();
        cancelBtn.Click += (s, e) => Close();
        Controls.AddRange(new Control[] { head, sub, dirLabel, dirBox, browseBtn, iconBox, openBox, bar, status, installBtn, cancelBtn });
        AcceptButton = installBtn; CancelButton = cancelBtn; ActiveControl = installBtn;   // after AddRange: it must be on the form
    }

    void Install()
    {
        string dir;
        try { dir = Path.GetFullPath(dirBox.Text.Trim()); }
        catch { MessageBox.Show(this, "ที่ติดตั้งไม่ถูกต้อง", Text, MessageBoxButtons.OK, MessageBoxIcon.Warning); return; }
        if (dir.Contains(" "))
        {
            MessageBox.Show(this, "เลือกโฟลเดอร์ที่ไม่มีช่องว่างในชื่อ (สคริปต์ของ Docker และ PowerShell บางตัวใช้ path ที่มีช่องว่างไม่ได้)\nเช่น C:\\ReplicaLab", Text, MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return;
        }
        bool upgrade = File.Exists(Path.Combine(dir, "VERSION"));

        // the running copy holds the helper and the page; stop it first so its files can be replaced
        if (Setup.RunningFrom(dir))
        {
            var r = MessageBox.Show(this, "Replica Lab เปิดอยู่ ต้องปิดก่อนติดตั้ง\n\nกด OK เพื่อปิดให้ (replica ที่รันอยู่จะหยุด และจำค่าไว้ให้ครั้งหน้า)", Text, MessageBoxButtons.OKCancel, MessageBoxIcon.Information);
            if (r != DialogResult.OK) return;
            status.Text = "กำลังปิด Replica Lab…"; Refresh();
            Setup.StopCopy(dir);
            if (Setup.RunningFrom(dir))
            {
                MessageBox.Show(this, "ยังปิด Replica Lab ไม่ได้ ปิดหน้าต่าง Replica Lab แล้วกดติดตั้งอีกครั้ง", Text, MessageBoxButtons.OK, MessageBoxIcon.Warning);
                status.Text = ""; return;
            }
        }

        installBtn.Enabled = cancelBtn.Enabled = browseBtn.Enabled = dirBox.Enabled = false;
        bar.Visible = true; bar.Maximum = zip.Entries.Count; bar.Value = 0;
        int kept = 0;
        try
        {
            Setup.Unpack(zip, dir, out kept, rel => { if (bar.Value < bar.Maximum) bar.Value++; status.Text = rel; status.Refresh(); });
            Setup.SaveDir(dir);
            if (iconBox.Checked)
            {
                status.Text = "กำลังสร้างไอคอน…"; status.Refresh();
                Setup.MakeIcons(dir);
            }
        }
        catch (Exception ex)
        {
            bar.Visible = false;
            status.Text = "";
            MessageBox.Show(this, "ติดตั้งไม่สำเร็จ: " + ex.Message, Text, MessageBoxButtons.OK, MessageBoxIcon.Error);
            installBtn.Enabled = cancelBtn.Enabled = browseBtn.Enabled = dirBox.Enabled = true;
            return;
        }

        string done = (upgrade ? "อัปเดต" : "ติดตั้ง") + " Replica Lab " + version + " แล้ว\n" + dir +
                      (kept > 0 ? "\n\nเก็บโปรไฟล์แอปและความลับเดิมไว้ " + kept + " ไฟล์" : "");
        if (openBox.Checked)
        {
            string exe = Path.Combine(dir, "Replica Lab.exe");
            try { Process.Start(new ProcessStartInfo(exe) { WorkingDirectory = dir, UseShellExecute = true }); }
            catch (Exception ex) { MessageBox.Show(this, done + "\n\nเปิดโปรแกรมไม่ได้: " + ex.Message, Text, MessageBoxButtons.OK, MessageBoxIcon.Warning); }
        }
        else MessageBox.Show(this, done, Text, MessageBoxButtons.OK, MessageBoxIcon.Information);
        Close();
    }
}

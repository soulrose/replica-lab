// Replica Lab host helper: runs on this PC (not in Docker). Three jobs:
//   1. launch  - the app window opens on http://localhost:18091/launch, which checks Docker / deploys the stack
//                (run-local.ps1) and then moves on to the Replica Lab page on :18090
//   2. lifecycle - the page pings every 10 s and says bye on close; when the last window is gone the stack is
//                stopped (stop-local.ps1, which remembers image / replicas / port) and this helper exits,
//                like Hyperion API: closing the app stops the server
//   3. build   - build local code into an image (build-local.ps1), because the page runs in Docker and cannot run Maven
// Listens on 127.0.0.1 only and answers only the Replica Lab pages. Started by helper.cmd (start.cmd / OffLab).
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn, execFile, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.BUILDER_PORT || 18091);
const APP_PORT = 18090;
const TITLE = "Replica Lab";                                   // every Replica Lab window title contains this
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");                         // D:\OffLab\replica-lab
const BUILD_SCRIPT = path.join(ROOT, "build-local.ps1");
const RUN_SCRIPT = path.join(ROOT, "run-local.ps1");
const STOP_SCRIPT = path.join(ROOT, "stop-local.ps1");
const LAST_REPO = path.join(ROOT, "config", "last-repo.txt");
const ALLOWED = new Set([`http://localhost:${APP_PORT}`, `http://127.0.0.1:${APP_PORT}`, `http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`]);
const MAX_LINES = 3000;
const log = (...a) => console.log(new Date().toISOString(), ...a);

// ---------- run a PowerShell script, keep its output ----------
function runPs(script, args) {
  const j = { state: "running", code: null, lines: [], startedAt: new Date().toISOString(), endedAt: null, pid: null };
  const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, ...args], { cwd: ROOT, windowsHide: true });
  j.pid = child.pid;
  const push = chunk => {
    for (const l of chunk.toString("utf8").split(/\r?\n/)) {
      if (!l.trim()) continue;
      j.lines.push(l);
      if (j.lines.length > MAX_LINES) j.lines.splice(0, j.lines.length - MAX_LINES);
    }
  };
  child.stdout.on("data", push);
  child.stderr.on("data", push);
  child.on("error", e => { j.lines.push("start failed: " + e.message); j.state = "error"; j.endedAt = new Date().toISOString(); });
  j.done = new Promise(resolve => child.on("close", code => {
    if (j.state === "running") j.state = code === 0 ? "done" : "error";
    j.code = code; j.endedAt = new Date().toISOString(); resolve(j);
  }));
  return j;
}
const view = j => j && { state: j.state, code: j.code, startedAt: j.startedAt, endedAt: j.endedAt, lines: j.lines.slice(-400), totalLines: j.lines.length,
                         ...(j.repo ? { repo: j.repo, skipMaven: j.skipMaven, apply: j.apply } : {}) };

// ---------- 1. launch ----------
let launch = null;
function appUp() {
  return new Promise(resolve => {
    const req = http.get({ host: "127.0.0.1", port: APP_PORT, path: "/api/pull", timeout: 1500 }, res => { res.resume(); resolve(res.statusCode < 500); });
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(false));
  });
}
async function launchStatus() {
  const up = await appUp();
  return { ready: up && (!launch || launch.state !== "running"), up, launch: view(launch) };
}
async function startLaunch() {
  if (launch?.state === "running") return launchStatus();
  if (await appUp()) return launchStatus();                    // stack already up: just open it
  launch = runPs(RUN_SCRIPT, []);
  return launchStatus();
}
// switch to another app: run-local.ps1 -App <name> (the running app is stopped and remembered)
function switchApp(name, tune) {
  if (launch?.state === "running") throw new Error("กำลังเปิดหรือสลับแอปอยู่ รอให้เสร็จก่อน");
  if (!fs.existsSync(path.join(APPS, `${name}.json`))) throw new Error("ไม่มีแอป " + name);
  launch = runPs(RUN_SCRIPT, ["-App", name, ...(tune ? ["-TuneRam"] : [])]);
  return view(launch);
}

// ---------- apps: profiles in apps\<name>.json (+ .env, + .tests.json) ----------
const APPS = path.join(ROOT, "apps");
const NAME_RE = /^[a-z0-9][a-z0-9-]{0,30}$/;
const checkName = n => { if (!NAME_RE.test(String(n || ""))) throw new Error("ชื่อแอปใช้ได้แค่ a-z 0-9 และ - (ไม่เกิน 31 ตัว)"); return n; };
const readJsonFile = (f, dflt) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return dflt; } };
const run = (cmd, args, timeout = 30000) => new Promise(resolve =>
  execFile(cmd, args, { windowsHide: true, timeout, maxBuffer: 20 * 1024 * 1024 }, (e, out, err) => resolve({ ok: !e, out: String(out || ""), err: String(err || e?.message || "") })));

// the app on the page now: label of our own app service, else of the page (an attached swarm service has no app service of ours)
async function runningApp() {
  for (const svc of ["replicalab_app", "replicalab_scaler"]) {
    const r = await run("docker", ["service", "inspect", svc, "--format", "{{json .Spec.Labels}}"]);
    if (!r.ok) continue;
    try { const n = JSON.parse(r.out)["rama.lab.app"]; if (n) return n; } catch { /* no labels */ }
  }
  return null;
}
async function listApps() {
  const apps = fs.readdirSync(APPS).filter(f => f.endsWith(".json") && !f.endsWith(".tests.json"))
    .map(f => readJsonFile(path.join(APPS, f), null)).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
  let current = "";
  try { current = fs.readFileSync(path.join(ROOT, "config", "current-app.txt"), "utf8").trim(); } catch { /* first run */ }
  return { apps, current, running: await runningApp() };
}

// local images the team built or pulled (not Replica Lab's own page image)
async function localImages() {
  const r = await run("docker", ["images", "--format", "{{json .}}"]);
  if (!r.ok) throw new Error("อ่านรายการ image ไม่ได้: " + r.err.slice(0, 200));
  return r.out.split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l))
    .filter(i => i.Repository !== "<none>" && i.Tag !== "<none>" && !/^replica-lab-scaler$/.test(i.Repository))
    .map(i => ({ image: `${i.Repository}:${i.Tag}`, size: i.Size, created: i.CreatedSince }));
}

// host port for a new app: first one from 18100 that no profile and no running swarm service uses
async function freeHostPort() {
  const used = new Set((await listApps()).apps.map(a => Number(a.hostPort)));
  const r = await run("docker", ["service", "ls", "--format", "{{.Ports}}"]);
  for (const m of r.out.matchAll(/:(\d+)->/g)) used.add(Number(m[1]));
  let hp = 18100; while (used.has(hp) || hp === APP_PORT || hp === PORT) hp++;
  return hp;
}

// guess a profile from an image: LABEL rama.lab.* first, then what the image looks like (Tomcat / Spring / port)
async function detect(image) {
  const r = await run("docker", ["image", "inspect", image, "--format", "{{json .Config}}"]);
  if (!r.ok) throw new Error("ไม่พบ image ในเครื่อง: " + image);
  const cfg = JSON.parse(r.out);
  const labels = cfg.Labels || {};
  const env = (cfg.Env || []).join("\n");
  const hc = (cfg.Healthcheck?.Test || []).join(" ");
  const ports = Object.keys(cfg.ExposedPorts || {}).map(p => parseInt(p, 10)).filter(Boolean);
  const repo = image.slice(0, image.lastIndexOf(":"));
  const p = { name: repo.split("/").pop().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 31) || "app",
              title: repo.split("/").pop(), image, kind: "http", port: ports[0] || 8080, health: "/", startPeriod: 60, memoryMb: 0, test: "http" };
  const notes = [];
  if (/CATALINA_HOME=/.test(env)) {
    Object.assign(p, { kind: "tomcat", startPeriod: 120 });
    const ls = await run("docker", ["run", "--rm", "--entrypoint", "sh", image, "-c", "ls /usr/local/tomcat/webapps"], 60000);
    const skip = new Set(["ROOT", "docs", "examples", "host-manager", "manager"]);
    const apps = [...new Set(ls.out.split(/\s+/).filter(Boolean).map(x => x.replace(/\.war$/, "")).filter(x => !skip.has(x)))];
    if (apps.length) { p.health = `/${apps[0]}/`; notes.push(`Tomcat, WAR: ${apps.join(", ")}`); } else notes.push("Tomcat, ไม่พบ WAR ใช้หน้า / ของ Tomcat");
  } else if (/actuator/.test(hc) || /spring/i.test(env)) {
    Object.assign(p, { kind: "spring", health: "/actuator/health/liveness", startPeriod: 180, test: "graphql" });
    notes.push("Spring Boot (actuator)");
  } else {
    const m = hc.match(/https?:\/\/[^/\s]+(\/[^\s'"|]*)/);
    if (m) { p.health = m[1]; notes.push("health จาก HEALTHCHECK ของ image"); }
  }
  // explicit labels win
  const L = k => labels[`rama.lab.${k}`];
  if (L("kind")) p.kind = L("kind");
  if (L("port")) p.port = Number(L("port")) || p.port;
  if (L("health")) p.health = L("health");
  if (L("test")) p.test = L("test");
  if (L("memory")) p.memoryMb = Number(L("memory")) || p.memoryMb;
  if (Object.keys(labels).some(k => k.startsWith("rama.lab."))) notes.push("ใช้ค่าจาก LABEL rama.lab.* ใน image");
  p.hostPort = 8080;          // default; saving checks it is not taken
  return { profile: p, notes, exists: fs.existsSync(path.join(APPS, `${p.name}.json`)) };
}

// ---------- swarm services already on this PC (not Replica Lab's own): show them, import one as an app ----------
async function swarmServices() {
  const r = await run("docker", ["service", "ls", "--format", "{{json .}}"]);
  if (!r.ok) throw new Error("อ่าน service ใน swarm ไม่ได้: " + r.err.slice(0, 200));
  const attachedBy = new Map((await listApps()).apps.filter(a => a.attach).map(a => [a.attach, a.name]));
  return r.out.split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l))
    .filter(s => !s.Name.startsWith("replicalab_") && !String(s.Image).startsWith("replica-lab-scaler"))   // not Replica Lab's own pages
    .map(s => ({ name: s.Name, image: s.Image, replicas: s.Replicas, ports: s.Ports, mode: s.Mode, app: attachedBy.get(s.Name) || null }));
}

// control a running swarm service in place: an app profile with "attach" (no image, no port of ours), then switch to it
async function attachService(name, tune) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$/.test(name)) throw new Error("ชื่อ service ไม่ถูกต้อง");
  const r = await run("docker", ["service", "inspect", name, "--format", "{{json .Spec}}"]);
  if (!r.ok) throw new Error("ไม่พบ service " + name);
  const spec = JSON.parse(r.out);
  if (!spec.Mode?.Replicated) throw new Error(`${name} รันแบบ global (1 ตัวต่อเครื่อง) ปรับจำนวน replica ไม่ได้`);
  const apps = (await listApps()).apps;
  let p = apps.find(a => a.attach === name);
  if (!p) {
    const d = await importService(name);        // kind / port in the container / health / test, from the image and the service
    const base = d.profile.name;
    let n = base;
    for (let i = 2; fs.existsSync(path.join(APPS, `${n}.json`)); i++) n = `${base.slice(0, 28)}-${i}`;
    p = { name: n, title: name, attach: name, kind: d.profile.kind, port: d.profile.port, health: d.profile.health,
          test: d.profile.test, startPeriod: d.profile.startPeriod };
    fs.writeFileSync(path.join(APPS, `${n}.json`), JSON.stringify(p, null, 2));
    log(`attach: app ${n} controls swarm service ${name}`);
  }
  return { app: p.name, launch: switchApp(p.name, tune) };
}
async function importService(name) {
  const r = await run("docker", ["service", "inspect", name, "--format", "{{json .Spec}}"]);
  if (!r.ok) throw new Error("ไม่พบ service " + name);
  const spec = JSON.parse(r.out);
  const cs = spec.TaskTemplate?.ContainerSpec || {};
  const image = String(cs.Image || "").split("@")[0];
  // start from what the image looks like, then take what the service itself says
  let d;
  try { d = await detect(image); }
  catch { d = { profile: { image, kind: "http", port: 8080, health: "/", startPeriod: 60, memoryMb: 0, test: "http", hostPort: 8080 },
                notes: ["image นี้ไม่มี tag ในเครื่อง (service ใช้ตาม digest) ตอนใช้แอปจะ pull ให้ ค่าที่เดาได้น้อยลง ตรวจ port/health เอง"] }; }
  const p = d.profile;
  p.name = name.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 31) || p.name;
  p.title = name;
  const port = spec.EndpointSpec?.Ports?.[0];
  if (port?.TargetPort) p.port = port.TargetPort;
  const hc = (cs.Healthcheck?.Test || []).join(" ");
  const m = hc.match(/https?:\/\/[^/\s]+(\/[^\s'"|]*)/);
  if (m) p.health = m[1];
  if (cs.Healthcheck?.StartPeriod) p.startPeriod = Math.round(cs.Healthcheck.StartPeriod / 1e9);
  const mem = spec.TaskTemplate?.Resources?.Limits?.MemoryBytes;
  if (mem) p.memoryMb = Math.round(mem / 1048576);
  const notes = [...d.notes, `นำเข้าจาก service ${name}` + (port?.PublishedPort ? ` (ตัวเดิมใช้ port ${port.PublishedPort} อยู่ จึงตั้ง port ใหม่ให้)` : "")];
  if (spec.TaskTemplate?.ContainerSpec?.Command || cs.Args) notes.push("service เดิมสั่ง command/args เอง Replica Lab ใช้ค่าเริ่มต้นของ image");
  if (cs.Mounts?.length) notes.push(`service เดิม mount ${cs.Mounts.length} รายการ Replica Lab ไม่ได้นำมา`);
  if (cs.Secrets?.length || cs.Configs?.length) notes.push("service เดิมใช้ docker secret/config Replica Lab ไม่ได้นำมา");
  const env = `# imported from swarm service ${name}\n` + (cs.Env || []).join("\n") + "\n";
  return { profile: p, env, notes, exists: fs.existsSync(path.join(APPS, `${p.name}.json`)) };
}

// a save is refused with the fields to fix (the page marks them red)
class FieldError extends Error { constructor(msg, fields) { super(msg); this.fields = fields; } }

// host ports in use: other apps (the port they really ran on last, else their profile), other swarm services, Replica Lab itself
async function portOwners(except) {
  const owners = new Map([[APP_PORT, "หน้า Replica Lab"], [PORT, "ตัวช่วยของ Replica Lab"]]);
  for (const a of (await listApps()).apps) {
    if (a.name === except || a.attach) continue;      // an attached service's port is listed below with the swarm services
    const st = readJsonFile(path.join(ROOT, "config", "state", `${a.name}.json`), null);
    owners.set(Number(st?.hostPort || a.hostPort), `แอป ${a.name}`);
  }
  const r = await run("docker", ["service", "ls", "--format", "{{.Name}} {{.Ports}}"]);
  for (const line of r.out.split(/\r?\n/)) {
    const [name] = line.split(" ");
    if (!name || name.startsWith("replicalab_")) continue;
    for (const m of line.matchAll(/:(\d+)->/g)) owners.set(Number(m[1]), `service ${name} ใน swarm`);
  }
  return owners;
}

async function saveApp(body) {
  const p = body.profile || {};
  checkName(p.name);
  const original = body.original ? String(body.original) : "";     // editing this app: its own name/port do not count
  const problems = [], fields = [];
  if (p.name !== original && fs.existsSync(path.join(APPS, `${p.name}.json`))) { problems.push(`ชื่อ ${p.name} มีแอปใช้อยู่แล้ว`); fields.push("name"); }
  const owner = (await portOwners(original || p.name)).get(Number(p.hostPort));
  if (owner) { problems.push(`port ${p.hostPort} ซ้ำกับ${owner}`); fields.push("hostPort"); }
  if (problems.length) throw new FieldError(problems.join(" และ ") + " แก้ช่องสีแดงแล้วกดบันทึกอีกครั้ง", fields);
  if (!p.image) throw new Error("ต้องเลือก image");
  const port = Number(p.port), hostPort = Number(p.hostPort);
  if (!(port > 0 && port < 65536)) throw new Error("port ในแอปไม่ถูกต้อง");
  if (!(hostPort >= 1024 && hostPort < 65536) || hostPort === APP_PORT || hostPort === PORT) throw new Error(`port บนเครื่องต้อง 1024-65535 และไม่ใช่ ${APP_PORT}/${PORT}`);
  const health = String(p.health || "/");
  const clean = { name: p.name, title: String(p.title || p.name).slice(0, 60), image: String(p.image), kind: ["spring", "tomcat", "http"].includes(p.kind) ? p.kind : "http",
                  port, hostPort, health: health.startsWith("/") ? health : "/" + health, startPeriod: Math.min(Math.max(Number(p.startPeriod) || 60, 10), 600),
                  memoryMb: Number(p.memoryMb) > 0 ? Math.min(Math.max(Number(p.memoryMb), 256), 4096) : 0, memoryAuto: Number(p.memoryMb) > 0 ? !!p.memoryAuto : true,
                  ...(p.memoryTunedAt ? { memoryTunedAt: String(p.memoryTunedAt) } : {}), test: p.test === "graphql" ? "graphql" : "http",
                  buildLocal: !!p.buildLocal, note: String(p.note || "").slice(0, 200) };
  fs.writeFileSync(path.join(APPS, `${clean.name}.json`), JSON.stringify(clean, null, 2) + "\n");
  if (typeof body.env === "string") fs.writeFileSync(path.join(APPS, `${clean.name}.env`), body.env.replace(/\r\n/g, "\n"));
  else if (!fs.existsSync(path.join(APPS, `${clean.name}.env`))) fs.writeFileSync(path.join(APPS, `${clean.name}.env`), `# environment for ${clean.name} (KEY=value per line)\n`);
  return clean;
}
// ---------- build an image from a project folder (the team keeps a Dockerfile in every project) ----------
const RECENT = path.join(ROOT, "config", "recent-folders.json");
let imgJob = null;      // { state, code, lines, pid, folder, tag, dockerfile, ... }
function recentFolders() { return readJsonFile(RECENT, []); }
function rememberFolder(dir) {
  const list = [dir, ...recentFolders().filter(d => d.toLowerCase() !== dir.toLowerCase())].slice(0, 10);
  fs.mkdirSync(path.dirname(RECENT), { recursive: true });
  fs.writeFileSync(RECENT, JSON.stringify(list, null, 2));
}
function inspectFolder(dir) {
  dir = String(dir || "").trim().replace(/^"|"$/g, "");
  if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Error("ไม่พบโฟลเดอร์ " + (dir || "(ว่าง)"));
  dir = path.resolve(dir);
  const dockerfiles = fs.readdirSync(dir).filter(f => /^dockerfile(\..+)?$/i.test(f) || /\.dockerfile$/i.test(f)).sort((a, b) => a.length - b.length);
  if (!dockerfiles.length) throw new Error("ไม่พบ Dockerfile ใน " + dir);
  const slug = path.basename(dir).toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "").slice(0, 60) || "app";
  const branch = git(dir, ["branch", "--show-current"]);
  const changed = git(dir, ["status", "--porcelain"]).split(/\r?\n/).filter(Boolean).length;
  return { dir, dockerfiles, tag: `${slug}:local`, branch, changed, dockerignore: fs.existsSync(path.join(dir, ".dockerignore")) };
}
function startImageBuild({ dir, dockerfile, tag }) {
  if (imgJob?.state === "running") throw new Error("กำลัง build image อยู่ รอให้เสร็จหรือกดยกเลิกก่อน");
  const info = inspectFolder(dir);
  tag = String(tag || info.tag).trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._/-]*(:[a-z0-9._-]{1,128})?$/.test(tag)) throw new Error("ชื่อ image ไม่ถูกต้อง (ใช้ a-z 0-9 . _ - / และ :tag)");
  if (!tag.includes(":")) tag += ":local";
  const df = info.dockerfiles.includes(dockerfile) ? dockerfile : info.dockerfiles[0];
  rememberFolder(info.dir);
  const j = imgJob = { state: "running", code: null, lines: [`docker build -t ${tag} -f ${df} ${info.dir}`], startedAt: new Date().toISOString(),
                       endedAt: null, pid: null, dir: info.dir, tag, dockerfile: df };
  const child = spawn("docker", ["build", "--progress=plain", "-t", tag, "-f", path.join(info.dir, df), info.dir], { cwd: info.dir, windowsHide: true });
  j.pid = child.pid;
  const push = chunk => {
    for (const l of chunk.toString("utf8").split(/\r?\n/)) {
      if (!l.trim()) continue;
      j.lines.push(l);
      if (j.lines.length > MAX_LINES) j.lines.splice(0, j.lines.length - MAX_LINES);
    }
  };
  child.stdout.on("data", push);
  child.stderr.on("data", push);
  child.on("error", e => { j.lines.push("start failed: " + e.message); j.state = "error"; j.endedAt = new Date().toISOString(); });
  child.on("close", code => { if (j.state === "running") j.state = code === 0 ? "done" : "error"; j.code = code; j.endedAt = new Date().toISOString(); log(`image build ${tag}: ${j.state}`); });
  return j;
}
function cancelImageBuild() {
  if (imgJob?.state !== "running" || !imgJob.pid) throw new Error("ไม่มี build ที่กำลังทำงาน");
  imgJob.state = "cancelled";
  try { execFileSync("taskkill", ["/PID", String(imgJob.pid), "/T", "/F"], { windowsHide: true }); } catch { /* gone */ }
  return imgJob;
}
const imgView = j => j && { state: j.state, code: j.code, dir: j.dir, tag: j.tag, dockerfile: j.dockerfile, startedAt: j.startedAt, endedAt: j.endedAt,
                            lines: j.lines.slice(-300), totalLines: j.lines.length };

// the running app uses this exact tag and it was just rebuilt: same name = Swarm sees no change, so force a rolling restart
async function forceImage(tag) {
  const r = await run("docker", ["service", "inspect", "replicalab_app", "--format", "{{.Spec.TaskTemplate.ContainerSpec.Image}}"]);
  if (!r.ok) throw new Error("ไม่มีแอปลงสนามอยู่");
  if (r.out.trim().split("@")[0] !== tag) throw new Error(`แอปที่ลงสนามใช้ ${r.out.trim().split("@")[0]} ไม่ใช่ ${tag}`);
  const u = await run("docker", ["service", "update", "--detach", "--force", "--image", tag, "replicalab_app"], 60000);
  if (!u.ok) throw new Error("อัปเดตไม่ได้: " + u.err.slice(0, 200));
  return { tag, restarted: true };
}

// ---------- version, about, update (update.ps1 does the HTTP so the Windows proxy applies) ----------
const UPDATE_SCRIPT = path.join(ROOT, "update.ps1");
const readVersion = () => { try { return fs.readFileSync(path.join(ROOT, "VERSION"), "utf8").trim(); } catch { return "dev"; } };
let updateCache = null, updateJob = null;
async function checkUpdate(force) {
  if (!force && updateCache && Date.now() - updateCache.at < 10 * 60000) return updateCache.data;
  const r = await run("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", UPDATE_SCRIPT, "-Check"], 60000);
  let data;
  try { data = JSON.parse(r.out.trim().split(/\r?\n/).pop()); } catch { data = { current: readVersion(), newer: false, error: "เช็คอัปเดตไม่ได้: " + (r.err || r.out).slice(0, 200) }; }
  updateCache = { at: Date.now(), data };
  return data;
}
async function about() {
  const [docker] = await Promise.all([run("docker", ["version", "--format", "{{.Server.Version}}"], 15000)]);
  let changelog = "";
  try {
    const text = fs.readFileSync(path.join(ROOT, "CHANGELOG.md"), "utf8");
    const m = text.match(/^## [\s\S]*?(?=^## |(?![\s\S]))/m);
    changelog = m ? m[0].trim() : "";
  } catch { /* no changelog */ }
  return { version: readVersion(), changelog, node: process.version, docker: docker.ok ? docker.out.trim() : null, folder: ROOT,
           tokenSet: fs.existsSync(path.join(ROOT, "config", "github-token.txt")) };
}
function saveToken(token) {
  const f = path.join(ROOT, "config", "github-token.txt");
  fs.mkdirSync(path.dirname(f), { recursive: true });
  if (!String(token || "").trim()) { if (fs.existsSync(f)) fs.unlinkSync(f); }
  else fs.writeFileSync(f, String(token).trim());
  updateCache = null;
  return { tokenSet: !!String(token || "").trim() };
}
// copy the new version in, then hand over to restart-after-update.ps1 (new helper + redeploy of the page) and exit
function applyUpdate(tag) {
  if (updateJob?.state === "running") throw new Error("กำลังอัปเดตอยู่");
  if (job?.state === "running" || imgJob?.state === "running" || launch?.state === "running") throw new Error("มีงาน build หรือสลับแอปค้างอยู่ รอให้เสร็จก่อน");
  if (!/^v?\d+\.\d+\.\d+$/.test(String(tag || ""))) throw new Error("เวอร์ชันไม่ถูกต้อง");
  const j = updateJob = runPs(UPDATE_SCRIPT, ["-Apply", String(tag)]);
  j.done.then(() => {
    log(`update ${tag}: ${j.state}\n${j.lines.join("\n")}`);
    if (j.state !== "done") return;
    // a plain detached child dies with this process when the helper runs inside a Windows job (it usually does),
    // so restart-after-update.ps1 is created through WMI (Win32_Process.Create): same user and session, outside the job
    const cmdline = `powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "${path.join(ROOT, "restart-after-update.ps1")}"`;
    const ps = `$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = '${cmdline.replace(/'/g, "''")}'; CurrentDirectory = '${ROOT.replace(/'/g, "''")}' }; exit $r.ReturnValue`;
    const c = spawn("powershell.exe", ["-NoProfile", "-Command", ps], { stdio: "ignore", windowsHide: true });
    const bye = code => { log(`restart-after-update started (WMI result ${code})`); setTimeout(() => process.exit(0), 1000); };
    c.on("exit", bye); c.on("error", () => bye("error"));   // the page keeps polling and reloads once the new version answers
  });
  return view(j);
}

// remove an app that is no longer used: its profile, env, saved tests and remembered state (not its image)
async function deleteApp(name) {
  checkName(name);
  if (!fs.existsSync(path.join(APPS, `${name}.json`))) throw new Error("ไม่มีแอป " + name);
  if ((await runningApp()) === name) throw new Error(`${name} ลงสนามอยู่ สลับไปแอปอื่นหรือปิดหน้าต่างก่อนค่อยลบ`);
  const removed = [];
  for (const f of [path.join(APPS, `${name}.json`), path.join(APPS, `${name}.env`), path.join(APPS, `${name}.tests.json`), path.join(ROOT, "config", "state", `${name}.json`)]) {
    if (fs.existsSync(f)) { fs.unlinkSync(f); removed.push(path.relative(ROOT, f)); }
  }
  const cur = path.join(ROOT, "config", "current-app.txt");
  try { if (fs.readFileSync(cur, "utf8").trim() === name) fs.unlinkSync(cur); } catch { /* none */ }
  log(`deleted app ${name}: ${removed.join(", ")}`);
  return { name, removed };
}

const readEnv = name => { checkName(name); try { return fs.readFileSync(path.join(APPS, `${name}.env`), "utf8"); } catch { return ""; } };

// saved tests per app: apps\<name>.tests.json = [{ name, mode, ...fields }]
const testsFile = app => path.join(APPS, `${checkName(app)}.tests.json`);
const readTests = app => readJsonFile(testsFile(app), []);
function saveTest(app, t) {
  if (!t || !String(t.name || "").trim()) throw new Error("ตั้งชื่อชุดทดสอบก่อน");
  const name = String(t.name).trim().slice(0, 60);
  const list = readTests(app).filter(x => x.name !== name);
  list.push({ ...t, name, savedAt: new Date().toISOString() });
  list.sort((a, b) => a.name.localeCompare(b.name));
  fs.writeFileSync(testsFile(app), JSON.stringify(list, null, 2) + "\n");
  return list;
}
function deleteTest(app, name) {
  const list = readTests(app).filter(x => x.name !== name);
  fs.writeFileSync(testsFile(app), JSON.stringify(list, null, 2) + "\n");
  return list;
}
const SPLASH = fs.readFileSync(path.join(HERE, "launch.html"));

// ---------- 2. lifecycle (same rules as Hyperion API) ----------
// Is a browser window titled "...Replica Lab..." still open? Edge freezes minimised pages, so silence alone
// does not mean the window was closed.
const FIND = `
Add-Type @'
using System; using System.Text; using System.Collections.Generic; using System.Runtime.InteropServices;
public static class ReplicaLabWin {
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  public static uint[] Find(string part) {
    var found = new List<uint>();
    EnumWindows((h, l) => {
      if (IsWindowVisible(h)) {
        var sb = new StringBuilder(512); GetWindowText(h, sb, 512);
        if (sb.ToString().Contains(part)) { uint pid; GetWindowThreadProcessId(h, out pid); found.Add(pid); }
      }
      return true;
    }, IntPtr.Zero);
    return found.ToArray();
  }
}
'@
$browsers = 'msedge', 'chrome', 'firefox', 'brave', 'opera', 'vivaldi'
$open = [ReplicaLabWin]::Find('${TITLE}') | Where-Object { $browsers -contains (Get-Process -Id $_ -ErrorAction SilentlyContinue).ProcessName }
if ($open) { '1' } else { '0' }
`;
const windowOpen = () => new Promise(resolve =>
  execFile("powershell", ["-NoProfile", "-NonInteractive", "-Command", FIND], { windowsHide: true, timeout: 20000 },
           (e, out) => resolve(e ? true : String(out).trim() === "1")));   // unsure -> keep running

const pages = new Map();     // page id -> last ping
let hadPage = false, byeTimer = null, checking = false, nextCheck = 0, lastTick = Date.now(), stopping = false;
function dropSilent() { const now = Date.now(); for (const [p, t] of pages) if (now - t > 90000) pages.delete(p); }
function ping(p) { if (p) { pages.set(p, Date.now()); hadPage = true; } clearTimeout(byeTimer); byeTimer = null; }
// Opening / switching an app restarts the page service, so a reload can take longer than a few seconds:
// no stop while that runs and for a minute after it.
const busyLaunching = () => launch?.state === "running" || (launch?.endedAt && Date.now() - Date.parse(launch.endedAt) < 60000);
function bye(p) {
  if (p) pages.delete(p);
  clearTimeout(byeTimer);
  byeTimer = setTimeout(async () => {      // a reload is back within ~1 s
    byeTimer = null; dropSilent();
    if (pages.size || stopping) return;
    if (busyLaunching()) return void bye();                       // look again later
    if (await windowOpen()) { log("bye, but a Replica Lab window is still open: keep running"); return; }   // 90 s silence rule still applies
    if (!pages.size) lastClosed("window closed");
  }, 4000);
}
setInterval(async () => {
  const now = Date.now();
  const slept = now - lastTick > 45000;          // PC was asleep: give pages a fresh 90 s
  lastTick = now;
  if (slept) return void pages.forEach((_, p) => pages.set(p, now));
  dropSilent();
  if (pages.size || !hadPage || byeTimer || checking || stopping || now < nextCheck) return;
  checking = true;
  const open = await windowOpen();
  checking = false;
  if (pages.size || byeTimer) return;
  if (!open && !busyLaunching()) return lastClosed("no window for 90 s");
  nextCheck = Date.now() + 60000;
}, 15000).unref();

async function lastClosed(why) {
  if (stopping) return;
  stopping = true;
  log(`${why}: stopping the Replica Lab stack`);
  if (job?.state === "running") { try { cancelBuild(); } catch { /* gone */ } }
  if (launch?.state === "running") await launch.done;   // closed while starting: let the deploy finish, then remove it cleanly
  const s = runPs(STOP_SCRIPT, ["-KeepHelper"]);
  await s.done;
  log(s.lines.join("\n"));
  log("stopped, helper exits");
  process.exit(0);
}

// ---------- 3. build ----------
let job = null;
function lastRepo() { try { return fs.readFileSync(LAST_REPO, "utf8").trim(); } catch { return ""; } }
function git(repo, args) {
  try { return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", timeout: 10000, windowsHide: true }).trim(); } catch { return ""; }
}
// the remembered repo plus every worktree of it (IntelliJ issue worktrees live under .claude\worktrees)
function repos() {
  const last = lastRepo();
  const list = [];
  if (last && fs.existsSync(path.join(last, "pom.xml"))) {
    let cur = null;
    for (const line of git(last, ["worktree", "list", "--porcelain"]).split(/\r?\n/)) {
      if (line.startsWith("worktree ")) { cur = { path: path.normalize(line.slice(9)), branch: "" }; list.push(cur); }
      else if (line.startsWith("branch ") && cur) cur.branch = line.slice(7).replace("refs/heads/", "");
      else if (line === "detached" && cur) cur.branch = "(detached)";
    }
  }
  const usable = list.filter(w => fs.existsSync(path.join(w.path, "pom.xml")));
  for (const w of usable) w.changed = git(w.path, ["status", "--porcelain"]).split(/\r?\n/).filter(Boolean).length;
  return { last, worktrees: usable };
}
function startBuild({ repo, skipMaven, apply }) {
  if (job?.state === "running") throw new Error("กำลัง build อยู่ รอให้เสร็จหรือกดยกเลิกก่อน");
  repo = String(repo || "").trim().replace(/^"|"$/g, "");
  if (!repo || !fs.existsSync(path.join(repo, "pom.xml"))) throw new Error("ไม่พบ pom.xml ใน " + (repo || "(ว่าง)"));
  const args = ["-Repo", repo];
  if (skipMaven) args.push("-SkipMaven");
  if (!apply) args.push("-NoApply");
  job = Object.assign(runPs(BUILD_SCRIPT, args), { repo, skipMaven: !!skipMaven, apply: !!apply });
  return job;
}
function cancelBuild() {
  if (job?.state !== "running" || !job.pid) throw new Error("ไม่มี build ที่กำลังทำงาน");
  job.state = "cancelled";
  try { execFileSync("taskkill", ["/PID", String(job.pid), "/T", "/F"], { windowsHide: true }); } catch { /* already gone */ }
  return job;
}

// ---------- HTTP ----------
function send(res, origin, code, obj) {
  const body = Buffer.from(JSON.stringify(obj));
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Content-Length": body.length, "Cache-Control": "no-store",
                        ...(ALLOWED.has(origin) ? { "Access-Control-Allow-Origin": origin, "Vary": "Origin" } : {}) });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let s = "";
    req.on("data", c => { s += c; if (s.length > 2e5) req.destroy(); });
    req.on("end", () => resolve(s));
    req.on("error", reject);
  });
}
const parse = s => { try { return s ? JSON.parse(s) : {}; } catch { throw new Error("bad json"); } };

// Replica Lab pages only: the :18090 page (CORS origin) or the launch page itself (same-origin requests carry
// no Origin header on GET, only Sec-Fetch-Site)
const fromLab = req => ALLOWED.has(req.headers.origin || "") || (!req.headers.origin && req.headers["sec-fetch-site"] === "same-origin");

http.createServer(async (req, res) => {
  const origin = req.headers.origin || "";
  const url = new URL(req.url, "http://x");
  try {
    // the launch page itself: opened directly by start.cmd as the app window
    if (req.method === "GET" && (url.pathname === "/launch" || url.pathname === "/")) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      return res.end(SPLASH);
    }
    if (req.method === "OPTIONS") {
      if (!ALLOWED.has(origin)) { res.writeHead(403); return res.end(); }
      res.writeHead(204, { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "GET, POST",
                           "Access-Control-Allow-Headers": "Content-Type, X-Replica-Lab", "Access-Control-Max-Age": "600", "Vary": "Origin" });
      return res.end();
    }
    // ping / bye: plain requests (bye comes from sendBeacon on close, which cannot add headers); origin must still match
    if (url.pathname === "/ping" || url.pathname === "/bye") {
      if (!fromLab(req)) return send(res, origin, 403, { error: "forbidden" });
      const p = url.searchParams.get("p") || (req.method === "POST" ? (parse(await readBody(req)).p || "") : "");
      if (url.pathname === "/ping") ping(p); else bye(p);
      return send(res, origin, 200, { ok: true });
    }
    // everything else: only the Replica Lab pages (they send this header; a plain cross-site form cannot)
    if (!fromLab(req) || req.headers["x-replica-lab"] !== "1") return send(res, origin, 403, { error: "forbidden" });
    if (req.method === "GET" && url.pathname === "/health") return send(res, origin, 200, { ok: true, building: job?.state === "running", pages: pages.size });
    if (req.method === "GET" && url.pathname === "/launch/status") return send(res, origin, 200, await launchStatus());
    if (req.method === "POST" && url.pathname === "/launch/start") return send(res, origin, 202, await startLaunch());
    if (req.method === "GET" && url.pathname === "/apps") return send(res, origin, 200, await listApps());
    if (req.method === "GET" && url.pathname === "/apps/env") return send(res, origin, 200, { env: readEnv(url.searchParams.get("name")) });
    if (req.method === "POST" && url.pathname === "/apps/save") return send(res, origin, 200, { profile: await saveApp(parse(await readBody(req))) });
    if (req.method === "POST" && url.pathname === "/apps/switch") { const b = parse(await readBody(req)); return send(res, origin, 202, switchApp(checkName(b.name), !!b.tune)); }
    if (req.method === "GET" && url.pathname === "/about") return send(res, origin, 200, await about());
    if (req.method === "GET" && url.pathname === "/update/check") return send(res, origin, 200, await checkUpdate(url.searchParams.get("force") === "1"));
    if (req.method === "POST" && url.pathname === "/update/apply") return send(res, origin, 202, applyUpdate(parse(await readBody(req)).tag));
    if (req.method === "GET" && url.pathname === "/update/status") return send(res, origin, 200, view(updateJob) || {});
    if (req.method === "POST" && url.pathname === "/update/token") return send(res, origin, 200, saveToken(parse(await readBody(req)).token));
    if (req.method === "GET" && url.pathname === "/folder/recent") return send(res, origin, 200, recentFolders());
    if (req.method === "POST" && url.pathname === "/folder/inspect") return send(res, origin, 200, inspectFolder(parse(await readBody(req)).dir));
    if (req.method === "POST" && url.pathname === "/folder/build") return send(res, origin, 202, imgView(startImageBuild(parse(await readBody(req)))));
    if (req.method === "GET" && url.pathname === "/folder/build") return send(res, origin, 200, imgView(imgJob) || {});
    if (req.method === "POST" && url.pathname === "/folder/cancel") return send(res, origin, 200, imgView(cancelImageBuild()));
    if (req.method === "POST" && url.pathname === "/app/force-image") return send(res, origin, 200, await forceImage(String(parse(await readBody(req)).tag || "")));
    if (req.method === "POST" && url.pathname === "/apps/delete") return send(res, origin, 200, await deleteApp(String(parse(await readBody(req)).name || "")));
    if (req.method === "GET" && url.pathname === "/images") return send(res, origin, 200, await localImages());
    if (req.method === "GET" && url.pathname === "/swarm/services") return send(res, origin, 200, await swarmServices());
    if (req.method === "POST" && url.pathname === "/swarm/attach") { const b = parse(await readBody(req)); return send(res, origin, 202, await attachService(String(b.name || ""), false)); }
    if (req.method === "POST" && url.pathname === "/swarm/import") return send(res, origin, 200, await importService(String(parse(await readBody(req)).name || "")));
    if (req.method === "POST" && url.pathname === "/detect") return send(res, origin, 200, await detect(String(parse(await readBody(req)).image || "")));
    if (req.method === "GET" && url.pathname === "/tests") return send(res, origin, 200, readTests(url.searchParams.get("app")));
    if (req.method === "POST" && url.pathname === "/tests/save") { const b = parse(await readBody(req)); return send(res, origin, 200, saveTest(b.app, b.test)); }
    if (req.method === "POST" && url.pathname === "/tests/delete") { const b = parse(await readBody(req)); return send(res, origin, 200, deleteTest(b.app, b.name)); }
    if (req.method === "GET" && url.pathname === "/repos") return send(res, origin, 200, repos());
    if (req.method === "GET" && url.pathname === "/build") return send(res, origin, 200, view(job) || {});
    if (req.method === "POST" && url.pathname === "/build") return send(res, origin, 202, view(startBuild(parse(await readBody(req)))));
    if (req.method === "POST" && url.pathname === "/cancel") return send(res, origin, 200, view(cancelBuild()));
    send(res, origin, 404, { error: "not found" });
  } catch (e) {
    send(res, origin, e instanceof FieldError ? 409 : 400, { error: e.message, ...(e.fields ? { fields: e.fields } : {}) });
  }
}).listen(PORT, "127.0.0.1", () => log(`Replica Lab helper on http://127.0.0.1:${PORT}`))
  .on("error", e => { console.error(e.message); process.exit(e.code === "EADDRINUSE" ? 0 : 1); });

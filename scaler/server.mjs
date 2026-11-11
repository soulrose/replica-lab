// Scaler: scale one Swarm service up/down and show each replica's state.
// No dependencies. Talks to the Docker API over /var/run/docker.sock and to each replica over the
// stack's overlay network (task IPs), so it must run inside the swarm (see stack.yml).
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SERVICE = process.env.TARGET_SERVICE || "replicalab_app";
// the app running now (apps\<name>.json, passed in by run-local.ps1 through stack.yml)
const APP = {
  name: process.env.APP_NAME || "ramaservice",
  kind: process.env.APP_KIND || "spring",                 // spring = actuator probes + metrics; anything else = plain HTTP health
  health: process.env.APP_HEALTH || "/actuator/health/liveness",
  test: process.env.APP_TEST || "graphql",                // default test mode on the page: graphql | http
  buildLocal: process.env.APP_BUILD_LOCAL === "true",     // ramaservice: build-local panel
  memoryMb: Number(process.env.APP_MEMORY || 0) || null,
  // a swarm service that was already running (not made by Replica Lab): the page controls it in place
  attached: process.env.APP_ATTACHED === "true",
};
const IS_SPRING = APP.kind === "spring";
const TARGET_PORT = Number(process.env.TARGET_PORT || 8080);
const MAX = Number(process.env.SCALER_MAX || 5);
const PORT = Number(process.env.PORT || 8090);
const SOCKET = process.env.DOCKER_SOCKET || "/var/run/docker.sock";
const LOAD_PATH = IS_SPRING ? "/actuator/info" : APP.health;   // the path the load test hits (counted per replica on Spring apps)
const HERE = path.dirname(fileURLToPath(import.meta.url));
const INDEX = fs.readFileSync(path.join(HERE, "public", "index.html"));

// ---------- Docker API ----------
function docker(method, p, body) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    const req = http.request({
      socketPath: SOCKET, method, path: p,
      headers: data ? { "Content-Type": "application/json", "Content-Length": data.length } : {},
    }, res => {
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let json = null;
        try { json = text ? JSON.parse(text) : null; } catch { /* not json */ }
        if (res.statusCode >= 400) reject(new Error(json?.message || text || `docker ${res.statusCode}`));
        else resolve(json);
      });
    });
    req.setTimeout(10000, () => req.destroy(new Error("docker API timeout")));
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

const enc = o => encodeURIComponent(JSON.stringify(o));

async function inspectService() {
  return docker("GET", `/services/${encodeURIComponent(SERVICE)}`);
}

const LAST_LABEL = "rama.scaler.last-replicas";   // remembered on the service itself, so it survives a scaler restart

async function updateSpec(change) {
  const svc = await inspectService();
  const spec = svc.Spec;
  if (!spec.Mode?.Replicated) throw new Error("service is not in replicated mode");
  change(spec);
  await docker("POST", `/services/${svc.ID}/update?version=${svc.Version.Index}`, spec);
  return spec;
}

async function scale(replicas) {
  await updateSpec(spec => { spec.Mode.Replicated.Replicas = replicas; });
  return replicas;
}

async function stop() {
  const spec = await updateSpec(spec => {
    const cur = spec.Mode.Replicated.Replicas;
    if (cur > 0) spec.Labels = { ...(spec.Labels || {}), [LAST_LABEL]: String(cur) };
    spec.Mode.Replicated.Replicas = 0;
  });
  return Number(spec.Labels?.[LAST_LABEL] || 0);
}

async function start() {
  let n = 0;
  await updateSpec(spec => {
    n = Math.min(MAX, Math.max(1, Number(spec.Labels?.[LAST_LABEL]) || 2));
    if (spec.Mode.Replicated.Replicas === 0) spec.Mode.Replicated.Replicas = n;
    else n = spec.Mode.Replicated.Replicas;
  });
  return n;
}

// ---------- pull from Harbor (any project/repo/tag), in the background ----------
const HARBOR = process.env.HARBOR_HOST || "harbor.rama.mahidol.ac.th";
const pulledImages = new Set();          // shown in the image list even when the repo is not "ramaservice"
let pullJob = null;                      // { image, state: pulling|done|error, message, layers, layersDone, apply, startedAt }

function normalizeRef(input) {
  let ref = String(input || "").trim();
  if (!ref) throw new Error("ใส่ชื่อ image");
  if (!ref.startsWith(HARBOR + "/")) ref = HARBOR + "/" + ref.replace(/^\/+/, "");
  const last = ref.slice(ref.lastIndexOf("/") + 1);
  if (!last.includes(":")) ref += ":latest";
  if (!/^[a-z0-9.-]+\/[a-z0-9._/-]+:[A-Za-z0-9._-]{1,128}$/.test(ref)) throw new Error("ชื่อ image ไม่ถูกต้อง: " + ref);
  return ref;
}

function startPull(input, apply) {
  if (pullJob?.state === "pulling") throw new Error("กำลัง pull " + pullJob.image + " อยู่");
  const ref = normalizeRef(input);
  const i = ref.lastIndexOf(":");
  const job = pullJob = { image: ref, state: "pulling", message: "เริ่ม pull", layers: 0, layersDone: 0, apply: !!apply, startedAt: new Date().toISOString() };
  const req = http.request({ socketPath: SOCKET, method: "POST",
    path: `/images/create?fromImage=${encodeURIComponent(ref.slice(0, i))}&tag=${encodeURIComponent(ref.slice(i + 1))}` }, res => {
    const layers = new Map();
    let buf = "", failed = null;
    res.on("data", c => {
      buf += c;
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
        if (!line) continue;
        let ev; try { ev = JSON.parse(line); } catch { continue; }
        if (ev.error || ev.errorDetail) failed = ev.error || ev.errorDetail.message;
        if (res.statusCode >= 400 && ev.message) failed = ev.message;
        if (ev.id && ev.status && /^[0-9a-f]{12}$/.test(ev.id)) layers.set(ev.id, /Pull complete|Already exists/.test(ev.status));
        if (ev.status && !ev.id) job.message = ev.status;
        job.layers = layers.size; job.layersDone = [...layers.values()].filter(Boolean).length;
      }
    });
    res.on("end", async () => {
      if (res.statusCode >= 400 || failed) {
        let msg = failed;
        if (!msg) { try { msg = JSON.parse(buf).message; } catch { msg = buf || `HTTP ${res.statusCode}`; } }
        Object.assign(job, { state: "error", message: msg });
        return;
      }
      pulledImages.add(ref);
      if (job.apply) {
        try { await setImage(ref); Object.assign(job, { state: "done", message: "pull เสร็จ และสั่งเปลี่ยน image แล้ว" }); }
        catch (e) { Object.assign(job, { state: "error", message: "pull เสร็จ แต่เปลี่ยน image ไม่ได้: " + e.message }); }
      } else Object.assign(job, { state: "done", message: "pull เสร็จ" });
    });
  });
  req.on("error", e => Object.assign(job, { state: "error", message: e.message }));
  req.end();
  return job;
}

// local images of the running app: same repository as the running image, or a repository named like the app
async function images() {
  const list = await docker("GET", "/images/json");
  let running = null;
  try { running = (await inspectService()).Spec.TaskTemplate.ContainerSpec.Image.split("@")[0]; } catch { /* service gone */ }
  const runningRepo = running ? running.slice(0, running.lastIndexOf(":")) : null;
  const out = [];
  for (const img of list) {
    for (const tag of img.RepoTags || []) {
      const repo = tag.slice(0, tag.lastIndexOf(":"));
      const appRepo = new RegExp("(^|/)" + APP.name.replace(/[^a-z0-9._-]/gi, "") + "$", "i");
      if (appRepo.test(repo) || repo === runningRepo || pulledImages.has(tag) || tag === running) out.push({ image: tag, created: new Date(img.Created * 1000).toISOString(), sizeMb: Math.round(img.Size / 1048576) });
    }
  }
  return out.sort((a, b) => b.created.localeCompare(a.created));
}

// Port the service is called on from this PC (the published port). Docker Desktop keeps routing the old port
// when a running service's published port is updated, so the service is removed and created again with the
// same spec (stack labels included, so `docker stack` still owns it). Replicas restart.
let portChanging = false;
async function setPort(port) {
  if (APP.attached) throw new Error("service นี้ไม่ได้สร้างจาก Replica Lab เปลี่ยน port ที่ตัว service เอง (docker service update --publish-add)");
  if (portChanging) throw new Error("กำลังเปลี่ยน port อยู่");
  const services = await docker("GET", "/services");
  const svc = services.find(s => s.Spec.Name === SERVICE);
  if (!svc) throw new Error("service not found: " + SERVICE);
  const taken = services.filter(s => s.ID !== svc.ID).flatMap(s => (s.Endpoint?.Ports || []).map(p => [p.PublishedPort, s.Spec.Name]));
  const clash = taken.find(([p]) => p === port);
  if (clash) throw new Error(`port ${port} ถูก ${clash[1]} ใช้อยู่`);
  const spec = svc.Spec;
  const ports = spec.EndpointSpec?.Ports || [];
  if (!ports.length) throw new Error("service has no published port");
  if (ports[0].PublishedPort === port) return port;
  ports[0].PublishedPort = port;
  portChanging = true;
  try {
    await docker("DELETE", `/services/${svc.ID}`);
    // the name is free again once the old service is gone; retry for a few seconds
    for (let i = 0; ; i++) {
      try { await docker("POST", "/services/create", spec); break; }
      catch (e) { if (i >= 20) throw new Error("ลบ service แล้วแต่สร้างใหม่ไม่ได้: " + e.message + " (รัน start.cmd เพื่อสร้างกลับ)"); await new Promise(ok => setTimeout(ok, 1000)); }
    }
  } finally { portChanging = false; }
  return port;
}

async function localImage(ref) {
  try { return await docker("GET", `/images/${encodeURIComponent(ref)}/json`); } catch { return null; }
}

async function setImage(image) {
  if (!(await localImage(image))) throw new Error("image not found on this machine: " + image);
  // rolling update, one replica at a time, start-first (update_config in stack.yml)
  await updateSpec(spec => { spec.TaskTemplate.ContainerSpec.Image = image; });
  return image;
}

// ---------- replica probes ----------
function get(ip, p, timeoutMs = 2500) {
  return new Promise(resolve => {
    const t0 = Date.now();
    const req = http.request({ host: ip, port: TARGET_PORT, path: p, method: "GET", agent: false }, res => {
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => {
        let json = null;
        try { json = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { /* ignore */ }
        resolve({ status: res.statusCode, json, ms: Date.now() - t0 });
      });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error("timeout")));
    req.on("error", e => resolve({ status: 0, error: e.message, ms: Date.now() - t0 }));
    req.end();
  });
}

function metric(r) {
  const m = r.json?.measurements;
  if (!Array.isArray(m)) return null;
  const pick = m.find(x => x.statistic === "COUNT") || m.find(x => x.statistic === "VALUE") || m[0];
  return pick ? pick.value : null;
}

async function loadCount(ip) {
  if (!IS_SPRING) return null;                  // no request metrics outside Spring Boot
  const r = await get(ip, `/actuator/metrics/http.server.requests?tag=uri:${encodeURIComponent(LOAD_PATH)}`);
  if (r.status === 404) return 0;               // no request on that path yet
  return metric(r);
}

async function probe(ip) {
  if (!ip) return { reachable: false };
  if (!IS_SPRING) {
    const h = await get(ip, APP.health, 4000);
    const ok = h.status >= 200 && h.status < 400;
    return { reachable: h.status > 0, liveness: ok ? "UP" : (h.status ? `HTTP ${h.status}` : h.error), readiness: null,
             latencyMs: h.ms, heapMb: null, loadRequests: null };
  }
  const [live, ready, heap, reqs] = await Promise.all([
    get(ip, "/actuator/health/liveness"),
    get(ip, "/actuator/health/readiness"),
    get(ip, "/actuator/metrics/jvm.memory.used?tag=area:heap"),
    loadCount(ip),
  ]);
  return {
    reachable: live.status > 0,
    liveness: live.json?.status || (live.status ? `HTTP ${live.status}` : live.error),
    readiness: ready.json?.status || (ready.status ? `HTTP ${ready.status}` : ready.error),
    latencyMs: live.ms,
    heapMb: metric(heap) != null ? Math.round(metric(heap) / 1048576) : null,
    loadRequests: reqs,
  };
}

function taskIp(task, networkIds) {
  for (const na of task.NetworksAttachments || []) {
    if (networkIds.has(na.Network?.ID) && na.Addresses?.length) return na.Addresses[0].split("/")[0];
  }
  return null;
}

async function containerHealth(id) {
  if (!id) return null;
  try {
    const c = await docker("GET", `/containers/${id}/json`);
    return { health: c.State?.Health?.Status || null, failingStreak: c.State?.Health?.FailingStreak ?? null,
             oomKilled: c.State?.OOMKilled || false, exitCode: c.State?.ExitCode ?? null };
  } catch {
    return null;                                  // container lives on another node
  }
}

// memory the container uses right now (MB, page cache excluded); one-shot = no 1 s sampling wait
async function containerMem(id) {
  if (!id) return null;
  try {
    const s = await docker("GET", `/containers/${id}/stats?stream=false&one-shot=true`);
    const used = (s.memory_stats?.usage || 0) - (s.memory_stats?.stats?.inactive_file || 0);
    return used > 0 ? Math.round(used / 1048576) : null;
  } catch { return null; }
}

let nodeMemMb = null;   // memory Docker can use on this node, read once
async function nodeMemory() {
  if (nodeMemMb == null) {
    try { nodeMemMb = Math.round((await docker("GET", "/info")).MemTotal / 1048576); } catch { /* try again next time */ }
  }
  return nodeMemMb;
}

async function status() {
  const svc = await inspectService();
  const spec = svc.Spec;
  const desired = spec.Mode?.Replicated?.Replicas ?? null;
  const networkIds = new Set((spec.TaskTemplate.Networks || []).map(n => n.Target));
  const tasks = await docker("GET", `/tasks?filters=${enc({ service: [SERVICE] })}`);
  // newest task per slot that should run, plus recently finished ones for context
  tasks.sort((a, b) => Date.parse(b.UpdatedAt) - Date.parse(a.UpdatedAt));
  const running = tasks.filter(t => t.DesiredState === "running");
  const recent = tasks.filter(t => t.DesiredState !== "running").slice(0, 8);

  const replicas = await Promise.all(running.map(async t => {
    const ip = taskIp(t, networkIds);
    const cid = t.Status?.ContainerStatus?.ContainerID;
    const isRunning = t.Status?.State === "running";
    const [c, p, memMb] = await Promise.all([containerHealth(cid), isRunning ? probe(ip) : { reachable: false }, isRunning ? containerMem(cid) : null]);
    return {
      slot: t.Slot, taskId: t.ID.slice(0, 12), node: t.NodeID?.slice(0, 12), state: t.Status?.State,
      message: t.Status?.Err || t.Status?.Message, since: t.Status?.Timestamp, created: t.CreatedAt,
      ip, containerId: cid?.slice(0, 12), container: c, memMb, ...p,
    };
  }));
  replicas.sort((a, b) => a.slot - b.slot);

  const healthy = replicas.filter(r => r.state === "running" && (r.container?.health ?? "healthy") === "healthy").length;
  return {
    service: SERVICE, app: APP, version: process.env.RL_VERSION || "dev", image: spec.TaskTemplate.ContainerSpec.Image.split("@")[0], desired, healthy,
    max: MAX, lastReplicas: Number(spec.Labels?.[LAST_LABEL]) || null, updateStatus: svc.UpdateStatus || null,
    nodeMemMb: await nodeMemory(),
    unitLimitMb: spec.TaskTemplate.Resources?.Limits?.MemoryBytes ? Math.round(spec.TaskTemplate.Resources.Limits.MemoryBytes / 1048576) : null,
    publishedPorts: (svc.Endpoint?.Ports || []).map(p => `${p.PublishedPort}->${p.TargetPort}`),
    replicas,
    recent: recent.map(t => ({ slot: t.Slot, taskId: t.ID.slice(0, 12), state: t.Status?.State,
                               desired: t.DesiredState, message: t.Status?.Err || t.Status?.Message, at: t.UpdatedAt,
                               containerId: t.Status?.ContainerStatus?.ContainerID?.slice(0, 12) || null })),
    now: new Date().toISOString(),
  };
}

// ---------- load test through the service VIP ----------
let loadRunning = false;

function hitVip(host) {
  return new Promise(resolve => {
    const t0 = Date.now();
    // agent:false = a new TCP connection per request, so the IPVS round-robin can pick a new replica each time
    const req = http.request({ host, port: TARGET_PORT, path: LOAD_PATH, agent: false, headers: { Connection: "close" } }, res => {
      res.resume();
      res.on("end", () => resolve({ ok: res.statusCode < 500, ms: Date.now() - t0 }));
    });
    req.setTimeout(10000, () => req.destroy(new Error("timeout")));
    req.on("error", () => resolve({ ok: false, ms: Date.now() - t0 }));
    req.end();
  });
}

async function loadTest(count, concurrency) {
  const st = await status();
  const targets = st.replicas.filter(r => r.ip && r.state === "running");
  const before = Object.fromEntries(await Promise.all(targets.map(async r => [r.slot, await loadCount(r.ip)])));
  // our own stack: its network alias ("app"); an attached service: its full name (resolves on every network it shares with us)
  const vip = APP.attached ? SERVICE : SERVICE.replace(/^[^_]+_/, "");
  const results = [];
  let next = 0;
  const t0 = Date.now();
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (next < count) { next++; results.push(await hitVip(vip)); }
  }));
  const elapsed = Date.now() - t0;
  const after = Object.fromEntries(await Promise.all(targets.map(async r => [r.slot, await loadCount(r.ip)])));
  const lat = results.map(r => r.ms).sort((a, b) => a - b);
  return {
    sent: results.length, ok: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length,
    elapsedMs: elapsed, rps: Math.round(results.length / (elapsed / 1000)),
    p50: lat[Math.floor(lat.length * 0.5)] ?? null, p95: lat[Math.floor(lat.length * 0.95)] ?? null,
    perReplica: targets.map(r => ({ slot: r.slot, taskId: r.taskId,
      handled: after[r.slot] != null && before[r.slot] != null ? after[r.slot] - before[r.slot] : null })),
  };
}

// ---------- duplicate test: the same GraphQL mutation sent at once, spread over the replicas ----------
function post(ip, p, body, headers, timeoutMs = 30000, method = "POST") {
  return new Promise(resolve => {
    const data = Buffer.from(body || "");
    const t0 = Date.now();
    const req = http.request({ host: ip, port: TARGET_PORT, path: p, method, agent: false,
      headers: { ...(data.length ? { "Content-Type": "application/json", "Content-Length": data.length } : {}), ...headers } }, res => {
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let json = null;
        try { json = JSON.parse(text); } catch { /* not json */ }
        resolve({ status: res.statusCode, json, text: json ? null : text.slice(0, 300), ms: Date.now() - t0 });
      });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error("timeout")));
    req.on("error", e => resolve({ status: 0, error: e.message, ms: Date.now() - t0 }));
    if (data.length) req.write(data);
    req.end();
  });
}

// first scalar "id"-like field under data.<mutation>
function resultId(json) {
  const d = json?.data;
  if (!d) return null;
  const v = Object.values(d)[0];
  if (v == null || typeof v !== "object") return v ?? null;
  for (const k of ["id", "mrn", "uuid"]) if (v[k] != null) return String(v[k]);
  return JSON.stringify(v).slice(0, 80);
}

// value at a dot path ("id", "data.id", "items.0.code") of a JSON answer
function pathValue(json, p) {
  let v = json;
  for (const k of String(p).split(".").filter(Boolean)) { if (v == null) return null; v = v[k]; }
  return v == null ? null : (typeof v === "object" ? JSON.stringify(v).slice(0, 80) : String(v));
}
function httpResultId(res, idPath) {
  if (res.json) {
    if (idPath) return pathValue(res.json, idPath);
    for (const k of ["id", "data.id", "result.id", "uuid"]) { const v = pathValue(res.json, k); if (v != null) return v; }
    return JSON.stringify(res.json).slice(0, 80);
  }
  return res.text ? res.text.trim().slice(0, 80) || null : null;
}

async function dupTest({ mode, query, variables, method, path: reqPath, headers: extraHeaders, body: rawBody, idPath, copies, keyMode, delayMs }) {
  const st = await status();
  const targets = st.replicas.filter(r => r.ip && r.state === "running" && (r.container?.health ?? "healthy") === "healthy");
  if (!targets.length) throw new Error("no healthy replica");
  const runTag = Math.random().toString(36).slice(2, 8).toUpperCase();
  // {{run}} = one value per test run (same in every copy), so each run starts from fresh data
  const fill = s => s.split("{{run}}").join(runTag);
  const http1 = mode === "http";
  const body = http1 ? (rawBody ? fill(String(rawBody)) : "")
                     : JSON.stringify({ query: fill(query), variables: JSON.parse(fill(JSON.stringify(variables || {}))) });
  const target = http1 ? fill(String(reqPath || "/")) : "/graphql";
  const verb = http1 ? String(method || "POST").toUpperCase() : "POST";
  const baseHeaders = http1 && extraHeaders && typeof extraHeaders === "object" ? JSON.parse(fill(JSON.stringify(extraHeaders))) : {};
  const sharedKey = `swarm-dup-${runTag}`;
  const t0 = Date.now();
  const results = await Promise.all(Array.from({ length: copies }, async (_, i) => {
    const r = targets[i % targets.length];     // copy i goes straight to replica i mod N
    if (delayMs) await new Promise(ok => setTimeout(ok, i * delayMs));
    const headers = { ...baseHeaders, ...(keyMode === "same" ? { "Idempotency-Key": sharedKey }
                  : keyMode === "unique" ? { "Idempotency-Key": `${sharedKey}-${i}` } : {}) };
    const res = await post(r.ip, target, body, headers, 60000, verb);
    const id = http1 ? (res.status >= 200 && res.status < 300 ? httpResultId(res, idPath) : null) : resultId(res.json);
    const errors = http1 ? (res.status >= 300 || !res.status ? (res.error || `HTTP ${res.status} ${(res.text || JSON.stringify(res.json || "")).slice(0, 160)}`) : null)
                         : (res.json?.errors?.map(e => e.message).join("; ") || res.error || res.text || null);
    return { copy: i + 1, slot: r.slot, taskId: r.taskId, status: res.status, ms: res.ms, id, errors,
             startedAt: Date.now() - t0 - res.ms };
  }));
  const ids = [...new Set(results.filter(r => r.id != null).map(r => r.id))];
  return { runTag, mode: http1 ? "http" : "graphql", replicas: targets.length, copies, keyMode, uniqueIds: ids, results,
           image: st.image, elapsedMs: Date.now() - t0 };
}

// ---------- GraphQL schema of the running image (introspection), for the mutation picker ----------
// graphql-java "good faith" introspection allows __Type.fields / inputFields once per query, so one types list holds everything
const INTROSPECTION = `query {
  __schema {
    mutationType { name }
    types { kind name fields { name description args { name defaultValue type { ...T } } type { ...T } } inputFields { name defaultValue type { ...T } } enumValues { name } }
  }
}
fragment T on __Type { kind name ofType { kind name ofType { kind name ofType { kind name ofType { kind name } } } } }`;
let schemaCache = { image: null, data: null };

async function schema(refresh) {
  const st = await status();
  if (!refresh && schemaCache.image === st.image && schemaCache.data) return schemaCache.data;
  const r = st.replicas.find(x => x.ip && x.state === "running" && (x.container?.health ?? "healthy") === "healthy");
  if (!r) throw new Error("ยังไม่มี replica ที่พร้อม อ่าน schema ไม่ได้");
  const res = await post(r.ip, "/graphql", JSON.stringify({ query: INTROSPECTION }), {}, 30000);
  const s = res.json?.data?.__schema;
  if (!s) throw new Error("อ่าน schema ไม่ได้: " + (res.json?.errors?.[0]?.message || res.error || `HTTP ${res.status}`));
  const types = {};
  for (const t of s.types) {
    if (t.name.startsWith("__") || !["INPUT_OBJECT", "OBJECT", "ENUM"].includes(t.kind)) continue;
    types[t.name] = { kind: t.kind, inputFields: t.inputFields || undefined, fields: t.fields?.map(f => ({ name: f.name, type: f.type })) || undefined,
                      enumValues: t.enumValues?.map(e => e.name) || undefined };
  }
  const mt = s.types.find(t => t.name === s.mutationType?.name);
  const data = { image: st.image, readAt: new Date().toISOString(), mutations: mt?.fields || [], types };
  schemaCache = { image: st.image, data };
  return data;
}

// ---------- logs of one replica (its container) ----------
// Docker multiplexes stdout/stderr for non-TTY containers: 8-byte header (stream, 0, 0, 0, size BE) + payload.
function demux(buf) {
  const out = [];
  let i = 0;
  while (i + 8 <= buf.length && (buf[i] === 1 || buf[i] === 2) && buf[i + 1] === 0 && buf[i + 2] === 0 && buf[i + 3] === 0) {
    const n = buf.readUInt32BE(i + 4);
    out.push(buf.subarray(i + 8, i + 8 + n));
    i += 8 + n;
  }
  if (i === 0) return buf.toString("utf8");          // TTY container: raw text
  return Buffer.concat(out).toString("utf8");
}

function containerLogs(id, tail) {
  return new Promise((resolve, reject) => {
    const req = http.request({ socketPath: SOCKET, method: "GET",
      path: `/containers/${id}/logs?stdout=1&stderr=1&tail=${tail}` }, res => {
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => {
        const buf = Buffer.concat(chunks);
        if (res.statusCode >= 400) {
          let m; try { m = JSON.parse(buf.toString("utf8")).message; } catch { m = `HTTP ${res.statusCode}`; }
          return reject(new Error(m));
        }
        resolve(demux(buf));
      });
    });
    req.setTimeout(15000, () => req.destroy(new Error("docker logs timeout")));
    req.on("error", reject);
    req.end();
  });
}

async function replicaLogs(id, tail) {
  if (!/^[0-9a-f]{12,64}$/.test(id)) throw new Error("bad container id");
  const c = await docker("GET", `/containers/${id}/json`).catch(() => null);
  if (!c) throw new Error("ไม่พบ container (อาจถูกลบไปแล้ว หรืออยู่เครื่องอื่น)");
  if (c.Config?.Labels?.["com.docker.swarm.service.name"] !== SERVICE) throw new Error("container นี้ไม่ใช่ของ " + SERVICE);
  const text = await containerLogs(id, tail);
  return { containerId: id, slot: Number(c.Config.Labels["com.docker.swarm.task.name"]?.split(".")[1]) || null,
           task: c.Config.Labels["com.docker.swarm.task.name"], state: c.State?.Status, text };
}

// ---------- HTTP ----------
function send(res, code, obj) {
  const body = Buffer.from(JSON.stringify(obj));
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Content-Length": body.length, "Cache-Control": "no-store" });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let s = "";
    req.on("data", c => { s += c; if (s.length > 1e5) req.destroy(); });
    req.on("end", () => { try { resolve(s ? JSON.parse(s) : {}); } catch { reject(new Error("bad json")); } });
  });
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  try {
    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      return res.end(INDEX);
    }
    if (req.method === "GET" && url.pathname === "/api/status") return send(res, 200, await status());
    if (req.method === "POST" && url.pathname === "/api/scale") {
      const { replicas } = await readJson(req);
      const n = Number(replicas);
      if (!Number.isInteger(n) || n < 0 || n > MAX) return send(res, 400, { error: `replicas must be 0..${MAX}` });
      await scale(n);
      return send(res, 200, { replicas: n });
    }
    if (req.method === "POST" && url.pathname === "/api/stop") return send(res, 200, { stopped: true, remembered: await stop() });
    if (req.method === "POST" && url.pathname === "/api/start") return send(res, 200, { replicas: await start() });
    if (req.method === "GET" && url.pathname === "/api/images") return send(res, 200, await images());
    if (req.method === "POST" && url.pathname === "/api/image") {
      const { image } = await readJson(req);
      return send(res, 200, { image: await setImage(String(image || "")) });
    }
    if (req.method === "GET" && url.pathname === "/api/schema") {
      try { return send(res, 200, await schema(url.searchParams.get("refresh") === "1")); } catch (e) { return send(res, 503, { error: e.message }); }
    }
    if (req.method === "GET" && url.pathname === "/api/logs") {
      const tail = Math.min(Math.max(Number(url.searchParams.get("tail")) || 300, 10), 20000);
      try {
        const r = await replicaLogs(String(url.searchParams.get("container") || ""), tail);
        if (url.searchParams.get("format") === "text") {
          res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
          return res.end(r.text);
        }
        return send(res, 200, r);
      } catch (e) { return send(res, 400, { error: e.message }); }
    }
    if (req.method === "POST" && url.pathname === "/api/port") {
      const p = Number((await readJson(req)).port);
      if (!Number.isInteger(p) || p < 1024 || p > 65535) return send(res, 400, { error: "port ต้องอยู่ระหว่าง 1024-65535" });
      try { return send(res, 200, { port: await setPort(p) }); } catch (e) { return send(res, 400, { error: e.message }); }
    }
    if (req.method === "POST" && url.pathname === "/api/pull") {
      const b = await readJson(req);
      try { return send(res, 202, startPull(b.image, b.apply)); } catch (e) { return send(res, 400, { error: e.message }); }
    }
    if (req.method === "GET" && url.pathname === "/api/pull") return send(res, 200, pullJob || {});
    if (req.method === "POST" && url.pathname === "/api/dup") {
      const b = await readJson(req);
      const mode = b.mode === "http" ? "http" : "graphql";
      if (mode === "graphql" && !b.query) return send(res, 400, { error: "query is required" });
      if (mode === "http" && !String(b.path || "").startsWith("/")) return send(res, 400, { error: "path ต้องขึ้นต้นด้วย /" });
      const copies = Math.min(Math.max(Number(b.copies) || 4, 2), 50);
      const keyMode = ["none", "same", "unique"].includes(b.keyMode) ? b.keyMode : "none";
      return send(res, 200, await dupTest({ mode, query: b.query, variables: b.variables, method: b.method, path: b.path,
                                            headers: b.headers, body: b.body, idPath: b.idPath, copies, keyMode,
                                            delayMs: Math.min(Math.max(Number(b.delayMs) || 0, 0), 120000) }));
    }
    if (req.method === "POST" && url.pathname === "/api/load") {
      if (loadRunning) return send(res, 409, { error: "a load test is already running" });
      const b = await readJson(req);
      const count = Math.min(Math.max(Number(b.count) || 200, 1), 5000);
      const conc = Math.min(Math.max(Number(b.concurrency) || 10, 1), 50);
      loadRunning = true;
      try { return send(res, 200, await loadTest(count, conc)); } finally { loadRunning = false; }
    }
    send(res, 404, { error: "not found" });
  } catch (e) {
    send(res, 500, { error: e.message });
  }
}).listen(PORT, () => console.log(`scaler on :${PORT} -> ${SERVICE} (max ${MAX})`));

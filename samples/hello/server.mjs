// Sample app: shows which replica answered, and keeps its orders in memory on purpose.
// POST /orders honours Idempotency-Key, but only within one replica: send the same key to several replicas and each
// makes its own order. The duplicate test of Replica Lab is meant to fail here; a database unique key would fix it.
import http from "node:http";
import os from "node:os";
import { randomUUID } from "node:crypto";

const HOST = os.hostname();
const orders = new Map();      // Idempotency-Key -> order (this replica only)
let served = 0;

const json = (res, code, body) => { res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(body)); };

const server = http.createServer((req, res) => {
  const { pathname } = new URL(req.url, "http://x");
  if (pathname === "/health") return json(res, 200, { status: "UP" });
  served++;
  console.log(new Date().toISOString(), "INFO", req.method, pathname, "replica", HOST, "request", served);
  if (pathname === "/orders" && req.method === "POST") {
    req.resume();
    return req.on("end", () => {
      const key = req.headers["idempotency-key"] || randomUUID();
      if (!orders.has(key)) {
        if (orders.size >= 10000) orders.delete(orders.keys().next().value);
        orders.set(key, { id: randomUUID().slice(0, 8), replica: HOST });
      }
      json(res, 200, orders.get(key));
    });
  }
  if (pathname === "/") return json(res, 200, { replica: HOST, served });
  json(res, 404, { error: "not found" });
});
server.listen(8080, () => console.log(new Date().toISOString(), "INFO listening on 8080, replica", HOST));
for (const s of ["SIGTERM", "SIGINT"]) process.on(s, () => { server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 3000).unref(); });

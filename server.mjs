// server.mjs — async job API around the Showrunner. No deps. Run: node --env-file=.env server.mjs
import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { showrun } from "./agent/showrun.mjs";

const PORT = process.env.PORT || 8787;
const jobs = new Map(); // id -> { status, log, finalPath, ... }

const json = (res, code, obj) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); };
async function body(req) { const c = []; for await (const x of req) c.push(x); try { return JSON.parse(Buffer.concat(c).toString() || "{}"); } catch { return {}; } }

function startJob(logline, scenes) {
  const id = randomUUID().slice(0, 8);
  const job = { id, status: "running", log: [], logline, scenes, title: null, finalPath: null, error: null, created: Date.now() };
  jobs.set(id, job);
  showrun(logline, { scenes, outDir: path.join("output/jobs", id), log: (m) => job.log.push(String(m)) })
    .then((r) => { job.status = "done"; job.finalPath = r.finalPath; job.title = r.title; })
    .catch((e) => { job.status = "error"; job.error = e.message; });
  return job;
}

const server = createServer(async (req, res) => {
  const { pathname } = new URL(req.url, "http://localhost");
  const p = pathname.split("/").filter(Boolean);

  if (req.method === "GET" && p.length === 0)
    return json(res, 200, { service: "qwen-showrunner", endpoints: ["POST /showrun {logline,scenes}", "GET /jobs/:id", "GET /jobs/:id/film"], active: jobs.size });

  if (req.method === "POST" && p[0] === "showrun") {
    const { logline, scenes = 3 } = await body(req);
    if (!logline) return json(res, 400, { error: "logline required" });
    const job = startJob(logline, Math.max(1, Math.min(5, Number(scenes) || 3)));
    return json(res, 202, { jobId: job.id, status: job.status, poll: `/jobs/${job.id}` });
  }

  if (req.method === "GET" && p[0] === "jobs" && p[1]) {
    const job = jobs.get(p[1]);
    if (!job) return json(res, 404, { error: "no such job" });
    if (p[2] === "film") {
      if (job.status !== "done" || !job.finalPath || !existsSync(job.finalPath)) return json(res, 409, { status: job.status });
      res.writeHead(200, { "Content-Type": "video/mp4", "Content-Length": statSync(job.finalPath).size });
      return createReadStream(job.finalPath).pipe(res);
    }
    return json(res, 200, { id: job.id, status: job.status, title: job.title, logline: job.logline, scenes: job.scenes, error: job.error, log: job.log.slice(-50), film: job.status === "done" ? `/jobs/${job.id}/film` : null });
  }

  json(res, 404, { error: "not found" });
});

server.listen(PORT, () => console.log(`Showrunner API on http://0.0.0.0:${PORT}`));

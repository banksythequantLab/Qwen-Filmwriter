// server.mjs — Filmwriter web app + async job API. No deps. node --env-file=.env server.mjs
import { createServer } from "node:http";
import { createReadStream, existsSync, statSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { showrun } from "./agent/showrun.mjs";

const PORT = process.env.PORT || 8787;
const ROOT = process.cwd();
const jobs = new Map();

// Pre-rendered showcase films (so the hosted site is alive even when live render is paused).
const GALLERY = [
  { id: "neon-melancholia", title: "Neon Melancholia", tag: "long-take", file: "output/longtake_demo/final.mp4" },
  { id: "dreams-of-neon",   title: "Dreams of Neon",   tag: "continuity", file: "output/continuity_film/final.mp4" },
  { id: "dreams-montage",   title: "Dreams of Neon (montage)", tag: "montage", file: "output/film/final.mp4" },
];

const json = (res, code, obj) => { res.writeHead(code, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }); res.end(JSON.stringify(obj)); };
async function body(req) { const c = []; for await (const x of req) c.push(x); try { return JSON.parse(Buffer.concat(c).toString() || "{}"); } catch { return {}; } }
function streamMp4(req, res, file) {
  const size = statSync(file).size;
  const head = { "Content-Type": "video/mp4", "Accept-Ranges": "bytes", "Cache-Control": "no-cache" };
  const range = req.headers.range;
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range) || [];
    const start = m[1] ? parseInt(m[1], 10) : 0;
    const end = m[2] ? parseInt(m[2], 10) : size - 1;
    res.writeHead(206, { ...head, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": end - start + 1 });
    if (req.method === "HEAD") return res.end();
    return createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { ...head, "Content-Length": size });
  if (req.method === "HEAD") return res.end();
  createReadStream(file).pipe(res);
}
function startJob(input, { source = "logline", scenes = 3, maxScenes = 24 } = {}) {
  const id = randomUUID().slice(0, 8);
  const preview = source === "chapter" ? input.replace(/\s+/g, " ").slice(0, 140) + "…" : input;
  const job = { id, status: "running", log: [], input: preview, source, scenes, title: null, finalPath: null, error: null, panels: {}, created: Date.now() };
  jobs.set(id, job);
  const onEvent = (e) => { if (e && e.id) job.panels[e.id] = { ...(job.panels[e.id] || {}), ...e }; };
  showrun(input, { source, scenes, maxScenes, outDir: path.join("output/jobs", id), log: (m) => job.log.push(String(m)), onEvent })
    .then((r) => { job.status = "done"; job.finalPath = r.finalPath; job.title = r.title; })
    .catch((e) => { job.status = "error"; job.error = e.message; });
  return job;
}

const server = createServer(async (req, res) => {
  const { pathname } = new URL(req.url, "http://localhost");
  const p = pathname.split("/").filter(Boolean);

  if (req.method === "GET" && p.length === 0) {
    const f = path.join(ROOT, "public", "index.html");
    if (existsSync(f)) { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); return res.end(readFileSync(f)); }
    return json(res, 200, { service: "filmwriter" });
  }
  if (req.method === "GET" && p[0] === "api")
    return json(res, 200, { service: "filmwriter", endpoints: ["POST /showrun", "GET /jobs/:id", "GET /jobs/:id/film", "GET /gallery", "GET /gallery/:id/film"], active: jobs.size });

  if (req.method === "GET" && p[0] === "gallery" && !p[1])
    return json(res, 200, { films: GALLERY.filter(g => existsSync(path.join(ROOT, g.file))).map(g => ({ id: g.id, title: g.title, tag: g.tag, film: `/gallery/${g.id}/film` })) });
  if ((req.method === "GET" || req.method === "HEAD") && p[0] === "gallery" && p[1] && p[2] === "film") {
    const g = GALLERY.find(x => x.id === p[1]); const f = g && path.join(ROOT, g.file);
    if (!f || !existsSync(f)) return json(res, 404, { error: "no such film" });
    return streamMp4(req, res, f);
  }

  if (req.method === "POST" && p[0] === "showrun") {
    const { logline, chapter, scenes = 3, maxScenes = 24 } = await body(req);
    const input = (chapter && String(chapter).trim()) || logline;
    if (!input) return json(res, 400, { error: "logline or chapter required" });
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Number(v) || lo));
    const isChapter = !!(chapter && String(chapter).trim());
    const job = startJob(input, {
      source: isChapter ? "chapter" : "logline",
      scenes: clamp(scenes, 1, 12),
      maxScenes: clamp(maxScenes, 2, 80),
    });
    return json(res, 202, { jobId: job.id, status: job.status, poll: `/jobs/${job.id}` });
  }
  if (req.method === "GET" && p[0] === "jobs" && p[1]) {
    const job = jobs.get(p[1]);
    if (!job) return json(res, 404, { error: "no such job" });
    if (p[2] === "film") {
      if (job.status !== "done" || !job.finalPath || !existsSync(job.finalPath)) return json(res, 409, { status: job.status });
      return streamMp4(req, res, job.finalPath);
    }
    return json(res, 200, { id: job.id, status: job.status, title: job.title, input: job.input, source: job.source, scenes: job.scenes, error: job.error, log: job.log.slice(-80), panels: Object.values(job.panels), film: job.status === "done" ? `/jobs/${job.id}/film` : null });
  }
  json(res, 404, { error: "not found" });
});
server.listen(PORT, () => console.log(`Filmwriter web on http://0.0.0.0:${PORT}`));

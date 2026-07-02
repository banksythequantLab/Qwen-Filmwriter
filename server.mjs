// server.mjs — Filmwriter web app + async job API. No deps. node --env-file=.env server.mjs
import { createServer } from "node:http";
import { createReadStream, existsSync, statSync, readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { showrun } from "./agent/showrun.mjs";

const PORT = process.env.PORT || 8787;
const ROOT = process.cwd();
const jobs = new Map();

// The /gallery handler already auto-discovers every finished film in output/jobs
// with its real title, so this curated fallback stays empty to avoid duplicate
// cards; add entries only for showcase films that live outside output/jobs.
const GALLERY = [];

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
function startJob(input, { source = "logline", scenes = 3, maxScenes = 24, aspect = "16:9", season = "" } = {}) {
  const id = randomUUID().slice(0, 8);
  const preview = source === "chapter" ? input.replace(/\s+/g, " ").slice(0, 140) + "…" : input;
  const job = { id, status: "running", log: [], input: preview, source, scenes, aspect, season: season || null, title: null, finalPath: null, error: null, kpi: null, dimensions: null, panels: {}, created: Date.now() };
  jobs.set(id, job);
  const onEvent = (e) => { if (e && e.id) job.panels[e.id] = { ...(job.panels[e.id] || {}), ...e }; };
  showrun(input, { source, scenes, maxScenes, aspect, season, outDir: path.join("output/jobs", id), log: (m) => job.log.push(String(m)), onEvent })
    .then((r) => { job.status = "done"; job.finalPath = r.finalPath; job.title = r.title; job.kpi = r.kpi ?? null; job.dimensions = (r.evaluation && r.evaluation.dimensions) || null; job.identity_split = (r.evaluation && r.evaluation.identity_split) || null; })
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
  if (req.method === "GET" && p[0] === "landing") {
    const f = path.join(ROOT, "landing", "index.html");
    if (existsSync(f)) { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); return res.end(readFileSync(f)); }
    return json(res, 404, { error: "no landing" });
  }
  if (req.method === "GET" && p[0] === "api")
    return json(res, 200, { service: "filmwriter", endpoints: ["POST /showrun", "GET /jobs/:id", "GET /jobs/:id/film", "GET /gallery", "GET /gallery/:id/film"], active: jobs.size });

  if (req.method === "GET" && p[0] === "gallery" && !p[1]) {
    let made = [];
    try {
      const base = path.join(ROOT, "output/jobs");
      made = readdirSync(base)
        .map(id => ({ id, mp4: path.join(base, id, "final.mp4") }))
        .filter(x => existsSync(x.mp4))
        .map(x => {
          let title = "Generated film";
          try { title = JSON.parse(readFileSync(path.join(base, x.id, "storyboard.json"), "utf8")).plan?.title || title; } catch {}
          return { id: x.id, title, tag: "Just generated", film: `/made/${x.id}/film`, mtime: statSync(x.mp4).mtimeMs, ...(() => { try { const e = JSON.parse(readFileSync(path.join(base, x.id, "evaluation.json"), "utf8")); return { kpi: e.score ?? null, dimensions: e.dimensions || null, identity_split: e.identity_split || null }; } catch { return { kpi: null, dimensions: null, identity_split: null }; } })() };
        })
        .sort((a, b) => b.mtime - a.mtime)
        .map(({ mtime, ...rest }) => rest);
    } catch {}
    const seed = GALLERY.filter(g => existsSync(path.join(ROOT, g.file))).map(g => ({ id: g.id, title: g.title, tag: g.tag, film: `/gallery/${g.id}/film` }));
    return json(res, 200, { films: [...made, ...seed] });
  }
  if ((req.method === "GET" || req.method === "HEAD") && p[0] === "gallery" && p[1] && p[2] === "film") {
    const g = GALLERY.find(x => x.id === p[1]); const f = g && path.join(ROOT, g.file);
    if (!f || !existsSync(f)) return json(res, 404, { error: "no such film" });
    return streamMp4(req, res, f);
  }
  if ((req.method === "GET" || req.method === "HEAD") && p[0] === "made" && p[1] && p[2] === "film") {
    const f = path.join(ROOT, "output/jobs", path.basename(p[1]), "final.mp4");
    if (!existsSync(f)) return json(res, 404, { error: "no such film" });
    return streamMp4(req, res, f);
  }
  if ((req.method === "GET" || req.method === "HEAD") && p[0] === "hero.mp4") {
    const f = path.join(ROOT, "public", "hero.mp4");
    if (!existsSync(f)) return json(res, 404, { error: "no hero" });
    return streamMp4(req, res, f);
  }
  if ((req.method === "GET" || req.method === "HEAD") && p[0] === "hero.jpg") {
    const f = path.join(ROOT, "public", "hero.jpg");
    if (!existsSync(f)) return json(res, 404, { error: "no poster" });
    res.writeHead(200, { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=86400" });
    if (req.method === "HEAD") return res.end();
    return createReadStream(f).pipe(res);
  }
  if ((req.method === "GET" || req.method === "HEAD") && p[0] === "crew" && p[1]) {
    const f = path.join(ROOT, "public", "crew", path.basename(p[1]));
    if (!existsSync(f)) return json(res, 404, { error: "no avatar" });
    res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" });
    if (req.method === "HEAD") return res.end();
    return createReadStream(f).pipe(res);
  }

  if (req.method === "POST" && p[0] === "showrun") {
    const { logline, chapter, scenes = 3, maxScenes = 24, aspect = "16:9", season = "" } = await body(req);
    const input = (chapter && String(chapter).trim()) || logline;
    if (!input) return json(res, 400, { error: "logline or chapter required" });
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Number(v) || lo));
    const ASPECTS = ["16:9", "9:16", "1:1", "4:3", "3:4"];
    const isChapter = !!(chapter && String(chapter).trim());
    const job = startJob(input, {
      source: isChapter ? "chapter" : "logline",
      scenes: clamp(scenes, 1, 25),
      maxScenes: clamp(maxScenes, 1, 25),
      aspect: ASPECTS.includes(aspect) ? aspect : "16:9",
      season: String(season || "").slice(0, 40),
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
    return json(res, 200, { id: job.id, status: job.status, title: job.title, input: job.input, source: job.source, scenes: job.scenes, kpi: job.kpi, dimensions: job.dimensions, identity_split: job.identity_split || null, error: job.error, log: job.log.slice(-300), panels: Object.values(job.panels), film: job.status === "done" ? `/jobs/${job.id}/film` : null });
  }
  json(res, 404, { error: "not found" });
});
server.listen(PORT, () => console.log(`Filmwriter web on http://0.0.0.0:${PORT}`));

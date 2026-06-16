// probe_video.mjs — find a Wan video model that still has free-tier quota.
// Safe: "free tier only" mode means an exhausted model 403s (free), never charges.
import { image } from "./lib/qwen.mjs";

const KEY = process.env.QWEN_API_KEY;
const NATIVE = "https://dashscope-intl.aliyuncs.com/api/v1";

async function submit(model, input, parameters) {
  const r = await fetch(`${NATIVE}/services/aigc/video-generation/video-synthesis`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", "X-DashScope-Async": "enable" },
    body: JSON.stringify({ model, input, parameters }),
  });
  const j = await r.json();
  return { ok: r.ok, status: r.status, code: j.code, msg: (j.message || "").slice(0, 80), task: j.output?.task_id };
}
async function poll(task) {
  for (let i = 0; i < 60; i++) {
    await new Promise(s => setTimeout(s, 5000));
    const r = await fetch(`${NATIVE}/tasks/${task}`, { headers: { Authorization: `Bearer ${KEY}` } });
    const j = await r.json();
    const st = j.output?.task_status;
    if (st === "SUCCEEDED") return { st, url: j.output.video_url };
    if (st === "FAILED" || st === "UNKNOWN") return { st, err: JSON.stringify(j.output).slice(0, 120) };
  }
  return { st: "TIMEOUT" };
}
const label = r => r.task ? "✅ AVAILABLE (free-tier OK)" :
  /FreeTierOnly/.test(r.code || "") ? "⛔ free tier exhausted" :
  /Model|InvalidParameter|not.?exist|NotFound/i.test((r.code || "") + r.msg) ? `❓ ${r.code} (bad id?)` :
  `⚠️ ${r.status} ${r.code}`;

console.log("→ generating one still for i2v probes...");
let stillUrl = null;
try { stillUrl = (await image("a lone figure on a neon-lit rooftop at night, cinematic", { size: "1664*928" })).url; console.log("   still:", stillUrl ? "ok" : "none"); }
catch (e) { console.log("   still failed:", e.message.slice(0, 80)); }

const I2V = ["wan2.2-i2v-flash", "wan2.2-i2v-plus", "wanx2.1-i2v-turbo", "wan2.5-i2v-preview"];
const T2V = ["wan2.2-t2v-plus", "wanx2.1-t2v-turbo", "wan2.5-t2v-preview"];
const winner = { i2v: null, t2v: null };

if (stillUrl) {
  console.log("\n=== I2V candidates ===");
  for (const m of I2V) {
    const r = await submit(m, { prompt: "slow cinematic push-in", img_url: stillUrl }, { resolution: "720P", duration: 5, watermark: false });
    console.log(`  ${m.padEnd(20)} ${label(r)}`);
    if (r.task) { console.log(`     polling ${r.task} ...`); const p = await poll(r.task); console.log(`     -> ${p.st}${p.url ? " " + p.url.slice(0, 60) : ""}${p.err ? " " + p.err : ""}`); if (p.st === "SUCCEEDED") { winner.i2v = m; break; } }
  }
}
console.log("\n=== T2V candidates ===");
for (const m of T2V) {
  const r = await submit(m, { prompt: "a neon city skyline at night, slow aerial drift, cinematic" }, { size: "1280*720", duration: 5, watermark: false });
  console.log(`  ${m.padEnd(20)} ${label(r)}`);
  if (r.task) { console.log(`     polling ${r.task} ...`); const p = await poll(r.task); console.log(`     -> ${p.st}${p.url ? " " + p.url.slice(0, 60) : ""}${p.err ? " " + p.err : ""}`); if (p.st === "SUCCEEDED") { winner.t2v = m; break; } }
}
console.log("\n=== RESULT ===");
console.log("i2v winner:", winner.i2v || "none free");
console.log("t2v winner:", winner.t2v || "none free");

// t2v_test.mjs — smallest possible Wan video smoke test. Submit -> poll -> print MP4 url.
// Run: node --env-file=.env t2v_test.mjs
const KEY = process.env.QWEN_API_KEY;
// Native DashScope task API lives at /api/v1 (NOT the compatible-mode path)
const NATIVE = (process.env.QWEN_BASE_URL || "https://dashscope-intl.aliyuncs.com/compatible-mode/v1")
  .replace(/\/compatible-mode\/v1\/?$/, "/api/v1");

const submitHeaders = {
  Authorization: `Bearer ${KEY}`,
  "Content-Type": "application/json",
  "X-DashScope-Async": "enable",
};

console.log("native base:", NATIVE);

// 1) Submit task
let taskId;
try {
  const r = await fetch(`${NATIVE}/services/aigc/video-generation/video-synthesis`, {
    method: "POST",
    headers: submitHeaders,
    body: JSON.stringify({
      model: "wan2.2-t2v-plus",
      input: { prompt: "A neon-lit, rain-slicked city street at night, camera slowly pushes forward, cyberpunk mood, reflections on wet pavement." },
      parameters: { size: "832*480", prompt_extend: true, watermark: true },
    }),
  });
  const j = await r.json();
  if (!r.ok || !j.output?.task_id) {
    console.error(`x submit failed (${r.status}):`, JSON.stringify(j));
    process.exit(1);
  }
  taskId = j.output.task_id;
  console.log(`OK submitted. task_id=${taskId}  status=${j.output.task_status}`);
} catch (e) {
  console.error("x submit error:", e.message);
  process.exit(1);
}

// 2) Poll
const pollHeaders = { Authorization: `Bearer ${KEY}` };
const started = Date.now();
let last = "";
for (let i = 0; i < 40; i++) {
  await new Promise((s) => setTimeout(s, 9000));
  const r = await fetch(`${NATIVE}/tasks/${taskId}`, { headers: pollHeaders });
  const j = await r.json();
  const st = j.output?.task_status || `HTTP ${r.status}`;
  const secs = Math.round((Date.now() - started) / 1000);
  if (st !== last) { console.log(`  [${secs}s] ${st}`); last = st; }
  if (st === "SUCCEEDED") {
    console.log("\nVIDEO URL:", j.output.video_url);
    console.log("(expires in 24h — download promptly)");
    process.exit(0);
  }
  if (st === "FAILED" || st === "UNKNOWN") {
    console.error("\nx task failed:", JSON.stringify(j.output));
    process.exit(1);
  }
}
console.error("x timed out waiting (still running). task_id:", taskId);

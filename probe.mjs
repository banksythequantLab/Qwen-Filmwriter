// probe.mjs — validate Qwen Cloud access + enumerate models for the Showrunner stack.
// Run:  node --env-file=.env probe.mjs    (no npm install — uses built-in fetch)

const BASE = process.env.QWEN_BASE_URL || "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";
const KEY  = process.env.QWEN_API_KEY;

if (!KEY || KEY.startsWith("PASTE")) {
  console.error("x No API key. Edit .env and set QWEN_API_KEY to your Qwen Cloud key.");
  process.exit(1);
}
const h = { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

// 1) Enumerate models (ground truth — no guessing)
let ids = [];
try {
  const r = await fetch(`${BASE}/models`, { headers: h });
  const j = await r.json();
  if (!r.ok) throw new Error(`${r.status} ${JSON.stringify(j).slice(0, 300)}`);
  ids = (j.data || []).map((m) => m.id).sort();
  console.log(`OK auth. ${ids.length} models available.\n`);
} catch (e) {
  console.error("x /models failed:", e.message);
  process.exit(1);
}

// 2) Filter to the 5 Showrunner slots
const slots = {
  "LLM / agent brain":   /qwen3.*(max|plus|flash)|qwen-(max|plus|flash)/i,
  "Vision (continuity)": /qwen.*vl/i,
  "Image gen / edit":    /qwen.*image|wan.*(t2i|image)/i,
  "Video (T2V / I2V)":   /happyhorse|wan.*(t2v|i2v|video)|wanx/i,
  "TTS (voice)":         /cosyvoice|qwen.*tts|sambert/i,
};
for (const [name, rx] of Object.entries(slots)) {
  const hits = ids.filter((m) => rx.test(m)).slice(0, 15);
  console.log(`${name}:\n  ${hits.length ? hits.join("\n  ") : "(none matched)"}\n`);
}

// 3) Cheap chat test to confirm the chat endpoint + auth end-to-end
const chatModel = ids.find((m) => /flash/i.test(m)) || ids.find((m) => /turbo/i.test(m)) || "qwen-flash";
try {
  const r = await fetch(`${BASE}/chat/completions`, {
    method: "POST", headers: h,
    body: JSON.stringify({
      model: chatModel,
      messages: [{ role: "user", content: "Reply with exactly: SHOWRUNNER ONLINE" }],
      max_tokens: 16, temperature: 0,
    }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`${r.status} ${JSON.stringify(j).slice(0, 300)}`);
  console.log(`OK chat (${chatModel}): ${j.choices?.[0]?.message?.content?.trim()}`);
  console.log(`  tokens  prompt:${j.usage?.prompt_tokens} completion:${j.usage?.completion_tokens}`);
} catch (e) {
  console.error(`x chat test failed (${chatModel}):`, e.message);
}

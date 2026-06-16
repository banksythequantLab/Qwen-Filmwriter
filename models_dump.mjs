// models_dump.mjs — write ALL model ids to models.txt for reference/grep.
const BASE = process.env.QWEN_BASE_URL;
const KEY = process.env.QWEN_API_KEY;
import { writeFileSync } from "node:fs";
const r = await fetch(`${BASE}/models`, { headers: { Authorization: `Bearer ${KEY}` } });
const j = await r.json();
const ids = (j.data || []).map((m) => m.id).sort();
writeFileSync("models.txt", ids.join("\n"));
// surface anything plausibly video/animation related that a narrow regex might miss
const vid = ids.filter((m) => /video|wan|happy|horse|kling|vidu|veo|anim|motion|t2v|i2v|synth/i.test(m));
console.log(`total:${ids.length}  wrote models.txt`);
console.log("video-ish:", vid.length ? vid.join(", ") : "(none)");

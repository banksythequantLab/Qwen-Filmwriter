// lib/qwen.mjs — Qwen Cloud client for the Showrunner. Dependency-free (Node 18+ fetch).
// Two transports:
//   COMPAT  = OpenAI-compatible  -> chat(), see()        [/compatible-mode/v1]
//   NATIVE  = DashScope native   -> image(), video(), speak()  [/api/v1]
import { writeFileSync } from "node:fs";

const KEY = process.env.QWEN_API_KEY;
if (!KEY) throw new Error("QWEN_API_KEY not set (run with: node --env-file=.env ...)");

const COMPAT = process.env.QWEN_BASE_URL || "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";
const NATIVE = COMPAT.replace(/\/compatible-mode\/v1\/?$/, "/api/v1");
const authJson = { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

// Retrying fetch: backs off on 429 (rate limit) and 5xx so bounded parallelism self-heals.
const sleep = (ms) => new Promise((s) => setTimeout(s, ms));
async function rfetch(url, opts, { tries = 5, base = 1500 } = {}) {
  for (let a = 1; ; a++) {
    let r;
    try { r = await fetch(url, opts); }
    catch (e) { if (a >= tries) throw e; await sleep(base * 2 ** (a - 1) + Math.random() * 400); continue; }
    if (r.status !== 429 && r.status < 500) return r;
    if (a >= tries) return r;
    await sleep(base * 2 ** (a - 1) + Math.random() * 400);
  }
}

// ---------- OpenAI-compatible: text + vision ----------
export async function chat(messages, { model = "qwen-plus", temperature = 0.7, max_tokens = 2048, ...rest } = {}) {
  const r = await rfetch(`${COMPAT}/chat/completions`, {
    method: "POST", headers: authJson,
    body: JSON.stringify({ model, messages, temperature, max_tokens, ...rest }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`chat ${r.status}: ${JSON.stringify(j).slice(0, 300)}`);
  return { text: j.choices?.[0]?.message?.content ?? "", usage: j.usage, raw: j };
}

// Vision: image URL(s) or data URI(s) + a prompt -> text analysis (continuity QA).
export async function see(images, prompt, { model = "qwen3-vl-plus", ...rest } = {}) {
  const imgs = (Array.isArray(images) ? images : [images]).map((u) => ({ type: "image_url", image_url: { url: u } }));
  return chat([{ role: "user", content: [...imgs, { type: "text", text: prompt }] }], { model, ...rest });
}

// ---------- DashScope native: async task helper (image + video) ----------
async function submitTask(service, model, input, parameters = {}) {
  const r = await rfetch(`${NATIVE}/services/aigc/${service}`, {
    method: "POST",
    headers: { ...authJson, "X-DashScope-Async": "enable" },
    body: JSON.stringify({ model, input, parameters }),
  });
  const j = await r.json();
  if (!r.ok || !j.output?.task_id) throw new Error(`submit ${service} ${r.status}: ${JSON.stringify(j).slice(0, 300)}`);
  return j.output.task_id;
}

export async function pollTask(taskId, { intervalMs = 5000, timeoutMs = 600000, onTick } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await new Promise((s) => setTimeout(s, intervalMs));
    const r = await rfetch(`${NATIVE}/tasks/${taskId}`, { headers: { Authorization: `Bearer ${KEY}` } });
    const j = await r.json();
    const st = j.output?.task_status;
    if (onTick) onTick(st, Math.round((Date.now() - start) / 1000));
    if (st === "SUCCEEDED") return j.output;
    if (st === "FAILED" || st === "UNKNOWN") throw new Error(`task ${st}: ${JSON.stringify(j.output)}`);
  }
  throw new Error(`task ${taskId} timed out`);
}

// ---------- Image (async) ----------
// qwen-image-plus: async, 5 fixed sizes (1664*928 16:9, 928*1664 9:16, 1328*1328 1:1, 1472*1104 4:3, 1104*1472 3:4)
export async function image(prompt, { model = "qwen-image-plus", size = "1664*928", negative_prompt = "text, words, letters, captions, subtitles, signage, watermark, logo, garbled text, distorted typography", prompt_extend = true, onTick } = {}) {
  const id = await submitTask("text2image/image-synthesis", model, { prompt, negative_prompt }, { size, prompt_extend, n: 1 });
  const out = await pollTask(id, { onTick });
  const url = out.results?.[0]?.url || out.results?.[0]?.image_url || out.image_url;
  return { url, raw: out };
}

// ---------- Video: t2v + i2v (async) ----------
// imageUrl => image-to-video (first frame). audioUrl => lip-synced speech. shot_type:"multi" => multi-shot.
export async function video(prompt, { model, size, resolution, imageUrl, audioUrl, duration, shot_type, prompt_extend = true, watermark = false, onTick } = {}) {
  const isI2V = !!imageUrl;
  const input = { prompt };
  if (imageUrl) input.img_url = imageUrl;
  if (audioUrl) input.audio_url = audioUrl;
  const parameters = { prompt_extend, watermark };
  if (resolution) parameters.resolution = resolution;       // wan2.6 i2v uses resolution (720P/1080P)
  else if (size) parameters.size = size;                    // wan2.6 t2v uses size (e.g. 1280*720)
  else if (isI2V) parameters.resolution = "720P";
  else parameters.size = "1280*720";
  const chosen = model || (isI2V ? (process.env.QWEN_I2V_MODEL || "wan2.6-i2v-flash") : (process.env.QWEN_T2V_MODEL || "wan2.6-t2v"));
  if (duration && /wan2\.(5|6)/.test(chosen)) parameters.duration = duration;        // custom duration only on 2.5/2.6
  if (shot_type && /wan2\.(5|6)/.test(chosen)) parameters.shot_type = shot_type;      // multi-shot only on 2.5/2.6
  const id = await submitTask("video-generation/video-synthesis", chosen, input, parameters);
  const out = await pollTask(id, { onTick });
  return { url: out.video_url, raw: out };
}

// ---------- Speech: qwen3-tts (direct, returns audio URL) ----------
// Voices: Cherry, Vivian, Serena, Ryan, Aiden, ... | language_type: English, Chinese, Japanese, ...
export async function speak(text, { model = "qwen3-tts-flash", voice = "Cherry", language_type = "English" } = {}) {
  const r = await rfetch(`${NATIVE}/services/aigc/multimodal-generation/generation`, {
    method: "POST", headers: authJson,
    body: JSON.stringify({ model, input: { text, voice, language_type } }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`tts ${r.status}: ${JSON.stringify(j).slice(0, 300)}`);
  const url = j.output?.audio?.url || j.output?.audio_url;
  return { url, raw: j };
}

// ---------- util: download a (24h-expiring) result URL to disk ----------
export async function download(url, path) {
  const r = await rfetch(url);
  if (!r.ok) throw new Error(`download ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  writeFileSync(path, buf);
  return { path, bytes: buf.length };
}

// ---------- Image edit / subject consistency (sync multimodal-generation) ----------
// images: 1-3 reference URLs or data URIs. instruction references "the reference image".
// Used to keep a character's identity consistent across shots. Returns { url }.
export async function imageEdit(images, instruction, { model = "qwen-image-edit-max", size, negative_prompt = " ", prompt_extend = true } = {}) {
  const imgs = (Array.isArray(images) ? images : [images]).map((u) => ({ image: u }));
  const parameters = { n: 1, negative_prompt, prompt_extend, watermark: false };
  if (size) parameters.size = size;
  const r = await rfetch(`${NATIVE}/services/aigc/multimodal-generation/generation`, {
    method: "POST", headers: authJson,
    body: JSON.stringify({ model, input: { messages: [{ role: "user", content: [...imgs, { text: instruction }] }] }, parameters }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`imageEdit ${r.status}: ${JSON.stringify(j).slice(0, 300)}`);
  const url = (j.output?.choices?.[0]?.message?.content || []).find((c) => c.image)?.image;
  return { url, raw: j };
}

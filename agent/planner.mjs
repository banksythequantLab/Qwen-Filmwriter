// agent/planner.mjs — Showrunner brain. Logline -> story plan (scene BEATS only).
// Shot and prompt detail are produced downstream (shotlist -> promptgen).
import { chat } from "../lib/qwen.mjs";

const SYS = `You are an autonomous film Showrunner. Turn a logline into a SHORT-FILM story plan.
Return STRICT JSON ONLY (no markdown, no prose):
{
  "title": string,
  "logline": string,
  "style": string,               // global art direction (palette, grade, lens, era) — carried downstream for consistency
  "characters": [{"name": string, "description": string, "voice": "Cherry"|"Ryan"|"Serena"|"Aiden"|"Vivian"}],
  "scenes": [{"id": number, "beat": string, "setting": string, "intent": string}]
}
Use exactly {N} scenes. Each scene is a STORY BEAT only — do NOT write shot, camera, or image details here.
Describe recurring characters consistently so downstream stages keep them visually stable.`;

export async function plan(logline, { scenes = 3, model = "qwen-max" } = {}) {
  const sys = SYS.replace("{N}", String(scenes));
  const { text, usage } = await chat(
    [{ role: "system", content: sys }, { role: "user", content: `Logline: ${logline}` }],
    { model, temperature: 0.85, max_tokens: 1500 }
  );
  return { plan: parseJson(text), usage };
}

export function parseJson(text) {
  const stripped = String(text).replace(/^```(?:json)?/i, "").replace(/```\s*$/i, "").trim();
  try { return JSON.parse(stripped); }
  catch {
    const m = stripped.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("model did not return JSON:\n" + String(text).slice(0, 300));
    return JSON.parse(m[0]);
  }
}

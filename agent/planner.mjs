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

// adapt() — turn a passage of prose (e.g. a book chapter) into an ORDERED, faithful scene plan.
// Scene count is decided from the material (up to maxScenes), not fixed. Same plan shape as plan().
const ADAPT_SYS = `You are a film director adapting a passage of prose (such as a book chapter) into a SHORT FILM.
Read the SOURCE TEXT faithfully and break it into an ORDERED sequence of SCENES that follow its narrative.
Return STRICT JSON ONLY (no markdown, no prose):
{
  "title": string,
  "logline": string,
  "style": string,
  "characters": [{"name": string, "description": string, "voice": "Cherry"|"Ryan"|"Serena"|"Aiden"|"Vivian"}],
  "scenes": [{"id": number, "beat": string, "setting": string, "intent": string}]
}
Rules:
- FAITHFUL adaptation: keep the source's characters, events, order, and mood. Do NOT invent major plot.
- Decide the NUMBER of scenes from the material: one scene per distinct beat, location change, or dramatic turn. Use as many as the passage truly needs, but NO MORE THAN {MAX}.
- Each scene is a STORY BEAT only (no shot/camera/image detail; that is produced downstream).
- Describe recurring characters consistently (look, age, clothing) so downstream stages keep them visually stable.
- Give each named character a voice from the allowed list and reuse it for that character.`;

export async function adapt(source, { maxScenes = 24, model = "qwen-plus" } = {}) {
  const sys = ADAPT_SYS.replace("{MAX}", String(maxScenes));
  const { text, usage } = await chat(
    [{ role: "system", content: sys }, { role: "user", content: `SOURCE TEXT:\n${source}` }],
    { model, temperature: 0.6, max_tokens: 12000 }
  );
  return { plan: parseJson(text), usage };
}

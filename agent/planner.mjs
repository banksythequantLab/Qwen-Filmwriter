// agent/planner.mjs — Showrunner brain. Logline -> story plan (scene BEATS only).
// Shot and prompt detail are produced downstream (shotlist -> promptgen).
import { chat } from "../lib/qwen.mjs";

const SYS = `You are a film STORY ARCHITECT. Turn a logline into a SHORT-FILM plan with a real dramatic arc.
Return STRICT JSON ONLY (no markdown, no prose):
{
  "title": string,
  "logline": string,
  "theme": string,                // the one human idea the film is really about
  "spine": string,                // the through-line as a causal chain: "X wants Y, and so... but then... therefore..."
  "narration": {"mode": "none"|"voiceover", "style": string, "voice": "Cherry"|"Ryan"|"Serena"|"Aiden"|"Vivian", "rationale": string},
  "style": string,                // global art direction (palette, grade, lens, era) — carried downstream for consistency
  "characters": [{"name": string, "description": string, "voice": "Cherry"|"Ryan"|"Serena"|"Aiden"|"Vivian"}],
  "scenes": [{"id": number, "function": "setup"|"inciting"|"rising"|"midpoint"|"complication"|"climax"|"resolution", "beat": string, "setting": string, "causal": string, "intent": string, "narration": string}]
}
Use exactly {N} scenes that form ONE escalating arc: setup, an inciting turn, rising complications, a climax, a resolution.
Each scene's "causal" states how it follows from the PREVIOUS scene using "therefore" or "but" — never a flat "and then". Stakes must rise across the film and the ending must pay off the setup.
NARRATION — decide from the film's FORM whether a voiceover narrator serves the story. Choose "voiceover" when the form is lifted by a narrator's voice: a film-noir detective tale (first person, hardboiled, past tense), a nature or expository documentary (omniscient), a memoir, fable, or storybook (reflective, intimate). Choose "none" for dialogue- or action-driven pieces where narration would merely describe what we already see. When mode is "voiceover", write each scene's "narration" as ONE short line in that voice that carries the through-line forward — never just narrate the visible action — and pick a fitting "voice". When mode is "none", set every scene "narration" to "".
Each scene is a STORY BEAT only — do NOT write shot, camera, or image details here.
Describe recurring characters consistently so downstream stages keep them visually stable.
Design ORIGINAL characters and wardrobe. Never describe a character so it reproduces or resembles a trademarked or copyrighted franchise character or costume — no superhero suits, emblems, spider/arachnid or web motifs, masks, branded logos, capes, or celebrity likeness. Keep all descriptions safe-for-work.`;

export async function plan(logline, { scenes = 3, model = "qwen-max" } = {}) {
  const sys = SYS.replace("{N}", String(scenes));
  const { text, usage } = await chat(
    [{ role: "system", content: sys }, { role: "user", content: `Logline: ${logline}` }],
    { model, temperature: 0.85, max_tokens: 2200 }
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
  "theme": string,                // the core idea the passage is really about
  "spine": string,                // the through-line as a causal chain: "X wants Y, and so... but then... therefore..."
  "narration": {"mode": "none"|"voiceover", "style": string, "voice": "Cherry"|"Ryan"|"Serena"|"Aiden"|"Vivian", "rationale": string},
  "style": string,
  "characters": [{"name": string, "description": string, "voice": "Cherry"|"Ryan"|"Serena"|"Aiden"|"Vivian"}],
  "scenes": [{"id": number, "function": "setup"|"inciting"|"rising"|"midpoint"|"complication"|"climax"|"resolution", "beat": string, "setting": string, "causal": string, "intent": string, "narration": string}]
}
Rules:
- FAITHFUL adaptation: keep the source's characters, events, order, and mood. Do NOT invent major plot.
- NARRATION: judge from the PROSE whether a voiceover narrator fits. First-person source → first-person "voiceover"; literary/descriptive third-person → omniscient "voiceover"; heavily dialogue-driven scenes → "none". When "voiceover", draw each scene's "narration" line from the passage's own narrating voice (lightly paraphrased, one short line, advancing the through-line); when "none", set every scene "narration" to "".
- Decide the NUMBER of scenes from the material: one scene per distinct beat, location change, or dramatic turn. Use as many as the passage truly needs, but NO MORE THAN {MAX}.
- Tag each scene's dramatic "function" within the passage's arc, and write "causal": how this scene follows from the previous one using "therefore" or "but" (never a flat "and then").
- Each scene is a STORY BEAT only (no shot/camera/image detail; that is produced downstream).
- Describe recurring characters consistently (look, age, clothing) so downstream stages keep them visually stable.
- Give each named character a voice from the allowed list and reuse it for that character.
- ORIGINAL VISUAL DESIGN: even when adapting copyrighted prose, render every character's LOOK as an original, generic design. Describe wardrobe in plain terms (fabric, color, cut) and NEVER use franchise-identifying or superhero-costume language — no spider/arachnid or web motifs, emblems, masks, branded logos, capes, or any trademarked character likeness. Keep all descriptions safe-for-work so they pass content moderation.`;

export async function adapt(source, { maxScenes = 24, model = "qwen-plus" } = {}) {
  const sys = ADAPT_SYS.replace("{MAX}", String(maxScenes));
  const { text, usage } = await chat(
    [{ role: "system", content: sys }, { role: "user", content: `SOURCE TEXT:\n${source}` }],
    { model, temperature: 0.6, max_tokens: 12000 }
  );
  return { plan: parseJson(text), usage };
}

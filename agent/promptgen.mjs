// agent/promptgen.mjs — prompt-engineer agent. ONE shot -> crafted image + motion prompts.
import { chat } from "../lib/qwen.mjs";
import { parseJson } from "./planner.mjs";

const SYS = `You are a prompt engineer for an AI image+video pipeline. Given the film, its style, characters, the STORY BEAT this shot belongs to, the scene setting, and ONE shot, craft precise generation prompts.
Return STRICT JSON ONLY:
{"image_prompt": string, "motion_prompt": string}
- image_prompt: a detailed still-frame prompt that FAITHFULLY depicts THIS shot as a moment inside the story beat — it must advance the narrative, not be a generic stock image. Embed the global style. Describe subject, composition and framing appropriate to the shot type, lighting, lens, and mood.
- BE CONCRETE AND UNAMBIGUOUS about key objects, vehicles, and locations named in the beat: use the exact noun (e.g. "motorcycle", never the ambiguous "bike"; "skateboard", not "board"; "sedan", not "car" when specified). NEVER substitute a different object than the story specifies.
- Keep characters visually consistent with their descriptions for continuity across shots. Do NOT request any on-screen text or signage.
- For close-up and insert shots, use a shallow depth of field with a soft, out-of-focus (bokeh) background, and keep all background signage blurred/unreadable so focus stays on the subject.
- Use the STORY SO FAR only as context so this shot connects to what came before and sets up what follows — depict only THIS shot's moment, not earlier events.
- If a recurring MOTIF is given, weave it in ONLY where it fits naturally (a background detail, a color in the grade, an object in frame) — never force it into every shot or let it dominate the subject. Skip it when it would feel contrived.
- motion_prompt: concise — what moves in the shot plus the camera move, for animating that still.`;

export async function promptgen(shot, { style, characters, setting, beat = "", intent = "", title = "", storySoFar = "", motif = "", model = "qwen-plus" } = {}) {
  const ctx = `FILM: ${title}\nSTYLE: ${style}${motif ? `\nRECURRING MOTIF: ${motif}` : ""}\nCHARACTERS: ${JSON.stringify(characters)}${storySoFar ? `\n\nSTORY SO FAR:\n${storySoFar}` : ""}\nSTORY BEAT: ${beat}${intent ? `\nBEAT INTENT: ${intent}` : ""}\nSETTING: ${setting}\nSHOT: ${JSON.stringify(shot)}`;
  const { text, usage } = await chat(
    [{ role: "system", content: SYS }, { role: "user", content: ctx }],
    { model, temperature: 0.8, max_tokens: 600 }
  );
  const o = parseJson(text);
  return { image_prompt: o.image_prompt, motion_prompt: o.motion_prompt, usage };
}

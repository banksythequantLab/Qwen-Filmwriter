// agent/promptgen.mjs — prompt-engineer agent. ONE shot -> crafted image + motion prompts.
import { chat } from "../lib/qwen.mjs";
import { parseJson } from "./planner.mjs";

const SYS = `You are a prompt engineer for an AI image+video pipeline. Given the film style, characters, scene setting, and ONE shot, craft precise generation prompts.
Return STRICT JSON ONLY:
{"image_prompt": string, "motion_prompt": string}
- image_prompt: a detailed still-frame prompt. Embed the global style. Describe subject, composition and framing appropriate to the shot type, lighting, lens, and mood. Keep characters visually consistent with their descriptions. Do NOT request any on-screen text or signage.
- For close-up and insert shots, use a shallow depth of field with a soft, out-of-focus (bokeh) background, and keep all background signage blurred/unreadable so focus stays on the subject.
- motion_prompt: concise — what moves in the shot plus the camera move, for animating that still.`;

export async function promptgen(shot, { style, characters, setting, model = "qwen-plus" } = {}) {
  const ctx = `STYLE: ${style}\nCHARACTERS: ${JSON.stringify(characters)}\nSETTING: ${setting}\nSHOT: ${JSON.stringify(shot)}`;
  const { text, usage } = await chat(
    [{ role: "system", content: SYS }, { role: "user", content: ctx }],
    { model, temperature: 0.8, max_tokens: 600 }
  );
  const o = parseJson(text);
  return { image_prompt: o.image_prompt, motion_prompt: o.motion_prompt, usage };
}

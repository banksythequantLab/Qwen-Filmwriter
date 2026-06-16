// agent/shotlist.mjs — director agent. One scene -> ordered SHOTS.
import { chat } from "../lib/qwen.mjs";
import { parseJson } from "./planner.mjs";

const SYS = `You are a film director breaking ONE scene into individual SHOTS for an AI video pipeline.
Given the film style, characters, and the scene, return STRICT JSON ONLY:
{"shots":[{"id":number,"type":"establishing"|"wide"|"medium"|"close"|"insert","subject":string,"action":string,"mode":"i2v"|"t2v","duration":number,"narration":string,"dialogue":[{"character":string,"line":string}]}]}
Rules:
- 1-2 shots per scene (be economical).
- duration 2-5 seconds.
- mode: prefer "i2v" (animate a crafted still — best continuity); use "t2v" only for complex multi-action.
- Vary shot TYPE for visual rhythm across the scene.
- narration/dialogue optional and short; "" or [] if none.
- Keep characters consistent with their given descriptions.`;

export async function shotlist(scene, { style, characters, model = "qwen-plus" } = {}) {
  const ctx = `STYLE: ${style}\nCHARACTERS: ${JSON.stringify(characters)}\nSCENE: ${JSON.stringify(scene)}`;
  const { text, usage } = await chat(
    [{ role: "system", content: SYS }, { role: "user", content: ctx }],
    { model, temperature: 0.7, max_tokens: 1000 }
  );
  return { shots: parseJson(text).shots || [], usage };
}

// agent/shotlist.mjs — director agent. One scene -> a STRATEGY + ordered SHOTS.
import { chat } from "../lib/qwen.mjs";
import { parseJson } from "./planner.mjs";

const SYS = `You are a film director breaking ONE scene into a strategy and individual SHOTS for an AI video pipeline.
Given the film style, characters, and the scene, return STRICT JSON ONLY:
{"strategy":"montage"|"longtake","shots":[{"id":number,"type":"establishing"|"wide"|"medium"|"close"|"insert","subject":string,"action":string,"mode":"i2v"|"t2v","duration":number,"narration":string,"dialogue":[{"character":string,"line":string}]}]}
Rules:
- strategy: choose "longtake" if the scene is ONE continuous action or performance that plays well as a single held take intercut with reaction/detail cutaways; choose "montage" if it is a series of distinct beats.
- For "longtake": make the FIRST shot the continuous spine (type wide/establishing) and the remaining shots cutaways (close/insert/medium). Use 2-3 shots.
- For "montage": 1-2 shots, each a distinct beat.
- duration 2-5s per shot. mode: prefer "i2v"; "t2v" only for complex multi-action.
- Vary shot TYPE for rhythm. narration/dialogue optional and short. Keep characters consistent.`;

export async function shotlist(scene, { style, characters, model = "qwen-plus" } = {}) {
  const ctx = `STYLE: ${style}\nCHARACTERS: ${JSON.stringify(characters)}\nSCENE: ${JSON.stringify(scene)}`;
  const { text, usage } = await chat(
    [{ role: "system", content: SYS }, { role: "user", content: ctx }],
    { model, temperature: 0.7, max_tokens: 1000 }
  );
  const o = parseJson(text);
  return { strategy: o.strategy === "longtake" ? "longtake" : "montage", shots: o.shots || [], usage };
}

// agent/shotlist.mjs — director agent. One scene -> a STRATEGY + ordered SHOTS.
import { chat } from "../lib/qwen.mjs";
import { parseJson } from "./planner.mjs";

const SYS = `You are a film director breaking ONE scene into a strategy and individual SHOTS for an AI video pipeline.
Given the film style, characters, and the scene, return STRICT JSON ONLY:
{"strategy":"montage"|"longtake","shots":[{"id":number,"type":"establishing"|"wide"|"medium"|"close"|"insert","subject":string,"action":string,"mode":"i2v"|"t2v","duration":number,"narration":string,"dialogue":[{"character":string,"line":string}]}]}
Rules:
- strategy: choose "longtake" if the scene is ONE continuous action or performance that plays well as a single held take intercut with reaction/detail cutaways; choose "montage" if it is a series of distinct beats.
- EVERY scene's FIRST shot is an ESTABLISHING or WIDE shot (6-8s) that grounds the viewer: the place, the time, who is present, and what situation we are walking into. The audience must never be lost.
- For "longtake": the establishing/wide spine first, then 2-3 cutaways (close/insert/medium). Use 3-4 shots.
- For "montage": 3-4 shots, each a distinct beat that reads clearly on its own.
- duration 4-8s per shot (establishing shots 6-8s). A scene should total roughly 25-35 seconds of screen time. mode: prefer "i2v"; "t2v" only for complex multi-action.
- Vary shot TYPE for rhythm. narration/dialogue optional and short. Keep characters consistent.`;

export async function shotlist(scene, { style, characters, title = "", model = "qwen-plus" } = {}) {
  const ctx = `FILM: ${title}\nSTYLE: ${style}\nCHARACTERS: ${JSON.stringify(characters)}\nSCENE (this is the story beat to cover): ${JSON.stringify(scene)}`;
  const { text, usage } = await chat(
    [{ role: "system", content: SYS }, { role: "user", content: ctx }],
    { model, temperature: 0.7, max_tokens: 1000 }
  );
  const o = parseJson(text);
  return { strategy: o.strategy === "longtake" ? "longtake" : "montage", shots: o.shots || [], usage };
}

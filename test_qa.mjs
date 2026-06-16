// test_qa.mjs — isolated re-test of the visual-QA loop after the v2 fixes.
import { readFileSync } from "node:fs";
import { approvedStill } from "./agent/visualQA.mjs";
import { download } from "./lib/qwen.mjs";

const p = JSON.parse(readFileSync("output/plan.json", "utf8"));
const sc = p.scenes[0];
console.log("QA loop v2 — scene 1:", sc.image_prompt.slice(0, 110), "...\n");
const res = await approvedStill(sc.image_prompt, {
  maxRetries: 3,
  onStep: (a, v) =>
    console.log(`  attempt ${a}: pass=${v.pass} (match=${v.prompt_match} spell=${v.spelling_ok} anat=${v.anatomy_ok})` +
      `${v.pass ? "" : "  issues: " + ((v.issues || []).join("; ") || "-") + "  fix: " + (v.fix_hint || "-")}`),
});
console.log(`\n-> approved=${res.approved} after ${res.attempt} attempt(s)`);
await download(res.url, "output/scene1_approved.png");
console.log("saved output/scene1_approved.png");

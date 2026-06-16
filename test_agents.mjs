// test_agents.mjs — planner + visual-QA loop, end to end. Run: node --env-file=.env test_agents.mjs
import { writeFileSync } from "node:fs";
import { plan } from "./agent/planner.mjs";
import { approvedStill } from "./agent/visualQA.mjs";
import { download } from "./lib/qwen.mjs";

const logline = "A lonely android busker in a neon megacity discovers it can dream.";

console.log("== PLANNER ==");
const { plan: p, usage } = await plan(logline, { scenes: 4 });
console.log(`title: ${p.title}  | scenes: ${p.scenes?.length}  | tokens: ${usage?.total_tokens}`);
console.log(`style: ${p.style}`);
for (const s of p.scenes) console.log(`  scene ${s.id} [${s.mode} ${s.duration}s] ${s.beat}`);
writeFileSync("output/plan.json", JSON.stringify(p, null, 2));
console.log("saved output/plan.json");

console.log("\n== VISUAL QA LOOP (scene 1) ==");
const sc = p.scenes[0];
console.log("image_prompt:", sc.image_prompt.slice(0, 130), "...");
const res = await approvedStill(sc.image_prompt, {
  maxRetries: 3,
  onStep: (a, v) =>
    console.log(`  attempt ${a}: pass=${v.pass} (match=${v.prompt_match} spell=${v.spelling_ok} anat=${v.anatomy_ok})` +
      `${v.pass ? "" : "  issues: " + ((v.issues || []).join("; ") || "-") + "  fix: " + (v.fix_hint || "-")}`),
});
console.log(`-> approved=${res.approved} after ${res.attempt} attempt(s)`);
await download(res.url, "output/scene1_approved.png");
console.log("saved output/scene1_approved.png");

// test_tune.mjs — verify the close-up QA fix. promptgen (close shot) -> approvedStill.
import { promptgen } from "./agent/promptgen.mjs";
import { approvedStill } from "./agent/visualQA.mjs";

const shot = { id: 2, type: "close", subject: "Android Eva's face catching violet neon glow, eyes softly unfocused",
  action: "a tear-like condensation bead slides down her metallic jawline", mode: "i2v", duration: 3 };
const style = "Cyberpunk, neon blues and pinks, cool blue grade, anamorphic lens, 80s film grain";

const pr = await promptgen(shot, {
  style, setting: "a neon street corner at night",
  characters: [{ name: "Eva", description: "sleek humanoid android, metallic sheen, melancholic" }],
});
console.log("image_prompt:\n", pr.image_prompt, "\n");

const res = await approvedStill(`${pr.image_prompt}. Overall style: ${style}`, {
  onStep: (a, v) => console.log(`attempt ${a}: pass=${v.pass} (match=${v.prompt_match} spell=${v.spelling_ok} anat=${v.anatomy_ok})${v.pass ? "" : "  fix: " + (v.fix_hint || "-")}`),
});
console.log(`\n-> approved=${res.approved} after ${res.attempt} attempt(s)`);

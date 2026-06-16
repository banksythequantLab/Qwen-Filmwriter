// test_editor.mjs — validate the long-take editor on EXISTING clips (no new video spend).
import { mkdirSync } from "node:fs";
import path from "node:path";
import { editorPlan, assembleEdit } from "./agent/editor.mjs";

const dir = path.resolve("output/longtake");
mkdirSync(dir, { recursive: true });

const longTakePath = path.resolve("output/film/clip_1_1.mp4");
const cutawayPaths = {
  c1: path.resolve("output/film/clip_1_2.mp4"),
  c2: path.resolve("output/film/clip_2_1.mp4"),
};
const longTake = { duration: 4.0, description: "Wide: Eva the android plays a melancholic synth-melody on a neon street corner, slow push-in, crowd blurring past." };
const cutaways = [
  { id: "c1", duration: 3.0, description: "Close-up: Eva's face, a condensation tear sliding down her metallic jaw." },
  { id: "c2", duration: 4.0, description: "Medium: Eva lifts a trembling hand toward the dream-light." },
];

console.log("editor planning EDL...");
const edl = await editorPlan(longTake, cutaways);
for (const c of edl) console.log(`  [${c.source}] ${c.in}-${c.out}s  (${c.why || ""})`);

const r = await assembleEdit(longTakePath, cutawayPaths, edl, path.join(dir, "edited.mp4"), dir);
console.log(`\nassembled ${r.segments} cuts -> ${r.outPath}`);

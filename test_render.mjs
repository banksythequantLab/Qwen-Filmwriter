// test_render.mjs — prove approved-still -> i2v clip on a real planned scene.
import { readFileSync } from "node:fs";
import { renderScene } from "./agent/render.mjs";
import { download } from "./lib/qwen.mjs";

const p = JSON.parse(readFileSync("output/plan.json", "utf8"));
const scene = p.scenes.find((s) => s.mode === "i2v") || p.scenes[1];
console.log(`render scene ${scene.id} [${scene.mode} ${scene.duration}s]: ${scene.beat}`);

const r = await renderScene(scene, {
  style: p.style,
  onStill: (a, v) => console.log(`  still attempt ${a}: pass=${v.pass}${v.pass ? "" : " fix: " + (v.fix_hint || "-")}`),
  onClip: (st, s) => console.log(`  i2v [${s}s] ${st}`),
});

console.log(`still approved: ${r.stillApproved}`);
console.log(`clip: ${r.clipUrl?.slice(0, 80)}...`);
await download(r.clipUrl, `output/scene${scene.id}_clip.mp4`);
console.log(`saved output/scene${scene.id}_clip.mp4`);

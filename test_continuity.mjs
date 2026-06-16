// test_continuity.mjs — prove subject consistency: reference -> edit into scenes -> VL identity check.
import { mkdirSync } from "node:fs";
import { image, imageEdit, see, download } from "./lib/qwen.mjs";
mkdirSync("output/continuity", { recursive: true });

console.log("1) character reference ...");
const ref = await image(
  "Character reference portrait of Eva, a sleek humanoid android with a smooth brushed-silver metallic face, glowing cyan eyes, slim chrome frame. Front view, neutral dark studio background, soft cinematic lighting.",
  { size: "1328*1328" });
console.log("   ref:", ref.url?.slice(0, 80));
await download(ref.url, "output/continuity/ref.png");

const scenes = [
  "Place the exact same android character from the reference image on a rain-slicked neon street at night, wide shot, playing a glowing electric guitar.",
  "Place the exact same android character from the reference image on a rooftop at dawn, medium shot, gazing out over a misty city skyline.",
];
const edits = [];
for (let i = 0; i < scenes.length; i++) {
  console.log(`2.${i + 1}) edit into scene ${i + 1} ...`);
  const e = await imageEdit(ref.url, scenes[i], { size: "1664*928" });
  console.log("   edit:", e.url?.slice(0, 80));
  if (e.url) { await download(e.url, `output/continuity/scene${i + 1}.png`); edits.push(e.url); }
  else console.log("   raw:", JSON.stringify(e.raw).slice(0, 300));
}

console.log("3) VL identity check (reference vs each edit) ...");
for (let i = 0; i < edits.length; i++) {
  const v = await see([ref.url, edits[i]],
    "Image 1 is a character reference; Image 2 is a new scene. Is the MAIN character in Image 2 the same individual (same face design, colors, features) as in Image 1? Answer strictly SAME or DIFFERENT, then a 6-word reason.",
    { max_tokens: 60 });
  console.log(`   scene ${i + 1}: ${v.text.trim()}`);
}

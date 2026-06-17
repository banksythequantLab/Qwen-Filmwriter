// test_white.mjs — try a white-background, storyboard/model-sheet style reference still.
import { image, download } from "./lib/qwen.mjs";
import { mkdirSync } from "node:fs";
mkdirSync("output/wbtest", { recursive: true });

const STYLE = "near-future retro-futurism, soft pastel grade, gentle cinematic lighting";
const prompts = {
  // A: classic character model sheet on pure white
  white_ref: `Character model sheet of a weathered retired courier robot named Riley, full figure, front view, ` +
    `on a pure white seamless studio background, soft even lighting, subtle contact shadow only, ` +
    `clean storyboard reference style, crisp edges. Art direction: ${STYLE}. No text, no labels.`,
  // B: a storyboard PANEL (scene on white card, framed) rather than a finished cinematic frame
  white_panel: `Storyboard panel: a retired courier robot kneeling to plant a seedling on a rooftop at dawn, ` +
    `drawn as a clean concept-art frame on a white background with a thin neat border, ` +
    `soft pastel tones, gentle morning light. Art direction: ${STYLE}. No text.`,
};

for (const [name, prompt] of Object.entries(prompts)) {
  const t0 = Date.now();
  try {
    const { url } = await image(prompt, { size: "1664*928" });
    if (!url) { console.log(`${name}: no url`); continue; }
    const { bytes } = await download(url, `output/wbtest/${name}.png`);
    console.log(`${name}: output/wbtest/${name}.png  (${(bytes/1024).toFixed(0)} KB, ${((Date.now()-t0)/1000).toFixed(1)}s)`);
  } catch (e) { console.log(`${name}: ERR ${e.message.slice(0,120)}`); }
}

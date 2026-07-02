// test_r2v.mjs — cheap live probe of reference-to-video. 1 image gen + 1 short silent r2v take.
// Verifies: the r2v() client, task acceptance on wan2.6-r2v-flash, and a downloadable clip whose
// character can be eyeballed against the reference. r2v refs must be PUBLIC URLs (not data URIs).
import { image, r2v, download } from "./lib/qwen.mjs";

const t0 = Date.now();
console.log("== R2V PROBE ==");
const ref = await image(
  "Full-body photo of an android street busker: iridescent cobalt-blue bob haircut, matte-black neoprene turtleneck, electric-blue ankle-strap platform boots, holding a translucent violin. ONE single figure, front view, clean white studio background, no text.",
  { size: "1328*1328", seed: 777 });
console.log("ref image:", ref.url ? "OK" : "FAILED");
if (!ref.url) process.exit(1);

const clip = await r2v(
  "character1 plays the violin under neon-lit rain on a city street at night, slow cinematic push-in, rain glistening.",
  [ref.url],
  { duration: 4, seed: 778, onTick: (st, s) => console.log(`  [${s}s] ${st}`) });
console.log("r2v clip:", clip.url ? "OK" : "FAILED");
if (!clip.url) process.exit(1);

const d = await download(clip.url, "output/r2v_probe.mp4");
console.log(`\nRESULT: output/r2v_probe.mp4 (${d.bytes} bytes) in ${Math.round((Date.now() - t0) / 1000)}s`);
console.log("Eyeball the clip vs the reference: same hair, turtleneck, boots, violin = identity held through video gen.");

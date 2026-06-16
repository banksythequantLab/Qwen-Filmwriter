// test_foundation.mjs — verify image() + speak() live. Run: node --env-file=.env test_foundation.mjs
import { chat, image, speak, download } from "./lib/qwen.mjs";

console.log("1) chat ...");
const c = await chat([{ role: "user", content: "In 6 words, pitch a neon cyberpunk short film." }], { model: "qwen-plus", max_tokens: 40 });
console.log("   ->", c.text, "| tokens:", c.usage?.total_tokens);

console.log("2) image (qwen-image-plus, 1664*928) ...");
try {
  const im = await image("A lone detective under flickering neon signs on a rain-soaked street, cinematic, moody, 16:9", {
    onTick: (st, s) => console.log(`   [${s}s] ${st}`),
  });
  console.log("   image url:", im.url ? im.url.slice(0, 90) + "..." : "(none)");
  if (!im.url) console.log("   raw output keys:", JSON.stringify(im.raw).slice(0, 400));
  if (im.url) console.log("   ", (await download(im.url, "output/still_001.png")));
} catch (e) { console.error("   image ERR:", e.message); }

console.log("3) speak (qwen3-tts-flash, Cherry) ...");
try {
  const sp = await speak("The city never sleeps, and neither do its secrets.");
  console.log("   audio url:", sp.url ? sp.url.slice(0, 90) + "..." : "(none)");
  if (!sp.url) console.log("   raw output keys:", JSON.stringify(sp.raw).slice(0, 400));
  if (sp.url) console.log("   ", (await download(sp.url, "output/vo_001.wav")));
} catch (e) { console.error("   speak ERR:", e.message); }

console.log("done.");

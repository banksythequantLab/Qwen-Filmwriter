// test_reffix.mjs — cheap live test of the anchor-refinement mechanism (refs only, NO film).
// Exercises the exact production path: model-sheet t2i via approvedStill (canon-gated) -> on failure,
// refineAnchor (qwen-image-edit correction + bibleReview audit). A handful of image gens + vision calls.
import { approvedStill, refineAnchor } from "./agent/visualQA.mjs";
import { download } from "./lib/qwen.mjs";

const name = "EVA";
const refLook = "(1) hair — asymmetric bob, shaved right side, iridescent cobalt-blue synthetic hair on the left; (2) face/skin — pearlescent gunmetal-gray skin plating with a thin glowing cyan seam down the jawline; (3) upper body — matte-black neoprene turtleneck under a cropped translucent rain shell; (4) lower body — matte-black tapered cargo trousers; (5) FOOTWEAR — ankle-strap electric-blue leather platform boots; (6) accessories — left-ear cybernetic stud with pulsing soft blue light";
const canon = [
  `${name} — WARDROBE LOCK (head-to-toe, identical every shot incl. footwear & hair): ${refLook}`,
  `${name}: footwear is ankle-strap electric-blue leather platform boots`,
  `${name}: hair is an asymmetric bob, shaved right side, cobalt-blue on the left`,
].join("\n");

const t0 = Date.now();
console.log("== REF ANCHOR TEST ==");
const ref = await approvedStill(
  `Full-body character model sheet of ${name}, head to toe, showing the COMPLETE outfit and every accessory: ${refLook}. Cyberpunk aesthetic, cool blue palette. Standing straight, front view, entire figure visible from head to feet, on a clean pure white seamless studio background, soft even lighting, subtle contact shadow only, no text.`,
  { size: "1328*1328", maxRetries: +(process.env.QWEN_REF_RETRIES ?? 2), seed: 4242, canon,
    onStep: (a, v) => console.log(`  t2i attempt ${a}: pass=${v.pass}${v.issues?.length ? " — " + v.issues.slice(0, 3).join("; ") : ""}`) });
console.log(`t2i phase: approved=${ref.approved} (attempt ${ref.attempt})`);

let final = { url: ref.url, approved: ref.approved };
if (!ref.approved && ref.url) {
  final = await refineAnchor(ref.url, ref.verdict, refLook, canon, { tries: +(process.env.QWEN_REF_REFINE_TRIES ?? 3), seed: 4242,
    onRound: (r, v) => console.log(`  refine ${r}: ${v.error ? "ERROR — " + v.error : v.pass ? "canon PASS" : "still off — " + ((v.violations || []).join("; ") || "unverified")}`) });
}
if (final.url) await download(final.url, "output/reffix_test.png");
console.log(`\nRESULT: approved=${final.approved} in ${Math.round((Date.now() - t0) / 1000)}s -> output/reffix_test.png`);
console.log(final.approved ? "MECHANISM WORKS: refinement produced a canon-passing anchor." : "NOT PASSING: refinement did not reach canon compliance — inspect output/reffix_test.png.");

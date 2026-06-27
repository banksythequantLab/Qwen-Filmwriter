// agent/clipQA.mjs — MOTION QA. The still inspectors judge a frame; this judges what the ANIMATION
// did to it. It pulls a frame from late in each rendered clip and compares it to the source still:
// did the subject hold, or did motion morph/melt/drift it? Flags bad takes (and can re-animate once).
import { spawn } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { see } from "../lib/qwen.mjs";
import { parseJson } from "./planner.mjs";

function run(cmd, args) {
  return new Promise((res, rej) => {
    const p = spawn(cmd, args, { stdio: "ignore" });
    p.on("error", rej);
    p.on("close", (code) => (code === 0 ? res() : rej(new Error(`${cmd} exited ${code}`))));
  });
}

// Grab a frame from near the END of a clip (where motion artifacts surface), downscaled to keep the
// vision payload light, and return it as a base64 data URI (clip frames aren't on a CDN).
export async function lastFrameDataUri(clipPath, { at = -0.5 } = {}) {
  const out = `${clipPath.replace(/\.mp4$/i, "")}_qa.jpg`;
  await run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-sseof", String(at), "-i", clipPath, "-frames:v", "1", "-vf", "scale=640:-2", "-q:v", "4", out]);
  const b = readFileSync(out).toString("base64");
  try { rmSync(out); } catch {}
  return `data:image/jpeg;base64,${b}`;
}

const CLIP_SYS = `You are a MOTION QA reviewer for an AI film. You are shown TWO images from the SAME shot: IMAGE 1 is the SOURCE still the shot was animated from; IMAGE 2 is a frame from LATER in the animated clip. Motion, camera movement, and pose change are EXPECTED and good — judge ONLY whether the animation preserved the shot rather than MORPHING or DEGRADING it.
Check:
(1) identity_held — the main character(s) in IMAGE 2 are still recognizably the same person/creature as in IMAGE 1 (face, build, and wardrobe not warped into someone or something else).
(2) no_morph — no melting, smearing, duplicated or fused limbs/fingers, extra heads, or geometry that fell apart while moving.
(3) scene_held — the location/setting is still the same place; it did not dissolve into a different scene.
(4) on_beat — IMAGE 2 still depicts the intended action/moment, not a collapsed or nonsensical frame.
Output ONLY strict JSON, no reasoning, no restating:
{"pass": boolean, "identity_held": boolean, "no_morph": boolean, "scene_held": boolean, "on_beat": boolean, "issues": [string], "fix_hint": string}
Each issue is a short phrase (max 8 words). pass = all four booleans true. fix_hint = one short instruction for a steadier re-animation, or "" if pass.`;

// Compare the source still (CDN url) to a late clip frame (data uri). Fails OPEN on any error.
export async function clipReview(stillUrl, clipFrameUri, beat, { model = "qwen3-vl-plus" } = {}) {
  let text;
  try {
    ({ text } = await see([stillUrl, clipFrameUri], `${CLIP_SYS}\n\nINTENDED BEAT: ${beat || "(unspecified)"}`, { model, temperature: 0, max_tokens: 380 }));
  } catch (e) {
    return { pass: true, issues: [], fix_hint: "", _skipped: true };
  }
  try { const v = parseJson(text); if (!Array.isArray(v.issues)) v.issues = []; return v; }
  catch { return { pass: true, issues: [], fix_hint: "", _skipped: true }; }
}

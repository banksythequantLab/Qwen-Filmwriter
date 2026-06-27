// agent/continuity.mjs — the SCRIPT SUPERVISOR. Unlike the per-frame inspectors (which judge a
// still in isolation), this critic looks at two ADJACENT frames together and grades the CUT between
// them: does the shot that follows hold visual continuity with the one before it? When it breaks,
// showrun re-rolls the later frame to match. This is what makes a sequence feel like one story.
import { see } from "../lib/qwen.mjs";
import { parseJson } from "./planner.mjs";

const ADJ_SYS = `You are a film SCRIPT SUPERVISOR responsible for CONTINUITY. You are shown TWO consecutive frames from the same short film: IMAGE 1 is the PREVIOUS shot, IMAGE 2 is the shot that DIRECTLY FOLLOWS it. Judge ONLY whether IMAGE 2 holds visual continuity with IMAGE 1 for elements that should carry across the cut.
Be strict but sensible. A deliberate change of place, time, or character is NORMAL when the story moves on — only call a BREAK when the two frames are meant to be the SAME continuous place/time/character and something inconsistently changes.
For elements common to both frames, check:
(1) wardrobe_ok — the same character wears the same outfit, colors, hair, and notable accessories (unless the story plainly changed them).
(2) location_ok — the setting is consistent when it should be the same place; no sudden unexplained relocation mid-scene.
(3) lighting_ok — time of day, light direction, and color grade stay consistent when the moment is continuous.
(4) prop_ok — objects that should persist (a held item, a vehicle, key set dressing) stay consistent; nothing appears, vanishes, or changes model/color without reason.
(5) character_ok — the same person reads as the same person (face, build, age) across the cut.
Output ONLY strict JSON, no reasoning, no restating:
{"same_scene": boolean, "continuous": boolean, "wardrobe_ok": boolean, "location_ok": boolean, "lighting_ok": boolean, "prop_ok": boolean, "character_ok": boolean, "breaks": [string], "fix_hint": string}
"same_scene" = are these two frames meant to be one continuous place/time? If false (a deliberate story jump), set continuous=true and breaks=[].
Each "breaks" entry names ONE specific discontinuity in IMAGE 2 relative to IMAGE 1 (max 9 words).
continuous = (same_scene is false) OR (all five *_ok are true).
fix_hint = one short instruction for redrawing IMAGE 2 so it matches IMAGE 1, or "" if continuous.`;

// Compare a previous frame (A) and the frame that follows (B). Fails OPEN on any vision error so a
// single un-judgeable pair can never crash the film.
export async function adjacentContinuityReview(prevUrl, curUrl, { model = "qwen3-vl-plus" } = {}) {
  let text;
  try {
    ({ text } = await see([prevUrl, curUrl], ADJ_SYS, { model, temperature: 0, max_tokens: 420 }));
  } catch (e) {
    return { same_scene: false, continuous: true, breaks: [], fix_hint: "", _skipped: true };
  }
  try {
    const v = parseJson(text);
    if (!Array.isArray(v.breaks)) v.breaks = [];
    return v;
  } catch {
    return { same_scene: false, continuous: true, breaks: [], fix_hint: "", _skipped: true };
  }
}

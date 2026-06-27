// agent/continuity.mjs — the SCRIPT SUPERVISOR. Unlike the per-frame inspectors (which judge a
// still in isolation), this critic looks at two ADJACENT frames together and grades the CUT between
// them: does the shot that follows hold visual continuity with the one before it? When it breaks,
// showrun re-rolls the later frame to match. This is what makes a sequence feel like one story.
import { see } from "../lib/qwen.mjs";
import { parseJson } from "./planner.mjs";

const ADJ_SYS = `You are a film SCRIPT SUPERVISOR responsible for CONTINUITY. You are shown TWO consecutive frames from the same short film: IMAGE 1 is the PREVIOUS shot, IMAGE 2 is the shot that DIRECTLY FOLLOWS it.
Be sensible, not pedantic. Camera angle, shot size, framing, lens, and WHERE things sit within the frame WILL change from shot to shot — that is normal filmmaking, NOT a continuity break. NEVER flag: an object merely moving to a different position in frame, the camera being closer or farther, a different angle or crop of the same place, or a normal change of pose or expression. A deliberate change of place, time, or character is also fine when the story moves on.
Only call a BREAK when two frames meant to be the SAME continuous moment disagree on a fixed FACT:
(1) wardrobe_ok — same outfit COLOR and garment type, and same hair. Flag a coat changing color or type, or hair changing length/color. Ignore how cloth drapes, folds, or catches light.
(2) location_ok — the same PLACE identity. Flag IMAGE 2 becoming a genuinely different location (e.g. a stone fireplace room becoming a wooden ship cabin). Ignore a different angle, crop, distance, or part of the same place.
(3) lighting_ok — same TIME OF DAY and weather mood. Flag day<->night, or stormy-night<->sunny-day. Ignore minor exposure or the exact position of light.
(4) prop_ok — a key object's EXISTENCE and identity. Flag a prop that vanishes, appears from nowhere, or turns into a different object. Ignore it simply being repositioned, smaller, or partly out of frame.
(5) character_ok — the same person reads as the same person (face, build, age).
Output ONLY strict JSON, no reasoning, no restating:
{"same_scene": boolean, "continuous": boolean, "wardrobe_ok": boolean, "location_ok": boolean, "lighting_ok": boolean, "prop_ok": boolean, "character_ok": boolean, "breaks": [string], "fix_hint": string}
"same_scene" = are these two frames meant to be one continuous place/time? If false (a deliberate story jump), set continuous=true and breaks=[].
Each "breaks" entry names ONE specific FACT discontinuity in IMAGE 2 relative to IMAGE 1 (max 9 words) — never a camera/position note.
continuous = (same_scene is false) OR (all five *_ok are true).
fix_hint = one short instruction for redrawing IMAGE 2 so its facts match IMAGE 1, or "" if continuous.`;

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

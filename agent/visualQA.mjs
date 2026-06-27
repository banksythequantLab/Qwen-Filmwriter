// agent/visualQA.mjs — visual QA agent. Inspects a still vs its prompt; regenerates with
// feedback until it passes (prompt-match + spelling + anatomy + legal clearance) or hits the retry cap.
import { image, imageEdit, see } from "../lib/qwen.mjs";
import { parseJson } from "./planner.mjs";
import { legalReview } from "./legal.mjs";

const QA_SYS = `You are a practical visual QA reviewer for an AI film pipeline. You see ONE generated still and the prompt it should satisfy.
Judge:
(1) prompt_match - does it SUBSTANTIALLY depict the prompt's subject, setting, and mood? Allow stylistic interpretation and minor framing/expression differences; fail ONLY on a clear mismatch of the main subject, setting, or mood.
(2) spelling_ok - default TRUE. Set FALSE only if SHARP, IN-FOCUS, FOREGROUND text that the shot is clearly ABOUT is misspelled. Blurred, distant, or background signage NEVER counts as a failure - keep true.
(3) anatomy_ok - are the MAIN human/creature bodies, hands, and faces correct? Ignore distant background figures. If no living subjects, true.
Output ONLY the final verdict as STRICT JSON. No reasoning, no deliberation, no restating:
{"pass": boolean, "prompt_match": boolean, "spelling_ok": boolean, "anatomy_ok": boolean, "issues": [string], "fix_hint": string}
Each issue is a short phrase, max 8 words. pass = prompt_match AND spelling_ok AND anatomy_ok. fix_hint = one short instruction, or "" if pass.`;

export async function reviewStill(imageUrl, imagePrompt, { model = "qwen3-vl-plus" } = {}) {
  let text;
  try {
    ({ text } = await see(imageUrl, `${QA_SYS}\n\nPROMPT THE IMAGE SHOULD MATCH:\n${imagePrompt}`, { model, temperature: 0, max_tokens: 500 }));
  } catch (e) {
    // Vision judge unreachable or REFUSED the frame (content moderation -> chat 400). Fail-open so a
    // single un-judgeable frame can't crash the whole film; the legal gate + base negatives still apply.
    return { pass: true, prompt_match: true, spelling_ok: true, anatomy_ok: true, issues: [], fix_hint: "", _skipped: true };
  }
  try { return parseJson(text); }
  catch { return { pass: false, prompt_match: false, spelling_ok: true, anatomy_ok: true, issues: ["unparseable QA verdict"], fix_hint: "" }; }
}

// ---- INSPECTOR 1: COHERENCE — "does the picture make physical sense?" ----
// A dedicated, STRICT physical-plausibility judge. The base QA's anatomy check is lenient; this one
// specifically hunts the generator artifacts that slip through: extra/third arms, faces sliced off or
// bleeding past the frame edge, impossible interactions (a hat set on another hat), melted geometry.
const COHERENCE_SYS = `You are a STRICT physical-plausibility inspector for AI-generated film stills. Judge ONLY whether the image is physically coherent — ignore style, mood, beauty, and story. Inspect the MAIN in-focus subject(s); ignore tiny distant background figures. Check:
(1) limb_count_ok - every main figure has the correct number of arms, hands, fingers, legs, and heads. FALSE for any extra/third arm, duplicated or merged limb, fused bodies, wrong finger count, or two heads.
(2) in_frame_ok - no main subject's face or head is sliced off, smeared past, or unnaturally bleeding beyond the picture's edge. A deliberately tight but clean crop is fine; a face melting off the frame border is NOT.
(3) interaction_ok - bodies and objects interact in a physically possible way: hands actually hold what they hold, objects rest on real surfaces, nothing floats or passes through solids, and no nonsensical action (e.g. setting a hat down on top of another hat, wearing two hats stacked).
(4) render_ok - no melted, warped, smeared, or duplicated anatomy/geometry; faces and hands are cleanly formed.
Output ONLY strict JSON, no reasoning, no restating:
{"pass": boolean, "limb_count_ok": boolean, "in_frame_ok": boolean, "interaction_ok": boolean, "render_ok": boolean, "issues": [string], "fix_hint": string}
Each issue is a short phrase, max 8 words. pass = all four booleans true. fix_hint = one short correction, or "" if pass.`;

export async function coherenceReview(imageUrl, { model = "qwen3-vl-plus" } = {}) {
  let text;
  try {
    ({ text } = await see(imageUrl, COHERENCE_SYS, { model, temperature: 0, max_tokens: 400 }));
  } catch (e) {
    return { pass: true, limb_count_ok: true, in_frame_ok: true, interaction_ok: true, render_ok: true, issues: [], fix_hint: "", _skipped: true };
  }
  let v; try { v = parseJson(text); } catch { return { pass: false, issues: ["unparseable coherence verdict"], fix_hint: "" }; }
  // Targeted negatives for the re-roll, by which check failed.
  const negs = [];
  if (v.limb_count_ok === false) negs.push("extra arm, third arm, extra limbs, duplicated limbs, merged bodies, extra fingers, two heads");
  if (v.in_frame_ok === false) negs.push("face cropped off, head out of frame, face bleeding past edge, subject cut off at border");
  if (v.interaction_ok === false) negs.push("floating objects, two hats stacked, impossible pose, hand through solid object");
  if (v.render_ok === false) negs.push("melted anatomy, warped face, smeared limbs, deformed hands");
  v.negative = negs.join(", ");
  return v;
}

// ---- INSPECTOR 2: STORY-NEED — "does this frame reflect what the story needs here?" ----
// Per-frame intent check (distinct from the sequence-level story-review). Given a short statement of
// what THIS beat needs the frame to show, verify the image actually delivers it (right subject doing the
// right thing, any required visible element present and legible) — not just a generically pretty picture.
const STORYNEED_SYS = `You are a story inspector for an AI film. You see ONE still and a short statement of what this beat of the story NEEDS the frame to show. Judge ONLY whether the image delivers that need: the right subject, doing the right thing, with any required visible element actually present and legible. Allow any styling, framing, or interpretation that still conveys it. Fail ONLY if a viewer could not read the beat from this frame, or a required element is missing or unrecognizable.
Output ONLY strict JSON, no reasoning:
{"pass": boolean, "conveys_beat": boolean, "missing": [string], "fix_hint": string}
Each "missing" entry is a short phrase for something the story needs but the frame lacks (max 8 words). pass = conveys_beat AND nothing required is missing. fix_hint = one short instruction, or "" if pass.`;

export async function storyNeedReview(imageUrl, storyNeed, imagePrompt, { model = "qwen3-vl-plus" } = {}) {
  let text;
  try {
    ({ text } = await see(imageUrl, `${STORYNEED_SYS}\n\nWHAT THIS BEAT NEEDS THE FRAME TO SHOW:\n${storyNeed}`, { model, temperature: 0, max_tokens: 400 }));
  } catch (e) {
    return { pass: true, conveys_beat: true, missing: [], fix_hint: "", _skipped: true };
  }
  try { return parseJson(text); }
  catch { return { pass: false, conveys_beat: false, missing: ["unparseable story-need verdict"], fix_hint: "" }; }
}

// ---- INSPECTOR 3: CONTINUITY BIBLE — "does the frame obey the locked canon?" ----
// state.mjs builds typed, LOCKED facts (a character's wardrobe/hair, key props, world rules). The
// contradiction guard validates the PLAN against those facts; this validates the generated IMAGE
// against them — rejecting a frame that puts the wrong outfit, prop, or world detail on screen.
const BIBLE_SYS = `You are a CONTINUITY BIBLE auditor for an AI film. You see ONE generated still and a list of LOCKED story facts — the canon for this film (established character wardrobe/hair, key objects, and world rules). Judge ONLY whether the image VIOLATES a locked fact that is VISUALLY checkable in THIS frame. Ignore any fact that cannot be seen in a single still (a name, a backstory, a motive, an off-screen detail). Allow anything the facts do not constrain. Do not invent violations — only flag a clear, visible contradiction of a stated fact.
Output ONLY strict JSON, no reasoning, no restating:
{"pass": boolean, "violations": [string], "fix_hint": string}
Each "violation" names ONE locked fact the image contradicts and how it differs (max 10 words). pass = no visually-checkable locked fact is violated. fix_hint = one short instruction to bring the frame back into canon, or "" if pass.`;

export async function bibleReview(imageUrl, canon, { model = "qwen3-vl-plus" } = {}) {
  if (!canon || !String(canon).trim()) return { pass: true, violations: [], fix_hint: "", _skipped: true };
  let text;
  try {
    ({ text } = await see(imageUrl, `${BIBLE_SYS}\n\nLOCKED STORY FACTS (canon):\n${canon}`, { model, temperature: 0, max_tokens: 380 }));
  } catch (e) {
    return { pass: true, violations: [], fix_hint: "", _skipped: true };
  }
  try { const v = parseJson(text); if (!Array.isArray(v.violations)) v.violations = []; return v; }
  catch { return { pass: true, violations: [], fix_hint: "", _skipped: true }; }
}

// Generate -> QA -> LEGAL clearance -> regenerate (feeding fix hints + legal negatives back) until pass or maxRetries.
export async function approvedStill(imagePrompt, { maxRetries = 3, size, onStep, onLegal, onInspect, referenceUrl, seed, promptExtend = false, storyNeed = "", canon = "" } = {}) {
  const baseNeg = "text, words, letters, captions, subtitles, signage, watermark, logo, garbled text, distorted typography, copyrighted character, trademarked franchise character, superhero costume, masked vigilante in spandex, web-pattern bodysuit, comic-book emblem, cape, branded logo, mascot, celebrity likeness, nsfw, nudity, gore";
  const COHERENCE = process.env.QWEN_COHERENCE !== "0";       // physical-sanity inspector (on by default)
  const STORY_NEED = process.env.QWEN_STORY_NEED !== "0";     // per-frame story-need inspector (on by default)
  const BIBLE = process.env.QWEN_BIBLE !== "0";               // continuity-bible (locked-canon) inspector (on by default)
  let history = [], best = null, bestScore = -Infinity, last = null;
  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    let prompt = imagePrompt, neg = baseNeg;
    if (last && !last.pass) {                                  // progressive, defect-targeted escalation
      const fix = [last.fix_hint, ...(last.issues || [])].filter(Boolean).join("; ") || "improve fidelity";
      const hard = attempt >= 3;
      prompt = `${imagePrompt}\n\nCorrections: ${fix}.` + (hard
        ? " CRITICAL: plain, solid, heavily out-of-focus background; ABSOLUTELY NO signs, text, letters, or symbols anywhere in frame."
        : " Keep all background signage fully blurred and unreadable.");
      if (last.spelling_ok === false) neg += ", neon signs, billboards, advertisements, shop signs, kanji, glyphs, symbols";
      if (last.anatomy_ok === false) neg += ", deformed hands, extra fingers, distorted face, malformed limbs";
      if (last.coherence_ok === false) neg += ", " + (last.coherence_negative || "extra arm, third arm, extra limbs, duplicated limbs, merged bodies, cropped face, head out of frame, floating objects, impossible pose, melted anatomy");
      if (last.legal_negative) neg += ", " + last.legal_negative;   // Legal-suggested negatives on the corrected reroll
    }
    const genOpts = { negative_prompt: neg, prompt_extend: promptExtend, ...(size ? { size } : {}), ...(Number.isInteger(seed) ? { seed: seed + (attempt - 1) } : {}) };
    let im;
    try {
      im = referenceUrl
        ? await imageEdit(referenceUrl, `Keep each referenced character's exact identity (face, hair, wardrobe, colors) AND keep any referenced LOCATION's architecture, layout, palette, and time-of-day lighting from the reference image(s). Change ONLY the camera framing, the characters' poses, and the action to depict this shot: ${prompt}`, genOpts)
        : await image(prompt, genOpts);
    } catch (e) {
      // Content-moderation / edit failure (e.g. DataInspectionFailed 400). Don't crash the job:
      // drop the (possibly flagged) reference and fall back to a clean, then sanitized, text-to-image.
      try {
        im = await image(prompt, genOpts);
      } catch (e2) {
        const safe = prompt.replace(/\b(spider|arachno\w*|web[-\s]?sling\w*|superhero|super-hero|costume|masked?|cape|emblem|insignia|logo|brand\w*)\b/gi, "")
                           .replace(/\s{2,}/g, " ").trim();
        try {
          im = await image(`${safe} — original character design, plain modern clothing, safe for work`, { ...genOpts, prompt_extend: true });
        } catch (e3) {
          const v = { pass: false, blocked: true, prompt_match: false, spelling_ok: true, anatomy_ok: true,
                      issues: ["blocked by content filter"], fix_hint: "use a plainer original safe-for-work design" };
          history.push({ attempt, url: null, verdict: v });
          if (onStep) onStep(attempt, v, null);
          last = v; continue;                                  // next attempt; never throw
        }
      }
    }
    const verdict = await reviewStill(im.url, imagePrompt);   // judge against the ORIGINAL spec
    // INSPECTOR 1 — COHERENCE: physical/anatomical/spatial sanity (extra limbs, off-frame faces, impossible interactions).
    if (verdict.pass && COHERENCE) {
      const coh = await coherenceReview(im.url);
      verdict.coherence_ok = coh.pass;
      if (onInspect) onInspect("coherence", attempt, coh, im.url);
      if (!coh.pass) {
        verdict.pass = false;
        verdict.issues = [...(verdict.issues || []), ...(coh.issues || [])];
        verdict.fix_hint = [coh.fix_hint, verdict.fix_hint].filter(Boolean).join("; ") || "fix the physical/anatomical errors";
        verdict.coherence_negative = coh.negative || "";
      }
    }
    // INSPECTOR 2 — STORY-NEED: does this frame deliver what the beat needs? (only when a need was supplied)
    if (verdict.pass && storyNeed && STORY_NEED) {
      const sn = await storyNeedReview(im.url, storyNeed, imagePrompt);
      verdict.story_need_ok = sn.pass;
      if (onInspect) onInspect("story_need", attempt, sn, im.url);
      if (!sn.pass) {
        verdict.pass = false;
        verdict.issues = [...(verdict.issues || []), ...(sn.missing || [])];
        verdict.fix_hint = [sn.fix_hint, verdict.fix_hint].filter(Boolean).join("; ") || "make the frame clearly read as the story beat";
      }
    }
    // INSPECTOR 3 — CONTINUITY BIBLE: does the frame obey the film's locked canon? (only when canon supplied)
    if (verdict.pass && canon && BIBLE) {
      const bib = await bibleReview(im.url, canon);
      verdict.bible_ok = bib.pass;
      if (onInspect) onInspect("bible", attempt, bib, im.url);
      if (!bib.pass) {
        verdict.pass = false;
        verdict.issues = [...(verdict.issues || []), ...(bib.violations || [])];
        verdict.fix_hint = [bib.fix_hint, verdict.fix_hint].filter(Boolean).join("; ") || "bring the frame back into the film's canon";
      }
    }
    // LEGAL & CLEARANCES gate — audit a still the inspectors already like for IP infringement + on-screen text.
    if (verdict.pass) {
      const legal = await legalReview(im.url, { intent: imagePrompt });
      verdict.legal_ok = legal.pass;
      verdict.ip_issue = legal.ip_issue || ""; verdict.text_issue = legal.text_issue || "";
      verdict.legal_negative = legal.negative || "";
      if (onLegal) onLegal(attempt, legal, im.url);
      if (!legal.pass) {                                       // infringement or bad on-screen text -> reroll
        verdict.pass = false;
        verdict.fix_hint = [legal.fix_hint, verdict.fix_hint].filter(Boolean).join("; ") || "use an original, safe, text-free design";
      }
    }
    history.push({ attempt, url: im.url, verdict });
    if (onStep) onStep(attempt, verdict, im.url);
    let score = (verdict.prompt_match ? 2 : 0) + (verdict.anatomy_ok ? 1 : 0) + (verdict.spelling_ok ? 1 : 0)
              + (verdict.coherence_ok === true ? 2 : 0) + (verdict.story_need_ok === true ? 1 : 0) + (verdict.bible_ok === true ? 1 : 0)
              - (verdict.issues?.length || 0) * 0.1;
    if (verdict.coherence_ok === false) score -= 2;          // strongly disprefer physically broken frames as "best"
    if (verdict.legal_ok === false) score -= 5;              // never let an infringing still win "best"
    if (score > bestScore) { bestScore = score; best = { url: im.url, verdict, attempt }; }
    if (verdict.pass) return { ...best, history, approved: true };
    last = verdict;
  }
  return best ? { ...best, history, approved: false }          // best-scoring effort after retries
              : { url: null, history, approved: false, blocked: true };  // every attempt blocked by moderation
}

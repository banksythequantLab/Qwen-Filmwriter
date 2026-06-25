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
  const { text } = await see(imageUrl, `${QA_SYS}\n\nPROMPT THE IMAGE SHOULD MATCH:\n${imagePrompt}`, { model, temperature: 0, max_tokens: 500 });
  try { return parseJson(text); }
  catch { return { pass: false, prompt_match: false, spelling_ok: true, anatomy_ok: true, issues: ["unparseable QA verdict"], fix_hint: "" }; }
}

// Generate -> QA -> LEGAL clearance -> regenerate (feeding fix hints + legal negatives back) until pass or maxRetries.
export async function approvedStill(imagePrompt, { maxRetries = 3, size, onStep, onLegal, referenceUrl } = {}) {
  const baseNeg = "text, words, letters, captions, subtitles, signage, watermark, logo, garbled text, distorted typography, copyrighted character, trademarked franchise character, superhero costume, masked vigilante in spandex, web-pattern bodysuit, comic-book emblem, cape, branded logo, mascot, celebrity likeness, nsfw, nudity, gore";
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
      if (last.legal_negative) neg += ", " + last.legal_negative;   // Legal-suggested negatives on the corrected reroll
    }
    let im;
    try {
      im = referenceUrl
        ? await imageEdit(referenceUrl, `Keep each referenced character's exact identity (face, hair, wardrobe, colors) from the reference image(s); render this shot, changing only the scene, pose, lighting, and framing: ${prompt}`, { negative_prompt: neg, ...(size ? { size } : {}) })
        : await image(prompt, { negative_prompt: neg, ...(size ? { size } : {}) });
    } catch (e) {
      // Content-moderation / edit failure (e.g. DataInspectionFailed 400). Don't crash the job:
      // drop the (possibly flagged) reference and fall back to a clean, then sanitized, text-to-image.
      try {
        im = await image(prompt, { negative_prompt: neg, ...(size ? { size } : {}) });
      } catch (e2) {
        const safe = prompt.replace(/\b(spider|arachno\w*|web[-\s]?sling\w*|superhero|super-hero|costume|masked?|cape|emblem|insignia|logo|brand\w*)\b/gi, "")
                           .replace(/\s{2,}/g, " ").trim();
        try {
          im = await image(`${safe} — original character design, plain modern clothing, safe for work`, { negative_prompt: neg, ...(size ? { size } : {}) });
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
    // LEGAL & CLEARANCES gate — audit a still QA already likes for IP infringement + on-screen text.
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
    let score = (verdict.prompt_match ? 2 : 0) + (verdict.anatomy_ok ? 1 : 0) + (verdict.spelling_ok ? 1 : 0) - (verdict.issues?.length || 0) * 0.1;
    if (verdict.legal_ok === false) score -= 5;              // never let an infringing still win "best"
    if (score > bestScore) { bestScore = score; best = { url: im.url, verdict, attempt }; }
    if (verdict.pass) return { ...best, history, approved: true };
    last = verdict;
  }
  return best ? { ...best, history, approved: false }          // best-scoring effort after retries
              : { url: null, history, approved: false, blocked: true };  // every attempt blocked by moderation
}

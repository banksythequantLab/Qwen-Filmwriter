// agent/visualQA.mjs — visual QA agent. Inspects a still vs its prompt; regenerates with
// feedback until it passes (prompt-match + spelling + anatomy) or hits the retry cap.
import { image, see } from "../lib/qwen.mjs";
import { parseJson } from "./planner.mjs";

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

// Generate -> QA -> regenerate (with the QA's fix_hint fed back) until pass or maxRetries exhausted.
export async function approvedStill(imagePrompt, { maxRetries = 3, size, onStep } = {}) {
  const baseNeg = "text, words, letters, captions, subtitles, signage, watermark, logo, garbled text, distorted typography";
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
    }
    const im = await image(prompt, { negative_prompt: neg, ...(size ? { size } : {}) });
    const verdict = await reviewStill(im.url, imagePrompt);   // judge against the ORIGINAL spec
    history.push({ attempt, url: im.url, verdict });
    if (onStep) onStep(attempt, verdict, im.url);
    const score = (verdict.prompt_match ? 2 : 0) + (verdict.anatomy_ok ? 1 : 0) + (verdict.spelling_ok ? 1 : 0) - (verdict.issues?.length || 0) * 0.1;
    if (score > bestScore) { bestScore = score; best = { url: im.url, verdict, attempt }; }
    if (verdict.pass) return { ...best, history, approved: true };
    last = verdict;
  }
  return { ...best, history, approved: false };                // best-scoring effort after retries
}

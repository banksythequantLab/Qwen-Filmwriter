// agent/sound.mjs — the SOUND DEPARTMENT. Two ears the pipeline never had:
// (1) narrationReview — a table read of the WHOLE voiceover script before any recording: one
//     narrator's voice throughout, no repeated lines, each line advances the through-line, and
//     every line SHORT enough to fit its scene (the stitcher hard-cuts audio at video length, so
//     an overrun is truncated MID-SENTENCE in the final film). Flagged lines get rewrites.
// (2) verifyVO — transcribes a synthesized take with qwen3-asr-flash and checks it actually says
//     the script (TTS mangling/truncation happens). Fails OPEN: an unreachable ear never kills a film.
import { readFileSync } from "node:fs";
import { chat } from "../lib/qwen.mjs";
import { parseJson } from "./planner.mjs";

const REVIEW_SYS = `You are a film's NARRATION SUPERVISOR doing a table read of the voiceover script before recording. You get the narrator's style/voice and every scene's narration line with its beat.
Judge the SCRIPT AS A WHOLE:
(1) one_voice — every line sounds like the SAME narrator (person, tense, tone).
(2) no_repeats — no line repeats another line's phrasing or information.
(3) advances — each line advances the through-line; it never merely describes the visible action.
(4) fits — each line is speakable inside its scene: MAX 45 words (roughly two short sentences). Longer lines get CUT OFF mid-sentence in the final film.
(5) exposition — the lines together must let a first-time viewer FOLLOW the story: who this is, where we are, what is at stake. Vague mood lines that explain nothing fail this check.
For every line that fails ANY check, REWRITE it: same narrator voice, same story purpose, 45 words or fewer.
Return STRICT JSON ONLY (no markdown): {"ok": boolean, "issues": [string], "rewrites": [{"id": number, "line": string}]}
"issues" are short phrases (max 10 words each). "rewrites" contains ONLY scenes that need a new line — keep good lines untouched.`;

export async function narrationReview(plan, { model = "qwen-plus" } = {}) {
  const nar = plan?.narration || {};
  const scenes = (plan?.scenes || []).filter((s) => String(s.narration || "").trim());
  if (nar.mode !== "voiceover" || scenes.length < 2) return { ok: true, skipped: true, issues: [], rewrites: [] };
  const script = scenes.map((s) => `S${s.id} [beat: ${String(s.beat || "").replace(/\s+/g, " ").slice(0, 90)}]\nLINE: ${s.narration}`).join("\n\n");
  try {
    const { text } = await chat([
      { role: "system", content: REVIEW_SYS },
      { role: "user", content: `NARRATOR: ${nar.style || "unspecified"} · voice ${nar.voice || "unspecified"}\n\nSCRIPT:\n${script}` },
    ], { model, temperature: 0.2, max_tokens: 1000 });
    const r = parseJson(text);
    return { ok: r.ok !== false, issues: Array.isArray(r.issues) ? r.issues : [], rewrites: Array.isArray(r.rewrites) ? r.rewrites : [] };
  } catch (e) { return { ok: true, skipped: true, issues: [], rewrites: [], error: e.message }; }
}

// Transcribe a local WAV (base64 data URL, OpenAI-compatible input_audio) and score how much of the
// intended script actually made it into the take. Word-recall similarity: robust to ASR punctuation.
export async function verifyVO(wavPath, intendedText, { model = "qwen3-asr-flash", threshold = 0.6 } = {}) {
  try {
    const b64 = readFileSync(wavPath).toString("base64");
    const { text } = await chat([
      { role: "user", content: [{ type: "input_audio", input_audio: { data: `data:audio/wav;base64,${b64}` } }] },
    ], { model, temperature: 0, max_tokens: 600 });
    const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(Boolean);
    const want = norm(intendedText), got = new Set(norm(text));
    const hit = want.filter((w) => got.has(w)).length;
    const sim = want.length ? hit / want.length : 1;
    return { ok: sim >= threshold, sim: Math.round(sim * 100) / 100, transcript: String(text || "").slice(0, 200) };
  } catch (e) { return { ok: true, _skipped: true, sim: null, error: e.message }; }
}

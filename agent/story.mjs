// agent/story.mjs — STORY EDITOR agent (the "does this tell the story?" pass).
// Two jobs:
//   architect(plan)           -> text-level beat-sheet critique + light repair BEFORE any image.
//   storyReview(plan, frames) -> vision-level: do the rendered stills actually TELL the story?
import { chat, see } from "../lib/qwen.mjs";
import { parseJson } from "./planner.mjs";
import { lockedFacts } from "./state.mjs";

const ARCH_SYS = `You are a STORY EDITOR (script doctor) reviewing a short-film beat sheet BEFORE anything is filmed.
Judge it as ONE dramatic arc: does it set up, build with rising stakes, turn at a climax, and pay off the setup? Flag dead beats, missing causality, and any scene that fails to advance the story.
You may lightly REPAIR weak scenes — sharpen the beat, fix a broken causal link, strengthen escalation — but keep the SAME scene ids, the same count, the same order, settings and characters. Never invent new plot threads and never change what the ending means.
Return STRICT JSON ONLY (no markdown):
{
  "tells_story": boolean,
  "score": number,
  "spine": string,
  "weak_beats": [{"id": number, "issue": string}],
  "notes": string,
  "scenes": [{"id": number, "function": string, "beat": string, "setting": string, "causal": string, "intent": string}]
}`;

export async function architect(plan, { model = "qwen-max" } = {}) {
  const brief = {
    title: plan.title, logline: plan.logline, theme: plan.theme, spine: plan.spine,
    scenes: (plan.scenes || []).map(s => ({ id: s.id, function: s.function, beat: s.beat, setting: s.setting, causal: s.causal, intent: s.intent }))
  };
  let r;
  try {
    const { text } = await chat(
      [{ role: "system", content: ARCH_SYS },
       { role: "user", content: `BEAT SHEET:\n${JSON.stringify(brief, null, 2)}` }],
      { model, temperature: 0.5, max_tokens: 4000 }
    );
    r = parseJson(text);
  } catch { return { ok: false, review: null, scenes: plan.scenes }; }
  // Merge improved scenes back ONLY if the shape is sane (same ids, same count).
  let scenes = plan.scenes;
  if (Array.isArray(r.scenes) && r.scenes.length === (plan.scenes || []).length) {
    const byId = new Map((plan.scenes || []).map(s => [s.id, s]));
    if (r.scenes.every(ns => byId.has(ns.id))) {
      scenes = r.scenes.map(ns => ({ ...byId.get(ns.id), ...ns, id: byId.get(ns.id).id }));
    }
  }
  const review = {
    tells_story: r.tells_story !== false,
    score: Number.isFinite(+r.score) ? +r.score : null,
    spine: r.spine || plan.spine || "",
    weak_beats: Array.isArray(r.weak_beats) ? r.weak_beats : [],
    notes: r.notes || ""
  };
  return { ok: true, review, scenes };
}

const REVIEW_SYS = `You are a STORY EDITOR watching a short film's storyboard frames IN ORDER to judge whether the PICTURES actually tell the written story.
You are given the film's spine and, for each sampled scene, its beat plus ONE representative frame. The images are provided in scene order.
For each scene, decide whether its frame CONVEYS its beat — the right subject, action, place and emotional read — and whether the frames in sequence build the story rather than feeling like disconnected images.
Return STRICT JSON ONLY (no markdown):
{
  "tells_story": boolean,
  "summary": string,
  "per_scene": [{"id": number, "conveys": boolean, "issue": string}],
  "weak_panels": [number]
}`;

// frames: [{ id, beat, url }] — caller samples/caps these (one per scene).
export async function storyReview(plan, frames, { model = "qwen3-vl-plus" } = {}) {
  const valid = (frames || []).filter(f => f && f.url);
  if (!valid.length) return { ok: false, review: null };
  const images = valid.map(f => f.url);
  const legend = valid.map((f, i) => `Image ${i + 1} = Scene ${f.id}: ${f.beat}`).join("\n");
  const prompt = `${REVIEW_SYS}\n\nFILM: ${plan.title || ""}\nSPINE: ${plan.spine || plan.logline || ""}\n\nFRAMES (in order):\n${legend}`;
  try {
    const { text } = await see(images, prompt, { model, max_tokens: 2000 });
    const r = parseJson(text);
    return {
      ok: true,
      review: {
        tells_story: r.tells_story !== false,
        summary: r.summary || "",
        per_scene: Array.isArray(r.per_scene) ? r.per_scene : [],
        weak_panels: Array.isArray(r.weak_panels) ? r.weak_panels : []
      }
    };
  } catch (e) { return { ok: false, review: null, error: e.message }; }
}

const CONTRA_SYS = `You are a SCRIPT SUPERVISOR checking a beat sheet for CONTINUITY CONTRADICTIONS against a locked continuity bible.
A contradiction is a beat that violates a LOCKED fact, breaks the established timeline/chronology, or makes an earlier-established fact impossible. Ordinary dramatic change, escalation, or a character choosing to act is NOT a contradiction.
Report ONLY high-confidence contradictions. For each, name the exact locked fact violated and the offending beat id.
Return STRICT JSON ONLY (no markdown):
{
  "ok": boolean,
  "conflicts": [{"id": number, "fact": string, "issue": string}],
  "notes": string
}`;

export async function contradictionCheck(plan, state, { model = "qwen-max" } = {}) {
  const locked = lockedFacts(state);
  if (!locked.length) return { ok: true, conflicts: [] };
  const brief = {
    lockedFacts: locked,
    timeline: state.timeline || [],
    scenes: (plan.scenes || []).map((s) => ({ id: s.id, beat: s.beat, causal: s.causal }))
  };
  try {
    const { text } = await chat(
      [{ role: "system", content: CONTRA_SYS },
       { role: "user", content: `CONTINUITY BIBLE + BEATS:\n${JSON.stringify(brief, null, 2)}` }],
      { model, temperature: 0.2, max_tokens: 1500 }
    );
    const r = parseJson(text);
    const conflicts = Array.isArray(r.conflicts) ? r.conflicts.filter((c) => Number.isFinite(+c.id)) : [];
    return { ok: conflicts.length === 0, conflicts, notes: r.notes || "" };
  } catch (e) { return { ok: true, conflicts: [], error: e.message }; }
}

const REPLAN_SYS = `You are a STORY EDITOR repairing ONLY the specific beats that CONTRADICT the continuity bible.
Rewrite each listed beat so it no longer violates the locked facts or the timeline, while keeping the SAME scene id, the same dramatic function and setting, and the overall arc intact. Do not touch any other beat.
Return STRICT JSON ONLY (no markdown):
{"scenes": [{"id": number, "function": string, "beat": string, "setting": string, "causal": string, "intent": string, "narration": string}]}
Return ONLY the rewritten beats you were asked to fix.`;

export async function replanBeats(plan, state, conflicts, { model = "qwen-max" } = {}) {
  const ids = [...new Set(conflicts.map((c) => +c.id))];
  const toFix = (plan.scenes || []).filter((s) => ids.includes(s.id));
  if (!toFix.length) return { ok: false, scenes: plan.scenes };
  const brief = {
    lockedFacts: lockedFacts(state), timeline: state.timeline || [],
    conflicts: conflicts.map((c) => ({ id: c.id, fact: c.fact, issue: c.issue })),
    beatsToFix: toFix.map((s) => ({ id: s.id, function: s.function, beat: s.beat, setting: s.setting, causal: s.causal, intent: s.intent, narration: s.narration || "" }))
  };
  try {
    const { text } = await chat(
      [{ role: "system", content: REPLAN_SYS },
       { role: "user", content: `BIBLE + CONFLICTS + BEATS:\n${JSON.stringify(brief, null, 2)}` }],
      { model, temperature: 0.5, max_tokens: 2500 }
    );
    const r = parseJson(text);
    if (!Array.isArray(r.scenes)) return { ok: false, scenes: plan.scenes };
    const byId = new Map(r.scenes.filter((s) => Number.isFinite(+s.id)).map((s) => [+s.id, s]));
    const merged = (plan.scenes || []).map((s) => (byId.has(s.id) ? { ...s, ...byId.get(s.id), id: s.id } : s));
    return { ok: true, scenes: merged };
  } catch (e) { return { ok: false, scenes: plan.scenes, error: e.message }; }
}

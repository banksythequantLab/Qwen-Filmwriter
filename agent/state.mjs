// agent/state.mjs — typed, lockable story-world state: the continuity source of truth.
// buildState() derives it from the plan; stateForScene() injects a lean scene-relevant slice;
// lockedFacts() flattens the immutable facts for the contradiction checker.
import { chat } from "../lib/qwen.mjs";
import { parseJson } from "./planner.mjs";

const STATE_SYS = `You are a SCRIPT SUPERVISOR building the continuity bible for a short film BEFORE it is shot.
From the plan (theme, spine, characters, beat sheet), extract a STRICT, typed state that downstream stages must never contradict.
Return STRICT JSON ONLY (no markdown):
{
  "characters": [{"name": string, "locked": [string], "facts": [string]}],
  "worldRules": [string],
  "timeline": [string],
  "openThreads": [string]
}
- "locked": invariants that MUST hold for the whole film unless the story EXPLICITLY changes them — a fixed trait, a death, an injury, a possession, a relationship, a rule of the world. Be conservative: list only things that would be a continuity ERROR if violated.
- "facts": other stable but non-locked details (look, role, want).
- "worldRules": setting/world constraints (era, technology, physics, tone) every scene must respect.
- "timeline": the ordered key events implied by the beats, so chronology can be checked.
- "openThreads": setups that must pay off (a planted object, a promise, a mystery) so none are dropped.
Keep each entry to one short clause. Do NOT invent facts unsupported by the plan.`;

export async function buildState(plan, { model = "qwen-plus" } = {}) {
  const brief = {
    title: plan.title, theme: plan.theme, spine: plan.spine,
    characters: (plan.characters || []).map((c) => ({ name: c.name, description: c.description })),
    scenes: (plan.scenes || []).map((s) => ({ id: s.id, function: s.function, beat: s.beat, causal: s.causal }))
  };
  // Always-on fallback: seed character records straight from the plan's cast so the bible is
  // never empty even when the extractor under-returns (e.g. gritty content partially refused).
  const fromPlan = () => (plan.characters || [])
    .filter((c) => c && c.name)
    .map((c) => ({ name: c.name, locked: [], facts: [c.description].filter(Boolean) }));
  try {
    const { text } = await chat(
      [{ role: "system", content: STATE_SYS },
       { role: "user", content: `PLAN:\n${JSON.stringify(brief, null, 2)}` }],
      { model, temperature: 0.3, max_tokens: 2000 }
    );
    const s = parseJson(text);
    const characters = Array.isArray(s.characters) && s.characters.length ? s.characters : fromPlan();
    return {
      characters,
      worldRules: Array.isArray(s.worldRules) ? s.worldRules : [],
      timeline: Array.isArray(s.timeline) ? s.timeline : [],
      openThreads: Array.isArray(s.openThreads) ? s.openThreads : []
    };
  } catch { return { characters: fromPlan(), worldRules: [], timeline: [], openThreads: [] }; }
}

// Compact, scene-relevant slice for prompt injection (keeps context lean).
export function stateForScene(state, scene) {
  if (!state) return "";
  const hay = `${scene.beat || ""} ${scene.setting || ""}`.toLowerCase();
  const named = (state.characters || []).filter((c) => c.name && hay.includes(String(c.name).toLowerCase().split(/\s+/)[0]));
  const chars = (named.length ? named : (state.characters || [])).slice(0, 4);
  const lines = [];
  for (const c of chars) {
    const locked = (c.locked || []).slice(0, 3);
    if (locked.length) lines.push(`${c.name} — MUST hold: ${locked.join("; ")}`);
  }
  const rules = (state.worldRules || []).slice(0, 4);
  if (rules.length) lines.push(`World rules: ${rules.join("; ")}`);
  return lines.join("\n");
}

// Flatten locked facts (+ world rules) for the contradiction checker.
export function lockedFacts(state) {
  const out = [];
  for (const c of (state?.characters || [])) for (const l of (c.locked || [])) out.push(`${c.name}: ${l}`);
  for (const r of (state?.worldRules || [])) out.push(`World: ${r}`);
  return out;
}

// agent/state.mjs — typed, lockable story-world state: the continuity source of truth.
// buildState() derives it from the plan; stateForScene() injects a lean scene-relevant slice;
// lockedFacts() flattens the immutable facts for the contradiction checker.
import { chat } from "../lib/qwen.mjs";
import { parseJson } from "./planner.mjs";

const STATE_SYS = `You are a SCRIPT SUPERVISOR building the continuity bible for a short film BEFORE it is shot.
From the plan (theme, spine, characters, beat sheet), extract a STRICT, typed state that downstream stages must never contradict.
Return STRICT JSON ONLY (no markdown):
{
  "characters": [{"name": string, "appearance": string, "locked": [string], "facts": [string]}],
  "props": [{"name": string, "look": string}],
  "worldRules": [string],
  "timeline": [string],
  "openThreads": [string]
}
- "appearance": ONE committed, SPECIFIC visual lock for this character that EVERY shot must match — exact wardrobe (each garment + its EXACT colors), hair (cut + color), build, and any distinguishing feature. Where the plan is vague (e.g. "neon accents", "dark outfit"), COMMIT to one concrete choice (e.g. "electric-blue neon piping on a matte-black tactical jacket") and keep it fixed for the entire film. Be decisive and specific — this is the single source of truth for how the character looks.
- "props": recurring physical objects that appear across scenes (a package, a weapon, a device, a vehicle). Give each a FIXED, specific look — shape, material, EXACT colors, any markings or lights — so it can never drift between shots. Commit specifics even when the plan is vague. Omit one-off background items.
- "locked": invariants that MUST hold for the whole film unless the story EXPLICITLY changes them — a fixed trait, a death, an injury, a possession, a relationship, a rule of the world. Be conservative: list only things that would be a continuity ERROR if violated.
- "facts": other stable but non-locked details (role, want, age).
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
    .map((c) => ({ name: c.name, appearance: c.description || "", locked: [], facts: [] }));
  try {
    const { text } = await chat(
      [{ role: "system", content: STATE_SYS },
       { role: "user", content: `PLAN:\n${JSON.stringify(brief, null, 2)}` }],
      { model, temperature: 0.3, max_tokens: 2000 }
    );
    const s = parseJson(text);
    let characters = Array.isArray(s.characters) && s.characters.length ? s.characters : fromPlan();
    // Backfill appearance from the plan's description when the extractor omitted it.
    const descByName = new Map((plan.characters || []).map((c) => [c.name, c.description]));
    characters = characters.map((c) => ({ ...c, appearance: c.appearance || descByName.get(c.name) || "" }));
    return {
      characters,
      props: Array.isArray(s.props) ? s.props.filter((p) => p && p.name && p.look) : [],
      worldRules: Array.isArray(s.worldRules) ? s.worldRules : [],
      timeline: Array.isArray(s.timeline) ? s.timeline : [],
      openThreads: Array.isArray(s.openThreads) ? s.openThreads : []
    };
  } catch { return { characters: fromPlan(), props: [], worldRules: [], timeline: [], openThreads: [] }; }
}

// Compact, scene-relevant slice for prompt injection (keeps context lean).
export function stateForScene(state, scene) {
  if (!state) return "";
  const hay = `${scene.beat || ""} ${scene.setting || ""}`.toLowerCase();
  const named = (state.characters || []).filter((c) => c.name && hay.includes(String(c.name).toLowerCase().split(/\s+/)[0]));
  const chars = (named.length ? named : (state.characters || [])).slice(0, 4);
  const lines = [];
  for (const c of chars) {
    if (c.appearance) lines.push(`${c.name} — APPEARANCE (identical in every shot): ${c.appearance}`);
    const locked = (c.locked || []).slice(0, 3);
    if (locked.length) lines.push(`${c.name} — MUST hold: ${locked.join("; ")}`);
  }
  const props = state.props || [];
  const relProps = props.filter((p) => hay.includes(String(p.name).toLowerCase().split(/\s+/)[0]));
  const showProps = (relProps.length ? relProps : props).slice(0, 4);
  if (showProps.length) lines.push(`Props (fixed look in every shot): ${showProps.map((p) => `${p.name} — ${p.look}`).join("; ")}`);
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

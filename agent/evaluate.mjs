// agent/evaluate.mjs — self-evaluation rubric. Scores a finished film on a weighted rubric and
// emits a single KPI (0-100) the showrunner can report. The continuity/identity/beat/through-line
// dimensions are computed from the QA SIGNALS the pipeline already produced during the run (so they
// are grounded, not vibes); craft is one holistic vision-jury pass over the final key frames.
import { see } from "../lib/qwen.mjs";
import { parseJson } from "./planner.mjs";

const CRAFT_SYS = `You are a film-festival juror giving ONE short film a CRAFT score. You are shown its key frames IN ORDER.
Judge ONLY visual craft and coherence: cinematography, lighting, composition, consistency of style and characters across the frames, and whether they read as one coherent film rather than unrelated images. Do NOT judge story logic (that is scored elsewhere).
Return STRICT JSON ONLY (no markdown): {"score": number, "critique": string} — score 0-100, critique max 25 words.`;

const clamp = (n) => Math.max(0, Math.min(100, Math.round(n)));

// signals: { continuity:{conflicts,resolved}, throughline:{breaks}, story:{tells_story,weak,unresolved,sampled}, identity:{drift,sampled} }
// frames:  ordered array of final still URLs (one per scene is ideal).
export async function evaluate({ plan, signals = {}, frames = [] } = {}, { model = "qwen3-vl-plus" } = {}) {
  // ---- grounded sub-scores from the in-run QA signals ----
  const cont = signals.continuity || { conflicts: 0, resolved: true };
  const clips = signals.clips || { checked: 0, flagged: 0 };
  const imgUnresolved = Math.max(0, (cont.breaks || 0) - (cont.fixed || 0));   // adjacent-frame breaks left unfixed
  let continuity = clamp(
    cont.conflicts === 0 ? 100
      : cont.resolved ? 100 - Math.min(20, 5 * cont.conflicts)     // found but auto-resolved -> light penalty
      : 100 - Math.min(60, 25 * cont.conflicts)                    // left unresolved -> heavy penalty
  );
  // fold in IMAGE-level continuity (script supervisor) + MOTION (clip QA) findings so the graders move the KPI
  continuity = clamp(continuity - Math.min(30, 8 * imgUnresolved) - Math.min(20, 6 * (clips.flagged || 0)));

  const tl = signals.throughline || { breaks: 0 };
  const throughline = clamp(100 - Math.min(45, 15 * (tl.breaks || 0)));

  const st = signals.story || { tells_story: true, weak: 0, unresolved: 0 };
  const beats = clamp((st.tells_story === false ? 65 : 90) - Math.min(30, 8 * (st.unresolved ?? st.weak ?? 0)));

  // Severity-weighted identity. The old 12-per-drift/60-cap formula SATURATED: any >=5 drift
  // complaints scored a flat 40 whether the character became a different person or a prop changed
  // shade — four straight runs read 40 while complaint granularity visibly improved, and the
  // reshoot targeter burned its budget on an axis that could not move. Now a MAJOR drift (reads as
  // a different character) costs 18, a MINOR one (same character, off detail) costs 5, cap 80.
  // Legacy signals without severity count everything as major (conservative, scores LOWER than before).
  const id = signals.identity || { drift: 0 };
  const idMajor = Number.isFinite(+id.major) ? +id.major : (id.drift || 0);
  const idMinor = Number.isFinite(+id.minor) ? +id.minor : 0;
  const identity = clamp(100 - Math.min(80, 18 * idMajor + 5 * idMinor));

  // ---- holistic craft judge over the actual final frames ----
  let craft = null, critique = "";
  const urls = (frames || []).filter(Boolean).slice(0, 8);
  if (urls.length >= 2) {
    try {
      const { text } = await see(urls, CRAFT_SYS, { model, temperature: 0, max_tokens: 300 });
      const r = parseJson(text);
      if (Number.isFinite(+r.score)) { craft = clamp(+r.score); critique = String(r.critique || "").slice(0, 160); }
    } catch { /* craft stays null -> renormalized out below */ }
  }

  // ---- weighted KPI (renormalize when craft is unavailable) ----
  const dims = { continuity, identity, beats, throughline, craft };
  const W = { continuity: 0.2, identity: 0.2, beats: 0.25, throughline: 0.15, craft: 0.2 };
  let num = 0, den = 0;
  for (const k of Object.keys(W)) { if (dims[k] == null) continue; num += W[k] * dims[k]; den += W[k]; }
  const score = clamp(den ? num / den : 0);

  const summary = critique
    || `continuity ${continuity}, identity ${identity}, beats ${beats}, through-line ${throughline}${craft != null ? `, craft ${craft}` : ""}`;
  return { score, dimensions: dims, summary, critique };
}

// Closed-loop helper: given the film's key frames IN ORDER and the weakest rubric dimension, name the
// single frame that most needs a re-shoot. The conductor uses this to target self-correction.
export async function weakestFrame(frames = [], dim = "craft", { model = "qwen3-vl-plus" } = {}) {
  const urls = (frames || []).filter(Boolean).slice(0, 8);
  if (urls.length < 2) return { frame: 1, why: "" };
  try {
    const sys = `You are a film editor. You see a short film's key frames IN ORDER (frame 1 to ${urls.length}). The film scored WEAKEST on "${dim}". Name the SINGLE frame number that most needs to be re-shot to raise ${dim}. Return STRICT JSON ONLY (no markdown): {"frame": number, "why": string} — why max 12 words.`;
    const { text } = await see(urls, sys, { model, temperature: 0, max_tokens: 120 });
    const r = parseJson(text);
    const frame = Math.max(1, Math.min(urls.length, Math.round(+r.frame) || 1));
    return { frame, why: String(r.why || "").slice(0, 140) };
  } catch { return { frame: 1, why: "" }; }
}

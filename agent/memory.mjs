// agent/memory.mjs — memory at scale. Keeps the per-scene "story so far" injection lean AND
// coherent on long films (the 24-scene chapter path) without unbounded context growth:
//   - relevantPriorBeats(): lexical-overlap retrieval of the most relevant EARLIER beats
//   - composeStorySoFar(): rolling summary + relevant earlier beats + a recent window
//   - rollingSummarize(): recursive compression of older beats (called lazily, long films only)
// Dependency-free: retrieval is salient-term overlap (no embeddings), summary reuses chat().
import { chat } from "../lib/qwen.mjs";

const STOP = new Set(
  ("the a an of and to in on at for with from into over under by as is are was were be been being it its this that " +
   "these those he she they them his her their our we you not but so then there here when where what which who into " +
   "scene shot film story beat").split(/\s+/)
);
function terms(text) {
  return [...new Set(
    String(text || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/)
      .filter((w) => w.length >= 4 && !STOP.has(w))
  )];
}

// Score EARLIER beats (older than the recent window) by salient-term overlap with the current
// scene, and return the top-k most relevant. This is what lets scene 20 recall scene 2's setup.
export function relevantPriorBeats(scene, priorBeats, k = 3, skipRecent = 6) {
  const pool = (priorBeats || []).slice(0, Math.max(0, (priorBeats || []).length - skipRecent));
  if (!pool.length) return [];
  const q = new Set(terms(`${scene.beat || ""} ${scene.setting || ""} ${scene.intent || ""}`));
  if (!q.size) return [];
  return pool
    .map((b) => ({ b, score: terms(b).reduce((n, w) => n + (q.has(w) ? 1 : 0), 0) }))
    .filter((x) => x.score > 0)
    .sort((a, c) => c.score - a.score)
    .slice(0, k)
    .map((x) => x.b);
}

// Compose a lean "story so far": optional rolling summary + relevant earlier beats + recent window.
export function composeStorySoFar(scene, priorBeats, { recent = 6, relevant = 3, summary = "" } = {}) {
  if (!priorBeats || !priorBeats.length) return "This is the opening of the film.";
  const recentBeats = priorBeats.slice(-recent);
  const recentSet = new Set(recentBeats);
  const rel = relevantPriorBeats(scene, priorBeats, relevant, recent).filter((b) => !recentSet.has(b));
  const parts = [];
  if (summary) parts.push(`Story so far (summary): ${summary}`);
  if (rel.length) parts.push(`Earlier relevant beats: ${rel.join(" → ")}`);
  parts.push(`Recent beats: ${recentBeats.join(" → ")}`);
  return parts.join("\n");
}

// Recursive summarization: compress older beats into a 2-3 sentence running summary.
// Called lazily (long films only) so short films pay zero latency.
export async function rollingSummarize(beats, { model = "qwen-plus" } = {}) {
  if (!beats || !beats.length) return "";
  try {
    const { text } = await chat(
      [{ role: "system", content: "Compress these film beats into a 2-3 sentence running summary capturing what has happened and any unresolved setups that still need to pay off. Plain prose, no list, no preamble." },
       { role: "user", content: beats.join("\n") }],
      { model, temperature: 0.3, max_tokens: 300 }
    );
    return (text || "").trim();
  } catch { return ""; }
}

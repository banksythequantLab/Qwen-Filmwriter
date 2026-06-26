// agent/throughline.mjs — THROUGH-LINE critic. Runs on the beat sheet BEFORE shooting.
// Finds the single central dramatic question + its payoff, flags beats that break the
// through-line, and — most importantly — emits per-scene MUST-SHOW visual requirements:
// the concrete things a viewer must actually SEE for the story to read. Those get injected
// into promptgen so the image prompt can't quietly drop or substitute the key story element
// (e.g. rendering "a comet" as a generic meteor, or never showing the camera malfunction).
import { chat } from "../lib/qwen.mjs";
import { parseJson } from "./planner.mjs";

const TL_SYS = `You are the SHOWRUNNER's STORY EDITOR doing a THROUGH-LINE pass on a short film's beat sheet BEFORE it is shot.
First, name the SINGLE central dramatic question the film poses and how it must pay off. Then check the spine plants and pays off that question, and flag any beat that breaks the through-line (a dropped setup, a payoff with no setup, a break in cause-and-effect).
MOST IMPORTANTLY: for EACH scene, list the concrete, VISIBLE elements that scene MUST show on screen for the through-line to read — the exact object, action, or change a viewer has to SEE, not infer. Be concrete and visual, naming the specific thing: e.g. "the comet visible as a faint streak high in the sky", "the camera's screen showing an error message", "the finished photo on the phone clearly showing the comet". 2 to 4 items per scene, each a short visual phrase. List ONLY things grounded in that scene's own beat; never invent new plot.
Return STRICT JSON ONLY (no markdown):
{
  "question": string,
  "payoff": string,
  "breaks": [{"id": number, "issue": string}],
  "mustShow": [{"id": number, "items": [string]}]
}`;

export async function throughline(plan, { model = "qwen-max" } = {}) {
  const brief = {
    title: plan.title, logline: plan.logline, theme: plan.theme, spine: plan.spine,
    scenes: (plan.scenes || []).map((s) => ({ id: s.id, function: s.function, beat: s.beat, setting: s.setting, intent: s.intent }))
  };
  try {
    const { text } = await chat(
      [{ role: "system", content: TL_SYS },
       { role: "user", content: `BEAT SHEET:\n${JSON.stringify(brief, null, 2)}` }],
      { model, temperature: 0.4, max_tokens: 2500 }
    );
    const r = parseJson(text);
    const mustShow = {};
    for (const m of (Array.isArray(r.mustShow) ? r.mustShow : [])) {
      if (Number.isFinite(+m.id) && Array.isArray(m.items)) {
        const items = m.items.map((s) => String(s).trim()).filter(Boolean).slice(0, 4);
        if (items.length) mustShow[+m.id] = items;
      }
    }
    return {
      ok: true,
      question: r.question || "",
      payoff: r.payoff || "",
      breaks: Array.isArray(r.breaks) ? r.breaks.filter((b) => Number.isFinite(+b.id)) : [],
      mustShow
    };
  } catch (e) { return { ok: false, question: "", payoff: "", breaks: [], mustShow: {}, error: e.message }; }
}

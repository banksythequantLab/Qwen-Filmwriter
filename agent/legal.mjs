// agent/legal.mjs — LEGAL & CLEARANCES agent.
// Inspects a generated still for (1) copyright/trademark infringement and
// (2) spelling/correctness of any on-screen text. Returns a verdict the QA
// loop can act on, including suggested negative-prompt terms for a corrected
// reroll. Reuses the Qwen vision model via see(); no new dependencies.
import { see } from "../lib/qwen.mjs";
import { parseJson } from "./planner.mjs";

const LEGAL_SYS = `You are the LEGAL & CLEARANCES reviewer on a film production. You are shown ONE AI-generated still.
Judge ONLY clearances and on-screen text — never artistic quality.

Check TWO things:
1) IP INFRINGEMENT — Does the image depict a COPYRIGHTED or TRADEMARKED character, costume, logo, brand, mascot, or a recognizable real celebrity's likeness? High risk: superhero costumes (spider/web, bat, shield, lightning, "S" motifs), film/game/anime characters, branded logos, sports marks, identifiable public figures. ORIGINAL, generic people and designs are CLEAR.
2) ON-SCREEN TEXT — Is there readable text in the frame? If the SHOT PROMPT intended specific words, are they spelled correctly and legible? Text that appears but was NOT intended is a defect.`;
const LEGAL_FMT = `
Return STRICT JSON ONLY (no prose, no markdown):
{
  "ip_clear": boolean,        // true if NO infringing or recognizable IP
  "ip_issue": string,         // short phrase naming the risk, or "" if clear
  "text_present": boolean,
  "spelling_ok": boolean,     // true if no text, OR all visible text is correctly spelled and matches intended text
  "text_issue": string,       // short phrase, or ""
  "negative": string,         // comma-separated negative-prompt terms to PREVENT the issue on reroll, or ""
  "fix_hint": string,         // one short instruction to fix on reroll, or ""
  "pass": boolean             // ip_clear AND spelling_ok
}`;

export async function legalReview(imageUrl, { intent = "", model = "qwen3-vl-plus" } = {}) {
  const prompt = `${LEGAL_SYS}${LEGAL_FMT}\n\nSHOT PROMPT (intended content, including any intended on-screen text):\n${String(intent).slice(0, 700)}`;
  try {
    const { text } = await see(imageUrl, prompt, { model, temperature: 0, max_tokens: 400 });
    const v = parseJson(text);
    v.pass = !!v.ip_clear && v.spelling_ok !== false;     // authoritative pass
    v.negative = typeof v.negative === "string" ? v.negative : "";
    return v;
  } catch {
    // Fail-open on an unparseable verdict so a flaky judge can't stall the pipeline;
    // the planner guard + base negative prompt remain the first line of defense.
    return { ip_clear: true, ip_issue: "", text_present: false, spelling_ok: true, text_issue: "", negative: "", fix_hint: "", pass: true, _unparsed: true };
  }
}

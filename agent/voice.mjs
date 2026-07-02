// agent/voice.mjs — synth a scene's narration + dialogue to a WAV, with SOUND QA:
// DURATION FIT — the stitcher hard-caps audio at video length (-shortest / -t), so a take longer
//   than its scene gets truncated MID-SENTENCE in the final film. When maxDur is known, an overrun
//   is shortened (same meaning, fewer words) and re-taken once instead.
// ASR VERIFY (QWEN_VO_VERIFY=0 disables) — the take is transcribed with qwen3-asr-flash and must
//   actually SAY the script; a mangled take gets one re-take. Fails open.
import { spawn } from "node:child_process";
import { speak, download, chat } from "../lib/qwen.mjs";
import { verifyVO } from "./sound.mjs";

function wavDuration(p) {
  return new Promise((res) => {
    const ff = spawn("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", p]);
    let out = ""; ff.stdout.on("data", (d) => (out += d));
    ff.on("close", () => res(parseFloat(out) || 0));
    ff.on("error", () => res(0));
  });
}

export async function voiceForScene(scene, outPath, { voice = "Cherry", maxDur = 0, log = () => {} } = {}) {
  let text = [scene.narration, ...(scene.dialogue || []).map((d) => d?.line)].filter((x) => x && String(x).trim()).join("  ").trim();
  if (!text) return null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const sp = await speak(text, { voice });
    if (!sp.url) return null;
    await download(sp.url, outPath);
    // DURATION FIT: shorten-and-retake beats a mid-sentence cut in the final film.
    if (maxDur > 0 && attempt === 1) {
      const d = await wavDuration(outPath);
      if (d > maxDur + 0.4) {
        log(`   vo: take runs ${d.toFixed(1)}s over a ${maxDur.toFixed(1)}s scene — shortening, re-taking`);
        try {
          const words = Math.max(4, Math.floor(maxDur * 2.3));
          const { text: shorter } = await chat([{ role: "user", content: `Shorten this voiceover line so it reads aloud in at most ${words} words. Keep the same narrator voice and story meaning. Return ONLY the line, no quotes:\n${text}` }], { temperature: 0.2, max_tokens: 120 });
          if (shorter && shorter.trim()) { text = shorter.trim().replace(/^["']|["']$/g, ""); continue; }
        } catch { /* keep the long take rather than fail the scene */ }
      }
    }
    // ASR VERIFY: the take must say the script.
    if (process.env.QWEN_VO_VERIFY !== "0") {
      const v = await verifyVO(outPath, text);
      if (!v._skipped) {
        log(`   vo: asr ${v.ok ? "verified" : "MISMATCH"} (${v.sim})${v.ok ? "" : " — " + (attempt === 1 ? "re-taking" : "kept best effort")}`);
        if (!v.ok && attempt === 1) continue;
      }
    }
    return outPath;
  }
  return outPath;
}

// voiceForShot — synth a shot's narration + dialogue to WAV. Returns path or null.
export async function voiceForShot(shot, outPath, opts = {}) {
  return voiceForScene(shot, outPath, opts);
}

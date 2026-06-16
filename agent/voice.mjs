// agent/voice.mjs — synth a scene's narration + dialogue to a WAV. Returns path or null.
import { speak, download } from "../lib/qwen.mjs";

export async function voiceForScene(scene, outPath, { voice = "Cherry" } = {}) {
  const lines = [];
  if (scene.narration) lines.push(scene.narration);
  for (const d of scene.dialogue || []) if (d?.line) lines.push(d.line);
  const text = lines.join("  ").trim();
  if (!text) return null;
  const sp = await speak(text, { voice });
  if (!sp.url) return null;
  await download(sp.url, outPath);
  return outPath;
}

// voiceForShot — synth a shot's narration + dialogue to WAV. Returns path or null.
export async function voiceForShot(shot, outPath, { voice = "Cherry" } = {}) {
  return voiceForScene(shot, outPath, { voice });
}

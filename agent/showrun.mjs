// agent/showrun.mjs — the conductor. logline -> finished short, fully autonomous.
// plan(scenes) -> shotlist(per scene) -> promptgen(per shot) -> renderShot -> voice -> stitch
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { plan } from "./planner.mjs";
import { shotlist } from "./shotlist.mjs";
import { promptgen } from "./promptgen.mjs";
import { renderShot } from "./render.mjs";
import { voiceForShot } from "./voice.mjs";
import { buildSegment, concat } from "./stitch.mjs";
import { download } from "../lib/qwen.mjs";

export async function showrun(logline, { scenes = 3, outDir = "output/film", render = true, log = console.log } = {}) {
  const dir = path.resolve(outDir);
  mkdirSync(dir, { recursive: true });
  log(`\n== SHOWRUN ==\n"${logline}"`);

  // 1) Story plan (beats)
  const { plan: p } = await plan(logline, { scenes });
  log(`title: ${p.title}  |  ${p.scenes.length} scenes  |  style: ${p.style}`);

  // 2) Expand: scene -> shots -> crafted per-shot prompts
  const board = [];
  for (const scene of p.scenes) {
    const { shots } = await shotlist(scene, { style: p.style, characters: p.characters });
    log(`  scene ${scene.id} "${scene.beat}" -> ${shots.length} shot(s)`);
    for (const shot of shots) {
      const prompts = await promptgen(shot, { style: p.style, characters: p.characters, setting: scene.setting });
      board.push({ sceneId: scene.id, shot, prompts });
      log(`     shot ${scene.id}.${shot.id} [${shot.type} ${shot.mode} ${shot.duration}s] ${(shot.action || "").slice(0, 56)}`);
    }
  }
  writeFileSync(path.join(dir, "storyboard.json"), JSON.stringify({ plan: p, board }, null, 2));
  log(`storyboard: ${board.length} shots -> ${path.join(outDir, "storyboard.json")}`);
  if (!render) return { title: p.title, shots: board.length, storyboard: path.join(dir, "storyboard.json") };

  // 3) Render each shot -> normalized segment
  const segs = [];
  let i = 0;
  for (const { sceneId, shot, prompts } of board) {
    const tag = `${sceneId}_${shot.id}`;
    log(`\n-- shot ${tag} [${shot.type} ${shot.mode} ${shot.duration}s]`);
    const voiceName = pickVoice(p, shot);
    const r = await renderShot(shot, prompts, {
      style: p.style,
      onStill: (a, v) => log(`   still ${a}: pass=${v.pass}${v.pass ? "" : "  fix: " + (v.fix_hint || "-")}`),
      onClip: (st, sec) => log(`   ${shot.mode} [${sec}s] ${st}`),
    });
    const clipPath = path.join(dir, `clip_${tag}.mp4`);
    await download(r.clipUrl, clipPath);
    const voPath = await voiceForShot(shot, path.join(dir, `vo_${tag}.wav`), { voice: voiceName });
    const segPath = path.join(dir, `seg_${String(++i).padStart(2, "0")}_${tag}.mp4`);
    await buildSegment(clipPath, voPath, segPath);
    segs.push(segPath);
    log(`   segment ready (voice=${!!voPath})`);
  }

  // 4) Final cut
  const finalPath = path.join(dir, "final.mp4");
  await concat(segs, finalPath, path.join(dir, "concat.txt"));
  log(`\nFINAL CUT: ${finalPath}`);
  return { title: p.title, finalPath, shots: board.length };
}

function pickVoice(p, shot) {
  const ch = shot.dialogue?.[0]?.character;
  return (ch && p.characters?.find((c) => c.name === ch)?.voice) || p.characters?.[0]?.voice || "Cherry";
}

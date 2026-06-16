// agent/showrun.mjs — the conductor. logline -> finished short, fully autonomous.
// plan -> per scene: shotlist (picks strategy) -> promptgen -> render (montage | longtake) -> stitch
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { plan } from "./planner.mjs";
import { shotlist } from "./shotlist.mjs";
import { promptgen } from "./promptgen.mjs";
import { renderShot } from "./render.mjs";
import { voiceForShot } from "./voice.mjs";
import { editorPlan, assembleEdit } from "./editor.mjs";
import { buildSegment, concat } from "./stitch.mjs";
import { video, download } from "../lib/qwen.mjs";

export async function showrun(logline, { scenes = 3, outDir = "output/film", render = true, forceStrategy, log = console.log } = {}) {
  const dir = path.resolve(outDir);
  mkdirSync(dir, { recursive: true });
  log(`\n== SHOWRUN ==\n"${logline}"`);

  const { plan: p } = await plan(logline, { scenes });
  log(`title: ${p.title}  |  ${p.scenes.length} scenes  |  style: ${p.style}`);

  // Expand: scene -> { strategy, shots(+prompts) }
  const scenesPlan = [];
  for (const scene of p.scenes) {
    const { strategy, shots } = await shotlist(scene, { style: p.style, characters: p.characters });
    const entries = [];
    for (const shot of shots) {
      const prompts = await promptgen(shot, { style: p.style, characters: p.characters, setting: scene.setting });
      entries.push({ shot, prompts });
    }
    const strat = forceStrategy || (entries.length >= 2 ? strategy : "montage");
    scenesPlan.push({ scene, strategy: strat, shots: entries });
    log(`  scene ${scene.id} [${strat}] -> ${entries.length} shot(s)`);
  }
  writeFileSync(path.join(dir, "storyboard.json"), JSON.stringify({ plan: p, scenes: scenesPlan }, null, 2));
  if (!render) return { title: p.title, scenes: scenesPlan.length, storyboard: path.join(dir, "storyboard.json") };

  // Render each scene -> one uniform scene clip
  const sceneClips = [];
  for (const sp of scenesPlan) {
    const clip = (sp.strategy === "longtake" && sp.shots.length >= 2)
      ? await renderSceneLongtake(sp, p, dir, log)
      : await renderSceneMontage(sp, p, dir, log);
    if (clip) sceneClips.push(clip);
  }

  const finalPath = path.join(dir, "final.mp4");
  await concat(sceneClips, finalPath, path.join(dir, "final_concat.txt"));
  log(`\nFINAL CUT: ${finalPath}`);
  return { title: p.title, finalPath, scenes: scenesPlan.length };
}

// Montage: each shot -> clip -> segment, concat into one scene clip.
async function renderSceneMontage(sp, p, dir, log) {
  const segs = [];
  let i = 0;
  for (const { shot, prompts } of sp.shots) {
    const tag = `${sp.scene.id}_${shot.id}`;
    log(`-- shot ${tag} [montage ${shot.mode} ${shot.duration}s]`);
    const r = await renderShot(shot, prompts, { style: p.style,
      onStill: (a, v) => log(`   still ${a}: pass=${v.pass}`), onClip: (st, s) => log(`   ${shot.mode} [${s}s] ${st}`) });
    const clipPath = path.join(dir, `clip_${tag}.mp4`);
    await download(r.clipUrl, clipPath);
    const voPath = await voiceForShot(shot, path.join(dir, `vo_${tag}.wav`), { voice: pickVoice(p, shot) });
    const seg = path.join(dir, `seg_${tag}_${String(++i).padStart(2, "0")}.mp4`);
    await buildSegment(clipPath, voPath, seg);
    segs.push(seg);
  }
  const sceneClip = path.join(dir, `scene_${sp.scene.id}.mp4`);
  await concat(segs, sceneClip, path.join(dir, `scene_${sp.scene.id}_concat.txt`));
  return sceneClip;
}

// Long-take: spine = continuous take (t2v), rest = cutaways (i2v), editor EDL -> assemble.
async function renderSceneLongtake(sp, p, dir, log) {
  const spine = sp.shots[0];
  const cutaways = sp.shots.slice(1);
  const takeDur = Math.min(10, Math.max(5, sp.shots.reduce((a, s) => a + (s.shot.duration || 3), 0)));
  log(`-- scene ${sp.scene.id} [longtake] spine + ${cutaways.length} cutaway(s), take ~${takeDur}s`);

  const take = await video(`${spine.prompts.image_prompt}. ${spine.prompts.motion_prompt || ""}. Overall style: ${p.style}`.trim(),
    { size: "1280*720", shot_type: "multi", duration: takeDur, onTick: (st, s) => log(`   take [${s}s] ${st}`) });
  const takePath = path.join(dir, `take_${sp.scene.id}.mp4`);
  await download(take.url, takePath);

  const cutawayPaths = {}, meta = [];
  for (const { shot, prompts } of cutaways) {
    const cid = `s${sp.scene.id}_${shot.id}`;
    const r = await renderShot({ ...shot, mode: "i2v" }, prompts, { style: p.style,
      onStill: (a, v) => log(`   cut ${cid} still ${a}: pass=${v.pass}`), onClip: (st, s) => log(`   cut ${cid} [${s}s] ${st}`) });
    const cpath = path.join(dir, `cutaway_${cid}.mp4`);
    await download(r.clipUrl, cpath);
    cutawayPaths[cid] = cpath;
    meta.push({ id: cid, duration: shot.duration || 3, description: prompts.image_prompt.slice(0, 160) });
  }

  let sceneClip = takePath;
  if (meta.length) {
    const edl = await editorPlan({ duration: takeDur, description: spine.prompts.image_prompt.slice(0, 160) }, meta);
    log(`   EDL: ${edl.length} cuts`);
    sceneClip = path.join(dir, `scene_${sp.scene.id}_edited.mp4`);
    await assembleEdit(takePath, cutawayPaths, edl, sceneClip, dir);
  }

  // Normalize + narration bed (spine's narration) over the cut-up scene.
  const voPath = await voiceForShot(spine.shot, path.join(dir, `vo_s${sp.scene.id}.wav`), { voice: pickVoice(p, spine.shot) });
  const sceneFinal = path.join(dir, `scene_${sp.scene.id}.mp4`);
  await buildSegment(sceneClip, voPath, sceneFinal);
  return sceneFinal;
}

function pickVoice(p, shot) {
  const ch = shot.dialogue?.[0]?.character;
  return (ch && p.characters?.find((c) => c.name === ch)?.voice) || p.characters?.[0]?.voice || "Cherry";
}

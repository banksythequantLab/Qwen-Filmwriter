// agent/showrun.mjs — the conductor. logline -> finished short, fully autonomous.
// plan -> per scene: shotlist (picks strategy) -> promptgen -> render (montage | longtake) -> stitch
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { plan } from "./planner.mjs";
import { adapt } from "./planner.mjs";
import { shotlist } from "./shotlist.mjs";
import { promptgen } from "./promptgen.mjs";
import { renderShot } from "./render.mjs";
import { approvedStill } from "./visualQA.mjs";
import { voiceForShot } from "./voice.mjs";
import { editorPlan, assembleEdit } from "./editor.mjs";
import { buildSegment, concat, finalize } from "./stitch.mjs";
import { video, download } from "../lib/qwen.mjs";

export async function showrun(input, { scenes = 3, source = "logline", maxScenes = 24, outDir = "output/film", render = true, forceStrategy, log = console.log, onEvent = () => {} } = {}) {
  const dir = path.resolve(outDir);
  mkdirSync(dir, { recursive: true });
  const emit = (id, patch) => { try { onEvent({ id, ...patch }); } catch {} };
  const preview = source === "chapter" ? input.replace(/\s+/g, " ").slice(0, 90) + "…" : `"${input}"`;
  log(`\n== SHOWRUN ==\n${preview}`);

  const { plan: p } = source === "chapter"
    ? await adapt(input, { maxScenes })
    : await plan(input, { scenes });
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

  // Register storyboard panels up front so the UI shows the board filling in live.
  if (p.characters?.[0]) emit("ref", { scene: 0, label: `Reference · ${p.characters[0].name}`, status: "pending" });
  for (const sp of scenesPlan) {
    const isLong = sp.strategy === "longtake" && sp.shots.length >= 2;
    const pans = isLong
      ? [{ id: `${sp.scene.id}_spine`, label: `S${sp.scene.id} · take` },
         ...sp.shots.slice(1).map(({ shot }) => ({ id: `s${sp.scene.id}_${shot.id}`, label: `S${sp.scene.id} · cut ${shot.id}` }))]
      : sp.shots.map(({ shot }) => ({ id: `${sp.scene.id}_${shot.id}`, label: `S${sp.scene.id} · shot ${shot.id}` }));
    for (const pn of pans) emit(pn.id, { scene: sp.scene.id, label: pn.label, status: "pending" });
  }
  if (!render) return { title: p.title, scenes: scenesPlan.length, storyboard: path.join(dir, "storyboard.json") };

  // Character reference (subject consistency): one approved portrait, reused across every shot.
  let referenceUrl = null;
  const lead = p.characters?.[0];
  if (lead) {
    log(`reference: ${lead.name} ...`);
    emit("ref", { status: "drawing" });
    const ref = await approvedStill(
      `Character model sheet of ${lead.name}: ${lead.description}. ${p.style}. Front view, head and shoulders, on a clean pure white seamless studio background, soft even lighting, subtle contact shadow only, no text.`,
      { size: "1328*1328", maxRetries: 1, onStep: (a, v, url) => { log(`   ref still ${a}: pass=${v.pass}`); emit("ref", { status: v.pass ? "frame" : "drawing", stillUrl: url, attempt: a, pass: v.pass }); } });
    referenceUrl = ref.url;
    emit("ref", { status: "frame", stillUrl: ref.url });
    if (referenceUrl) await download(referenceUrl, path.join(dir, "character_ref.png"));
  }

  // Render each scene -> one uniform scene clip
  const sceneClips = [];
  for (const sp of scenesPlan) {
    const clip = (sp.strategy === "longtake" && sp.shots.length >= 2)
      ? await renderSceneLongtake(sp, p, dir, log, referenceUrl, emit)
      : await renderSceneMontage(sp, p, dir, log, referenceUrl, emit);
    if (clip) sceneClips.push(clip);
  }

  const finalRaw = path.join(dir, "final_raw.mp4");
  await concat(sceneClips, finalRaw, path.join(dir, "final_concat.txt"));
  const finalPath = path.join(dir, "final.mp4");
  await finalize(finalRaw, finalPath);   // cinematic fade in/out
  log(`\nFINAL CUT: ${finalPath}`);
  return { title: p.title, finalPath, scenes: scenesPlan.length };
}

// Montage: each shot -> clip -> segment, concat into one scene clip.
async function renderSceneMontage(sp, p, dir, log, referenceUrl, emit = () => {}) {
  const segs = [];
  let i = 0;
  for (const { shot, prompts } of sp.shots) {
    const tag = `${sp.scene.id}_${shot.id}`;
    log(`-- shot ${tag} [montage ${shot.mode} ${shot.duration}s]`);
    const r = await renderShot(shot, prompts, { style: p.style, referenceUrl,
      onStill: (a, v, url) => { log(`   still ${a}: pass=${v.pass}`); emit(tag, { status: v.pass ? "frame" : "drawing", stillUrl: url, attempt: a, pass: v.pass }); },
      onClipStart: () => emit(tag, { status: "video_pending" }),
      onClip: (st, s) => { log(`   ${shot.mode} [${s}s] ${st}`); emit(tag, { status: st === "SUCCEEDED" ? "clip" : "animating", secs: s }); } });
    emit(tag, { status: "clip" });
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

// Long-take: spine = reference-anchored still -> multi-shot i2v take; rest = cutaways (i2v); editor EDL -> assemble.
async function renderSceneLongtake(sp, p, dir, log, referenceUrl, emit = () => {}) {
  const spine = sp.shots[0];
  const cutaways = sp.shots.slice(1);
  const takeDur = Math.min(10, Math.max(5, sp.shots.reduce((a, s) => a + (s.shot.duration || 3), 0)));
  const spineId = `${sp.scene.id}_spine`;
  log(`-- scene ${sp.scene.id} [longtake] spine + ${cutaways.length} cutaway(s), take ~${takeDur}s`);

  // spine: reference-anchored still -> multi-shot i2v take (preserves the lead's identity across the take)
  const spineStill = await approvedStill(`${spine.prompts.image_prompt}. Overall style: ${p.style}`,
    { referenceUrl, onStep: (a, v, url) => { log(`   spine still ${a}: pass=${v.pass}`); emit(spineId, { status: v.pass ? "frame" : "drawing", stillUrl: url, attempt: a, pass: v.pass }); } });
  emit(spineId, { status: "video_pending" });
  const take = await video(spine.prompts.motion_prompt || "slow cinematic camera move, continuous flowing take",
    { imageUrl: spineStill.url, resolution: "720P", shot_type: "multi", duration: takeDur, onTick: (st, s) => { log(`   take [${s}s] ${st}`); emit(spineId, { status: st === "SUCCEEDED" ? "clip" : "animating", secs: s }); } });
  emit(spineId, { status: "clip" });
  const takePath = path.join(dir, `take_${sp.scene.id}.mp4`);
  await download(take.url, takePath);

  const cutawayPaths = {}, meta = [];
  for (const { shot, prompts } of cutaways) {
    const cid = `s${sp.scene.id}_${shot.id}`;
    const r = await renderShot({ ...shot, mode: "i2v" }, prompts, { style: p.style, referenceUrl,
      onStill: (a, v, url) => { log(`   cut ${cid} still ${a}: pass=${v.pass}`); emit(cid, { status: v.pass ? "frame" : "drawing", stillUrl: url, attempt: a, pass: v.pass }); },
      onClipStart: () => emit(cid, { status: "video_pending" }),
      onClip: (st, s) => { log(`   cut ${cid} [${s}s] ${st}`); emit(cid, { status: st === "SUCCEEDED" ? "clip" : "animating", secs: s }); } });
    emit(cid, { status: "clip" });
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

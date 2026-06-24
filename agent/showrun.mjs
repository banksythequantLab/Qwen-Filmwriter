// agent/showrun.mjs — the conductor. logline -> finished short, fully autonomous.
// plan -> per scene: shotlist (picks strategy) -> promptgen -> render (montage | longtake) -> stitch
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { plan } from "./planner.mjs";
import { adapt } from "./planner.mjs";
import { shotlist } from "./shotlist.mjs";
import { promptgen } from "./promptgen.mjs";
import { approvedStill } from "./visualQA.mjs";
import { voiceForShot } from "./voice.mjs";
import { editorPlan, assembleEdit } from "./editor.mjs";
import { buildSegment, concat, finalize } from "./stitch.mjs";
import { video, download } from "../lib/qwen.mjs";

export async function showrun(input, { scenes = 3, source = "logline", maxScenes = 24, outDir = "output/film", render = true, forceStrategy, voiceover = false, log = console.log, onEvent = () => {} } = {}) {
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

  // ---- PHASE 1: STORYBOARD — generate every still in parallel (capped), board-first ----
  // imageEdit (subject-consistency) has a strict rate quota -> stills sequential by default;
  // video is the slow part and uses a separate quota -> parallelize that. Both env-tunable.
  const STILL_CC = +(process.env.QWEN_STILL_CC || 1), VIDEO_CC = +(process.env.QWEN_VIDEO_CC || 2);
  const units = [];
  for (const sp of scenesPlan) {
    const isLong = sp.strategy === "longtake" && sp.shots.length >= 2;
    const takeDur = Math.min(10, Math.max(5, sp.shots.reduce((a, s) => a + (s.shot.duration || 3), 0)));
    sp.shots.forEach(({ shot, prompts }, idx) => {
      const role = isLong ? (idx === 0 ? "spine" : "cutaway") : "montage";
      const id = role === "spine" ? `${sp.scene.id}_spine`
               : role === "cutaway" ? `s${sp.scene.id}_${shot.id}`
               : `${sp.scene.id}_${shot.id}`;
      units.push({ id, sceneId: sp.scene.id, role, shot, prompts, takeDur });
    });
  }
  log(`storyboard: ${units.length} panels (stills x${STILL_CC} parallel)`);
  await mapLimit(units, STILL_CC, async (u) => {
    const imgPrompt = `${u.prompts.image_prompt}. Overall style: ${p.style}`;
    const still = await approvedStill(imgPrompt, { referenceUrl,
      onStep: (a, v, url) => { log(`   ${u.id} still ${a}: pass=${v.pass}`); emit(u.id, { status: v.pass ? "frame" : "drawing", stillUrl: url, attempt: a, pass: v.pass }); } });
    u.stillUrl = still.url;
    emit(u.id, { status: "frame", stillUrl: still.url });
  });

  // ---- PHASE 2: ANIMATE — dispatch videos with bounded concurrency (free-tier safe) ----
  log(`animate: ${units.length} clips (video x${VIDEO_CC} parallel)`);
  await mapLimit(units, VIDEO_CC, async (u) => {
    emit(u.id, { status: "video_pending" });
    const onTick = (st, s) => { log(`   ${u.id} [${s}s] ${st}`); emit(u.id, { status: st === "SUCCEEDED" ? "clip" : "animating", secs: s }); };
    let clip;
    if (u.role === "spine") {
      clip = await video(u.prompts.motion_prompt || "slow cinematic camera move, continuous flowing take",
        { imageUrl: u.stillUrl, resolution: "720P", shot_type: "multi", duration: u.takeDur, onTick });
    } else if (u.role === "cutaway" || u.shot.mode === "i2v") {
      clip = await video(u.prompts.motion_prompt || "subtle natural motion, slow cinematic camera move",
        { imageUrl: u.stillUrl, resolution: "720P", duration: u.shot.duration, onTick });
    } else {
      clip = await video(`${u.prompts.image_prompt}. Overall style: ${p.style}. ${u.prompts.motion_prompt || ""}`.trim(),
        { size: "1280*720", shot_type: "multi", onTick });
    }
    emit(u.id, { status: "clip" });
    u.clipPath = path.join(dir, `clip_${u.id}.mp4`);
    await download(clip.url, u.clipPath);
  });

  // ---- PHASE 3: ASSEMBLE — sequential local ffmpeg (EDL + narration + concat) ----
  const sceneClips = [];
  for (const sp of scenesPlan) {
    const isLong = sp.strategy === "longtake" && sp.shots.length >= 2;
    const us = units.filter((u) => u.sceneId === sp.scene.id);
    let sceneFinal;
    if (isLong) {
      const spineU = us.find((u) => u.role === "spine");
      const cuts = us.filter((u) => u.role === "cutaway");
      let sceneClip = spineU.clipPath;
      if (cuts.length) {
        const meta = cuts.map((u) => ({ id: u.id, duration: u.shot.duration || 3, description: u.prompts.image_prompt.slice(0, 160) }));
        const edl = await editorPlan({ duration: spineU.takeDur, description: spineU.prompts.image_prompt.slice(0, 160) }, meta);
        log(`  scene ${sp.scene.id} EDL: ${edl.length} cuts`);
        sceneClip = path.join(dir, `scene_${sp.scene.id}_edited.mp4`);
        await assembleEdit(spineU.clipPath, Object.fromEntries(cuts.map((u) => [u.id, u.clipPath])), edl, sceneClip, dir);
      }
      const voPath = voiceover ? await voiceForShot(spineU.shot, path.join(dir, `vo_s${sp.scene.id}.wav`), { voice: pickVoice(p, spineU.shot) }) : null;
      sceneFinal = path.join(dir, `scene_${sp.scene.id}.mp4`);
      await buildSegment(sceneClip, voPath, sceneFinal);
    } else {
      const segs = [];
      let i = 0;
      for (const u of us) {
        const voPath = voiceover ? await voiceForShot(u.shot, path.join(dir, `vo_${u.id}.wav`), { voice: pickVoice(p, u.shot) }) : null;
        const seg = path.join(dir, `seg_${u.id}_${String(++i).padStart(2, "0")}.mp4`);
        await buildSegment(u.clipPath, voPath, seg);
        segs.push(seg);
      }
      sceneFinal = path.join(dir, `scene_${sp.scene.id}.mp4`);
      await concat(segs, sceneFinal, path.join(dir, `scene_${sp.scene.id}_concat.txt`));
    }
    sceneClips.push(sceneFinal);
  }

  const finalRaw = path.join(dir, "final_raw.mp4");
  await concat(sceneClips, finalRaw, path.join(dir, "final_concat.txt"));
  const finalPath = path.join(dir, "final.mp4");
  await finalize(finalRaw, finalPath);   // cinematic fade in/out
  log(`\nFINAL CUT: ${finalPath}`);
  return { title: p.title, finalPath, scenes: scenesPlan.length };
}


// Bounded-concurrency map: run fn over items with at most n in flight at once.
async function mapLimit(items, n, fn) {
  const ret = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(n, items.length) || 1 }, async () => {
    while (i < items.length) { const idx = i++; ret[idx] = await fn(items[idx], idx); }
  });
  await Promise.all(workers);
  return ret;
}

function pickVoice(p, shot) {
  const ch = shot.dialogue?.[0]?.character;
  return (ch && p.characters?.find((c) => c.name === ch)?.voice) || p.characters?.[0]?.voice || "Cherry";
}

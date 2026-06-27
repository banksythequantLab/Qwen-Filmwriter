// agent/showrun.mjs — the conductor. logline -> finished short, fully autonomous.
// plan -> per scene: shotlist (picks strategy) -> promptgen -> render (montage | longtake) -> stitch
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { plan } from "./planner.mjs";
import { adapt } from "./planner.mjs";
import { shotlist } from "./shotlist.mjs";
import { promptgen } from "./promptgen.mjs";
import { approvedStill } from "./visualQA.mjs";
import { adjacentContinuityReview } from "./continuity.mjs";
import { voiceForShot, voiceForScene } from "./voice.mjs";
import { editorPlan, assembleEdit } from "./editor.mjs";
import { buildSegment, concat, finalize } from "./stitch.mjs";
import { video, keyframeVideo, download } from "../lib/qwen.mjs";
import { architect, storyReview, contradictionCheck, replanBeats, identityReview } from "./story.mjs";
import { buildState, stateForScene, lockedFacts } from "./state.mjs";
import { throughline } from "./throughline.mjs";
import { composeStorySoFar, rollingSummarize } from "./memory.mjs";
import { evaluate } from "./evaluate.mjs";

export async function showrun(input, { scenes = 3, source = "logline", maxScenes = 24, aspect = "16:9", outDir = "output/film", render = true, forceStrategy, voiceover = false, log = console.log, onEvent = () => {} } = {}) {
  const dir = path.resolve(outDir);
  mkdirSync(dir, { recursive: true });
  const emit = (id, patch) => { try { onEvent({ id, ...patch }); } catch {} };
  const signals = { continuity: null, throughline: null, story: null, identity: null };  // grounded QA signals -> Phase 4 KPI
  const STILL_SIZE = { "16:9": "1664*928", "9:16": "928*1664", "1:1": "1328*1328", "4:3": "1472*1104", "3:4": "1104*1472" }[aspect] || "1664*928";
  const VIDEO_SIZE = { "16:9": "1280*720", "9:16": "720*1280", "1:1": "960*960", "4:3": "1280*960", "3:4": "960*1280" }[aspect] || "1280*720";
  const preview = source === "chapter" ? input.replace(/\s+/g, " ").slice(0, 90) + "…" : `"${input}"`;
  log(`\n== SHOWRUN ==\n${preview}`);

  const { plan: p } = source === "chapter"
    ? await adapt(input, { maxScenes })
    : await plan(input, { scenes });
  log(`title: ${p.title}  |  ${p.scenes.length} scenes  |  style: ${p.style}`);

  // ---- STORY EDITOR (architect): critique + light-repair the arc BEFORE anything is filmed ----
  if ((p.scenes || []).length >= 2) {
    log(`story: editor reviewing the beat sheet`);
    try {
      const arch = await architect(p);
      if (arch.ok) {
        if (Array.isArray(arch.scenes) && arch.scenes.length === p.scenes.length) p.scenes = arch.scenes;
        if (arch.review.spine) p.spine = arch.review.spine;
        const sc = arch.review.score != null ? ` (${arch.review.score}/100)` : "";
        log(`story: arc ${arch.review.tells_story ? "holds" : "needs work"}${sc}`);
        for (const w of arch.review.weak_beats.slice(0, 6)) log(`story: weak beat S${w.id} — ${w.issue}`);
        if (arch.review.notes) log(`story: note — ${arch.review.notes}`);
      } else { log(`story: review skipped (kept original beats)`); }
    } catch (e) { log(`story: review error — ${e.message}`); }
  }
  const spine = p.spine || p.logline || "";
  const theme = p.theme || "";

  // ---- CONTINUITY BIBLE (typed, locked state) + contradiction guard ----
  let storyState = null;
  if ((p.scenes || []).length >= 2) {
    try {
      storyState = await buildState(p);
      log(`state: ${storyState.characters.length} character record(s), ${storyState.worldRules.length} world rule(s), ${storyState.openThreads.length} open thread(s)`);
      for (const f of lockedFacts(storyState).slice(0, 6)) log(`state: locked — ${f}`);
      const cc = await contradictionCheck(p, storyState);
      if (!cc.ok && cc.conflicts.length) {
        for (const c of cc.conflicts.slice(0, 6)) log(`contradiction: S${c.id} — ${c.issue} (violates: ${c.fact})`);
        const rp = await replanBeats(p, storyState, cc.conflicts);
        if (rp.ok) { p.scenes = rp.scenes; log(`replan: rewrote ${[...new Set(cc.conflicts.map((c) => c.id))].length} beat(s) to resolve contradiction(s)`); }
        signals.continuity = { conflicts: cc.conflicts.length, resolved: !!rp.ok };
      } else { log(`continuity: no contradictions found`); signals.continuity = { conflicts: 0, resolved: true }; }
    } catch (e) { log(`state: error — ${e.message}`); }
  }

  // ---- THROUGH-LINE critic: central dramatic question + per-scene MUST-SHOW visual requirements ----
  // mustShow is injected into promptgen so the key story element actually gets rendered (the comet
  // is shown as a comet, the malfunction is visibly a malfunction) instead of drifting to a generic image.
  let mustShowById = {};
  if ((p.scenes || []).length >= 2) {
    try {
      const tl = await throughline(p);
      if (tl.ok) {
        mustShowById = tl.mustShow || {};
        signals.throughline = { breaks: (tl.breaks || []).length };
        if (tl.question) log(`throughline: central question — ${tl.question}`);
        for (const b of (tl.breaks || []).slice(0, 4)) log(`throughline: break S${b.id} — ${b.issue}`);
        log(`throughline: ${Object.keys(mustShowById).length} scene(s) carry must-show requirements`);
      } else { log(`throughline: skipped`); }
    } catch (e) { log(`throughline: error — ${e.message}`); }
  }

  // ---- NARRATION: the Story Architect decides whether the FORM wants a narrator (noir, doc, fable...) ----
  const nar = p.narration || {};
  const useVO = voiceover || nar.mode === "voiceover";
  const narVoice = nar.voice || null;
  if (nar.mode === "voiceover") log(`narration: voiceover${nar.style ? ` · ${nar.style}` : ""}${nar.voice ? ` · ${nar.voice}` : ""}${nar.rationale ? ` — ${nar.rationale}` : ""}`);
  else if (voiceover) log(`narration: voiceover (requested)`);
  else log(`narration: none — letting the pictures and native audio carry it`);
  if (p.motif) log(`motif: ${p.motif}`);

  // Expand: scene -> { strategy, shots(+prompts) }. Carry a lean, retrieval-based "story so far"
  // into every shot, with a rolling summary folding older beats in on long films (memory at scale).
  const scenesPlan = [];
  const priorBeats = [];
  let rollSummary = "";
  for (const scene of p.scenes) {
    const storySoFar = [
      theme ? `Theme: ${theme}` : "",
      spine ? `Story spine: ${spine}` : "",
      stateForScene(storyState, scene),
      composeStorySoFar(scene, priorBeats, { recent: 6, relevant: 3, summary: rollSummary }),
      `This scene${scene.function ? ` (${scene.function})` : ""}: ${scene.beat}`
    ].filter(Boolean).join("\n");
    const { strategy, shots } = await shotlist(scene, { style: p.style, characters: p.characters, title: p.title });
    const entries = [];
    for (const shot of shots) {
      const prompts = await promptgen(shot, { style: p.style, characters: p.characters, setting: scene.setting, beat: scene.beat, intent: scene.intent, title: p.title, storySoFar, motif: p.motif, mustShow: mustShowById[scene.id] || [] });
      entries.push({ shot, prompts });
    }
    const strat = forceStrategy || (entries.length >= 2 ? strategy : "montage");
    scenesPlan.push({ scene, strategy: strat, shots: entries });
    priorBeats.push(`S${scene.id} ${String(scene.beat || "").replace(/\s+/g, " ").slice(0, 70)}`);
    // Long films only: recompress the older beats into a rolling summary every few scenes (bounded).
    if (priorBeats.length > 8 && priorBeats.length % 3 === 0) rollSummary = await rollingSummarize(priorBeats.slice(0, -6));
    log(`  scene ${scene.id} [${strat}] -> ${entries.length} shot(s)`);
  }
  writeFileSync(path.join(dir, "storyboard.json"), JSON.stringify({ plan: p, state: storyState, mustShow: mustShowById, scenes: scenesPlan }, null, 2));

  // Register storyboard panels up front so the UI shows the board filling in live.
  const MAX_REFS = +(process.env.QWEN_MAX_REFS || 8);
  const castToRef = (p.characters || []).slice(0, MAX_REFS);   // one reference per named character (capped)
  castToRef.forEach((ch, i) => emit(`ref_${i}`, { scene: 0, label: `Reference · ${ch.name}`, status: "pending" }));
  for (const sp of scenesPlan) {
    const isLong = sp.strategy === "longtake" && sp.shots.length >= 2;
    const beat = String(sp.scene.beat || "").replace(/\s+/g, " ").trim().slice(0, 52);
    const lbl = `S${sp.scene.id} · ${beat}`;
    const pans = isLong
      ? [{ id: `${sp.scene.id}_spine`, label: lbl },
         ...sp.shots.slice(1).map(({ shot }) => ({ id: `s${sp.scene.id}_${shot.id}`, label: lbl }))]
      : sp.shots.map(({ shot }) => ({ id: `${sp.scene.id}_${shot.id}`, label: lbl }));
    for (const pn of pans) emit(pn.id, { scene: sp.scene.id, label: pn.label, status: "pending" });
  }
  if (!render) return { title: p.title, scenes: scenesPlan.length, storyboard: path.join(dir, "storyboard.json") };

  // Character references (subject consistency): one approved portrait PER named character, reused across shots.
  const refByName = {};
  let referenceUrl = null;   // lead ref — fallback anchor for establishing/character-less shots
  for (let i = 0; i < castToRef.length; i++) {
    const ch = castToRef[i], pid = `ref_${i}`;
    log(`reference: ${ch.name} ...`);
    emit(pid, { status: "drawing" });
    const ref = await approvedStill(
      `Character model sheet of ${ch.name}: ${ch.description}. ${p.style}. Front view, head and shoulders, on a clean pure white seamless studio background, soft even lighting, subtle contact shadow only, no text.`,
      { size: "1328*1328", maxRetries: 1, seed: seedOf("ref" + i),
        onStep: (a, v, url) => { log(`   ref ${ch.name} ${a}: pass=${v.pass}`); emit(pid, { status: v.pass ? "frame" : "drawing", stillUrl: url, attempt: a, pass: v.pass }); },
        onLegal: (a, lv) => log(`   ref ${ch.name} legal ${a}: ${lv.pass ? "clear" : "FLAG " + (lv.ip_issue || lv.text_issue || "issue")}`) });
    if (ref.url) { refByName[ch.name] = ref.url; emit(pid, { status: "frame", stillUrl: ref.url }); await download(ref.url, path.join(dir, `character_ref_${i}.png`)); }
    if (!referenceUrl) referenceUrl = ref.url;
  }
  log(`references: ${Object.keys(refByName).length} of ${castToRef.length} character(s) anchored`);

  // ---- PHASE 1: STORYBOARD — generate every still in parallel (capped), board-first ----
  // imageEdit (subject-consistency) has a strict rate quota -> stills sequential by default;
  // video is the slow part and uses a separate quota -> parallelize that. Both env-tunable.
  const STILL_CC = +(process.env.QWEN_STILL_CC || 3), VIDEO_CC = +(process.env.QWEN_VIDEO_CC || 3);
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
  // Per-scene "story need" for the story-need inspector: the beat plus its must-show requirements,
  // so each still is checked against what THIS moment of the story actually has to convey.
  const needById = {};
  for (const s of (p.scenes || [])) {
    const ms = mustShowById[s.id] || [];
    needById[s.id] = `Beat: ${String(s.beat || "").replace(/\s+/g, " ").slice(0, 160)}.` + (ms.length ? ` Must be visible: ${ms.join("; ")}.` : "");
  }
  log(`storyboard: ${units.length} panels (stills x${STILL_CC} parallel)`);
  await mapLimit(units, STILL_CC, async (u) => {
    const imgPrompt = `${u.prompts.image_prompt}. Overall style: ${p.style}`;
    const still = await approvedStill(imgPrompt, { referenceUrl: pickRefs(u, refByName, referenceUrl), size: STILL_SIZE, seed: seedOf(u.id),
      storyNeed: needById[u.sceneId] || "",
      onStep: (a, v, url) => { log(`   ${u.id} still ${a}: pass=${v.pass}`); emit(u.id, { status: v.pass ? "frame" : "drawing", stillUrl: url, attempt: a, pass: v.pass }); },
      onInspect: (kind, a, v, url) => { if (!v.pass && !v._skipped) { const det = (v.issues || v.missing || []).slice(0, 2).join(", "); log(`   ${u.id} ${kind === "coherence" ? "coherence" : "story-need"} ${a}: FLAG${det ? " — " + det : ""}`); emit(u.id, { [kind]: "flag" }); } },
      onLegal: (a, lv) => { log(`   ${u.id} legal ${a}: ${lv.pass ? "clear" : "FLAG " + (lv.ip_issue || lv.text_issue || "issue")}`); emit(u.id, { legal: lv.pass ? "clear" : "flag" }); } });
    u.stillUrl = still.url;
    u.blocked = !still.url;
    if (u.blocked) log(`   ${u.id} still: blocked by content filter — skipping shot`);
    emit(u.id, { status: still.url ? "frame" : "blocked", stillUrl: still.url });
  });

  // ---- STORY EDITOR (vision): do the RENDERED frames actually tell the story? ----
  try {
    const beatById = new Map((p.scenes || []).map((s) => [s.id, s.beat]));
    const sampleByScene = new Map();              // sceneId -> the exact unit whose frame we judge (and may re-roll)
    for (const u of units) { if (u.stillUrl && !sampleByScene.has(u.sceneId)) sampleByScene.set(u.sceneId, u); }
    let sampled = [...sampleByScene.values()];
    if (sampled.length > 12) {                     // cap the vision payload — sample evenly across the film
      const step = sampled.length / 12;
      sampled = Array.from({ length: 12 }, (_, i) => sampled[Math.floor(i * step)]);
    }
    const toFrames = (arr) => arr.map((u) => ({ id: u.sceneId, beat: beatById.get(u.sceneId) || "", url: u.stillUrl }));
    if (sampled.length >= 2) {
      log(`story-review: watching ${sampled.length} storyboard frames`);
      const sr = await storyReview(p, toFrames(sampled));
      if (sr.ok) {
        log(`story-review: ${sr.review.tells_story ? "the frames tell the story" : "some frames miss the beat"}${sr.review.summary ? " — " + sr.review.summary : ""}`);
        const issueById = new Map((sr.review.per_scene || []).filter((x) => x && Number.isFinite(+x.id)).map((x) => [+x.id, x.issue]));
        let weakIds = (sr.review.weak_panels || []).filter((sid) => sampleByScene.has(sid));
        for (const w of weakIds) log(`story-review: weak frame S${w}${issueById.get(w) ? " — " + issueById.get(w) : ""}`);
        signals.story = { tells_story: sr.review.tells_story !== false, weak: weakIds.length, unresolved: weakIds.length, sampled: sampled.length };

        // ---- IDENTITY: do the characters still match their reference sheets? (objective re-roll trigger) ----
        const idr = await identityReview(refByName, toFrames(sampled));
        if (idr.ok) {
          const driftIn = (idr.review.drift || []).filter((d) => sampleByScene.has(+d.id));
          signals.identity = { drift: driftIn.length, sampled: sampled.length };
          if (idr.review.consistent && !driftIn.length) log(`identity: characters consistent with references`);
          for (const d of driftIn.slice(0, 6)) {
            log(`identity: drift S${d.id}${d.character ? " (" + d.character + ")" : ""}${d.issue ? " — " + d.issue : ""}`);
            if (!issueById.has(+d.id)) issueById.set(+d.id, `the character ${d.character || ""} looks different from their reference portrait — match the reference's face, hair and wardrobe exactly`);
            if (!weakIds.includes(+d.id)) weakIds.push(+d.id);
          }
        }

        // ---- VERIFY -> FIX: re-roll ONLY the weak frames (story + identity), once (bounded) ----
        const weak = [...new Set(weakIds)].slice(0, 6);
        if (weak.length && process.env.QWEN_STORY_FIX !== "0") {
          log(`story-fix: re-rolling ${weak.length} weak frame(s)`);
          const fixedUnits = [];
          await mapLimit(weak, STILL_CC, async (sid) => {
            const u = sampleByScene.get(sid); if (!u) return;
            const issue = issueById.get(sid) || "the frame does not clearly convey its story beat";
            const beat = beatById.get(sid) || "";
            const fixPrompt = `${u.prompts.image_prompt}. Overall style: ${p.style}. STORY FIX — the previous version failed because: ${issue}. This frame MUST clearly read as this story beat: ${beat}.`;
            emit(u.id, { status: "drawing", storyfix: true });
            const re = await approvedStill(fixPrompt, { referenceUrl: pickRefs(u, refByName, referenceUrl), size: STILL_SIZE, seed: seedOf(u.id + "-fix"),
              storyNeed: needById[sid] || "",
              onStep: (a, v, url) => { emit(u.id, { status: v.pass ? "frame" : "drawing", stillUrl: url, attempt: a, pass: v.pass }); },
              onLegal: (a, lv) => { emit(u.id, { legal: lv.pass ? "clear" : "flag" }); } });
            if (re.url) { u.stillUrl = re.url; emit(u.id, { status: "frame", stillUrl: re.url, storyfixed: true }); fixedUnits.push(u); log(`story-fix: S${sid} re-rolled`); }
            else log(`story-fix: S${sid} re-roll blocked — kept original`);
          });
          // ---- RE-CHECK the re-rolled frames once; report, don't loop ----
          if (fixedUnits.length) {
            const rc = await storyReview(p, toFrames(fixedUnits));
            const stillWeak = rc.ok ? (rc.review.weak_panels || []).filter((sid) => fixedUnits.some((u) => u.sceneId === sid)) : [];
            if (signals.story) signals.story.unresolved = rc.ok ? stillWeak.length : 0;   // re-check skipped -> assume held
            if (!rc.ok) log(`story-fix: re-check skipped — assuming fixes hold`);
            else if (stillWeak.length) log(`story-fix: unresolved (${stillWeak.length}) — S${stillWeak.join(", S")} still weak after re-roll`);
            else log(`story-fix: resolved — all re-rolled frames now read`);
          }
        }
      } else { log(`story-review: skipped`); }
    }
  } catch (e) { log(`story-review: error — ${e.message}`); }

  // ---- SCRIPT SUPERVISOR: adjacent-frame continuity — grade each CUT, re-roll the later frame on a break ----
  // Per-frame inspectors judge a still alone; this walks the film IN ORDER and judges each PAIR of
  // consecutive frames together (wardrobe, location, lighting, props, identity carrying across the cut).
  // A fixed frame becomes the anchor for the next pair, so a correction propagates forward.
  if (process.env.QWEN_CONTINUITY !== "0") {
    try {
      const seq = units.filter((u) => u.stillUrl && !u.blocked);   // renderable frames, in film order
      if (seq.length >= 2) {
        log(`continuity: script supervisor reviewing ${seq.length - 1} cut(s)`);
        let breaks = 0, fixed = 0;
        for (let i = 1; i < seq.length; i++) {
          const prev = seq[i - 1], cur = seq[i];
          const adj = await adjacentContinuityReview(prev.stillUrl, cur.stillUrl);
          if (adj._skipped || adj.continuous !== false) continue;
          breaks++;
          const det = (adj.breaks || []).slice(0, 3).join(", ");
          log(`continuity: break ${prev.id} \u2192 ${cur.id}${det ? " \u2014 " + det : ""}`);
          emit(cur.id, { continuity: "flag" });
          if (process.env.QWEN_CONTINUITY_FIX === "0") continue;
          const fixPrompt = `${cur.prompts.image_prompt}. Overall style: ${p.style}. CONTINUITY FIX \u2014 this shot directly follows the previous shot of the same scene and must visually match it. Keep consistent: ${det || "wardrobe, hair, lighting, location, and props"}. ${adj.fix_hint || ""}`.trim();
          const refs = [prev.stillUrl, ...(pickRefs(cur, refByName, referenceUrl) || [])].slice(0, 3);
          emit(cur.id, { status: "drawing", continuityfix: true });
          const re = await approvedStill(fixPrompt, { referenceUrl: refs, size: STILL_SIZE, seed: seedOf(cur.id + "-cont"),
            storyNeed: needById[cur.sceneId] || "",
            onStep: (a, v, url) => { emit(cur.id, { status: v.pass ? "frame" : "drawing", stillUrl: url, attempt: a, pass: v.pass }); },
            onLegal: (a, lv) => { emit(cur.id, { legal: lv.pass ? "clear" : "flag" }); } });
          if (re.url) {
            const recheck = await adjacentContinuityReview(prev.stillUrl, re.url);   // keep only if it actually helped
            cur.stillUrl = re.url;
            if (recheck._skipped || recheck.continuous !== false) { fixed++; emit(cur.id, { status: "frame", stillUrl: re.url, continuityfixed: true }); log(`continuity: ${cur.id} re-rolled to match`); }
            else { emit(cur.id, { status: "frame", stillUrl: re.url }); log(`continuity: ${cur.id} still imperfect after re-roll \u2014 kept closest`); }
          } else log(`continuity: ${cur.id} re-roll blocked \u2014 kept original`);
        }
        log(`continuity: ${breaks} break(s) found, ${fixed} fixed across ${seq.length - 1} cut(s)`);
        signals.continuity = { ...(signals.continuity || {}), cuts: seq.length - 1, breaks, fixed };
      }
    } catch (e) { log(`continuity: error \u2014 ${e.message}`); }
  }

  // ---- PHASE 2: ANIMATE — dispatch videos with bounded concurrency (free-tier safe) ----
  // Longtake spine shots are keyframe-anchored: use the scene's first cutaway still as the "last
  // frame" so the take interpolates toward a real second composition (steadier than first-frame i2v).
  const lastFrameForScene = new Map();
  for (const u of units) { if (u.role === "cutaway" && u.stillUrl && !lastFrameForScene.has(u.sceneId)) lastFrameForScene.set(u.sceneId, u.stillUrl); }
  const KEYFRAME = process.env.QWEN_KEYFRAME !== "0";
  log(`animate: ${units.length} clips (video x${VIDEO_CC} parallel)${KEYFRAME ? " · keyframe spine takes" : ""}`);
  await mapLimit(units, VIDEO_CC, async (u) => {
    if (!u.stillUrl) { emit(u.id, { status: "blocked" }); return; }   // blocked still -> skip, keep the job alive
    emit(u.id, { status: "video_pending" });
    const onTick = (st, s) => { log(`   ${u.id} [${s}s] ${st}`); emit(u.id, { status: st === "SUCCEEDED" ? "clip" : "animating", secs: s }); };
    let clip;
    if (u.role === "spine") {
      const lastUrl = lastFrameForScene.get(u.sceneId);
      const i2vSpine = () => video(u.prompts.motion_prompt || "slow cinematic camera move, continuous flowing take",
        { imageUrl: u.stillUrl, resolution: "720P", shot_type: "multi", duration: u.takeDur, onTick });
      if (KEYFRAME && lastUrl && lastUrl !== u.stillUrl) {
        try {
          clip = await keyframeVideo(u.stillUrl, lastUrl, u.prompts.motion_prompt || "smooth continuous cinematic camera move, single flowing take", { resolution: "720P", onTick });
          log(`   ${u.id} keyframe take (first→last)`);
        } catch (e) {
          log(`   ${u.id} keyframe failed (${e.message.slice(0, 50)}) — i2v fallback`);
          clip = await i2vSpine();
        }
      } else {
        clip = await i2vSpine();
      }
    } else if (u.role === "cutaway" || u.shot.mode === "i2v") {
      clip = await video(u.prompts.motion_prompt || "subtle natural motion, slow cinematic camera move",
        { imageUrl: u.stillUrl, resolution: "720P", duration: u.shot.duration, onTick });
    } else {
      clip = await video(`${u.prompts.image_prompt}. Overall style: ${p.style}. ${u.prompts.motion_prompt || ""}`.trim(),
        { size: VIDEO_SIZE, shot_type: "multi", onTick });
    }
    emit(u.id, { status: "clip" });
    u.clipPath = path.join(dir, `clip_${u.id}.mp4`);
    await download(clip.url, u.clipPath);
  });

  // ---- PHASE 3: ASSEMBLE — sequential local ffmpeg (EDL + narration + concat) ----
  const sceneClips = [];
  for (const sp of scenesPlan) {
    const us = units.filter((u) => u.sceneId === sp.scene.id && u.clipPath);  // only shots that actually rendered
    if (!us.length) { log(`  scene ${sp.scene.id}: all shots blocked — skipped`); continue; }
    const isLong = sp.strategy === "longtake" && us.length >= 2 && us.some((u) => u.role === "spine");
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
      const leadVO = { narration: sp.scene.narration || "", dialogue: spineU.shot.dialogue || [] };
      const voPath = useVO ? await voiceForScene(leadVO, path.join(dir, `vo_s${sp.scene.id}.wav`), { voice: narVoice || pickVoice(p, spineU.shot) }) : null;
      sceneFinal = path.join(dir, `scene_${sp.scene.id}.mp4`);
      await buildSegment(sceneClip, voPath, sceneFinal);
    } else {
      const segs = [];
      let i = 0, lead = true;
      for (const u of us) {
        const voObj = lead ? { narration: sp.scene.narration || "", dialogue: u.shot.dialogue || [] } : u.shot;
        const voPath = useVO ? await voiceForScene(voObj, path.join(dir, `vo_${u.id}.wav`), { voice: narVoice || pickVoice(p, u.shot) }) : null;
        lead = false;
        const seg = path.join(dir, `seg_${u.id}_${String(++i).padStart(2, "0")}.mp4`);
        await buildSegment(u.clipPath, voPath, seg);
        segs.push(seg);
      }
      sceneFinal = path.join(dir, `scene_${sp.scene.id}.mp4`);
      await concat(segs, sceneFinal, path.join(dir, `scene_${sp.scene.id}_concat.txt`));
    }
    sceneClips.push(sceneFinal);
  }

  if (!sceneClips.length) throw new Error("every shot was blocked by the content filter — try a different passage or logline");
  const finalRaw = path.join(dir, "final_raw.mp4");
  await concat(sceneClips, finalRaw, path.join(dir, "final_concat.txt"));
  const finalPath = path.join(dir, "final.mp4");
  await finalize(finalRaw, finalPath);   // cinematic fade in/out
  log(`\nFINAL CUT: ${finalPath}`);

  // ---- PHASE 4: SELF-EVALUATION — score the finished film on the rubric, emit a single KPI ----
  let evaluation = null;
  try {
    const evalFrames = [...new Map(units.filter((u) => u.stillUrl).map((u) => [u.sceneId, u.stillUrl])).values()].slice(0, 8);
    evaluation = await evaluate({ plan: p, signals, frames: evalFrames });
    writeFileSync(path.join(dir, "evaluation.json"), JSON.stringify(evaluation, null, 2));
    const d = evaluation.dimensions;
    log(`evaluation: KPI ${evaluation.score}/100 — continuity ${d.continuity} · identity ${d.identity} · beats ${d.beats} · through-line ${d.throughline}${d.craft != null ? ` · craft ${d.craft}` : ""}`);
    if (evaluation.critique) log(`evaluation: ${evaluation.critique}`);
    emit("_eval", { kpi: evaluation.score, dimensions: d });
  } catch (e) { log(`evaluation: error — ${e.message}`); }

  return { title: p.title, finalPath, scenes: scenesPlan.length, kpi: evaluation?.score ?? null, evaluation };
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

// Deterministic per-panel seed (FNV-1a) so a still is reproducible run-to-run; re-rolls offset the seed to vary.
function seedOf(s) {
  let h = 2166136261; const str = String(s);
  for (let k = 0; k < str.length; k++) { h ^= str.charCodeAt(k); h = Math.imul(h, 16777619); }
  return (h >>> 0) % 2147483647;
}

// Pick the reference image(s) for a shot: match the characters that actually appear in it
// (by name token) and pass up to 3 of their portraits; fall back to the lead anchor otherwise.
const REF_STOP = new Set(["the", "a", "an", "of", "and", "to", "in"]);
function pickRefs(u, refByName, fallback) {
  const names = Object.keys(refByName);
  if (!names.length) return fallback || null;
  const hay = `${u.shot?.subject || ""} ${u.shot?.action || ""} ${(u.shot?.dialogue || []).map((d) => d.character).join(" ")}`.toLowerCase();
  const matched = names.filter((n) =>
    n.toLowerCase().replace(/[()]/g, " ").split(/\s+/).some((tok) => tok.length >= 3 && !REF_STOP.has(tok) && hay.includes(tok))
  ).map((n) => refByName[n]);
  const urls = (matched.length ? matched : (fallback ? [fallback] : [])).slice(0, 3);
  return urls.length ? urls : null;
}

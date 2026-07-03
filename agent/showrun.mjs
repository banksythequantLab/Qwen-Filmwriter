// agent/showrun.mjs — the conductor. logline -> finished short, fully autonomous.
// plan -> per scene: shotlist (picks strategy) -> promptgen -> render (montage | longtake) -> stitch
import { mkdirSync, writeFileSync, copyFileSync, rmSync } from "node:fs";
import path from "node:path";
import { plan } from "./planner.mjs";
import { adapt } from "./planner.mjs";
import { shotlist } from "./shotlist.mjs";
import { promptgen } from "./promptgen.mjs";
import { approvedStill, refineAnchor } from "./visualQA.mjs";
import { adjacentContinuityReview } from "./continuity.mjs";
import { clipReview, lastFrameDataUri } from "./clipQA.mjs";
import { voiceForShot, voiceForScene } from "./voice.mjs";
import { editorPlan, assembleEdit } from "./editor.mjs";
import { buildSegment, concat, finalize } from "./stitch.mjs";
import { video, keyframeVideo, r2v, download } from "../lib/qwen.mjs";
import { architect, storyReview, contradictionCheck, replanBeats, identityReview } from "./story.mjs";
import { buildState, stateForScene, lockedFacts } from "./state.mjs";
import { throughline } from "./throughline.mjs";
import { composeStorySoFar, rollingSummarize } from "./memory.mjs";
import { evaluate, weakestFrame } from "./evaluate.mjs";
import { saveCast, loadCast } from "./season.mjs";
import { narrationReview } from "./sound.mjs";

export async function showrun(input, { scenes = 3, source = "logline", maxScenes = 24, aspect = "16:9", outDir = "output/film", render = true, forceStrategy, voiceover = false, season = "", log = console.log, onEvent = () => {} } = {}) {
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

  // ---- SEASON (studio vault): a returning cast keeps its FACE and WARDROBE LOCK across episodes.
  // The new story may rename the roles — vault stars map onto this episode's characters IN ORDER,
  // overriding appearance + locked invariants so canon and anchors carry over film to film.
  const seasonName = String(season || process.env.QWEN_SEASON || "").trim();
  let seasonVault = null;
  if (seasonName) {
    seasonVault = loadCast(seasonName);
    if (seasonVault?.cast?.length && storyState?.characters?.length) {
      const n = Math.min(seasonVault.cast.length, storyState.characters.length);
      for (let i = 0; i < n; i++) {
        const star = seasonVault.cast[i], role = storyState.characters[i];
        log(`season: casting ${role.name} as returning star ${star.name}`);
        if (star.appearance) role.appearance = star.appearance;
        if (star.locked?.length) role.locked = star.locked;
      }
    } else log(`season: "${seasonName}" ${seasonVault ? "has no cast yet" : "is new"} — this film will found it`);
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

  // ---- SOUND DEPARTMENT: table-read the narration script BEFORE any recording — one narrator's
  // voice, no repeats, each line advances the story, and short enough to fit its scene (overruns
  // get hard-cut mid-sentence at stitch). Flagged lines are rewritten in place.
  if (useVO && process.env.QWEN_SOUND !== "0") {
    try {
      const nr = await narrationReview(p);
      if (!nr.skipped) {
        for (const iss of nr.issues.slice(0, 4)) log(`sound: script note — ${iss}`);
        let rewrote = 0;
        for (const rw of nr.rewrites) {
          const s = (p.scenes || []).find((x) => x.id === +rw.id);
          if (s && rw.line) { s.narration = String(rw.line).trim(); rewrote++; log(`sound: S${rw.id} narration rewritten — "${String(rw.line).slice(0, 70)}"`); }
        }
        log(rewrote ? `sound: table read — ${rewrote} line(s) rewritten` : `sound: table read — narration script reads clean`);
      }
    } catch (e) { log(`sound: review error — ${e.message}`); }
  }

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
      const prompts = await promptgen(shot, { style: p.style, characters: p.characters, setting: scene.setting, beat: scene.beat, intent: scene.intent, title: p.title, storySoFar, motif: p.motif, mustShow: mustShowById[scene.id] || [], canon: stateForScene(storyState, scene) });
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
  const localRefByName = {};   // character name -> LOCAL png path of this run's anchor (for the vault)
  let referenceUrl = null;   // lead ref — fallback anchor for establishing/character-less shots
  for (let i = 0; i < castToRef.length; i++) {
    const ch = castToRef[i], pid = `ref_${i}`;
    // SEASON: a returning star's canon-audited anchor is reused as-is — no re-cast, no anchor spend.
    const star = seasonVault?.cast?.[i];
    if (star?.dataUri) {
      refByName[ch.name] = star.dataUri;
      localRefByName[ch.name] = star.file;
      if (!referenceUrl) referenceUrl = star.dataUri;
      emit(pid, { status: "frame", stillUrl: star.dataUri });
      log(`reference: ${ch.name} — returning star ${star.name}, anchor reused from vault`);
      continue;
    }
    log(`reference: ${ch.name} ...`);
    emit(pid, { status: "drawing" });
    const chState = (storyState?.characters || []).find((c) => c.name === ch.name);
    const refLook = chState?.appearance || ch.description;
    // ANCHOR HARDENING: the reference portrait is the identity anchor for the WHOLE film — gate it
    // against the character's own locked canon (bible inspector) and give it real retries, so a
    // canon-violating anchor can't silently poison every downstream identity check.
    const refCanon = [
      refLook ? `${ch.name} — WARDROBE LOCK (head-to-toe, identical every shot incl. footwear & hair): ${refLook}` : "",
      ...((chState?.locked || []).slice(0, 5).map((l) => `${ch.name}: ${l}`)),
    ].filter(Boolean).join("\n");
    const ref = await approvedStill(
      `Full-body character model sheet of ${ch.name}, head to toe, showing the COMPLETE outfit and every accessory: ${refLook}. ${p.style}. ONE SINGLE full-body view only — exactly one figure, NOT a multi-panel sheet, no side-by-side variants, no turnaround views. Standing straight, front view, entire figure visible from head to feet, on a clean pure white seamless studio background, soft even lighting, subtle contact shadow only, no text.`,
      { size: "1328*1328", maxRetries: +(process.env.QWEN_REF_RETRIES ?? 2), seed: seedOf("ref" + i), canon: refCanon,
        onStep: (a, v, url) => { log(`   ref ${ch.name} ${a}: pass=${v.pass}`); emit(pid, { status: v.pass ? "frame" : "drawing", stillUrl: url, attempt: a, pass: v.pass }); },
        onLegal: (a, lv) => log(`   ref ${ch.name} legal ${a}: ${lv.pass ? "clear" : "FLAG " + (lv.ip_issue || lv.text_issue || "issue")}`) });
    // ANCHOR REFINEMENT: t2i has failed this QA 3-of-3 in every observed run — dense head-to-toe
    // specs don't land in one roll. Correct the best attempt via image-edit instead of rolling again.
    if (!ref.approved && ref.url && refCanon && process.env.QWEN_REF_REFINE !== "0") {
      const rr = await refineAnchor(ref.url, ref.verdict, refLook, refCanon, {
        tries: +(process.env.QWEN_REF_REFINE_TRIES ?? 3), seed: seedOf("reffix" + i),
        onRound: (r, v) => log(`   ref ${ch.name} refine ${r}: ${v.error ? "error — " + String(v.error).slice(0, 60) : v.pass ? "canon PASS" : "still off — " + ((v.violations || []).slice(0, 2).join("; ") || "unverified")}`) });
      if (rr.url) { ref.url = rr.url; ref.approved = rr.approved || ref.approved; }
    }
    if (ref.url) { refByName[ch.name] = ref.url; emit(pid, { status: "frame", stillUrl: ref.url }); const lp = path.join(dir, `character_ref_${i}.png`); await download(ref.url, lp); localRefByName[ch.name] = lp; }
    if (!referenceUrl) referenceUrl = ref.url;
  }
  log(`references: ${Object.keys(refByName).length} of ${castToRef.length} character(s) anchored`);

  // ---- LOCATION PLATES (#3 locked visual plates): one canonical establishing plate per distinct
  // location, generated ONCE and reused as a reference for EVERY shot set there, so the place itself
  // (architecture, palette, light) stops drifting shot to shot the way it did before.
  const plateForScene = {};
  if (process.env.QWEN_PLATES !== "0") {
    const norm = (s) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
    const locs = new Map();
    for (const s of (p.scenes || [])) {
      const key = norm(s.setting) || `scene-${s.id}`;
      if (!locs.has(key)) locs.set(key, { setting: s.setting || s.beat || "the location", ids: [] });
      locs.get(key).ids.push(s.id);
    }
    const locList = [...locs.values()].slice(0, +(process.env.QWEN_MAX_PLATES || 6));
    if (locList.length) {
      log(`plates: locking ${locList.length} location plate(s)`);
      locList.forEach((L, i) => emit(`plate_${i}`, { scene: 0, label: `Location · ${String(L.setting).slice(0, 40)}`, status: "pending" }));
      await mapLimit(locList, 2, async (L) => {
        const i = locList.indexOf(L), pid = `plate_${i}`;
        emit(pid, { status: "drawing" });
        const platePrompt = `Establishing wide shot of this location: ${L.setting}. Overall style: ${p.style}. Empty location, NO people, no characters, no figures anywhere. A clear establishing view that defines the architecture, layout, color palette, time of day, and lighting of this place. Cinematic, atmospheric, deep focus.`;
        const plate = await approvedStill(platePrompt, { size: STILL_SIZE, maxRetries: 1, seed: seedOf("plate-" + i),
          onStep: (a, v, url) => emit(pid, { status: v.pass ? "frame" : "drawing", stillUrl: url, attempt: a, pass: v.pass }),
          onLegal: (a, lv) => log(`   plate ${i} legal ${a}: ${lv.pass ? "clear" : "FLAG"}`) });
        if (plate.url) {
          emit(pid, { status: "frame", stillUrl: plate.url });
          await download(plate.url, path.join(dir, `location_plate_${i}.png`));
          for (const sid of L.ids) plateForScene[sid] = plate.url;
          log(`plate: ${String(L.setting).slice(0, 50)} \u2014 locked`);
        } else log(`plate: ${String(L.setting).slice(0, 50)} \u2014 blocked, shots will self-anchor`);
      });
      log(`plates: ${Object.keys(plateForScene).length} scene(s) anchored to a location plate`);
    }
  }


  // ---- PROP REFERENCES (QWEN_PROPREFS=1): one canonical reference image per recurring prop, on a
  // clean white background, reused as a reference for the shots that feature it — so objects (a
  // package, a device, a weapon) stop drifting shot to shot the way wardrobe did before full-body refs.
  const propRefByName = {};
  if (process.env.QWEN_PROPREFS === "1" && Array.isArray(storyState?.props) && storyState.props.length) {
    const props = storyState.props.slice(0, +(process.env.QWEN_MAX_PROPS || 4));
    log(`props: locking ${props.length} prop reference(s)`);
    props.forEach((pr, i) => emit(`prop_${i}`, { scene: 0, label: `Prop \u00b7 ${String(pr.name).slice(0, 40)}`, status: "pending" }));
    await mapLimit(props, 2, async (pr) => {
      const i = props.indexOf(pr), pid = `prop_${i}`;
      emit(pid, { status: "drawing" });
      const prompt = `Product reference photo of a single object: ${pr.name} \u2014 ${pr.look}. Centered, the whole object clearly visible, on a clean pure white seamless studio background, soft even lighting, subtle contact shadow only, no people, no hands, no text.`;
      try {
        const ref = await approvedStill(prompt, { size: "1328*1328", maxRetries: 1, seed: seedOf("prop-" + i),
          onStep: (a, v, url) => emit(pid, { status: v.pass ? "frame" : "drawing", stillUrl: url, attempt: a, pass: v.pass }),
          onLegal: (a, lv) => log(`   prop ${i} legal ${a}: ${lv.pass ? "clear" : "FLAG"}`) });
        if (ref.url) { propRefByName[String(pr.name).toLowerCase()] = ref.url; emit(pid, { status: "frame", stillUrl: ref.url }); await download(ref.url, path.join(dir, `prop_ref_${i}.png`)); log(`prop: ${String(pr.name).slice(0, 40)} \u2014 locked`); }
        else log(`prop: ${String(pr.name).slice(0, 40)} \u2014 blocked, shots will self-anchor`);
      } catch (e) { log(`prop: ${String(pr.name).slice(0, 40)} \u2014 error ${e.message}`); }
    });
    log(`props: ${Object.keys(propRefByName).length} prop(s) anchored`);
  }

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
  // Per-scene CANON for the continuity-bible inspector: the locked character/world facts relevant to
  // this scene, so each still is checked against the film's established truth (wardrobe, props, rules).
  const canonById = {};
  for (const s of (p.scenes || [])) canonById[s.id] = storyState ? stateForScene(storyState, s) : "";
  log(`storyboard: ${units.length} panels (stills x${STILL_CC} parallel)`);
  await mapLimit(units, STILL_CC, async (u) => {
    // Inline the LOCKED CANON into the FIRST-attempt prompt too — until now only re-roll prompts
    // carried it, so every initial panel was generated without ever being told the wardrobe lock.
    const imgPrompt = `${u.prompts.image_prompt}. Overall style: ${p.style}.${canonById[u.sceneId] ? ` LOCKED CANON — keep these EXACT, identical every shot: ${String(canonById[u.sceneId]).replace(/\n/g, " | ")}.` : ""}`;
    const still = await approvedStill(imgPrompt, { referenceUrl: (process.env.QWEN_PROPREFS === "1" ? withRefs(pickRefs(u, refByName, plateForScene[u.sceneId] || referenceUrl), plateForScene[u.sceneId], pickPropRefs(u, propRefByName)) : withPlate(pickRefs(u, refByName, plateForScene[u.sceneId] || referenceUrl), plateForScene[u.sceneId])), size: STILL_SIZE, seed: seedOf(u.id),
      storyNeed: needById[u.sceneId] || "", canon: canonById[u.sceneId] || "",
      onStep: (a, v, url) => { log(`   ${u.id} still ${a}: pass=${v.pass}`); emit(u.id, { status: v.pass ? "frame" : "drawing", stillUrl: url, attempt: a, pass: v.pass }); },
      onInspect: (kind, a, v, url) => { if (!v.pass && !v._skipped) { const det = (v.issues || v.missing || v.violations || []).slice(0, 2).join(", "); const lbl = kind === "coherence" ? "coherence" : kind === "bible" ? "bible" : "story-need"; log(`   ${u.id} ${lbl} ${a}: FLAG${det ? " \u2014 " + det : ""}`); emit(u.id, { [kind]: "flag" }); } },
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
        const sevSplit = (arr) => ({ major: arr.filter((d) => String(d.severity).toLowerCase() !== "minor").length, minor: arr.filter((d) => String(d.severity).toLowerCase() === "minor").length });
        const idr = await identityReview(refByName, toFrames(sampled));
        if (idr.ok) {
          const driftIn = (idr.review.drift || []).filter((d) => sampleByScene.has(+d.id));
          signals.identity = { drift: driftIn.length, ...sevSplit(driftIn), sampled: sampled.length };
          if (idr.review.consistent && !driftIn.length) log(`identity: characters consistent with references`);
          else log(`identity: drift ${driftIn.length} (${signals.identity.major} major / ${signals.identity.minor} minor)`);
          for (const d of driftIn.slice(0, 6)) {
            const isMajor = String(d.severity).toLowerCase() !== "minor";
            log(`identity: drift S${d.id}${d.character ? " (" + d.character + ")" : ""}${isMajor ? "" : " [minor]"}${d.issue ? " — " + d.issue : ""}`);
            // Only MAJOR drift earns a re-roll: v4 (5->7) and v6 (3->6) both showed that re-rolling
            // for minor detail drift RANDOMIZES other details and produces net-more drift. Minors are
            // logged and scored (5 pts each) but the frame is kept.
            if (!isMajor) continue;
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
            const fixPrompt = `${u.prompts.image_prompt}. Overall style: ${p.style}.${canonById[sid] ? ` LOCKED CANON — keep these EXACT, identical every shot: ${String(canonById[sid]).replace(/\n/g, " | ")}.` : ""} STORY FIX — the previous version failed because: ${issue}. This frame MUST clearly read as this story beat: ${beat}.`;
            emit(u.id, { status: "drawing", storyfix: true });
            const re = await approvedStill(fixPrompt, { referenceUrl: pickRefs(u, refByName, referenceUrl), size: STILL_SIZE, seed: seedOf(u.id + "-fix"),
              storyNeed: needById[sid] || "", canon: canonById[sid] || "",
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
            // ---- IDENTITY RE-CHECK: the re-rolls updated u.stillUrl in place, but the drift count
            // feeding the KPI was frozen pre-fix — re-grade so identity scores the FIXED frames.
            if (signals.identity && process.env.QWEN_IDENTITY_RECHECK !== "0") {
              const idr2 = await identityReview(refByName, toFrames(sampled));
              if (idr2.ok) {
                const stillDrift = (idr2.review.drift || []).filter((d) => sampleByScene.has(+d.id));
                const sv = sevSplit(stillDrift);
                log(`identity: re-check after fixes — drift ${signals.identity.drift} -> ${stillDrift.length} (${sv.major} major / ${sv.minor} minor)`);
                signals.identity = { ...signals.identity, drift: stillDrift.length, ...sv };
              } else log(`identity: re-check skipped — keeping pre-fix drift count`);
            }
          }
        }
      } else { log(`story-review: skipped`); }
    }
  } catch (e) { log(`story-review: error — ${e.message}`); }

  // ---- SCRIPT SUPERVISOR: adjacent-frame continuity — grade each CUT, re-roll the later frame on a break ----
  // Per-frame inspectors judge a still alone; this walks the film IN ORDER and judges each PAIR of
  // consecutive frames together (wardrobe, location, lighting, props, identity carrying across the cut).
  // A fixed frame becomes the anchor for the next pair, so a correction propagates forward.
  if (process.env.QWEN_STREAM !== "1" && process.env.QWEN_CONTINUITY !== "0") {
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
          const fixPrompt = `MATCH THE PREVIOUS SHOT of this scene for continuity. The FIRST reference image IS that previous shot: keep its EXACT location, time of day, lighting, wardrobe colors, hair, and key props.${canonById[cur.sceneId] ? ` LOCKED CANON — keep these EXACT, identical every shot: ${String(canonById[cur.sceneId]).replace(/\n/g, " | ")}.` : ""} Fix specifically: ${det || 'wardrobe color, lighting, location, props'}. ${adj.fix_hint || ''} Then render this next moment, changing only the camera framing and the action: ${cur.prompts.image_prompt}. Overall style: ${p.style}.`.trim();
          const refs = [prev.stillUrl, plateForScene[cur.sceneId], ...(pickRefs(cur, refByName, referenceUrl) || [])].filter(Boolean).slice(0, 3);
          emit(cur.id, { status: "drawing", continuityfix: true });
          const re = await approvedStill(fixPrompt, { referenceUrl: refs, size: STILL_SIZE, seed: seedOf(cur.id + "-cont"),
            storyNeed: needById[cur.sceneId] || "", canon: canonById[cur.sceneId] || "",
            onStep: (a, v, url) => { emit(cur.id, { status: v.pass ? "frame" : "drawing", stillUrl: url, attempt: a, pass: v.pass }); },
            onLegal: (a, lv) => { emit(cur.id, { legal: lv.pass ? "clear" : "flag" }); } });
          if (re.url) {
            const recheck = await adjacentContinuityReview(prev.stillUrl, re.url);   // keep only if it actually helped
            cur.stillUrl = re.url;
            if (recheck._skipped || recheck.continuous !== false) { fixed++; emit(cur.id, { status: "frame", stillUrl: re.url, continuityfixed: true }); log(`continuity: ${cur.id} re-rolled to match`); }
            else if ((recheck.breaks || []).length < (adj.breaks || []).length) { fixed++; emit(cur.id, { status: "frame", stillUrl: re.url, continuityfixed: true }); log(`continuity: ${cur.id} improved (${(adj.breaks || []).length}->${(recheck.breaks || []).length} issue(s))`); }
            else { emit(cur.id, { status: "frame", stillUrl: re.url }); log(`continuity: ${cur.id} still imperfect after re-roll \u2014 kept closest`); }
          } else log(`continuity: ${cur.id} re-roll blocked \u2014 kept original`);
        }
        log(`continuity: ${breaks} break(s) found, ${fixed} fixed across ${seq.length - 1} cut(s)`);
        signals.continuity = { ...(signals.continuity || {}), cuts: seq.length - 1, breaks, fixed };
      }
    } catch (e) { log(`continuity: error \u2014 ${e.message}`); }
  }

  // ---- CLOSED-LOOP KPI (Feature 2): PRE-GRADE the storyboard; if a key dimension is weak, re-shoot the
  // single weakest beat and RE-GRADE — the self-evaluation now has teeth instead of just being a report card.
  // Runs on stills (before the expensive animate/assemble) so a correction lifts the final cut's KPI.
  if (process.env.QWEN_STREAM !== "1" && process.env.QWEN_RESHOOT !== "0") {
    try {
      const oneByScene = [...new Map(units.filter((u) => u.stillUrl).map((u) => [u.sceneId, u])).values()];
      const preFrames = oneByScene.map((u) => u.stillUrl).slice(0, 8);
      if (preFrames.length >= 2) {
        const pre = await evaluate({ plan: p, signals, frames: preFrames });
        const pd = pre.dimensions;
        log(`pre-grade: KPI ${pre.score}/100 \u2014 continuity ${pd.continuity} \u00b7 identity ${pd.identity} \u00b7 beats ${pd.beats} \u00b7 through-line ${pd.throughline}${pd.craft != null ? ` \u00b7 craft ${pd.craft}` : ""}`);
        const RESHOOT_AT = +(process.env.QWEN_RESHOOT_AT || 85);
        const weakDim = pickWeakDimension(pd);
        if (pre.score < RESHOOT_AT && weakDim) {
          const wf = await weakestFrame(preFrames, weakDim);
          const u = oneByScene[Math.min(oneByScene.length - 1, (wf.frame || 1) - 1)];
          log(`reshoot: KPI ${pre.score} < ${RESHOOT_AT}; weakest dimension = ${weakDim} \u2192 re-shooting S${u.sceneId}${wf.why ? ` (${wf.why})` : ""}`);
          const fixPrompt = `${u.prompts.image_prompt}. Overall style: ${p.style}.${canonById[u.sceneId] ? ` LOCKED CANON \u2014 keep these EXACT, identical every shot: ${String(canonById[u.sceneId]).replace(/\n/g, " | ")}.` : ""} SELF-CRITIQUE FIX \u2014 the film graded weakest on ${weakDim}. ${wf.why || ""}. Make this key frame markedly stronger on ${weakDim}: a clear on-model subject, consistent continuity, and clearly on its story beat.`;
          emit(u.id, { status: "drawing", reshoot: true });
          const re = await approvedStill(fixPrompt, { referenceUrl: pickRefs(u, refByName, referenceUrl), size: STILL_SIZE, seed: seedOf(u.id + "-reshoot"),
            storyNeed: needById[u.sceneId] || "", canon: canonById[u.sceneId] || "",
            onStep: (a, v, url) => { emit(u.id, { status: v.pass ? "frame" : "drawing", stillUrl: url, attempt: a, pass: v.pass }); },
            onLegal: (a, lv) => { emit(u.id, { legal: lv.pass ? "clear" : "flag" }); } });
          if (re.url) {
            u.stillUrl = re.url; emit(u.id, { status: "frame", stillUrl: re.url, reshot: true });
            const post = await evaluate({ plan: p, signals, frames: oneByScene.map((x) => x.stillUrl).slice(0, 8) });
            log(`re-grade: KPI ${pre.score} \u2192 ${post.score}/100 after re-shooting S${u.sceneId} (${weakDim} ${pd[weakDim]} \u2192 ${post.dimensions[weakDim]})`);
            signals.reshoot = { dim: weakDim, scene: u.sceneId, before: pre.score, after: post.score };
          } else log(`reshoot: re-roll blocked \u2014 kept original`);
        } else log(`pre-grade: KPI ${pre.score} \u2265 ${RESHOOT_AT} \u2014 no re-shoot needed`);
      }
    } catch (e) { log(`reshoot: error \u2014 ${e.message}`); }
  }

  // ---- PHASE 2: ANIMATE — dispatch videos with bounded concurrency (free-tier safe) ----
  // Longtake spine shots are keyframe-anchored: use the scene's first cutaway still as the "last
  // frame" so the take interpolates toward a real second composition (steadier than first-frame i2v).
  const lastFrameForScene = new Map();
  for (const u of units) { if (u.role === "cutaway" && u.stillUrl && !lastFrameForScene.has(u.sceneId)) lastFrameForScene.set(u.sceneId, u.stillUrl); }
  const KEYFRAME = process.env.QWEN_KEYFRAME !== "0";
  log(`animate: ${units.length} clips (video x${VIDEO_CC} parallel)${KEYFRAME ? " · keyframe spine takes" : ""}`);
  const beatOf = (sid) => (p.scenes.find((s) => s.id === sid) || {}).beat || "";
  // Anti-duplication clause for every image-anchored take: the most common motion-QA failure is the
  // video model ADDING or duplicating figures ("5th figure appeared", "duplicate head") mid-clip.
  const HOLD_CAST = " Keep exactly the same people and objects as the source frame: do not add, remove, or duplicate any person, figure, prop, or vehicle; keep the same location, weather, and lighting; the background stays unchanged.";
  let clipChecked = 0, clipFlagged = 0;
  const CLIP_QA = process.env.QWEN_CLIP_QA !== "0";
  async function animateUnit(u) {
    if (!u.stillUrl) { emit(u.id, { status: "blocked" }); return; }   // blocked still -> skip, keep the job alive
    emit(u.id, { status: "video_pending" });
    const onTick = (st, s) => { log(`   ${u.id} [${s}s] ${st}`); emit(u.id, { status: st === "SUCCEEDED" ? "clip" : "animating", secs: s }); };
    let clip;
    if (u.role === "spine") {
      const lastUrl = lastFrameForScene.get(u.sceneId);
      const i2vSpine = () => video((u.prompts.motion_prompt || "slow cinematic camera move, continuous flowing take") + HOLD_CAST,
        { imageUrl: u.stillUrl, resolution: "720P", shot_type: "multi", duration: u.takeDur, onTick });
      if (KEYFRAME && lastUrl && lastUrl !== u.stillUrl) {
        try {
          clip = await keyframeVideo(u.stillUrl, lastUrl, (u.prompts.motion_prompt || "smooth continuous cinematic camera move, single flowing take") + HOLD_CAST, { resolution: "720P", onTick });
          log(`   ${u.id} keyframe take (first→last)`);
        } catch (e) {
          log(`   ${u.id} keyframe failed (${e.message.slice(0, 50)}) — i2v fallback`);
          clip = await i2vSpine();
        }
      } else {
        clip = await i2vSpine();
      }
    } else if (u.role === "cutaway" || u.shot.mode === "i2v") {
      // EXPERIMENT (QWEN_R2V=1, off by default): reference-to-video preserves the referenced character
      // DURING video generation — attacking the drift i2v can't (it only sees the first frame). Trades
      // away the approved-still anchor for identity hold; falls back to i2v on any failure.
      const R2V = process.env.QWEN_R2V === "1";
      const r2vRefs = R2V ? [...Object.values(refByName).slice(0, 2), plateForScene[u.sceneId]].filter((u2) => u2 && /^https?:/i.test(u2)) : [];   // r2v API takes PUBLIC URLs only — vault data-URI anchors can't ride
      if (R2V && r2vRefs.length) {
        try {
          const legend = Object.keys(refByName).slice(0, 2).map((n, i) => `character${i + 1} is ${n}`).join("; ");
          clip = await r2v(`${legend}. ${u.prompts.image_prompt}. ${u.prompts.motion_prompt || "subtle natural cinematic motion"}${HOLD_CAST}`,
            r2vRefs, { duration: u.shot.duration, seed: seedOf(u.id + "-r2v"), onTick });
          log(`   ${u.id} r2v take (${r2vRefs.length} ref(s))`);
        } catch (e) {
          log(`   ${u.id} r2v failed (${e.message.slice(0, 50)}) — i2v fallback`);
          clip = null;
        }
      }
      // COVERAGE (QWEN_TAKES>=2, default off): a director shoots coverage — N seed-varied takes in
      // parallel; motion-QA picks the best, the rest are struck. Bounded at 3 takes.
      const TAKES = Math.min(3, Math.max(1, +(process.env.QWEN_TAKES || 1)));
      if (!clip && TAKES >= 2) {
        try {
          const takes = await Promise.all(Array.from({ length: TAKES }, (_, k) =>
            video((u.prompts.motion_prompt || "subtle natural motion, slow cinematic camera move") + HOLD_CAST,
              { imageUrl: u.stillUrl, resolution: "720P", duration: u.shot.duration, seed: seedOf(u.id + "-take" + k), onTick })
              .catch(() => null)));
          const scored = [];
          for (let k = 0; k < takes.length; k++) {
            if (!takes[k]?.url) continue;
            const tPath = path.join(dir, `take_${u.id}_${k}.mp4`);
            await download(takes[k].url, tPath);
            let verdict = { pass: false, issues: [], _skipped: true };
            try { verdict = await clipReview(u.stillUrl, await lastFrameDataUri(tPath), beatOf(u.sceneId)); } catch {}
            scored.push({ path: tPath, verdict });
          }
          const best = scored.sort((a, b) => ((b.verdict.pass === true) - (a.verdict.pass === true)) || ((a.verdict.issues?.length || 9) - (b.verdict.issues?.length || 9)))[0];
          if (best) {
            u.clipPath = path.join(dir, `clip_${u.id}.mp4`);
            copyFileSync(best.path, u.clipPath);
            for (const s of scored) { try { rmSync(s.path); } catch {} }
            log(`   ${u.id} coverage: ${scored.length} take(s) reviewed — best ${best.verdict.pass ? "PASSES" : "kept-closest"}`);
            u._coverageDone = true;
            clip = { url: null };
          }
        } catch (e) { log(`   ${u.id} coverage failed (${String(e.message).slice(0, 40)}) — single take`); }
      }
      if (!clip) clip = await video((u.prompts.motion_prompt || "subtle natural motion, slow cinematic camera move") + HOLD_CAST,
        { imageUrl: u.stillUrl, resolution: "720P", duration: u.shot.duration, onTick });
    } else {
      clip = await video(`${u.prompts.image_prompt}. Overall style: ${p.style}. ${u.prompts.motion_prompt || ""}`.trim(),
        { size: VIDEO_SIZE, shot_type: "multi", onTick });
    }
    emit(u.id, { status: "clip" });
    if (!u._coverageDone) {
      u.clipPath = path.join(dir, `clip_${u.id}.mp4`);
      await download(clip.url, u.clipPath);
    }
    // ---- CLIP QA (Feature 4): grade the MOTION — pull a late frame and check the take didn't morph the subject ----
    if (CLIP_QA && u.stillUrl) {
      try {
        const frameUri = await lastFrameDataUri(u.clipPath);
        const cr = await clipReview(u.stillUrl, frameUri, beatOf(u.sceneId));
        if (!cr._skipped) {
          clipChecked++;
          if (!cr.pass) {
            clipFlagged++;
            const det = (cr.issues || []).slice(0, 2).join(", ");
            log(`   ${u.id} clip-qa: FLAG${det ? " \u2014 " + det : ""}`);
            emit(u.id, { clip: "flag" });
            if (process.env.QWEN_CLIP_FIX !== "0") {   // ON by default: one steadier re-animation from the same still
              try {
                const steadier = `${u.prompts.motion_prompt || "subtle natural motion"}. Keep the subject stable and on-model; ${cr.fix_hint || "no morphing, gentle camera move only"}.` + HOLD_CAST;
                const re = await video(steadier, { imageUrl: u.stillUrl, resolution: "720P", duration: u.shot.duration || u.takeDur, onTick });
                const rePath = u.clipPath.replace(/\.mp4$/i, "_fix.mp4");
                await download(re.url, rePath);
                // VERIFY the re-take before adopting it: only a take that now passes motion QA replaces
                // the original (and clears its flag); a re-take that is also bad keeps the original.
                const reUri = await lastFrameDataUri(rePath);
                const rr = await clipReview(u.stillUrl, reUri, beatOf(u.sceneId));
                if (rr.pass && !rr._skipped) {
                  copyFileSync(rePath, u.clipPath);
                  clipFlagged--;
                  log(`   ${u.id} clip-qa: re-animated steadier, verified, flag cleared`);
                  emit(u.id, { clip: "refixed" });
                } else {
                  log(`   ${u.id} clip-qa: re-take ${rr._skipped ? "unverifiable" : "still flagged"}, kept original`);
                }
                try { rmSync(rePath); } catch {}
              } catch (e) { log(`   ${u.id} clip-qa re-animate failed \u2014 kept original`); }
            }
          } else { emit(u.id, { clip: "ok" }); }
        }
      } catch (e) { log(`   ${u.id} clip-qa error \u2014 ${e.message}`); }
    }
  }

  // ---- STREAMING (QWEN_STREAM=1): a shot animates the moment TWO agents OK it — its own quality gate
  // (the Phase-1 inspectors that already approved the still) and the adjacent-continuity critic vs the
  // previous FINAL shot. Each shot's (slow) animation then overlaps the continuity work of the shots
  // after it, instead of the whole storyboard finishing before any video starts.
  if (process.env.QWEN_STREAM === "1") {
    const seq = units.filter((u) => u.stillUrl && !u.blocked);   // renderable frames, in film order
    // Identify the single weakest frame up front (ONE grade, not a per-shot barrier) so it can be
    // re-rolled when the loop reaches it — "if one of the ones is the weakest frame, re-roll it".
    let weakId = null;
    if (process.env.QWEN_RESHOOT !== "0") {
      try {
        const oneByScene = [...new Map(seq.map((u) => [u.sceneId, u])).values()];
        const preFrames = oneByScene.map((u) => u.stillUrl).slice(0, 8);
        if (preFrames.length >= 2) {
          const pre = await evaluate({ plan: p, signals, frames: preFrames });
          const pd = pre.dimensions;
          log(`pre-grade: KPI ${pre.score}/100 \u2014 continuity ${pd.continuity} \u00b7 identity ${pd.identity} \u00b7 beats ${pd.beats} \u00b7 through-line ${pd.throughline}${pd.craft != null ? ` \u00b7 craft ${pd.craft}` : ""}`);
          const weakDim = pickWeakDimension(pd);
          if (pre.score < +(process.env.QWEN_RESHOOT_AT || 85) && weakDim) {
            const wf = await weakestFrame(preFrames, weakDim);
            weakId = oneByScene[Math.min(oneByScene.length - 1, (wf.frame || 1) - 1)].id;
            log(`stream: weakest frame = ${weakId} (${weakDim}) \u2014 re-rolling it before it animates`);
          } else log(`pre-grade: KPI ${pre.score} \u2265 ${+(process.env.QWEN_RESHOOT_AT || 85)} \u2014 no re-shoot needed`);
        }
      } catch (e) { log(`pre-grade: error \u2014 ${e.message}`); }
    }
    log(`stream: animating as each shot clears continuity (video x${VIDEO_CC} parallel)`);
    let breaks = 0, fixed = 0;
    const pool = [];
    const dispatch = (u) => {
      const pr = Promise.resolve().then(() => animateUnit(u)).catch((e) => log(`   ${u.id} animate error \u2014 ${e.message}`)).finally(() => { const k = pool.indexOf(pr); if (k >= 0) pool.splice(k, 1); });
      pool.push(pr);
    };
    for (let i = 0; i < seq.length; i++) {
      const cur = seq[i], prev = seq[i - 1];
      // AGENT 2 — adjacent continuity vs the previous FINAL shot; re-roll the later frame on a break.
      if (i > 0 && process.env.QWEN_CONTINUITY !== "0") {
        try {
          const adj = await adjacentContinuityReview(prev.stillUrl, cur.stillUrl);
          if (!adj._skipped && adj.continuous === false) {
            breaks++;
            const det = (adj.breaks || []).slice(0, 3).join(", ");
            log(`continuity: break ${prev.id} \u2192 ${cur.id}${det ? " \u2014 " + det : ""}`);
            emit(cur.id, { continuity: "flag" });
            if (process.env.QWEN_CONTINUITY_FIX !== "0") {
              const fixPrompt = `MATCH THE PREVIOUS SHOT of this scene for continuity. The FIRST reference image IS that previous shot: keep its EXACT location, time of day, lighting, wardrobe colors, hair, and key props.${canonById[cur.sceneId] ? ` LOCKED CANON — keep these EXACT, identical every shot: ${String(canonById[cur.sceneId]).replace(/\n/g, " | ")}.` : ""} Fix specifically: ${det || 'wardrobe color, lighting, location, props'}. ${adj.fix_hint || ''} Then render this next moment, changing only the camera framing and the action: ${cur.prompts.image_prompt}. Overall style: ${p.style}.`.trim();
              const refs = [prev.stillUrl, plateForScene[cur.sceneId], ...(pickRefs(cur, refByName, referenceUrl) || [])].filter(Boolean).slice(0, 3);
              emit(cur.id, { status: "drawing", continuityfix: true });
              const re = await approvedStill(fixPrompt, { referenceUrl: refs, size: STILL_SIZE, seed: seedOf(cur.id + "-cont"), storyNeed: needById[cur.sceneId] || "", canon: canonById[cur.sceneId] || "", onStep: (a, v, url) => emit(cur.id, { status: v.pass ? "frame" : "drawing", stillUrl: url, attempt: a, pass: v.pass }), onLegal: (a, lv) => emit(cur.id, { legal: lv.pass ? "clear" : "flag" }) });
              if (re.url) {
                const recheck = await adjacentContinuityReview(prev.stillUrl, re.url);
                cur.stillUrl = re.url;
                if (recheck._skipped || recheck.continuous !== false) { fixed++; emit(cur.id, { status: "frame", stillUrl: re.url, continuityfixed: true }); log(`continuity: ${cur.id} re-rolled to match`); }
                else if ((recheck.breaks || []).length < (adj.breaks || []).length) { fixed++; emit(cur.id, { status: "frame", stillUrl: re.url, continuityfixed: true }); log(`continuity: ${cur.id} improved (${(adj.breaks || []).length}->${(recheck.breaks || []).length} issue(s))`); }
                else { emit(cur.id, { status: "frame", stillUrl: re.url }); log(`continuity: ${cur.id} still imperfect \u2014 kept closest`); }
              }
            }
          }
        } catch (e) { log(`continuity: error \u2014 ${e.message}`); }
      }
      // WEAKEST FRAME — re-roll the single weakest beat before it animates.
      if (cur.id === weakId) {
        try {
          const fixPrompt = `${cur.prompts.image_prompt}. Overall style: ${p.style}.${canonById[cur.sceneId] ? ` LOCKED CANON \u2014 keep these EXACT, identical every shot: ${String(canonById[cur.sceneId]).replace(/\n/g, " | ")}.` : ""} SELF-CRITIQUE FIX \u2014 make this key frame markedly stronger: a clear on-model subject, consistent continuity, and clearly on its story beat.`;
          const refs = [plateForScene[cur.sceneId], ...(pickRefs(cur, refByName, referenceUrl) || [])].filter(Boolean).slice(0, 3);
          emit(cur.id, { status: "drawing", reshoot: true });
          const re = await approvedStill(fixPrompt, { referenceUrl: refs, size: STILL_SIZE, seed: seedOf(cur.id + "-reshoot"), storyNeed: needById[cur.sceneId] || "", canon: canonById[cur.sceneId] || "", onStep: (a, v, url) => emit(cur.id, { status: v.pass ? "frame" : "drawing", stillUrl: url, attempt: a, pass: v.pass }), onLegal: (a, lv) => emit(cur.id, { legal: lv.pass ? "clear" : "flag" }) });
          if (re.url) { cur.stillUrl = re.url; emit(cur.id, { status: "frame", stillUrl: re.url, reshot: true }); log(`reshoot: ${cur.id} re-rolled (weakest frame)`); }
          else log(`reshoot: ${cur.id} re-roll blocked \u2014 kept original`);
        } catch (e) { log(`reshoot: error \u2014 ${e.message}`); }
      }
      // BOTH AGENTS OK \u2014 animate now (bounded by VIDEO_CC), overlapping later shots' continuity work.
      while (pool.length >= VIDEO_CC) await Promise.race(pool);
      dispatch(cur);
    }
    await Promise.all(pool);
    if (breaks || fixed) { signals.continuity = { ...(signals.continuity || {}), cuts: Math.max(0, seq.length - 1), breaks, fixed }; log(`continuity: ${breaks} break(s) found, ${fixed} fixed across ${Math.max(0, seq.length - 1)} cut(s) (streaming)`); }
  } else {
    await mapLimit(units, VIDEO_CC, animateUnit);
  }

  if (CLIP_QA && clipChecked) { log(`clip-qa: ${clipFlagged} of ${clipChecked} take(s) flagged for motion issues`); signals.clips = { checked: clipChecked, flagged: clipFlagged }; }

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
      const voPath = useVO ? await voiceForScene(leadVO, path.join(dir, `vo_s${sp.scene.id}.wav`), { voice: narVoice || pickVoice(p, spineU.shot), maxDur: spineU.takeDur || 0, log }) : null;
      sceneFinal = path.join(dir, `scene_${sp.scene.id}.mp4`);
      await buildSegment(sceneClip, voPath, sceneFinal);
    } else {
      const segs = [];
      let i = 0, lead = true;
      for (const u of us) {
        const voObj = lead ? { narration: sp.scene.narration || "", dialogue: u.shot.dialogue || [] } : u.shot;
        const voPath = useVO ? await voiceForScene(voObj, path.join(dir, `vo_${u.id}.wav`), { voice: narVoice || pickVoice(p, u.shot), maxDur: u.shot.duration || 0, log }) : null;
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
    // Persist the severity split so the gallery/job UI can show WHY identity scored what it did.
    if (signals.identity && (signals.identity.major != null || signals.identity.minor != null))
      evaluation.identity_split = { major: signals.identity.major || 0, minor: signals.identity.minor || 0 };
    writeFileSync(path.join(dir, "evaluation.json"), JSON.stringify(evaluation, null, 2));
    const d = evaluation.dimensions;
    log(`evaluation: KPI ${evaluation.score}/100 — continuity ${d.continuity} · identity ${d.identity} · beats ${d.beats} · through-line ${d.throughline}${d.craft != null ? ` · craft ${d.craft}` : ""}`);
    if (evaluation.critique) log(`evaluation: ${evaluation.critique}`);
    emit("_eval", { kpi: evaluation.score, dimensions: d });
  } catch (e) { log(`evaluation: error — ${e.message}`); }

  // ---- SEASON: bank this film's cast so the next episode stars the same actors ----
  if (seasonName) {
    try {
      const sv = saveCast(seasonName, { storyState, localRefByName, style: p.style, title: p.title });
      log(`season: vault "${seasonName}" updated — ${sv.cast} cast member(s) banked`);
    } catch (e) { log(`season: save failed — ${e.message}`); }
  }

  return { title: p.title, finalPath, scenes: scenesPlan.length, kpi: evaluation?.score ?? null, evaluation, season: seasonName || null };
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

// Lowest-scoring rubric dimension — the one a self-correction re-shoot should target.
function pickWeakDimension(dims) {
  let lo = null, k = null;
  for (const key of ["continuity", "identity", "beats", "throughline", "craft"]) {
    const v = dims[key]; if (v == null) continue;
    if (lo === null || v < lo) { lo = v; k = key; }
  }
  return k;
}

// Append a locked LOCATION plate to a shot's character references so the place stays consistent
// across every shot set there. Characters lead (identity first); the plate rides along, capped at 3.
function withPlate(refs, plate) {
  const base = refs || [];
  if (!plate) return base.length ? base : null;
  if (base.includes(plate)) return base.slice(0, 3);
  return [...base, plate].slice(0, 3);
}

// Pick reference image(s) for recurring PROPS that appear in this shot (by name token).
function pickPropRefs(u, propRefByName) {
  const names = Object.keys(propRefByName || {});
  if (!names.length) return [];
  const hay = `${u.prompts?.image_prompt || ""} ${u.shot?.action || ""} ${u.shot?.subject || ""}`.toLowerCase();
  const matched = names
    .filter((n) => n.replace(/[()]/g, " ").split(/\s+/).some((tok) => tok.length >= 3 && !REF_STOP.has(tok) && hay.includes(tok)))
    .map((n) => propRefByName[n]);
  if (matched.length) return matched;
  // Synonym-proof fallback: shot prompts call the central prop "the device"/"the box", so token-match
  // misses it. With only 1-2 tracked props, anchor them on every shot so the object stops drifting.
  return names.length ? [propRefByName[names[0]]] : [];
}

// Compose a shot's reference budget (max 3 for imageEdit): character refs first (face + wardrobe,
// the proven anchors), then the location plate, then any relevant prop ref in the leftover slot.
function withRefs(refs, plate, propRefs) {
  const out = (refs || []).slice(0, 2);
  if (plate && !out.includes(plate)) out.push(plate);
  for (const pr of (propRefs || [])) { if (out.length >= 3) break; if (pr && !out.includes(pr)) out.push(pr); }
  return out.length ? out.slice(0, 3) : null;
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

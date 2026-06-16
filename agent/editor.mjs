// agent/editor.mjs — "long-take -> cut-up" mode.
// 1) generate one continuous long take, 2) generate cutaway shots,
// 3) an EDITOR agent builds an edit-decision list interleaving slices of the take with
//    cutaways (only where it makes artistic sense), 4) ffmpeg assembles the final cut.
import { mkdirSync } from "node:fs";
import path from "node:path";
import { chat, video, download } from "../lib/qwen.mjs";
import { approvedStill } from "./visualQA.mjs";
import { parseJson } from "./planner.mjs";
import { buildSegmentRange, concat } from "./stitch.mjs";

const EDITOR_SYS = `You are a film editor. You have ONE continuous long-take clip and a set of CUTAWAY shots.
Build an edit that keeps the long take as the spine but intercuts cutaways for rhythm and emphasis -- only where it makes artistic sense.
Return STRICT JSON ONLY:
{"edl":[{"source":"main"|"<cutawayId>","in":number,"out":number,"why":string}]}
Rules:
- "main" entries are time slices of the long take ([in,out] in seconds within its duration), in INCREASING order, together covering most of the take.
- Cutaway entries: source = the cutaway id; [in,out] within THAT cutaway's duration (use its full length if unsure).
- Interleave: some main, cut to a cutaway, back to main, etc. 3-6 segments total. Do not overcut. Keep in/out within each source's stated duration.
- "why" = a few words on the cut's intent.`;

export async function editorPlan(longTake, cutaways, { model = "qwen-max" } = {}) {
  const ctx =
    `LONG TAKE: duration ${longTake.duration}s -- ${longTake.description}\n\nCUTAWAYS:\n` +
    cutaways.map((c) => `- id "${c.id}": duration ${c.duration}s -- ${c.description}`).join("\n");
  const { text } = await chat([{ role: "system", content: EDITOR_SYS }, { role: "user", content: ctx }], { model, temperature: 0.7, max_tokens: 800 });
  return parseJson(text).edl || [];
}

// Cut and concat per the EDL (uniform segments -> stream-copy concat).
export async function assembleEdit(longTakePath, cutawayPaths, edl, outPath, dir) {
  const segs = [];
  let i = 0;
  for (const cut of edl) {
    const src = cut.source === "main" ? longTakePath : cutawayPaths[cut.source];
    if (!src) continue;
    const seg = path.join(dir, `edl_${String(++i).padStart(2, "0")}.mp4`);
    await buildSegmentRange(src, seg, { ss: Math.max(0, cut.in ?? 0), to: cut.out });
    segs.push(seg);
  }
  await concat(segs, outPath, path.join(dir, "edl_concat.txt"));
  return { outPath, segments: segs.length };
}

// Full path: generate the long take + cutaways, then edit. (Spends video quota.)
export async function longTakeSequence({ takePrompt, takeMotion = "", takeDuration = 8, cutaways = [], style = "", outDir = "output/longtake", log = console.log }) {
  const dir = path.resolve(outDir);
  mkdirSync(dir, { recursive: true });

  log("generating long take...");
  const take = await video(`${takePrompt}. ${takeMotion}`.trim(), {
    size: "1280*720", shot_type: "multi", duration: takeDuration, onTick: (st, s) => log(`  take [${s}s] ${st}`),
  });
  const takePath = path.join(dir, "longtake.mp4");
  await download(take.url, takePath);

  const cutawayPaths = {}, cutaMeta = [];
  for (const c of cutaways) {
    log(`cutaway "${c.id}"...`);
    const still = await approvedStill(style ? `${c.prompt}. Overall style: ${style}` : c.prompt);
    const clip = await video(c.motion || "subtle natural motion", {
      imageUrl: still.url, resolution: "720P", duration: c.duration || 3, onTick: (st, s) => log(`  cut ${c.id} [${s}s] ${st}`),
    });
    const p = path.join(dir, `cutaway_${c.id}.mp4`);
    await download(clip.url, p);
    cutawayPaths[c.id] = p;
    cutaMeta.push({ id: c.id, duration: c.duration || 3, description: c.prompt });
  }

  const edl = await editorPlan({ duration: takeDuration, description: takePrompt }, cutaMeta);
  log("EDL: " + JSON.stringify(edl));
  const out = path.join(dir, "edited.mp4");
  const r = await assembleEdit(takePath, cutawayPaths, edl, out, dir);
  log(`assembled ${r.segments} cuts -> ${out}`);
  return { editedPath: out, edl };
}

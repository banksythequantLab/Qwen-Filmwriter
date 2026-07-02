// episodes.mjs — produce three EPISODE 1 films, each founding its own SEASON vault so later
// episodes can star the same cast. Runs sequentially (the pipeline already parallelizes inside a
// film; three at once would trip API rate limits).
import { showrun } from "./agent/showrun.mjs";

const EPISODES = [
  {
    season: "forgotten-god",
    voiceover: true,   // the god IS the narrator — force the voiceover form
    logline: "A forgotten god who has lost every last worshipper watches over one orphan pickpocket in a lawless ancient city of thieves, spending the dregs of his divine power to nudge the boy's luck — small wins, lucky escapes — hoping to earn back his very first believer.",
  },
  {
    season: "warlords-sniper",
    logline: "A veteran female sniper in the service of a ruthless warlord is dispatched across a war-torn frontier to assassinate a young prince before his coronation.",
  },
  {
    season: "hero-ai",
    logline: "An artificial intelligence built for city maintenance becomes the world's unlikely hero when it alone detects a global catastrophe in motion — and must convince, outrun, and finally save the humans who would switch it off.",
  },
];

for (const ep of EPISODES) {
  console.log(`\n\n======== EPISODE 1 · season "${ep.season}" ========`);
  const t0 = Date.now();
  try {
    const r = await showrun(ep.logline, { scenes: 3, voiceover: !!ep.voiceover, season: ep.season, outDir: `output/episodes/${ep.season}` });
    console.log(`EPISODE DONE: "${r.title}" · KPI ${r.kpi} · ${Math.round((Date.now() - t0) / 60000)} min -> ${r.finalPath}`);
  } catch (e) {
    console.error(`EPISODE FAILED (${ep.season}): ${e.message} — continuing to next story`);
  }
}
console.log("\n======== ALL THREE EPISODES COMPLETE ========");

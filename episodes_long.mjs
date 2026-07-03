// episodes_long.mjs — the three commissioned stories re-shot LONG-FORM (~3 min each):
// 6 scenes, establishing-first shots at 6-8s, expository narration. Same season names, so the
// vault cast returns; output goes to <season>-long, leaving the short originals untouched.
import { showrun } from "./agent/showrun.mjs";

const EPISODES = [
  {
    season: "forgotten-god",
    voiceover: true,
    logline: "A forgotten god who has lost every last worshipper watches over one orphan pickpocket in a lawless ancient city of thieves, spending the dregs of his divine power to nudge the boy's luck — small wins, lucky escapes — hoping to earn back his very first believer.",
  },
  {
    season: "warlords-sniper",
    logline: "A veteran female sniper in the service of a ruthless warlord is dispatched across a war-torn frontier to assassinate a young prince before his coronation.",
  },
  {
    season: "hero-ai",
    voiceover: true,
    logline: "An artificial intelligence built for city maintenance becomes the world's unlikely hero when it alone detects a global catastrophe in motion — and must convince, outrun, and finally save the humans who would switch it off.",
  },
];

for (const ep of EPISODES) {
  console.log(`\n\n======== LONGFORM · season "${ep.season}" ========`);
  const t0 = Date.now();
  try {
    const r = await showrun(ep.logline, { scenes: 6, voiceover: !!ep.voiceover, season: ep.season, outDir: `output/episodes/${ep.season}-long` });
    console.log(`EPISODE DONE: "${r.title}" · KPI ${r.kpi} · ${Math.round((Date.now() - t0) / 60000)} min -> ${r.finalPath}`);
  } catch (e) {
    console.error(`EPISODE FAILED (${ep.season}): ${e.message} — continuing`);
  }
}
console.log("\n======== ALL LONGFORM EPISODES COMPLETE ========");

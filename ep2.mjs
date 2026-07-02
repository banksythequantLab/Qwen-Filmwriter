// ep2.mjs — SECOND EPISODES: the season-vault proof. Two runs, sequential:
//   1) warlords-sniper ep2 — CLEAN flags (this is the demo centerpiece; no experiments on it).
//      Lena and Prince Elian return from the vault: same faces, same wardrobe locks.
//   2) hero-ai ep2 — with COVERAGE (QWEN_TAKES=2) and R2V (QWEN_R2V=1) to validate both flags
//      in one paid run. Eva, Dr. Chen, and Mayor Jackson return.
import { showrun } from "./agent/showrun.mjs";

const EPISODES = [
  {
    season: "warlords-sniper",
    env: {},
    logline: "The sniper Lena, now hunted by the warlord she served, crosses the frontier once more — this time to protect the young prince she was sent to kill.",
  },
  {
    season: "hero-ai",
    env: { QWEN_TAKES: "2", QWEN_R2V: "1" },
    logline: "Eva, the city's guardian AI, must outthink a rival intelligence that studied her heroics and learned all the wrong lessons.",
  },
];

for (const ep of EPISODES) {
  console.log(`\n\n======== EPISODE 2 · season "${ep.season}" ========`);
  for (const [k, v] of Object.entries(ep.env)) process.env[k] = v;
  const t0 = Date.now();
  try {
    const r = await showrun(ep.logline, { scenes: 3, season: ep.season, outDir: `output/episodes/${ep.season}-ep2` });
    console.log(`EPISODE DONE: "${r.title}" · KPI ${r.kpi} · ${Math.round((Date.now() - t0) / 60000)} min -> ${r.finalPath}`);
  } catch (e) {
    console.error(`EPISODE FAILED (${ep.season}): ${e.message} — continuing`);
  }
  for (const k of Object.keys(ep.env)) delete process.env[k];
}
console.log("\n======== EPISODE 2 PAIR COMPLETE ========");

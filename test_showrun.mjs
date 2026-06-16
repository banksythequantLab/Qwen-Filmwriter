// test_showrun.mjs — full autonomous run, new shot-level pipeline.
import { showrun } from "./agent/showrun.mjs";
const logline = process.argv[2] || "A lonely android busker in a neon megacity discovers it can dream.";
const t0 = Date.now();
const r = await showrun(logline, { scenes: 2 });
console.log(`\ndone: "${r.title}" (${r.shots} shots) in ${Math.round((Date.now() - t0) / 1000)}s`);
console.log(r.finalPath);

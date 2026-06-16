// demo.mjs — Filmwriter CLI. One logline in, a finished short out.
//   node --env-file=.env demo.mjs "your logline here" [scenes]
import { showrun } from "./agent/showrun.mjs";
const logline = process.argv[2] || "A lonely android busker in a neon megacity discovers it can dream.";
const scenes = Number(process.argv[3]) || 3;
const t0 = Date.now();
const r = await showrun(logline, { scenes });
console.log(`\n✅ "${r.title}" in ${Math.round((Date.now() - t0) / 1000)}s -> ${r.finalPath}`);

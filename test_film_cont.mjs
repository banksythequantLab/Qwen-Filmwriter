// test_film_cont.mjs — end-to-end continuity: reference -> reference-anchored shot stills -> film.
import { showrun } from "./agent/showrun.mjs";
const logline = process.argv[2] || "A lonely android busker in a neon megacity discovers it can dream.";
const t0 = Date.now();
const r = await showrun(logline, { scenes: 1, forceStrategy: "montage", outDir: "output/continuity_film" });
console.log(`\ndone: "${r.title}" in ${Math.round((Date.now() - t0) / 1000)}s -> ${r.finalPath}`);

// test_longtake.mjs — real long-take demo: 1 scene forced to the long-take strategy.
import { showrun } from "./agent/showrun.mjs";
const logline = process.argv[2] ||
  "A lonely android busker performs a haunting song on a neon street as the indifferent crowd flows past.";
const t0 = Date.now();
const r = await showrun(logline, { scenes: 1, forceStrategy: "longtake", outDir: "output/longtake_demo" });
console.log(`\ndone: "${r.title}" in ${Math.round((Date.now() - t0) / 1000)}s -> ${r.finalPath}`);

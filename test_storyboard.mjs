// test_storyboard.mjs — planning layers only (no rendering, no video quota).
import { showrun } from "./agent/showrun.mjs";
const logline = process.argv[2] || "A lonely android busker in a neon megacity discovers it can dream.";
const r = await showrun(logline, { scenes: 2, render: false });
console.log(`\nplanned "${r.title}" -> ${r.shots} shots (no render). see output/film/storyboard.json`);

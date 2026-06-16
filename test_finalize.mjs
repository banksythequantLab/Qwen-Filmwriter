// test_finalize.mjs — apply the cinematic fade to an existing cut (no API, no quota).
import { finalize } from "./agent/stitch.mjs";
await finalize("output/film/final.mp4", "output/film/final_faded.mp4");
console.log("faded -> output/film/final_faded.mp4");

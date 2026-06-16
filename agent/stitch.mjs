// agent/stitch.mjs — FFmpeg editor. Normalize each scene clip (+voice) to uniform params,
// then concat (stream copy) into one MP4. Local, no quota.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFileSync } from "node:fs";
const exec = promisify(execFile);

async function ff(args) {
  try { await exec("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", ...args], { maxBuffer: 1 << 26 }); }
  catch (e) {
    const tail = (e.stderr?.toString() || e.message).split("\n").slice(-6).join("\n");
    throw new Error("ffmpeg failed:\n" + tail);
  }
}

const SCALE = "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30";
const ENC = ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast", "-c:a", "aac", "-ar", "44100", "-ac", "2", "-shortest"];

// Build one normalized segment (uniform 1280x720/30fps/h264 + aac audio, real or silent).
export async function buildSegment(clipPath, voPath, segPath) {
  if (voPath) {
    await ff(["-i", clipPath, "-i", voPath, "-filter_complex", `[0:v]${SCALE}[v];[1:a]apad[a]`, "-map", "[v]", "-map", "[a]", ...ENC, segPath]);
  } else {
    await ff(["-i", clipPath, "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100", "-filter_complex", `[0:v]${SCALE}[v]`, "-map", "[v]", "-map", "1:a", ...ENC, segPath]);
  }
}

// Concat uniform segments via stream copy.
export async function concat(segAbsPaths, outPath, listPath) {
  writeFileSync(listPath, segAbsPaths.map((p) => `file '${p.replace(/\\/g, "/")}'`).join("\n"));
  await ff(["-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", outPath]);
}

// buildSegmentRange — trim [ss,to] from a clip, normalize to uniform params, add silent audio.
// Used by the long-take editor to slice the main take and cutaways.
export async function buildSegmentRange(clipPath, segPath, { ss = 0, to } = {}) {
  const seek = ["-ss", String(ss)];
  if (to != null) seek.push("-to", String(to));
  await ff([...seek, "-i", clipPath, "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
    "-filter_complex", `[0:v]${SCALE}[v]`, "-map", "[v]", "-map", "1:a", ...ENC, segPath]);
}

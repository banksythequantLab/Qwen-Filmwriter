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
// CRF-with-VBV: quality-targeted but peak-capped at 6 Mbps so grainy footage can't balloon the
// bitrate (was unbounded -> 77MB+/scene, pinning the 2-vCPU box). Keeps files + encode time sane.
const ENC = ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast", "-crf", "23", "-maxrate", "6M", "-bufsize", "12M", "-c:a", "aac", "-ar", "44100", "-ac", "2", "-shortest"];

// Probe whether a media file carries an audio stream.
export async function hasAudio(p) {
  try {
    const { stdout } = await exec("ffprobe", ["-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", p]);
    return stdout.trim().length > 0;
  } catch { return false; }
}

// Probe a media file's duration in seconds (0 if unknown). Used to hard-bound segment length so a
// padded/infinite audio layer (apad/amix) can never drive an unbounded mux that pins the box.
export async function mediaDuration(p) {
  try {
    const { stdout } = await exec("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", p]);
    return parseFloat(stdout) || 0;
  } catch { return 0; }
}

// Build one normalized segment. DEFAULT: preserve the clip's native audio (wan2.6 SFX/ambient).
// voPath is an OPTIONAL voiceover layer — when present it is MIXED over the native bed (native ducked),
// not replaced. Silence is used only when the clip has no audio and there's no voiceover.
export async function buildSegment(clipPath, voPath, segPath) {
  const native = await hasAudio(clipPath);
  const vdur = await mediaDuration(clipPath);          // hard-bound output to the video length...
  const cap = vdur ? ["-t", vdur.toFixed(2)] : [];     // ...so apad/amix can never run unbounded
  if (voPath && native) {
    await ff(["-i", clipPath, "-i", voPath,
      "-filter_complex", `[0:v]${SCALE}[v];[0:a]volume=0.35[bg];[1:a]apad[vo];[bg][vo]amix=inputs=2:duration=first:normalize=0[a]`,
      "-map", "[v]", "-map", "[a]", ...ENC, ...cap, segPath]);
  } else if (voPath) {
    await ff(["-i", clipPath, "-i", voPath, "-filter_complex", `[0:v]${SCALE}[v];[1:a]apad[a]`, "-map", "[v]", "-map", "[a]", ...ENC, ...cap, segPath]);
  } else if (native) {
    await ff(["-i", clipPath, "-filter_complex", `[0:v]${SCALE}[v]`, "-map", "[v]", "-map", "0:a", ...ENC, ...cap, segPath]);
  } else {
    await ff(["-i", clipPath, "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100", "-filter_complex", `[0:v]${SCALE}[v]`, "-map", "[v]", "-map", "1:a", ...ENC, ...cap, segPath]);
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
  if (await hasAudio(clipPath)) {
    await ff([...seek, "-i", clipPath, "-filter_complex", `[0:v]${SCALE}[v]`, "-map", "[v]", "-map", "0:a", ...ENC, segPath]);
  } else {
    await ff([...seek, "-i", clipPath, "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
      "-filter_complex", `[0:v]${SCALE}[v]`, "-map", "[v]", "-map", "1:a", ...ENC, segPath]);
  }
}

// finalize — cinematic fade-in / fade-out on the assembled film.
export async function finalize(inPath, outPath, { fadeIn = 0.6, fadeOut = 0.8 } = {}) {
  const { stdout } = await exec("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", inPath]);
  const dur = parseFloat(stdout) || 0;
  const outStart = Math.max(0, dur - fadeOut).toFixed(2);
  const vf = `fade=t=in:st=0:d=${fadeIn},fade=t=out:st=${outStart}:d=${fadeOut}`;
  await ff(["-i", inPath, "-vf", vf, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast", "-crf", "23", "-maxrate", "6M", "-bufsize", "12M", "-c:a", "copy", outPath]);
}

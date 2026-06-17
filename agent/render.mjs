// agent/render.mjs — turn one planned scene into a video clip (hybrid: i2v animates an
// approved still; t2v generates directly). Returns the still + clip URLs.
import { approvedStill } from "./visualQA.mjs";
import { video } from "../lib/qwen.mjs";

export async function renderScene(scene, { style = "", onStill, onClip } = {}) {
  const imgPrompt = style ? `${scene.image_prompt}. Overall style: ${style}` : scene.image_prompt;

  // 1) Art-direction + continuity anchor: a QA-approved still for every scene.
  const still = await approvedStill(imgPrompt, { onStep: onStill });

  // 2) Animate (i2v) or generate directly (t2v).
  let clip;
  if (scene.mode === "i2v") {
    clip = await video(scene.motion_prompt || "subtle natural motion, slow cinematic camera move", {
      imageUrl: still.url, resolution: "720P", duration: scene.duration, onTick: onClip,
    });
  } else {
    const t2vPrompt = `${imgPrompt}. ${scene.motion_prompt || ""}`.trim();
    clip = await video(t2vPrompt, { size: "1280*720", shot_type: "multi", onTick: onClip });
  }

  return { id: scene.id, mode: scene.mode, stillUrl: still.url, stillApproved: still.approved, clipUrl: clip.url };
}

// renderShot — same hybrid logic at SHOT granularity, fed by promptgen's crafted prompts.
export async function renderShot(shot, prompts, { style = "", referenceUrl, onStill, onClipStart, onClip } = {}) {
  const imgPrompt = style ? `${prompts.image_prompt}. Overall style: ${style}` : prompts.image_prompt;
  const still = await approvedStill(imgPrompt, { referenceUrl, onStep: onStill });
  if (onClipStart) onClipStart(still.url);
  let clip;
  if (shot.mode === "i2v") {
    clip = await video(prompts.motion_prompt || "subtle natural motion, slow cinematic camera move", {
      imageUrl: still.url, resolution: "720P", duration: shot.duration, onTick: onClip,
    });
  } else {
    clip = await video(`${imgPrompt}. ${prompts.motion_prompt || ""}`.trim(), { size: "1280*720", shot_type: "multi", onTick: onClip });
  }
  return { stillUrl: still.url, stillApproved: still.approved, clipUrl: clip.url, mode: shot.mode };
}

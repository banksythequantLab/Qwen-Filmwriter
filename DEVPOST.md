# Filmwriter — an autonomous AI showrunner on Qwen Cloud

**Track 2: AI Showrunner**
*One logline in. A finished, edited short out.*

---

## Inspiration

Every text-to-video demo stops at the same place: a single clip. But a *film* isn't a clip — it's decisions. What's the story? How many scenes? Where do you hold a long take versus cut a montage? Does the lead look like the same person in shot 7 as in shot 1? Those are a showrunner's decisions, and they're exactly the ones that get hand-waved.

We wanted to find out if a team of cooperating Qwen agents could make all of them — end to end, with no human in the loop after the logline.

## What it does

You give Filmwriter one sentence. It returns a finished, edited, narrated short film — and it makes every creative decision along the way:

- **Plans** the story into scenes with a title, style bible, and characters.
- **Directs** each scene, choosing its own editing strategy per scene: a **montage** of distinct beats, or a **long take** intercut with cutaways.
- **Writes** the image and motion prompts for every shot.
- **Self-corrects its own visuals** — a vision agent reviews each generated still against its prompt and regenerates, with escalating corrections, until it passes.
- **Keeps the cast consistent** — one character reference is generated once, then every shot is rendered from it so the lead holds their identity across the whole film.
- **Edits** long takes by writing an EDL (edit decision list) and intercutting cutaways.
- **Voices** the narration, stitches everything with ffmpeg, and tops-and-tails the cut with a cinematic fade.
## How we built it

Filmwriter is a pipeline of cooperating agents, each a focused Qwen Cloud call, orchestrated by a conductor (`showrun`):

```
logline
  └─ Planner (qwen-max) ─────────── title, style, characters, scene beats
       └─ for each scene:
            Director (qwen-plus) ─── picks strategy {montage | longtake} + shot list
            Prompt-engineer (qwen-plus) ─ image + motion prompt per shot
            Render:
              • still  → qwen-image-plus / qwen-image-edit-max (character reference)
              • Visual-QA (qwen3-vl-plus) → approve or regenerate, escalating
              • animate → wan2.6-i2v (multi-shot) / wan2.6-t2v
              • Editor (qwen-max) → EDL for long takes
              • voice → qwen3-tts-flash
       └─ ffmpeg stitch + cinematic fade → final.mp4
```

**Models used (all on Qwen Cloud / DashScope, Singapore region):**

| Role | Model |
| --- | --- |
| Planner / Editor | `qwen-max` |
| Director / Prompt-engineer | `qwen-plus` |
| Visual QA (vision) | `qwen3-vl-plus` |
| Stills | `qwen-image-plus` |
| Character consistency | `qwen-image-edit-max` |
| Video (i2v / t2v) | `wan2.6-i2v-flash` / `wan2.6-t2v` |
| Narration | `qwen3-tts-flash` |

The whole client is dependency-free `fetch` against the DashScope REST API. The agent layer is plain ES modules. Rendering runs as an async HTTP job server, containerized with Docker, and deploys to an Alibaba Cloud ECS instance.

## The two decisions we're proudest of

**1. Per-scene editing strategy.** The director doesn't just list shots — it classifies each scene. A continuous performance becomes a held **long take** with reaction cutaways, assembled from a model-written EDL. A sequence of distinct beats becomes a **montage**. The conductor renders each scene the right way and concatenates. On one run the director chose long-take / montage / long-take across three scenes with no prompting from us.

**2. Character continuity.** Independent text-to-image makes the lead a different person every shot. We generate one approved character reference, then render every shot — including long-take spines — from it via `qwen-image-edit-max`'s subject-consistency mode. We verified it: Qwen-VL, shown the reference and an edited shot side by side, judged them the **same** individual ("same face, eyes, chrome design").

## Challenges we ran into

- **Continuity is a model capability, not a prompt trick.** We only solved it once we found `qwen-image-edit-max`'s documented subject-consistency mode and wired a single reference image through the entire pipeline.
- **The vision QA loop could waste budget.** Early on a tricky close-up burned four generations. We added progressive, defect-targeted escalation (hardening the negative prompt only when a specific defect repeats) and loosened prompt-matching to allow stylistic interpretation — the same still now converges in two generations.
- **Garbled neon signage.** Cyberpunk close-ups love to render fake text. The QA agent catches misspelled foreground text and the escalation strips background signage, so the failure mode self-heals.

## Accomplishments we're proud of

A logline really does become a finished, edited, narrated short with a consistent lead — autonomously, on Qwen Cloud, with the model making every directorial call. The visual QA agent measurably improves output by catching and fixing its own mistakes.

## What we learned

The interesting frontier in AI video isn't a better single clip — it's **orchestration and judgment**: deciding how to shoot a scene, checking your own work, and holding a character together across a whole film. Qwen's spread of models (reasoning, vision, image-edit, multi-shot video, TTS) is wide enough to let one agent system own all of it.

## What's next

- Wan reference-to-video to anchor long-take spines even more tightly.
- Music and sound-design agents.
- A web front-end over the existing job server.

## Built with

Qwen Cloud (DashScope) · qwen-max · qwen-plus · qwen3-vl-plus · qwen-image-plus · qwen-image-edit-max · wan2.6 (i2v/t2v) · qwen3-tts-flash · Node.js · ffmpeg · Docker · Alibaba Cloud ECS

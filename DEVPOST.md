# Filmwriter — an autonomous AI showrunner on Qwen Cloud

**Track 2: AI Showrunner**
*One logline in. A finished, edited short out.*

---

## Inspiration

Every text-to-video demo stops at the same place: a single clip. But a *film* isn't a clip — it's decisions. What's the story? How many scenes? Where do you hold a long take versus cut a montage? Does the lead look like the same person in shot 7 as in shot 1? Those are a showrunner's decisions, and they're exactly the ones that get hand-waved.

We wanted to find out if a team of cooperating Qwen agents could make all of them — end to end, with no human in the loop after the logline.

## What it does

You give Filmwriter one sentence. It returns a finished, edited, narrated short film — and it makes every creative decision along the way:

- **Plans** the story into scenes with a title, style bible, and characters — then a story editor reviews its own beat sheet and flags weak beats before a single pixel is rendered.
- **Locks a canon.** A state agent commits a head-to-toe wardrobe lock per character (down to footwear and hair color) plus world rules — the single source of truth every shot is checked against.
- **Directs** each scene, choosing its own editing strategy: a **montage** of distinct beats, or a **long take** intercut with cutaways.
- **Self-corrects at every stage** — five distinct inspector agents (prompt-match, physical coherence, story-need, continuity-bible, legal/IP) gate every still; a script supervisor grades every *cut* for continuity breaks; a motion-QA agent compares each animated clip against its source still and orders a re-take that must itself pass review before it replaces the original.
- **Grades itself and re-shoots.** A weighted rubric (continuity / identity / beats / through-line / craft) is computed from the pipeline's own QA signals — grounded, not vibes — and if the KPI misses threshold, the conductor identifies the single weakest frame and re-shoots it.
- **Voices** the narration, stitches with ffmpeg, and tops-and-tails the cut with a cinematic fade.

## How we built it

Filmwriter is a pipeline of cooperating agents, each a focused Qwen Cloud call, orchestrated by a conductor (`showrun`):

```
logline
  └─ Planner (qwen-max) ──────────── title, style, characters, scene beats
       ├─ Story editor ───────────── reviews its own beat sheet, flags weak beats
       ├─ State agent ────────────── LOCKED CANON: head-to-toe wardrobe, world rules
       └─ for each scene:
            Director (qwen-plus) ─── strategy {montage | longtake} + shot list
            Prompt-engineer ──────── image + motion prompt per shot (canon inlined)
            Render:
              • character anchor → qwen-image-plus, then REFINED via qwen-image-edit
                until it passes a canon audit (t2i alone failed 3-of-3 in our tests;
                edit-refinement converged 4→1→0 violations in ~110s)
              • still → qwen-image-edit-max from [anchor + location plate] refs
              • 5 inspectors (qwen3-vl-plus) → approve / regenerate with escalation
              • script supervisor → grades every CUT, re-rolls broken frames
              • animate → wan2.6-i2v / wan2.2-kf2v keyframe spine takes
              • motion QA → compares clip vs source still; VERIFIED re-takes only
              • voice → qwen3-tts-flash
       └─ self-grade (rubric from QA signals) → targeted re-shoot → ffmpeg stitch
```

**Models used (all on Qwen Cloud / DashScope, Singapore region):**

| Role | Model |
| --- | --- |
| Planner / Editor | `qwen-max` |
| Director / Prompt-engineer | `qwen-plus` |
| All 7 vision inspectors | `qwen3-vl-plus` |
| Stills | `qwen-image-plus` |
| Character anchor + consistency | `qwen-image-edit-max` |
| Video (i2v / keyframe / t2v) | `wan2.6-i2v-flash` / `wan2.2-kf2v-flash` / `wan2.6-t2v` |
| Narration | `qwen3-tts-flash` |

The whole client is dependency-free `fetch` against the DashScope REST API. The agent layer is plain ES modules. Rendering runs as an async HTTP job server, containerized with Docker, deployed on an Alibaba Cloud ECS instance.

## The engineering story we're proudest of: measured self-correction

We ran the **same logline six times** while hardening the pipeline, one commit per run, and let the system's own graders keep score. Continuity breaks *generated* fell **9 → 9 → 7 → 5 → 5** as fixes landed — not because repair got better, but because drift stopped being created: the character anchor is now edit-refined until it passes a canon audit, and the locked canon is inlined into every first-attempt prompt instead of only re-rolls. Fewer breaks also meant ~12% faster, cheaper runs.

Then our own metric caught us. Identity scored a flat 40 for four straight runs while the drift complaints visibly improved from "a different person" to "vertical light strips vs circular eye lights" — the formula was saturated, and worse, it was hijacking a paid re-shoot every run on an axis that couldn't move. So the identity reviewer now classifies each drift **major** (reads as a different character) vs **minor** (same character, one detail off), and the rubric weights them 18/5. The pipeline doesn't just correct its films — it corrected its own judge.

## Challenges we ran into

- **Continuity is a model capability, not a prompt trick.** Solved in layers: `qwen-image-edit-max` subject-consistency from a canon-audited anchor, location plates locked per setting, the wardrobe lock inlined into every prompt, and a script supervisor that grades cuts and re-rolls breaks (9/9 fixed on our best run).
- **A dense head-to-toe character spec doesn't land in one generation.** Text-to-image failed our canon audit 3-of-3 in every test. The fix: *refine, don't re-roll* — take the best attempt and correct only the named violations via image-edit. Converges in 1–3 rounds.
- **Video generation mutates what image generation fixed.** Motion QA pulls a late frame from every clip and compares it to the approved still; flagged takes get one steadier re-animation that must itself pass review before it replaces the original — on our best run 3 of 5 flagged takes were recovered with verified re-takes.
- **Garbled neon signage.** Cyberpunk close-ups love fake text. The QA agent catches misspelled foreground text and escalation strips background signage — the failure mode self-heals.

## Accomplishments we're proud of

A logline really does become a finished, edited, narrated short with a consistent lead — autonomously, on Qwen Cloud, with the model making every directorial call, inspecting its own frames, grading its own cut, and re-shooting its own weakest moments. Best measured run: final continuity 94/100, craft 94/100, by its own grounded rubric.

## What we learned

The interesting frontier in AI video isn't a better single clip — it's **orchestration and judgment**: deciding how to shoot a scene, checking your own work at every stage, holding a character together across a whole film, and being honest enough to recalibrate your own scoring when it saturates. Qwen's spread of models (reasoning, vision, image-edit, keyframe video, TTS) is wide enough to let one agent system own all of it.

## What's next

- **Wan reference-to-video** (`wan2.6-r2v`) to preserve character identity *during* video generation — experiment flag in progress.
- Crowd-aware shot planning (multi-figure backgrounds are where video models still break).
- Music and sound-design agents.
- A web front-end over the existing job server.

## Built with

Qwen Cloud (DashScope) · qwen-max · qwen-plus · qwen3-vl-plus · qwen-image-plus · qwen-image-edit-max · wan2.6 (i2v/t2v) · wan2.2-kf2v · qwen3-tts-flash · Node.js · ffmpeg · Docker · Alibaba Cloud ECS

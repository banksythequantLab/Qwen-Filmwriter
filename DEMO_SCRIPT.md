# Filmwriter — 3-Minute Demo Video Script

**Target length:** 2:45–3:00. **Format:** screen recording + voiceover (record VO with your own voice or qwen3-tts).
**Assets you already have:** `output/longtake_demo/final.mp4`, `output/continuity_film/final.mp4`, `output/film/final.mp4`, `output/continuity/ref.png` + `scene1/2.png`, `character_ref.png`, and the terminal logs from a live `showrun`.

> Golden rule for judges: show the AGENTS DECIDING, not just a pretty clip. The story is autonomy + judgment + continuity.

---

## 0:00–0:20 — Cold open (the promise)

**On screen:** Black. Type one line into a terminal:
`node --env-file=.env demo.mjs "A lonely android busker in a neon megacity discovers it can dream."`
Then cut to ~4 seconds of a finished film playing (`output/continuity_film/final.mp4`), fading in.

**VO:**
> "This is the only thing I gave it — one sentence. No shot list, no images, no edits. A few minutes later, this came out. Let me show you what happened in between."

## 0:20–0:45 — The thesis

**On screen:** Title card: **Filmwriter — an autonomous AI showrunner on Qwen Cloud.** Then the architecture diagram (`ARCHITECTURE.md` Mermaid, or a clean slide).

**VO:**
> "Every text-to-video demo stops at a single clip. But a film isn't a clip — it's decisions. How many scenes? Where do you hold a long take versus cut a montage? Does the lead look like the same person in shot seven as in shot one? Filmwriter makes all of those decisions — with a team of Qwen agents, and no human in the loop."

## 0:45–1:30 — Watch the agents think (the core)

**On screen:** The live `showrun` terminal log scrolling. Highlight these lines as the VO hits them:
- `title: Dreams of Neon | 3 scenes | style: Cyberpunk...`
- `scene 1 [longtake] -> 3 shot(s)` / `scene 2 [montage] -> 2 shot(s)` / `scene 3 [longtake]`
- `reference: Echo ...`
- `still 1: pass=false` → `still 2: pass=true`

**VO:**
> "First a planner breaks the logline into scenes, a style, and characters. Then for every scene, a director makes a real directorial call — montage, or long take. Here it chose long take for the performance, montage for the in-between beats, on its own.
> A prompt agent writes each shot. Then a vision agent reviews every generated frame against its prompt — and when something's wrong, it regenerates. That's the model catching its own mistakes."

## 1:30–2:10 — Continuity (the money shot)

**On screen:** Split screen. Left: `output/continuity/ref.png` (the character reference). Right: `scene1.png` then `scene2.png` — same android, different scenes. Then overlay the Qwen-VL verdict text: **"SAME — same face, eyes, chrome design."**

**VO:**
> "Here's the hardest part of making a film with AI: keeping your cast. Generate each shot from scratch and your lead is a different person every time. So Filmwriter generates one character reference, then renders every shot from it using Qwen's image-edit model. We checked it with Qwen's own vision model — same character, new scene. That consistency runs through the whole film, including the long takes."

## 2:10–2:40 — The output (payoff)

**On screen:** Play `output/longtake_demo/final.mp4` full-frame (the long-take cut with narration), then a quick beat of `output/continuity_film/final.mp4`. Show the file in a player with audio on.

**VO:**
> "The long take gets cut against its own footage with an edit list the model writes. Narration is generated and mixed. ffmpeg stitches it, adds a fade — and that's a finished short. Every frame, every cut, every line of narration: decided and produced by Qwen agents."

## 2:40–3:00 — Close (what it is)

**On screen:** Slide: the model table from the README (qwen-max, qwen-plus, qwen3-vl-plus, qwen-image-plus, qwen-image-edit-max, wan2.6, qwen3-tts-flash). End card: **Filmwriter · One logline in. A finished short out.** + GitHub URL.

**VO:**
> "Seven Qwen models, one autonomous showrunner, running on Alibaba Cloud. The frontier in AI video isn't a better clip — it's judgment. Filmwriter. One logline in, a finished short out."

---

## Recording checklist
- [ ] Re-run one clean `showrun` and screen-record the terminal (best decision logs: a 3-scene run that picks mixed strategies).
- [ ] Have the three `final.mp4`s open and ready to scrub.
- [ ] Export the architecture diagram as an image for the title section.
- [ ] Keep total runtime under 3:00 (Devpost hard limit is typically 3 min).
- [ ] Upload to YouTube/Vimeo **unlisted or public** (not private) and paste the link into Devpost.

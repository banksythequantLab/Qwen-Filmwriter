# Filmwriter — 3-Minute Demo Video Script (v2, Jul 2)

**Target length:** 2:45–3:00. **Format:** screen recording + voiceover.
**VO:** pre-generated in Derek's cloned voice — segments in `demo_assets/vo_s1.wav … vo_s6.wav` (FreeClone/VoxCPM2). Re-record live if preferred; the text is below.
**Hero assets:** `output/episodes/warlords-sniper/final.mp4` (Silent Sights, KPI 91), `output/episodes/warlords-sniper-ep2/final.mp4` (Lena returns — season vault), `output/episodes/forgotten-god/final.mp4`, live `/` app page + `/manage`, terminal log of a run.

> Golden rule for judges: show the AGENTS DECIDING and CORRECTING THEMSELVES, not just a pretty clip. The story is autonomy + judgment + a cast that comes back.

---

## S1 · 0:00–0:20 — Cold open

**On screen:** Black. One line typed into the app's logline box (or terminal). Cut to ~6s of *Silent Sights* playing.

**VO (vo_s1.wav):**
> "I gave it one sentence — a sniper, a warlord, a prince. No shot list, no images, no edits. Twenty-four minutes later it handed me this — and graded its own work at ninety-one."

## S2 · 0:20–0:45 — Thesis

**On screen:** Title card: **Filmwriter — an autonomous AI showrunner on Qwen Cloud.** Architecture diagram.

**VO (vo_s2.wav):**
> "Every text-to-video demo stops at a single clip. A film is decisions. How many scenes. Long take or montage. Does your lead still look like your lead in shot seven. Filmwriter makes every one of those calls with a crew of Qwen agents — and no human in the loop."

## S3 · 0:45–1:35 — The crew corrects itself (the core)

**On screen:** The live crew panel on `/` while a job runs — then terminal highlights in order: `ref … pass=false` → `refine 1: canon PASS`; `continuity: break … re-rolled to match`; `clip-qa: FLAG` → `re-animated steadier, verified, flag cleared`; `vo: take runs 3.6s over a 3.0s scene — shortening, re-taking`.

**VO (vo_s3.wav):**
> "Watch the crew. When the character sheet misses its locked wardrobe, an editor doesn't reroll the dice — it corrects the exact violations and audits again. A script supervisor grades every cut and reshoots breaks. Motion QA compares each animated take to its approved frame — bad takes get re-shot and must pass review to make the film. Even the narrator gets a table read: lines that would be cut off mid-sentence get shortened and re-taken. We ran the same logline seven times while hardening this: continuity breaks fell from nine to three."

## S4 · 1:35–2:15 — The cast comes back (the differentiator)

**On screen:** Split: Lena's anchor PNG from the season vault | Lena in Episode 1 | Lena in Episode 2. Caption: **same actor, new story — zero re-casting.**

**VO (vo_s4.wav):**
> "Here's what makes it a showrunner and not a film generator: it runs a show. A finished film banks its cast — the audited character sheet, the locked wardrobe — into a season vault. Ask for another episode and the same actors walk back on set. This is Lena, episode one. This is Lena, episode two — same face, same coat, different war."

## S5 · 2:15–2:40 — Sound + self-grading

**On screen:** `/manage` grid with KPI badges; hover a badge to show the dimension tooltip (identity major/minor split). Then the evaluation log line.

**VO (vo_s5.wav):**
> "Every take of narration is transcribed back with Qwen's speech recognition and must actually say the script. And every finished film grades itself — continuity, identity, beats, through-line, craft — from the QA signals the crew produced, not vibes. When our own metric saturated, the system's judge got recalibrated too."

## S6 · 2:40–3:00 — Close

**On screen:** Model table slide (qwen-max · qwen-plus · qwen3-vl-plus · qwen-image-plus · qwen-image-edit-max · wan2.6 i2v/kf2v/r2v · qwen3-tts-flash · qwen3-asr-flash). End card: **Filmwriter · One logline in. A season out.** + GitHub URL + filmwriter.tlz.us.

**VO (vo_s6.wav):**
> "Nine Qwen models. One autonomous studio, self-correcting at every department, running on Alibaba Cloud. Filmwriter. One logline in — a season out."

---

## Recording checklist
- [ ] Screen-record a live 3-scene run on `/` (crew panel visible) — the ep2 runs produce ideal logs.
- [ ] Screenshot Lena's vault anchor (`output/seasons/warlords-sniper/cast_0.png`) + a matching frame from each episode.
- [ ] `/manage` hover for the KPI tooltip shot.
- [ ] Use the pre-cut VO in `demo_assets/` or re-record; keep under 3:00.
- [ ] Upload YouTube/Vimeo unlisted-or-public; paste link into Devpost.
- [ ] Separate video: deployment proof (ECS console, `systemctl status filmwriter`, external curl of filmwriter.tlz.us) per DEPLOY.md §6.

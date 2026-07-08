**[▶ Live demo](https://filmwriter.tlz.us) · [💻 Code](https://github.com/banksythequantLab/Qwen-Filmwriter) · [🎬 Video](https://youtu.be/lLd9ybvhK_Q)**

## Inspiration

Every text-to-video demo stops at a single clip. But a film isn't a clip — it's thousands of decisions: how many scenes, long take or montage, does your lead still look like your lead in shot seven. We wanted to find out whether a crew of AI agents could make **all** of those calls, catch their own mistakes, and deliver not just a shot but a *directed film* — and then a whole season.

## What it does

You give **Film Writer** one sentence. A crew of **eight Qwen-powered agents** writes it, storyboards it, shoots it, scores it, checks its own frames, and cuts the final film — with **no human in the loop**.

When a shot breaks continuity, drifts on motion, or trips a legal/clearance check, the crew re-shoots it until it clears quality control, and every finished film **grades itself** on continuity, identity, beats, through-line, and craft. Finished films bank their cast in a **"season vault,"** so the same characters walk back on set for the next episode — one-off clips become an ongoing series.

## How we built it

Film Writer runs on **nine models on Qwen Cloud / Alibaba Cloud** (DashScope):

| Stage | Qwen Cloud model(s) |
| --- | --- |
| Planning & screenwriting | `qwen-max` · `qwen-plus` |
| Visual + legal/clearance QA | `qwen3-vl` |
| Stills & reference locking | `qwen-image` · `qwen-image-edit` |
| Image-to-video | `wan2.6` · `wan2.2-kf2v` |
| Narration | `qwen3-tts` |
| Read-back verification | `qwen3-asr` |

A conductor orchestrates a crew of eight agents — **Showrunner, Screenwriter, Story Editor, Storyboard, Continuity, Legal & Clearances, Cinematographer, and Editor.** Each department inspects its own output, flags the *exact* violation, and re-rolls or re-shoots until it passes review; streaming animation overlaps QA with rendering to keep it moving. A season vault banks the audited character sheet and locked wardrobe so episodes reuse the same cast. It all runs on a **Node.js** backend on **Alibaba Cloud ECS**, served over a **Cloudflare** tunnel with a live web app.

## Challenges we ran into

- **Continuity is the hard problem.** Reference anchoring hit diminishing returns fast; the streaming re-roll turned out to be the real workhorse. Over seven runs of the same logline, continuity breaks fell from **9 → 3**.
- **Quality vs. cost.** Every correction is another model call, so more iteration means a better film — but a bigger bill. Balancing them is the real engineering problem.
- **Iteration isn't a straight line.** Not every loop improved things; some performed worse.
- **Legibility and IP.** Keeping on-screen text spelled right and avoiding trademarked characters or logos required a dedicated **Legal & Clearances** agent screening every frame.

## Accomplishments that we're proud of

- A genuinely autonomous pipeline: **one sentence → a finished, self-graded film** — and a series.
- A self-correcting crew that catches and fixes its own mistakes and knows its own score.
- **Honest engineering** — we can point to exactly where it still slips and why, instead of cherry-picking a lucky render.

## What we learned

- Single figure + fixed wardrobe + few scenes is the best case; flowing wardrobe + many cuts is the worst.
- Self-correction beats brute-force reference anchoring.
- The economics — cost per model call — are as much the problem as the quality.

## What's next for Film Writer - 1 Sentence In - a Full Film out on Qwen Cloud

- [ ] Close the gap on the hardest continuity shots
- [ ] Richer episodic seasons and living, animated agent cards
- [ ] Drive down cost-per-film so more iteration is always affordable

**Built with:** Qwen · Wan · Qwen Cloud · DashScope · Alibaba Cloud · Node.js · Cloudflare · Python · FFmpeg · VoxCPM · Claude (Anthropic)

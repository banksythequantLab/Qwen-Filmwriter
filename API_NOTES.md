# API_NOTES.md — Qwen Cloud, verified source of truth

_All facts below tested live against this account on 2026-06-16. Don't re-fetch; update here if reality changes._

## Auth & transports
- Key in `.env` as `QWEN_API_KEY` (from home.qwencloud.com/api-keys). Run scripts with `node --env-file=.env <file>`.
- **COMPAT** (OpenAI-compatible): `https://dashscope-intl.aliyuncs.com/compatible-mode/v1` — chat, vision.
- **NATIVE** (DashScope): `https://dashscope-intl.aliyuncs.com/api/v1` — image, video, tts.
- Region = Singapore/intl. 145 models on this key.

## Locked models (per Showrunner slot)
| Capability | Model | Notes |
|---|---|---|
| Agent brain / script | `qwen-max` (hard), `qwen-plus` (default), `qwen-flash` (cheap) | aliases = latest qwen3.x |
| Continuity / vision | `qwen3-vl-plus` | also `qwen3-vl-235b-a22b-thinking` for deep checks |
| Stills | `qwen-image-plus` (async, 5 sizes), `qwen-image-2.0` (sync, custom size, best) | Wan t2i needs >=1280x1280 total px |
| Video | `wan2.6-t2v` / `wan2.7-t2v`, i2v `wan2.6-i2v` | multi-shot + audio sync (wan2.5+) |
| Voice | `qwen3-tts-flash` (preset voices), `qwen3-tts-vc` (clone) | CosyVoice also avail (WebSocket) |

## Call shapes (all in lib/qwen.mjs)
- **chat / vision** — `POST COMPAT/chat/completions`, standard OpenAI body. Vision = user content array of `{type:image_url,image_url:{url}}` + `{type:text}`.
- **image** — `POST NATIVE/services/aigc/text2image/image-synthesis` (+`X-DashScope-Async: enable`) -> `output.task_id` -> poll. Body `{model,input:{prompt,negative_prompt},parameters:{size,prompt_extend,n}}`. Result: `output.results[0].url`.
- **video** — `POST NATIVE/services/aigc/video-generation/video-synthesis` (+async) -> poll. Body `{model,input:{prompt[,img_url][,audio_url]},parameters:{size,duration,shot_type,prompt_extend,watermark}}`. Result: `output.video_url`.
  - wan2.7 uses `resolution`(720P/1080P)+`ratio`(16:9...) instead of `size`; describe shots in prompt (no shot_type).
  - wan2.6: `size="1280*720"`, `shot_type:"multi"` for multi-shot.
  - audio: pass `audio_url` for lip-sync, or omit for auto-dub (wan2.5+).
- **tts** — `POST NATIVE/services/aigc/multimodal-generation/generation`. Body `{model,input:{text,voice,language_type}}`. Result: `output.audio.url`. (No async header needed.)
- **poll** — `GET NATIVE/tasks/{task_id}` -> `output.task_status` in PENDING|RUNNING|SUCCEEDED|FAILED.

## Billing / gotchas
- **Failed calls are free** and don't consume quota (image + video). Safe to iterate.
- **All result URLs expire in 24h** -> download immediately (lib `download()`).
- Video billed per output second; image per image; iterate prompts on the LLM (cheap) before spending pixels.
- Image size is **model-specific** — qwen-image-plus only: 1664*928, 928*1664, 1328*1328, 1472*1104, 1104*1472.
- Poll politely: ~3-5s early, back off, to avoid 429.

## Verified live
chat OK | image OK (6s) | video t2v OK (39s) | tts OK | vision built (untested)

## Image edit / subject consistency — qwen-image-edit-max (VERIFIED LIVE)
- Endpoint: POST {NATIVE}/services/aigc/multimodal-generation/generation  (SYNCHRONOUS — no X-DashScope-Async header; same endpoint as TTS).
- Body: { "model":"qwen-image-edit-max",
          "input":{ "messages":[{ "role":"user", "content":[ {"image": URL_or_dataURI}, ... , {"text": INSTRUCTION} ] }] },
          "parameters":{ "n":1, "negative_prompt":" ", "prompt_extend":true, "watermark":false, "size":"1664*928" } }
- Inputs: 1-3 images. Outputs: 1-6 (n). Result path: output.choices[0].message.content[] -> first {image}. URLs expire 24h (download now).
- size "W*H", each dim 512-2048; default ~1024, aspect near the (last) input image.
- SUBJECT CONSISTENCY: one character reference image in -> same identity (face/colors/design) rendered into new scenes/poses/backgrounds. Verified: Qwen-VL judged an edited shot "SAME" character vs the reference.
- Billing: only successfully generated images are charged; failed calls are free.
- Pipeline use: lib/qwen.mjs `imageEdit(images, instruction, opts)`. showrun generates ONE `character_ref` (approvedStill, maxRetries 1) then every shot still is `approvedStill(prompt, { referenceUrl })`, which calls imageEdit to keep the lead consistent across shots. Longtake spine is t2v so NOT reference-anchored yet (future: Wan reference-to-video).

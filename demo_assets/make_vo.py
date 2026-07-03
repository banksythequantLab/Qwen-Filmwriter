# make_vo.py - generate the 6 demo-script VO segments in Derek's cloned voice (FreeClone/VoxCPM2).
# FreeClone free tier caps 500 chars/request: long segments are split at sentence boundaries,
# synthesized per-chunk, and concatenated (same sample rate) with the wave module.
import requests, os, sys, wave, io, re

REF = r"B:\freeclone-backend\derek-voice.wav"
OUT = os.path.dirname(os.path.abspath(__file__))
LIMIT = 480
SEGS = {
    "vo_s1": "I gave it one sentence - a sniper, a warlord, a prince. No shot list, no images, no edits. Twenty-four minutes later it handed me this - and graded its own work at ninety-one.",
    "vo_s2": "Every text-to-video demo stops at a single clip. A film is decisions. How many scenes. Long take or montage. Does your lead still look like your lead in shot seven. Filmwriter makes every one of those calls with a crew of Qwen agents - and no human in the loop.",
    "vo_s3": "Watch the crew. When the character sheet misses its locked wardrobe, an editor doesn't reroll the dice - it corrects the exact violations and audits again. A script supervisor grades every cut and reshoots breaks. Motion QA compares each animated take to its approved frame - bad takes get re-shot and must pass review to make the film. Even the narrator gets a table read: lines that would be cut off mid-sentence get shortened and re-taken. We ran the same logline seven times while hardening this: continuity breaks fell from nine to three.",
    "vo_s4": "Here's what makes it a showrunner and not a film generator: it runs a show. A finished film banks its cast - the audited character sheet, the locked wardrobe - into a season vault. Ask for another episode and the same actors walk back on set. This is Lena, episode one. This is Lena, episode two - same face, same coat, different war.",
    "vo_s5": "Every take of narration is transcribed back with Qwen's speech recognition and must actually say the script. And every finished film grades itself - continuity, identity, beats, through-line, craft - from the QA signals the crew produced, not vibes. When our own metric saturated, the system's judge got recalibrated too.",
    "vo_s6": "Nine Qwen models. One autonomous studio, self-correcting at every department, running on Alibaba Cloud. Filmwriter. One logline in - a season out.",
}

def chunks(text):
    if len(text) <= LIMIT: return [text]
    sents = re.split(r"(?<=[.!?:]) +", text)
    out, cur = [], ""
    for s in sents:
        if cur and len(cur) + len(s) + 1 > LIMIT: out.append(cur); cur = s
        else: cur = (cur + " " + s).strip()
    if cur: out.append(cur)
    return out

def synth(text):
    with open(REF, "rb") as f:
        r = requests.post("http://127.0.0.1:8300/api/clone",
                          files={"prompt_audio": ("ref.wav", f, "audio/wav")},
                          data={"text": text, "lang": "en"}, timeout=900)
    if r.status_code != 200 or len(r.content) < 2000:
        raise RuntimeError(f"{r.status_code}: {r.text[:200]}")
    return r.content

for name, text in SEGS.items():
    out = os.path.join(OUT, name + ".wav")
    if os.path.exists(out) and os.path.getsize(out) > 2000:
        print(f"[{name}] exists, skipping", flush=True); continue
    parts = chunks(text)
    print(f"[{name}] synthesizing ({len(text)} chars, {len(parts)} chunk(s))...", flush=True)
    try:
        wavs = [synth(p) for p in parts]
    except Exception as e:
        print(f"[{name}] FAILED {e}", flush=True); sys.exit(1)
    if len(wavs) == 1:
        open(out, "wb").write(wavs[0])
    else:
        w0 = wave.open(io.BytesIO(wavs[0]), "rb")
        params = w0.getparams()
        with wave.open(out, "wb") as wf:
            wf.setparams(params)
            for wb in wavs:
                wr = wave.open(io.BytesIO(wb), "rb")
                wf.writeframes(wr.readframes(wr.getnframes()))
                # ~250ms pause between chunks
                wf.writeframes(b"\x00" * int(params.framerate * 0.25) * params.sampwidth * params.nchannels)
    print(f"[{name}] OK -> {out} ({os.path.getsize(out)} bytes)", flush=True)
print("ALL SEGMENTS DONE", flush=True)

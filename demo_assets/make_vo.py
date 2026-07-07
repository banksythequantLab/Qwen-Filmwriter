# make_vo.py - generate the 6 demo-script VO segments in Derek's cloned voice (FreeClone/VoxCPM2).
# FreeClone free tier caps 500 chars/request: long segments are split at sentence boundaries,
# synthesized per-chunk, and concatenated (same sample rate) with the wave module.
import requests, os, sys, wave, io, re

REF = r"B:\freeclone-backend\derek-voice.wav"
OUT = os.path.dirname(os.path.abspath(__file__))
LIMIT = 480
SEGS = {
    "vo_s1": "I gave Film Writer one sentence: an AI built to fix a city becomes the only thing that can save it. No shot list. No images. No edits. Twenty-four minutes later it handed me a two-minute film.",
    "vo_s2": "Normally every text-to-video demo stops at a single clip. In the real world, a film is thousands of human decisions. How many scenes. Long take or montage. Does your lead still look like your lead in shot seven? Film Writer makes every one of those calls with a crew of Chwen agents - and no human in the loop.",
    "vo_s3": "Watch the crew of eight agents. When the character sheet misses its locked wardrobe, an editor doesn't just try again. The editor corrects the exact violations and re-audits. A script supervisor grades every cut and reshoots breaks. Motion QA compares each animated take to its approved frame - bad takes get re-shot and must pass review to make the film. Even narration is checked. Lines that would run long get trimmed and are re-recorded. A legal and clearances agent screens every frame for trademarked characters, logos, and brand marks. Then it checks that any on-screen text is spelled right and legible. Flagged shots get re-shot until they clear the agents Quality Control. Every one of those corrections is another model call, so each pass of iteration makes the showrunner better. But, it also runs up the bill. Balancing quality against the cost of all those extra shots is the real engineering problem. We ran the same logline seven times while improving the agents. As an example continuity breaks fell from nine to three. So the agents were allowing less errors through. It's honestly not fully baked yet - the hardest shots still slip - but that's the whole thesis: every added pass with the agents makes it better. The system grades its own progress each time. When repeated errors emerge it normally involves tweaking the agents to catch that newly identified problem.",
    "vo_s4": "Here's what makes it a showrunner and not a clip generator. It runs the show. And at the end a finished film banks its cast so it can be used again in another production. The audited character sheet, the locked wardrobe. This moves us from one-off clips to episodes. Ask for another episode and the same actors walk back on set. This is Lena, episode one. This is Lena, episode two - same face, same coat, different war.",
    "vo_s5": "Every take of narration is transcribed back with Chwen's speech recognition. The voice over must actually match the script. And every finished film grades itself on continuity, identity, beats, through-line, and craft from the crew of agents actual QA signals, not guesswork. When our own scoring maxed out, we made the system's judge tougher. Not every loop saw incremental progress. Some loops performed worse. However, with further refinement AI will eventually be ready for prime time.",
    "vo_s6": "Nine models on Chwen Cloud. One autonomous studio, self-correcting at every department, running on Alibaba Cloud. Film Writer. One line in and a full show out.",
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
        r = requests.post(os.environ.get("FREECLONE_URL", "http://192.168.68.60:8300") + "/api/clone",
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

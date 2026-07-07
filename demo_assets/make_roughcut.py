# make_roughcut.py - assemble the 3-min demo ROUGH CUT: cloned-VO segments timed against
# films, slates (where Derek's screen recordings go), and the Lena vault triptych.
# Output: demo_assets/rough_cut.mp4 (1280x720/30fps h264+aac). Everything re-encoded uniform.
import subprocess, os, sys

A = os.path.dirname(os.path.abspath(__file__))
R = os.path.dirname(A)
FF = "ffmpeg"; FP = "ffprobe"
FONT = "C\\:/Windows/Fonts/arialbd.ttf"
EP1 = os.path.join(R, "output/episodes/warlords-sniper/final.mp4")
EP2 = os.path.join(R, "output/episodes/warlords-sniper-ep2/final.mp4")
GOD = os.path.join(R, "output/episodes/forgotten-god/final.mp4")
ANCHOR = os.path.join(R, "output/seasons/warlords-sniper/cast_0.png")
ENC = ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", "30", "-preset", "veryfast", "-crf", "21",
       "-c:a", "aac", "-ar", "44100", "-ac", "2", "-shortest", "-y"]

def run(args):
    p = subprocess.run(args, capture_output=True, text=True)
    if p.returncode != 0: print(p.stderr[-800:]); sys.exit(1)

def dur(p):
    o = subprocess.run([FP, "-v", "error", "-show_entries", "format=duration", "-of",
                        "default=noprint_wrappers=1:nokey=1", p], capture_output=True, text=True)
    return float(o.stdout.strip() or 0)

def slate(lines, d, out):
    txt = "".join(f"drawtext=fontfile='{FONT}':text='{t}':fontcolor=0xdfe6f3:fontsize={s}:x=(w-tw)/2:y={y}," 
                  for t, s, y in lines)[:-1]
    run([FF, "-f", "lavfi", "-i", f"color=c=0x0b0e14:s=1280x720:d={d}", "-vf", txt, "-t", str(d)] + ENC[:10] + ["-y", out])

def seg(visual_args, vo, out, d):
    run([FF] + visual_args + ["-i", vo, "-map", "0:v", "-map", "1:a",
         "-vf", "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,fps=30",
         "-t", str(d)] + ENC + [out])

os.chdir(A)
vd = {i: dur(f"vo_s{i}.wav") for i in range(1, 7)}
print("VO durations:", {k: round(v, 1) for k, v in vd.items()})
segs = []

# S1: Guardian-of-Steel film with the cold-open statement overlaid, under vo_s1
CARD = "cold_open_card.png"
GUARDIAN = os.path.join(R, "output/episodes/hero-ai-long/final.mp4")
d = vd[1] + 0.6
run([FF, "-ss", "3", "-i", GUARDIAN, "-loop", "1", "-i", CARD, "-i", "vo_s1.wav",
     "-filter_complex",
     "[0:v]scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,fps=30[bg];[1:v]scale=1280:720[ov];[bg][ov]overlay=0:0[v]",
     "-map", "[v]", "-map", "2:a", "-t", str(d)] + ENC + ["seg1.mp4"]); segs.append("seg1.mp4")

# S2: title slate
d = vd[2] + 0.5
slate([("FILMWRITER", 72, 260), ("an autonomous AI showrunner on Qwen Cloud", 30, 370),
       ("one logline in. a season out.", 26, 430)], d, "slate2.mp4")
run([FF, "-i", "slate2.mp4", "-i", "vo_s2.wav", "-map", "0:v", "-map", "1:a", "-t", str(d)] + ENC + ["seg2.mp4"]); segs.append("seg2.mp4")

# S3: SLATE for Derek's screen recording (crew panel + self-correction log)
d = vd[3] + 0.5
slate([("[ SCREEN RECORDING GOES HERE ]", 40, 280), ("crew panel · refine PASS · re-take verified · vo re-take", 24, 380),
       ("breaks 9 -> 3 across seven runs", 24, 430)], d, "slate3.mp4")
run([FF, "-i", "slate3.mp4", "-i", "vo_s3.wav", "-map", "0:v", "-map", "1:a", "-t", str(d)] + ENC + ["seg3.mp4"]); segs.append("seg3.mp4")

# S4: Lena triptych — vault anchor | ep1 frame | ep2 frame
run([FF, "-ss", "12", "-i", EP1, "-frames:v", "1", "-y", "lena_ep1.png"])
run([FF, "-ss", "12", "-i", EP2, "-frames:v", "1", "-y", "lena_ep2.png"])
run([FF, "-i", ANCHOR, "-i", "lena_ep1.png", "-i", "lena_ep2.png", "-filter_complex",
     "[0:v]scale=426:720:force_original_aspect_ratio=decrease,pad=426:720:(ow-iw)/2:(oh-ih)/2[a];"
     "[1:v]scale=427:720:force_original_aspect_ratio=decrease,pad=427:720:(ow-iw)/2:(oh-ih)/2[b];"
     "[2:v]scale=427:720:force_original_aspect_ratio=decrease,pad=427:720:(ow-iw)/2:(oh-ih)/2[c];"
     "[a][b][c]hstack=3", "-frames:v", "1", "-y", "triptych.png"])
d = vd[4] + 0.5
seg(["-loop", "1", "-i", "triptych.png"], "vo_s4.wav", "seg4.mp4", d); segs.append("seg4.mp4")

# S5: SLATE for /manage recording, with forgotten-god playing after 40%? keep slate simple
d = vd[5] + 0.5
slate([("[ SCREEN RECORDING GOES HERE ]", 40, 280), ("/manage grid · KPI badge tooltip · identity major/minor", 24, 380)], d, "slate5.mp4")
run([FF, "-i", "slate5.mp4", "-i", "vo_s5.wav", "-map", "0:v", "-map", "1:a", "-t", str(d)] + ENC + ["seg5.mp4"]); segs.append("seg5.mp4")

# S6: end card
d = vd[6] + 1.0
slate([("FILMWRITER", 64, 240), ("qwen-max · qwen-plus · qwen3-vl · qwen-image · qwen-image-edit", 22, 322),
       ("wan2.6 · wan2.2-kf2v · qwen3-tts · qwen3-asr", 22, 358),
       ("github.com/banksythequantLab/Qwen-Filmwriter", 26, 410), ("filmwriter.tlz.us", 26, 460)], d, "slate6.mp4")
run([FF, "-i", "slate6.mp4", "-i", "vo_s6.wav", "-map", "0:v", "-map", "1:a", "-t", str(d)] + ENC + ["seg6.mp4"]); segs.append("seg6.mp4")

open("concat.txt", "w").write("".join(f"file '{s}'\n" for s in segs))
run([FF, "-f", "concat", "-safe", "0", "-i", "concat.txt", "-c:v", "libx264", "-pix_fmt", "yuv420p",
     "-preset", "veryfast", "-crf", "21", "-c:a", "aac", "-ar", "44100", "-ac", "2", "-y", "rough_cut.mp4"])
print(f"ROUGH CUT DONE: {os.path.join(A, 'rough_cut.mp4')} ({round(dur('rough_cut.mp4'), 1)}s)")

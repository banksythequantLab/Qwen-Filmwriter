from PIL import Image, ImageDraw, ImageFont
import os
W, H = 1920, 1080
BG=(10,13,18); MUTED=(202,210,224); BRIGHT=(238,242,248); ACCENT=(95,208,200); RULE=(38,48,62)
FD = r"C:\Windows\Fonts"
def F(names, size):
    for n in names:
        p = os.path.join(FD, n)
        if os.path.exists(p): return ImageFont.truetype(p, size)
    return ImageFont.load_default()
f_mut  = F(["segoeui.ttf","arial.ttf"], 56)
f_br   = F(["seguisb.ttf","arialbd.ttf"], 62)
f_brand= F(["segoeui.ttf","arial.ttf"], 30)
img = Image.new("RGBA", (W,H), (0,0,0,0))
d = ImageDraw.Draw(img)
d.rectangle([0,0,W,H], fill=(6,9,14,170))  # dark scrim so text stays legible over the film
MAXW = 1440
def wrap(text, font):
    words=text.split(); lines=[]; cur=""
    for w in words:
        t=(cur+" "+w).strip()
        if d.textlength(t, font=font) <= MAXW: cur=t
        else: lines.append(cur); cur=w
    if cur: lines.append(cur)
    return lines
blocks=[
 ("I gave it one sentence \u2014", f_mut, MUTED, 20),
 ("an AI built to fix a city becomes the only thing that can save it.", f_br, BRIGHT, 58),
 ("No shot list. No images. No edits.", f_mut, MUTED, 20),
 ("Twenty-four minutes later it handed me a two-minute film.", f_br, BRIGHT, 0),
]
items=[]
for text,font,color,gap in blocks:
    for ln in wrap(text,font): items.append(("line",ln,font,color))
    items.append(("gap",gap))
LS=16
total=0
for it in items:
    if it[0]=="line":
        a,de=it[2].getmetrics(); total+=a+de+LS
    else: total+=it[1]
y=(H-total)//2
for it in items:
    if it[0]=="line":
        _,ln,f,color=it; a,de=f.getmetrics(); h=a+de
        w=d.textlength(ln,font=f)
        d.text(((W-w)//2,y),ln,font=f,fill=color)
        y+=h+LS
    else: y+=it[1]
d.line([(W//2-130,H-138),(W//2+130,H-138)], fill=RULE, width=1)
bt="F I L M W R I T E R"
bw=d.textlength(bt,font=f_brand)
d.text(((W-bw)//2,H-118),bt,font=f_brand,fill=ACCENT)
out=r"B:\QwenShowrunner\demo_assets\cold_open_card.png"
img.save(out)
print("SAVED", out, img.size)

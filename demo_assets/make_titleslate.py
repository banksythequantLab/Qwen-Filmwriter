from PIL import Image, ImageDraw, ImageFont, ImageFilter
import os
A = r"B:\QwenShowrunner\demo_assets"
W, H = 1920, 1080
BG=(9,12,17); BRIGHT=(248,251,255); MUTED=(180,192,210); ACCENT=(116,224,214)
FD = r"C:\Windows\Fonts"
def F(names, size):
    for n in names:
        p=os.path.join(FD,n)
        if os.path.exists(p): return ImageFont.truetype(p,size)
    return ImageFont.load_default()
f_big =F(["seguibl.ttf","seguisb.ttf","arialbd.ttf"],152)
f_sub =F(["segoeui.ttf","arial.ttf"],46)
f_tag =F(["seguisb.ttf","arialbd.ttf"],42)
f_spon=F(["segoeui.ttf","arial.ttf"],30)
img=Image.new("RGB",(W,H),BG)
# soft accent glow behind the title + faint vignette
glow=Image.new("RGBA",(W,H),(0,0,0,0)); gd=ImageDraw.Draw(glow)
gd.ellipse([W//2-600,432-200,W//2+600,432+200],fill=(26,74,88,120))
glow=glow.filter(ImageFilter.GaussianBlur(175))
img=Image.alpha_composite(img.convert("RGBA"),glow).convert("RGB")
d=ImageDraw.Draw(img)
def ctext(cx,cy,txt,font,fill):
    w=d.textlength(txt,font=font); a,de=font.getmetrics(); d.text((cx-w/2,cy-(a+de)/2),txt,font=font,fill=fill)
def ctext_ls(cx,cy,txt,font,fill,ls):
    ws=[d.textlength(c,font=font) for c in txt]; tot=sum(ws)+ls*(len(txt)-1); a,de=font.getmetrics(); x=cx-tot/2; ty=cy-(a+de)/2
    for c,w in zip(txt,ws): d.text((x,ty),c,font=font,fill=fill); x+=w+ls
ctext_ls(W//2,432,"FILMWRITER",f_big,BRIGHT,16)
d.line([(W//2-200,544),(W//2+200,544)],fill=ACCENT,width=3)
ctext(W//2,600,"Autonomous AI Showrunner",f_sub,MUTED)
t1="One logline in.     "; t2="A full show out."
w1=d.textlength(t1,font=f_tag); w2=d.textlength(t2,font=f_tag); tot=w1+w2; a,de=f_tag.getmetrics()
x=W//2-tot/2; ty=664-(a+de)/2
d.text((x,ty),t1,font=f_tag,fill=BRIGHT); d.text((x+w1,ty),t2,font=f_tag,fill=ACCENT)
_sp="Built on  Qwen Cloud   \u00b7   Alibaba Cloud"; _sw=d.textlength(_sp,font=f_spon); _sy=940
d.line([(W//2-_sw/2-60,_sy),(W//2-_sw/2-24,_sy)],fill=ACCENT,width=2)
d.line([(W//2+_sw/2+24,_sy),(W//2+_sw/2+60,_sy)],fill=ACCENT,width=2)
ctext(W//2,_sy,_sp,f_spon,ACCENT)
out=os.path.join(A,"title_slate.png"); img.save(out); print("SAVED",out,img.size)

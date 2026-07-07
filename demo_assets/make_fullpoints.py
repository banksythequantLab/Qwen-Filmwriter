from PIL import Image, ImageDraw, ImageFont, ImageFilter
import os
A=r"B:\QwenShowrunner\demo_assets"; OUT=os.path.join(A,"pointcards")
W,H=1920,1080
BG=(9,12,17); BRIGHT=(248,251,255); MUTED=(184,196,214); ACCENT=(118,225,215); WARN=(226,148,108); GOOD=(150,224,172)
FD=r"C:\Windows\Fonts"
def F(n,s):
    for x in n:
        p=os.path.join(FD,x)
        if os.path.exists(p): return ImageFont.truetype(p,s)
    return ImageFont.load_default()
def base():
    img=Image.new("RGB",(W,H),BG); glow=Image.new("RGBA",(W,H),(0,0,0,0)); gd=ImageDraw.Draw(glow)
    gd.ellipse([W//2-620,470-210,W//2+620,470+210],fill=(26,74,88,110)); glow=glow.filter(ImageFilter.GaussianBlur(175))
    return Image.alpha_composite(img.convert("RGBA"),glow).convert("RGB")
def ctext(d,cx,cy,txt,font,fill):
    w=d.textlength(txt,font=font); a,de=font.getmetrics(); d.text((cx-w/2,cy-(a+de)/2),txt,font=font,fill=fill)
def ctext_ls(d,cx,cy,txt,font,fill,ls):
    ws=[d.textlength(c,font=font) for c in txt]; tot=sum(ws)+ls*(len(txt)-1); a,de=font.getmetrics(); x=cx-tot/2; ty=cy-(a+de)/2
    for c,w in zip(txt,ws): d.text((x,ty),c,font=font,fill=fill); x+=w+ls
_md=ImageDraw.Draw(Image.new("RGB",(W,H)))
def bigfit(text,ls,start=118,lo=66):
    sz=start
    while sz>lo:
        f=F(["seguibl.ttf","seguisb.ttf","arialbd.ttf"],sz)
        if sum(_md.textlength(c,font=f) for c in text)+ls*(len(text)-1)<=W-160: return f
        sz-=4
    return F(["seguibl.ttf","seguisb.ttf","arialbd.ttf"],lo)
f_eye=F(["seguisb.ttf","arialbd.ttf"],34); f_label=F(["seguisb.ttf","arialbd.ttf"],40); f_sub=F(["segoeui.ttf","arial.ttf"],44)
f_tag=F(["seguisb.ttf","arialbd.ttf"],40); f_spon=F(["seguisb.ttf","arialbd.ttf"],44)
f_stat=F(["seguibl.ttf","seguisb.ttf","arialbd.ttf"],264); f_arrow=F(["seguisb.ttf","arialbd.ttf"],170)
def sponsor(d,y=958):
    s="Built on  Qwen Cloud   \u00b7   Alibaba Cloud"; sw=d.textlength(s,font=f_spon)
    d.line([(W//2-sw/2-74,y),(W//2-sw/2-30,y)],fill=ACCENT,width=3); d.line([(W//2+sw/2+30,y),(W//2+sw/2+74,y)],fill=ACCENT,width=3)
    ctext(d,W//2,y,s,f_spon,ACCENT)
def statement(title,sub,tag,path):
    img=base(); d=ImageDraw.Draw(img); tf=bigfit(title,4)
    ctext_ls(d,W//2,442,title,tf,BRIGHT,4)
    d.line([(W//2-230,560),(W//2+230,560)],fill=ACCENT,width=3)
    ctext(d,W//2,628,sub,f_sub,MUTED); ctext(d,W//2,704,tag,f_tag,BRIGHT); sponsor(d); img.save(path)
statement("EVERY FIX IS ANOTHER MODEL CALL","more iteration makes the film better","but it runs up the bill \u2014 quality vs. cost is the real tradeoff",os.path.join(OUT,"point_08_full.png")); print("08")
img=base(); d=ImageDraw.Draw(img)
ctext_ls(d,W//2,300,"SAME LOGLINE   \u00b7   SEVEN RUNS",f_eye,ACCENT,4)
n9,ar,n3="9","\u2192","3"; w9=_md.textlength(n9,font=f_stat); wa=_md.textlength(ar,font=f_arrow); w3=_md.textlength(n3,font=f_stat)
gap=80; tot=w9+gap+wa+gap+w3; x=W//2-tot/2; cy=520; a,de=f_stat.getmetrics(); ty=cy-(a+de)/2; aa,ade=f_arrow.getmetrics()
d.text((x,ty),n9,font=f_stat,fill=WARN); x+=w9+gap; d.text((x,cy-(aa+ade)/2),ar,font=f_arrow,fill=ACCENT); x+=wa+gap; d.text((x,ty),n3,font=f_stat,fill=GOOD)
ctext_ls(d,W//2,726,"CONTINUITY BREAKS",f_label,MUTED,6); ctext(d,W//2,796,"the agents let fewer errors through each pass",f_sub,BRIGHT); sponsor(d)
img.save(os.path.join(OUT,"point_09_full.png")); print("09")
statement("NOT FULLY BAKED \u2014 YET","the hardest shots still slip","but every pass makes it better \u2014 it grades its own progress",os.path.join(OUT,"point_10_full.png")); print("10")
statement("WHEN OUR SCORE MAXED OUT","we made the system's judge tougher","a higher bar for every film that follows",os.path.join(OUT,"point_score_full.png")); print("score")
statement("NOT EVERY ITERATION WAS PROGRESS","some loops actually performed worse","iteration isn't a straight line \u2014 but the trend holds",os.path.join(OUT,"point_progress_full.png")); print("progress")
cw,ch=820,461; mont=Image.new("RGB",(2*cw+60,2*ch+60),(20,24,32)); fs=["point_08_full.png","point_09_full.png","point_10_full.png","point_score_full.png"]
for i,f in enumerate(fs):
    ci=Image.open(os.path.join(OUT,f)).resize((cw,ch),Image.LANCZOS); mont.paste(ci,(20+(i%2)*(cw+20),20+(i//2)*(ch+20)))
mont.save(os.path.join(A,"fullpoints_contact.png")); print("DONE")

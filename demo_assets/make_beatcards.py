from PIL import Image, ImageDraw, ImageFont, ImageFilter
import os
A=r"B:\QwenShowrunner\demo_assets"; OUT=os.path.join(A,"beatcards"); os.makedirs(OUT,exist_ok=True)
W,H=1920,1080
BG=(9,12,17); BRIGHT=(248,251,255); MUTED=(184,196,214); ACCENT=(118,225,215)
FD=r"C:\Windows\Fonts"
def F(n,s):
    for x in n:
        p=os.path.join(FD,x)
        if os.path.exists(p): return ImageFont.truetype(p,s)
    return ImageFont.load_default()
f_sub=F(["segoeui.ttf","arial.ttf"],46); f_tag=F(["seguisb.ttf","arialbd.ttf"],40); f_foot=F(["seguisb.ttf","arialbd.ttf"],44)
def bigfont(sz): return F(["seguibl.ttf","seguisb.ttf","arialbd.ttf"],sz)
def ctext(d,cx,cy,txt,font,fill):
    w=d.textlength(txt,font=font); a,de=font.getmetrics(); d.text((cx-w/2,cy-(a+de)/2),txt,font=font,fill=fill)
def ctext_ls(d,cx,cy,txt,font,fill,ls):
    ws=[d.textlength(c,font=font) for c in txt]; tot=sum(ws)+ls*(len(txt)-1); a,de=font.getmetrics(); x=cx-tot/2; ty=cy-(a+de)/2
    for c,w in zip(txt,ws): d.text((x,ty),c,font=font,fill=fill); x+=w+ls
CARDS=[
 ("s4_vault","THE SEASON VAULT","A finished film banks its cast","The same actors return for the next episode.",None),
 ("s5_grade","IT GRADES ITSELF","Continuity  \u00b7  Identity  \u00b7  Beats  \u00b7  Through-line  \u00b7  Craft","Scored from the crew's QA \u2014 not guesswork.",None),
 ("s6_end","FILMWRITER","Nine models on Qwen Cloud  \u00b7  one autonomous studio","One line in.      A full show out.","github.com/banksythequantLab/Qwen-Filmwriter    \u00b7    filmwriter.tlz.us"),
]
for cid,title,sub,tag,foot in CARDS:
    img=Image.new("RGB",(W,H),BG)
    glow=Image.new("RGBA",(W,H),(0,0,0,0)); gd=ImageDraw.Draw(glow)
    gd.ellipse([W//2-620,430-200,W//2+620,430+200],fill=(26,74,88,112)); glow=glow.filter(ImageFilter.GaussianBlur(175))
    img=Image.alpha_composite(img.convert("RGBA"),glow).convert("RGB"); d=ImageDraw.Draw(img)
    ls=14 if title=="FILMWRITER" else 6; sz=150 if title=="FILMWRITER" else 120; tf=bigfont(sz)
    while True:
        ws=[d.textlength(c,font=tf) for c in title]; tot=sum(ws)+ls*(len(title)-1)
        if tot<=W-150 or sz<=70: break
        sz-=6; tf=bigfont(sz)
    ctext_ls(d,W//2,432,title,tf,BRIGHT,ls)
    d.line([(W//2-215,552),(W//2+215,552)],fill=ACCENT,width=3)
    ctext(d,W//2,612,sub,f_sub,MUTED)
    ctext(d,W//2,680,tag,f_tag,BRIGHT)
    ctext(d,W//2,946,(foot if foot else "Built on Qwen Cloud  \u00b7  Alibaba Cloud"),f_foot,ACCENT)
    img.save(os.path.join(OUT,cid+".png")); print("saved",cid)
cw,ch=560,315; pad=18
mont=Image.new("RGB",(cw+2*pad,3*ch+4*pad),(18,22,30))
for i,(cid,_,_,_,_) in enumerate(CARDS):
    ci=Image.open(os.path.join(OUT,cid+".png")).resize((cw,ch),Image.LANCZOS); mont.paste(ci,(pad,pad+i*(ch+pad)))
mont.save(os.path.join(A,"beatcards_contact.png")); print("DONE")

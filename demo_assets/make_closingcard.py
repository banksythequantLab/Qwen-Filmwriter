from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageEnhance
import os
A=r"B:\QwenShowrunner\demo_assets"; CD=os.path.join(A,"crew")
W,H=1920,1080
BG=(9,12,17); BRIGHT=(248,251,255); MUTED=(192,204,222); ACCENT=(118,225,215)
FD=r"C:\Windows\Fonts"
def F(n,s):
    for x in n:
        p=os.path.join(FD,x)
        if os.path.exists(p): return ImageFont.truetype(p,s)
    return ImageFont.load_default()
f_big=F(["seguibl.ttf","seguisb.ttf","arialbd.ttf"],150); f_sub=F(["segoeui.ttf","arial.ttf"],44)
f_tag=F(["seguisb.ttf","arialbd.ttf"],42); f_spon=F(["seguisb.ttf","arialbd.ttf"],44); f_links=F(["segoeui.ttf","arial.ttf"],30)
def cover(im,w,h):
    iw,ih=im.size; s=max(w/iw,h/ih); nw,nh=int(iw*s),int(ih*s); im=im.resize((nw,nh),Image.LANCZOS); x=(nw-w)//2; y=(nh-h)//2; return im.crop((x,y,x+w,y+h))
def ctext(d,cx,cy,txt,font,fill):
    w=d.textlength(txt,font=font); a,de=font.getmetrics(); d.text((cx-w/2,cy-(a+de)/2),txt,font=font,fill=fill)
def ctext_ls(d,cx,cy,txt,font,fill,ls):
    ws=[d.textlength(c,font=font) for c in txt]; tot=sum(ws)+ls*(len(txt)-1); a,de=font.getmetrics(); x=cx-tot/2; ty=cy-(a+de)/2
    for c,w in zip(txt,ws): d.text((x,ty),c,font=font,fill=fill); x+=w+ls
def sponsor(d,y):
    s="Built on  Qwen Cloud   \u00b7   Alibaba Cloud"; sw=d.textlength(s,font=f_spon)
    d.line([(W//2-sw/2-74,y),(W//2-sw/2-30,y)],fill=ACCENT,width=3); d.line([(W//2+sw/2+30,y),(W//2+sw/2+74,y)],fill=ACCENT,width=3)
    ctext(d,W//2,y,s,f_spon,ACCENT)
bg=Image.new("RGB",(W,H),BG); ids=['show','write','story','board','cont','legal','shoot','edit']; cw,ch=W//4,H//2
for i,cid in enumerate(ids):
    p=os.path.join(CD,cid+".png")
    if os.path.exists(p):
        im=cover(Image.open(p).convert("RGB"),cw,ch); im=ImageEnhance.Brightness(im).enhance(0.46); im=ImageEnhance.Color(im).enhance(0.62)
        bg.paste(im,((i%4)*cw,(i//4)*ch))
g=ImageDraw.Draw(bg)
for c in range(1,4): g.line([(c*cw,0),(c*cw,H)],fill=(0,0,0),width=2)
g.line([(0,ch),(W,ch)],fill=(0,0,0),width=2)
img=bg.convert("RGBA"); img=Image.alpha_composite(img,Image.new("RGBA",(W,H),(7,10,15,120)))
cg=Image.new("RGBA",(W,H),(0,0,0,0)); ImageDraw.Draw(cg).ellipse([W//2-760,H//2-380,W//2+760,H//2+380],fill=(7,10,15,170)); cg=cg.filter(ImageFilter.GaussianBlur(190))
img=Image.alpha_composite(img,cg).convert("RGB"); d=ImageDraw.Draw(img)
ctext_ls(d,W//2,406,"FILMWRITER",f_big,BRIGHT,14)
d.line([(W//2-230,520),(W//2+230,520)],fill=ACCENT,width=3)
ctext(d,W//2,584,"An autonomous crew of eight Qwen agents",f_sub,MUTED)
ctext(d,W//2,656,"One line in.      A full show out.",f_tag,BRIGHT)
sponsor(d,854)
ctext(d,W//2,926,"github.com/banksythequantLab/Qwen-Filmwriter    \u00b7    filmwriter.tlz.us",f_links,ACCENT)
img.save(os.path.join(A,"closing_card.png")); print("SAVED closing_card.png")

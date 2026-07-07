from PIL import Image, ImageDraw, ImageFont, ImageEnhance
import os
A = r"B:\QwenShowrunner\demo_assets"
W, H = 1800, 1200
BG=(7,9,13); HEAD=(16,20,30); PANEL=(28,35,49); CAPBAR=(38,47,64); BORDER=(84,100,124); IMGB=(64,80,102); BRIGHT=(251,252,255); SUBT=(196,206,221); ACCENT=(116,224,214)
FD = r"C:\Windows\Fonts"
def F(names, size):
    for n in names:
        p=os.path.join(FD,n)
        if os.path.exists(p): return ImageFont.truetype(p,size)
    return ImageFont.load_default()
f_big =F(["seguibl.ttf","seguisb.ttf","arialbd.ttf"],112)
f_sub =F(["segoeui.ttf","arial.ttf"],38)
f_spon=F(["seguisb.ttf","arialbd.ttf"],44)
f_cap =F(["seguisb.ttf","arialbd.ttf"],35)
f_subc=F(["segoeui.ttf","arial.ttf"],24)
f_sm  =F(["seguisb.ttf","arialbd.ttf"],24)
f_brand=F(["segoeui.ttf","arial.ttf"],25)
img=Image.new("RGB",(W,H),BG); d=ImageDraw.Draw(img)
def ctext(cx,cy,txt,font,fill):
    w=d.textlength(txt,font=font); a,de=font.getmetrics(); d.text((cx-w/2,cy-(a+de)/2),txt,font=font,fill=fill)
def ctext_ls(cx,cy,txt,font,fill,ls):
    ws=[d.textlength(c,font=font) for c in txt]; tot=sum(ws)+ls*(len(txt)-1); a,de=font.getmetrics(); x=cx-tot/2; ty=cy-(a+de)/2
    for c,w in zip(txt,ws): d.text((x,ty),c,font=font,fill=fill); x+=w+ls
def rrect(x0,y0,x1,y1,r,fill=None,outline=None,wd=1): d.rounded_rectangle([x0,y0,x1,y1],radius=r,fill=fill,outline=outline,width=wd)
def cover(im,w,h):
    iw,ih=im.size; s=max(w/iw,h/ih); nw,nh=int(iw*s),int(ih*s); im=im.resize((nw,nh),Image.LANCZOS); x=(nw-w)//2; y=(nh-h)//2; return im.crop((x,y,x+w,y+h))
def draw_arch(x,y,w,h):
    boxes=[("One logline",ACCENT),("Self-correcting crew",BRIGHT),("Self-grade -> KPI",BRIGHT),("Film + season vault",BRIGHT)]
    bw=int(w*0.88); bh=54; gap=(h-len(boxes)*bh)//(len(boxes)+1); cx=x+w//2; cy=y+gap
    for i,(t,col) in enumerate(boxes):
        rrect(cx-bw//2,cy,cx+bw//2,cy+bh,10,fill=(46,57,77),outline=BORDER,wd=2); ctext(cx,cy+bh//2,t,f_sm,col)
        if i<len(boxes)-1:
            ay=cy+bh; d.line([(cx,ay),(cx,ay+gap)],fill=ACCENT,width=3); d.polygon([(cx-8,ay+gap-10),(cx+8,ay+gap-10),(cx,ay+gap-1)],fill=ACCENT)
        cy+=bh+gap
d.rectangle([0,0,W,300],fill=HEAD); d.line([(0,300),(W,300)],fill=BORDER,width=2)
ctext_ls(W//2,98,"FILMWRITER",f_big,BRIGHT,12)
ctext(W//2,192,"You type one sentence \u2014 AI agents write, shoot, score, and cut the whole film.",f_sub,BRIGHT)
_sp="Built on  Qwen Cloud   \u00b7   Alibaba Cloud"; _sw=d.textlength(_sp,font=f_spon); _sy=252
d.line([(W//2-_sw/2-86,_sy),(W//2-_sw/2-34,_sy)],fill=ACCENT,width=3); d.line([(W//2+_sw/2+34,_sy),(W//2+_sw/2+86,_sy)],fill=ACCENT,width=3)
ctext(W//2,_sy,_sp,f_spon,ACCENT)
gx0=36; gy0=330; gap=24; cols=3; rows=2
cw=(W-2*gx0-(cols-1)*gap)//cols; ch=(H-gy0-54-(rows-1)*gap)//rows; cap_h=100; img_h=ch-cap_h
panels=[
 ("arch",None,"Autonomous pipeline","logline -> crew -> grade -> film"),
 ("img","tc_direct.jpg","Direct from one line","type a logline, it runs the show"),
 ("img","tc_crew.jpg","Self-correcting crew","agents fix, re-audit, reshoot"),
 ("img","tc_manage.jpg","Grades its own work","KPI: continuity, identity, craft"),
 ("img","tc_film.jpg","Finished films","planned, shot, scored, cut"),
 ("img","triptych.png","Season vault -> episodes","same cast returns for sequels"),
]
for i,(kind,src,cap,sub) in enumerate(panels):
    r=i//cols; c=i%cols; x=gx0+c*(cw+gap); y=gy0+r*(ch+gap)
    rrect(x,y,x+cw,y+ch,14,fill=PANEL,outline=BORDER,wd=2)
    ix,iy=x+8,y+8; iw,ih=cw-16,img_h-8
    if kind=="img" and os.path.exists(os.path.join(A,src)):
        _im=Image.open(os.path.join(A,src)).convert("RGB"); _im=ImageEnhance.Brightness(_im).enhance(1.34); _im=ImageEnhance.Contrast(_im).enhance(1.07); img.paste(cover(_im,iw,ih),(ix,iy)); d.rectangle([ix,iy,ix+iw-1,iy+ih-1],outline=IMGB,width=1)
    else:
        draw_arch(ix,iy,iw,ih)
    cyb=y+img_h+6; rrect(x+6,cyb,x+cw-6,y+ch-6,10,fill=CAPBAR)
    ctext(x+cw//2,cyb+34,cap,f_cap,BRIGHT); ctext(x+cw//2,cyb+72,sub,f_subc,SUBT)
ctext(W//2,H-26,"github.com/banksythequantLab/Qwen-Filmwriter   \u00b7   filmwriter.tlz.us",f_brand,ACCENT)
out=os.path.join(A,"title_card.png"); img.save(out); print("SAVED",out,img.size)

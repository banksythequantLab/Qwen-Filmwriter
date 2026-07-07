from PIL import Image, ImageDraw, ImageFont, ImageEnhance
import os
A=r"B:\QwenShowrunner\demo_assets"; CD=os.path.join(A,"crew"); OUT=os.path.join(A,"agentcards"); os.makedirs(OUT,exist_ok=True)
W,H=640,900
CARD=(15,19,28,246); BRIGHT=(250,252,255); MUTED=(191,203,219); ACCENT=(120,226,216); DIM=(150,164,182); STATF=(18,42,50,255); PB=(70,86,104)
FD=r"C:\Windows\Fonts"
def F(n,s):
    for x in n:
        p=os.path.join(FD,x)
        if os.path.exists(p): return ImageFont.truetype(p,s)
    return ImageFont.load_default()
f_num=F(["seguibl.ttf","arialbd.ttf"],44); f_tag=F(["seguisb.ttf","arial.ttf"],19)
f_role=F(["seguisb.ttf","arialbd.ttf"],32); f_name=F(["seguibl.ttf","seguisb.ttf","arialbd.ttf"],48)
f_desc=F(["segoeui.ttf","arial.ttf"],26); f_stat=F(["seguisb.ttf","arialbd.ttf"],27); f_foot=F(["segoeui.ttf","arial.ttf"],20)
ROSTER=[
 ("show","01","The Showrunner","DIRECTOR","Turns one logline into a full plan - scenes, shots, the whole show.","Calls every shot"),
 ("write","02","Margot Penn","SCREENWRITER","Writes the full script from your single sentence.","Locks the script"),
 ("story","03","Theo Brandt","STORY EDITOR","Checks the arc and flags when the story beats miss.","Catches weak beats"),
 ("board","04","Vee Dax","STORYBOARD","Plans every frame on the boards before the shoot.","Plans every frame"),
 ("cont","05","Iris Calder","CONTINUITY","Checks every frame and reshoots when a detail drifts.","Catches wardrobe & prop drift"),
 ("legal","06","Avery Sloan","LEGAL / CLEARANCES","Screens every frame for trademarks, logos, and legible text.","Catches IP & bad text"),
 ("shoot","07","Sergio Ray","CINEMATOGRAPHER","Rolls camera and re-takes when the motion drifts.","Catches motion errors"),
 ("edit","08","Max Cutter","EDITOR","Cuts the checked footage into the final film.","Delivers the final cut"),
]
def cover(im,w,h):
    iw,ih=im.size; s=max(w/iw,h/ih); nw,nh=int(iw*s),int(ih*s); im=im.resize((nw,nh),Image.LANCZOS); x=(nw-w)//2; y=(nh-h)//2; return im.crop((x,y,x+w,y+h))
def wrap(d,text,font,maxw):
    words=text.split(); lines=[]; cur=""
    for w in words:
        t=(cur+" "+w).strip()
        if d.textlength(t,font=font)<=maxw: cur=t
        else: lines.append(cur); cur=w
    if cur: lines.append(cur)
    return lines
def ctext(d,cx,cy,txt,font,fill):
    w=d.textlength(txt,font=font); a,de=font.getmetrics(); d.text((cx-w/2,cy-(a+de)/2),txt,font=font,fill=fill)
for cid,num,name,role,desc,stat in ROSTER:
    img=Image.new("RGBA",(W,H),(0,0,0,0)); d=ImageDraw.Draw(img)
    d.rounded_rectangle([12,12,W-12,H-12],radius=28,fill=CARD,outline=ACCENT,width=3)
    d.text((40,34),num,font=f_num,fill=ACCENT)
    tw=d.textlength("QWEN AGENT",font=f_tag); d.text((W-40-tw,54),"QWEN AGENT",font=f_tag,fill=DIM)
    ctext(d,W//2,106,role,f_role,ACCENT)
    px0,py0,pw,ph=40,134,W-80,430
    pp=os.path.join(CD,cid+".png")
    if os.path.exists(pp):
        im=Image.open(pp).convert("RGB"); im=ImageEnhance.Brightness(im).enhance(1.04); img.paste(cover(im,pw,ph),(px0,py0))
    d.rectangle([px0,py0,px0+pw-1,py0+ph-1],outline=PB,width=1)
    ctext(d,W//2,612,name,f_name,BRIGHT)
    d.line([(W//2-90,648),(W//2+90,648)],fill=ACCENT,width=3)
    y=688
    for ln in wrap(d,desc,f_desc,W-104): ctext(d,W//2,y,ln,f_desc,MUTED); y+=36
    sw=d.textlength("\u25B8  "+stat,font=f_stat); pw2=sw+56; px=W//2-pw2/2; py=y+16
    d.rounded_rectangle([px,py,px+pw2,py+54],radius=27,fill=STATF,outline=ACCENT,width=2)
    ctext(d,W//2,py+27,"\u25B8  "+stat,f_stat,ACCENT)
    ctext(d,W//2,H-42,"FILMWRITER  \u00b7  autonomous crew",f_foot,DIM)
    img.save(os.path.join(OUT,f"card_{num}_{cid}.png")); print("saved",cid)
cols,rows=4,2; cw,ch=300,422; pad=16
mont=Image.new("RGB",(cols*cw+pad*(cols+1),rows*ch+pad*(rows+1)),(18,22,30))
files=sorted(os.listdir(OUT)); i=0
for r in range(rows):
    for c in range(cols):
        if i<len(files):
            ci=Image.open(os.path.join(OUT,files[i])).convert("RGBA").resize((cw,ch),Image.LANCZOS)
            mont.paste(ci,(pad+c*(cw+pad),pad+r*(ch+pad)),ci); i+=1
mont.save(os.path.join(A,"agentcards_contact.png")); print("DONE")

from PIL import Image, ImageDraw, ImageFont
import os
A=r"B:\QwenShowrunner\demo_assets"; OUT=os.path.join(A,"pointcards"); os.makedirs(OUT,exist_ok=True)
W,H=1920,1080
PANEL=(11,15,22,233); BRIGHT=(248,251,255); MUTED=(187,199,217); ACCENT=(118,225,215)
FD=r"C:\Windows\Fonts"
def F(n,s):
    for x in n:
        p=os.path.join(FD,x)
        if os.path.exists(p): return ImageFont.truetype(p,s)
    return ImageFont.load_default()
f_num=F(["seguibl.ttf","arialbd.ttf"],54); f_head=F(["seguisb.ttf","arialbd.ttf"],46); f_sub=F(["segoeui.ttf","arial.ttf"],31); f_tag=F(["seguisb.ttf","arial.ttf"],20)
POINTS=[
 ("01","A crew of eight agents","one film unit \u2014 no human in the loop"),
 ("02","The Editor fixes the exact violation","not a reroll \u2014 then it re-audits"),
 ("03","The Script Supervisor grades every cut","and reshoots the breaks"),
 ("04","Motion QA checks every take","against its approved frame \u2014 bad takes re-shot"),
 ("05","Even the narration is checked","long lines get trimmed and re-recorded"),
 ("06","Legal & Clearances screens every frame","no trademarks or logos \u2014 text must be legible"),
 ("07","Nothing ships until it clears QC","flagged shots re-shot until they pass"),
 ("08","Every fix is another model call","quality has a price \u2014 the real tradeoff"),
 ("09","Seven runs: breaks fell 9 to 3","the agents let fewer errors through"),
 ("10","Not fully baked \u2014 but improving","it grades its own progress and adapts"),
]
def draw(num,head,sub,path):
    img=Image.new("RGBA",(W,H),(0,0,0,0)); d=ImageDraw.Draw(img)
    x0,y0,x1,y1=70,788,1250,980
    d.rounded_rectangle([x0,y0,x1,y1],radius=18,fill=PANEL,outline=(64,124,124,130),width=1)
    d.rectangle([x0,y0+6,x0+12,y1-6],fill=ACCENT)
    d.text((116,y0+24),num,font=f_num,fill=ACCENT)
    d.text((212,y0+40),head,font=f_head,fill=BRIGHT)
    d.text((212,y0+108),sub,font=f_sub,fill=MUTED)
    tw=d.textlength("FILMWRITER CREW",font=f_tag); d.text((x1-tw-24,y0+18),"FILMWRITER CREW",font=f_tag,fill=(118,138,158))
    img.save(path)
for num,head,sub in POINTS: draw(num,head,sub,os.path.join(OUT,f"point_{num}.png")); print("saved",num)
cols,rows=2,5; cw,ch=560,315; pad=14
mont=Image.new("RGB",(cols*cw+pad*(cols+1),rows*ch+pad*(rows+1)),(26,30,38)); i=0
for r in range(rows):
    for c in range(cols):
        if i<len(POINTS):
            ci=Image.open(os.path.join(OUT,f"point_{POINTS[i][0]}.png")).convert("RGBA").resize((cw,ch),Image.LANCZOS)
            mont.paste(ci,(pad+c*(cw+pad),pad+r*(ch+pad)),ci); i+=1
mont.save(os.path.join(A,"pointcards_contact.png")); print("DONE")

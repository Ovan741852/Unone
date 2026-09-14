"""Paint an original UV atlas: expressive face, cloth seams, leather, metal.
Not a reference-image projection: every mark is drawn here at texture resolution.
"""
from PIL import Image,ImageDraw
from pathlib import Path
import random,math
ROOT=Path(__file__).resolve().parents[1];N=512
colors=['E9C38D','E9C38D','EDDDB5','82A5AF','658494','A07955','655440','A9B6B3','CBD0C1','604A36','343B3C','FAF3DF','D89278','D5B36C','E9C38D','82A5AF']
atlas=Image.new('RGB',(N*4,N*4));random.seed(7)
for index,color in enumerate(colors):
 base=tuple(bytes.fromhex(color));tile=Image.new('RGB',(N,N),base);p=tile.load()
 for y in range(N):
  for x in range(N):
   shade=1+.028*math.sin(x/95)-.05*(y/N)+random.uniform(-.005,.005)
   p[x,y]=tuple(max(0,min(255,int(c*shade))) for c in base)
 d=ImageDraw.Draw(tile)
 if index==0:
  # Tiny graphic eyes, confident brows and smile: vinyl-toy face language.
  for cx in [160,352]:
   d.ellipse((cx-29,227,cx+29,291),fill='#333c3c')
   d.ellipse((cx-23,233,cx+23,285),fill='#fff6df')
   d.ellipse((cx-9,244,cx+9,274),fill='#354142')
   d.ellipse((cx-5,245,cx+1,251),fill='#fffdf0')
  d.polygon([(110,182),(197,169),(195,207),(114,203)],fill='#514333')
  d.polygon([(313,169),(400,182),(396,203),(315,207)],fill='#514333')
  d.arc((170,295,345,378),5,164,fill='#6e5340',width=7)
  d.ellipse((109,304,148,317),fill='#d79d7d');d.ellipse((364,304,403,317),fill='#d79d7d')
 elif index in [2,3,4,15]:
  # Painted hem, stitches and subtle cloth folds.
  line='#b4a487' if index==2 else '#537b8b'
  d.line([(31,16),(31,494)],fill=line,width=6);d.line([(481,16),(481,494)],fill=line,width=6)
  d.line([(20,471),(492,471)],fill=line,width=7)
  for y in range(25,455,24):
   d.line([(41,y),(49,y+10)],fill='#e7d9b6',width=3);d.line([(464,y),(472,y+10)],fill='#e7d9b6',width=3)
  d.polygon([(44,452),(122,412),(96,451)],fill=line);d.polygon([(470,81),(418,117),(470,101)],fill=line)
  if index in [3,15]:
   cx,cy=256,211;star=[]
   for k in range(8):
    r=67 if k%2==0 else 23;star.append((cx+math.sin(k*math.pi/4)*r,cy-math.cos(k*math.pi/4)*r))
   d.polygon(star,fill='#edddb5');d.line([(256,153),(256,178)],fill='#fbefd2',width=5)
 elif index in [5,6]:
  d.line([(18,45),(494,45)],fill='#4e4134',width=10);d.line([(18,464),(494,464)],fill='#4e4134',width=10)
  for x in range(28,485,26):d.line([(x,59),(x+12,59)],fill='#ceb189',width=3)
  d.polygon([(78,102),(176,91),(159,104)],fill='#b99873')
 elif index in [7,8]:
  d.line([(30,482),(482,482)],fill='#798d8e',width=9)
  for x,y in [(71,111),(388,231),(153,371)]:d.line([(x,y),(x+31,y-8)],fill='#d6dccc',width=3)
 atlas.paste(tile,((index%4)*N,(index//4)*N))
atlas.save(ROOT/'assets/vinyl/soldier-painted-atlas.png')
print('Painted 2048 atlas with face, cloth, leather and metal tiles')

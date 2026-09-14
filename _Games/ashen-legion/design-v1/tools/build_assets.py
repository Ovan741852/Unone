"""Original editable polygon art and Lottie shapes. No raster images embedded."""
from pathlib import Path
import json, math, random
from fontTools.ttLib import TTFont
from fontTools.pens.basePen import BasePen

ROOT=Path(__file__).resolve().parents[1]
for d in ['svg','animations','previews']: (ROOT/d).mkdir(exist_ok=True)
INK='#182d32'; DARK='#102126'; GOLD='#e8b95e'; LIGHT='#fff1c1'; JADE='#7fc7a0'; RED='#c96450'
assets=[]
def poly(points,c,stroke=None):
 return f'<polygon points="{points}" fill="{c}"'+(f' stroke="{stroke}" stroke-width="3" stroke-linejoin="bevel"' if stroke else '')+'/>'
def rect(x,y,w,h,c):return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" fill="{c}"/>'
def line(x,y,xx,yy,c,w=4):return f'<path d="M{x} {y}L{xx} {yy}" stroke="{c}" stroke-width="{w}" fill="none"/>'
def gem(x,y,r,c=GOLD):return poly(f'{x},{y-r} {x+r},{y} {x},{y+r} {x-r},{y}',c)+poly(f'{x},{y-r} {x},{y+r} {x-r},{y}',LIGHT)
def save(id,name,group,body,w=256,h=256,usage=''):
 data=f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" role="img" aria-labelledby="title"><title id="title">{name}</title>{body}</svg>'
 (ROOT/'svg'/f'{id}.svg').write_text(data,encoding='utf-8')
 assets.append(dict(id=id,name=name,group=group,path=f'svg/{id}.svg',format='SVG',width=w,height=h,usage=usage or group,status='ready'))
def tree(x,y,s=1,tint=JADE):
 return f'<g transform="translate({x} {y}) scale({s})">'+rect(-5,-6,10,35,'#5c6250')+poly('-46,0 0,-91 45,0',tint)+poly('0,-91 45,0 0,-15','#376e60')+poly('-34,-27 0,-111 35,-27','#9ccea0')+poly('0,-111 35,-27 0,-40','#52896a')+'</g>'
def building(kind):
 roof={'keep':RED,'barracks':'#4b7e80','forge':'#b26045','alchemy':'#779683','market':GOLD}[kind]
 b=poly('24,201 131,160 239,206 131,243','#35564d')+poly('45,105 130,65 216,107 216,191 131,229 45,187','#d9c699')+poly('130,65 216,107 216,191 131,229','#929f7a')
 b+=poly('28,110 128,33 233,107 132,154',roof)+poly('128,33 233,107 132,154','#394c48')+poly('28,110 128,33 132,154',roof)
 for x in [62,89]:b+=rect(x,145,12,23,INK)+line(x,145,x+12,145,GOLD,3)
 b+=poly('153,166 179,154 179,206 153,218',INK)+poly('156,169 168,163 168,211 156,217','#4a6557')
 if kind=='keep':
  for x,y in [(40,64),(176,61)]:
   b+=poly(f'{x},{y} {x+34},{y-17} {x+53},{y} {x+53},{y+69} {x+20},{y+85} {x},{y+70}','#e2d3ab')+poly(f'{x-7},{y} {x+27},{y-46} {x+61},{y} {x+23},{y+18}',RED)+rect(x+17,y+28,9,19,INK)
  b+=line(130,37,130,6,INK,4)+poly('132,6 163,14 132,26',GOLD)
 elif kind=='forge':
  b+=poly('157,43 177,34 197,43 197,94 177,106 157,96','#747869')+poly('151,44 175,31 202,44 178,57',INK)
  b+=poly('48,176 74,170 108,180 89,188 82,203 64,207 69,190 48,186',INK)+poly('49,175 76,167 111,178 90,185','#b7c6b2')
  b+=gem(175,21,9,RED)+gem(191,10,5,GOLD)
 elif kind=='alchemy':
  b+=poly('105,118 131,98 153,116 143,132 115,133',GOLD)+poly('123,106 138,106 137,116 146,132 112,132 124,116',JADE)
  b+=tree(217,181,.45,'#a1ba85')
 elif kind=='market':
  b+=poly('36,124 119,160 119,185 36,149',GOLD)
  for i in range(4):b+=poly(f'{39+i*20},{127+i*9} {49+i*20},{131+i*9} {49+i*20},{156+i*9} {39+i*20},{152+i*9}',RED)
  b+=rect(36,152,5,48,INK)+rect(116,186,5,42,INK)+poly('35,193 88,180 128,201 76,221','#987550')+gem(81,192,10)
 elif kind=='barracks':
  b+=line(51,128,84,207,INK,5)+poly('44,117 46,139 58,133',LIGHT)+poly('88,136 106,143 102,176 88,190 74,167 72,143',RED)+poly('88,141 88,179 100,166 102,147',GOLD)
 return b
for id,name in [('keep','領主城堡'),('barracks','兵營'),('forge','鐵匠舖'),('alchemy','煉金房'),('market','市集')]:save('building-'+id,name,'城鎮建築',building(id))

def person(role):
 colors={'lord':('#4e7770',GOLD),'sword':('#758e88',RED),'spear':('#567c6d',JADE),'cavalry':('#d5b56d','#527878'),'alchemist':('#658d73','#ddab71'),'smith':('#9b6751',GOLD),'scholar':('#577382',JADE),'merchant':('#ae8661',RED),'witch':('#78647c','#d78b70')}
 armor,accent=colors[role]
 b=poly('48,227 114,211 211,227 156,245 75,243','#223c3c')
 b+=poly('92,136 163,136 188,214 135,226 72,214',accent)+poly('134,140 163,136 188,214 135,226','#344c49')
 b+=poly('92,141 161,141 166,195 135,212 88,193',armor)+poly('135,141 161,141 166,195 135,212','#3f5856')
 b+=poly('90,192 119,199 116,231 83,233',INK)+poly('139,201 166,192 180,231 144,235',INK)
 b+=poly('69,54 89,30 160,27 184,55 180,113 160,138 93,136 70,112','#edc998')+poly('148,30 184,55 180,113 160,138 145,123','#c4956e')
 b+=poly('65,70 73,56 83,62 82,94 68,89','#d5ae83')+poly('181,62 194,70 190,94 178,97','#d5ae83')
 b+=poly('85,77 105,76 107,83 85,84',INK)+poly('143,76 166,80 165,87 144,84',INK)
 b+=rect(95,90,6,9,INK)+rect(151,92,6,9,INK)+poly('118,81 112,108 136,109','#f7dca7')+line(110,121,140,121,INK,3)
 b+=poly('72,146 91,142 92,182 78,198 62,188','#e2b987')+poly('163,145 180,143 195,186 181,199 167,186','#e2b987')
 if role in ['sword','spear','cavalry']:
  b+=poly('67,70 75,38 99,20 150,20 180,41 186,72 148,60 97,61',armor)+poly('126,21 150,20 180,41 186,72 145,60',INK)+poly('118,21 131,7 145,20 141,59 122,59',accent)
  if role=='sword':b+=poly('44,220 50,171 39,159 48,96 57,83 64,100 60,163 70,170 57,178 54,222',LIGHT)+poly('162,160 191,149 214,164 207,202 187,220 166,201',accent)+gem(188,183,10)
  if role=='spear':b+=line(203,231,207,49,'#af8861',7)+poly('207,19 194,48 204,67 216,49',LIGHT)+line(196,73,222,73,accent,5)
  if role=='cavalry':b+=poly('47,201 60,159 48,143 71,130 92,151 96,190 188,185 206,212 195,233 165,223 78,228','#b5a079')+poly('60,159 48,143 71,130 73,153','#ddcaa0')+rect(63,142,5,5,INK)+line(203,209,213,73,INK,5)+poly('208,71 216,41 221,75',LIGHT)
 elif role=='lord':b+=poly('71,61 77,30 94,43 111,18 133,40 158,22 176,49 177,64',GOLD)+gem(124,45,8,JADE)
 elif role=='witch':b+=poly('52,62 88,42 127,0 150,40 197,70 116,60','#4b435b')+poly('127,0 150,40 116,53','#917489')+gem(125,43,6,GOLD)
 elif role=='smith':b+=poly('69,69 81,34 157,28 181,49 179,70 149,54 81,62','#784e38')+poly('93,113 110,119 145,119 161,110 158,134 129,145 96,132','#80503a')+line(202,215,193,134,'#947050',8)+poly('174,116 211,113 221,137 180,145',INK)
 elif role=='alchemist':b+=poly('73,63 79,40 160,31 180,56 159,57 122,47 91,68','#d7d3b0')+gem(195,183,22,JADE)
 elif role=='scholar':b+=poly('67,55 125,18 190,57 131,73',armor)+poly('92,158 132,168 165,157 168,202 132,216 92,202',LIGHT)+line(132,171,132,211,INK,3)
 else:b+=poly('65,68 80,38 157,33 181,60',RED)+poly('56,68 126,53 193,66 177,79 77,77',GOLD)+gem(198,188,22)
 return b
for role,name in [('lord','森林領主'),('sword','劍兵'),('spear','槍兵'),('cavalry','騎兵'),('alchemist','煉金師'),('smith','鐵匠'),('scholar','科技學者'),('merchant','商人'),('witch','契約使者')]:save('portrait-'+role,name,'角色立繪',person(role))

def icon(kind,color=GOLD):
 b=''
 if kind=='coin':
  b=poly('91,35 163,35 207,79 207,158 161,204 91,204 47,160 47,79','#a66e35')+poly('88,24 160,24 202,67 202,146 157,192 87,192 42,146 42,67',GOLD)+poly('99,47 150,47 178,77 178,136 147,168 100,168 66,135 66,78',LIGHT)+poly('126,66 155,105 126,148 97,106','#b67a3c')
 elif kind in ['potion-haste','potion-life','potion-recall']:
  b=poly('98,25 156,25 156,73 187,105 201,171 173,215 80,215 54,172 68,105 98,73',INK)+poly('107,44 147,44 147,83 176,110 188,169 165,201 88,201 68,169 79,110 107,83','#bfddcb')+poly('78,125 179,125 188,169 165,201 88,201 68,169',color)+poly('78,125 116,143 126,201 88,201 68,169',LIGHT)+rect(100,24,53,24,'#af8861')
  b+=gem(132,157,16,INK)
 elif kind in ['weapon','pierce','attack']:
  b=poly('47,210 86,154 70,139 84,122 102,140 165,49 195,23 194,65 125,156 145,172 131,190 109,172 68,226',LIGHT)+poly('195,23 194,65 125,156 114,145',color)+line(75,132,142,184,GOLD,10)
  if kind=='pierce':b+=poly('36,75 97,75 97,56 126,88 97,120 97,102 36,102',color)
 elif kind in ['helmet','crit']:
  b=poly('54,169 54,97 85,45 145,27 198,86 199,169 160,194 158,109 96,109 96,194',color)+poly('145,27 198,86 199,169 160,194 158,109 128,99',INK)+poly('101,114 151,114 139,189 115,190',LIGHT)
  if kind=='crit':b+=gem(131,64,18,RED)
 elif kind=='body':b=poly('54,65 86,43 106,65 151,65 174,43 205,66 182,111 173,192 126,218 78,192 75,111',color)+poly('128,65 151,65 174,43 205,66 182,111 173,192 126,218',INK)+gem(128,111,20,LIGHT)
 elif kind=='boots':b=poly('66,40 124,40 115,140 142,175 140,207 44,207 43,183 69,143',color)+poly('139,55 183,55 180,144 215,176 213,207 154,207 157,172 135,146',LIGHT)
 elif kind=='gloves':b=poly('75,213 52,138 57,98 73,98 80,134 80,55 96,52 106,129 109,37 126,37 132,127 143,49 159,56 154,135 172,80 188,86 175,167 153,214',color)+poly('75,174 164,174 153,214 75,213',INK)+gem(118,150,14,LIGHT)
 elif kind in ['spin','refresh']:
  b=poly('194,94 157,63 104,65 70,98 62,141 85,180 125,197 175,182 146,222 91,217 44,185 26,132 46,78 93,42 153,41 202,66 224,39 230,118 158,119',color)+gem(127,130,20,LIGHT)
 elif kind=='life':
  b=poly('36,72 72,43 107,49 129,77 151,49 184,43 218,76 209,124 128,211 48,124',color)+poly('129,77 151,49 184,43 218,76 209,124 128,211',RED)+gem(127,128,18,LIGHT)
 elif kind=='speed':b=poly('151,21 69,124 119,124 88,232 200,95 147,95 183,21',color)
 elif kind in ['curse-debt','curse-frail','curse-slow']:
  b=poly('65,25 190,25 210,58 188,78 188,213 67,213 48,187 69,165 69,68 46,47','#a993b1')+poly('82,46 175,46 175,189 82,189',INK)+poly('112,78 148,78 164,98 157,129 141,136 141,153 114,153 113,136 99,129 92,98',color)+rect(109,101,11,13,INK)+rect(138,101,11,13,INK)+line(100,172,160,172,GOLD,5)
  if kind=='curse-debt':b+=gem(186,190,30,GOLD)
  if kind=='curse-frail':b+=poly('177,152 168,177 183,189 170,211 200,186 186,173',RED)
  if kind=='curse-slow':b+=poly('165,151 205,151 185,181 205,210 165,210 184,181',LIGHT)
 elif kind=='lock':b=poly('77,108 77,55 101,30 152,30 178,54 178,108 156,108 156,65 143,53 113,53 100,66 100,108',color)+poly('59,100 195,100 202,197 127,224 51,197',color)+gem(127,151,18,INK)+rect(120,152,14,29,INK)
 elif kind=='auto':b=icon('refresh',color)+poly('105,94 157,131 105,165',LIGHT)
 elif kind=='crown':b=poly('36,70 81,104 125,38 171,105 221,69 195,185 61,185',color)+poly('125,38 171,105 221,69 195,185 128,185','#b17a40')+rect(64,193,130,19,LIGHT)+gem(125,133,17,JADE)
 elif kind=='rune':b=poly('126,20 209,99 177,205 83,225 40,113','#69878c')+poly('126,20 209,99 126,126',JADE)+poly('126,126 177,205 83,225','#344c5d')+line(126,66,99,126,LIGHT,9)+line(99,126,150,126,LIGHT,9)+line(150,126,122,181,LIGHT,9)
 elif kind=='sell':b=poly('38,63 166,63 218,121 167,181 38,181',color)+gem(74,123,15,INK)+line(124,102,154,123,INK,7)+line(154,123,124,145,INK,7)
 elif kind=='close':b=line(65,65,191,191,color,15)+line(191,65,65,191,color,15)
 elif kind=='pause':b=rect(73,49,34,158,color)+rect(149,49,34,158,color)
 elif kind=='sound':b=poly('34,97 81,97 137,47 137,209 81,158 34,158',color)+line(171,78,200,108,color,10)+line(200,108,200,151,color,10)+line(200,151,171,181,color,10)
 elif kind=='map':b=poly('28,58 93,35 159,59 227,35 227,198 159,221 93,198 28,221',color)+poly('93,35 159,59 159,221 93,198','#547970')+line(57,159,119,108,INK,7)+line(119,108,186,135,INK,7)+gem(186,135,16,RED)
 return b
icons=[('coin','金幣',GOLD),('potion-haste','疾風藥水',JADE),('potion-life','續命藥水',RED),('potion-recall','召回藥水','#8bb7cf'),('weapon','武器',GOLD),('helmet','頭盔',GOLD),('body','身甲',JADE),('boots','靴子','#b7a07c'),('gloves','護手',RED),('pierce','穿透',GOLD),('crit','爆擊',RED),('spin','旋轉斬',JADE),('life','壽命',JADE),('speed','速度',GOLD),('attack','傷害',RED),('curse-debt','負債契約',GOLD),('curse-frail','脆弱契約',RED),('curse-slow','遲緩契約',JADE),('lock','鎖定',GOLD),('auto','自動',JADE),('crown','領主徽記',GOLD),('rune','符文',JADE),('sell','出售',GOLD),('refresh','刷新',JADE),('close','關閉',LIGHT),('pause','暫停',LIGHT),('sound','音效',LIGHT),('map','路線',JADE)]
for id,name,c in icons:save('icon-'+id,name,'道具與介面圖示',icon(id,c))

def creature(rank):
 c=['#afc69d','#b08358','#699f84','#e4d7aa'][rank]
 b=poly('42,224 100,208 211,224 158,247','#294642')+poly('63,132 124,111 184,140 192,207 148,229 75,213',c)+poly('124,111 184,140 192,207 148,229 123,175','#365e54')
 b+=poly('66,86 93,48 155,41 190,81 173,145 124,168 74,139',c)+poly('124,74 190,81 173,145 124,168','#60866b')
 b+=poly('81,98 111,105 103,116 83,112',GOLD)+poly('144,106 171,98 168,115 147,116',GOLD)+poly('109,127 142,127 127,145',INK)
 if rank==0:b+=poly('67,95 51,34 94,57',c)+poly('151,49 195,24 187,91',c)
 else:
  for sign in [-1,1]:
   b+=f'<g transform="translate(128 0) scale({sign} 1)">'+poly('33,63 57,34 54,8 70,30 95,13 87,45 49,80',GOLD)+'</g>'
 if rank==3:b+=gem(129,76,23,JADE)+poly('87,169 126,188 169,166 157,209 127,231 99,206',GOLD)+gem(128,200,16,LIGHT)
 return b
for i,n in enumerate(['苔原獵犬','角木小王','古樹次王','白鹿大王']):save('monster-'+str(i),n,'敵人圖鑑',creature(i))

def forest(town=False):
 b=rect(0,0,1600,900,'#accdbb')+poly('0,300 220,87 443,302 646,133 919,328 1183,92 1434,288 1600,133 1600,700 0,700','#729b89')+poly('0,356 267,205 535,398 886,238 1173,352 1494,243 1600,289 1600,900 0,900','#507e6b')
 b+=poly('0,487 398,371 800,477 1157,336 1600,459 1600,900 0,900','#7d9e74')
 b+=poly('0,804 259,623 549,610 724,491 1072,560 1278,430 1600,498 1600,643 1225,547 1103,675 799,624 634,735 333,729 86,900 0,900','#93c7b5')
 b+=poly('247,579 788,332 1388,566 869,823','#a5b78a')+poly('247,579 788,332 869,823','#b9bd8b')+poly('869,823 1388,566 1227,817 895,900','#73956c')
 r=random.Random(25)
 for i in range(65):
  x=r.randrange(-60,1650);y=r.randrange(280,1010)
  if 260<x<1350 and 410<y<820:continue
  b+=tree(x,y,r.uniform(1.1,2.9),['#619471','#9bb786','#487b64'][i%3])
 for x,y in [(410,630),(1088,687),(583,742),(1089,400)]:b+=poly(f'{x},{y} {x+45},{y-18} {x+73},{y+12} {x+20},{y+25}','#7c907b')
 if town:
  for k,x,y,s in [('keep',620,280,1.4),('barracks',385,464,.95),('forge',835,470,.95),('alchemy',577,575,.83),('market',1030,540,.88)]:b+=f'<g transform="translate({x} {y}) scale({s})">{building(k)}</g>'
 return b
save('scene-forest','森林戰場底圖','場景',forest(),1600,900,'戰場設計稿；實際 3D 場景沿用既有模型')
save('scene-town','森林領地','場景',forest(True),1600,900,'城鎮與主選單背景')
save('ui-panel','切角面板','介面元件',poly('16,0 600,0 624,24 624,300 606,320 0,320 0,18',INK)+poly('16,4 596,4 615,23 25,23',GOLD)+line(1,40,1,300,GOLD,3)+line(25,318,600,318,'#49615a',2),624,320)
save('ui-button','主要按鈕','介面元件',poly('14,0 306,0 320,14 306,64 0,64 0,14',GOLD)+poly('14,5 299,5 306,12 8,12',LIGHT)+poly('0,56 306,56 306,64 0,64','#b5793e'),320,64)
save('ui-card','選擇卡框','介面元件',poly('18,0 280,0 300,20 300,428 282,450 0,450 0,20',INK)+line(17,5,279,5,GOLD,5)+line(2,25,2,425,'#557a6b',3)+line(20,444,281,444,GOLD,3)+gem(150,425,9),300,450)

# Font outlines make award lettering portable: no runtime font downloads.
class PolygonPen(BasePen):
 def __init__(self,gs):super().__init__(gs);self.paths=[];self.current=[]
 def _moveTo(self,p):self.current=[p]
 def _lineTo(self,p):self.current.append(p)
 def _curveToOne(self,a,b,c):
  p=self.current[-1]
  for j in range(1,9):
   t=j/8;u=1-t;self.current.append((u*u*u*p[0]+3*u*u*t*a[0]+3*u*t*t*b[0]+t*t*t*c[0],u*u*u*p[1]+3*u*u*t*a[1]+3*u*t*t*b[1]+t*t*t*c[1]))
 def _qCurveToOne(self,a,b):
  p=self.current[-1]
  for j in range(1,7):
   t=j/6;u=1-t;self.current.append((u*u*p[0]+2*u*t*a[0]+t*t*b[0],u*u*p[1]+2*u*t*a[1]+t*t*b[1]))
 def _closePath(self):self.paths.append(self.current);self.current=[]
 def _endPath(self):self._closePath()
font=TTFont('C:/Windows/Fonts/arialbd.ttf');gs=font.getGlyphSet();cmap=font.getBestCmap()
def color(c):return [int(c[i:i+2],16)/255 for i in [1,3,5]]+[1]
def value(k):return {'a':0,'k':k}
def keys(points):
 return {'a':1,'k':[dict(t=t,s=s if isinstance(s,list) else [s],**({'e':points[i+1][1] if isinstance(points[i+1][1],list) else [points[i+1][1]],'o':{'x':.2,'y':0},'i':{'x':.8,'y':1}} if i<len(points)-1 else {}))for i,(t,s)in enumerate(points)]}
def shape(vertices):return {'ty':'sh','ks':value({'i':[[0,0]]*len(vertices),'o':[[0,0]]*len(vertices),'v':vertices,'c':True}),'nm':'polygon'}
def fill(c):return {'ty':'fl','c':value(color(c)),'o':value(100),'r':1}
def layer(name,shapes,p=[480,270,0],scale=None,opacity=None,rotation=None):
 return {'ty':4,'nm':name,'sr':1,'ip':0,'op':120,'st':0,'ks':{'o':opacity or value(100),'r':rotation or value(0),'p':p if isinstance(p,dict)else value(p),'a':value([0,0,0]),'s':scale or value([100,100,100])},'shapes':shapes,'ao':0}
def lettering(text):
 paths=[];x=0;size=76/font['head'].unitsPerEm
 for ch in text:
  glyph=gs[cmap[ord(ch)]];pen=PolygonPen(gs);glyph.draw(pen)
  for contour in pen.paths:paths.append([[round((xx+x)*size,3),round(-yy*size,3)]for xx,yy in contour])
  x+=glyph.width
 width=x*size
 return [shape([[xx-width/2,yy]for xx,yy in p])for p in paths]
for idx,(id,title,accent,count) in enumerate([('big-win','BIG WIN',GOLD,22),('mega-win','MEGA WIN',JADE,40),('legendary-win','LEGENDARY WIN','#f5d891',64),('coin-burst','',GOLD,16)]):
 layers=[];fade=keys([(0,0),(5,100),(94,100),(120,0)])
 if title:
  layers.append(layer('Award lettering',lettering(title)+[fill(LIGHT)],p=[480,300,0],scale=keys([(0,[30,30,100]),(12,[109,109,100]),(20,[100,100,100]),(100,[100,100,100]),(120,[110,110,100])]),opacity=fade))
  layers.append(layer('Faceted dark banner',[shape([[-418,-53],[-390,-79],[389,-79],[418,-51],[395,56],[-395,56]]),fill(INK)],scale=keys([(0,[0,70,100]),(10,[100,100,100])]),opacity=fade))
  layers.append(layer('Gold lower slash',[shape([[-380,65],[400,65],[370,76],[-400,76]]),fill(accent)],opacity=fade))
  layers.append(layer('Crown',[shape([[-57,0],[-64,-49],[-29,-24],[0,-72],[29,-24],[64,-49],[57,0]]),fill(accent)],p=[480,175,0],opacity=fade,scale=keys([(0,[0,0,100]),(16,[115,115,100]),(25,[100,100,100])])))
 r=random.Random(14)
 for n in range(count):
  a=n*2.39996;distance=r.uniform(130,390);x=480+math.cos(a)*distance;y=270+math.sin(a)*distance*.53;delay=n%9
  verts=[[math.cos(j*math.pi/4)*11,math.sin(j*math.pi/4)*11]for j in range(8)]
  layers.append(layer(f'Coin {n+1}',[shape(verts),fill(accent),shape([[-2,-6],[3,-6],[3,6],[-2,6]]),fill(LIGHT)],p=keys([(delay,[480,280,0]),(delay+19,[x,y-80,0]),(delay+36,[x,y+65,0]),(65+delay,[x,y+65,0]),(96+delay,[840,480,0])]),opacity=keys([(delay,0),(delay+3,100),(92+delay,100),(99+delay,0)]),rotation=keys([(0,0),(110,600+n*13)])))
 for n in range(12+idx*4):
  a=n*2.39996;r1=90;r2=220+n%4*30
  verts=[[math.cos(a)*r1,math.sin(a)*r1],[math.cos(a-.045)*r2,math.sin(a-.045)*r2],[math.cos(a+.045)*r2,math.sin(a+.045)*r2]]
  layers.append(layer('Radial shard '+str(n),[shape(verts),fill(accent)],scale=keys([(0,[5,5,100]),(15,[135,135,100]),(60,[170,170,100])]),opacity=keys([(0,0),(8,70),(60,0)])))
 data={'v':'5.13.0','fr':30,'ip':0,'op':120,'w':960,'h':540,'nm':title or 'Coin burst • scatter, rest, collect','ddd':0,'assets':[],'layers':layers,'markers':[{'tm':0,'cm':'burst','dr':0},{'tm':36,'cm':'coins_land','dr':0},{'tm':65,'cm':'collect','dr':0},{'tm':120,'cm':'complete','dr':0}]}
 (ROOT/'animations'/f'{id}.json').write_text(json.dumps(data,separators=(',',':')),encoding='utf-8')
 assets.append(dict(id=id,name=title or '金幣噴灑與回收',group='獲獎動畫',path=f'animations/{id}.json',format='Lottie',width=960,height=540,frames=120,fps=30,usage='UI overlay; payout comes from game event only',status='ready'))
(ROOT/'manifest.json').write_text(json.dumps({'version':1,'style':'faceted-vector-forest','assets':assets},ensure_ascii=False,indent=2),encoding='utf-8')
print(f'Generated {len(assets)} assets: {len(assets)-4} SVG + 4 Lottie')

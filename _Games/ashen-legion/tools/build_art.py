"""Original flat shaded low-poly meshes. No downloaded model dependencies."""
from pathlib import Path
import json, math, random
from PIL import Image
ROOT=Path(__file__).resolve().parents[1]; OUT=ROOT/'assets'
COLORS=[]
def color(rgb):
    rgb=tuple(max(0,min(255,round(x))) for x in rgb)
    if rgb not in COLORS: COLORS.append(rgb)
    return COLORS.index(rgb)
class Mesh:
    def __init__(self): self.p=[]; self.faces=[]
    def tri(self,a,b,c,rgb):
        u=[b[i]-a[i] for i in range(3)];v=[c[i]-a[i] for i in range(3)]
        n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]]
        d=math.sqrt(sum(x*x for x in n)) or 1
        light=.68+.32*abs((n[0]*-.4+n[1]*.85+n[2]*.3)/d)
        self.faces.append(color([x*light for x in rgb]));self.p.extend([*a,*b,*c])
    def quad(self,a,b,c,d,col): self.tri(a,b,c,col);self.tri(a,c,d,col)
    def box(self,x,y,z,w,h,d,col):
        p=[(x+sx*w/2,y+sy*h/2,z+sz*d/2) for sx,sy,sz in [(-1,-1,-1),(1,-1,-1),(1,1,-1),(-1,1,-1),(-1,-1,1),(1,-1,1),(1,1,1),(-1,1,1)]]
        for a,b,c,d in [(0,3,2,1),(4,5,6,7),(0,4,7,3),(1,2,6,5),(3,7,6,2),(0,1,5,4)]:self.quad(p[a],p[b],p[c],p[d],col)
    def cone(self,x,y,z,r,h,col,n=6,top=0):
        for i in range(n):
            a=i*math.tau/n;b=(i+1)*math.tau/n
            p=(x+r*math.cos(a),y,z+r*math.sin(a));q=(x+r*math.cos(b),y,z+r*math.sin(b))
            t=(x+top*math.cos(a),y+h,z+top*math.sin(a));s=(x+top*math.cos(b),y+h,z+top*math.sin(b))
            self.quad(p,t,s,q,col);self.tri((x,y+h,z),t,s,col)
    def beam(self,a,b,r,col,n=5):
        delta=[b[i]-a[i] for i in range(3)];length=math.sqrt(sum(x*x for x in delta));axis=[x/length for x in delta]
        ref=[0,1,0] if abs(axis[1])<.95 else [1,0,0]
        u=[axis[1]*ref[2]-axis[2]*ref[1],axis[2]*ref[0]-axis[0]*ref[2],axis[0]*ref[1]-axis[1]*ref[0]];mag=math.sqrt(sum(x*x for x in u));u=[x/mag for x in u]
        v=[axis[1]*u[2]-axis[2]*u[1],axis[2]*u[0]-axis[0]*u[2],axis[0]*u[1]-axis[1]*u[0]]
        def pt(p,t):return tuple(p[j]+r*(u[j]*math.cos(t)+v[j]*math.sin(t)) for j in range(3))
        for i in range(n):self.quad(pt(a,i*math.tau/n),pt(b,i*math.tau/n),pt(b,(i+1)*math.tau/n),pt(a,(i+1)*math.tau/n),col)
    def ring(self,x,y,z,r,width,col,n=64):
        for i in range(n):
            a=i*math.tau/n;b=(i+1)*math.tau/n
            self.quad((x+r*math.cos(a),y,z+r*math.sin(a)),(x+r*math.cos(b),y,z+r*math.sin(b)),(x+(r-width)*math.cos(b),y,z+(r-width)*math.sin(b)),(x+(r-width)*math.cos(a),y,z+(r-width)*math.sin(a)),col)
    def save(self,name): MESHES[name]=self
MESHES={};gold=(209,163,76);red=(165,39,48);steel=(129,175,173);dark=(33,43,46);bone=(206,209,180);jade=(71,217,175)
def soldier(m,kind,offset=0):
    y=offset
    for x in [-.19,.19]:
        m.beam((x,y+.2,0),(x,y+.77,.05),.13,dark);m.box(x,y+.14,.13,.27,.23,.42,gold)
    m.cone(0,y+.72,0,.4,.34,red,6,.24);m.cone(0,y+1.02,0,.28,.5,dark,6,.43)
    m.box(0,y+1.26,.25,.36,.26,.11,gold)
    for x in [-.46,.46]:
        m.cone(x,y+1.33,0,.24,.21,gold,5,.12);m.beam((x,y+1.32,0),(x,y+.93,.27),.11,dark)
    m.cone(0,y+1.55,0,.26,.4,gold,6,.18);m.box(0,y+1.75,.22,.35,.1,.09,dark)
    m.box(0,y+2.02,-.03,.1,.3,.53,red)
    m.quad((-.34,y+1.48,-.2),(.34,y+1.48,-.2),(.52,y+.35,-.55),(-.52,y+.35,-.55),red)
    if kind=='sword':
        m.box(.54,y+1.0,.56,.13,.12,.85,steel);m.box(.54,y+1,.3,.41,.1,.12,gold)
        m.cone(-.5,y+.86,.28,.37,.13,gold,8,.37);m.box(-.5,y+1.12,.29,.54,.61,.15,gold);m.box(-.5,y+1.12,.38,.12,.46,.04,red)
    else:
        m.beam((.55,y+.92,-.6),(.55,y+1.12,1.7),.045,gold)
        m.tri((.4,y+1.12,1.5),(.7,y+1.12,1.5),(.55,y+1.16,2.2),steel)
for kind in ['sword','spear','cavalry']:
    m=Mesh()
    if kind=='cavalry':
        m.box(0,1.03,0,.7,.7,1.35,dark)
        for x in [-.27,.27]:
            for z in [-.48,.48]:m.beam((x,.12,z+.08),(x,.98,z),.115,steel);m.box(x,.13,z+.13,.24,.23,.32,gold)
        m.beam((0,1.02,.5),(0,1.83,.74),.24,dark);m.box(0,1.85,.93,.38,.43,.6,gold)
        m.cone(-.17,2.01,.78,.12,.35,dark);m.cone(.17,2.01,.78,.12,.35,dark)
        m.beam((0,1.2,-.7),(0,.6,-1.08),.13,red);m.box(0,1.42,-.1,.95,.1,.8,red)
        soldier(m,'spear',.85)
    else:soldier(m,kind)
    m.save(kind)
for kind in ['hound','wraith','minotaur','lord']:
    m=Mesh()
    if kind=='hound':
        m.box(0,.55,0,.5,.48,.8,(79,101,100));m.cone(0,.5,.56,.32,.4,bone,5,.2)
        for x in [-.22,.22]:
            for z in [-.3,.3]:m.beam((x,0,z+.12),(x,.56,z),.075,bone)
        m.box(0,.71,.76,.3,.08,.08,red)
        for z in [-.3,0,.3]:m.cone(0,.74,z,.12,.29,bone)
    elif kind=='wraith':
        m.cone(0,.4,0,.6,1.1,(42,95,89),6,.2);m.cone(0,1.45,0,.25,.4,bone,5,.1)
        for s in [-1,1]:m.tri((0,1.3,0),(s*1.0,.72,-.1),(s*.7,1.55,.1),jade)
        m.box(0,1.64,.21,.29,.08,.05,jade)
    else:
        c=red if kind=='lord' else (103,86,125)
        for x in [-.3,.3]:m.beam((x,.18,.12),(x,.85,0),.2,dark);m.cone(x,.85,0,.26,.27,gold)
        m.cone(0,.82,0,.42,.8,c,6,.65);m.cone(0,1.65,0,.32,.55,dark,6,.21)
        for s in [-1,1]:
            m.beam((s*.58,1.48,0),(s*.8,.85,.15),.23,c)
            m.beam((s*.2,1.95,0),(s*.52,2.27,0),.12,gold);m.cone(s*.52,2.24,0,.13,.45,gold)
            m.cone(s*.6,1.62,0,.25,.38,gold)
        m.box(0,1.92,.29,.38,.1,.07,jade)
        m.beam((.8,.5,.2),(.8,2.5,.2),.06,gold);m.box(.8,2.23,.2,.74,.42,.16,steel)
        if kind=='lord':
            for s in [-1,1]:m.tri((s*.4,1.6,-.15),(s*1.5,2.4,-.4),(s*1.1,.4,-.5),red)
            m.cone(0,2.11,0,.34,.5,gold,5,.1)
    m.save(kind)
m=Mesh();m.ring(0,.05,0,1,.12,jade,32);m.save('impact')
m=Mesh();m.ring(0,.025,0,1,.08,gold,40);m.save('target')
m=Mesh();m.cone(0,.07,0,.12,.19,gold,5,.06);m.save('trail')
m=Mesh();m.cone(0,0,0,1,.23,(255,220,80),12,1);m.ring(0,.24,0,.8,.13,(255,250,168),12);m.box(0,.26,0,.18,.05,1.1,(255,250,190));m.save('coin')
for name,col in [('spark_gold',(255,241,160)),('spark_jade',(134,255,225)),('spark_red',(255,116,73))]:
    m=Mesh();m.cone(0,-.5,0,.4,.8,col,4);m.cone(0,.3,0,.25,.5,col,4);m.save(name)
from forest_art import build_forest
m,cannon=build_forest(Mesh);m.save('arena');cannon.save('cannon')
width=max(2048,2**math.ceil(math.log2(max(1,len(COLORS)))))
if len(COLORS)>width:raise ValueError('palette full')
im=Image.new('RGB',(width,4));pix=im.load()
for i,c in enumerate(COLORS):
    for y in range(4):pix[i,y]=c
im.save(OUT/'palette.png')
assets=[{'id':'texture://palette','kind':'texture2d','source':'assets/palette.png'}]
for name,m in MESHES.items():
    uvs=[]
    for c in m.faces:uvs.extend([(c+.5)/width,.5]*3)
    data={'version':1,'positions':[round(x,5) for x in m.p],'uvs':uvs,'indices':list(range(len(m.p)//3)),'texture':'texture://palette'}
    (OUT/f'{name}.mesh.json').write_text(json.dumps(data,separators=(',',':')))
    assets.append({'id':f'mesh://{name}','kind':'mesh3d','source':f'assets/{name}.mesh.json','encoding':{'mime':'application/json','companions':[],'decoder':'mesh','format':'unone-mesh-json'}})
previous=json.loads((ROOT/'assets.json').read_text()).get('assets',[]) if (ROOT/'assets.json').exists() else []
ids={a['id'] for a in assets}
assets.extend(a for a in previous if a['id'] not in ids)
(ROOT/'assets.json').write_text(json.dumps({'assets':assets},indent=2))
print(f'Generated {len(MESHES)} original meshes, {len(COLORS)} palette colors')

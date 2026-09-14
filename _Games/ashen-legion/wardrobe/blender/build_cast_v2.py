"""Species-specific low-poly silhouettes, painted atlas and authored animation.
Run with Blender 5.1 --background --python. Versioned assets preserve v1.
"""
import bpy, math, json, sys
from pathlib import Path
from mathutils import Vector
sys.path.insert(0,str(Path(__file__).parent))
from art_v2_common import Author,coord,paint_atlas
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'assets/creatures/art-v2';OUT.mkdir(parents=True,exist_ok=True)
ATLAS=paint_atlas(OUT/'painted-atlas.png')
CAST=[('acorn','橡果蹦蹦',1),('piglet','菇背幼豬',2),('moth','苔羽蛾',1),('turtle','苔殼龜',2),('boar','獠牙搬木王',3),('elder','古榕守衛',4),('treant','花冠樹靈',3),('stag','冠角白鹿',5),('beetle','聚寶甲蟲',4),('wheel','金鈴狸',3),('horse','林地戰馬',0)]
def build(kind,label,rank):
 bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
 a=Author(ATLAS);ell,box,beam,cone,leaf=a.ell,a.box,a.beam,a.cone,a.leaf
 bones={'body':(0,.6,0),'head':(0,1,.35),'tail':(0,.6,-.4),'wing-1':(-.3,.8,0),'wing1':(.3,.8,0)}
 def legs(xs=.32,front=.4,back=-.4,top=.62,foot=.13,r=.13,color='bark',hoof='leather',biped=False):
  for i,(x,z) in enumerate(([(-xs,front),(xs,front)] if biped else [(-xs,front),(xs,front),(-xs,back),(xs,back)])):
   bones['leg'+str(i)]=(x,top,z);beam('Tapered leg',(x,top,z),(x,foot,z+.04),r,color,'leg'+str(i),end=r*.7);box('Broad foot',(x,.1,z+.1),(r*1.9,.18,r*2.5),hoof,'leg'+str(i),bevel=.035)
 def face(cx,y,z,w=.08,angry=False):a.eyes(cx,y,z,w,angry=angry)
 if kind=='acorn':
  bones['head']=(0,.76,0);ell('Acorn seed',(0,.66,0),(.43,.55,.36),'wood','head',segments=10,rings=6)
  cone('Acorn cup',(0,1.02,0),.49,.36,.30,'bark','head',vertices=10);cone('Cap gold rim',(0,.90,0),.49,.47,.09,'bronze','head',vertices=10)
  beam('Little stem',(0,1.13,0),(.09,1.38,0),.055,'bark','head');leaf('Single sprouting leaf',(.06,1.24,0),(.3,.3,.04),'lime','head',angle=-.8)
  face(.16,.65,.337,.065)
  for side in [-1,1]:
   beam('Twig arm',(side*.35,.64,0),(side*.54,.40,.08),.045,'bark');ell('Mittens',(side*.53,.4,.08),(.08,.085,.065),'wood')
  legs(xs=.18,front=.02,back=-.04,top=.28,r=.075,hoof='bark',biped=True)
 elif kind in ['piglet','boar']:
  big=kind=='boar';c='bark' if big else 'pink';bones['head']=(0,.87,.52)
  ell('Heavy haunches',(0,.73,-.10),(.64 if big else .53,.51,.78 if big else .63),c,segments=10)
  box('Wedge head',(0,.93,.56),(.99 if big else .83,.82,.69),c,'head',bevel=.14)
  box('Soft snout',(0,.72,1.0),(.60 if big else .49,.34,.27),'rust' if big else 'blush','head',bevel=.08)
  for side in [-1,1]:
   ell('Nostril',(side*.13,.73,1.136),(.05,.035,.012),'bark','head',segments=6,rings=4)
   leaf('Large floppy ear',(side*.34,1.18,.47),(.36,.42,.09),c,'head',angle=-side*.52)
   leaf('Ear inset',(side*.35,1.22,.52),(.19,.26,.025),'pink','head',angle=-side*.52)
   if big:
    beam('Ivory tusk root',(side*.36,.65,.94),(side*.49,.72,1.10),.115,'cream','head',end=.085)
    beam('Curved tusk tip',(side*.49,.72,1.10),(side*.43,1.02,1.12),.085,'white','head',end=.006)
  face(.28,1.01,.894,.074,big);legs(xs=.39 if big else .31,front=.36,back=-.55,top=.58,r=.15 if big else .115,color=c)
  if big:
   for j in range(5):leaf('Bristle mane',(0,1.13,-.57+j*.24),(.2,.33,.07),'wood',angle=.1)
   box('Harness strap',(0,.97,-.13),(1.24,.17,.16),'teal',bevel=.04)
  else:
   for x,z,s in [(-.27,-.19,.30),(.24,-.38,.22)]:
    beam('Mushroom stalk',(x,1.02,z),(x,1.37,z),.09,'cream');ell('Mushroom cap',(x,1.36,z),(s,.17,s),'coral',segments=10,rings=6);ell('Cream cap spot',(x-.06,1.50,z+.015),(.07,.025,.05),'cream')
 elif kind=='turtle':
  bones['head']=(0,.43,.58);ell('Low belly',(0,.34,0),(.70,.28,.75),'cream')
  ell('Broad shell',(0,.66,-.06),(.82,.5,.83),'teal',segments=10,rings=6);ell('Ivory shell lip',(0,.42,-.04),(.85,.10,.85),'gold_hi',segments=10)
  ell('Moss island',(0,1.08,-.1),(.4,.11,.43),'lime',segments=8,rings=4)
  for x,z in [(-.39,.18),(.39,.18),(-.28,-.42),(.28,-.42)]:ell('Shell scute',(x,.91,z),(.22,.13,.25),'jade',segments=6,rings=4)
  box('Turtle head',(0,.50,.73),(.57,.45,.54),'jade','head',bevel=.11);face(.15,.52,1.00,.061)
  legs(xs=.59,front=.41,back=-.43,top=.31,r=.16,color='jade',hoof='teal')
  leaf('Shell fern',(-.14,1.12,-.1),(.24,.30,.05),'leaf',angle=.5)
 elif kind=='beetle':
  bones['body']=(0,.51,0);bones['head']=(0,.5,.61)
  ell('Dark abdomen',(0,.46,-.1),(.62,.35,.90),'deep',segments=12)
  for side in [-1,1]:
   ell('Jade wing case',(side*.31,.72,-.17),(.40,.45,.85),'teal',segments=10)
   beam('Gold wing seam',(side*.035,.98,.48),(side*.035,1.11,-.54),.035,'gold')
   for j,z in enumerate([.5,0,-.52]):
    name='leg'+str(0 if side<0 else 1) if j<2 else 'leg'+str(2 if side<0 else 3);bones[name]=(side*.43,.46,z)
    beam('Six articulated legs',(side*.43,.46,z),(side*.86,.25,z+.10),.08,'bronze',name,end=.06);beam('Leg claw',(side*.86,.25,z+.10),(side*.92,.07,z+.30),.06,'ink',name,end=.025)
  box('Beetle mask',(0,.60,.76),(.78,.54,.47),'gold','head',bevel=.13);face(.20,.64,1.006,.075)
  for side in [-1,1]:beam('Short feeler',(side*.26,.79,.80),(side*.40,1.13,.94),.038,'bronze','head',end=.025);ell('Amber feeler',(side*.40,1.13,.94),(.075,.09,.06),'gold_hi','head',segments=6,rings=4)
  cone('Gem socket',(0,1.10,-.20),.26,.24,.07,'gold',vertices=8)
  a.mesh('Treasure crystal',[(-.17,1.13,-.33),(.17,1.13,-.33),(.17,1.13,-.07),(-.17,1.13,-.07),(0,1.47,-.20)],[(0,1,4),(1,2,4),(2,3,4),(3,0,4)],'coral')
 elif kind=='moth':
  bones['body']=(0,.83,0);bones['head']=(0,1.10,.07)
  ell('Velvet thorax',(0,.84,0),(.22,.42,.24),'navy');ell('Furry collar',(0,1.06,.02),(.34,.20,.28),'cream')
  ell('Moth head',(0,1.22,.09),(.29,.26,.24),'teal','head');face(.13,1.24,.301,.085)
  for side in [-1,1]:
   bone='wing'+str(side);bones[bone]=(side*.18,.91,0)
   a.mesh('Large graphic upper wing',[(side*.16,.95,0),(side*.66,1.63,-.03),(side*1.25,1.45,-.03),(side*1.1,.78,.01),(side*.45,.64,.04),(side*.65,1.06,.15)],[(0,1,5),(1,2,5),(2,3,5),(3,4,5),(4,0,5)],'lilac',bone)
   a.mesh('Lower scalloped wing',[(side*.17,.87,.01),(side*.82,.77,.04),(side*.82,.31,.02),(side*.45,.39,.04)],[(0,1,2),(0,2,3)],'purple',bone)
   ell('Wing moon',(side*.80,1.10,.09),(.24,.28,.035),'cream',bone,segments=10);ell('Wing eyespot',(side*.80,1.10,.13),(.13,.18,.015),'teal',bone,segments=8)
   beam('Soft antenna',(side*.1,1.39,.06),(side*.27,1.70,.08),.027,'gold','head');ell('Antenna pearl',(side*.27,1.70,.08),(.045,.06,.03),'gold_hi','head',segments=6)
  legs(xs=.12,front=.08,back=-.10,top=.55,r=.035,color='navy',hoof='navy')
 elif kind in ['elder','treant']:
  ancient=kind=='elder';bones['head']=(0,1.46,.03)
  cone('Tapered tree trunk',(0,.93,0),.52,.68,1.30,'bark' if ancient else 'teal',vertices=8,depth=.78)
  box('Carved face',(0,1.39,.23),(1.05,.77,.75),'wood' if ancient else 'jade','head',bevel=.10)
  face(.25,1.48,.637,.082,ancient)
  box('Quiet mouth',(0,1.18,.644),(.25,.055,.019),'bark','head',bevel=.015)
  a.mesh('Carved timber nose',[(-.075,1.50,.62),(.075,1.50,.62),(-.085,1.28,.75),(.085,1.28,.75)],[(0,1,3,2)],'bark' if ancient else 'teal','head')
  for side in [-1,1]:
   armBone='wing'+str(side);bones[armBone]=(side*.52,1.18,0)
   beam('Large branch arm',(side*.52,1.18,0),(side*.91,.73,.07),.22,'bark' if ancient else 'teal',armBone,end=.16)
   ell('Root fist',(side*.93,.59,.15),(.25,.30,.24),'wood' if ancient else 'jade',armBone,segments=8)
   for j in range(2):beam('Root fingers',(side*(.86+j*.10),.54,.22),(side*(.86+j*.13),.31,.29),.065,'bark',armBone,end=.025)
   beam('Branch crown',(side*.33,1.64,0),(side*.70,2.11,-.04),.12,'wood','head',end=.07)
   beam('Branch fork',(side*.63,2.04,-.04),(side*.98,2.24,-.08),.07,'wood','head',end=.02)
  legs(xs=.33,front=.08,back=-.15,top=.44,r=.19,color='bark',hoof='wood',biped=True)
  for j,(x,y,z,s) in enumerate([(-.61,2.02,-.03,.49),(.51,2.15,-.14,.57),(0,2.04,.03,.58),(-.11,2.39,-.11,.44)]):
   ell('Designed canopy cluster',(x,y,z),(s,.30,s*.65),'leaf' if j%2==0 else 'lime','head',segments=8,rings=4)
  if ancient:
   for x,y,z in [(-.35,.98,.41),(.26,.68,.37)]:leaf('Amber sap scar',(x,y,z),(.18,.28,.02),'gold')
   for side in [-1,1]:ell('Moss shoulder',(side*.59,1.37,0),(.30,.16,.32),'lime',segments=8,rings=4)
  else:
   for side in [-1,0,1]:
    for j in range(5):ell('Flower petal',(side*.36+math.sin(j*math.tau/5)*.14,2.23+math.cos(j*math.tau/5)*.14,.29),(.12,.12,.04),'petal','head',segments=6,rings=4)
    ell('Flower heart',(side*.36,2.23,.35),(.07,.07,.025),'gold','head',segments=6,rings=4)
 elif kind in ['stag','horse']:
  stag=kind=='stag';color='cream' if stag else 'horse'
  ell('Equine barrel',(0,.81,-.16),(.43,.43,.80),color,segments=10)
  beam('Proud neck',(0,.91,.34),(0,1.49,.57),.27,color,end=.22,vertices=8);bones['head']=(0,1.49,.56)
  box('Noble angular head',(0,1.59,.73),(.48,.59,.72),color,'head',bevel=.12);box('Rounded muzzle',(0,1.39,1.02),(.46,.30,.34),'white' if stag else 'cream','head',bevel=.10)
  for side in [-1,1]:
   ell('Side eye',(side*.205,1.64,1.035),(.027,.053,.061),'ink','head',segments=8,rings=4)
   ell('Eye glint',(side*.213,1.658,1.067),(.011,.014,.013),'white','head',segments=6,rings=4)
   leaf('Ears',(side*.20,1.83,.55),(.22,.40,.075),color,'head',angle=-side*.35)
   leaf('Ear velvet',(side*.21,1.87,.60),(.12,.25,.019),'pink','head',angle=-side*.35)
  legs(xs=.28,front=.41,back=-.68,top=.73,r=.09 if stag else .105,color=color,hoof='gold' if stag else 'leather')
  bones['tail']=(0,.89,-.8);beam('Tail',(0,.88,-.83),(0,.31,-1.08),.11,'white' if stag else 'navy','tail',end=.05)
  if stag:
   for side in [-1,1]:
    pts=[(side*.21,1.88,.50),(side*.42,2.22,.35),(side*.77,2.47,.28),(side*.97,2.81,.22)]
    for j in range(3):beam('Sweeping crown antler',pts[j],pts[j+1],.075-j*.018,'gold','head',end=.058-j*.023)
    beam('Inner crown prong',pts[1],(side*.35,2.68,.3),.052,'gold_hi','head',end=.008)
    beam('Outer crown prong',pts[2],(side*1.14,2.57,.32),.04,'gold_hi','head',end=.008)
   cone('Royal gorget',(0,1.11,.36),.33,.26,.15,'gold',depth=.8)
   a.mesh('Forest jewel',[(-.11,1.15,.61),(.11,1.15,.61),(0,.88,.69),(0,1.16,.74)],[(0,1,3),(1,2,3),(2,0,3)],'teal')
  else:
   for j in range(4):leaf('Sculpted mane',(0,1.15+j*.15,.21+j*.06),(.16,.25,.10),'navy')
   box('Red saddle blanket',(0,1.06,-.2),(.91,.16,.78),'red',bevel=.055);box('Leather saddle',(0,1.18,-.2),(.55,.12,.51),'leather',bevel=.04)
   for side in [-1,1]:beam('Gold bridle',(side*.248,1.77,.64),(side*.248,1.27,1.10),.021,'gold','head')
 elif kind=='wheel':
  bones['head']=(0,1.1,.27);ell('Round raccoon body',(0,.67,-.04),(.43,.52,.37),'rust');ell('Cream bib',(0,.72,.29),(.28,.32,.08),'cream')
  box('Mischievous head',(0,1.21,.27),(.81,.62,.55),'horse','head',bevel=.12)
  for side in [-1,1]:
   leaf('Raccoon ear',(side*.26,1.45,.17),(.29,.31,.06),'bark','head',angle=-side*.3)
   ell('Eye mask',(side*.20,1.24,.533),(.18,.15,.025),'navy','head',segments=8);ell('Bright eye',(side*.20,1.25,.56),(.047,.059,.012),'gold_hi','head',segments=8)
  ell('Muzzle',(0,1.09,.59),(.21,.12,.11),'cream','head');ell('Little nose',(0,1.14,.694),(.064,.04,.02),'ink','head',segments=6)
  legs(xs=.25,front=.10,back=-.18,top=.35,r=.095,color='rust',biped=True)
  for j in range(5):ell('Banded curled tail',(.12+j*.12,.55+j*.12,-.5-j*.13),(.22,.21,.23),'cream' if j%2 else 'navy','tail',segments=8)
  cone('Bell collar',(0,.97,.1),.37,.33,.08,'teal');ell('Golden bell',(0,.88,.435),(.16,.17,.12),'gold');box('Bell slit',(0,.85,.55),(.13,.025,.015),'bark',bevel=0)
 # Common names preserve existing animator/viewer contract; placement is species-specific.
 for i,p in enumerate([(-.3,.4,.2),(.3,.4,.2),(-.3,.4,-.2),(.3,.4,-.2)]):bones.setdefault('leg'+str(i),p)
 armdata=bpy.data.armatures.new(kind+'-skeleton');arm=bpy.data.objects.new(kind+'-rig',armdata);bpy.context.collection.objects.link(arm);bpy.context.view_layer.objects.active=arm;arm.select_set(True);bpy.ops.object.mode_set(mode='EDIT')
 for name,p in bones.items():
  b=armdata.edit_bones.new(name);b.head=coord(p);b.tail=coord((p[0],p[1]+.2,p[2]));
  if name!='body':b.parent=armdata.edit_bones['body']
 bpy.ops.object.mode_set(mode='OBJECT');skins=a.bind(arm)
 arm.animation_data_create();scene=bpy.context.scene;scene.render.fps=30
 states=[('idle',2.4),('walk',1.2),('attack',.8),('hit',.3),('death',.8),('spawn',.7),('stretch',2),('run',.7)]
 for state,duration in states:
  action=bpy.data.actions.new(state);arm.animation_data.action=action;end=round(duration*30)
  for f in sorted(set([*range(0,end+1,2),end])):
   t=f/end;wave=math.sin(t*math.tau)
   for b in arm.pose.bones:
    b.rotation_mode='XYZ';b.rotation_euler=(0,0,0);b.location=(0,0,0);b.scale=(1,1,1)
    if b.name.startswith('leg') and state in ['walk','run']:
     amplitude=.55 if state=='run' else .30
     if kind in ['turtle','beetle']:amplitude*=.55
     i=int(b.name[-1]);b.rotation_euler.x=wave*amplitude*([1,-1,-1,1][i]);b.location.z=max(0,wave*([1,-1,-1,1][i]))*.04
    if b.name.startswith('wing') and kind=='moth':b.rotation_euler.y=math.sin(t*math.tau*2)*.40*(1 if b.name=='wing1' else -1)
    if b.name.startswith('wing') and kind in ['elder','treant']:
     b.rotation_euler.x=wave*.18*(1 if b.name=='wing1' else -1)
     if state=='attack':b.rotation_euler.x=-math.sin(t*math.pi)*.65
    if b.name=='tail':b.rotation_euler.z=wave*.16
    if b.name=='head':b.rotation_euler.x=wave*.035;b.rotation_euler.z=wave*.025
    if b.name=='body':
     b.location.z=math.sin(t*math.tau)**2*(.045 if state in ['walk','run'] else .018)
     if kind=='moth':b.location.z+=.22+wave*.10
     if state=='spawn':b.scale=(max(.02,min(1,1-(1-t)**3)),)*3
     if state=='death':b.rotation_euler.y=t*1.45;b.location.z=-t*.26
     if state=='attack':b.rotation_euler.x=math.sin(t*math.tau)*.16;b.location.y=-max(0,math.sin((t-.18)/.82*math.pi))*.16
     if state=='hit':b.location.y=math.sin(t*math.pi)*.12
     if state=='stretch':b.scale=(1,1,1+math.sin(t*math.pi)*.10)
    b.keyframe_insert('rotation_euler',frame=f);b.keyframe_insert('location',frame=f);b.keyframe_insert('scale',frame=f)
  track=arm.animation_data.nla_tracks.new();track.name=state;track.strips.new(state,1,action);arm.animation_data.action=None
 for b in arm.pose.bones:b.rotation_euler=(0,0,0);b.location=(0,0,0);b.scale=(1,1,1)
 scene.frame_set(0);bpy.ops.object.select_all(action='DESELECT');arm.select_set(True)
 for skin in skins:skin.select_set(True)
 bpy.context.view_layer.objects.active=arm
 bpy.ops.wm.save_as_mainfile(filepath=str(OUT/(kind+'.blend')))
 bpy.ops.export_scene.gltf(filepath=str(OUT/(kind+'.glb')),export_format='GLB',use_selection=True,export_animations=True,export_animation_mode='NLA_TRACKS',export_skins=True)
 triangles=sum(len(p.vertices)-2 for skin in skins for p in skin.data.polygons)
 return {'id':kind,'name':label,'rank':rank,'model':'art-v2/'+kind+'.glb','source':'art-v2/'+kind+'.blend','texture':'art-v2/painted-atlas.png','clips':[s[0] for s in states],'bones':len(bones),'triangles':triangles,'artVersion':'sculpted-storybook-v2'}
manifest=[build(*entry) for entry in CAST]
(OUT/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
print('CAST_V2',[(m['id'],m['triangles']) for m in manifest])

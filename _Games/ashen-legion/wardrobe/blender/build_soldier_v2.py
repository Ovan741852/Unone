"""Rebuild the issued knight kit on the existing 55-bone animated skeleton.
Preserves all eight animation clips and five replaceable equipment containers.
"""
import bpy,sys,json
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent))
from art_v2_common import Author,coord,game,paint_atlas
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'wardrobe/assets/art-v2';OUT.mkdir(parents=True,exist_ok=True)
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(ROOT/'presentation/soldier.glb'))
arm=next(o for o in bpy.data.objects if o.type=='ARMATURE')
for o in list(bpy.data.objects):
 if o.type=='MESH' or o.type=='EMPTY' and o!=arm and not any(child==arm for child in o.children_recursive):bpy.data.objects.remove(o,do_unlink=True)
arm.data.pose_position='REST';bpy.context.view_layer.update()
a=Author(paint_atlas(OUT/'soldier-painted.png'));box,ell,beam,cone,mesh=a.box,a.ell,a.beam,a.cone,a.mesh
def joint(name):return game(arm.matrix_world@arm.data.bones['mixamorig'+name].head_local)
head='mixamorigHead';hips='mixamorigHips';spine='mixamorigSpine1'
box('VinylHead',(0,1.135,.01),(.75,.63,.55),'skin',head,bevel=.085)
for side in [-1,1]:ell('Soft ear',(side*.382,1.15,.015),(.066,.082,.042),'skin',head,segments=8,rings=4)
mesh('Nose',[(-.035,1.19,.289),(.035,1.19,.289),(-.045,1.04,.36),(.045,1.04,.36),(-.04,1.04,.28),(.04,1.04,.28)],[(0,1,3,2),(2,3,5,4),(0,2,4),(1,5,3)],'skin',head)
box('Compact tunic',(0,.63,0),(.42,.37,.31),'cream',spine,bevel=.07)
box('Short trousers',(0,.41,0),(.32,.22,.25),'navy',hips,bevel=.04)
beam('Neck',(0,.75,0),(0,.93,0),.085,'skin','mixamorigNeck')
for side,d in [('Left',1),('Right',-1)]:
 armBone='mixamorig'+side+'Arm';foreBone='mixamorig'+side+'ForeArm';hand='mixamorig'+side+'Hand';upper='mixamorig'+side+'UpLeg';lower='mixamorig'+side+'Leg';foot='mixamorig'+side+'Foot'
 p,q,r=[joint(side+n) for n in ['Arm','ForeArm','Hand']]
 beam('Sleeve',p,q,.115,'cream',armBone,end=.1);beam('Forearm',q,r,.09,'skin',foreBone,end=.07)
 ell('Palm',(r[0]+d*.03,r[1],r[2]),(.08,.073,.075),'skin',hand,segments=8,rings=4)
 p,q,r=[joint(side+n) for n in ['UpLeg','Leg','Foot']]
 beam('Trousers',p,q,.10,'navy',upper,end=.087);beam('Calf',q,r,.08,'cream',lower,end=.065)
 box('Bare shoe',(d*.107,.065,.055),(.19,.13,.29),'leather',foot,bevel=.035)
 # Bold pauldrons, gauntlets and boots replace tiny bead-like trim.
 ell('Shoulder plate',joint(side+'Arm'),(.16,.105,.17),'steel',armBone,'body',segments=8,rings=4)
 ell('Shoulder edge',(d*.247,.708,.006),(.167,.035,.175),'gold',armBone,'body',segments=8,rings=4)
 h=joint(side+'Hand');box('Gauntlet',(h[0]+d*.025,h[1],h[2]),(.17,.17,.20),'leather',hand,'hands',bevel=.04)
 box('Gauntlet plate',(h[0],h[1]+.07,h[2]),(.17,.045,.19),'steel',hand,'hands',bevel=.016)
 box('Broad boot',(d*.107,.09,.07),(.24,.18,.36),'leather',foot,'feet',bevel=.055)
 box('Boot sole',(d*.107,.03,.07),(.25,.045,.37),'ink',foot,'feet',bevel=.012)
 box('Boot cuff',(d*.107,.205,0),(.23,.09,.22),'gold',lower,'feet',bevel=.02)
# Helmet built as intentional rings instead of stacked spheres and thin discs.
verts=[];levels=[(1.365,.412,.31),(1.51,.426,.33),(1.65,.31,.275),(1.70,.10,.14)];n=12
import math
for y,rx,rz in levels:
 for i in range(n):v=i*math.tau/n;verts.append((rx*math.sin(v),y,-.025+rz*math.cos(v)))
faces=[]
for j in range(len(levels)-1):
 for i in range(n):faces.append((j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i))
faces.append(tuple(range(3*n,4*n)));mesh('Forged helmet',verts,faces,'steel',head,'head')
for side in [-1,1]:
 box('Helmet temple',(side*.35,1.30,.055),(.16,.28,.35),'steel',head,'head',bevel=.045)
 beam('Brow rim',(side*.04,1.38,.289),(side*.32,1.38,.204),.025,'gold',head,'head',vertices=6)
box('Forehead badge',(0,1.46,.314),(.12,.15,.032),'gold',head,'head',bevel=.018)
box('Cream breastplate',(0,.64,.18),(.33,.32,.09),'edge',spine,'body',bevel=.045)
mesh('Heraldic tabard',[(-.135,.61,.235),(.135,.61,.235),(.17,.34,.175),(0,.30,.175),(-.17,.34,.175)],[(0,1,2,3,4)],'red',hips,'body')
box('Belt',(0,.45,0),(.44,.065,.35),'leather',hips,'body',bevel=.018);box('Buckle',(0,.45,.191),(.075,.077,.025),'gold',hips,'body',bevel=.01)
mesh('Breastplate sun',[(0,.76,.23),(.028,.70,.23),(.083,.68,.23),(.028,.65,.23),(0,.60,.23),(-.028,.65,.23),(-.083,.68,.23),(-.028,.70,.23)],[(0,1,2,3,4,5,6,7)],'gold',spine,'body')
h=joint('RightHand');x=h[0]-.02;y=h[1];hand='mixamorigRightHand'
beam('Sword leather grip',(x,y,-.10),(x,y,.11),.033,'leather',hand,'weapon');box('Sword guard',(x,y,.13),(.26,.065,.055),'gold',hand,'weapon',bevel=.018)
v=[(x-.095,y,.17),(x+.095,y,.17),(x+.085,y,.55),(x,y,.76),(x-.085,y,.55),(x,y+.041,.22),(x,y+.036,.54),(x,y-.035,.22),(x,y-.033,.54)]
mesh('Forged broad blade',v,[(0,1,5),(1,2,6,5),(2,3,6),(3,4,6),(4,0,5,6),(1,0,7),(2,1,7,8),(3,2,8),(4,3,8),(0,4,8,7)],'edge',hand,'weapon')
skins=a.bind(arm,slots=True);arm.data.pose_position='POSE';bpy.context.scene.frame_set(0)
bpy.ops.object.select_all(action='DESELECT');arm.select_set(True)
for skin in skins:skin.select_set(True)
bpy.context.view_layer.objects.active=arm
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'soldier.blend'))
bpy.ops.export_scene.gltf(filepath=str(ROOT/'presentation/soldier-v2.glb'),export_format='GLB',use_selection=True,export_animations=True,export_animation_mode='NLA_TRACKS',export_skins=True)
report={'bones':len(arm.data.bones),'skins':len(skins),'triangles':sum(len(p.vertices)-2 for s in skins for p in s.data.polygons),'actions':[a.name for a in bpy.data.actions],'source':'wardrobe/assets/art-v2/soldier.blend','texture':'wardrobe/assets/art-v2/soldier-painted.png'}
(OUT/'build-report.json').write_text(json.dumps(report,indent=2));print('SOLDIER_V2',report)

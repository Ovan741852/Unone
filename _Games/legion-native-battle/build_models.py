"""Bake CC0 FBX assets to Unone static meshes. Run with Blender --background --python.
Sources are downloaded separately into artifacts/legion-assets; see ASSETS.md.
The palette bakes directional shading, so this probe needs no per-unit lights.
"""
import bpy,json,math,random
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parent
SRC=ROOT.parents[1]/'artifacts/legion-assets'
OUT=ROOT/'assets';OUT.mkdir(exist_ok=True)
palette=[];color_ids={}
def color(c):
 c=tuple(round(max(0,min(1,v)),3) for v in c[:3])
 if c not in color_ids:color_ids[c]=len(palette);palette.append(c)
 return color_ids[c]
def imported(path,height,pose='Idle',frame=1):
 bpy.ops.wm.read_factory_settings(use_empty=True)
 bpy.ops.import_scene.fbx(filepath=str(path))
 for o in bpy.data.objects:
  if o.type=='ARMATURE':
   choices=[a for a in bpy.data.actions if a.name.split('|')[-1]==pose]
   if choices:
    o.animation_data_create();o.animation_data.action=choices[0]
    if choices[0].slots:o.animation_data.action_slot=choices[0].slots[0]
 bpy.context.scene.frame_set(frame);bpy.context.view_layer.update()
 result=[]
 for o in list(bpy.data.objects):
  if o.type!='MESH':continue
  # Bake the actual imported animation pose, then simplify to crowd-scale geometry.
  dg=bpy.context.evaluated_depsgraph_get();evaluated=o.evaluated_get(dg)
  mesh=bpy.data.meshes.new_from_object(evaluated)
  obj=bpy.data.objects.new('baked',mesh);bpy.context.collection.objects.link(obj);obj.matrix_world=o.matrix_world.copy()
  bpy.context.view_layer.objects.active=obj;obj.select_set(True)
  if len(mesh.polygons)>95:
   dec=obj.modifiers.new('crowd_lod','DECIMATE');dec.ratio=min(1,95/len(mesh.polygons));bpy.ops.object.modifier_apply(modifier=dec.name)
  obj.data.calc_loop_triangles()
  for tri in obj.data.loop_triangles:
   coords=[obj.matrix_world@obj.data.vertices[i].co for i in tri.vertices]
   points=[Vector((v.x,v.z,-v.y)) for v in coords]
   mat=obj.data.materials[tri.material_index] if tri.material_index<len(obj.data.materials) else None
   name=mat.name.lower() if mat else ''
   c=list(mat.diffuse_color[:3]) if mat else [.5,.5,.5]
   if mat and mat.use_nodes:
    bsdf=next((n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED'),None)
    if bsdf:c=list(bsdf.inputs['Base Color'].default_value[:3])
   result.append((points,c,name))
 lo=min(v.y for p,_,_ in result for v in p);hi=max(v.y for p,_,_ in result for v in p)
 cx=(min(v.x for p,_,_ in result for v in p)+max(v.x for p,_,_ in result for v in p))/2
 cz=(min(v.z for p,_,_ in result for v in p)+max(v.z for p,_,_ in result for v in p))/2
 scale=height/max(.001,hi-lo)
 return [([Vector(((v.x-cx)*scale,(v.y-lo)*scale,(v.z-cz)*scale)) for v in p],c,n) for p,c,n in result]
def move(mesh,x=0,y=0,z=0,scale=1,turn=0):
 co,si=math.cos(turn),math.sin(turn)
 return [([Vector(((v.x*co+v.z*si)*scale+x,v.y*scale+y,(-v.x*si+v.z*co)*scale+z)) for v in p],c,n) for p,c,n in mesh]
def box(x,y,z,sx,sy,sz,c):
 vs=[Vector((x+a*sx/2,y+b*sy/2,z+d*sz/2)) for a,b,d in [(-1,-1,-1),(1,-1,-1),(1,1,-1),(-1,1,-1),(-1,-1,1),(1,-1,1),(1,1,1),(-1,1,1)]]
 return [([vs[i] for i in t],c,'custom') for t in [(0,2,1),(0,3,2),(4,5,6),(4,6,7),(0,4,7),(0,7,3),(1,2,6),(1,6,5),(3,7,6),(3,6,2),(0,1,5),(0,5,4)]]
def cone(x,y,z,r,h,c,n=7):
 ring=[Vector((x+math.cos(i*math.tau/n)*r,y,z+math.sin(i*math.tau/n)*r)) for i in range(n)]
 return [([ring[i],Vector((x,y+h,z)),ring[(i+1)%n]],c,'custom') for i in range(n)]
def write(name,mesh,team=None):
 pos=[];uv=[];indices=[];light=Vector((-.5,.85,.3)).normalized()
 for points,c,mat in mesh:
  if team and mat=='armor':
   c=[v*.7+.18 for v in team]
  normal=(points[1]-points[0]).cross(points[2]-points[0]);normal.normalize()
  shade=.52+.48*max(0,normal.dot(light));idx=color([v*shade for v in c])
  for v in points:indices.append(len(pos)//3);pos.extend(round(f,4) for f in v);uv.extend([(idx+.5)/4096,.5])
 data=dict(version=1,positions=pos,uvs=uv,indices=indices,texture='texture://palette')
 (OUT/(name+'.mesh.json')).write_text(json.dumps(data,separators=(',',':')))
 print('MODEL',name,len(indices)//3,'triangles',flush=True)
knight=imported(SRC/'knight/FBX/KnightCharacter.fbx',1.7,'Run_swordRight',5)
print('KNIGHT MATERIALS',sorted(set(n for _,_,n in knight)),flush=True)
horse=imported(SRC/'animals/FBX/Horse.fbx',1.8,'Idle',1)
W=SRC/'weapons/Low Poly Medieval Weapons'
sword=imported(SRC/'knight/FBX/Sword.fbx',1.1)
bow=imported(W/'Bows/Long Bow.fbx',1.2)
ballista=imported(W/'Siege Engines/Ballista.fbx',1.8)
catapult=imported(W/'Siege Engines/Catapult.fbx',2.4)
arrow=imported(W/'Bows/Arrow.fbx',1)
for name,team in [('red',[.92,.16,.13]),('blue',[.12,.49,.98])]:
 # Team tabards and shields remain readable even when imported armor is neutral.
 tabard=box(0,1.03,0,.48,.48,.32,team)
 base=knight+tabard
 write(name+'-infantry',base+move(sword,.55,.5,.1,turn=math.pi/2)+box(-.48,.9,.12,.1,.62,.45,team),team)
 write(name+'-archer',base+move(bow,.5,.65,.15),team)
 write(name+'-cavalry',horse+move(base,y=1.25,scale=.8)+box(.42,1.65,1,.07,.07,2.5,[.65,.48,.2]),team)
 write(name+'-ballista',ballista+box(0,1.4,0,.9,.25,.7,team),team)
 write(name+'-catapult',catapult+box(0,.8,0,.9,.35,.7,team),team)
 wings=[]
 for side in [-1,1]:
  wings += [([Vector((side*.3,1.25,0)),Vector((side*2,1.5,-.4)),Vector((side*.8,1.05,-1))],[.85,.83,.7],'custom')]
 write(name+'-flyer',base+wings,team)
 write(name+'-mage',base+cone(0,1.65,0,.4,.75,team)+box(.5,1.3,.1,.08,2.3,.08,[.55,.35,.13])+cone(.5,2.4,.1,.22,.4,[.7,.4,1]),team)
write('arrow',move(arrow,turn=math.pi/2))
write('bolt',box(0,0,0,.08,.08,1.6,[.88,.75,.38]))
write('boulder',imported(W/'Siege Engines/Catapult Boulder.fbx',.55))
write('magic',cone(0,-.2,0,.25,.6,[.8,.35,1]))
ring=[]
for i in range(16):
 a=i*math.tau/16;b=(i+1)*math.tau/16
 vs=[Vector((math.cos(t)*r,.03,math.sin(t)*r)) for t,r in [(a,1),(b,1),(a,.86),(b,.86)]]
 ring += [([vs[j] for j in tri],[1,.72,.24],'custom') for tri in [(0,2,1),(1,2,3)]]
write('impact',ring)
# Hand-authored environment geometry is game content, not engine behavior.
random.seed(42)
terrain=box(-112.5,-.5,0,125,1,250,[.24,.32,.25])+box(112.5,-.5,0,125,1,250,[.24,.32,.25])+box(0,-.5,0,100,1,250,[.33,.33,.25])
for i in range(210):
 x=random.uniform(-175,175);z=random.choice([-1,1])*random.uniform(96,124)
 terrain+=cone(x,0,z,random.uniform(2,5),random.uniform(5,13),[.1,.21,.17],5)
for i in range(24):
 x=random.choice([-1,1])*random.uniform(155,185);z=random.uniform(-130,130)
 terrain+=cone(x,-1,z,random.uniform(8,18),random.uniform(8,20),[.23,.29,.27],5)
write('terrain',terrain)
# Palette texels are generated from asset materials; nearest filtering is unnecessary at texel centers.
image=bpy.data.images.new('palette',width=4096,height=1,alpha=True)
pixels=[]
for i in range(4096):pixels.extend([*(palette[i] if i<len(palette) else [1,1,1]),1])
image.pixels=pixels;image.filepath_raw=str(OUT/'palette.png');image.file_format='PNG';image.save()
print('PALETTE',len(palette),flush=True)

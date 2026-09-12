"""Original low-poly forest cast, painted atlas, rigid skinned limbs and eight clips.
Run with Blender --background --python this_file. No downloaded model content.
"""
import bpy, math, json, random
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'assets/creatures';OUT.mkdir(parents=True,exist_ok=True)
palette=[(0.39,0.54,0.26),(0.66,0.40,0.22),(0.78,0.56,0.40),(0.92,0.80,0.45),
 (0.25,0.47,0.43),(0.59,0.68,0.42),(0.39,0.26,0.21),(0.91,0.86,0.70),
 (0.14,0.18,0.19),(0.96,0.95,0.80),(0.58,0.40,0.58),(0.87,0.57,0.25)]
cast=[('acorn','橡果蹦蹦',1),('piglet','菇背幼豬',2),('moth','苔羽蛾',1),('turtle','苔殼龜',2),
 ('boar','獠牙搬木王',3),('elder','古榕守衛',4),('treant','花冠樹靈',3),('stag','冠角白鹿',5),
 ('beetle','聚寶甲蟲',4),('wheel','金鈴狸',3),('horse','林地戰馬',0)]
def build(kind,label,rank):
 bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
 image=bpy.data.images.new(kind+'-painted',width=256,height=256,alpha=True)
 pixels=[]
 for y in range(256):
  for x in range(256):
   c=palette[min(11,x//21)];grain=.94+.05*math.sin(x*.8+y*.3)+.03*math.sin(y*.1)
   pixels.extend([min(1,v*grain) for v in c]+[1])
 image.pixels=pixels;image.filepath_raw=str(OUT/(kind+'-painted.png'));image.file_format='PNG';image.save();image.pack()
 mat=bpy.data.materials.new(kind+'-storybook-paint');mat.use_nodes=True
 tex=mat.node_tree.nodes.new('ShaderNodeTexImage');tex.image=image
 mat.node_tree.links.new(tex.outputs['Color'],mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'])
 mat.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value=.88
 parts=[]
 def part(name,pos,scale,color,bone='body',shape='ico'):
  if shape=='cone':bpy.ops.mesh.primitive_cone_add(vertices=6,radius1=1,radius2=.02,depth=2,location=pos)
  else:bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2 if name=='head' else 1,radius=1,location=pos)
  o=bpy.context.object;o.name=name;o.scale=scale;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
  o.data.materials.append(mat)
  # Primitive cones already have UVMap. Export exactly our painted atlas UVs.
  for old_uv in list(o.data.uv_layers):o.data.uv_layers.remove(old_uv)
  uv=o.data.uv_layers.new(name='PaintedUV')
  for poly in o.data.polygons:
   for li in poly.loop_indices:
    v=o.data.vertices[o.data.loops[li].vertex_index].co
    uv.data[li].uv=((color*21+3+(li%5)*2)/256,.2+(.5+.5*math.sin(v.z*2+v.x))*.6)
  vg=o.vertex_groups.new(name=bone);vg.add(list(range(len(o.data.vertices))),1,'REPLACE');parts.append(o);return o
 color={'acorn':1,'piglet':2,'moth':4,'turtle':0,'boar':6,'elder':1,'treant':0,'stag':7,'beetle':3,'wheel':11,'horse':1}[kind]
 part('body',(0,0,.72),(.55,.65,.52),color)
 part('head',(0,-.49,1.24),(.58,.48,.58),color,'head')
 for side in [-1,1]:
  part('eye-white',(side*.25,-.90,1.32),(.14,.09,.16),9,'head')
  part('eye-pupil',(side*.25,-.978,1.32),(.062,.035,.085),8,'head')
  part('brow',(side*.25,-.91,1.53),(.19,.08,.055),6,'head')
 for i,(x,y) in enumerate([(-.34,-.32),(.34,-.32),(-.34,.35),(.34,.35)]):
  part('leg'+str(i),(x,y,.29),(.16,.16,.30),color,'leg'+str(i))
  part('foot'+str(i),(x,y-.07,.09),(.2,.23,.12),6,'leg'+str(i))
 if kind in ['piglet','boar','wheel','stag','horse']:
  for side in [-1,1]:part('ear',(side*.47,-.37,1.69),(.20,.12,.3),color,'head','cone')
 if kind in ['boar','piglet']:
  part('snout',(0,-.93,1.08),(.35,.22,.20),2,'head')
  for side in [-1,1]:part('tusk',(side*.33,-.84,.99),(.10,.12,.27),7,'head','cone')
 if kind in ['acorn','turtle','beetle']:
  part('shell',(0,.03,1.01),(.69,.72,.38),0 if kind=='turtle' else color)
  for n in range(5):part('shell-mark',(.43*math.cos(n*1.25),.36*math.sin(n*1.25),1.3),(.11,.12,.08),3)
 if kind in ['elder','treant','acorn']:
  for n in range(5):part('leaf-crown',(.42*math.cos(n*1.25),-.32+.31*math.sin(n*1.25),1.78),(.34,.29,.20),n%2*5,'head')
 if kind in ['stag','elder']:
  for side in [-1,1]:
   part('antler',(side*.36,-.35,1.98),(.09,.12,.50),3,'head','cone')
   part('antler-tip',(side*.57,-.35,2.14),(.2,.07,.13),3,'head','cone')
 if kind=='beetle':
  # Broad paired emerald elytra, six legs, short feelers and an amber gem.
  for side in [-1,1]:
   part('elytron',(side*.32,.22,1.05),(.40,.70,.45),4)
   part('middle-leg',(side*.65,.03,.30),(.32,.12,.11),6,'leg'+str(0 if side<0 else 1))
   part('feeler',(side*.32,-.40,1.83),(.045,.045,.23),6,'head','cone')
   part('feeler-tip',(side*.32,-.40,2.04),(.10,.10,.10),3,'head')
  part('treasure-gem',(0,.12,1.53),(.19,.26,.22),11)
 if kind=='moth':
  for side in [-1,1]:
   part('wing',(side*.75,.03,1.01),(.65,.15,.56),10,'wing'+str(side))
   part('wing-eye',(side*.88,-.10,1.08),(.18,.04,.20),3,'wing'+str(side))
 if kind=='wheel':
  part('bell',(0,-.63,.72),(.23,.2,.25),3)
  part('striped-tail',(0,.70,.73),(.28,.57,.30),7,'tail')
 bpy.ops.object.select_all(action='DESELECT')
 for o in parts:o.select_set(True)
 bpy.context.view_layer.objects.active=parts[0];bpy.ops.object.join();mesh=bpy.context.object;mesh.name=kind+'-painted-skin'
 bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
 armdata=bpy.data.armatures.new(kind+'-skeleton');arm=bpy.data.objects.new(kind+'-rig',armdata);bpy.context.collection.objects.link(arm)
 bpy.context.view_layer.objects.active=arm;bpy.ops.object.mode_set(mode='EDIT')
 bones={'body':(0,0,.7),'head':(0,-.4,1.2),'tail':(0,.5,.7),'wing-1':(-.4,0,1),'wing1':(.4,0,1)}
 for i,(x,y) in enumerate([(-.34,-.32),(.34,-.32),(-.34,.35),(.34,.35)]):bones['leg'+str(i)]=(x,y,.5)
 for name,head in bones.items():
  b=armdata.edit_bones.new(name);b.head=head;b.tail=Vector(head)+Vector((0,0,.25))
  if name!='body':b.parent=armdata.edit_bones['body']
 bpy.ops.object.mode_set(mode='OBJECT');mesh.parent=arm;mod=mesh.modifiers.new('ForestSkin','ARMATURE');mod.object=arm
 arm.animation_data_create();scene=bpy.context.scene;scene.render.fps=30
 for state,duration in [('idle',2),('walk',1.2),('attack',.7),('hit',.3),('death',.8),('spawn',.7),('stretch',2),('run',.7)]:
  action=bpy.data.actions.new(state);arm.animation_data.action=action
  end=int(duration*30)
  for f in range(0,end+1,3):
   t=f/end;wave=math.sin(t*math.tau)
   for b in arm.pose.bones:
    b.rotation_mode='XYZ';b.rotation_euler=(0,0,0);b.location=(0,0,0);b.scale=(1,1,1)
    if b.name.startswith('leg') and state in ['walk','run']:b.rotation_euler.x=wave*(.65 if state=='run' else .4)*(1 if int(b.name[-1])%2 else -1)
    if b.name.startswith('wing'):b.rotation_euler.y=wave*.5
    if b.name=='body':
     b.location.z=abs(wave)*.06
     if state=='spawn':b.scale=(max(.03,t),)*3
     if state=='death':b.rotation_euler.y=t*1.5;b.location.z=-t*.35
     if state=='attack':b.rotation_euler.x=-math.sin(t*math.pi)*.45
     if state=='hit':b.location.y=math.sin(t*math.pi)*.15
     if state=='stretch':b.scale=(1,1,1+math.sin(t*math.pi)*.15)
    if b.name=='head' and state=='idle':b.rotation_euler.z=wave*.08
    b.keyframe_insert('rotation_euler',frame=f);b.keyframe_insert('location',frame=f);b.keyframe_insert('scale',frame=f)
  track=arm.animation_data.nla_tracks.new();track.name=state;track.strips.new(state,1,action)
  arm.animation_data.action=None
 # Rest pose and all independent NLA actions export in one self-contained GLB.
 for b in arm.pose.bones:b.rotation_euler=(0,0,0);b.location=(0,0,0);b.scale=(1,1,1)
 scene.frame_set(0);bpy.ops.object.select_all(action='DESELECT');arm.select_set(True);mesh.select_set(True)
 bpy.context.view_layer.objects.active=arm
 bpy.ops.wm.save_as_mainfile(filepath=str(OUT/(kind+'.blend')))
 bpy.ops.export_scene.gltf(filepath=str(OUT/(kind+'.glb')),export_format='GLB',use_selection=True,export_animations=True,export_animation_mode='NLA_TRACKS',export_skins=True)
 return {'id':kind,'name':label,'rank':rank,'model':kind+'.glb','source':kind+'.blend','texture':kind+'-painted.png','clips':['idle','walk','attack','hit','death','spawn','stretch','run'],'bones':len(bones)}
manifest=[build(*entry) for entry in cast]
(OUT/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
print('FOREST_CAST_READY',len(manifest))

"""Build an editable Blender character, skin it, and export viewer geometry.
Authoring helpers accept the game's Y-up, +Z-front coordinates.
"""
import bpy, math, json
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[1]
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(ROOT/'assets/ashen-soldier.glb'))
arm=next(o for o in bpy.data.objects if o.type=='ARMATURE')
arm.animation_data_clear();arm.data.pose_position='REST'
for o in list(bpy.data.objects):
 if o!=arm:bpy.data.objects.remove(o,do_unlink=True)
arm.name='Storybook_A_Rig'
for b in arm.pose.bones:b.matrix_basis.identity()
palette={'skin':'E5AC7A','cream':'F3E2B8','blue':'719FAF','blue_dark':'50798E','leather':'976A4A','sole':'654D43','steel':'9EAEB4','edge':'CED4CB','hair':'644632','ink':'393D46','eye':'FBF6E4','cheek':'D88B79','gold':'D6B372'}
mats={}
for name,color in palette.items():
 m=bpy.data.materials.new(name);rgb=tuple(int(color[i:i+2],16)/255 for i in (0,2,4));m.diffuse_color=(*rgb,1);m.use_nodes=True
 bs=m.node_tree.nodes.get('Principled BSDF');bs.inputs['Base Color'].default_value=(*rgb,1);bs.inputs['Roughness'].default_value=.88;bs.inputs['Metallic'].default_value=0
 mats[name]=m
def coord(p):return Vector((p[0],-p[2],p[1]))
def game(p):return [p.x,p.z,-p.y]
parts=[]
def finish(o,name,slot,bone,mat,bevel=0):
 o.name=name;o['slot']=slot;o.data.materials.clear();o.data.materials.append(mats[mat]);o['palette']=mat
 bpy.context.view_layer.objects.active=o;o.select_set(True);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
 if bevel:
  mod=o.modifiers.new('Soft low-poly corners','BEVEL');mod.width=bevel;mod.segments=1;bpy.ops.object.modifier_apply(modifier=mod.name)
 group=o.vertex_groups.new(name='mixamorig'+bone);group.add(list(range(len(o.data.vertices))),1,'REPLACE')
 mod=o.modifiers.new('Shared soldier skeleton','ARMATURE');mod.object=arm
 o.parent=arm;o.matrix_parent_inverse=arm.matrix_world.inverted();parts.append(o);o.select_set(False);return o
def cube(name,slot,bone,pos,size,mat,bevel=.015):
 bpy.ops.mesh.primitive_cube_add(size=1,location=coord(pos));o=bpy.context.object;o.scale=(size[0],size[2],size[1]);return finish(o,name,slot,bone,mat,bevel)
def ball(name,slot,bone,pos,size,mat):
 bpy.ops.mesh.primitive_uv_sphere_add(segments=12,ring_count=8,radius=1,location=coord(pos));o=bpy.context.object;o.scale=(size[0],size[2],size[1]);return finish(o,name,slot,bone,mat)
def cone(name,slot,bone,pos,r1,r2,height,mat,scalez=1):
 bpy.ops.mesh.primitive_cone_add(vertices=12,radius1=r1,radius2=r2,depth=height,location=coord(pos));o=bpy.context.object;o.scale.y=scalez;return finish(o,name,slot,bone,mat)
def beam(name,slot,bone,a,b,r1,r2,mat):
 ca,cb=coord(a),coord(b);direction=cb-ca
 bpy.ops.mesh.primitive_cone_add(vertices=8,radius1=r1,radius2=r2,depth=direction.length,location=(ca+cb)/2)
 o=bpy.context.object;o.rotation_mode='QUATERNION';o.rotation_quaternion=Vector((0,0,1)).rotation_difference(direction)
 return finish(o,name,slot,bone,mat)
def joint(n):return game(arm.matrix_world@arm.data.bones['mixamorig'+n].head_local)
def mesh(name,slot,bone,vertices,faces,mat):
 data=bpy.data.meshes.new(name);data.from_pydata([coord(v) for v in vertices],[],faces);data.update();o=bpy.data.objects.new(name,data);bpy.context.collection.objects.link(o);return finish(o,name,slot,bone,mat)
# Big soft face, simple human expression, hair remains when helmet is removed.
ball('Round_face','base','Head',(0,1.245,.025),(.225,.265,.198),'skin')
ball('Hair_cap','base','Head',(0,1.375,-.03),(.228,.168,.185),'hair')
for d in [-1,1]:
 ball('Ear_'+str(d),'base','Head',(d*.222,1.245,.01),(.043,.065,.037),'skin')
 ball('Eye_white_'+str(d),'base','Head',(d*.087,1.272,.205),(.049,.064,.012),'eye')
 ball('Pupil_'+str(d),'base','Head',(d*.083,1.27,.216),(.024,.040,.009),'ink')
 ball('Eye_glint_'+str(d),'base','Head',(d*.083-.008,1.29,.224),(.009,.012,.004),'eye')
 ball('Cheek_'+str(d),'base','Head',(d*.15,1.199,.181),(.039,.017,.006),'cheek')
 beam('Brow_'+str(d),'base','Head',(d*.13,1.35,.18),(d*.048,1.356,.204),.012,.014,'hair')
 # graphic bangs above brow
 mesh('Hair_fringe_'+str(d),'base','Head',[(d*.02,1.447,.135),(d*.15,1.41,.15),(d*.05,1.351,.191)],[(0,1,2)],'hair')
ball('Small_nose','base','Head',(0,1.217,.22),(.022,.025,.025),'skin')
for i in range(6):
 x1=-.068+i*.136/6;x2=-.068+(i+1)*.136/6
 beam('Smile_'+str(i),'base','Head',(x1,1.151+.025*(x1/.068)**2,.206),(x2,1.151+.025*(x2/.068)**2,.206),.005,.005,'ink')
# Round cream undershirt and compact pelvis.
cone('Cream_shirt','base','Spine1',(0,.788,0),.215,.255,.34,'cream',.70)
ball('Shirt_shoulders','base','Spine2',(0,.896,0),(.267,.10,.16),'cream')
cube('Shorts','base','Hips',(0,.562,0),(.31,.16,.22),'leather',.035)
beam('Neck','base','Neck',(0,.916,0),(0,1.072,0),.075,.071,'skin')
for side,d in [('Left',1),('Right',-1)]:
 a,b,c=[joint(side+n) for n in ['Arm','ForeArm','Hand']]
 ball(side+'_round_shoulder','base',side+'Arm',a,(.112,.106,.107),'cream')
 beam(side+'_sleeve','base',side+'Arm',a,b,.105,.093,'cream')
 beam(side+'_forearm','base',side+'ForeArm',b,c,.087,.069,'skin')
 ball(side+'_palm','base',side+'Hand',(c[0]+d*.04,c[1],c[2]),(.075,.065,.078),'skin')
 a,b,c=[joint(side+n) for n in ['UpLeg','Leg','Foot']]
 beam(side+'_trouser','base',side+'UpLeg',a,b,.094,.085,'cream')
 beam(side+'_calf','base',side+'Leg',b,c,.073,.059,'cream')
 ball(side+'_foot','base',side+'Foot',(d*.137,.068,.058),(.091,.069,.151),'leather')
# Kettle helmet: low crown, sloping broad brim, matte steel and rim.
cone('Kettle_brim','head','Head',(0,1.442,-.017),.34,.25,.09,'steel',.94)
cone('Brim_edge','head','Head',(0,1.4,-.017),.345,.344,.018,'edge',.94)
ball('Kettle_crown','head','Head',(0,1.48,-.026),(.254,.181,.236),'steel')
for d in [-1,1]:ball('Helmet_rivet_'+str(d),'head','Head',(d*.194,1.502,.13),(.015,.015,.010),'edge')
# Blue cloth panels, ivory star/sun badge, warm leather belt.
cube('Tabard_chest','body','Spine1',(0,.816,.163),(.19,.30,.028),'blue',.008)
cube('Tabard_back','body','Spine1',(0,.81,-.164),(.19,.30,.028),'blue',.008)
cube('Tabard_skirt','body','Hips',(0,.516,.133),(.205,.24,.028),'blue',.008)
cube('Belt','body','Hips',(0,.636,0),(.44,.045,.326),'leather',.012)
cube('Buckle','body','Hips',(0,.636,.175),(.064,.06,.024),'gold',.009)
cube('Buckle_center','body','Hips',(0,.636,.189),(.031,.032,.008),'leather',.002)
v=[(0,.823,.184)]+[(math.sin(i*math.pi/4)*(.044 if i%2==0 else .018),.823+math.cos(i*math.pi/4)*(.044 if i%2==0 else .018),.184) for i in range(8)]
mesh('Cloth_sun_badge','body','Spine1',v,[(0,i+1,(i+1)%8+1) for i in range(8)],'cream')
for side,d in [('Left',1),('Right',-1)]:
 h=joint(side+'Hand')
 ball(side+'_mitten','hands',side+'Hand',(h[0]+d*.045,h[1],0),(.089,.075,.086),'leather')
 cube(side+'_cuff','hands',side+'Hand',(h[0]-d*.012,h[1],0),(.048,.15,.175),'sole',.012)
 ball(side+'_boot','feet',side+'Foot',(d*.137,.071,.058),(.108,.078,.177),'leather')
 cube(side+'_sole','feet',side+'Foot',(d*.137,.023,.063),(.211,.035,.307),'sole',.016)
 cone(side+'_boot_shaft','feet',side+'Leg',(d*.137,.147,0),.096,.108,.17,'leather',.88)
 cube(side+'_boot_band','feet',side+'Leg',(d*.137,.22,0),(.211,.043,.18),'gold',.01)
# Compact broad sword; follows the hand. Blade faces outward in T-pose.
h=joint('RightHand');x=h[0]-.04;y=h[1]
beam('Sword_grip','weapon','RightHand',(x,y,-.09),(x,y,.10),.024,.024,'leather')
cube('Sword_guard','weapon','RightHand',(x,y,.11),(.19,.045,.043),'gold',.01)
verts=[(x-.065,y,.135),(x+.065,y,.135),(x+.059,y,.46),(x,y,.58),(x-.059,y,.46),(x,y+.026,.18),(x,y+.024,.43),(x,y-.023,.18),(x,y-.02,.43)]
faces=[(0,1,5),(1,2,6,5),(2,3,6),(3,4,6),(4,0,5,6),(1,0,7),(2,1,7,8),(3,2,8),(4,3,8),(0,4,8,7)]
mesh('Broad_sword','weapon','RightHand',verts,faces,'edge')
# Export raw triangulated bind geometry + weights for the existing shared rig.
out={'format':'storybook-blender-mesh-v1','authoring':'Blender '+bpy.app.version_string,'palette':palette,'parts':[]}
for o in parts:
 o.data.calc_loop_triangles();p=[];indices=[];weights=[]
 for vertex in o.data.vertices:
  p.extend(game(o.matrix_world@vertex.co))
  groups=sorted(vertex.groups,key=lambda g:g.weight,reverse=True)[:4]
  weights.append([[o.vertex_groups[g.group].name,g.weight] for g in groups])
 for tri in o.data.loop_triangles:indices.extend(tri.vertices)
 out['parts'].append({'name':o.name,'slot':o['slot'],'material':o['palette'],'position':p,'index':indices,'weights':weights})
(ROOT/'assets/storybook-a.mesh.json').write_text(json.dumps(out,separators=(',',':')),encoding='utf-8')
# Save editable master with its armature and all five named slots.
bpy.context.view_layer.objects.active=arm;arm.select_set(True)
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'assets/storybook-a.blend'))
bpy.ops.export_scene.gltf(filepath=str(ROOT/'assets/storybook-a-blender.glb'),export_format='GLB',export_animations=False)
print('STORYBOOK_A',len(parts),'parts',len(arm.data.bones),'bones')

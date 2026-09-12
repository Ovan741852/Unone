"""Blender-authored modular equipment ornaments, attached to the existing soldier bones."""
import bpy,json,colorsys,math
from pathlib import Path
root=Path(__file__).resolve().parents[2];out=root/'assets/equipment';out.mkdir(exist_ok=True)
items=json.loads((root/'design-v1/equipment-manifest.json').read_text(encoding='utf-8'))
for i,item in enumerate(items):
 bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
 slot=item['slot'];color=colorsys.hls_to_rgb((i*.137)%1,.55,.38)
 image=bpy.data.images.new(item['id']+'-painted',width=64,height=64,alpha=True)
 pixels=[]
 for y in range(64):
  for x in range(64):
   brightness=.83+.12*(y/64)+.045*math.sin(x*.5+y)
   pixels.extend([v*brightness for v in color]+[1])
 image.pixels=pixels;image.filepath_raw=str(out/(item['id']+'.png'));image.file_format='PNG';image.save();image.pack()
 material=bpy.data.materials.new(item['id']+'-paint');material.use_nodes=True
 node=material.node_tree.nodes.new('ShaderNodeTexImage');node.image=image
 material.node_tree.links.new(node.outputs['Color'],material.node_tree.nodes['Principled BSDF'].inputs['Base Color'])
 material.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value=.65
 def part(position,scale,kind='ico'):
  if kind=='cone':bpy.ops.mesh.primitive_cone_add(vertices=5+i%4,radius1=1,radius2=.01,depth=2,location=position)
  else:bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1,radius=1,location=position)
  obj=bpy.context.object;obj.scale=scale;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);obj.data.materials.append(material)
  if not obj.data.uv_layers:obj.data.uv_layers.new(name='PaintedUV')
  for poly in obj.data.polygons:
   for li in poly.loop_indices:obj.data.uv_layers.active.data[li].uv=((li%7)/7,(poly.index%11)/11)
 if slot==1:
  part((0,0,.28),(.27,.22,.14))
  for n in range(1+i%3):part(((n-(i%3)/2)*.16,0,.45),(.065,.065,.2),'cone')
 elif slot==2:
  part((0,-.17,.04),(.22,.065,.25));part((0,-.24,.09),(.09,.06,.12),'cone')
 elif slot==3:
  part((0,-.06,.04),(.095,.18,.095));part((0,.015,.15),(.105,.105,.12))
 elif slot==4:
  part((0,0,.035),(.105,.105,.12));part((0,-.1,.045),(.065,.04,.09),'cone')
 else:
  part((0,0,.22),(.035,.035,.3));part((0,0,.68),(.13 if i%2 else .075,.04,.35),'cone');part((0,0,.36),(.2,.06,.05))
 bpy.ops.object.select_all(action='SELECT');bpy.ops.object.join();bpy.context.object.name='gear_'+item['id'];bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
 bpy.ops.wm.save_as_mainfile(filepath=str(out/(item['id']+'.blend')))
 bpy.ops.export_scene.gltf(filepath=str(out/(item['id']+'.glb')),export_format='GLB',use_selection=True,export_animations=False)
(out/'manifest.json').write_text(json.dumps(items,ensure_ascii=False,indent=2),encoding='utf-8')
print('EQUIPMENT_MODELS_READY',len(items))

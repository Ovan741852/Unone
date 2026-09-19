"""Blender-authored modular equipment ornaments, attached to the existing soldier bones."""
import bpy,json,colorsys,math,sys
from pathlib import Path
root=Path(__file__).resolve().parents[2];out=root/'assets/equipment';out.mkdir(exist_ok=True)
items=json.loads((root/'design-v1/equipment-manifest.json').read_text(encoding='utf-8'))
selected=set(sys.argv[sys.argv.index('--')+1:]) if '--' in sys.argv else set()
for i,item in enumerate(items):
 if selected and item['id'] not in selected:continue
 bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
 slot=item['slot'];color=colorsys.hls_to_rgb((i*.137)%1,.55,.38)
 if item['id']=='legacy_gift':color=(.87,.67,.28)
 if item['id']=='guard_bequest':color=(.50,.58,.70)
 color={'comrade_oath':(.52,.70,.36),'resonant_debt':(.64,.49,.71),'contact_mine':(.76,.48,.25),'step_orb':(.84,.75,.45),'gravity_law':(.52,.43,.71),'quick_chant':(.45,.72,.69),'overload_script':(.72,.40,.40),'storm_payload':(.40,.71,.82),'cinder_seal':(.83,.45,.20),'chain_fuse':(.74,.27,.20),'thunder_fan':(.32,.71,.78),'echo_blade':(.53,.55,.74),'starfall':(.74,.50,.29),'soul_return':(.53,.70,.81),'plunder':(.82,.58,.19),'firstborn':(.22,.76,.77),'march_capacitor':(.29,.58,.69),'delayed_bloom':(.90,.43,.15),'third_pulse':(.31,.55,.67),'battle_elegy':(.67,.31,.14),'grave_bloom':(.65,.24,.16),'last_echo':(.54,.79,.84),'flame_cloak':(.80,.24,.10),'phoenix_fire':(.95,.53,.13),'plague_vial':(.35,.72,.25),'ember_trail':(.74,.30,.12),'slick_oil':(.22,.18,.31),'rain_strike':(.20,.62,.69),'storm_touch':(.36,.71,.78),'oil_legacy':(.34,.24,.15)}.get(item['id'],color)
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
 if item['id']=='legacy_gift':
  part((0,-.05,-.12),(.09,.09,.15));part((0,-.05,.02),(.12,.12,.05));part((0,-.05,-.25),(.12,.12,.05))
  for n in [-1,1]:part((n*.07,-.05,.10),(.025,.025,.10))
  part((0,-.05,.19),(.07,.025,.025));part((0,-.15,-.12),(.04,.025,.07),'cone')
 elif item['id']=='guard_bequest':
  part((0,0,.27),(.27,.23,.12));part((-.12,-.17,.35),(.09,.07,.17),'cone');part((.11,-.17,.32),(.08,.07,.12),'cone')
  for n in [-1,1]:part((n*.24,-.03,.26),(.06,.12,.13))
 elif item['id']=='comrade_oath':
  part((.14,.15,.29),(.025,.025,.43));part((-.04,.15,.50),(.20,.035,.22))
  for n in [-1,1]:part((n*.07,.12,.5),(.06,.04,.10),'cone')
 elif item['id'] in ['resonant_debt','quick_chant']:
  part((0,0,.02),(.12,.09,.11));part((0,-.12,.08),(.09,.04,.10))
  for n in [-1,0,1]:part((n*.06,-.12,.19),(.025,.025,.04),'cone')
 elif item['id']=='contact_mine':
  part((0,.18,-.01),(.21,.11,.19))
  for n in [-1,0,1]:part((n*.12,.26,.08),(.065,.045,.095));part((n*.12,.26,.22),(.025,.025,.06),'cone')
 elif item['id']=='step_orb':
  part((0,-.05,.04),(.10,.19,.10));part((0,.02,.15),(.11,.10,.12));part((.09,.02,.27),(.065,.065,.07))
 elif item['id']=='gravity_law':
  part((0,0,.28),(.26,.22,.08));part((0,-.19,.38),(.10,.065,.11))
  for n in [-1,1]:part((n*.18,0,.43),(.06,.07,.16),'cone')
 elif item['id']=='overload_script':
  part((0,-.02,.38),(.20,.065,.25));part((0,-.09,.39),(.065,.03,.23));part((0,-.13,.46),(.085,.035,.10),'cone')
 elif item['id']=='storm_payload':
  part((0,0,.28),(.25,.22,.08));part((0,-.22,.34),(.07,.06,.17),'cone')
 elif item['id']=='cinder_seal':
  part((0,0,.02),(.12,.09,.11));part((0,-.12,.08),(.075,.055,.09));part((0,-.13,.20),(.04,.04,.06),'cone')
 elif item['id']=='chain_fuse':
  part((0,.16,.08),(.22,.085,.20))
  for n in [-1,0,1]:part((n*.13,.22,.18),(.065,.065,.13));part((n*.13,.22,.35),(.025,.025,.06),'cone')
 elif item['id']=='thunder_fan':
  part((0,0,.26),(.27,.22,.08))
  for n in [-2,-1,0,1,2]:part((n*.11,.03,.40-abs(n)*.035),(.045,.06,.19-abs(n)*.025),'cone')
 elif item['id']=='echo_blade':
  part((0,0,.2),(.035,.035,.25));part((0,0,.39),(.18,.05,.04))
  for side in [-1,1]:part((side*.09,0,.65),(.065,.035,.27),'cone')
 elif item['id']=='starfall':
  for side in [-1,1]:part((side*.24,.02,.14),(.14,.14,.16));part((side*.29,.02,.31),(.065,.075,.10),'cone')
  part((0,-.17,.02),(.20,.04,.20))
 elif item['id']=='soul_return':
  part((0,-.06,.03),(.10,.19,.10));part((0,.03,.15),(.10,.10,.13))
  for n in range(3):part((.10,.08+n*.04,.14+n*.045),(.055,.035,.12),'cone')
 elif item['id']=='plunder':
  part((0,0,.02),(.11,.10,.12));part((0,-.11,.06),(.085,.04,.075))
  for n in [-1,0,1]:part((n*.05,-.12,.06),(.035,.02,.035))
 elif item['id']=='firstborn':
  part((0,-.04,.04),(.10,.19,.10));part((0,.02,.15),(.11,.10,.12))
  for n in range(3):part((.1,.05+n*.055,.10+n*.07),(.08,.035,.13),'cone')
 elif item['id']=='march_capacitor':
  part((0,.16,.04),(.22,.09,.20))
  for side in [-1,1]:part((side*.11,.24,.09),(.065,.055,.17),'cone')
 elif item['id']=='delayed_bloom':
  part((0,0,.26),(.27,.22,.09));part((0,-.20,.40),(.075,.075,.15),'cone')
 elif item['id']=='third_pulse':
  part((0,0,.22),(.035,.035,.30));part((0,0,.63),(.23,.075,.13))
  for n in [-1,0,1]:part((n*.13,0,.76),(.045,.07,.08))
 elif item['id']=='battle_elegy':
  part((.14,.15,.29),(.025,.025,.43));part((-.04,.15,.50),(.20,.035,.22));part((-.07,.15,.24),(.15,.03,.09),'cone')
 elif item['id']=='grave_bloom':
  part((0,0,.22),(.035,.035,.3));part((0,0,.61),(.09,.04,.30),'cone')
  for side in [-1,1]:part((side*.13,0,.43),(.12,.04,.09),'cone')
 elif item['id']=='last_echo':
  part((0,-.2,.20),(.22,.07,.22));part((0,-.25,.30),(.08,.055,.17),'cone')
  for side in [-1,1]:part((side*.18,-.13,.38),(.05,.06,.19),'cone')
 elif item['id']=='ember_trail':
  part((0,-.06,.04),(.10,.19,.10));part((0,.01,.15),(.11,.10,.12))
  for side in [-1,1]:part((side*.08,.01,.25),(.04,.055,.15),'cone')
 elif item['id']=='slick_oil':
  part((0,0,.20),(.035,.035,.23));part((0,0,.53),(.12,.045,.20));part((0,0,.73),(.07,.04,.13),'cone');part((0,0,.34),(.17,.06,.045))
 elif item['id']=='rain_strike':
  part((0,0,.02),(.12,.10,.10));part((0,-.1,.02),(.08,.055,.10));part((0,-.1,.17),(.045,.035,.11),'cone')
 elif item['id']=='storm_touch':
  part((0,0,.28),(.27,.23,.10))
  for side in [-1,0,1]:part((side*.18,0,.43),(.06,.06,.15),'cone')
 elif item['id']=='oil_legacy':
  part((0,.18,.01),(.20,.16,.26));part((0,.18,.26),(.10,.10,.045));part((0,.19,-.12),(.22,.17,.045));part((0,.19,.13),(.22,.17,.045))
 elif item['id']=='flame_cloak':
  for n in range(5):part(((n-2)*.095,.13,-.10-abs(n-2)*.025),(.075,.055,.30))
  part((0,-.19,.16),(.08,.04,.11),'cone')
 elif item['id']=='phoenix_fire':
  part((0,0,.28),(.035,.035,.4));part((0,0,.78),(.07,.05,.19),'cone')
  for side in [-1,1]:
   part((side*.13,0,.70),(.18,.04,.075));part((side*.24,0,.78),(.07,.04,.13),'cone')
 elif item['id']=='plague_vial':
  for side in [-1,1]:
   part((side*.095,-.025,.03),(.075,.075,.10));part((side*.095,-.025,.15),(.035,.035,.045))
  part((0,.025,.01),(.16,.04,.04))
 elif slot==1:
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

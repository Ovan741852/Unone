"""Blender authoring helpers. Game coordinates: Y up, +Z forward.
One original painted UV atlas; broad value shapes instead of random face noise.
"""
import bpy, math, struct, zlib
from pathlib import Path
from mathutils import Vector

COLORS={
 'ink':'362A36','navy':'554A60','steel':'85808D','edge':'C6BDAF',
 'gold':'C29754','gold_hi':'EAD1A0','red':'AA443C','coral':'CD7254',
 'cream':'E4D4B3','skin':'DDA876','pink':'C98883','blush':'E6B6A0',
 'bark':'685047','wood':'A68162','leaf':'757E56','lime':'A6AA6F',
 'teal':'667C79','jade':'A2B395','purple':'786580','lilac':'ADA1B5',
 'olive':'A4A16D','black':'322631','white':'F6E7CC','rust':'A66949',
 'bronze':'A88348','horse':'BBA27E','leather':'735044','petal':'E5A998',
 'blue':'758891','sky':'BAC3B7','deep':'485B54','face':'DDA876',
}
def coord(p): return Vector((p[0],-p[2],p[1]))
def game(p): return (p.x,p.z,-p.y)
def paint_atlas(path):
 n=2048;tile=256;raw=bytearray()
 colors=[tuple(bytes.fromhex(c)) for c in COLORS.values()]
 for y in range(n):
  raw.append(0)
  for x in range(n):
   idx=(y//tile)*8+x//tile;idx=min(idx,31);u=(x%tile)*64/tile;v=(y%tile)*64/tile;c=colors[idx]
   shade=.88+.15*(1-v/63)+.025*(1-u/63)
   rgb=tuple(round(min(255,a*shade)) for a in c)
   # Broad painted edge light and one restrained triangular brush mark.
   if v<3 and idx not in [0,21,31]:rgb=tuple(min(255,round(a*1.07)) for a in c)
   if idx==31:
    rgb=colors[31]
    if ((u-18)/3.2)**2+((v-31)/5.4)**2<1 or ((u-46)/3.2)**2+((v-31)/5.4)**2<1:rgb=colors[0]
    if (12<=u<=24 and 19<=v<=22+(u-12)/8) or (40<=u<=52 and 19<=v<=22+(52-u)/8):rgb=colors[12]
    if ((u-12)/4)**2+((v-43)/2)**2<1 or ((u-52)/4)**2+((v-43)/2)**2<1:rgb=colors[10]
    if 25<=u<=39 and abs(v-(48-.025*(u-32)**2))<.7:rgb=colors[12]
   raw.extend(rgb)
 def chunk(tag,data):return struct.pack('>I',len(data))+tag+data+struct.pack('>I',zlib.crc32(tag+data)&0xffffffff)
 path.parent.mkdir(parents=True,exist_ok=True)
 path.write_bytes(b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',n,n,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(bytes(raw),9))+chunk(b'IEND',b''))
 return path

class Author:
 def __init__(self,atlas):
  self.parts=[];self.atlas=atlas
  image=bpy.data.images.load(str(atlas),check_existing=True);image.colorspace_settings.name='sRGB';image.pack()
  self.mat=bpy.data.materials.new('Storybook painted colors');self.mat.use_nodes=True
  bs=self.mat.node_tree.nodes.get('Principled BSDF');bs.inputs['Roughness'].default_value=.86;bs.inputs['Metallic'].default_value=.03
  tex=self.mat.node_tree.nodes.new('ShaderNodeTexImage');tex.image=image;tex.interpolation='Linear';self.mat.node_tree.links.new(tex.outputs['Color'],bs.inputs['Base Color'])
 def finish(self,o,name,color,bone,slot):
  o.name=name;o['slot']=slot;o['palette']=color
  bpy.context.view_layer.objects.active=o;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
  o.data.materials.clear();o.data.materials.append(self.mat)
  for uv in list(o.data.uv_layers):o.data.uv_layers.remove(uv)
  uv=o.data.uv_layers.new(name='PaintedUV')
  points=[v.co for v in o.data.vertices];mins=[min(p[i] for p in points) for i in range(3)];maxs=[max(p[i] for p in points) for i in range(3)]
  for face in o.data.polygons:
   key='face' if name=='VinylHead' and face.normal.y<-.7 else color
   idx=list(COLORS).index(key);axis=max(range(3),key=lambda i:abs(face.normal[i]));ua,va=(0,2) if axis==1 else (1,2) if axis==0 else (0,1)
   for li in face.loop_indices:
    p=o.data.vertices[o.data.loops[li].vertex_index].co;u=(p[ua]-mins[ua])/max(.001,maxs[ua]-mins[ua]);v=(p[va]-mins[va])/max(.001,maxs[va]-mins[va]);uv.data[li].uv=((idx%8+.06+u*.88)/8,1-(idx//8+.06+(1-v)*.88)/8)
  vg=o.vertex_groups.new(name=bone);vg.add(list(range(len(o.data.vertices))),1,'REPLACE');self.parts.append(o);o.select_set(False);return o
 def box(self,name,p,size,color,bone='body',slot='base',bevel=.04):
  bpy.ops.mesh.primitive_cube_add(size=1,location=coord(p));o=bpy.context.object;o.scale=(size[0],size[2],size[1]);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
  if bevel:
   mod=o.modifiers.new('Designed bevel','BEVEL');mod.width=bevel;mod.segments=1;bpy.ops.object.modifier_apply(modifier=mod.name)
  return self.finish(o,name,color,bone,slot)
 def ell(self,name,p,size,color,bone='body',slot='base',segments=10,rings=6):
  bpy.ops.mesh.primitive_uv_sphere_add(segments=segments,ring_count=rings,radius=1,location=coord(p));o=bpy.context.object;o.scale=(size[0],size[2],size[1]);return self.finish(o,name,color,bone,slot)
 def cone(self,name,p,r1,r2,height,color,bone='body',slot='base',vertices=8,depth=1):
  bpy.ops.mesh.primitive_cone_add(vertices=vertices,radius1=r1,radius2=r2,depth=height,location=coord(p));o=bpy.context.object;o.scale.y=depth;return self.finish(o,name,color,bone,slot)
 def beam(self,name,a,b,r,color,bone='body',slot='base',end=None,vertices=6):
  va,vb=coord(a),coord(b);d=vb-va
  bpy.ops.mesh.primitive_cone_add(vertices=vertices,radius1=r,radius2=end if end is not None else r,depth=d.length,location=(va+vb)/2);o=bpy.context.object;o.rotation_mode='QUATERNION';o.rotation_quaternion=Vector((0,0,1)).rotation_difference(d);return self.finish(o,name,color,bone,slot)
 def mesh(self,name,vertices,faces,color,bone='body',slot='base'):
  data=bpy.data.meshes.new(name);data.from_pydata([coord(p) for p in vertices],[],faces);data.update();o=bpy.data.objects.new(name,data);bpy.context.collection.objects.link(o);return self.finish(o,name,color,bone,slot)
 def leaf(self,name,p,size,color,bone='body',slot='base',angle=0):
  x,y,z=p;w,h,d=size;pts=[(0,0,0),(-w*.5,h*.45,0),(0,h,0),(w*.5,h*.45,0),(0,h*.43,d)]
  v=[(x+a*math.cos(angle)-b*math.sin(angle),y+a*math.sin(angle)+b*math.cos(angle),z+c) for a,b,c in pts]
  return self.mesh(name,v,[(0,1,4),(1,2,4),(2,3,4),(3,0,4),(0,3,2,1)],color,bone,slot)
 def eyes(self,x,y,z,width=.11,bone='head',angry=False):
  for side in [-1,1]:
   self.ell('Graphic eye',(side*x,y,z),(width,width*1.1,.018),'black',bone,segments=8,rings=4)
   self.ell('Eye gleam',(side*x-width*.2,y+width*.3,z+.017),(width*.2,width*.23,.009),'white',bone,segments=6,rings=4)
   if angry:self.beam('Intentional brow',(side*x-width*1.2,y+width*1.45,z),(side*x+width*1.2,y+width*.8,z+.015),width*.22,'bark',bone,vertices=4)
 def bind(self,arm,slots=False):
  groups={}
  for o in self.parts:groups.setdefault(o['slot'] if slots else 'base',[]).append(o)
  skins=[]
  for slot,parts in groups.items():
   bpy.ops.object.select_all(action='DESELECT')
   for o in parts:o.select_set(True)
   bpy.context.view_layer.objects.active=parts[0];bpy.ops.object.join();skin=bpy.context.object;bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
   name='Body' if slot=='base' else 'Equipment_'+slot
   skin.name=name;skin.parent=arm;skin.matrix_parent_inverse=arm.matrix_world.inverted();mod=skin.modifiers.new('Authored skin','ARMATURE');mod.object=arm;skins.append(skin)
  return skins

"""Embed the painted atlas in the tested animated GLB (no external image paths)."""
from pathlib import Path
import json,struct
root=Path(__file__).resolve().parents[1]/'assets/vinyl'
raw=(root/'validation-rig.glb').read_bytes()
magic,version,length=struct.unpack_from('<III',raw);assert magic==0x46546C67 and version==2 and length==len(raw)
jlen,jtype=struct.unpack_from('<II',raw,12);assert jtype==0x4E4F534A
doc=json.loads(raw[20:20+jlen]);off=20+jlen
blen,btype=struct.unpack_from('<II',raw,off);assert btype==0x004E4942
binary=bytearray(raw[off+8:off+8+blen]);binary+=b'\0'*((-len(binary))%4)
# Raw viewer UVs use bottom-left PNG coordinates. glTF uses top-left images;
# flip V once because this packer embeds the original, unflipped PNG.
uv_accessors={p['attributes']['TEXCOORD_0'] for m in doc['meshes'] for p in m['primitives']}
for index in uv_accessors:
 accessor=doc['accessors'][index];assert accessor['componentType']==5126 and accessor['type']=='VEC2'
 bv=doc['bufferViews'][accessor['bufferView']];start=bv.get('byteOffset',0)+accessor.get('byteOffset',0);stride=bv.get('byteStride',8)
 for i in range(accessor['count']):
  offset=start+i*stride+4;v=struct.unpack_from('<f',binary,offset)[0];struct.pack_into('<f',binary,offset,1-v)
png=(root/'soldier-painted-atlas.png').read_bytes();view=len(doc['bufferViews'])
doc['bufferViews'].append({'buffer':0,'byteOffset':len(binary),'byteLength':len(png)})
binary+=png;binary+=b'\0'*((-len(binary))%4)
doc['buffers'][0]['byteLength']=len(binary)
doc['images']=[{'bufferView':view,'mimeType':'image/png','name':'Painted 2048 soldier atlas'}]
doc['samplers']=[{'magFilter':9729,'minFilter':9987,'wrapS':33071,'wrapT':33071}]
doc['textures']=[{'source':0,'sampler':0}]
for material in doc['materials']:
 material['pbrMetallicRoughness']={'baseColorFactor':[1,1,1,1],'baseColorTexture':{'index':0,'texCoord':0},'metallicFactor':0,'roughnessFactor':.9}
for mesh in doc['meshes']:
 for primitive in mesh['primitives']:assert 'TEXCOORD_0' in primitive['attributes']
assert len(doc['animations'])==8
encoded=json.dumps(doc,separators=(',',':')).encode();encoded+=b' '*((-len(encoded))%4)
out=struct.pack('<III',magic,2,28+len(encoded)+len(binary))+struct.pack('<II',len(encoded),jtype)+encoded+struct.pack('<II',len(binary),btype)+binary
(root/'soldier-animated-textured.glb').write_bytes(out)
print('Embedded atlas:',len(png),'bytes; animations:',len(doc['animations']),'GLB:',len(out),'bytes')

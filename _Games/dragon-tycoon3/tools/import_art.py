"""Extract selected Creator 3.8 interleaved meshes as textured static rest poses.

Does not execute Creator scripts or claim to recover skeleton animation/materials.
Only the inspected vertex layout is accepted; unsupported layouts fail explicitly.
"""
from pathlib import Path
import hashlib
import json
import math
import struct
import shutil

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'reference/creator'
catalog = json.loads((SOURCE / 'collection.json').read_text(encoding='utf8'))['catalog']
config = json.loads(next((SOURCE / 'assets/game').glob('config.*.json')).read_text(encoding='utf8'))
packs = {}
manifest = []
provenance = []

def entry(index, suffix):
    return next(x for x in catalog if x['bundle'] == 'game' and x['index'] == index and x['path'].endswith(suffix))

def metadata(index):
    pack, indices = next((k, v) for k, v in config['packs'].items() if index in v)
    if pack not in packs:
        path = next((SOURCE / 'assets/game/import' / pack[:2]).glob(pack + '.*.json'))
        packs[pack] = json.loads(path.read_text(encoding='utf8'))
    return packs[pack][5][indices.index(index)][0][0][3][0]

def texture(index, name):
    item = next(x for x in catalog if x['bundle'] == 'game' and x['index'] == index and Path(x['path']).suffix in ('.webp','.jpg','.png'))
    path = f'assets/reference/{name}' + Path(item['path']).suffix
    shutil.copyfile(SOURCE / item['path'], ROOT / path)
    asset_id = f'texture://reference/{name}'
    manifest.append({'id': asset_id, 'kind': 'texture2d', 'source': path})
    provenance.append({'output': path, 'source': item['path'], 'logical_path': item['logical_path'][0], 'sha256': hashlib.sha256((ROOT/path).read_bytes()).hexdigest()})
    return asset_id

def mesh(index, texture_index, name, length=1.6):
    item = entry(index, '.bin')
    data = (SOURCE / item['path']).read_bytes()
    meta = metadata(index)
    assert len(meta['vertexBundles']) == 1, 'multiple vertex bundles unsupported'
    bundle = meta['vertexBundles'][0]
    view = bundle['view']
    formats = [(a['name'], a['format']) for a in bundle['attributes']]
    assert formats == [('a_position',32),('a_normal',32),('a_texCoord',21),('a_tangent',44),('a_joints',42),('a_weights',44)], formats
    assert view['stride'] == 72 and view['length'] == view['count'] * 72
    assert view['offset'] + view['length'] <= len(data)
    positions, uvs, indices = [], [], []
    for i in range(view['count']):
        offset = view['offset'] + i * view['stride']
        positions.append(struct.unpack_from('<3f', data, offset))
        u, v = struct.unpack_from('<2f', data, offset + 24)
        uvs.extend([u, 1-v])  # Creator image UV origin -> Three TextureLoader origin.
    for primitive in meta['primitives']:
        assert primitive['primitiveMode'] == 7 and primitive['vertexBundelIndices'] == [0]
        iv = primitive['indexView']
        assert iv['stride'] in (2,4) and iv['length'] == iv['count'] * iv['stride']
        assert iv['offset'] + iv['length'] <= len(data)
        indices.extend(struct.unpack_from('<' + ('H' if iv['stride'] == 2 else 'I') * iv['count'], data, iv['offset']))
    assert len(indices) % 3 == 0 and max(indices) < len(positions)
    assert all(math.isfinite(v) for p in positions for v in p) and all(math.isfinite(v) for v in uvs)
    low = [min(p[k] for p in positions) for k in range(3)]
    high = [max(p[k] for p in positions) for k in range(3)]
    scale = length / max(high[k]-low[k] for k in range(3))
    output = {'version':1, 'positions':[round((p[k]-(low[k]+high[k])/2)*scale,7) for p in positions for k in range(3)], 'uvs':uvs, 'indices':indices, 'texture':texture(texture_index,name)}
    path = f'assets/reference/{name}.mesh.json'
    (ROOT/path).write_text(json.dumps(output,separators=(',',':'))+'\n',encoding='utf8')
    asset_id = f'mesh://reference/{name}'
    manifest.append({'id':asset_id, 'kind':'mesh3d', 'source':path, 'encoding':{'format':'unone-mesh-json','mime':'application/json','decoder':'mesh','companions':[]}})
    provenance.append({'output':path, 'source':item['path'], 'logical_path':item['logical_path'][0], 'vertices':len(positions),'triangles':len(indices)//3, 'source_bounds':[low,high], 'rest_pose_only':True, 'sha256':hashlib.sha256((ROOT/path).read_bytes()).hexdigest()})
    return asset_id

def main():
    (ROOT/'assets/reference').mkdir(parents=True,exist_ok=True)
    # Texture pairs use matching original logical model names; this is a curated
    # adapter, not a general Creator material/prefab resolver.
    selected = [(1573,3949,'a-dragon'),(955,2190,'d-dragon'),(1938,3410,'s-dragon'),(1998,823,'g-dragon'),(1598,2866,'pterosaur'),(1787,673,'tiger')]
    actors = [mesh(i,t,n) for i,t,n in selected]
    cannon = mesh(1595,2027,'cannon',1.5)
    floor = mesh(7,2602,'floor',15)
    entities = [{'id':'floor','transform3d':{'position':{'x':0,'y':0,'z':-2}},'mesh3d':{'asset':floor}}]
    for i in range(1,13):
        entities.append({'id':f'target{i}','transform3d':{'position':{'x':(i-1)%4*2-3,'y':(i-1)//4*1.5-1.5,'z':0}},'mesh3d':{'asset':actors[(i-1)%len(actors)]}})
    entities.append({'id':'cannon','transform3d':{'position':{'x':0,'y':-3.2,'z':1},'rotation':{'x':-1.57079632679,'y':0,'z':0}},'mesh3d':{'asset':cannon}})
    scene = json.loads((ROOT/'scenes/arena.json').read_text(encoding='utf8'))
    scene['entities'] = entities
    for path,value in [('scenes/arena.json',scene),('assets.json',{'version':1,'assets':manifest}),('asset-provenance.json',{'source_base':'https://prod-maxluck.slam777.com.tw/DragonTycoon3/','conversion':'static textured rest pose; skin weights and clips not imported','files':provenance})]:
        (ROOT/path).write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    print(f'Imported {len(selected)} actor meshes, cannon, floor and {len(selected)+2} original textures.')

if __name__ == '__main__':
    main()

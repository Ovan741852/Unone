"""Import the original GoldCrystal_Hit and its sole declared texture."""
from pathlib import Path
import json, shutil, hashlib, struct
from PIL import Image
ROOT=Path(__file__).resolve().parents[1]
REF=ROOT/'reference/creator'
catalog=json.loads((REF/'collection.json').read_text(encoding='utf8'))['catalog']
effect=next(x for x in catalog if x['bundle']=='game' and x['index']==1865 and x['path'].endswith('.efk'))
texture=next(x for x in catalog if x['bundle']=='game' and x['index']==1435 and Path(x['path']).suffix in ('.webp','.png','.jpg'))
destination=ROOT/'assets/reference/hit';destination.mkdir(parents=True,exist_ok=True)
shutil.copyfile(REF/effect['path'],destination/'GoldCrystal_Hit.efk')
# Lossless PNG transcode of the collected texture, using its original resource
# filename so the unchanged SKFE effect resolves the companion offline.
Image.open(REF/texture['path']).save(destination/'RockCrystal_Dragon.png')
data=(destination/'GoldCrystal_Hit.efk').read_bytes();offset=8;groups=[]
for _ in range(6):
 count=struct.unpack_from('<i',data,offset)[0];offset+=4;items=[]
 for _ in range(count):
  length=struct.unpack_from('<i',data,offset)[0];offset+=4
  items.append(data[offset:offset+length*2].decode('utf-16le').rstrip('\0'));offset+=length*2
 groups.append(items)
assert groups==[['RockCrystal_Dragon.png'],[],[],[],[],[]],groups
path='assets/reference/hit/'
manifest=json.loads((ROOT/'assets.json').read_text(encoding='utf8'))
manifest['assets']=[a for a in manifest['assets'] if a['id']!='effect://reference/hit']
manifest['assets'].append({'id':'effect://reference/hit','kind':'effekseer','source':path+'GoldCrystal_Hit.efk','files':[path+'RockCrystal_Dragon.png'],'encoding':{'format':'efk','mime':'application/octet-stream','decoder':'effekseer','companions':[{'path':path+'RockCrystal_Dragon.png','role':'texture','mime':'image/png'}]}})
(ROOT/'assets.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf8')
provenance={'effect_source':effect['path'],'texture_source':texture['path'],'effect_sha256':hashlib.sha256(data).hexdigest(),'effect_unchanged':True,'texture_conversion':'lossless PNG encoding of decoded collected image','resources':groups}
(ROOT/'hit-provenance.json').write_text(json.dumps(provenance,indent=2)+'\n',encoding='utf8')
print(provenance)

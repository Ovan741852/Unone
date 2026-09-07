"""Materialize the local engine probe using an unchanged collected Creator texture."""
from pathlib import Path
import json, shutil
ROOT=Path(__file__).resolve().parents[1]
REPO=ROOT.parents[1]
def write(name,value):
    path=ROOT/name;path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
source='assets/game/native/03/0342d283-39a9-4e58-aa70-4657100341b8.41bb2.webp'
destination=ROOT/'assets/reference/banner.webp';destination.parent.mkdir(parents=True,exist_ok=True)
shutil.copyfile(ROOT/'reference/creator'/source,destination)
write('asset-provenance.json',{'source_base':'https://prod-maxluck.slam777.com.tw/DragonTycoon3/','files':{'assets/reference/banner.webp':source}})
write('project.unone.json',{'name':'Dragon Tycoon 3 — Unone engine probe','entry_script':'scripts/main.luau','main_scene':'scenes/arena.json','asset_manifest':'assets.json','test_files':['tests/shoot.test.json'],'systems':{'particle':True}})
write('assets.json',{'version':1,'assets':[{'id':'texture://reference/banner','source':'assets/reference/banner.webp','kind':'texture2d'}]})
entities=[{'id':'banner','transform':{'x':0,'y':3.7},'sprite':{'asset':'texture://reference/banner','size':{'x':12,'y':1.05}}}]
for i in range(1,13):
    entities.append({'id':f'target{i}','transform3d':{'position':{'x':(i-1)%4*2-3,'y':(i-1)//4*1.5-1.5,'z':0},'scale':{'x':1.3,'y':0.65,'z':0.8}},'mesh3d':{'asset':'mesh://primitive/sphere'}})
entities.append({'id':'cannon','transform3d':{'position':{'x':0,'y':-3.6,'z':1},'scale':{'x':0.35,'y':1.1,'z':0.35}},'mesh3d':{'asset':'mesh://primitive/box'}})
write('scenes/arena.json',{'entities':entities,'camera3d':{'position':{'x':0,'y':0,'z':10},'target':{'x':0,'y':0,'z':0},'fov_degrees':50},'particle_effects':{'hit':json.loads((REPO/'tests/fixtures/spark.particle.json').read_text(encoding='utf8'))}})
from import_art import main as import_art
import_art()

"""Reproduce concrete engine gaps against the collected game; no game server calls."""
from pathlib import Path
import json, subprocess, shutil
ROOT=Path(__file__).resolve().parents[1];REPO=ROOT.parents[1]
GAME=REPO/'target/debug/game.exe'
def run(name,script,scene,args):
    directory=ROOT/'reference/probes'/name;directory.mkdir(parents=True,exist_ok=True)
    for file,data in [('project.unone.json',{'name':name,'entry_script':'main.luau','main_scene':'scene.json'}),('scene.json',scene)]:
        (directory/file).write_text(json.dumps(data),encoding='utf8')
    if name=='creator-mesh':
        source=ROOT/'reference/creator/assets/game/native/00/00b3e9b7-0f9e-485e-9b2e-018fb32f9770@bb027.eda12.bin'
        shutil.copyfile(source,directory/'floor.bin')
        config=json.loads((directory/'project.unone.json').read_text(encoding='utf8'));config['asset_manifest']='assets.json'
        (directory/'project.unone.json').write_text(json.dumps(config),encoding='utf8')
        (directory/'assets.json').write_text(json.dumps({'version':1,'assets':[{'id':'mesh://creator/scene1_floor','kind':'mesh3d','source':'floor.bin'}]}),encoding='utf8')
    (directory/'main.luau').write_text(script,encoding='utf8')
    process=subprocess.run([str(GAME),'--project',str(directory),*args,'--json'],capture_output=True,encoding='utf8')
    return {'exit_code':process.returncode,'result':json.loads(process.stdout)}
empty='return {start=function(api) end,update=function(api,dt) end}'
results={}
results['creator_mesh_export']=run('creator-mesh',empty,{'entities':[{'id':'floor','transform3d':{},'mesh3d':{'asset':'mesh://creator/scene1_floor'}}]},['export','web','--output',str(ROOT/'reference/probes/unsupported-export')])
results['dynamic_3d_entity']=run('dynamic-entity','return {start=function(api) local id=api.entity.spawn("fish"); api.entity.setTransform3D(id,{position={x=0,y=0,z=0},rotation={x=0,y=0,z=0},scale={x=1,y=1,z=1}}) end,update=function(api,dt) end}',{},['run','--frames','1'])
results['raycast_3d']=run('raycast', 'return {start=function(api) api.physics.raycast3D({x=0,y=0,z=10},{x=0,y=0,z=-1}) end,update=function(api,dt) end}',{},['run','--frames','1'])
report=ROOT/'gap-results.json';report.write_text(json.dumps(results,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
assert all(v['exit_code']!=0 for v in results.values()), 'A gap changed; update the probe and report.'
print(report)

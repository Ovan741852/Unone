import argparse,pathlib,shutil,json
p=argparse.ArgumentParser();p.add_argument('--output',required=True);a=p.parse_args();root=pathlib.Path(a.output);assert not root.exists()
source=pathlib.Path(__file__).resolve().parents[1]/'_Games/legion-native-battle';original=(source/'main.luau').read_text(encoding='utf-8');assert original.count('local DEFAULT_COUNT=100000')==1
for count in [10000,30000,40000,50000,60000,70000,80000,100000]:
 target=root/str(count);shutil.copytree(source,target,ignore=shutil.ignore_patterns('dist','.git'))
 script=original.replace('local DEFAULT_COUNT=100000',f'local DEFAULT_COUNT={count}').replace('local stress=false','local stress=true')
 (target/'main.luau').write_text(script,encoding='utf-8');config=json.loads((target/'project.unone.json').read_text(encoding='utf-8'));config['name']=f'Native battle stress {count}';config['test_files']=[];(target/'project.unone.json').write_text(json.dumps(config),encoding='utf-8')
(root/'conditions.json').write_text(json.dumps({'counts':[10000,30000,40000,50000,60000,70000,80000,100000],'maintain_population':True,'camera':'wide; not all units are visible','attack_caps':'unchanged from game','simulation_hz':20,'note':'Game-owned variants; no gameplay code added to Rust.'},indent=2))

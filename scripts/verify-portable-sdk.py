"""Consumer acceptance: only packaged files, a game fixture and an empty cwd.
Use Python 3.10+. Outputs are retained in a new explicit directory for review.
"""
import argparse,json,pathlib,shutil,subprocess
p=argparse.ArgumentParser();p.add_argument('--sdk',required=True);p.add_argument('--project',required=True);p.add_argument('--output',required=True);a=p.parse_args()
root=pathlib.Path(a.output).resolve();assert not root.exists(), 'choose a new output directory'
root.mkdir(parents=True);sdk=root/'sdk';project=root/'game';cwd=root/'empty';cwd.mkdir()
shutil.copytree(a.sdk,sdk);shutil.copytree(a.project,project,ignore=shutil.ignore_patterns('dist','target','.git'))
manifest=json.loads((sdk/'sdk.json').read_text());exe=sdk/manifest['cli'];checks=[]
def run(args,ok=True,code=None):
 r=subprocess.run([str(exe),*args,'--json'],cwd=cwd,capture_output=True,text=True,encoding='utf-8');v=json.loads(r.stdout)
 assert bool(v['ok'])==ok,(args,r.stdout,r.stderr)
 assert (r.returncode==0)==ok,(args,r.returncode)
 if code:assert code in r.stdout,(code,r.stdout)
 checks.append({'args':args,'ok':v['ok'],'expected_success':ok,'exit':r.returncode});return v
run(['sdk','inspect'])
for dev in [False,True]:
 args=['--project',str(project),'export','platform','--target','web','--output',str(root/('development' if dev else 'production'))]
 if dev:args+=['--development']
 v=run(args);assert v['value']['sdk_selection']['variant']==('development' if dev else 'production')
for target in ['ios','android','android-webview','typo']:
 run(['--project',str(project),'export','platform','--target',target,'--output',str(root/'unsupported')],False,'SDK_TARGET_UNSUPPORTED');assert not (root/'unsupported').exists()
run(['--project',str(project),'export','platform','--target','web','--runtime-id','missing','--output',str(root/'missing')],False,'SDK_RUNTIME_UNAVAILABLE')
config=project/'project.unone.json';config_raw=config.read_bytes();config_data=json.loads(config_raw);config_data.setdefault('systems',{})['physics3d']=True;config.write_text(json.dumps(config_data))
run(['--project',str(project),'export','platform','--target','web','--output',str(root/'incompatible')],False,'SDK_RUNTIME_UNAVAILABLE');assert not (root/'incompatible').exists();config.write_bytes(config_raw)
# A file corruption must fail even though the original repository remains present.
template=sdk/'templates/web/player/index.html';original=template.read_bytes();template.write_bytes(original+b'corrupt')
run(['sdk','inspect'],False,'SDK_HASH_MISMATCH');template.write_bytes(original)
# An unknown manifest key must not silently disappear.
raw=(sdk/'sdk.json').read_bytes();bad=dict(manifest);bad['typo']=True;(sdk/'sdk.json').write_text(json.dumps(bad));run(['sdk','inspect'],False,'SDK_MANIFEST_INVALID');(sdk/'sdk.json').write_bytes(raw)
run(['sdk','inspect'])
r=run(['--project',str(project),'run','--frames','30']);digest=r['value']['observation_digest']
report={'passed':True,'checks':checks,'cli_digest':digest,'sdk_files':len(manifest['files']),'note':'CLI and templates selected from the relocated SDK in an empty cwd; no Rust/Node/build toolchain invoked by export. Unsupported targets create no output.'}
(root/'acceptance.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'passed':True,'checks':len(checks),'cli_digest':digest}))

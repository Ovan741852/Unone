"""Exercise a binary-only native SDK from a clean directory outside the checkout."""
import argparse, hashlib, json, pathlib, shutil, subprocess
p=argparse.ArgumentParser();p.add_argument('--sdk',required=True);p.add_argument('--project',required=True);p.add_argument('--output',required=True);a=p.parse_args()
out=pathlib.Path(a.output).resolve();repo=pathlib.Path(__file__).resolve().parents[1]
if out==repo or repo in out.parents:raise SystemExit('Use an output outside the checkout')
out.mkdir();shutil.copytree(a.sdk,out/'sdk');shutil.copytree(a.project,out/'project');(out/'empty').mkdir()
cli=out/'sdk/bin/game.exe';records=[]
def call(args,ok=True):
 r=subprocess.run([str(x) for x in args],cwd=out/'empty',capture_output=True,text=True,encoding='utf-8');assert (r.returncode==0)==ok,(r.stdout,r.stderr)
 records.append({'command':[str(x).replace(str(out),'<isolated>') for x in args],'exit_code':r.returncode,'stdout':r.stdout,'stderr':r.stderr});return r
call([cli,'sdk','inspect','--json'])
call([cli,'--project',out/'project','export','platform','--target','windows','--output',out/'game','--json'])
player=out/'game/unone-native-player.exe'
call([player,'--root',out/'game','--headless','--frames','12','--warmup','0','--seed','42','--report',out/'run.json'])
report=json.loads((out/'run.json').read_text());assert report['frame']==12 and not report['error']
asset=out/'game/content/assets/palette.png';original=asset.read_bytes()
try:
 asset.write_bytes(original+b'corrupt')
 result=call([player,'--root',out/'game','--headless','--frames','1'],False)
 assert 'NATIVE_HASH_MISMATCH' in result.stderr
finally:asset.write_bytes(original)
(out/'evidence.json').write_text(json.dumps({'passed':True,'checks':records,'frame':report['frame'],'digest':report['observation_digest'],'runtime_sha256':hashlib.sha256(player.read_bytes()).hexdigest()},indent=2),encoding='utf-8')
print(json.dumps({'passed':True,'evidence':str(out/'evidence.json')}))

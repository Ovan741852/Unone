"""Archive and verify the previously built Web/Android art slice."""
from pathlib import Path
import hashlib
import json
import zipfile

root = Path(__file__).resolve().parents[1]
web = root / 'dist/web'
export = json.loads((web/'export.json').read_text(encoding='utf8'))
zip_path = root/'dist/dragon-tycoon3-web.zip'
with zipfile.ZipFile(zip_path,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as archive:
    for path in sorted(web.rglob('*')):
        if path.is_file():
            archive.write(path,path.relative_to(web).as_posix())
packages = {'date':'2026-09-08','art':{'original_meshes':8,'unchanged_original_textures':8,'original_effects':1,'transcoded_effect_textures':1,'actor_variants':6,'instances':12,'skeletal_animation':False}}
for name,path,prefix in [('web',zip_path,''),('android',root/'dist/dragon-tycoon3-android.apk','assets/player/')]:
    with zipfile.ZipFile(path) as archive:
        for item in export['files']:
            assert hashlib.sha256(archive.read(prefix+item['path'])).hexdigest() == item['sha256'], item['path']
    packages[name] = {'file':path.relative_to(root).as_posix(),'bytes':path.stat().st_size,'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'verified_export_files':len(export['files'])}
# Preserve separately recorded manual observations only when the artifact hash
# is unchanged; packaging itself does not prove visual/interaction correctness.
report = root/'distributions.json'
old = json.loads(report.read_text(encoding='utf8')) if report.exists() else {}
for name in ('web','android'):
    if old.get(name,{}).get('sha256') == packages[name]['sha256'] and 'validation' in old[name]:
        packages[name]['validation'] = old[name]['validation']
report.write_text(json.dumps(packages,indent=2)+'\n',encoding='utf8')
print(json.dumps(packages,indent=2))

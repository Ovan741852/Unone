"""Reproducible NativeActivity benchmark; JSON/PNG evidence is read from app-specific storage."""
import argparse,json,os,pathlib,subprocess,time,hashlib
p=argparse.ArgumentParser();p.add_argument('--capture',action='store_true');p.add_argument('--package',required=True);p.add_argument('--runtime',required=True);p.add_argument('--device',required=True);p.add_argument('--output',required=True);p.add_argument('--seconds',type=float,default=30);p.add_argument('--frames',type=int,default=0);p.add_argument('--fixed-tick',action='store_true');p.add_argument('--freeze-simulation',action='store_true');p.add_argument('--disable-lod',action='store_true');p.add_argument('--warmup',type=int,default=60);p.add_argument('--prewarm',type=int,default=300);a=p.parse_args()
r=pathlib.Path(a.package).resolve();output=pathlib.Path(a.output).resolve();assert not output.exists()
sdk=pathlib.Path(os.environ['ANDROID_HOME']);adb=str(sdk/'platform-tools/adb.exe');remote='/sdcard/Android/data/com.unone.nativeplayer/files/benchmark.json'
def run(args,**kw):return subprocess.run(args,check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,**kw)
def device(*args):return run([adb,'-s',a.device,*args])
settings={'seed':42,'frames':a.frames,'measure_seconds':a.seconds,'warmup':a.warmup,'prewarm_ticks':a.prewarm,'fixed_tick':a.fixed_tick,'freeze_simulation':a.freeze_simulation,'disable_lod':a.disable_lod}
capture_remote='/sdcard/Android/data/com.unone.nativeplayer/files/capture-'+str(time.time_ns())
if a.capture:settings['capture_dir']=capture_remote
(r/'native-player.json').write_text(json.dumps(settings))
pack=pathlib.Path(__file__).resolve().with_name('pack-native-android.ps1')
# Build/sign before the timing window; no build tools run during measurement.
run(['powershell.exe','-NoProfile','-File',str(pack),'-ContentRoot',str(r),'-RuntimeRoot',str(pathlib.Path(a.runtime).resolve()),'-Target','android-x86_64'])
device('install','-r',str(r/'game.apk'));device('shell','am','force-stop','com.unone.nativeplayer');device('shell','rm','-f',remote)
device('shell','am','start','-n','com.unone.nativeplayer/android.app.NativeActivity')
deadline=time.monotonic()+max(180,a.seconds*5)
while time.monotonic()<deadline:
 time.sleep(2)
 result=subprocess.run([adb,'-s',a.device,'exec-out','cat',remote],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 if result.returncode==0:
  try:report=json.loads(result.stdout)
  except (ValueError,UnicodeError):continue
  report['artifact_evidence']={'apk_sha256':hashlib.sha256((r/'game.apk').read_bytes()).hexdigest(),'runtime_sha256':hashlib.sha256((pathlib.Path(a.runtime)/'libunone_native_player.so').read_bytes()).hexdigest(),'device_serial':a.device};output.parent.mkdir(parents=True,exist_ok=True);output.write_text(json.dumps(report,indent=2));device('pull',remote.removesuffix('.json')+'.png',str(output.with_suffix('.png')))
  print(json.dumps({'output':str(output),'fps':report.get('fps'),'p95_ms':(report.get('interval') or {}).get('p95_ms'),'simulation_hz':report.get('simulation_hz_measured'),'error':report.get('error')}));break
else:raise RuntimeError('ANDROID_BENCHMARK_TIMEOUT: inspect adb logcat UnoneNativePlayer; multipart messages use [part n/total]')
if report.get('error'):raise RuntimeError(report['error'])

if a.capture:device('pull',capture_remote,str(output.with_suffix(''))+'-frames')

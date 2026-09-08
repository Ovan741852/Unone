"""Encode native renderer PNG readbacks at their measured wall-clock cadence."""
import argparse,json,pathlib,subprocess
p=argparse.ArgumentParser();p.add_argument('--capture',required=True);p.add_argument('--ffmpeg',required=True);p.add_argument('--output',required=True);a=p.parse_args()
r=pathlib.Path(a.capture).resolve();frames=json.loads((r/'frames.json').read_text())['frames'];assert len(frames)>1
lines=[]
for i,(name,t) in enumerate(frames):
 assert pathlib.Path(name).name==name and name.endswith('.png')
 lines += [f"file '{name}'",f"duration {frames[i+1][1]-t if i+1<len(frames) else .1:.9f}"]
lines += [f"file '{frames[-1][0]}'"]
f=r/'capture.ffconcat';f.write_text('\n'.join(lines)+'\n')
subprocess.run([a.ffmpeg,'-y','-f','concat','-safe','1','-i',str(f),'-vf','scale=960:-2','-fps_mode','vfr','-c:v','libx264','-crf','22','-pix_fmt','yuv420p',a.output],check=True)

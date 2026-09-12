"""Summarize native battle evidence without treating render-only runs as live FPS."""
import argparse,json,pathlib,math
p=argparse.ArgumentParser();p.add_argument('reports',nargs='+');p.add_argument('--output',required=True);a=p.parse_args();rows=[]
for name in a.reports:
 d=json.loads(pathlib.Path(name).read_text(encoding='utf-8'));m=d['measurement'];interval=d.get('interval') or {};fps=d.get('fps',0);hz=d.get('simulation_hz_measured',0);p95=interval.get('p95_ms',math.inf)
 valid=not d.get('error') and not any(m.get(k) for k in ['capture_enabled','fixed_tick','freeze_simulation']) and d.get('measured_seconds',0)>=30 and d.get('profile')=='release'
 batches=[b for b in d.get('presentation_batches',[]) if b['asset'].startswith(('mesh://red-','mesh://blue-'))]
 row={'report':pathlib.Path(name).name,'host':d['host'],'resolution':d.get('resolution'),'population':d['battle']['total'],'frustum_troops_last_frame':sum(b['frustum_candidates'] for b in batches),'troop_triangles_last_frame':sum(b['submitted_triangles'] for b in batches),'all_mesh_triangles_last_frame':d['mesh_triangles_last_frame'],'fps':fps,'p95_ms':p95,'max_ms':interval.get('max_ms'),'simulation_hz':hz,'dropped_ticks':d['dropped_ticks'],'eligible_live_benchmark':valid,'mean_60fps_class':bool(valid and fps>=59 and hz>=59.5 and d['dropped_ticks']==0),'p95_within_60fps_budget':bool(valid and p95<=1000/60 and hz>=59.5 and d['dropped_ticks']==0)}
 assert sum(b['input_instances'] for b in batches)==row['population'], 'Battle troop batches missing or ambiguous'
 assert row['frustum_troops_last_frame']<=row['population'];rows.append(row)
result={'criteria':{'duration_seconds_min':30,'mean_60fps_class':'mean FPS >=59; simulation Hz >=59.5; zero dropped ticks; live release run, no capture/fixed tick/freeze','p95_within_60fps_budget':'p95 <=16.6667ms plus simulation Hz >=59.5 and zero dropped ticks; does not mean every frame meets budget','counts':'last-frame conservative frustum candidates, not unoccluded pixels; triangles exclude particle quads','scope':'highest TESTED loads on the recorded devices/resolutions, not engine-wide capacity'},'runs':rows}
pathlib.Path(a.output).write_text(json.dumps(result,indent=2),encoding='utf-8');print(json.dumps(rows))

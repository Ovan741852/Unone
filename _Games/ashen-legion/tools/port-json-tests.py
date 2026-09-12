from pathlib import Path
import json
root=Path(__file__).resolve().parents[1]/'tests';archive=root/'legacy-90sec';archive.mkdir(exist_ok=True)
for name in ['discount-refund','seven-round-victory']:
 p=root/(name+'.test.json')
 if p.exists():p.rename(archive/p.name)
for p in root.glob('*.test.json'):
 d=json.loads(p.read_text(encoding='utf-8'))
 if d.get('rulesVersion')=='rpg-180-v2':continue
 seq=d.get('input_sequence',[]);name=p.stem
 # A location choice enters a shop now. Insert an independent LeaveShop edge.
 choice=next((i for i,x in enumerate(seq) if any(k.startswith('Choice') for k in x.get('actions',{}))),None)
 if choice is not None:
  seq[choice+1:choice+1]=[{}, {'actions':{'LeaveShop':True}},{}];d['frames']+=3
 if name.startswith('boss-'):
  d['frames']+=5400
 if name.startswith('timeout-'):
  # Keep the end-of-round deployment at the same time relative to the new timeout.
  seq[8:8]=[{} for _ in range(5400)];d['frames']+=5400
 d['input_sequence']=seq;d['rulesVersion']='rpg-180-v2'
 p.write_text(json.dumps(d,ensure_ascii=False,separators=(',',':')),encoding='utf-8')

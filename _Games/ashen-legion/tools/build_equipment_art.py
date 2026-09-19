"""Repo-native vector equipment art. Each ability has a named, original icon."""
import re,json,colorsys
from pathlib import Path
root=Path(__file__).resolve().parents[1];source=(root/'main.luau').read_text(encoding='utf-8')
gear=[(n,int(slot),skill,int(price)) for n,slot,skill,price in re.findall(r'\{name="([^"]+)",slot=(\d),skill="([^"]+)",price=(\d+)\}',source)]
gear += [(n,int(slot),skill,int(price)) for n,slot,skill,price in re.findall(r'\{"([^"]+)",(\d),"([^"]+)",(\d+)\}',source) if skill in ['wall_quake','short_fuse','wide_blade','hit_echo','fracture','solo_hunt','crowd_ring','recruit','rally','rapid','solitary','showdown','sharp','giant','double_pierce','deadly']]
out=root/'design-v1/svg';manifest=[]
new_skills={'plunder','firstborn','march_capacitor','delayed_bloom','third_pulse','battle_elegy','grave_bloom','last_echo','flame_cloak','phoenix_fire','plague_vial','ember_trail','slick_oil','rain_strike','storm_touch','oil_legacy'}
gear=[g for g in gear if g[2] not in new_skills]+[g for g in gear if g[2] in new_skills]
old=json.loads((root/'design-v1/equipment-manifest.json').read_text(encoding='utf8'));order={x['id']:i for i,x in enumerate(old)}
gear.sort(key=lambda g:order.get(g[2],len(order)))
from icon_art import write_all
manifest=[{'id':skill,'name':name,'slot':slot,'price':price,'image':'svg/gear-'+skill+'.svg'} for name,slot,skill,price in gear]
assert len(manifest)==len({x['id'] for x in manifest}), 'duplicate equipment'
skill_names=dict(re.findall(r'\{"([a-z_]+)","([^"]+)","[^"]+",\d+\}',source))
write_all(out,manifest,skill_names)
(root/'design-v1/equipment-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf8')
print('EQUIPMENT_AND_SKILL_ICONS_READY',len(manifest))

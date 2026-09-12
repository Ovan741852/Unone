"""Repo-native vector equipment art. Each ability has a named, original icon."""
import re,json,colorsys
from pathlib import Path
root=Path(__file__).resolve().parents[1];source=(root/'main.luau').read_text(encoding='utf-8')
gear=[(n,int(slot),skill,int(price)) for n,slot,skill,price in re.findall(r'\{name="([^"]+)",slot=(\d),skill="([^"]+)",price=(\d+)\}',source)]
gear += [(n,int(slot),skill,int(price)) for n,slot,skill,price in re.findall(r'\{"([^"]+)",(\d),"([^"]+)",(\d+)\}',source) if skill in ['wall_quake','short_fuse','wide_blade','hit_echo','fracture','solo_hunt','crowd_ring','recruit','rally','rapid','solitary','showdown','sharp','giant','double_pierce','deadly']]
out=root/'design-v1/svg';manifest=[]
for i,(name,slot,skill,price) in enumerate(gear):
 h=(i*.137)%1;c='#'+''.join(f'{int(v*255):02x}' for v in colorsys.hls_to_rgb(h,.49,.4));light='#f0d99c';dark='#243e3d'
 shapes={
 1:f'<path d="M53 144L59 89L91 52H161L195 91L200 144L169 172V115H89V172Z" fill="{c}"/><path d="M60 92L126 60L192 92L170 105H84Z" fill="{light}"/><path d="M97 112H119V153H97ZM137 112H159V153H137Z" fill="{dark}"/>',
 2:f'<path d="M88 56L111 70H145L168 56L207 89L188 123L169 106L177 193H79L87 106L68 123L49 89Z" fill="{c}"/><path d="M110 74L126 118L145 74L145 168L127 185L110 168Z" fill="{light}"/><path d="M78 152H178V169H78Z" fill="{dark}"/>',
 3:f'<path d="M65 56H105L102 156L131 172L126 195H51V162L60 150Z" fill="{c}"/><path d="M142 48H182L180 152L212 176L208 196H132V165L138 152Z" fill="{c}"/><path d="M52 178H128V196H52ZM133 179H210V197H133Z" fill="{light}"/><path d="M61 84H105V99H61ZM140 77H182V92H140Z" fill="{dark}"/>',
 4:f'<path d="M55 139L54 85L68 74L81 105L82 60L98 58L105 100L110 51L127 53L131 104L142 66L158 73L157 129L177 111L191 122L170 158L146 182L92 189Z" fill="{c}"/><path d="M84 168L151 160L166 195L95 209Z" fill="{light}"/><path d="M86 119L127 98L153 127L121 148Z" fill="{dark}"/>',
 5:f'<path d="M65 200L76 215L115 169L101 155Z" fill="{dark}"/><path d="M83 137L130 181L144 164L99 121Z" fill="{light}"/><path d="M112 139L154 76L196 37L183 91L136 160Z" fill="{c}"/><path d="M112 139L196 37L126 150Z" fill="{light}"/>'
 }[slot]
 # Small ability sigils use paths, not font-dependent glyphs.
 if any(x in skill for x in ['crit','lightning','deadly']):sigil='<path d="M130 83L107 130H127L116 169L151 119H132L147 83Z"/>'
 elif any(x in skill for x in ['life','vigor','recruit']):sigil='<path d="M119 103H137V119H153V137H137V153H119V137H103V119H119Z"/>'
 elif any(x in skill for x in ['spin','wave','echo','shock','wide']):sigil='<path d="M93 141A39 39 0 1 1 155 158L163 133L144 139A24 24 0 1 0 109 142Z"/>'
 elif any(x in skill for x in ['frost','shatter']):sigil='<path d="M125 91H131V165H125ZM93 107L96 102L164 148L160 153ZM93 148L160 102L164 107L96 153Z"/>'
 else:sigil='<path d="M128 92L149 126L128 163L107 126ZM128 109L118 126L128 144L138 126Z" fill-rule="evenodd"/>'
 svg=f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" role="img" aria-label="{name}"><title>{name}</title><path d="M128 8L232 64V192L128 248L24 192V64Z" fill="#16332e"/><path d="M128 21L219 71V185L128 235L37 185V71Z" fill="#25483e" stroke="#bdac78" stroke-width="3"/><g stroke="{dark}" stroke-width="5" stroke-linejoin="bevel">{shapes}</g><circle cx="128" cy="128" r="35" fill="#1b3637" stroke="{light}" stroke-width="3"/><g fill="{light}" transform="translate(12 12) scale(.9)">{sigil}</g><path d="M58 217H91M165 217H198" stroke="{c}" stroke-width="6"/></svg>'
 filename='gear-'+skill+'.svg';(out/filename).write_text(svg,encoding='utf-8');manifest.append({'id':skill,'name':name,'slot':slot,'price':price,'image':'svg/'+filename})
(root/'design-v1/equipment-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
assert len(manifest)==45,len(manifest)
print('EQUIPMENT_ART_READY',len(manifest))

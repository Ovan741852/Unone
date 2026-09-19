"""Editable, faceted illustration materials derived from Hazel's portrait.

The semantic drawings stay in icon_art.py. This pass shades their individual
planes, rather than adding a common coloured tile behind every icon. SVGs are
baked to PNG by the existing UI exporter; there is no runtime filter cost.
"""
from copy import deepcopy
import colorsys
import xml.etree.ElementTree as ET

NS = 'http://www.w3.org/2000/svg'
ET.register_namespace('', NS)
def el(tag, attrs=None): return ET.Element('{'+NS+'}'+tag, attrs or {})
def rgb(c): return tuple(int(c[i:i+2],16)/255 for i in (1,3,5))
def mix(a,b,t): return '#'+''.join(f'{round((x*(1-t)+y*t)*255):02x}' for x,y in zip(rgb(a),rgb(b)))

def tint(c):
    if not c.startswith('#') or len(c)!=7: return c
    h,s,v=colorsys.rgb_to_hsv(*rgb(c))
    if v<.29: return mix(c,'#382d23',.46)
    if s<.23: return mix(c,'#e9d9ba' if v>.65 else '#536451',.22)
    if .43<h<.62: return mix(c,'#567e6f',.28)
    if .06<h<.20: return mix(c,'#d0a455',.13)
    return mix(c,'#ad754a',.06)

def illustrate(source):
    root=ET.fromstring(source)
    root.set('data-art-style','hazel-faceted-v1')
    defs=el('defs');root.insert(0,defs)
    # Asymmetrical planes, deliberately fewer in the centre of the silhouette.
    pattern=el('pattern',{'id':'hazel-planes','width':'1','height':'1','patternContentUnits':'objectBoundingBox'})
    facets=[
      ('0,0 .47,0 .18,.21','#fff0c8','.20'),
      ('.47,0 .84,0 .62,.23 .18,.21','#eed3a4','.11'),
      ('0,0 .18,.21 .05,.51 0,.39','#fff0cb','.12'),
      ('.18,.21 .62,.23 .32,.44','#f5e0be','.085'),
      ('.84,0 1,0 1,.37 .62,.23','#2b3529','.20'),
      ('.62,.23 1,.37 .71,.56','#344338','.13'),
      ('.05,.51 .18,.21 .32,.44 .17,.7','#eedbbc','.07'),
      ('.32,.44 .71,.56 .34,.81','#193e34','.12'),
      ('1,.37 1,.83 .71,.56','#13332e','.15'),
      ('0,.39 .05,.51 .17,.7 0,.92','#f4d99e','.12'),
      ('.17,.7 .34,.81 .11,1 0,1 0,.92','#372d24','.19'),
      ('.34,.81 .71,.56 .65,.92 .39,1 .11,1','#414a32','.11'),
      ('.71,.56 1,.83 1,1 .65,.92','#152d2a','.21'),
      ('.65,.92 1,1 .39,1','#f0c77e','.10'),
    ]
    for points,color,opacity in facets:pattern.append(el('polygon',{'points':points,'fill':color,'opacity':opacity}))
    defs.append(pattern)
    rim=el('linearGradient',{'id':'hazel-rim','x1':'0','y1':'0','x2':'.85','y2':'1'})
    for offset,color in [('0','#ffe7ad'),('.34','#b99250'),('.62','#66503b'),('1','#29382c')]:rim.append(el('stop',{'offset':offset,'stop-color':color}))
    defs.append(rim)
    texture=el('filter',{'id':'hazel-pigment','x':'0','y':'0','width':'100%','height':'100%','color-interpolation-filters':'sRGB'})
    texture.append(el('feTurbulence',{'type':'fractalNoise','baseFrequency':'.73','numOctaves':'2','seed':'23','result':'grain'}))
    texture.append(el('feColorMatrix',{'in':'grain','type':'saturate','values':'0'}))
    transfer=el('feComponentTransfer');transfer.append(el('feFuncA',{'type':'linear','slope':'.045'}));texture.append(transfer)
    texture.append(el('feComposite',{'operator':'in','in2':'SourceAlpha','result':'grain'}))
    texture.append(el('feBlend',{'in':'SourceGraphic','in2':'grain','mode':'soft-light'}));defs.append(texture)
    gradients={}
    def material(c):
        if c in gradients:return gradients[c]
        base=tint(c);h,s,v=colorsys.rgb_to_hsv(*rgb(base));gold=.055<h<.18 and s>.35
        light=mix(base,'#ffe9b8',.38 if gold else .16)
        shade=mix(base,'#4c3324' if gold else '#233d33',.40 if gold else .27)
        id='hazel-material-'+str(len(gradients));g=el('linearGradient',{'id':id,'x1':'.12','y1':'0','x2':'.83','y2':'1'})
        for offset,color in [('0',light),('.27',base),('.65',mix(base,shade,.45)),('1',shade)]:g.append(el('stop',{'offset':offset,'stop-color':color}))
        defs.append(g);gradients[c]='url(#'+id+')';return gradients[c]
    def visit(parent):
        for node in list(parent):
            tag=node.tag.rsplit('}',1)[-1]
            if tag in ['defs','title','desc']:continue
            if tag=='g':visit(node);continue
            if tag not in ['path','polygon','circle','ellipse','rect']:continue
            fill=node.get('fill','none');stroke=node.get('stroke')
            if stroke and stroke.startswith('#'):
                if max(rgb(stroke))<.35:
                    node.set('stroke','#463728');node.set('stroke-width',str(float(node.get('stroke-width','1'))*.36))
                else:node.set('stroke',material(stroke))
            if fill=='none' or not fill.startswith('#'):continue
            node.set('fill',material(fill))
            if max(rgb(fill))<.30:continue
            at=list(parent).index(node)
            planes=deepcopy(node);planes.attrib.pop('stroke',None);planes.attrib.pop('stroke-width',None);planes.set('fill','url(#hazel-planes)')
            # Material planes are clipped by the original fill, including holes.
            parent.insert(at+1,planes)
            if stroke:
                edge=deepcopy(node);edge.set('fill','none');edge.set('stroke','url(#hazel-rim)');edge.set('stroke-width','.48');edge.set('opacity','.6');parent.insert(at+2,edge)
    visit(root)
    paint=el('g',{'filter':'url(#hazel-pigment)'})
    for node in list(root):
        if node is not defs and node.tag.rsplit('}',1)[-1]!='title':root.remove(node);paint.append(node)
    root.append(paint)
    return ET.tostring(root,encoding='unicode')

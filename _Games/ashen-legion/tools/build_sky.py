"""Seam-matched six-face skybox atlas, sampled from one world-direction function."""
from pathlib import Path
import math,json
from PIL import Image
root=Path(__file__).resolve().parents[1];n=256;tile=n+2
faces=[[(1,-1,-1),(1,-1,1),(1,1,1),(1,1,-1)],[(-1,-1,1),(-1,-1,-1),(-1,1,-1),(-1,1,1)],[(-1,1,-1),(1,1,-1),(1,1,1),(-1,1,1)],[(-1,-1,1),(1,-1,1),(1,-1,-1),(-1,-1,-1)],[(-1,-1,1),(1,-1,1),(1,1,1),(-1,1,1)],[(1,-1,-1),(-1,-1,-1),(-1,1,-1),(1,1,-1)]]
assets=[a for a in json.loads((root/'assets.json').read_text())['assets'] if not a['id'].startswith(('texture://sky_','mesh://sky_'))]
for theme,top,horizon in [('forest',(153,173,162),(214,206,170)),('forest_dusk',(103,93,122),(223,161,127))]:
    image=Image.new('RGB',(tile*3,tile*2));pixels=image.load();positions=[];uvs=[]
    for f,corners in enumerate(faces):
        ox=(f%3)*tile;oy=(f//3)*tile
        for py in range(tile):
            for px in range(tile):
                u=max(0,min(1,(px-1)/(n-1)));v=1-max(0,min(1,(py-1)/(n-1)))
                p=[corners[0][k]*(1-u)*(1-v)+corners[1][k]*u*(1-v)+corners[2][k]*u*v+corners[3][k]*(1-u)*v for k in range(3)]
                length=math.sqrt(sum(x*x for x in p));x,y,z=[x/length for x in p]
                t=max(0,min(1,y))**.65;col=[horizon[k]*(1-t)+top[k]*t for k in range(3)]
                # Direction-continuous soft clouds and pale distant canopy.
                cloud=max(0,math.sin(x*19+z*9)+math.sin(z*23-x*7)-1.1)*max(0,1-abs(y+.12)*3)*.65
                pixels[ox+px,oy+py]=tuple(round(c*(1-cloud)+247*cloud) for c in col)
        faceuv=[((ox+1.5)/(tile*3),1-(oy+n+.5)/(tile*2)),((ox+n+.5)/(tile*3),1-(oy+n+.5)/(tile*2)),((ox+n+.5)/(tile*3),1-(oy+1.5)/(tile*2)),((ox+1.5)/(tile*3),1-(oy+1.5)/(tile*2))]
        for i in [0,1,2,0,2,3]:positions.extend([corners[i][0]*150,corners[i][1]*150+15,corners[i][2]*150]);uvs.extend(faceuv[i])
    name='sky_'+theme;image.save(root/'assets'/f'{name}.png')
    mesh={'version':1,'positions':positions,'uvs':uvs,'indices':list(range(len(positions)//3)),'texture':'texture://'+name}
    (root/'assets'/f'{name}.mesh.json').write_text(json.dumps(mesh,separators=(',',':')))
    assets.extend([{'id':'texture://'+name,'kind':'texture2d','source':f'assets/{name}.png'},{'id':'mesh://'+name,'kind':'mesh3d','source':f'assets/{name}.mesh.json','encoding':{'mime':'application/json','companions':[],'decoder':'mesh','format':'unone-mesh-json'}}])
(root/'assets.json').write_text(json.dumps({'assets':assets},indent=2))

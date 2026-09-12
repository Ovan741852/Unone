"""Deterministic offline vertex-cluster LODs for unone-mesh-json (inspect silhouettes).
Runtime uses authored geometry; it never simplifies a mesh during gameplay.
"""
import argparse,json,math,pathlib

def simplify(mesh,cells):
 positions=mesh['positions'];uvs=mesh['uvs'];vertices=[positions[i:i+3] for i in range(0,len(positions),3)]
 lo=[min(v[a] for v in vertices) for a in range(3)];hi=[max(v[a] for v in vertices) for a in range(3)]
 groups={};mapping=[];out=[];outuv=[]
 for i,v in enumerate(vertices):
  key=tuple(round((v[a]-lo[a])/max(hi[a]-lo[a],1e-8)*cells) for a in range(3))
  if key not in groups:groups[key]=len(out)//3;out+=v;outuv+=uvs[i*2:i*2+2]
  mapping.append(groups[key])
 indices=[];seen=set()
 for i in range(0,len(mesh['indices']),3):
  tri=[mapping[n] for n in mesh['indices'][i:i+3]];key=tuple(sorted(tri))
  if len(set(tri))==3 and key not in seen:seen.add(key);indices+=tri
 return {'positions':out,'uvs':outuv,'indices':indices}

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--mesh',required=True);p.add_argument('--output',required=True);p.add_argument('--distances',default='45,120,250');p.add_argument('--cells',default='6,3,2');a=p.parse_args()
 mesh=json.loads(pathlib.Path(a.mesh).read_text());distances=list(map(float,a.distances.split(',')));cells=list(map(int,a.cells.split(',')));assert len(cells)==len(distances)<=3
 assert all(math.isfinite(d) and d>0 for d in distances) and distances==sorted(set(distances)) and all(c>0 for c in cells)
 previous=len(mesh['indices']);levels=[]
 for distance,n in zip(distances,cells):
  level=simplify(mesh,n)
  if 0<len(level['indices'])<previous:levels.append(dict(distance=distance,**level));previous=len(level['indices'])
 mesh['lods']=levels;pathlib.Path(a.output).write_text(json.dumps(mesh,separators=(',',':'))+'\n');print(json.dumps({'mesh':a.mesh,'triangles':[len(mesh['indices'])//3]+[len(l['indices'])//3 for l in levels]}))

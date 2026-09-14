// Game-owned low-poly boundary artwork. Inner stone face follows Luau's collision extent.
export function createArenaWalls({THREE:T,scene}){
 const root=new T.Group();root.name='arena-collision-walls';scene.add(root);
 const geometry=new T.BoxGeometry(1,1,1),materials=[0x827967,0xb2a887,0x594b51].map(color=>new T.MeshStandardMaterial({color,roughness:1,flatShading:true}));
 let extent=0;
 function box(x,y,z,w,h,d,material=0){const mesh=new T.Mesh(geometry,materials[material]);mesh.position.set(x,y,z);mesh.scale.set(w,h,d);root.add(mesh);}
 function update(game){
  const size=game?.arenaHalfExtent;if(!size||size===extent)return;
  extent=size;root.clear();const thickness=.36,center=size+thickness/2,length=2*(size+thickness);
  for(const sign of [-1,1]){
   box(0,.2,sign*center,length,.4,thickness);box(sign*center,.2,0,thickness,.4,length);
   box(0,.42,sign*center,length,.08,thickness,1);box(sign*center,.42,0,thickness,.08,length,1);
   const count=Math.ceil(length/.85),step=length/count;
   for(let i=0;i<count;i++){const p=-length/2+step*(i+.5);box(p,.55,sign*center,.38,.22,thickness,1);box(sign*center,.55,p,thickness,.22,.38,1);}
  }
  for(const x of [-1,1])for(const z of [-1,1])box(x*(size+.28),.38,z*(size+.28),.56,.76,.56,2);
 }
 return {update,inspect:()=>({halfExtent:extent,innerFace:extent,height:.66,segments:root.children.length}),dispose(){root.removeFromParent();geometry.dispose();materials.forEach(m=>m.dispose());}};
}

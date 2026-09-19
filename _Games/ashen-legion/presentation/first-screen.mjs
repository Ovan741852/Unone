// Prepare only images referenced by the actual first UI tree. Pass the decoded
// images through the official canvas UI's asset resolver, avoiding a second load.
export function createFirstScreenAssets(assets,{onProgress=()=>{}}={}){
 const manifest=new Map(assets.assets.map(a=>[a.id,a])),images=new Map();
 function resolve(id){
  const a=manifest.get(id);if(!a)throw Error('Missing UI asset '+id);
  return images.get(id)??new URL('content/'+a.source,location.href).href;
 }
 async function prepare(tree){
  const ids=new Set();function walk(nodes){for(const n of nodes??[]){if(n.kind==='image')ids.add(n.asset);if(n.children)walk(n.children)}}walk(tree?.children);
  let done=0;onProgress(done,ids.size);
  await Promise.all([...ids].map(async id=>{
   const image=new Image();image.src=resolve(id);
   try{await image.decode()}catch{throw Error('首屏圖片載入失敗：'+id)}
   images.set(id,image);onProgress(++done,ids.size);
  }));return [...ids];
 }
 return {resolve,prepare};
}

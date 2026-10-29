import {meshGeometry} from '../renderer/mesh.js';

// Backends without a heightfield adapter must still reject partial scenes.
export function rejectUnsupportedHeightfields(snapshot, backend = 'web') {
  const world = snapshot?.world ?? snapshot;
  const heightfields = world?.heightfields;
  if (heightfields === undefined || heightfields === null) return;
  if (typeof heightfields === 'object' && !Array.isArray(heightfields) && Object.keys(heightfields).length === 0) return;
  const ids = typeof heightfields === 'object' && heightfields !== null ? Object.keys(heightfields).sort() : [];
  const error = new Error(`HEIGHTFIELD_BACKEND_UNSUPPORTED: ${backend} does not render heightfields; use the official native player`);
  error.code = 'HEIGHTFIELD_BACKEND_UNSUPPORTED';
  error.facts = {backend, heightfield_ids: ids};
  throw error;
}

function invalid(message) {
  const error=new Error(`HEIGHTFIELD_INVALID: ${message}`);
  error.code='HEIGHTFIELD_INVALID';
  throw error;
}
const byteLength=value=>new TextEncoder().encode(value).length;
const bounded=value=>Number.isFinite(value)&&Math.abs(value)<=100000;

/** Validate the shared, flattened Heightfield snapshot without mutating it. */
export function heightfieldEntries(snapshot) {
  const fields=(snapshot?.world??snapshot)?.heightfields;
  if(fields===undefined||fields===null)return [];
  if(typeof fields!=='object'||Array.isArray(fields))invalid('heightfields must be an object');
  const entries=Object.entries(fields).sort(([a],[b])=>a.localeCompare(b));
  if(entries.length>16)invalid('at most16 heightfields');
  let samples=0;
  for(const [id,d] of entries) {
    if(!id||byteLength(id)>128||!d||typeof d!=='object'||Array.isArray(d))invalid('id or definition');
    if(!Number.isInteger(d.width)||!Number.isInteger(d.depth)||d.width<2||d.width>512||d.depth<2||d.depth>512)invalid('width/depth');
    samples+=d.width*d.depth;
    if(samples>1048576)invalid('world sample limit');
    if(!Number.isFinite(d.cell_size)||d.cell_size<=0||d.cell_size>10000)invalid('cell_size');
    const o=d.origin;
    if(!o||![o.x,o.y,o.z,o.x+(d.width-1)*d.cell_size,o.z+(d.depth-1)*d.cell_size].every(bounded))invalid('origin or extent');
    if(!Array.isArray(d.heights)||d.heights.length!==d.width*d.depth||!d.heights.every(h=>bounded(h)&&bounded(o.y+h)))invalid('heights');
    if(typeof d.texture!=='string'||!d.texture||byteLength(d.texture)>256)invalid('texture asset');
    const r=d.revision;
    if(!(Number.isSafeInteger(r)&&r>0)&&!(typeof r==='string'&&/^[1-9][0-9]{0,19}$/.test(r)&&BigInt(r)<=18446744073709551615n))invalid('revision');
  }
  return entries;
}

/** Same X-fast positions and upward a,c,b / b,c,d winding as Core mesh().
 * Three TextureLoader flips image rows; use the native renderer's1-v conversion.
 * Origin stays a mesh transform, exactly as in the native adapter.
 */
export function heightfieldMeshData(d) {
  const positions=[],uvs=[],indices=[],cell=Math.fround(d.cell_size);
  for(let z=0;z<d.depth;z++)for(let x=0;x<d.width;x++) {
    positions.push(Math.fround(x*cell),Math.fround(d.heights[z*d.width+x]),Math.fround(z*cell));
    uvs.push(Math.fround(x/(d.width-1)),Math.fround(1-Math.fround(z/(d.depth-1))));
    if(x+1<d.width&&z+1<d.depth) {
      const a=z*d.width+x;
      indices.push(a,a+d.width,a+1,a+1,a+d.width,a+d.width+1);
    }
  }
  return {version:1,positions,uvs,indices,texture:d.texture};
}

/** Generic Three presentation cache. Texture loading remains host-owned. */
export function createHeightfieldRenderer(THREE,scene,textureFor) {
  const records=new Map();
  let rebuilds=0;
  const dispose=record=>{scene.remove(record.mesh);record.mesh.geometry.dispose();record.material.dispose();};
  function draw(entries,specs) {
    const alive=new Set();
    for(const [id,d] of entries) {
      const spec=specs.get(d.texture);
      if(spec?.kind!=='texture2d')throw new Error(`HEIGHTFIELD_TEXTURE_MISSING: ${d.texture}`);
      const texture=textureFor(spec);
      if(!texture)throw new Error(`HEIGHTFIELD_TEXTURE_LOADER_MISSING: ${d.texture}`);
      if(texture.error)throw texture.error;
      let record=records.get(id);
      if(record?.revision!==String(d.revision)) {
        const geometry=meshGeometry(THREE,heightfieldMeshData(d));
        if(record)dispose(record);
        const material=new THREE.MeshBasicMaterial({side:THREE.DoubleSide});
        const mesh=new THREE.Mesh(geometry,material);
        mesh.position.set(d.origin.x,d.origin.y,d.origin.z);
        record={mesh,material,revision:String(d.revision),triangles:(d.width-1)*(d.depth-1)*2};
        records.set(id,record);scene.add(mesh);rebuilds++;
      }
      record.mesh.visible=texture.state==='ready';
      if(texture.state==='ready'&&record.material.map!==texture.texture) {
        record.material.map=texture.texture;record.material.needsUpdate=true;
      }
      alive.add(id);
    }
    for(const [id,record] of records)if(!alive.has(id)){dispose(record);records.delete(id);}
  }
  return {draw,clear(){for(const record of records.values())dispose(record);records.clear();},
    metrics(){return {heightfields:records.size,heightfield_triangles:[...records.values()].reduce((n,r)=>n+r.triangles,0),heightfield_rebuilds:rebuilds};}};
}

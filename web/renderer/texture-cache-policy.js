// Reusable renderer-owned cache policy. Active and non-sprite owners stay pinned.
export function parseTextureCache(value) {
  if(value===undefined)return null;
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('TEXTURE_CACHE_INVALID: expected an object');
  const ranges={max_bytes:[1,1073741824],max_entries:[1,65536],idle_frames:[1,36000]};
  if(Object.keys(value).some(key=>!Object.hasOwn(ranges,key)))throw Error('TEXTURE_CACHE_INVALID: unknown field');
  for(const [key,[min,max]] of Object.entries(ranges))if(!Number.isSafeInteger(value[key])||value[key]<min||value[key]>max)
    throw Error(`TEXTURE_CACHE_INVALID: ${key} must be an integer in ${min}..${max}`);
  return {...value};
}
export function textureBytes(texture) {
  const image=texture?.image, width=image?.naturalWidth??image?.width??0,height=image?.naturalHeight??image?.height??0;
  return Math.ceil(width*height*4*(texture?.generateMipmaps?4/3:1));
}
export function createTextureCachePolicy(records,value,{dispose=texture=>texture?.dispose?.()}={}) {
  const policy=parseTextureCache(value),active=new Set();let frame=0,evicted=0,releasedBytes=0;
  function drop(id,entry){
    records.delete(id);entry.discarded=true;
    releasedBytes+=textureBytes(entry.texture);dispose(entry.texture);entry.texture=null;evicted++;
  }
  function totals(){
    let bytes=0,pinnedBytes=0,loading=0;
    for(const [id,entry] of records){const size=textureBytes(entry.texture);bytes+=size;
      if(active.has(id)||entry.persistent)pinnedBytes+=size;
      if(entry.state==='loading')loading++;
    }
    return {bytes,pinnedBytes,loading};
  }
  return {
    begin(){frame++;active.clear();},
    touch(id,entry,{persistent=false}={}){active.add(id);entry.lastUsed=frame;if(persistent)entry.persistent=true;},
    sweep(){
      if(!policy)return;
      let {bytes}=totals(),entries=records.size;
      const candidates=[...records].filter(([id,entry])=>!active.has(id)&&!entry.persistent)
        .sort((a,b)=>(a[1].lastUsed??0)-(b[1].lastUsed??0));
      for(const [id,entry] of candidates){
        const expired=frame-(entry.lastUsed??0)>=policy.idle_frames;
        if(!expired&&bytes<=policy.max_bytes&&entries<=policy.max_entries)break;
        bytes-=textureBytes(entry.texture);entries--;drop(id,entry);
      }
    },
    clear(){for(const [id,entry] of records)drop(id,entry);active.clear();},
    metrics(){const {bytes,pinnedBytes,loading}=totals();return {enabled:!!policy,entries:records.size,
      decoded_texture_bytes_estimate:bytes,pinned_bytes_estimate:pinnedBytes,loading,evicted,released_bytes_estimate:releasedBytes,
      pressure_bytes:policy?Math.max(0,bytes-policy.max_bytes):0,
      pressure_entries:policy?Math.max(0,records.size-policy.max_entries):0,
      scope:'2D sprite textures; active and non-sprite dependencies are protected',
      policy,estimate_excludes:'driver allocation, encoded files, browser decode copies and render targets'};},
  };
}

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
export const DEFAULT_TEXTURE_CACHE=Object.freeze({max_bytes:64*1024*1024,max_entries:128,idle_frames:1800});
export function createTextureCachePolicy(records,value,{dispose=texture=>texture?.dispose?.()}={}) {
  const authored=parseTextureCache(value),policy=Object.freeze(authored??{...DEFAULT_TEXTURE_CACHE});
  const owners=new Map(),activeLegacy=new Set();let head=null,tail=null,frame=0,evicted=0,releasedBytes=0,mutation=0;
  function unlink(node){if(!node.linked)return;if(node.previous)node.previous.next=node.next;else head=node.next;if(node.next)node.next.previous=node.previous;else tail=node.previous;node.previous=node.next=null;node.linked=false;}
  function append(node){unlink(node);node.previous=tail;if(tail)tail.next=node;else head=node;tail=node;node.linked=true;}
  function size(node){const bytes=node.adapter.bytes();if(!Number.isFinite(bytes)||bytes<0)throw Error('TEXTURE_CACHE_OWNER_INVALID: bytes');return bytes;}
  function pin(node,pinned,preserveStamp=false){if(node.pinned===pinned)return;node.pinned=pinned;if(pinned)unlink(node);else{if(!preserveStamp)node.lastUsed=frame;append(node);}}
  function untrackOwner(key){const node=owners.get(key);if(!node)return false;owners.delete(key);mutation++;activeLegacy.delete(key);unlink(node);return true;}
  function trackOwner(key,adapter){
    if(owners.has(key)||!adapter||typeof adapter.bytes!=='function'||typeof adapter.loading!=='function'||typeof adapter.retire!=='function')throw Error('TEXTURE_CACHE_OWNER_INVALID');
    const node={key,adapter,pinned:true,lastUsed:frame,linked:false,previous:null,next:null,legacy:null};owners.set(key,node);mutation++;return key;
  }
  function retire(node,bytes=size(node)){if(!untrackOwner(node.key))return;releasedBytes+=bytes;evicted++;node.adapter.retire();}
  function legacyDrop(id,entry){
    if(records.get(id)===entry)records.delete(id);entry.discarded=true;
    // Physical GPU and decoded-image ownership retire independently.
    try{dispose(entry.texture);}finally{entry.texture=null;const lease=entry.imageLease;entry.imageLease=null;lease?.release();}
  }
  function legacy(id,entry){
    let node=owners.get(id);
    if(node&&node.legacy!==entry){retire(node);node=null;}
    if(!node){trackOwner(id,{bytes:()=>textureBytes(entry.texture),loading:()=>entry.state==='loading',retire:()=>legacyDrop(id,entry)});node=owners.get(id);node.legacy=entry;}
    return node;
  }
  function totals(){let bytes=0,pinnedBytes=0,loading=0;for(const node of owners.values()){const n=size(node);bytes+=n;if(node.pinned)pinnedBytes+=n;if(node.adapter.loading())loading++;}return {bytes,pinnedBytes,loading,entries:owners.size};}
  // Reclamation uses the existing intrusive idle list, not a per-draw
  // filter/sort or a second texture budget. Domain admission can reclaim its
  // own idle owners without evicting protected/independent live resources.
  function reclaim(predicate,{eligible=()=>true}={}){
    let node=head,failure,count=0;
    while(node&&!predicate()){const next=node.next,key=node.key;if(eligible(key)){try{retire(node);count++;}catch(error){failure??=error;}}node=next?(owners.get(next.key)===next&&next.linked?next:head):(owners.has(key)?null:head);}
    if(failure)throw failure;return count;
  }
  for(const [id,entry] of records){const node=legacy(id,entry);if(!entry.persistent)pin(node,false);}
  return {
    policy,policySource:authored?'authored':'default',get frame(){return frame;},trackOwner,untrackOwner,reclaim,
    touchOwner(key){const node=owners.get(key);if(!node)throw Error('TEXTURE_CACHE_OWNER_UNKNOWN');mutation++;node.lastUsed=frame;if(!node.pinned)append(node);},
    pinOwner(key,pinned){if(typeof pinned!=='boolean')throw Error('TEXTURE_CACHE_OWNER_INVALID: pin');const node=owners.get(key);if(!node)throw Error('TEXTURE_CACHE_OWNER_UNKNOWN');pin(node,pinned);},
    begin(){frame++;for(const id of activeLegacy){const node=owners.get(id);if(node&&!node.legacy?.persistent)pin(node,false,true);}activeLegacy.clear();},
    touch(id,entry,{persistent=false}={}){const node=legacy(id,entry);mutation++;entry.lastUsed=frame;if(persistent)entry.persistent=true;node.lastUsed=frame;pin(node,true);activeLegacy.add(id);},
    sweep(){
      let node=head,failure;let {bytes,entries}=totals();
      while(node){const expired=frame-node.lastUsed>=policy.idle_frames;
        if(!expired&&bytes<=policy.max_bytes&&entries<=policy.max_entries)break;
        const removed=size(node),before=mutation;
        try{retire(node,removed);}catch(error){failure??=error;}
        // Normal pressure retirement is linear. Callback registry changes (or
        // explicit touches after changing an adapter) require an exact recount.
        if(mutation===before+1){bytes-=removed;entries--;}else({bytes,entries}=totals());
        node=head;
      }
      if(failure)throw failure;
    },
    clear(){const retiring=[...owners.values()];owners.clear();mutation++;activeLegacy.clear();head=tail=null;let failure;
      for(const node of retiring){node.linked=false;node.previous=node.next=null;try{releasedBytes+=size(node);evicted++;node.adapter.retire();}catch(error){failure??=error;}}
      if(failure)throw failure;
    },
    metrics(){const {bytes,pinnedBytes,loading,entries}=totals();return {enabled:true,entries,decoded_texture_bytes_estimate:bytes,pinned_bytes_estimate:pinnedBytes,loading,evicted,released_bytes_estimate:releasedBytes,
      pressure_bytes:Math.max(0,bytes-policy.max_bytes),pressure_entries:Math.max(0,entries-policy.max_entries),
      scope:'Registered world asset-texture GPU owners; legacy records and sprite-pool owners share this one policy. Active/prepared/persistent owners are protected.',
      policy,policy_source:authored?'authored':'default',estimate_excludes:'driver allocation, encoded files, browser decode copies, UI/data textures and render targets'};},
  };
}

// Renderer transport only. Canonical simulation observations are never modified.
import {retainImageResource,retainedImageGeneration} from './retained-image-generation.mjs';
import {createSavePublication,attachSavePublication,savePublication} from './save-publication.mjs';
const imageFormat='ui-image-delta-v1';
const imageEncoder=new TextEncoder();
const validId=id=>typeof id==='string'&&/\S/.test(id)&&(id.length<=256||imageEncoder.encode(id).length<=1024);
const validGeneration=value=>typeof value==='string'&&/^[1-9][0-9]{0,15}$/.test(value)&&Number.isSafeInteger(Number(value));
export class InstanceTransfer {
  constructor(){this.revisions=new Map();this.retired=new Set();this.pool=[];this.poolBytes=0;this.serial=0;this.imageSerial=0;this.images=new Map();this.save=null;this.saveSerial=0;this.metrics={copied_bytes:0,allocated_bytes:0,reused_bytes:0,unchanged_batches:0,image_definition_updates:0,image_unchanged_resources:0,save_definition_updates:0,save_unchanged_publications:0};}
  recycle(buffers=[]){for(const b of buffers){if(!(b instanceof ArrayBuffer))throw Error('TRANSFER_RECYCLE_INVALID');if(this.pool.length<32&&this.poolBytes+b.byteLength<=16*1024*1024){this.pool.push(b);this.poolBytes+=b.byteLength;}}}
  reset(){for(const id of this.revisions.keys())this.retired.add(id);this.revisions.clear();this.images.clear();this.save=null;}
  encode(value,heap){
    let snapshot=value?.world?value:value?.observation;
    if(!snapshot?.world)return {value,updates:[],removed:[]};
    const publication=savePublication(snapshot);let nextSave=null,savePacket=null;
    if(Object.hasOwn(snapshot,'save_payload')){
      const text=publication?.text??JSON.stringify(snapshot.save_payload),key=publication?.token??text;
      if(typeof text!=='string')throw Error('TRANSFER_SAVE_INVALID');
      if(this.save?.key===key){nextSave=this.save;savePacket={format:'save-delta-v1',generation:nextSave.generation};}
      else{if(this.saveSerial===Number.MAX_SAFE_INTEGER)throw Error('TRANSFER_SAVE_LIMIT');nextSave={key,generation:String(++this.saveSerial)};savePacket={format:'save-delta-v1',generation:nextSave.generation,json:text};}
    }
    snapshot={...snapshot,world:{...snapshot.world,instances3d:Object.fromEntries(Object.entries(snapshot.world.instances3d??{}).map(([id,b])=>[id,{...b,memory:b.memory?{...b.memory}:undefined}]))}};
    value=value.world?snapshot:{...value,observation:snapshot};
    if(savePacket)delete snapshot.save_payload;
    const imageDefinitions=snapshot.world.ui_image_batches??{},nextImages=new Map(),imageUpdates=[],imageActive=[];
    if(typeof imageDefinitions!=='object'||Array.isArray(imageDefinitions)||Object.keys(imageDefinitions).length>256)throw Error('TRANSFER_UI_IMAGE_INVALID');
    for(const [id,definition]of Object.entries(imageDefinitions)){
      if(!validId(id)||!definition||typeof definition!=='object')throw Error('TRANSFER_UI_IMAGE_INVALID');
      const key=retainedImageGeneration(definition)??JSON.stringify(definition),old=this.images.get(id);
      let generation=old?.generation;
      if(old?.key!==key){if(this.imageSerial===Number.MAX_SAFE_INTEGER)throw Error('TRANSFER_UI_IMAGE_LIMIT');generation=String(++this.imageSerial);imageUpdates.push({id,generation,definition});}
      nextImages.set(id,{key,generation});imageActive.push({id,generation});
    }
    const imagePacket=imageActive.length||this.images.size?{format:imageFormat,active:imageActive,updates:imageUpdates}:null;
    // The worker sends definitions only on changed immutable generations. The
    // main receiver attaches its own retained definitions to every snapshot.
    delete snapshot.world.ui_image_batches;
    const updates=[],alive=new Set();
    for(const [id,b] of Object.entries(snapshot.world.instances3d??{})){
      if(!b.memory)continue;alive.add(id);const m=b.memory,key=[b.asset,b.count,m.revision,m.byte_length].join('|');
      const old=this.revisions.get(id);let revision=old?.revision;
      if(old?.key!==key){
        if(!Number.isSafeInteger(m.byte_length)||m.byte_length<0||m.byte_length>4_000_000||!Number.isSafeInteger(m.offset)||m.offset<0||m.offset+m.byte_length>heap.byteLength)throw Error('TRANSFER_SOURCE_INVALID');
        const index=this.pool.findIndex(buffer=>buffer.byteLength===m.byte_length);
        let buffer;if(index<0){buffer=new ArrayBuffer(m.byte_length);this.metrics.allocated_bytes+=m.byte_length;}else{buffer=this.pool.splice(index,1)[0];this.poolBytes-=buffer.byteLength;this.metrics.reused_bytes+=buffer.byteLength;}
        new Uint8Array(buffer).set(new Uint8Array(heap,m.offset,m.byte_length));this.metrics.copied_bytes+=m.byte_length;
        revision=String(++this.serial);this.revisions.set(id,{key,revision});updates.push({id,buffer});
      }else this.metrics.unchanged_batches++;
      b.memory={...m,offset:0,buffer_id:id,revision};
    }
    const removed=[...this.retired].filter(id=>!alive.has(id));this.retired.clear();for(const id of this.revisions.keys())if(!alive.has(id)){this.revisions.delete(id);removed.push(id);}
    this.images=nextImages;this.metrics.image_definition_updates+=imageUpdates.length;this.metrics.image_unchanged_resources+=imageActive.length-imageUpdates.length;
    this.save=nextSave;if(savePacket){if(Object.hasOwn(savePacket,'json'))this.metrics.save_definition_updates++;else this.metrics.save_unchanged_publications++;}
    return {value,updates,removed,...(imagePacket?{ui_images:imagePacket}:{}),...(savePacket?{save:savePacket}:{})};
  }
  report(){return {...this.metrics,pooled_bytes:this.poolBytes,pooled_buffers:this.pool.length};}
}
export class InstanceReceiver {
  constructor(){this.buffers=new Map();this.recycled=[];this.images=new Map();this.save=null;}
  clear(){this.buffers.clear();this.recycled=[];this.images.clear();this.save=null;}
  accept(packet){
    let nextImages=this.images,value=packet.value;
    let nextSave=this.save;
    if(packet.save){
      const save=packet.save,snapshot=value?.world?value:value?.observation;
      if(!snapshot?.world||Object.hasOwn(snapshot,'save_payload')||Object.keys(save).some(k=>!['format','generation','json'].includes(k))||save.format!=='save-delta-v1'||!validGeneration(save.generation))throw Error('TRANSFER_SAVE_INVALID');
      if(Object.hasOwn(save,'json')){
        if(typeof save.json!=='string'||(this.save?.generation===save.generation&&this.save.publication.text!==save.json))throw Error('TRANSFER_SAVE_INVALID');
        nextSave={generation:save.generation,publication:createSavePublication(save.json)};
      }else if(nextSave?.generation!==save.generation)throw Error('TRANSFER_SAVE_MISSING');
    }else if(value?.world||value?.observation?.world)nextSave=null;
    if(packet.ui_images){
      const images=packet.ui_images;
      if(Object.keys(images).some(k=>!['format','active','updates'].includes(k))||images.format!==imageFormat||!Array.isArray(images.active)||!Array.isArray(images.updates)||images.active.length>256||images.updates.length>256)throw Error('TRANSFER_UI_IMAGE_INVALID');
      const candidates=new Map(this.images),updated=new Set();
      for(const update of images.updates){
        if(!update||Object.keys(update).some(k=>!['id','generation','definition'].includes(k))||!validId(update.id)||!validGeneration(update.generation)||updated.has(update.id)||!update.definition)throw Error('TRANSFER_UI_IMAGE_INVALID');
        updated.add(update.id);candidates.set(update.id,{generation:update.generation,definition:retainImageResource(update.definition)});
      }
      nextImages=new Map();
      for(const active of images.active){
        if(!active||Object.keys(active).some(k=>!['id','generation'].includes(k)))throw Error('TRANSFER_UI_IMAGE_INVALID');
        const entry=candidates.get(active.id);
        if(!validId(active.id)||!validGeneration(active.generation)||nextImages.has(active.id)||entry?.generation!==active.generation)throw Error('TRANSFER_UI_IMAGE_MISSING');
        nextImages.set(active.id,entry);
      }
      if([...updated].some(id=>!nextImages.has(id)))throw Error('TRANSFER_UI_IMAGE_INVALID');
      const snapshot=value?.world?value:value?.observation;
      if(!snapshot?.world)throw Error('TRANSFER_UI_IMAGE_INVALID');
      const world={...snapshot.world};delete world.ui_image_batches;
      if(nextImages.size)world.ui_image_batches=Object.freeze(Object.fromEntries([...nextImages].map(([id,entry])=>[id,entry.definition])));
      value=value.world?{...value,world}:{...value,observation:{...snapshot,world}};
    }else if(value?.world||value?.observation?.world){nextImages=new Map();}
    for(const id of packet.removed??[]){const old=this.buffers.get(id);if(old)this.recycled.push(old);this.buffers.delete(id);}for(const {id,buffer}of packet.updates??[]){const old=this.buffers.get(id);if(old)this.recycled.push(old);this.buffers.set(id,buffer);}
    if(packet.save){const snapshot=value?.world?value:value.observation,restored=attachSavePublication({...snapshot,save_payload:nextSave.publication.value},nextSave.publication);value=value.world?restored:{...value,observation:restored};}
    this.images=nextImages;this.save=nextSave;return value;
  }
  memory(batch){const b=this.buffers.get(batch.memory.buffer_id);if(!b)throw Error('TRANSFER_BATCH_MISSING');return b;}
  takeRecycled(){return this.recycled.splice(0);}
}

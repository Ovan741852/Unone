// Opt-in DOM observations only. The official scheduler drives publish(); this
// module installs no timer, listener, window API or runtime/Game controls.
export const PLAYER_PERFORMANCE_FEED_INTERVAL_MS=500;
export const PLAYER_PERFORMANCE_FEED_WINDOW_MS=1500;
export const PLAYER_PERFORMANCE_FEED_MAX_BYTES=256*1024;

function enabled(search){
 if(typeof search!=='string')return false;
 const values=new URLSearchParams(search).getAll('unone_performance_feed');
 return values.length===1&&values[0]==='1';
}
function invalid(code){throw Error(code);}
function checkCompletion(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||value.version!==1
  ||value.completed_intervals?.window_ms!==PLAYER_PERFORMANCE_FEED_WINDOW_MS
  ||value.raf_diagnostics?.window_ms!==PLAYER_PERFORMANCE_FEED_WINDOW_MS
  ||!Array.isArray(value.raf_diagnostics.samples)||value.raf_diagnostics.samples.length>512)
  invalid('PLAYER_PERFORMANCE_FEED_COMPLETION_INVALID');
}
function checkBytes(text){
 let bytes=0;
 for(let i=0;i<text.length;i++){
  const code=text.charCodeAt(i);
  if(code<=0x7f)bytes++;
  else if(code<=0x7ff)bytes+=2;
  else if(code>=0xd800&&code<=0xdbff&&i+1<text.length&&text.charCodeAt(i+1)>=0xdc00&&text.charCodeAt(i+1)<=0xdfff){bytes+=4;i++;}
  else bytes+=3;
  if(bytes>PLAYER_PERFORMANCE_FEED_MAX_BYTES)invalid('PLAYER_PERFORMANCE_FEED_LIMIT');
 }
}
function clearOwned(dataset,value){
 if(dataset&&value!==null&&Object.hasOwn(dataset,'playerCompletion')&&dataset.playerCompletion===value)delete dataset.playerCompletion;
}

export function createPlayerPerformanceFeed(options={}){
 if(!enabled(options?.search??''))return null;
 let dataset=(options.target??globalThis.document?.body)?.dataset,read=options.read,now=options.now??(()=>performance.now());
 if(!dataset||typeof dataset!=='object'||typeof read!=='function'||typeof now!=='function')invalid('PLAYER_PERFORMANCE_FEED_OPTIONS_INVALID');
 // Terminal teardown releases the DOM map and callbacks, even if this API is
 // retained by a caller or removing its attribute throws.
 options=null;
 let disposed=false,busy=false,sequence=0,lastStart=null,lastClock=null,lastWritten=null,previousCost=null,maxCost=null;
 function clock(){
  const value=now();
  if(typeof value!=='number'||!Number.isFinite(value)||value<0||(lastClock!==null&&value<lastClock))invalid('PLAYER_PERFORMANCE_FEED_CLOCK_INVALID');
  lastClock=value;return value;
 }
 function retire(candidateDataset=null,candidateValue=null){
  const wasDisposed=disposed,oldDataset=dataset,oldValue=lastWritten;
  disposed=true;dataset=read=now=null;lastWritten=null;
  let failure;
  try{clearOwned(candidateDataset,candidateValue);}catch(error){failure=error;}
  try{clearOwned(oldDataset,oldValue);}catch(error){failure??=error;}
  if(failure)throw failure;
  return !wasDisposed;
 }
 function dispose(){if(disposed)return false;return retire();}
 function publish(){
  if(disposed||busy)return false;
  busy=true;let candidateDataset=null,candidateValue=null;
  try{
   const queriedAt=clock();if(disposed)return false;
   if(lastStart!==null&&queriedAt-lastStart<PLAYER_PERFORMANCE_FEED_INTERVAL_MS)return false;
   const completion=read();if(disposed)return false;checkCompletion(completion);
   const publicationAt=clock();if(disposed)return false;
   const envelope={version:1,sequence:sequence+1,interval_ms:PLAYER_PERFORMANCE_FEED_INTERVAL_MS,window_ms:PLAYER_PERFORMANCE_FEED_WINDOW_MS,
    queried_at_ms:queriedAt,published_at_ms:publicationAt,publication_timestamp_scope:'Before serialization and dataset assignment; not completion or display time.',
    previous_completed_publication_ms:previousCost,max_completed_publication_ms:maxCost,
    publication_cost_scope:'Whole previous completed feed call: snapshot query, one serialization, UTF8 bound check and dataset assignment; current cost appears in the next envelope.',completion};
   const text=JSON.stringify(envelope);if(disposed)return false;checkBytes(text);
   candidateDataset=dataset;candidateValue=text;candidateDataset.playerCompletion=text;
   if(disposed){retire(candidateDataset,candidateValue);return false;}
   lastWritten=text;
   const end=clock();if(disposed){retire(candidateDataset,candidateValue);return false;}
   previousCost=end-queriedAt;maxCost=maxCost===null?previousCost:Math.max(maxCost,previousCost);lastStart=queriedAt;sequence++;
   return true;
  }catch(error){
   try{retire(candidateDataset,candidateValue);}catch(cleanup){throw new AggregateError([error,cleanup],`PLAYER_PERFORMANCE_FEED_FAILURE: ${error?.message??error}; cleanup: ${cleanup?.message??cleanup}`);}
   throw error;
  }finally{busy=false;}
 }
 return Object.freeze({publish,dispose});
}

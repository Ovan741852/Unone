// One config contract: never pick individual ProjectConfig declarations here.
export async function assembleProject(config, readText, readJson) {
  const job_sources=Object.fromEntries(await Promise.all(Object.entries(config.job_scripts??{}).map(async([id,path])=>[id,await readText(path)])));
  return {...(Object.keys(job_sources).length?{job_sources}:{}),config,script:await readText(config.entry_script??'scripts/main.luau'),scene:config.main_scene?await readJson(config.main_scene):null};
}
const observationDecoder=new TextDecoder(),projectEncoder=new TextEncoder();
// Decode synchronously from the current WASM heap. No WASM call or async boundary occurs
// while the borrowed view is in use; returned objects never retain the heap or its bytes.
// `mark` is the host profiler's synchronous callback and receives view/UTF-8/parse boundaries.
export function readObservation(module,mark) {
  const pointer=module._unone_web_observation_ptr(),length=module._unone_web_observation_len();
  const bytes=module.HEAPU8.subarray(pointer,pointer+length);
  if(mark)mark('observation_view',bytes.length);
  const text=observationDecoder.decode(bytes);if(mark)mark('observation_utf8');
  const value=JSON.parse(text);if(mark)mark('observation_parse');return value;
}
export function loadProject(module,payload,seed=42n) {
  const bytes=projectEncoder.encode(JSON.stringify(payload));
  const address=module._unone_web_alloc(bytes.length);module.HEAPU8.set(bytes,address);
  const status=module._unone_web_load_project(address,bytes.length,seed);
  const observation=readObservation(module);
  if(status!==0){const error=new Error(`HOST_PROJECT_REJECTED: ${JSON.stringify(observation)}`);error.result=observation;throw error;}
  return observation;
}

// One config contract: never pick individual ProjectConfig declarations here.
export async function assembleProject(config, readText, readJson) {
  const job_sources=Object.fromEntries(await Promise.all(Object.entries(config.job_scripts??{}).map(async([id,path])=>[id,await readText(path)])));
  return {...(Object.keys(job_sources).length?{job_sources}:{}),config,script:await readText(config.entry_script??'scripts/main.luau'),scene:config.main_scene?await readJson(config.main_scene):null};
}
// `mark` (opt-in profiling only) receives consecutive copy/UTF-8/parse boundaries.
export function readObservation(module,mark) {
  if(!mark)return JSON.parse(new TextDecoder().decode(module.HEAPU8.slice(module._unone_web_observation_ptr(),module._unone_web_observation_ptr()+module._unone_web_observation_len())));
  const bytes=module.HEAPU8.slice(module._unone_web_observation_ptr(),module._unone_web_observation_ptr()+module._unone_web_observation_len());mark('observation_copy',bytes.length);
  const text=new TextDecoder().decode(bytes);mark('observation_utf8');const value=JSON.parse(text);mark('observation_parse');return value;
}
export function loadProject(module,payload,seed=42n) {
  const bytes=new TextEncoder().encode(JSON.stringify(payload));
  const address=module._unone_web_alloc(bytes.length);module.HEAPU8.set(bytes,address);
  const status=module._unone_web_load_project(address,bytes.length,seed);
  const observation=readObservation(module);
  if(status!==0){const error=new Error(`HOST_PROJECT_REJECTED: ${JSON.stringify(observation)}`);error.result=observation;throw error;}
  return observation;
}

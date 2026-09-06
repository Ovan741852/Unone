import { installGeneration, readActiveBundle, readActiveAsset } from './engine/web/live/bundle-store.js';
const button=document.querySelector('#run'), status=document.querySelector('#status'), output=document.querySelector('#result');
const check=(condition,message)=>{if(!condition)throw new Error(message)};
const request=req=>new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)});
async function persistence(db){
  const tx=db.transaction(['meta','generations'],'readonly');
  const [meta,generations]=await Promise.all([request(tx.objectStore('meta').getAll()),request(tx.objectStore('generations').getAll())]);
  return JSON.stringify({meta,generations});
}
async function pointer(db,generation){
  const tx=db.transaction('meta','readwrite');
  tx.objectStore('meta').put({key:'activeGeneration',generation});
  await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);tx.onerror=()=>reject(tx.error)});
}
button.onclick=async()=>{
  button.disabled=true;status.textContent='Running';const report={scope:'Real IndexedDB + packaged Wasm, main-agent integration fixture; not game blind assessment',cases:[]};
  const record=(name,details)=>{report.cases.push({name,passed:true,...details});output.textContent=JSON.stringify(report,null,2)};
  try{
    const raw=await (await fetch('/browser-probe/bundles/manifest.json')).json();
    const manifest={...raw,bundles:raw.bundles.map(b=>({...b,source:new URL('/browser-probe/'+b.source,location.origin).href}))};
    const databaseName='unone-asset-regression:'+crypto.randomUUID();
    report.databaseName=databaseName;
    const options={module:Module,databaseName};
    const active=await installGeneration(manifest,options);
    check(active.generation===1,'Fresh database must activate generation 1');
    const bytes=await readActiveAsset(active,{id:'asset://web/probe',source:'assets/probe.svg',bundle:'content'},Module,manifest);
    const source=new Uint8Array(await (await fetch('/browser-probe/assets/probe.svg')).arrayBuffer());
    const hash=async b=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b)),x=>x.toString(16).padStart(2,'0')).join('');
    const actual=await hash(bytes);check(actual===await hash(source),'Asset hash must equal authoring bytes');
    const img=document.querySelector('#asset');img.src=URL.createObjectURL(new Blob([bytes],{type:'image/svg+xml'}));await img.decode();
    record('all roots activate and verified asset decodes',{generation:active.generation,bundles:Object.keys(active.bundles),sha256:actual});
    const before=await persistence(active.database);
    const graph=structuredClone(manifest);graph.bundles.find(b=>b.id==='content').dependencies.push('missing-unrelated-bundle');
    let graphCode=null;try{await readActiveBundle(active,'project',Module,graph)}catch(e){graphCode=e.diagnostic?.code}
    check(graphCode==='BUNDLE_DEPENDENCY_NOT_FOUND','Read must validate unrelated dependency graph');
    check(before===await persistence(active.database),'Graph failure must preserve active state');record('read rejects unrelated invalid graph',{code:graphCode,activeUnchanged:true});
    const corrupt=structuredClone(manifest);corrupt.version+=1;corrupt.bundles.find(b=>b.id==='content').sha256='0'.repeat(64);
    let integrityDiagnostic=null;try{await installGeneration(corrupt,options)}catch(e){integrityDiagnostic=e.diagnostic}
    check(integrityDiagnostic?.code==='BUNDLE_VERIFY_FAILED' && integrityDiagnostic.facts?.bundle_id==='content' && integrityDiagnostic.facts?.expected_sha256==='0'.repeat(64),'Must fail specifically at Wasm integrity verification');
    check(before===await persistence(active.database),'Failed verification must preserve active state');record('failed content verification preserves generation',{diagnostic:integrityDiagnostic,activeUnchanged:true});
    for(const [name,value] of [['invalid active pointer',0],['pointer references missing record',999]]){
      const caseName='unone-asset-regression:'+crypto.randomUUID();const caseOptions={module:Module,databaseName:caseName};
      const state=await installGeneration(manifest,caseOptions);await pointer(state.database,value);const damaged=await persistence(state.database);
      let code=null;try{await installGeneration(manifest,caseOptions)}catch(e){code=e.diagnostic?.code}
      check(code==='BUNDLE_ACTIVE_GENERATION_UNREADABLE','Corrupt pointer must fail closed');check(damaged===await persistence(state.database),'Corrupt pointer must not be rewritten');
      record(name,{databaseName:caseName,code,persistenceUnchanged:true});
    }
    report.passed=true;status.textContent='PASS: 5 real-browser cases';
  }catch(error){report.passed=false;report.error={message:error.message,diagnostic:error.diagnostic??null};status.textContent='FAIL: see preserved first result'}
  output.textContent=JSON.stringify(report,null,2);
};

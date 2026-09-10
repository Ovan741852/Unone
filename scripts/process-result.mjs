import {spawnSync} from 'node:child_process';
export function runWithEvidence(command,args,{timeoutMs=120000,spawn=spawnSync,cwd}={}){
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1000||timeoutMs>3600000)throw Error('PROCESS_TIMEOUT_INVALID: use 1000..3600000 ms');
  const r=spawn(command,args,{encoding:'utf8',timeout:timeoutMs,maxBuffer:16*1024*1024,windowsHide:true,cwd});
  if(r.error||r.signal)throw Error('PLAYER_PROCESS_FAILED: '+JSON.stringify({command,args,timeoutMs,timedOut:r.error?.code==='ETIMEDOUT',error:r.error?{code:r.error.code,message:r.error.message}:null,signal:r.signal,status:r.status,stdout:r.stdout,stderr:r.stderr}));
  return r;
}

import { handleRequest } from './src/api.mjs';
const MAX = 2 * 1024 * 1024;
let buffer = Buffer.alloc(0), dropping = false;
function invalid(code,message) {
  process.stdout.write(`${JSON.stringify({ok:false,value:null,diagnostics:[{code,severity:'ERROR',summary:message,explanation:message,facts:{maxBytes:MAX},likely_causes:[],suggested_actions:[{action:'repair_request',description:'Send one bounded JSON line using the envelope and bootstrap tools in README.',command:null}],source:null}],effects:[]})}\n`);
}
async function line(bytes) {
  if (!bytes.toString('utf8').trim()) return;
  let request;
  try { request = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)); }
  catch { invalid('PLUGIN_JSON_INVALID','Request is not valid UTF-8 JSON.'); return; }
  process.stdout.write(`${JSON.stringify(await handleRequest(request,process.env.UNONE_PROJECT_ROOT || process.cwd(), {registryWrite:process.env.UNONE_AI_NATIVE_REGISTRY_WRITE === '1'}))}\n`);
}
for await (const chunk of process.stdin) {
  let start = 0;
  for (let i = 0; i < chunk.length; i++) if (chunk[i] === 10) {
    const tail = chunk.subarray(start,i);
    if (!dropping && buffer.length + tail.length <= MAX) await line(Buffer.concat([buffer,tail]));
    else if (!dropping) invalid('PLUGIN_REQUEST_TOO_LARGE','Request line exceeds the byte limit.');
    buffer = Buffer.alloc(0); dropping = false; start = i+1;
  }
  const tail = chunk.subarray(start);
  if (!dropping && buffer.length + tail.length > MAX) { invalid('PLUGIN_REQUEST_TOO_LARGE','Request line exceeds the byte limit.'); buffer=Buffer.alloc(0); dropping=true; }
  else if (!dropping) buffer = Buffer.concat([buffer,tail]);
}
if (buffer.length && !dropping) await line(buffer);

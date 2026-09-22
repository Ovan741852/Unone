import { handle, discovery } from './src/api.mjs';
const argv = process.argv.slice(2);
const command = argv.shift();
const options = {}, paths = [];
const help = 'Usage: node cli.mjs recommend --query <goal> | describe --operation <id> | catalog | init --id <id> --name <name> [--surface http] | snapshot --path <relative>... | evaluate --report <relative> | evaluate --report - (JSON from stdin) | compare --before <relative> --after <relative> | register --assessment <id> --report <relative> [--manifest <relative-plugin.json>] | history --target <id> | status --assessment <id> --version <current-version> | test\nAll commands accept --root <project>. init returns a JSON template but does not write a file. Only register writes a NEW local assessment record; all other commands are read-only. evaluate can accept a completed report JSON on stdin to avoid writing a report file. JSON on stdout.';
function usage(message) { process.stderr.write(`${message}\n${help}\n`); process.exitCode=2; }
async function readStdinJson() {
  const chunks=[]; let bytes=0;
  for await (const chunk of process.stdin) {
    bytes+=chunk.length;
    if (bytes>2*1024*1024) throw new Error('Report JSON from stdin exceeds the 2 MiB request limit.');
    chunks.push(chunk);
  }
  const raw=Buffer.concat(chunks).toString('utf8');
  if (!raw.trim()) throw new Error('Report JSON from stdin is empty. Pipe the complete object returned by init after filling all required answers and evidence.');
  try { return JSON.parse(raw); }
  catch { throw new Error('Report JSON from stdin is malformed. Send one complete UTF-8 JSON object.'); }
}
const allowed = {recommend:['query','limit'],describe:['operation'],catalog:[],init:['id','name','surface'],snapshot:['path'],evaluate:['report'],compare:['before','after'],register:['assessment','report','manifest'],history:['target'],status:['assessment','version'],test:[]};
if (!command || ['help','--help','-h'].includes(command)) {
  process.stdout.write(`${help}\n`); process.exitCode=0;
} else try {
  if (!Object.hasOwn(allowed,command)) throw new Error('Choose a documented command.');
  for (let i=0;i<argv.length;i+=2) {
    const key = argv[i]?.startsWith('--') ? argv[i].slice(2) : '';
    if (!['root',...allowed[command]].includes(key) || argv[i+1] === undefined || argv[i+1].startsWith('--')) throw new Error(`Invalid or incomplete option ${argv[i]}.`);
    if (key === 'path') paths.push(argv[i+1]);
    else { if (key in options) throw new Error(`Duplicate --${key}.`); options[key]=argv[i+1]; }
  }
  let result;
  const root = options.root || process.cwd();
  if (command === 'recommend') result = await handle('ai_native.recommend',{query:options.query,...(options.limit!==undefined?{limit:Number(options.limit)}:{})},root);
  else if (command === 'describe') result = await handle('ai_native.describe',{operation:options.operation},root);
  else if (command === 'test') result = await handle('plugin.test',{},root);
  else {
    const contract = discovery.describe(`ai_native.${command}`);
    const args = command === 'catalog' ? {} : command === 'init' ? {id:options.id,name:options.name,...(options.surface?{surface:options.surface}:{})} : command === 'snapshot' ? {paths} : command === 'evaluate' ? options.report === '-' ? {report:await readStdinJson()} : {report_path:options.report} : command === 'register' ? {assessment_id:options.assessment,report_path:options.report,...(options.manifest?{manifest_path:options.manifest}:{})} : command === 'history' ? {target_id:options.target} : command === 'status' ? {assessment_id:options.assessment,current_version:options.version} : {before_path:options.before,after_path:options.after};
    result = await handle('ai_native.call',{operation:contract.id,contractHash:contract.contractHash,arguments:args},root,{registryWrite:command==='register'});
  }
  process.stdout.write(`${JSON.stringify(result,null,2)}\n`); process.exitCode = result.ok ? 0 : 2;
} catch(error) { usage(error.message); }

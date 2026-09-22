import { performance } from 'node:perf_hooks';
import { catalog, template } from './rubric.mjs';
import { AuditError, invalid, keys, readJson, snapshot, text } from './files.mjs';
import { compare, evaluate } from './audit.mjs';
import { createDiscovery } from './discovery.mjs';
import { contracts } from './contracts.mjs';
import { register, history, status } from './registry.mjs';

export const discovery = createDiscovery(contracts);
function failure(error) {
  const known = error instanceof AuditError;
  return { ok:false, value:null, diagnostics:[{ code:known?error.code:'AUDIT_INTERNAL_ERROR', severity:'ERROR', summary:known?error.message:'Audit could not complete.', explanation:known?error.message:'An unexpected internal error prevented a trustworthy result. No score or success is returned.', facts:known?{field:error.field,expected:error.expected,actual:error.actual}:{reason:error.name}, likely_causes:[], suggested_actions:[{action:'repair_and_retry',description:known?error.fix:'Retain the request and run plugin.test; report the reproducible failure without credentials.',command:null}], source:null }], effects:[] };
}
export async function handle(tool, input, root, authority = {}) {
  const started = performance.now();
  try {
    let value; const effects = [];
    if (tool === 'ai_native.recommend') value = discovery.recommend(input);
    else if (tool === 'ai_native.describe') { keys(input,['operation'],'input'); value = discovery.describe(input.operation); }
    else if (tool === 'plugin.test') {
      keys(input,[],'input');
      const checks = [];
      if (catalog().checks.reduce((n,c)=>n+c.weight,0) !== 100) throw new Error('Rubric weights do not total 100.');
      checks.push('weights_total_100');
      const initContract = discovery.describe('ai_native.init');
      if (!initContract.readOnly || !/不寫檔/.test(initContract.summary)) throw new Error('Assessment scaffolding must remain an explicit read-only response.');
      checks.push('read_only_assessment_scaffold');
      const evaluationContract = discovery.describe('ai_native.evaluate');
      if (!evaluationContract.input_schema.properties.report || !evaluationContract.input_schema.oneOf?.some(option=>option.required?.includes('report'))) throw new Error('Evaluation must accept a completed report in memory.');
      checks.push('in_memory_report_evaluation');
      const candidate = discovery.recommend({query:'評分'}).candidates[0];
      if (candidate?.operation !== 'ai_native.evaluate' || 'input_schema' in candidate) throw new Error('Progressive discovery contract failed.');
      checks.push('bounded_recommendation_without_eager_schema');
      const selected = discovery.describe(candidate.operation);
      discovery.selected(selected.id,selected.contractHash); checks.push('selected_contract_hash');
      let refused = false; try { discovery.selected(selected.id,'stale'); } catch(e) { refused = e.code === 'DISCOVERY_CONTRACT_STALE'; }
      if (!refused) throw new Error('Stale schema was accepted.');
      checks.push('stale_contract_rejected');
      value = { plugin:'org.unone.ai-native', selfTest:'passed', checks, scope:'Dependency-free invariant smoke only. Run npm test for file, scoring and protocol regressions.' };
    } else if (tool === 'ai_native.call') {
      keys(input,['operation','contractHash','arguments'],'input');
      const selected = discovery.selected(input.operation,input.contractHash);
      const args = input.arguments;
      keys(args,Object.keys(selected.input_schema.properties),'input.arguments');
      for (const field of selected.input_schema.required ?? []) if (!(field in args)) invalid(`input.arguments.${field}`,'Required field is missing.',selected.input_schema.required,null,'Supply the required field from ai_native.describe.');
      switch (selected.id) {
        case 'ai_native.catalog': value = catalog(); break;
        case 'ai_native.init':
          text(args.id,'input.arguments.id',100); text(args.name,'input.arguments.name',200);
          if (args.surface !== undefined && !selected.input_schema.properties.surface.enum.includes(args.surface)) invalid('input.arguments.surface','Unsupported target surface.',selected.input_schema.properties.surface.enum,args.surface,'Choose the actual interface being audited.');
          value = template(args); break;
        case 'ai_native.snapshot': value = await snapshot(root,args.paths); break;
        case 'ai_native.evaluate': {
          const hasPath = Object.hasOwn(args,'report_path');
          const hasReport = Object.hasOwn(args,'report');
          if (hasPath === hasReport) invalid('input.arguments','Supply exactly one report input.', 'exactly one of report_path or report', {report_path:hasPath,report:hasReport}, 'For a read-only evaluation, pass the completed report JSON directly as report. Use report_path only when a report file already exists in the selected project.');
          value = await evaluate(hasReport ? args.report : await readJson(root,args.report_path),root);
          break;
        }
        case 'ai_native.compare': value = compare(await evaluate(await readJson(root,args.before_path),root),await evaluate(await readJson(root,args.after_path),root)); break;
        case 'ai_native.register':
          if (authority.registryWrite !== true) throw new AuditError('AUDIT_REGISTRY_WRITE_DENIED','authority.registryWrite','Registry writes are disabled by this host.','Host opt-in, not a payload permission',false,'Use the explicit local CLI register command, or have the trusted host enable UNONE_AI_NATIVE_REGISTRY_WRITE=1 for this selected project. Discovery never grants write access.');
          value = await register(root,args);
          if (value.created) effects.push({kind:'ai_native.assessment_created',path:value.recordPath,assessmentId:value.assessmentId});
          break;
        case 'ai_native.history': value = await history(root,args); break;
        case 'ai_native.status': value = await status(root,args); break;
        default: throw new Error('Unimplemented operation.');
      }
    } else throw new AuditError('PLUGIN_TOOL_NOT_FOUND','tool','This is not a bootstrap tool. Select an operation through discovery.',['ai_native.recommend','ai_native.describe','ai_native.call','plugin.test'],tool,'Start with ai_native.recommend; call selected operations through ai_native.call, not as guessed top-level tools.');
    return { ok:true,value,diagnostics:[],effects, telemetry:{elapsed_ms:Math.round((performance.now()-started)*1000)/1000,gpu_ms:null,note:'Plugin wall time only, not target performance. No target commands or probes executed.'} };
  } catch(error) { return {...failure(error),telemetry:{elapsed_ms:Math.round((performance.now()-started)*1000)/1000,gpu_ms:null}}; }
}
export async function handleRequest(request, root, authority = {}) {
  try {
    keys(request,['protocol','action','plugin','project','tool','input'],'request');
    if (request.protocol !== 'unone.plugin.v1' || request.action !== 'call' || request.plugin !== 'org.unone.ai-native') throw new AuditError('PLUGIN_REQUEST_INVALID','request','Unsupported plugin, protocol or action.',{protocol:'unone.plugin.v1',action:'call',plugin:'org.unone.ai-native'},{protocol:request.protocol,action:request.action,plugin:request.plugin},'Use the exact Unone plugin envelope shown in README.');
    // The host-selected environment root is authoritative; a JSON payload cannot redirect it.
    return await handle(request.tool,request.input,root,authority);
  } catch(error) { return failure(error); }
}

import { spawnSync } from 'node:child_process';
import path from 'node:path';

const args = process.argv.slice(2);
const rootIndex = args.indexOf('--root');
if (rootIndex < 0 || !args[rootIndex + 1]) throw new Error('Recorder must supply --root.');
const root = args[rootIndex + 1];
const cli = path.join(root, 'cli.mjs');

function run(label, commandArgs, input) {
  const child = spawnSync(process.execPath, [cli, ...commandArgs], {
    cwd: root,
    input,
    encoding: 'utf8',
    timeout: 15000,
    windowsHide: true,
    shell: false,
    maxBuffer: 256 * 1024,
  });
  let output;
  try { output = JSON.parse(child.stdout); }
  catch { output = child.stdout.trim(); }
  return { label, exitCode: child.status, error: child.error?.code ?? null, output, stderr: child.stderr.trim() };
}

const results = [
  run('help', ['--help']),
  run('recommend', ['recommend', '--query', 'Assess Scout itself for AI-native usability and give it an evidence-based score']),
  run('invalid-operation', ['describe', '--operation', 'ai_native.evalute']),
  run('repaired-operation', ['describe', '--operation', 'ai_native.evaluate']),
  run('init-read-only', ['init', '--id', 'scout-self', '--name', 'Unone AI-native Audit', '--surface', 'plugin']),
  run('path-boundary', ['snapshot', '--root', root, '--path', '../README.md']),
  run('empty-history', ['history', '--target', 'org.unone.ai-native']),
  run('self-test', ['test']),
];

if (results.some(result => result.error || result.exitCode === null)) throw new Error('A child CLI process failed to start.');
if (results.find(result => result.label === 'recommend')?.output?.value?.candidates?.[0]?.operation !== 'ai_native.init') throw new Error('New self-audit recommendation did not prioritize the required init step.');

const init = run('init-evaluation-fixture', ['init','--id','scout-capture-smoke','--name','Scout evaluator capture smoke','--surface','cli']).output?.value;
const selected = run('snapshot-evaluation-subject', ['snapshot','--root',root,'--path','README.md']).output?.value;
if (!init || !selected?.files?.length) throw new Error('Could not prepare the read-only evaluation capture fixture.');
Object.assign(init.target,{scope:'Synthetic unverified report used only to capture evaluator output.',version:'0.3.0',revision:'current reviewed working tree',environment:`${process.platform}/${process.arch}, ${process.version}`});
Object.assign(init.trial,{mode:'informed',entryPoints:['reviewed public self-probe'],steps:1,firstSuccessStep:1,limitations:['Synthetic all-unverified report: this checks evaluator output observability only and is not a Scout score.']});
init.subject=selected.files.map(({path,sha256})=>({path,sha256}));
init.evidence=[{id:'readme-purpose',kind:'document',path:'README.md',sha256:selected.files[0].sha256,quote:'衡量「陌生 AI 是否能自己找到、用對、看懂結果、修復錯誤」的開發插件。'}];
for (const check of init.checks) Object.assign(check,{answer:'This synthetic probe does not assess the target capability.',reason:'The check is deliberately unverified; this report exists only to record evaluator output and its gate.',nextAction:'Run a blind trial and replace this placeholder with concrete evidence.'});
const evaluated = run('evaluate-unverified-report', ['evaluate','--root',root,'--report','-'], JSON.stringify(init));
const value = evaluated.output?.value;
if (evaluated.exitCode !== 0 || evaluated.output?.ok !== true || value?.index !== null || value?.gate !== 'insufficient_evidence' || !Array.isArray(value?.unverifiedCritical) || evaluated.output?.diagnostics?.length !== 0) throw new Error(`Read-only evaluator returned an unexpected result: ${JSON.stringify({exitCode:evaluated.exitCode,ok:evaluated.output?.ok,index:value?.index,gate:value?.gate,diagnostics:evaluated.output?.diagnostics})}`);
results.push(evaluated);
process.stdout.write(JSON.stringify({ schema: 'scout.self-probe.v1', root: '.', steps: results }, null, 2));

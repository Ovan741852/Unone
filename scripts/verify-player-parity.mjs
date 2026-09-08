// Build a real single-game export; test its payload, loader and runtime together.
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {parseArgs} from 'node:util';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const {values}=parseArgs({options:{cli:{type:'string'},runtime:{type:'string'},development:{type:'boolean',default:false}}});
const cli=resolve(values.cli??join(root,'target/debug/game.exe'));
const fixture=join(root,'tests/host-parity-project');
const scratch=mkdtempSync(join(tmpdir(),'unone-player-parity-'));
const output=join(scratch,'player');
function run(command,args){return spawnSync(command,args,{encoding:'utf8',timeout:120000,maxBuffer:16*1024*1024});}
try {
  const args=['--project',fixture,'export','web','--output',output,'--json'];
  if(values.development)args.push('--development');
  if(values.runtime)args.push('--runtime',resolve(values.runtime));
  const built=run(cli,args);
  if(built.status!==0)throw new Error(`PLAYER_EXPORT_FAILED: ${built.stdout}\n${built.stderr}`);
  const verifyArgs=[join(root,'scripts/verify-host-parity.mjs'),'--cli',cli,'--fixture',fixture,'--export',output];
  if(values.development)verifyArgs.push('--exercise-tools');
  const good=run(process.execPath,verifyArgs);
  if(good.status!==0)throw new Error(`PLAYER_PARITY_FAILED: ${good.stdout}\n${good.stderr}`);
  console.log(good.stdout.trim());
  // Mutate the actual emitted file, not an independently assembled test payload.
  const payloadPath=join(output,'content/project.json');
  const payload=JSON.parse(readFileSync(payloadPath,'utf8'));
  delete payload.config.audio;
  writeFileSync(payloadPath,JSON.stringify(payload));
  const bad=run(process.execPath,verifyArgs);
  if(bad.status===0 || !/HOST_PARITY_MISMATCH|HOST_PROJECT_REJECTED/.test(bad.stderr)) {
    throw new Error(`PLAYER_PARITY_NEGATIVE_CONTROL_FAILED: ${bad.stdout}\n${bad.stderr}`);
  }
  console.log(JSON.stringify({ok:true,exported_payload_audio_omission_detected:true}));
  // Exercise the actual 3D solver through the exported host payload as well.
  const physicsFixture=join(root,'_Games/physics3d-lab');
  const physicsOutput=join(scratch,'physics');
  const physicsArgs=['--project',physicsFixture,'export','web','--output',physicsOutput,'--json'];
  if(values.development)physicsArgs.push('--development');
  if(values.runtime)physicsArgs.push('--runtime',resolve(values.runtime));
  const physicsExport=run(cli,physicsArgs);
  if(physicsExport.status!==0)throw new Error(`PHYSICS3D_EXPORT_FAILED: ${physicsExport.stdout}\n${physicsExport.stderr}`);
  const physicsVerify=[join(root,'scripts/verify-host-parity.mjs'),'--cli',cli,'--fixture',physicsFixture,'--export',physicsOutput];
  const physicsGood=run(process.execPath,physicsVerify);
  if(physicsGood.status!==0)throw new Error(`PHYSICS3D_PARITY_FAILED: ${physicsGood.stdout}\n${physicsGood.stderr}`);
  console.log(physicsGood.stdout.trim());
  const physicsPayloadPath=join(physicsOutput,'content/project.json');
  const physicsPayload=JSON.parse(readFileSync(physicsPayloadPath,'utf8'));
  physicsPayload.scene.physics3d.gravity.y=-2;
  writeFileSync(physicsPayloadPath,JSON.stringify(physicsPayload));
  const physicsBad=run(process.execPath,physicsVerify);
  if(physicsBad.status===0||!/HOST_PARITY_MISMATCH/.test(physicsBad.stderr))throw new Error(`PHYSICS3D_NEGATIVE_CONTROL_FAILED: ${physicsBad.stdout}\n${physicsBad.stderr}`);
  console.log(JSON.stringify({ok:true,exported_physics3d_gravity_mutation_detected:true}));
} finally {
  // Only the exact private directory returned by mkdtempSync is removed.
  rmSync(scratch,{recursive:true,force:true});
}

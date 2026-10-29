import fs from 'node:fs';import path from 'node:path';import {op,sdk,audit} from './runner.mjs';
const {project}=JSON.parse(fs.readFileSync(path.join(audit,'project-location.json'),'utf8'));const game=sdk+'/bin/game.exe';
await op('strict-native-six-ticks',game,['--sdk',sdk,'--project',project,'--json','run','--frames','6'],{nature:'post-strict-delivery',timeoutMs:60000,echo:false});
await op('inspect-first-delivered-json',process.execPath,[path.join(audit,'inspect-result.mjs'),'030-first-native-six-ticks.stdout'],{nature:'independent-output-inspection'});

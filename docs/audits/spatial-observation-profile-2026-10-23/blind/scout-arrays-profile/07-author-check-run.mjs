import fs from 'node:fs';import path from 'node:path';import {op,sdk,audit} from './runner.mjs';
const {project}=JSON.parse(fs.readFileSync(path.join(audit,'project-location.json'),'utf8'));const game=sdk+'/bin/game.exe';
await op('author-project',process.execPath,[path.join(audit,'author-project.mjs')],{nature:'authored-project-mutation'});
await op('first-strict-check',game,['--sdk',sdk,'--project',project,'--json','check','--types'],{env:{UNONE_LUAU_ANALYZER:'D:/Projects/Unone/.toolcache/luau-0.734/luau-analyze.exe'},nature:'first-strict-check',timeoutMs:60000});
await op('first-native-six-ticks',game,['--sdk',sdk,'--project',project,'--json','run','--frames','6'],{nature:'first-submission-and-delivery',timeoutMs:60000});

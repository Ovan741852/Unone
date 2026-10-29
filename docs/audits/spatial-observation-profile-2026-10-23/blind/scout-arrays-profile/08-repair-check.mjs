import fs from 'node:fs';import path from 'node:path';import {op,sdk,audit} from './runner.mjs';
const {project}=JSON.parse(fs.readFileSync(path.join(audit,'project-location.json'),'utf8'));const game=sdk+'/bin/game.exe';
await op('repair-query-union',process.execPath,[path.join(audit,'repair-project.mjs')],{nature:'natural-authoring-repair'});
await op('strict-check-after-repair',game,['--sdk',sdk,'--project',project,'--json','check','--types'],{env:{UNONE_LUAU_ANALYZER:'D:/Projects/Unone/.toolcache/luau-0.734/luau-analyze.exe'},nature:'strict-check',timeoutMs:60000});

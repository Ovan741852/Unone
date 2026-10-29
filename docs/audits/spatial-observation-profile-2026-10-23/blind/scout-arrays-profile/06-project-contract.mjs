import fs from 'node:fs';import path from 'node:path';import {op,powershell,sdk,audit} from './runner.mjs';
const {project}=JSON.parse(fs.readFileSync(path.join(audit,'project-location.json'),'utf8'));
await op('temporary-project-instructions',...powershell(`Get-Content -LiteralPath '${project}/AGENTS.md' -Raw; Get-Content -LiteralPath '${project}/scenes/main.scene.json' -Raw`));

import {op,powershell,sdk} from './runner.mjs';
await op('public-readme',...powershell(`Get-Content -LiteralPath '${sdk}/README.md' -Raw`));
await op('public-sdk-json',...powershell(`Get-Content -LiteralPath '${sdk}/sdk.json' -Raw`));
await op('game-help',sdk+'/bin/game.exe',['--help']);

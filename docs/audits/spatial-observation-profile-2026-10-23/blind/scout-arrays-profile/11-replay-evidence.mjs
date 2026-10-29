import path from 'node:path';import {op,audit} from './runner.mjs';
await op('retain-and-check-authored-sources',process.execPath,[path.join(audit,'final-evidence.mjs')],{nature:'source-and-evidence-verification'});
await op('fresh-temp-replay',process.execPath,[path.join(audit,'replay.mjs')],{nature:'replay-verification',timeoutMs:60000});

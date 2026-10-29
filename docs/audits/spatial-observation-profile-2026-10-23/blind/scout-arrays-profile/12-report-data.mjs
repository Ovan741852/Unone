import path from 'node:path';import {op,audit} from './runner.mjs';
await op('prepare-report-evidence',process.execPath,[path.join(audit,'prepare-report-data.mjs')],{nature:'evidence-retention'});

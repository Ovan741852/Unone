import test from 'node:test';import assert from 'node:assert/strict';import {runWithEvidence} from './process-result.mjs';
test('timeout reports explicit evidence even with empty streams',()=>{assert.throws(()=>runWithEvidence('node',[],{spawn:()=>({status:null,signal:'SIGTERM',stdout:'',stderr:'',error:{code:'ETIMEDOUT',message:'expired'}})}),/"timedOut":true/);});
test('ordinary nonzero exit remains available for negative controls',()=>{assert.equal(runWithEvidence('node',[],{spawn:()=>({status:1,signal:null,stdout:'',stderr:'mismatch'})}).status,1);});

import test from 'node:test';
import assert from 'node:assert/strict';
import {createScoutProtocol,validateInput} from '../scout.mjs';
const entry={id:'example.read',summary:'Read a selected record',keywords:['read','讀取'],readOnly:true,requirements:['authorized project'],inputSchema:{type:'object',properties:{id:{type:'string',minLength:1,maxLength:20}},required:['id'],additionalProperties:false}};
test('compact recommendations, full selection, no hidden execution',()=>{
  const p=createScoutProtocol([entry]);const r=p.recommend({query:'讀取'});assert.equal(r.candidates[0].operation,'example.read');assert.equal(r.candidates[0].inputSchema,undefined);
  const c=p.describe(r.candidates[0].operation);assert.deepEqual(p.select(c.id,c.contractHash,{id:'a'}),c);
  assert.equal(p.recommend({query:'unknown action'}).candidates.length,0);
  assert.throws(()=>p.select(c.id,'old',{id:'a'}),{code:'SCOUT_CONTRACT_STALE'});
  assert.throws(()=>p.select(c.id,c.contractHash,{id:'a',extra:1}),{code:'SCOUT_INPUT_INVALID',field:'arguments.extra'});
});
test('metadata and source mutation cannot alter cached contracts or hashes',()=>{
  const data=structuredClone(entry),p=createScoutProtocol([data]),original=p.describe(data.id);data.inputSchema.required=[];
  const r=p.recommend({query:'read'});r.candidates[0].requirements.push('different');
  const d=p.describe(data.id);d.inputSchema.required=[];p.index()[0].requirements.length=0;
  assert.deepEqual(p.describe(data.id),original);
  assert.throws(()=>p.select(data.id,original.contractHash,{}),{field:'arguments.id'});
});
test('unsupported schemas, duplicate IDs, bounded query and unknown IDs fail closed',()=>{
  assert.throws(()=>createScoutProtocol([entry,entry]));assert.throws(()=>createScoutProtocol([{...entry,inputSchema:{$ref:'not-supported'}}]));
  const p=createScoutProtocol([entry]);for(const input of [{query:' '},{query:'read',limit:6},{query:'read',anything:true}])assert.throws(()=>p.recommend(input),{code:'SCOUT_INPUT_INVALID'});
  assert.throws(()=>p.describe('missing'),{code:'SCOUT_OPERATION_UNKNOWN'});
});
test('oneOf selects a concrete invalid field and rejects ambiguous or invalid values',()=>{
  const s={oneOf:[{type:'object',properties:{type:{const:'add'},count:{type:'integer',minimum:0,maximum:3}},required:['type','count'],additionalProperties:false},{type:'object',properties:{type:{const:'remove'}},required:['type'],additionalProperties:false}]};
  assert.throws(()=>validateInput({type:'add',count:4},s),{field:'arguments.count'});
  assert.throws(()=>validateInput({type:'add',count:NaN},s));validateInput({type:'remove'},s);
});

test('oneOf applies sibling constraints; unsupported schema forms fail before calls',()=>{
  const schema={type:'integer',minimum:0,oneOf:[{type:'integer'},{type:'string'}]};
  const p=createScoutProtocol([{...entry,inputSchema:schema}]),c=p.describe(entry.id);
  p.select(c.id,c.contractHash,0);
  assert.throws(()=>p.select(c.id,c.contractHash,-1),{code:'SCOUT_INPUT_INVALID',field:'arguments'});
  for(const inputSchema of [
    {type:'object',additionalProperties:{type:'integer'}},
    {properties:{id:{type:'string'}}},
    {type:'array',items:[]},{type:'array',uniqueItems:'false'},
    {type:'object',required:'id'},{type:'string',minLength:-1},
    {oneOf:[]},{enum:[]},{type:'number',minimum:2,maximum:1},
  ])assert.throws(()=>createScoutProtocol([{...entry,inputSchema}]),/Scout schema/);
});

// Unone Scout 0.1.0. Data-only discovery/contract validation; NOT authorization.
import {createHash} from 'node:crypto';

export class ScoutError extends Error {
  constructor(code, field, message, expected, actual, fix, status=400) {
    super(message); Object.assign(this,{code,field,expected,actual,fix,status});
  }
}
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const bad=(field,expected,actual)=>{throw new ScoutError('SCOUT_INPUT_INVALID',field,'Input does not match the selected contract.',expected,actual,'Correct this field using scout.describe; no operation was executed.');};
const canonical=v=>JSON.stringify(v,(_,x)=>object(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);

// The deliberately small supported JSON Schema subset is the one published in
// these contracts. Reject unsupported schema keywords when loading, not silently.
const schemaKeys=new Set(['type','properties','required','additionalProperties','items','minItems','maxItems','uniqueItems','minLength','maxLength','pattern','minimum','maximum','enum','const','oneOf','description','default']);
function checkSchema(s) {
  if(!object(s)||Object.keys(s).some(k=>!schemaKeys.has(k)))throw new Error('Unsupported Scout schema keyword');
  const invalid=detail=>{throw new Error(`Invalid Scout schema: ${detail}`);};
  if('type' in s&&!['object','array','string','integer','number','boolean','null'].includes(s.type))invalid('type must be one supported scalar type');
  for(const [keys,types] of [
    [['properties','required','additionalProperties'],['object']],
    [['items','minItems','maxItems','uniqueItems'],['array']],
    [['minLength','maxLength','pattern'],['string']],
    [['minimum','maximum'],['integer','number']],
  ])if(keys.some(k=>k in s)&&!types.includes(s.type))invalid(`${keys.join('/')} requires explicit type ${types.join(' or ')}`);
  for(const key of ['minItems','maxItems','minLength','maxLength'])if(key in s&&(!Number.isSafeInteger(s[key])||s[key]<0))invalid(`${key} must be a nonnegative safe integer`);
  for(const key of ['minimum','maximum'])if(key in s&&!Number.isFinite(s[key]))invalid(`${key} must be finite`);
  for(const [min,max] of [['minItems','maxItems'],['minLength','maxLength'],['minimum','maximum']])if(min in s&&max in s&&s[min]>s[max])invalid(`${min} exceeds ${max}`);
  for(const key of ['additionalProperties','uniqueItems'])if(key in s&&typeof s[key]!=='boolean')invalid(`${key} supports boolean only`);
  if('required' in s&&(!Array.isArray(s.required)||s.required.some(k=>typeof k!=='string')||new Set(s.required).size!==s.required.length))invalid('required must be an array of unique strings');
  if('enum' in s&&(!Array.isArray(s.enum)||!s.enum.length))invalid('enum must be a nonempty array');
  if('pattern' in s){if(typeof s.pattern!=='string')invalid('pattern must be a string');new RegExp(s.pattern);}
  if('oneOf' in s){if(!Array.isArray(s.oneOf)||!s.oneOf.length)invalid('oneOf must be a nonempty array');s.oneOf.forEach(checkSchema);}
  if('properties' in s){if(!object(s.properties))invalid('properties must be an object');Object.values(s.properties).forEach(checkSchema);}
  if('items' in s)checkSchema(s.items);
}
export function validateInput(value,schema,field='arguments') {
  if(schema.oneOf) {
    const matches=schema.oneOf.filter(s=>{try{validateInput(value,s,field);return true;}catch(e){if(e instanceof ScoutError)return false;throw e;}});
    if(matches.length!==1) {
      const selected=schema.oneOf.find(s=>s.properties?.type?.const===value?.type&&value?.type!==undefined);
      if(selected)validateInput(value,selected,field);
      bad(field,{oneOf:schema.oneOf.map(s=>s.properties?.type?.const||s.description||s.type)},value?.type??typeof value);
    }
    // A matching branch does not exempt sibling constraints (e.g. minimum).
  }
  if('const' in schema&&canonical(value)!==canonical(schema.const))bad(field,schema.const,value);
  if(schema.enum&&!schema.enum.some(v=>canonical(v)===canonical(value)))bad(field,schema.enum,value);
  if(schema.type==='object') {
    if(!object(value))bad(field,'object',value===null?'null':typeof value);
    for(const key of schema.required||[])if(!Object.hasOwn(value,key))bad(`${field}.${key}`,'required field','missing');
    for(const key of Object.keys(value)) {
      if(!Object.hasOwn(schema.properties||{},key)) {if(schema.additionalProperties===false)bad(`${field}.${key}`,Object.keys(schema.properties||{}),'unknown field');}
      else validateInput(value[key],schema.properties[key],`${field}.${key}`);
    }
  } else if(schema.type==='array') {
    if(!Array.isArray(value))bad(field,'array',typeof value);
    if(value.length<(schema.minItems??0)||value.length>(schema.maxItems??Infinity))bad(field,`array length ${schema.minItems??0}..${schema.maxItems??'unbounded'}`,value.length);
    if(schema.uniqueItems&&new Set(value.map(canonical)).size!==value.length)bad(field,'unique items','duplicates');
    if(schema.items)value.forEach((v,i)=>validateInput(v,schema.items,`${field}[${i}]`));
  } else if(schema.type==='string') {
    if(typeof value!=='string')bad(field,'string',typeof value);
    if(value.length<(schema.minLength??0)||value.length>(schema.maxLength??Infinity)||(schema.pattern&&!new RegExp(schema.pattern).test(value)))bad(field,{minLength:schema.minLength,maxLength:schema.maxLength,pattern:schema.pattern},value.slice(0,120));
  } else if(schema.type==='number'||schema.type==='integer') {
    if(typeof value!=='number'||!Number.isFinite(value)||(schema.type==='integer'&&!Number.isSafeInteger(value))||value<(schema.minimum??-Infinity)||value>(schema.maximum??Infinity))bad(field,{type:schema.type,minimum:schema.minimum,maximum:schema.maximum},value);
  } else if(schema.type==='boolean'&&typeof value!=='boolean')bad(field,'boolean',typeof value);
  else if(schema.type==='null'&&value!==null)bad(field,'null',typeof value);
}

export function createScoutProtocol(contracts) {
  const entries=new Map();
  for(const input of contracts) {
    const c=structuredClone(input);
    if(!/^[a-z][a-z0-9_.-]{1,99}$/.test(c.id)||entries.has(c.id)||!c.summary||!Array.isArray(c.keywords)||c.keywords.some(k=>typeof k!=='string'||!k.trim()))throw new Error('Invalid or duplicate Scout contract');
    checkSchema(c.inputSchema);
    entries.set(c.id,{...c,contractHash:createHash('sha256').update(canonical(c)).digest('hex')});
  }
  const describe=operation=>{
    if(typeof operation!=='string'||!entries.has(operation))throw new ScoutError('SCOUT_OPERATION_UNKNOWN','operation','No such operation in this catalog.','an ID returned by scout.recommend',String(operation).slice(0,100),'Refine the goal or use scout.index for compact capability names.',404);
    return structuredClone(entries.get(operation));
  };
  return {
    describe,
    index:()=>[...entries.values()].map(c=>({operation:c.id,summary:c.summary,readOnly:c.readOnly,requirements:structuredClone(c.requirements||[])})),
    recommend(input) {
      validateInput(input,{type:'object',properties:{query:{type:'string',minLength:1,maxLength:500,pattern:'\\S'},limit:{type:'integer',minimum:1,maximum:5}},required:['query'],additionalProperties:false},'input');
      const query=input.query.toLowerCase();
      const ranked=[...entries.values()].map(c=>({c,matches:c.keywords.filter(k=>query.includes(k.toLowerCase())),exact:query.includes(c.id)})).filter(r=>r.matches.length||r.exact).sort((a,b)=>(b.exact?100:0)+b.matches.length-(a.exact?100:0)-a.matches.length||a.c.id.localeCompare(b.c.id));
      return {schema:'unone.scout.recommendation.v1',strategy:'deterministic-keyword-v1',query:input.query,candidates:ranked.slice(0,input.limit??3).map(({c,matches})=>({operation:c.id,summary:c.summary,readOnly:c.readOnly,requirements:structuredClone(c.requirements||[]),reason:{matchedKeywords:matches},next:{action:'describe',operation:c.id}})),hasMore:ranked.length>(input.limit??3),nextAction:ranked.length?'Select one contract with scout.describe, then explicitly call.':'No match; try a synonym or scout.index. No API was invented.',limitations:['Only this catalog is searched; not semantic AI or a store search.','Discovery never grants permission or executes a task.']};
    },
    select(operation,contractHash,args) {
      const contract=describe(operation);
      if(contractHash!==contract.contractHash)throw new ScoutError('SCOUT_CONTRACT_STALE','contractHash','The selected contract is missing or outdated.',contract.contractHash,typeof contractHash==='string'?contractHash.slice(0,64):null,'Describe the same operation again; review it and use the returned hash.',409);
      validateInput(args,contract.inputSchema); return contract;
    },
  };
}

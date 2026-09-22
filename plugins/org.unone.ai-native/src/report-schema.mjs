import { CHECKS, SCHEMA, RUBRIC_VERSION } from './rubric.mjs';

const text = { type:'string',minLength:1,maxLength:4000 };
const object = (properties,required=Object.keys(properties)) => ({type:'object',properties,required,additionalProperties:false});
const array = (items,maxItems,minItems=0) => ({type:'array',items,minItems,maxItems});
const path = {type:'string',minLength:1,maxLength:512,description:'Normalized project-relative forward-slash path. No drive, absolute path, traversal or escaping symlink.'};
const sha256 = {type:'string',pattern:'^[0-9a-f]{64}$'};
const file = object({path,sha256});
const evidenceIds = {...array(text,24),uniqueItems:true};
const counter = {type:'integer',minimum:0,maximum:100000};
const step = {type:['integer','null'],minimum:1,maximum:100000};
export const reportSchema = {
  $schema:'https://json-schema.org/draft/2020-12/schema',
  title:'Unone AI-native audit v1',
  description:'Complete shape supplied only after selecting evaluate. The evaluator additionally checks concrete answers, cross-references, exact hashes/excerpts and probe provenance. A syntactically valid report is not proof its semantic claims are true.',
  ...object({
    schema:{const:SCHEMA},rubricVersion:{const:RUBRIC_VERSION},
    target:object({id:text,name:text,surface:{enum:['plugin','http','cli','mcp','ui','library','mixed']},scope:text,version:text,revision:text,environment:text}),
    trial:object({mode:{enum:['blind','informed','retest']},entryPoints:array(text,20,1),steps:{...counter,minimum:1},firstSuccessStep:step,sourceFallbackStep:step,wrongGuesses:counter,limitations:array(text,40)}),
    subject:{...array(file,64,1),description:'Exact selected source/document paths and hashes; must match execution captures. Do not include the audit itself.'},
    evidence:array(object({id:{...text,maxLength:100},kind:{enum:['document','source','execution','observation']},path,sha256,quote:{...text,maxLength:1200,description:'Short exact excerpt actually present in the artifact, not an interpretation.'}}),128,1),
    checks:array({
      ...object({id:{enum:CHECKS.map(c=>c.id)},status:{enum:['verified','partial','failed','unverified']},rating:{type:['integer','null'],minimum:0,maximum:4},
        access:{enum:['public','source-assisted','internal','none'],description:'public: documented entry only; source-assisted: source was needed (record sourceFallbackStep); internal: intentionally internal test; none: unverified only.'},
        answer:text,reason:text,nextAction:text,evidence:evidenceIds}),
      allOf:[
        {if:{properties:{status:{const:'verified'}}},then:{properties:{rating:{enum:[3,4]}}}},
        {if:{properties:{status:{const:'partial'}}},then:{properties:{rating:{enum:[1,2]}}}},
        {if:{properties:{status:{const:'failed'}}},then:{properties:{rating:{const:0}}}},
        {if:{properties:{status:{const:'unverified'}}},then:{properties:{rating:{type:'null'}}},else:{properties:{access:{enum:['public','source-assisted','internal']},evidence:{minItems:1}}}},
      ],
    },CHECKS.length,CHECKS.length),
    issues:array(object({id:text,checkId:{enum:CHECKS.map(c=>c.id)},severity:{enum:['P0','P1','P2']},summary:text,cause:text,fix:text,verification:text,evidence:{...evidenceIds,minItems:1}}),40),
  }),
};

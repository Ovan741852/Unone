export function frameInput(spec,index){return spec.input_sequence?.length?(spec.input_sequence[index]??{actions:{}}):{actions:spec.input??{}};}
export function checkAssertions(spec,observations){return (spec.assertions??[]).map(a=>{
  if(!a.observation||!Object.hasOwn(a.observation,'equals'))return {pass:false,key:'unsupported assertion',expected:a,actual:null};
  const {key,equals}=a.observation,actual=observations[key];return {key,expected:equals,actual,pass:JSON.stringify(actual)===JSON.stringify(equals)};
});}
export function validateReplay(value,hash){
  if(value?.format!=='unone.fishing.quicktest.v1'||value.scriptHash!==hash)throw Error('重播格式或腳本指紋不符，請使用同版本。');
  if(!Number.isSafeInteger(value.seed)||value.seed<1||value.seed>2147483647)throw Error('種子無效');
  if(!Array.isArray(value.inputs)||value.inputs.length>120000||value.inputs.some(x=>!x||typeof x!=='object'||Array.isArray(x)))throw Error('輸入紀錄無效或超過 120,000 幀');
  return value;
}

return {start=function(api)
 local b=buffer.create(8)
 local cases={
  {'offset-2pow32',4294967296,1}, {'length-2pow32',0,4294967296},
  {'offset-2pow32-plus1',4294967297,1}, {'length-fraction',0,1.5},
  {'offset-fraction',1.5,1}, {'numeric-string','0',1},
 }
 local result={}
 for _,case in cases do
  local ok,value=pcall(api.bytes.snapshot,b,case[2],case[3])
  result[case[1]]={accepted=ok,output_length=if ok then buffer.len(value) else -1,error=if ok then '' else tostring(value)}
 end
 api.observation.set('range_results',result)
 end,update=function()end}
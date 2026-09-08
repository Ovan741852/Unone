-- Game-owned batch operation. No algorithm or visualization rule is in Rust.
local source = [[
return function(input)
 local count=buffer.readu32(input,0)
 local seed=buffer.readu32(input,4)
 assert(count<=4096)
 local output=buffer.create(count*4)
 for i=0,count-1 do
  local v=(seed+i*7919)%4294967296
  for _=1,32 do v=bit32.bxor((v*1664525+1013904223)%4294967296,bit32.rshift(v,13)) end
  buffer.writeu32(output,i*4,v)
 end
 return output
end
]]
-- Independent main-VM reference; equality checks cover actual output bytes.
local function reference(input)
 local count=buffer.readu32(input,0)
 local seed=buffer.readu32(input,4)
 local output=buffer.create(count*4)
 for i=0,count-1 do
  local v=(seed+i*7919)%4294967296
  for _=1,32 do v=bit32.bxor((v*1664525+1013904223)%4294967296,bit32.rshift(v,13)) end
  buffer.writeu32(output,i*4,v)
 end
 return output
end
local Game={}
local pending={}
local frame=0
local verified=0
local useJobs=true
local verify=true
local count=1024
local running=true
local function reset(api)
 api.jobs.reset();pending={};frame=0;verified=0
 api.observation.set('verified_batches',0)
end
local function v(x,y,z)return{x=x,y=y,z=z}end
function Game.start(api)
 api.jobs.register('field',source)
 api.observation.set('verified_batches',0)
 if api.debug.enabled then
  api.debug.registerTab({id='jobs',label='批次 Job'})
  api.debug.register({kind='checkbox',id='jobs.enabled',tab='jobs',label='使用 job（關閉為主 Lua 參考實作）',checked=true},function(value)reset(api);useJobs=value end)
  api.debug.register({kind='checkbox',id='jobs.verify',tab='jobs',label='逐 byte 對照參考結果（額外計算成本）',checked=true},function(value)verify=value end)
  api.debug.register({kind='checkbox',id='jobs.running',tab='jobs',label='持續提交批次',checked=true},function(value)running=value end)
  api.debug.register({kind='button',id='jobs.reset',tab='jobs',label='取消待處理工作並重設'},function()reset(api)end)
  api.debug.register({kind='label',id='jobs.status',tab='jobs',text='Read Profile.jobs for executor capabilities and costs'})
 end
end
function Game.update(api,dt)
 if not running then return end
 frame+=1
 local checksum=0
 for index,work in ipairs(pending) do
  local output=work.handle and api.jobs.take(work.handle) or work.output
  if work.handle and verify then
   local expected=reference(work.input)
   assert(buffer.tostring(output)==buffer.tostring(expected),'JOB_REFERENCE_MISMATCH')
   verified+=1
  end
  local first=buffer.readu32(output,0)
  checksum=(checksum+first)%2147483647
  local height=1+(first%700)/100
  api.entity.setTransform3D('bar'..index,{position=v((index-2.5)*3,height/2,0),rotation=v(0,0,0),scale=v(2,height,2)})
 end
 pending={}
 for index=1,4 do
  local input=buffer.create(8);buffer.writeu32(input,0,count);buffer.writeu32(input,4,frame*1009+index*7919)
  if useJobs then pending[index]={input=input,handle=api.jobs.submit('field',input)}
  else pending[index]={input=input,output=reference(input)} end
 end
 api.observation.set('checksum',checksum)
 api.observation.set('verified_batches',verified)
 api.observation.set('frame',frame)
 api.observation.set('values_per_batch',count)
 api.observation.set('mode',useJobs and 'jobs' or 'main-lua-reference')
 if api.debug.enabled then api.debug.set('jobs.status','frame '..frame..' · verified '..verified..' · 4 × '..count..' values; backend is in Profile.jobs') end
end
return Game

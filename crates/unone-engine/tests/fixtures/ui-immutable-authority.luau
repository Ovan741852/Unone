local A,P,T,realTable,realMath,realString=assert,pcall,type,table,math,string
local G,S,SetMeta,RawEqual,Pairs=getfenv,setfenv,setmetatable,rawequal,pairs
local c=components
local list=c.virtualList({id='authority-live',viewport={left=0,top=0,width=20,height=20},items={{id='1'}},key='id',rowHeight=10,
 renderItem=function()return{c.text({id='row',text='Row',rect={x=0,y=0,width=10,height=5}})}end})
local mt={__eq=function()return true end}
SetMeta(list,mt)
local forged=SetMeta({kind='text',id='authority-live',text='Forged',rect={x=0,y=0,width=10,height=5}},mt)
local environment=G(c.text)
local names={'table','math','string','assert','type','pairs','ipairs','next','error','tostring','getmetatable','setmetatable','rawget','rawequal','pcall'}
local saved={};for _,name in ipairs(names)do saved[name]=environment[name]end
local function none()return nil end
local empty=function()return none,nil,nil end
local fakeTable=realTable.clone(realTable);fakeTable.freeze=function(value)return value end;fakeTable.clone=function(value)return value end
local fakeMath=realTable.clone(realMath);fakeMath.max=function()return 0 end;fakeMath.abs=function()return 0 end
local fakeString=realTable.clone(realString);fakeString.find=function()return 1 end
local badWide=realTable.create(131071,true)
local ownedWide=c.composeStyle({color=realTable.create(131070,true)})
local deep={};local last=deep;for _=1,63 do last[1]={};last=last[1]end
local ownedDepth=c.composeStyle({color=deep})
local ok,message=P(function()
 environment.table=fakeTable;environment.math=fakeMath;environment.string=fakeString
 environment.assert=function()end;environment.error=function()end;environment.type=function()return'table'end
 environment.pairs=empty;environment.ipairs=empty;environment.next=none;environment.tostring=function()return'shadow'end
 environment.getmetatable=function()return nil end;environment.setmetatable=function(value)return value end
 environment.rawget=function()return'authority-live'end;environment.rawequal=function()return true end
 environment.pcall=function()return true end
 local child=c.text({id='authority-child',text='Child',rect={x=1,y=2,width=3,height=4}})
 A(realTable.isfrozen(child) and realTable.isfrozen(child.rect),'function environment replaced freeze authority')
 A(not P(function()child.rect.x=90 end),'mutable descendant received immutable grant')
 A(not P(c.composeStyle,{color=badWide}),'function environment bypassed expanded work bound')
 A(not P(c.composeStyle,{color=ownedWide}),'function environment bypassed cached expanded cost')
 A(not P(c.composeStyle,{color=ownedDepth}),'function environment bypassed cached depth bound')
 local malformed={};malformed.color=malformed
 A(not P(c.composeStyle,malformed),'function environment bypassed cycle guard')
 A(helpers.isManagedNode(list),'real managed identity lost')
 A(not helpers.isManagedNode(forged),'metamethod/global shadow forged managed identity')
 local parent=c.component({id='authority-parent',component='test',rect={x=0,y=0,width=100,height=100},children={child,forged}})
 A(RawEqual(parent.children[1],child) and not RawEqual(parent.children[2],forged))
 A(realTable.isfrozen(parent.children[2]))
 local evil=realTable.clone(environment);evil.table=fakeTable;evil.assert=function()end
 S(c.text,evil)
 local later=c.text({id='setfenv-child',rect={x=0,y=0,width=1,height=1}})
 A(realTable.isfrozen(later),'setfenv replaced constructor authority')
end)
S(c.text,environment)
for _,name in Pairs(names)do environment[name]=saved[name]end
A(ok,message)
api.observation.set('immutable_authority',true)

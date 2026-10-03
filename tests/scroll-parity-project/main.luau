local Game={}
local items,modal,filter={},false,"all"
for i=1,10000 do items[i]={id="key_"..i,name="Item "..i} end
local function publish(api)
 local data={}
 for i,item in ipairs(items)do if filter=="all" or filter=="even" and i%2==0 then table.insert(data,item)end end
 local list=api.ui.virtualList({id="list",viewport={left=10,top=10,width=80,height=35},items=data,key="id",rowHeight=4,gapY=.5,enabled=not modal,resetKey=filter,
  renderItem=function(item,index,key)return {{kind="button",id="row_"..key,text=item.name,action="Inspect_"..key,rect={x=0,y=0,width=80,height=4}}}end})
 local grid=api.ui.virtualGrid({id="grid",viewport={left=10,top=50,width=80,height=35},items=data,key="id",columns=8,columnWidth=9,gapX=1,rowHeight=12,gapY=1,enabled=not modal,resetKey=filter,
  renderItem=function(item,index,key)return {{kind="button",id="cell_"..key,text=item.name,action="Inspect_"..key,rect={x=0,y=0,width=9,height=12}}}end})
 api.ui.setRoot({kind="screen",id="collections",node=filter,children={list,grid}})
 api.observation.set("count",#data);api.observation.set("modal",modal)
end
function Game.start(api)publish(api)end
function Game.update(api,dt)
 if api.input.isDown("Modal")then modal=true end
 if api.input.isDown("Filter")then filter="even" end
 if api.input.isDown("Empty")then filter="empty" end
 publish(api)
end
return Game

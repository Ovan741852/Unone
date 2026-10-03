-- Engine helper: local content rects are top-left/y-down. Data/functions stay
-- in Lua; only the visible window crosses the host boundary.
local publish = ...
local registry, root, revision = {}, nil, 0
local function positive(n, name)
 assert(type(n)=="number" and n==n and n>0 and n<math.huge,"UI_SCROLL_SPEC: positive "..name.." required")
 return n
end
local function check(s, fields)
 assert(type(s)=="table" and type(s.id)=="string" and s.id~="","UI_SCROLL_SPEC: stable id required")
 for k in pairs(s) do assert(fields[k],"UI_SCROLL_OPTION: unknown option "..tostring(k)) end
 assert(type(s.viewport)=="table","UI_SCROLL_SPEC: viewport rect required")
 for k in pairs(s.viewport) do assert(k=="left" or k=="top" or k=="width" or k=="height","UI_SCROLL_VIEWPORT: use left/top/width/height, not x/y") end
 assert(type(s.viewport.left)=="number" and type(s.viewport.top)=="number","UI_SCROLL_VIEWPORT: left and top required")
 assert(s.enabled==nil or type(s.enabled)=="boolean","UI_SCROLL_ENABLED: boolean required")
 assert(s.resetKey==nil or type(s.resetKey)=="string","UI_SCROLL_RESET_KEY: string required")
 positive(s.viewport.width,"viewport.width");positive(s.viewport.height,"viewport.height")
end
local function scrollView(s)
 check(s,{id=true,viewport=true,content=true,axis=true,enabled=true,resetKey=true,wheelRect=true})
 local wheel=nil
 if s.wheelRect then
  local r=s.wheelRect
  for k in pairs(r) do assert(k=="left" or k=="top" or k=="width" or k=="height","UI_SCROLL_WHEEL_RECT: use left/top/width/height") end
  assert(type(r.left)=="number" and type(r.top)=="number","UI_SCROLL_WHEEL_RECT: left and top required")
  wheel={x=r.left,y=100-r.top-r.height,width=r.width,height=r.height}
 end
 return {kind="scroll_view",id=s.id,viewport=s.viewport,
  scroll={axis=s.axis or "vertical",enabled=s.enabled~=false,reset_key=s.resetKey or "",wheel_rect=wheel},
  children=s.content and #s.content>0 and s.content or nil}
end
local function translated(n,x,y)
 if n.kind=="scroll_view" and n.viewport then
  local out=table.clone(n);out.viewport=table.clone(n.viewport)
  out.viewport.left+=x;out.viewport.top+=y;return out
 end
 assert(n.rect and not n.anchor,"UI_SCROLL_LOCAL_RECT: renderItem must return local rectangles")
 local out=table.clone(n)
 out.rect={x=n.rect.x+x,y=n.rect.y+y,width=n.rect.width,height=n.rect.height}
 if n.children and n.kind~="scroll_view" then
  out.children={};for _,child in ipairs(n.children) do table.insert(out.children,translated(child,x,y)) end
 end
 return out
end
local function materialize(entry,first,last)
 local s,v=entry.spec,entry.node.scroll.virtual_items
 local children={}
 for i=first,last do
  local x=((i-1)%v.columns)*(v.column_width+v.gap_x)
  local y=math.floor((i-1)/v.columns)*(v.row_height+v.gap_y)
  local nodes=s.renderItem(s.items[i],i,v.keys[i])
  assert(type(nodes)=="table" and #nodes>0,"UI_VIRTUAL_RENDER: return a non-empty array of local UI nodes")
  local projected={};for _,n in ipairs(nodes) do table.insert(projected,translated(n,x,y)) end
  table.insert(children,{kind="component",id=s.id.."::"..v.keys[i],component="ui.virtual-item",
   rect={x=x,y=y,width=v.column_width,height=v.row_height},children=projected})
 end
 return #children>0 and children or nil
end
local function virtual(s,grid)
 check(s,{id=true,viewport=true,items=true,key=true,renderItem=true,rowHeight=true,columnWidth=true,
  columns=true,gapX=true,gapY=true,enabled=true,resetKey=true,wheelRect=true})
 if not grid then assert(s.columns==nil and s.columnWidth==nil and s.gapX==nil,"UI_VIRTUAL_LIST_OPTION: use virtualGrid for columns/columnWidth/gapX") end
 assert(type(s.items)=="table" and type(s.renderItem)=="function","UI_VIRTUAL_SPEC: items and renderItem required")
 assert(type(s.key)=="string" or type(s.key)=="function","UI_VIRTUAL_KEY: key field name or function required; never use array index")
 assert(#s.items<=100000,"UI_VIRTUAL_ITEM_LIMIT: maximum 100000 items")
 local keys,seen={},{}
 for i,item in ipairs(s.items) do
  local key=type(s.key)=="function" and s.key(item,i) or item[s.key]
  assert(type(key)=="string" and key~="" and not seen[key],"UI_VIRTUAL_KEY: unique non-empty string keys required")
  seen[key]=true;table.insert(keys,key)
 end
 local columns=grid and positive(s.columns,"columns") or 1
 assert(columns%1==0 and columns<=1024,"UI_VIRTUAL_COLUMNS: integer 1..1024 required")
 local height=positive(s.rowHeight,"rowHeight")
 local width=grid and positive(s.columnWidth,"columnWidth") or positive(s.viewport.width,"viewport.width")
 local gx,gy=s.gapX or 0,s.gapY or 0
 assert(type(gx)=="number" and type(gy)=="number" and gx>=0 and gy>=0 and gx<math.huge and gy<math.huge,"UI_VIRTUAL_GAP: finite non-negative gaps required")
 assert(columns*width+(columns-1)*gx<=s.viewport.width+1e-8,"UI_VIRTUAL_COLUMNS: cells exceed viewport width")
 local old=registry[s.id]
 local signature=table.concat({columns,height,width,gx,gy,s.resetKey or ""},"|")
 local same=old and old.signature==signature and #old.keys==#keys
 if same then for i,k in ipairs(keys) do if old.keys[i]~=k then same=false;break end end end
 if not same then revision+=1 end
 local first=#keys==0 and 0 or (same and math.min(old.first,#keys) or 1)
 local last=#keys==0 and 0 or (same and math.min(old.last,#keys) or math.min(#keys,(math.ceil(positive(s.viewport.height,"viewport.height")/(height+gy))+1)*columns))
 local node=scrollView({id=s.id,viewport=s.viewport,enabled=s.enabled,resetKey=s.resetKey,wheelRect=s.wheelRect})
 node.scroll.virtual_items={keys=keys,row_height=height,column_width=width,columns=columns,gap_x=gx,gap_y=gy,
  revision=same and old.revision or revision,first=first,last=last}
 local entry={spec=s,node=node,keys=keys,signature=signature,revision=node.scroll.virtual_items.revision,first=first,last=last}
 node.children=first>0 and materialize(entry,first,last) or nil
 registry[s.id]=entry
 return node
end
local function setRoot(nextRoot)
 publish(nextRoot)
 root=nextRoot
 local live={}
 local function visit(n)
  if n.kind=="scroll_view" and n.scroll.virtual_items then live[n.id]=true end
  for _,c in ipairs(n.children or {}) do visit(c) end
 end
 visit(root)
 for id in pairs(registry) do if not live[id] then registry[id]=nil end end
end
local function request(r)
 for k in pairs(r) do assert(k=="id" or k=="revision" or k=="first" or k=="last","UI_VIRTUAL_REQUEST: unknown field") end
 local entry=registry[r.id]
 if not entry or r.revision~=entry.revision or not entry.node.scroll.enabled then return false end
 local v=entry.node.scroll.virtual_items
 assert(type(r.first)=="number" and type(r.last)=="number" and r.first%1==0 and r.last%1==0
  and r.first>=1 and r.last>=r.first and r.last<=#v.keys,"UI_VIRTUAL_RANGE: invalid inclusive range")
 local maxWindow=(math.ceil(entry.spec.viewport.height/(v.row_height+v.gap_y))+3)*v.columns
 assert(r.last-r.first+1<=maxWindow,"UI_VIRTUAL_RANGE: request exceeds viewport plus buffer")
 local children=materialize(entry,r.first,r.last)
 local oldChildren,oldFirst,oldLast=entry.node.children,v.first,v.last
 entry.node.children=children;v.first=r.first;v.last=r.last
 local ok,err=pcall(publish,root)
 if not ok then entry.node.children=oldChildren;v.first=oldFirst;v.last=oldLast;error(err) end
 entry.first=r.first;entry.last=r.last
 return true
end
return {scrollView=scrollView,virtualList=function(s)return virtual(s,false)end,
 virtualGrid=function(s)return virtual(s,true)end,setRoot=setRoot,request=request}

local c=components
local borrowedRect={x=0,y=0,width=20,height=10}
local borrowedStyle={padding={left=1},color={.1,.2,.3,1}}
local child=c.text({id='child',text='Original',rect=borrowedRect,style=borrowedStyle})
assert(table.isfrozen(child) and table.isfrozen(child.rect) and table.isfrozen(child.style.color))
assert(not table.isfrozen(borrowedRect) and not table.isfrozen(borrowedStyle))
borrowedRect.x=5;borrowedStyle.color[1]=.9
assert(child.rect.x==0 and child.style.color[1]==.1)
for _,change in ipairs({function()child.text='mutated'end,function()child.rect.x=9 end,
 function()child.style.color[1]=1 end,function()table.clear(child)end})do assert(not pcall(change))end
local parent=c.component({id='parent',component='test',rect={x=0,y=0,width=100,height=100},children={child}})
assert(parent.children[1]==child and table.isfrozen(parent.children))
local other=c.create().component({id='other',component='test',rect={x=0,y=0,width=100,height=100},children={parent}})
assert(other.children[1]==parent,'grants must compose across kits')
local surfaced=c.component({id='surface',component='test',rect={x=0,y=0,width=100,height=100},
 surface={kind='panel',style={background={0,0,0,1}}},children=parent.children})
assert(#parent.children==1 and #surfaced.children==2 and surfaced.children[2]==child)
assert(surfaced.children[1].background_for.component=='surface')
local grantedSurface=c.composeStyle({color={kind='panel'}}).color
local grantedCard=c.component({id='granted-surface',component='test',rect=parent.rect,surface=grantedSurface,children=parent.children})
assert(#grantedCard.children==2 and grantedCard.children[2]==child and table.isfrozen(grantedCard.children[1]))
local base=c.composeStyle({padding={left=1,right=2},color={1,1,1,1}})
local variant=c.composeStyle(base,{padding={right=3}})
assert(table.isfrozen(base) and table.isfrozen(base.padding) and table.isfrozen(variant.padding))
assert(base.padding.right==2 and variant.padding.left==1 and variant.padding.right==3)
local themed=c.create({text={padding={left=4,top=5},color={.2,.3,.4,1}}})
local styled=themed.text({id='styled',rect=child.rect,style=variant})
assert(styled.style.padding.left==1 and styled.style.padding.top==5 and styled.style.padding.right==3)
assert(base.padding.left==1 and variant.padding.top==nil)
local a=themed.text({id='a',rect=child.rect})
local b=themed.text({id='b',rect=child.rect})
assert(a.style==b.style and table.isfrozen(a.style),'immutable kit defaults may be shared')
local control=c.createSlider({id='slider',value=.5})
local view=control.view({rect=child.rect,hitPadding=0})
assert(table.isfrozen(view) and table.isfrozen(view.drag) and table.isfrozen(view.drag.track_rect))
control.setValue(.8);assert(control.getValue()==.8 and view.drag.enabled)
local viewport={left=0,top=0,width=50,height=40}
local rawContent={{kind='text',id='raw',text='Raw',rect={x=0,y=0,width=20,height=10}}}
local scroll=c.scrollView({id='ordinary-scroll',viewport=viewport,content=rawContent})
assert(table.isfrozen(scroll) and table.isfrozen(scroll.viewport) and table.isfrozen(scroll.children[1]))
assert(not table.isfrozen(viewport) and not table.isfrozen(rawContent[1]))
viewport.left=8;rawContent[1].text='Changed';assert(scroll.viewport.left==0 and scroll.children[1].text=='Raw')
local shallow=table.freeze({id='shallow',rect={x=1,y=2,width=3,height=4}})
local detached=c.text(shallow);shallow.rect.x=99;assert(detached.rect.x==1)
local clone=table.clone(child);clone.text='Clone'
local clonedParent=c.component({id='cloned',component='test',rect=parent.rect,children={clone}})
assert(clonedParent.children[1]~=clone and clonedParent.children[1].text=='Clone')
clone.text='Again';assert(clonedParent.children[1].text=='Clone')
local bad=table.freeze({color={function()end}})
assert(not pcall(c.composeStyle,bad),'caller freeze must not grant portability')
local cyclic={};cyclic.color=cyclic;table.freeze(cyclic)
assert(not pcall(c.composeStyle,cyclic),'caller freeze must not grant acyclicity')
local wide=table.create(131070,true)
local exact=c.composeStyle({color=wide});assert(#c.composeStyle(exact).color==131070)
wide[131071]=true;assert(not pcall(c.composeStyle,{color=wide}))
local dag=c.composeStyle({color=table.create(1000,true)})
local rejected=false
for _=1,10 do local ok,nextDag=pcall(c.composeStyle,{color=dag,background=dag})
 if not ok then rejected=true;break end;dag=nextDag end
assert(rejected,'shared immutable DAG must charge its expanded work every time')
local deep={};local last=deep;for _=1,63 do last[1]={};last=last[1]end
local exactDepth=c.composeStyle({color=deep});assert(c.composeStyle(exactDepth))
assert(not pcall(c.composeStyle,{color=exactDepth}),'cached height must enforce nesting depth')
local items={};for i=1,10 do items[i]={id=tostring(i)}end
local list=c.virtualList({id='live',viewport={left=0,top=0,width=50,height=20},items=items,key='id',rowHeight=10,
 renderItem=function(item)return{c.text({id='item'..item.id,text=item.id,rect={x=0,y=0,width=20,height=8}})}end})
local mixed=c.component({id='mixed',component='test',rect=parent.rect,children={list,child}})
assert(table.isfrozen(mixed) and not table.isfrozen(list) and mixed.children[1]==list)
local mixedRoot=c.screen({id='root',node='test',children={mixed}})
assert(mixedRoot.children[1]~=mixed and mixedRoot.children[1].children[1]==list)
assert(mixedRoot.children[1].children[2]==child)
helpers.setRoot(mixedRoot)
local revision=list.scroll.virtual_items.revision
assert(helpers.request({id='live',revision=revision,first=5,last=7}))
assert(list.scroll.virtual_items.first==5 and list.children[1].id=='live::5')
local previousChildren=list.children
failPublication=true
assert(not pcall(helpers.request,{id='live',revision=revision,first=6,last=8}))
assert(list.children==previousChildren and list.scroll.virtual_items.first==5)
failPublication=false
helpers.setRoot(c.screen({id='retired',node='test',children={child}}))
assert(not helpers.isManagedNode(list))
list.children={function()end}
assert(not pcall(c.screen,{id='stale',node='test',children={mixed}}),'retired mutable descendant cannot hide under a pure ancestor grant')
api.observation.set('immutable_functional',true)
